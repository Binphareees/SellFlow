import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * Either the shared client or an interactive transaction client. Revocation that
 * must be atomic with a privilege change takes the caller's transaction, so the
 * two writes commit or roll back together (S-14 final review).
 */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Session revocation and inventory primitives (S-14).
 *
 * Kept separate from `session.ts` so domain services can revoke without
 * importing the cookie/request layer. Every function is scoped by the caller's
 * own user id; nothing here accepts a client-supplied account.
 */

/** How long dead session rows are kept before pruning, for forensic review. */
export const SESSION_RETENTION_MS = 30 * 86_400_000;

/** Revokes a single token presented by the client (login rotation, logout). */
export async function revokeSessionByToken(tokenHash: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Revokes every live session of an account. Returns the number revoked.
 *
 * Pass `client` to make this share a transaction with the privilege change it
 * accompanies: a failure then rolls both back, so a superseded token can never
 * outlive the change that should have ended it.
 */
export async function revokeAllSessionsForUser(
  userId: string,
  client: Db = prisma,
): Promise<number> {
  const result = await client.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Revokes every session of the account except the one making the request. */
export async function revokeOtherSessionsForUser(
  userId: string,
  currentSessionId: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, id: { not: currentSessionId } },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Revokes one session the caller owns. Sessions of other accounts are treated
 * as missing, so the endpoint cannot be used to probe or disturb them.
 */
export async function revokeOwnedSession(
  userId: string,
  sessionId: string,
): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count > 0;
}

export type SessionSummary = {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  userAgent: string | null;
  ipHash: string | null;
};

/** Lists the account's live sessions. Never returns token material. */
export async function listSessionsForUser(
  userId: string,
): Promise<SessionSummary[]> {
  return prisma.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      userAgent: true,
      ipHash: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Bounded cleanup of dead rows. Runs opportunistically (on login) because this
 * deployment has no scheduler; the limit keeps a bulk delete from locking
 * SQLite behind a request.
 */
export async function pruneSessions(limit = 50): Promise<number> {
  const cutoff = new Date(Date.now() - SESSION_RETENTION_MS);
  const dead = await prisma.session.findMany({
    where: {
      OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }],
    },
    select: { id: true },
    take: limit,
  });
  if (dead.length === 0) return 0;
  const result = await prisma.session.deleteMany({
    where: { id: { in: dead.map((row) => row.id) } },
  });
  return result.count;
}
