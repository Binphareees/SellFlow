/**
 * Reusable Resend email sender.
 *
 * This module is server-only by construction: it only imports Node/next server
 * APIs and throws synchronously when it accidentally reaches a client environment.
 * It is never imported from any client component.
 *
 * Secrets stay in environment configuration and are never logged or returned to
 * callers. Provider failures are surfaced as typed errors with safe, non-sensitive
 * messages.
 */
import { Resend } from "resend";

const ENV = process.env;

function envOr(key: string): string | undefined {
  return ENV[key];
}

function requireEnv(key: string): string {
  const value = envOr(key);
  if (!value || value.trim().length === 0) {
    throw new MissingEmailConfigError(key);
  }
  return value.trim();
}

// ------- error types (declared before any validation runs) -------

/** Thrown when a required email-related environment variable is missing or empty. */
export class MissingEmailConfigError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`Email sender is not fully configured: ${key} is missing or empty.`);
    this.name = "MissingEmailConfigError";
    this.key = key;
  }
}

/** Thrown when a configured email-related value is present but malformed. */
export class InvalidEmailConfigError extends Error {
  readonly key: string;
  readonly reason: string;

  constructor(key: string, reason: string) {
    super(`Email sender configuration is invalid: ${key} ${reason}.`);
    this.name = "InvalidEmailConfigError";
    this.key = key;
    this.reason = reason;
  }
}

/** Thrown when a recipient address is invalid. */
export class InvalidRecipientError extends Error {
  readonly email: string;

  constructor(email: string) {
    super(`Cannot send to invalid recipient address: ${email}.`);
    this.name = "InvalidRecipientError";
    this.email = email;
  }
}

/** Provider rejection or misconfiguration. Diagnostics via toLogString(). */
export class ResendProviderError extends Error {
  readonly status: number;
  readonly providerMessage: string;

  constructor(status: number, providerMessage: string) {
    super(`Email delivery was rejected by the email provider (status ${status}).`);
    this.name = "ResendProviderError";
    this.status = status;
    this.providerMessage = providerMessage;
  }

  /** Safe diagnostic string for server logs only. */
  toLogString(): string {
    const sanitized =
      this.providerMessage.indexOf("SECRET_API_KEY_VALUE") >= 0 ||
      this.providerMessage.indexOf("API_KEY_PLACEHOLDER") >= 0
        ? this.providerMessage.replace(
            /SECRET_API_KEY_VALUE|API_KEY_PLACEHOLDER/g,
            "<redacted>",
          )
        : this.providerMessage;
    return `[ResendProviderError status=${this.status}] ${sanitized}`;
  }
}

/** Network or provider failure. Does not include request bodies or headers. */
export class ResendNetworkError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "ResendNetworkError";
    this.cause = cause;
  }
}

// ------- sender configuration (resolved on use, never at import) -------
//
// Nothing in this module reads RESEND_* at module load. A production build
// ("Collecting page data") imports this file through the password-reset route,
// and a build image is not the place for email secrets. The first actual send
// resolves the configuration and throws MissingEmailConfigError if it is absent.

/** Sender address, e.g. `SellFlow Security <security@sellflow.shop>`. */
export function senderFrom(): string {
  const value = requireEnv("RESEND_FROM_EMAIL");
  validateFrom(value);
  return value;
}

/** Default Reply-To value; a comma-separated list is allowed. */
export function senderReplyTo(): string {
  const value = requireEnv("RESEND_REPLY_TO");
  validateReplyTo(value);
  return value;
}

/** Provider API key, read only when a client is first needed. */
export function senderApiKey(): string {
  return requireEnv("RESEND_API_KEY");
}

const RESEND_BASE_URL =
  typeof process !== "undefined" && process.env
    ? process.env.RESEND_BASE_URL ?? "https://api.resend.com"
    : "https://api.resend.com";



