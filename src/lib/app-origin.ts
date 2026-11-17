import { NextRequest } from "next/server";

/**
 * Trusted application origin for password-reset links and other account-facing URLs.
 *
 * Reset links must be built from a configured, trusted origin rather than from the
 * request Host header or X-Forwarded-* headers, which can be set by a client or
 * a misconfigured proxy.
 *
 * When APP_ORIGIN or NEXT_PUBLIC_APP_URL is configured, only that origin is used.
 * In local development, fall back to the request URL so password-reset flows can be
 * tested against localhost.
 */

function normalise(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}

export function applicationOrigin(request: NextRequest | Request): string | null {
  const configured =
    normalise(process.env.APP_ORIGIN) ?? normalise(process.env.NEXT_PUBLIC_APP_URL);

  if (configured) return configured;

  if (process.env.NODE_ENV === "production") return null;

  try {
    const url = new URL(request.url);
    return url.origin === "null" ? null : url.origin;
  } catch {
    return null;
  }
}
