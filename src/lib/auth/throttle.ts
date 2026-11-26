import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashIdentifier } from "./identifiers";

const ACCOUNT_SCOPE = "ACCOUNT";
const IP_SCOPE = "IP";
const REGISTRATION_IP_SCOPE = "REGISTRATION_IP";

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

/**
 * Sign-in abuse policy. Defaults are deliberately short and bounded: a locked
 * account becomes usable again after 15 minutes without operator action, and
 * the window/retention caps prevent an attacker from creating permanent state.
 *
 * MAX_AUTH_ATTEMPTS is the existing documented setting; the IP ceiling is
 * higher so a shared office/NAT address is not locked as quickly as one account.
 */
export function throttleConfig(): ThrottleConfig {
  const windowMs =
    Math.min(positiveInt(process.env.AUTH_ATTEMPT_WINDOW_SECONDS, 900), 86_400) * 1000;
  const lockMs =
    Math.min(positiveInt(process.env.AUTH_LOCKOUT_SECONDS, 900), 86_400) * 1000;
  // Never prune a row before its lock or window can have expired.
  const retentionMs = Math.max(
    positiveInt(process.env.AUTH_THROTTLE_RETENTION_SECONDS, 86_400) * 1000,
    lockMs,
    windowMs,
  );
  return {
    accountLimit: positiveInt(process.env.MAX_AUTH_ATTEMPTS, 5),
    ipLimit: positiveInt(process.env.MAX_AUTH_IP_ATTEMPTS, 20),
    windowMs,
    lockMs,
    retentionMs,
    maxRows: positiveInt(process.env.AUTH_THROTTLE_MAX_ROWS, 50_000),
  };
}

/** Case and surrounding whitespace must never create a fresh throttle key. */
export function normaliseAccountIdentity(email: string): string {
  return email.trim().toLowerCase();
}

function accountKey(email: string): string {
  return hashIdentifier(`account:${normaliseAccountIdentity(email)}`);
}

function ipKey(ip: string): string {
  return hashIdentifier(`ip:${ip}`);
}

