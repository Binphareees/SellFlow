import { createHash } from "node:crypto";

/**
 * The server-side secret used to salt session tokens, IP hashes and throttle
 * keys. Production refuses to run without one.
 */
export function authSecret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 16) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set in production");
    }
    return "sellflow-development-secret";
  }
  return value;
}

/** Salted, deterministic hash for non-secret identifiers (emails, IPs). */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(`${value}:${authSecret()}`).digest("hex");
}

/** Salted hash of an already-validated IP, never the raw address. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`${ip}:${authSecret()}`).digest("hex").slice(0, 32);
}
