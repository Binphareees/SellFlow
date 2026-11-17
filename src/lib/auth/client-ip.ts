import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

/**
 * Explicit trusted-proxy contract (S-05).
 *
 * Forwarding headers are ignored unless BOTH conditions hold:
 *   1. TRUSTED_PROXY_SECRET is configured on the server, and
 *   2. the request carries x-sellflow-trusted-proxy with that exact value.
 *
 * The proxy must overwrite (or strip and append) the forwarding headers before
 * they reach the app. This app supports one trusted proxy hop.
 */
const TRUSTED_PROXY_HEADER = "x-sellflow-trusted-proxy";

function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validates an IPv4/IPv6 literal and returns a canonical form. Arbitrary text
 * is never accepted. IPv6 is expanded so different spellings of the same
 * address cannot be used to create fresh throttle keys.
 */
export function normaliseIp(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const family = isIP(trimmed);
  if (family === 4) return trimmed;
  if (family === 6) return canonicalIpv6(trimmed);
  return null;
}

function canonicalIpv6(value: string): string | null {
  const input = value.toLowerCase();
  // Zone identifiers are ambiguous across hosts; reject rather than guess.
  if (input.includes("%")) return null;

  const firstDouble = input.indexOf("::");
  if (firstDouble !== -1 && input.indexOf("::", firstDouble + 2) !== -1) return null;
  const leftRaw = firstDouble === -1 ? input : input.slice(0, firstDouble);
  const rightRaw = firstDouble === -1 ? "" : input.slice(firstDouble + 2);

  const parseSide = (side: string): string[] | null => {
    if (side === "") return [];
    const parts = side.split(":");
    const out: string[] = [];
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) return null;
      if (part.includes(".")) {
        if (index !== parts.length - 1) return null;
        const octets = part.split(".");
        if (octets.length !== 4) return null;
        const numbers = octets.map((octet) => (/^\d{1,3}$/.test(octet) ? Number(octet) : NaN));
        if (numbers.some((number) => !Number.isInteger(number) || number < 0 || number > 255)) {
          return null;
        }
        out.push(((numbers[0] << 8) | numbers[1]).toString(16));
        out.push(((numbers[2] << 8) | numbers[3]).toString(16));
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        out.push(parseInt(part, 16).toString(16));
      }
    }
    return out;
  };

  const left = parseSide(leftRaw);
  const right = parseSide(rightRaw);
  if (!left || !right) return null;
  const total = left.length + right.length;

  let groups: string[];
  if (firstDouble === -1) {
    if (total !== 8) return null;
    groups = left;
  } else {
    if (total >= 8) return null;
    groups = [...left, ...Array<string>(8 - total).fill("0"), ...right];
  }
  return groups.join(":");
}

/**
 * Returns the validated client IP, or null when no trusted proxy supplied one.
 * The rightmost X-Forwarded-For entry is used: with one trusted proxy that is
 * the address the proxy actually saw. Values further left may be client-sent.
 * If the rightmost value is not a valid IP, the result is null; it never falls
 * back to an attacker-supplied left-hand value.
 */
export function clientIp(request: Request): string | null {
  const expected = process.env.TRUSTED_PROXY_SECRET;
  if (!expected) return null;
  if (!secretMatches(request.headers.get(TRUSTED_PROXY_HEADER), expected)) return null;

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded !== null) {
    const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    return normaliseIp(parts[parts.length - 1]);
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp !== null) return normaliseIp(realIp);
  return null;
}