function stateFromRetryAfter(retryAfterSeconds: number): ThrottleState {
  if (retryAfterSeconds <= 0) return { locked: false, retryAfterSeconds: 0 };
  return { locked: true, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
}

/**
 * Reads the current state. Locked rows are returned without touching them, so
 * an attacker cannot extend a lock by continuing to hammer a locked account.
 */
export async function checkLoginThrottle(
  email: string,
  ip: string | null,
): Promise<ThrottleState> {
  const now = Date.now();
  const keys = [{ scope: ACCOUNT_SCOPE, key: accountKey(email) }];
  if (ip) keys.push({ scope: IP_SCOPE, key: ipKey(ip) });

  const rows = await prisma.loginThrottle.findMany({
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

/**
 * Atomically increments the account and (when available) IP counters. SQLite's
 * INSERT ... ON CONFLICT ... DO UPDATE is a single statement per key, so
 * concurrent attempts cannot lose increments. The same statement resets an
 * expired window and sets lockedUntil exactly when the limit is reached.
 */
export async function recordLoginFailure(
  email: string,
  ip: string | null,
): Promise<ThrottleState> {
  const now = new Date();
  const config = throttleConfig();
  const windowStart = new Date(now.getTime() - config.windowMs);
  const lockUntil = new Date(now.getTime() + config.lockMs);

  const targets: Array<{ scope: string; key: string; limit: number }> = [
    { scope: ACCOUNT_SCOPE, key: accountKey(email), limit: config.accountLimit },
  ];
  if (ip) targets.push({ scope: IP_SCOPE, key: ipKey(ip), limit: config.ipLimit });

  let retryAfterSeconds = 0;
  for (const target of targets) {
    const row = await withSqliteRetry(() =>
      upsertFailure(target, now, windowStart, lockUntil),
    );
    if (row?.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000),
      );
    }
  }

  // Cleanup must never turn a failed login into a 500.
  try {
    await pruneThrottle(now, config);
  } catch (error) {
    console.error("[auth] throttle cleanup failed", error);
  }

  return stateFromRetryAfter(retryAfterSeconds);
}

/**
 * A successful sign-in clears the account counter. IP counters are intentionally
 * not cleared: they represent aggregate behaviour from one source, and letting a
 * single valid account reset them would defeat password-spraying protection.
 */
export async function clearLoginFailures(email: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({
    where: { scope: ACCOUNT_SCOPE, key: accountKey(email) },
  });
}

/**
 * Registration throttle. Uses the same LoginThrottle table and atomic upsert
 * as sign-in, with a separate scope so a burst of sign-up attempts from one
 * source cannot consume or reset sign-in counters.
 */
export async function checkRegistrationThrottle(
  ip: string | null,
): Promise<ThrottleState> {
  if (!ip) return stateFromRetryAfter(0);
  const now = Date.now();
  const row = await prisma.loginThrottle.findUnique({
    where: {
      scope_key: { scope: REGISTRATION_IP_SCOPE, key: ipKey(ip) },
    },
    select: { lockedUntil: true },
  });
  if (row?.lockedUntil && row.lockedUntil.getTime() > now) {
    return stateFromRetryAfter(Math.ceil((row.lockedUntil.getTime() - now) / 1000));
  }
  return stateFromRetryAfter(0);
}

export async function recordRegistrationAttempt(
  ip: string | null,
): Promise<ThrottleState> {
  if (!ip) return stateFromRetryAfter(0);
  const now = new Date();
  const config = throttleConfig();
  const windowStart = new Date(now.getTime() - config.windowMs);
  const lockUntil = new Date(now.getTime() + config.lockMs);
  // Sign-ups legitimately cluster on shared mobile and market networks, so the
  // default is far higher than the per-account sign-in limit.
  const limit = positiveInt(process.env.MAX_REGISTRATION_IP_ATTEMPTS, 30);

  const row = await withSqliteRetry(() =>
    upsertFailure(
      { scope: REGISTRATION_IP_SCOPE, key: ipKey(ip), limit },
      now,
      windowStart,
      lockUntil,
    ),
  );

  try {
    await pruneThrottle(now, config);
  } catch (error) {
    console.error("[auth] registration throttle cleanup failed", error);
  }

  if (row?.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
    return stateFromRetryAfter(
      Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000),
    );
  }
  return stateFromRetryAfter(0);
}

async function upsertFailure(
  target: { scope: string; key: string; limit: number },
  now: Date,
  windowStart: Date,
  lockUntil: Date,
): Promise<ThrottleRow | null> {
  const rows = await prisma.$queryRaw<ThrottleRow[]>`
    INSERT INTO "LoginThrottle" ("id", "scope", "key", "failures", "windowStartedAt", "lockedUntil", "updatedAt")
    VALUES (${randomUUID()}, ${target.scope}, ${target.key}, 1, ${now}, NULL, ${now})
    ON CONFLICT("scope", "key") DO UPDATE SET
      "failures" = CASE
        WHEN "LoginThrottle"."windowStartedAt" <= ${windowStart} THEN 1
        ELSE "LoginThrottle"."failures" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "LoginThrottle"."windowStartedAt" <= ${windowStart} THEN ${now}
        ELSE "LoginThrottle"."windowStartedAt"
      END,
      "lockedUntil" = CASE
        WHEN "LoginThrottle"."lockedUntil" IS NOT NULL AND "LoginThrottle"."lockedUntil" > ${now}
          THEN "LoginThrottle"."lockedUntil"
        WHEN (
          CASE WHEN "LoginThrottle"."windowStartedAt" <= ${windowStart}
            THEN 1 ELSE "LoginThrottle"."failures" + 1 END
        ) >= ${target.limit}
          THEN ${lockUntil}
        ELSE "LoginThrottle"."lockedUntil"
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
      const transient = /SQLITE_BUSY|database is locked|P2034|P2028/i.test(message);
      if (!transient || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
  throw lastError;
}

/** Age-based cleanup plus a hard cap; active locks are removed last. */
async function pruneThrottle(now: Date, config: ThrottleConfig): Promise<void> {
  const cutoff = new Date(now.getTime() - config.retentionMs);
  await prisma.loginThrottle.deleteMany({ where: { updatedAt: { lt: cutoff } } });

  const total = await prisma.loginThrottle.count();
  const excess = total - config.maxRows;
  if (excess <= 0) return;

  const removable = await prisma.loginThrottle.findMany({
    where: { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    orderBy: { updatedAt: "asc" },
    take: excess,
    select: { id: true },
  });
  if (removable.length === 0) return;
  await prisma.loginThrottle.deleteMany({
    where: { id: { in: removable.map((row) => row.id) } },
  });
}