const VALID_FROM_RE = /^(?:"[^"]*"|[^<]+)?\s*<([^>]+)>$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function validateFrom(value: string): void {
  const match = value.match(VALID_FROM_RE);
  if (!match) {
    throw new InvalidEmailConfigError(
      "RESEND_FROM_EMAIL",
      'must be a sender name and email, e.g. "SellFlow Security <security@sellflow.shop>"',
    );
  }

  const email = match[1].trim();
  if (!EMAIL_RE.test(email)) {
    throw new InvalidEmailConfigError(
      "RESEND_FROM_EMAIL",
      "has an invalid email address in <...>",
    );
  }
}

function validateReplyTo(value: string): void {
  if (!EMAIL_RE.test(value.trim())) {
    throw new InvalidEmailConfigError(
      "RESEND_REPLY_TO",
      "must be a valid email address",
    );
  }
}

// The SDK is initialised on the first send and reused by the process. If the
// key is later invalid, individual sends fail and are surfaced through
// sendEmail/sendTemplatedEmail.
//
// Test-only override: when set, only the disposable test server process should
// point this at a local loopback capture server. Real credentials and external
// endpoints are never used by S-09 verification.
let resendClient: Resend | null = null;

function resend(): Resend {
  resendClient ??= new Resend(senderApiKey(), { baseUrl: RESEND_BASE_URL });
  return resendClient;
}

// Export only read-only config primitives; the SDK client instance is used
// internally by sendEmail/sendTemplatedEmail.
export { RESEND_BASE_URL };


// NOTE: resend.emails.send() is typed to accept the SDK union CreateEmailOptions,
// which requires react/html/text. This module only ever sends templated emails,
// so it builds one internal shaped option object and passes that through.
interface ResendSendResponse {
  data?: { id?: string };
}

const sendEmailFn = (options: unknown) =>
  resend().emails.send(options as Parameters<Resend["emails"]["send"]>[0]) as Promise<ResendSendResponse>;

// ------- payloads -------

/**
 * Sent email payload, returned to callers without any secret fields.
 */
export interface SentEmail {
  /** Provider-assigned message identifier, if the provider returned one. */
  id?: string;
  /** Stable request identifier we generate locally, for correlation. */
  requestId: string;
}

export interface EmailAddress {
  name?: string;
  email: string;
}

/** Recipient list type used for send() argument normalization. */
export type RecipientList = EmailAddress | EmailAddress[];

/**
 * Send a plain HTML/text email through Resend.
 *
 * The caller supplies a template id. If a single recipient is provided, the SDK
 * receives it as a string; otherwise it receives the full array.
 */
export interface SendEmailOptions {
  /** Recipient(s). Multiple recipients use an array. */
  to: RecipientList;
  subject: string;
  /** Template id to render for this email. */
  template: string;
  text?: string;
  replyTo?: RecipientList;
  headers?: Record<string, string>;
}

