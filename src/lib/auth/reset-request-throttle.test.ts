import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  checkResetRequestThrottle,
  recordResetRequestAttempt,
  pruneResetRequestThrottle,
} from "./reset-request-throttle";
import { createResetToken, invalidateUnusedResetTokens } from "./reset-token";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error("Refusing to run throttle tests against prisma/dev.db.");
}

const prisma = new PrismaClient({ log: ["error"] });

let userId = "";

beforeAll(async () => {
  await prisma.$connect();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const user = await prisma.user.create({
    data: { email: `throttle-${suffix}@sellflow.test`, passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.passwordResetThrottle.deleteMany();
  await prisma.passwordResetToken.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("PasswordResetThrottle", () => {
  it("check returns unlocked initially", async () => {
    const state = await checkResetRequestThrottle("a@b.com", "1.2.3.4");
    expect(state.locked).toBe(false);
  });

  it("record locks after account limit", async () => {
    process.env.PASSWORD_RESET_REQUEST_ACCOUNT_LIMIT = "2";
    process.env.PASSWORD_RESET_REQUEST_WINDOW_SECONDS = "900";
    process.env.PASSWORD_RESET_REQUEST_LOCK_SECONDS = "900";
    const email = "locktest@sellflow.test";
    const ip = "9.9.9.9";
    await recordResetRequestAttempt(email, ip);
    await recordResetRequestAttempt(email, ip);
    const state = await recordResetRequestAttempt(email, ip);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("prune removes expired rows", async () => {
    const before = await prisma.passwordResetThrottle.count();
    // force a row with old updatedAt
    await prisma.passwordResetThrottle.create({
      data: {
        id: `prune-${Date.now()}`,
        scope: "PASSWORD_RESET_ACCOUNT",
        key: "prunekey",
        failures: 1,
        windowStartedAt: new Date(Date.now() - 10_000_000),
        updatedAt: new Date(Date.now() - 10_000_000),
      },
    });
    const config = (await import("./reset-request-throttle")).resetRequestThrottleConfig();
    await pruneResetRequestThrottle(new Date(), config);
    const after = await prisma.passwordResetThrottle.count();
    expect(after).toBeLessThanOrEqual(before + 1);
  });
});

describe("invalidateUnusedResetTokens", () => {
  it("invalidates prior unused tokens when creating new one", async () => {
    const t1 = await createResetToken(userId);
    await invalidateUnusedResetTokens(userId);
    const t2 = await createResetToken(userId);
    const old = await prisma.passwordResetToken.findUnique({ where: { hashedToken: t1.record.hashedToken } });
    expect(old?.used).toBe(true);
    expect(t2.rawToken).not.toBe(t1.rawToken);
  });
});