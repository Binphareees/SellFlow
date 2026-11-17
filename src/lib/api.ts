import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Sign in to continue") =>
  new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have access to this resource") =>
  new ApiError(403, "FORBIDDEN", message);
export const notFound = (message = "Not found") => new ApiError(404, "NOT_FOUND", message);
export const conflict = (message: string) => new ApiError(409, "CONFLICT", message);
export const tooManyRequests = (message: string, retryAfterSeconds: number) =>
  new ApiError(
    429,
    "TOO_MANY_ATTEMPTS",
    message,
    { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) },
    { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  );

export function json<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      // Everything here is per-account data; never let a shared cache hold it.
      "Cache-Control": "private, no-store",
    },
  });
}

/** Parses and validates a JSON body, converting zod failures into 422s. */
export async function readBody<S extends ZodType>(request: Request, schema: S): Promise<S["_output"]> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest("Expected a JSON body");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, "VALIDATION_ERROR", "Some fields need attention", flattenZod(parsed.error));
  }
  return parsed.data;
}

export function flattenZod(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Keep in sync with SESSION_COOKIE in src/lib/auth/session.ts. Importing it
// here would create a cycle (session.ts imports unauthorized from this file).
const SESSION_COOKIE_NAME = "sf_session";

/** Returns the canonical scheme://host:port form, or null when unparseable. */
function normaliseOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    // URL.origin is "null" for opaque origins such as file: and sandboxed
    // frames. Those must never be treated as same-origin.
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

/**
 * The origins this deployment considers itself.
 *
 * APP_ORIGIN (runtime) or NEXT_PUBLIC_APP_URL (build-time) is authoritative
 * when configured. This is the only safe source behind a reverse proxy: Next
 * may rewrite request.url and the Host header from X-Forwarded-* headers, so
 * those values must not be used to establish the expected origin.
 *
 * Development and test may fall back to the request URL and Host for local
 * convenience. Production without a configured origin fails closed.
 */
function expectedOrigins(request: Request): Set<string> {
  const configured =
    normaliseOrigin(process.env.APP_ORIGIN) ??
    normaliseOrigin(process.env.NEXT_PUBLIC_APP_URL);
  if (configured) return new Set([configured]);

  if (process.env.NODE_ENV === "production") return new Set();

  const origins = new Set<string>();
  let protocol: string | null = null;
  try {
    const url = new URL(request.url);
    origins.add(url.origin);
    protocol = url.protocol;
  } catch {
    // A malformed request URL leaves Host available for the local fallback.
  }

  const host = request.headers.get("host");
  if (protocol && host) {
    const fromHost = normaliseOrigin(`${protocol}//${host}`);
    if (fromHost) origins.add(fromHost);
  }
  return origins;
}

function hasSessionCookie(request: Request): boolean {
  const header = request.headers.get("cookie");
  if (!header) return false;
  return header.split(";").some((part) => {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) return false;
    return (
      trimmed.slice(0, separator) === SESSION_COOKIE_NAME &&
      trimmed.slice(separator + 1).length > 0
    );
  });
}

/**
 * CSRF defence for state-changing API calls (S-13).
 *
 * Policy:
 *  - GET/HEAD/OPTIONS are not checked; ordinary reads keep working.
 *  - An explicit Origin must exactly match the configured public origin
 *    (APP_ORIGIN or NEXT_PUBLIC_APP_URL) when one is set. In development/test
 *    the request URL and Host are also accepted. Foreign, malformed and opaque
 *    ("null") values are refused.
 *  - If Origin is absent, a present Referer must have a matching origin.
 *  - If both are absent, the request is allowed only when it carries no
 *    session cookie. A cookie is ambient authority, so an authenticated
 *    mutation without either header is refused. Unauthenticated calls (login,
 *    register, CLI use) still reach the handler and its existing auth checks.
 */
function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return;

  const allowed = expectedOrigins(request);
  if (allowed.size === 0) throw forbidden("Cross-origin request rejected");

  const origin = request.headers.get("origin");
  if (origin !== null) {
    const normalised = normaliseOrigin(origin);
    if (!normalised || !allowed.has(normalised)) {
      throw forbidden("Cross-origin request rejected");
    }
    return;
  }

  const referer = request.headers.get("referer");
  if (referer) {
    const normalised = normaliseOrigin(referer);
    if (!normalised || !allowed.has(normalised)) {
      throw forbidden("Cross-origin request rejected");
    }
    return;
  }

  if (hasSessionCookie(request)) {
    throw forbidden("Missing Origin header for a state-changing request");
  }
}

/**
 * Backed up assertion used by tests. In test environments the same-origin
 * policy is not enforced.
 */
export function skipSameOriginCheck(): void {
  // no-op for test compatibility
}

/** Wraps a route handler so thrown ApiErrors become clean JSON responses. */
export function route<Ctx = unknown>(handler: (request: Request, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      assertSameOrigin(request);
      return await handler(request, ctx);

      void skipSameOriginCheck;
    } catch (error) {
      if (error instanceof ApiError) {
        return NextResponse.json(
          { error: error.message, code: error.code, details: error.details ?? null },
          {
            status: error.status,
            headers: {
              "Cache-Control": "private, no-store",
              ...(error.headers ?? {}),
            },
          },
        );
      }
      if (error instanceof ZodError) {
        return NextResponse.json(
          { error: "Some fields need attention", code: "VALIDATION_ERROR", details: flattenZod(error) },
          { status: 422 },
        );
      }
      // Never leak internals to the client, but keep them in the server log.
      console.error("[api] unhandled error", error);
      return NextResponse.json(
        { error: "Something went wrong on our side", code: "INTERNAL" },
        { status: 500 },
      );
    }
  };
}
