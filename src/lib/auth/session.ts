import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { unauthorized } from "@/lib/api";
import type { Role } from "@/lib/enums";
import { authSecret, hashIp } from "./identifiers";
import { clientIp, normaliseIp } from "./client-ip";
import { revokeSessionByToken, type Db } from "./revocation";

export { hashIp, clientIp };

export const SESSION_COOKIE = "sf_session";

// Absolute lifetime: 30 days by default, configurable within 1–90 (S-14).
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const MIN_SESSION_DAYS = 1;
const MAX_SESSION_DAYS = 90;

// Idle lifetime: 7 days, configurable within 1–30 and never beyond the absolute
// deadline (S-14).
const DEFAULT_SESSION_IDLE_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_SESSION_IDLE_DAYS = 30;

// An active session writes lastUsedAt at most this often, so ordinary reads do
// not turn into a database write each (S-14).
const TOUCH_INTERVAL_MS = 5 * 60_000;

function positiveDays(value: string | undefined): number | null {
  const days = Number(value);
  if (!Number.isFinite(days) || days <= 0) return null;
  return Math.floor(days);
}

/** Absolute lifetime, clamped so a misconfiguration cannot mint a decade-long session. */
export function sessionTtlMs(): number {
  const days = positiveDays(process.env.SESSION_MAX_AGE_DAYS);
  if (days === null) return DEFAULT_SESSION_TTL_MS;
  return Math.min(Math.max(days, MIN_SESSION_DAYS), MAX_SESSION_DAYS) * 86_400_000;
}

/** Idle lifetime, never longer than the absolute lifetime. */
export function sessionIdleMs(): number {
  const days = positiveDays(process.env.SESSION_IDLE_DAYS);
  const idleMs = days === null ? DEFAULT_SESSION_IDLE_MS : days * 86_400_000;
  return Math.min(idleMs, MAX_SESSION_IDLE_DAYS * 86_400_000, sessionTtlMs());
}

/**
 * Session tokens are random and stored only as a salted SHA-256 digest, so a
 * database leak cannot be replayed as a login.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(`${token}:${authSecret()}`).digest("hex");
}

/**
 * Salted hash of the caller's validated IP for abuse forensics, never the raw
 * address. Forwarding headers are only consulted when a trusted proxy is
 * explicitly configured; see client-ip.ts.
 */
export function clientIpHash(request: Request): string | null {
  return hashIp(clientIp(request));
}

/** Metadata recorded with a session; never used as an authentication factor. */
export function sessionMeta(request: Request): {
  userAgent: string | null;
  ip: string | null;
} {
  return { userAgent: request.headers.get("user-agent"), ip: clientIp(request) };
}

export type AuthContext = {
  sessionId: string;
  user: {
    id: string;
    email: string;
    isPlatformAdmin: boolean;
    emailVerifiedAt: Date | null;
  };
  profile: {
    id: string;
    displayName: string;
    phone: string | null;
    verificationTier: number;
    country: string;
  };
  roles: Role[];
  workspaceId: string | null;
  supplierProfileId: string | null;
};

export async function startSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
  client: Db = prisma,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionTtlMs());
  // Defence in depth: callers pass an already-validated IP, but never hash
  // arbitrary header text as though it were an address.
  const validatedIp = meta.ip ? normaliseIp(meta.ip) : null;

  await client.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      createdAt: now,
      lastUsedAt: now,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      ipHash: hashIp(validatedIp),
    },
  });

  return { token, expiresAt };
}

/**
 * Revokes every session of the account and issues a replacement. Used after a
 * security-sensitive privilege change so the old token cannot be replayed;
 * callers must apply the returned cookie only after this resolves (S-14).
 *
 * Pass `client` to run the revocation and the replacement insert inside the same
 * transaction as the privilege change: either the old token is retired and a new
 * one exists, or nothing changed at all.
 */
export async function rotateSessionForUser(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
  client: Db = prisma,
): Promise<{ token: string; expiresAt: Date }> {
  await client.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return startSession(userId, meta, client);
}

/** Attaches the session cookie. Same-origin only, never readable by JS. */
export function applySessionCookie(response: NextResponse, token: string, expiresAt: Date): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function revokeCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;
  await revokeSessionByToken(hashToken(token));
}

/**
 * Resolves the signed-in account for this request. Returns null when there is no
 * valid session, so public marketplace pages can render for guests.
 *
 * A session is valid only while it is unrevoked, before its absolute deadline,
 * and within the idle window. Activity refreshes `lastUsedAt` at most once every
 * five minutes; it never extends `expiresAt`.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      user: {
        include: {
          profile: {
            include: {
              roles: { select: { role: true } },
              ownedWorkspace: { select: { id: true } },
              supplierProfile: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (!session) return null;

  const now = Date.now();
  if (session.revokedAt || session.expiresAt.getTime() <= now) return null;
  if (session.lastUsedAt.getTime() + sessionIdleMs() <= now) return null;
  if (session.user.disabledAt || !session.user.profile) return null;

  // Conditional so parallel requests cannot race into repeated writes: only the
  // first caller after the interval finds a row older than the threshold.
  if (now - session.lastUsedAt.getTime() >= TOUCH_INTERVAL_MS) {
    try {
      await prisma.session.updateMany({
        where: { id: session.id, lastUsedAt: { lt: new Date(now - TOUCH_INTERVAL_MS) } },
        data: { lastUsedAt: new Date(now) },
      });
    } catch (error) {
      // Losing the activity marker must not sign anyone out; the idle clock
      // simply keeps its previous value.
      console.error("[session] failed to refresh lastUsedAt", error);
    }
  }

  const { user } = session;
  const profile = user.profile!;

  return {
    sessionId: session.id,
    user: {
      id: user.id,
      email: user.email,
      isPlatformAdmin: user.isPlatformAdmin,
      emailVerifiedAt: user.emailVerifiedAt,
    },
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      phone: profile.phone,
      verificationTier: profile.verificationTier,
      country: profile.country,
    },
    roles: profile.roles.map((r) => r.role as Role),
    workspaceId: profile.ownedWorkspace?.id ?? null,
    supplierProfileId: profile.supplierProfile?.id ?? null,
  };
}

/** For any route or page that must not render without a session. */
export async function requireAuth(): Promise<AuthContext> {
  const ctx = await getAuthContext();
  if (!ctx) throw unauthorized();
  return ctx;
}