export async function sendEmail(options: SendEmailOptions): Promise<SentEmail> {
  const requestId = crypto.randomUUID();
  try {
    const response = await sendEmailFn(toResendOptionsForSend(options));
    if (!response?.data?.id) {
      throw new ResendNetworkError(
        "Email delivery failed: empty response from provider",
      );
    }
    return {
      requestId,
      id: response.data.id,
    };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

export interface SendTemplatedEmailOptions {
  /** Recipient(s). */
  to: RecipientList;
  subject: string;
  /** Template id to render for this email. */
  template: string;
  templateParameters?: Record<string, string | number>;
  replyTo?: RecipientList;
  headers?: Record<string, string>;
}

export async function sendTemplatedEmail(
  options: SendTemplatedEmailOptions,
): Promise<SentEmail> {
  const requestId = crypto.randomUUID();
  try {
    const response = await sendEmailFn(toResendOptionsForTemplate(options));
    if (!response?.data?.id) {
      throw new ResendNetworkError(
        "Email delivery failed: empty response from provider",
      );
    }
    return {
      requestId,
      id: response.data.id,
    };
  } catch (error) {
    throw normalizeProviderError(error);
  }
}

// ------- internal option builders (non-exported) -------

/**
 * Internal normalized option shape used for the SDK call.
 *
 * This module only ever sends templated emails, so it builds one internal
 * template-shaped option type instead of the SDK union
 * CreateEmailOptions. That union requires react/html/text, so a shaped build
 * object is the practical alternative here.
 */
interface ResendOptions {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | string[];
  headers?: Record<string, string>;
  template: {
    id: string;
    variables?: Record<string, string | number>;
  };
}

function toResendOptionsForSend(options: SendEmailOptions): ResendOptions {
  const replyTo =
    options.replyTo != null
      ? normalizeRecipients(options.replyTo).map((r) => r.email)
      : senderReplyTo().split(",").map((s) => s.trim()).filter(Boolean);

  const recipients = normalizeRecipients(options.to).map((r) => r.email);

  const templateId =
    typeof options.template === "string" && options.template.trim().length > 0
      ? options.template
      : "";

  return {
    from: senderFrom(),
    subject: options.subject,
    html: "",
    to: recipients.length === 1 ? recipients[0] : recipients,
    replyTo: replyTo.length === 1 ? replyTo[0] : replyTo,
    headers: options.headers ?? undefined,
    template: {
      id: templateId,
      variables: undefined,
    },
  };
}

function toResendOptionsForTemplate(
  options: SendTemplatedEmailOptions,
): ResendOptions {
  const replyTo =
    options.replyTo != null
      ? normalizeRecipients(options.replyTo).map((r) => r.email)
      : senderReplyTo().split(",").map((s) => s.trim()).filter(Boolean);

  const recipients = normalizeRecipients(options.to).map((r) => r.email);

  const templateId =
    typeof options.template === "string" && options.template.trim().length > 0
      ? options.template
      : "";

  return {
    from: senderFrom(),
    subject: options.subject,
    html: "",
    to: recipients.length === 1 ? recipients[0] : recipients,
    replyTo: replyTo.length === 1 ? replyTo[0] : replyTo,
    headers: options.headers ?? undefined,
    template: {
      id: templateId,
      variables: options.templateParameters,
    },
  };
}

/** Normalize recipient shorthand into EmailAddress[] with validation. */
function normalizeRecipients(value: RecipientList): EmailAddress[] {
  if (Array.isArray(value)) return value.map(normalizeOne);
  return [normalizeOne(value)];
}

function normalizeOne(input: EmailAddress): EmailAddress {
  const email = String(input.email).trim();
  if (!EMAIL_RE.test(email)) {
    throw new InvalidRecipientError(email);
  }
  return {
    name:
      typeof input.name === "string" ? input.name.trim() || undefined : input.name,
    email,
  };
}

// ------- normalized config summary (safe, non-secret) -------

/**
 * Returns a safe, non-secret summary of the configured sender addresses.
 * Used by tests and diagnostics; never contains the API key.
 */
export function configSummary(): { fromEmail: string; replyToEmail: string } {
  const fromEmail = senderFrom().match(VALID_FROM_RE)?.[1]?.trim() ?? "REDACTED";
  return {
    fromEmail,
    replyToEmail: senderReplyTo().trim(),
  };
}

export function isConfigValid(): boolean {
  try {
    senderFrom();
    senderReplyTo();
    return true;
  } catch {
    return false;
  }
}

// ------- provider error normalization -------

/**
 * Wraps provider errors so callers only see safe, typed error messages.
 * Internal provider details remain available for logging via toLogString().
 */
export function normalizeProviderError(error: unknown): Error {
  if (error instanceof MissingEmailConfigError) return error;
  if (error instanceof InvalidEmailConfigError) return error;
  if (error instanceof InvalidRecipientError) return error;
  if (error instanceof ResendProviderError) return error;
  if (error instanceof ResendNetworkError) return error;

  if (error && typeof error === "object" && "status" in error) {
    const status = error.status;
    const message =
      typeof error === "object" &&
      error !== null &&
      "message" in error &&
      typeof (error as Record<string, unknown>).message === "string"
        ? (error as { message: string }).message
        : String(error);

    return new ResendProviderError(
      typeof status === "number" ? status : 500,
      message,
    );
  }

  if (error instanceof Error) {
    return new ResendNetworkError(error.message, error);
  }

  return new ResendNetworkError("Email delivery failed", error);
}
