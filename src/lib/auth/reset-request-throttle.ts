import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashIdentifier } from "./identifiers";
import { normaliseAccountIdentity } from "./throttle";

const ACCOUNT_SCOPE = "PASSWORD_RESET_ACCOUNT";
const IP_SCOPE = "PASSWORD_RESET_IP";

export type ThrottleState = {
  locked: boolean;
  retryAfterSeconds: number;
};

type ThrottleConfig = {
  accountLimit: number;
  ipLimit: number;
  windowMs: number;
  lockMs: number;
  retentionMs: number;
  maxRows: number;
};

type ThrottleRow = {
  failures: number;
  windowStartedAt: Date;
  lockedUntil: Date | null;
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function resetRequestThrottleConfig(): ThrottleConfig {
  const windowMs =
    Math.min(
      positiveInt(process.env.PASSWORD_RESET_REQUEST_WINDOW_SECONDS, 900),
      86_400,
    ) * 1000;
  const lockMs =
    Math.min(
      positiveInt(process.env.PASSWORD_RESET_REQUEST_LOCK_SECONDS, 900),
      86_400,
    ) * 1000;
  const retentionMs = Math.max(
    positiveInt(process.env.PASSWORD_RESET_REQUEST_RETENTION_SECONDS, 86_400) *
      1000,
    lockMs,
    windowMs,
  );
  return {
    accountLimit: positiveInt(
      process.env.PASSWORD_RESET_REQUEST_ACCOUNT_LIMIT,
      3,
    ),
    ipLimit: positiveInt(process.env.PASSWORD_RESET_REQUEST_IP_LIMIT, 10),
    windowMs,
    lockMs,
    retentionMs,
    maxRows: positiveInt(
      process.env.PASSWORD_RESET_REQUEST_MAX_ROWS,
      50_000,
    ),
  };
}

function accountKey(email: string): string {
  return hashIdentifier(
    `password_reset:account:${normaliseAccountIdentity(email)}`,
  );
}

function ipKey(ip: string): string {
  return hashIdentifier(`password_reset:ip:${ip}`);
}

function stateFromRetryAfter(retryAfterSeconds: number): ThrottleState {
  if (retryAfterSeconds <= 0) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
}

export async function checkResetRequestThrottle(
  email: string,
  ip: string | null,
): Promise<ThrottleState> {
  const now = Date.now();
  const keys = [{ scope: ACCOUNT_SCOPE, key: accountKey(email) }];
  if (ip) keys.push({ scope: IP_SCOPE, key: ipKey(ip) });

  const rows = await prisma.passwordResetThrottle.findMany({
    where: { OR: keys },
    select: { lockedUntil: true },
  });

  let retryAfterSeconds = 0;
  for (const row of rows) {
    if (row.lockedUntil && row.lockedUntil.getTime() > now) {
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        Math.ceil((row.lockedUntil.getTime() - now) / 1000),
      );
    }
  }
  return stateFromRetryAfter(retryAfterSeconds);
}

export async function recordResetRequestAttempt(
  email: string,
  ip: string | null,
): Promise<ThrottleState> {
  const now = new Date();
  const config = resetRequestThrottleConfig();
  const windowStart = new Date(now.getTime() - config.windowMs);
  const lockUntil = new Date(now.getTime() + config.lockMs);

  const targets: Array<{ scope: string; key: string; limit: number }> = [
    {
      scope: ACCOUNT_SCOPE,
      key: accountKey(email),
      limit: config.accountLimit,
    },
  ];
  if (ip) {
    targets.push({
      scope: IP_SCOPE,
      key: ipKey(ip),
      limit: config.ipLimit,
    });
  }

  let retryAfterSeconds = 0;
  for (const target of targets) {
    const row = await withSqliteRetry(() =>
      upsertAttempt(target, now, windowStart, lockUntil),
    );
    if (row?.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000),
      );
    }
  }

  try {
    await pruneResetRequestThrottle(now, config);
  } catch (error) {
    console.error("[auth] reset-request throttle cleanup failed", error);
  }

  return stateFromRetryAfter(retryAfterSeconds);
}

async function upsertAttempt(
  target: { scope: string; key: string; limit: number },
  now: Date,
  windowStart: Date,
  lockUntil: Date,
): Promise<ThrottleRow | null> {
  const rows = await prisma.$queryRaw<ThrottleRow[]>`
    INSERT INTO "PasswordResetThrottle" ("id", "scope", "key", "failures", "windowStartedAt", "lockedUntil", "updatedAt")
    VALUES (${randomUUID()}, ${target.scope}, ${target.key}, 1, ${now}, NULL, ${now})
    ON CONFLICT("scope", "key") DO UPDATE SET
      "failures" = CASE
        WHEN "PasswordResetThrottle"."windowStartedAt" <= ${windowStart} THEN 1
        ELSE "PasswordResetThrottle"."failures" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "PasswordResetThrottle"."windowStartedAt" <= ${windowStart} THEN ${now}
        ELSE "PasswordResetThrottle"."windowStartedAt"
      END,
      "lockedUntil" = CASE
        WHEN "PasswordResetThrottle"."lockedUntil" IS NOT NULL AND "PasswordResetThrottle"."lockedUntil" > ${now}
          THEN "PasswordResetThrottle"."lockedUntil"
        WHEN (
          CASE WHEN "PasswordResetThrottle"."windowStartedAt" <= ${windowStart}
            THEN 1 ELSE "PasswordResetThrottle"."failures" + 1 END
        ) > ${target.limit}
          THEN ${lockUntil}
        ELSE "PasswordResetThrottle"."lockedUntil"
      END,
      "updatedAt" = ${now}
    RETURNING "failures", "windowStartedAt", "lockedUntil"
  `;
  return rows[0] ?? null;
}

async function withSqliteRetry<T>(
  operation: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = /SQLITE_BUSY|database is locked|P2034|P2028/i.test(
        message,
      );
      if (!transient || attempt === attempts - 1) throw error;
      await new Promise((resolve) =>
        setTimeout(resolve, 15 * (attempt + 1)),
      );
    }
  }
  throw lastError;
}

async function pruneResetRequestThrottle(
  now: Date,
  config: ThrottleConfig,
): Promise<void> {
  const cutoff = new Date(now.getTime() - config.retentionMs);
  await prisma.passwordResetThrottle.deleteMany({
    where: { updatedAt: { lt: cutoff } },
  });

  const total = await prisma.passwordResetThrottle.count();
  const excess = total - config.maxRows;
  if (excess <= 0) return;

  const removable = await prisma.passwordResetThrottle.findMany({
    where: {
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    orderBy: { updatedAt: "asc" },
    take: excess,
    select: { id: true },
  });
  if (removable.length === 0) return;
  await prisma.passwordResetThrottle.deleteMany({
    where: { id: { in: removable.map((row) => row.id) } },
  });
}