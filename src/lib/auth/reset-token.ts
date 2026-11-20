import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { PrismaClient, Prisma } from "@prisma/client";

const SALT = process.env.RESET_TOKEN_SECRET ?? "sellflow-reset-token-dev-secret";

/**
 * Reset token module (S-09).
 *
 * Reset tokens are created in memory, then stored only as a salted SHA-256 hash.
 * The raw token is returned to the caller only once (when the request is made) and
 * is never written to the database, logs, or audit trail.
 */

export type ResetTokenRecord = {
  userId: string;
  hashedToken: string;
  expiresAt: Date;
};

function hashToken(raw: string): string {
  return createHash("sha256").update(`${raw}:${SALT}`).digest("hex");
}

/** Cryptographically random token, base64url, 32 bytes. */
export function createRawToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Invalidate every unused reset token for an account (S-09).
 *
 * Called before a new token is issued so only one reset link can ever be active
 * for an account. Accepts the shared client or an interactive transaction client
 * so invalidation and issuance can share one commit.
 */
export async function invalidateUnusedResetTokens(
  userId: string,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<void> {
  await client.passwordResetToken.updateMany({
    where: { userId, used: false },
    data: { used: true },
  });
}

/**
 * Create a reset token for an account.
 *
 * Returns the raw token (one-time use) and the created database row. The raw token
 * is intended to be included in a reset link or message and then discarded by the
 * caller; it is never logged or persisted.
 */
export async function createResetToken(
  userId: string,
  expiresInMs = 60 * 60 * 1000,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<{ rawToken: string; record: ResetTokenRecord }> {
  const rawToken = createRawToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiresInMs);

  const record = await client.passwordResetToken.create({
    data: {
      userId,
      hashedToken: hashToken(rawToken),
      expiresAt,
    },
  });

  return { rawToken, record: { userId, hashedToken: record.hashedToken, expiresAt } };
}

/**
 * Look up a reset token by its raw value.
 *
 * Returns null for any failure mode so the reset-request path can stay
 * enumeration-resistant in the normal case. Invalid, expired, and used tokens are
 * all treated as "not found" at this layer.
 */
export async function findResetToken(
  rawToken: string,
): Promise<ResetTokenRecord | null> {
  if (!rawToken || typeof rawToken !== "string") return null;

  const hashedToken = hashToken(rawToken);
  const token = await prisma.passwordResetToken.findUnique({
    where: { hashedToken },
    include: { user: { select: { id: true } } },
  });

  if (!token) return null;
  if (token.userId !== token.user.id) return null;
  if (token.used) return null;
  if (new Date() > token.expiresAt) return null;

  return {
    userId: token.userId,
    hashedToken: token.hashedToken,
    expiresAt: token.expiresAt,
  };
}

/**
 * Mark a reset token as used in the same transaction used for password reset.
 *
 * A token can be marked used at most once.
 *
 * Accepts either the shared client or an interactive transaction client so token
 * consumption can commit atomically with the password update.
 */
export async function consumeResetToken(
  hashedToken: string,
  client: PrismaClient | Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const result = await client.passwordResetToken.updateMany({
    where: { hashedToken, used: false },
    data: { used: true },
  });

  return result.count > 0;
}
