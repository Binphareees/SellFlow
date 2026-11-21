import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  checkLoginThrottle,
  recordLoginFailure,
  clearLoginFailures,
} from "./throttle";
import { POST as login } from "@/app/api/auth/login/route";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error("Refusing to run login-throttle tests against prisma/dev.db.");
}

const prisma = new PrismaClient({ log: ["error"] });

beforeAll(async () => {
  await prisma.$connect();
  // Deterministic, short thresholds.
  process.env.MAX_AUTH_ATTEMPTS = "2";
  process.env.MAX_AUTH_IP_ATTEMPTS = "3";
  process.env.AUTH_ATTEMPT_WINDOW_SECONDS = "900";
  process.env.AUTH_LOCKOUT_SECONDS = "900";
});

afterAll(async () => {
  await prisma.loginThrottle.deleteMany();
  await prisma.$disconnect();
});

describe("S-05 login throttle", () => {
  it("unlocked prior to threshold", async () => {
    const email = `unlocked-${Date.now()}@sellflow.test`;
    const state = await checkLoginThrottle(email, "10.0.0.1");
    expect(state.locked).toBe(false);
    expect(state.retryAfterSeconds).toBe(0);
  });

  it("locks account once threshold reached with positive Retry-After", async () => {
    const email = `lockacct-${Date.now()}@sellflow.test`;
    const ip = "10.0.0.2";
    await recordLoginFailure(email, ip);
    const state = await recordLoginFailure(email, ip);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("IP ceiling enforced across distinct target accounts", async () => {
    const ip = "10.0.0.3";
    const base = Date.now();
    // MAX_AUTH_IP_ATTEMPTS = 3; three failures across distinct accounts
    await recordLoginFailure(`a-${base}@sellflow.test`, ip);
    await recordLoginFailure(`b-${base}@sellflow.test`, ip);
    const state = await recordLoginFailure(`c-${base}@sellflow.test`, ip);
    expect(state.locked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("clearLoginFailures resets account counter", async () => {
    const email = `clear-${Date.now()}@sellflow.test`;
    const ip = "10.0.0.4";
    await recordLoginFailure(email, ip);
    await clearLoginFailures(email);
    const state = await checkLoginThrottle(email, ip);
    // Account lock cleared; IP may still be clear too.
    expect(state.locked).toBe(false);
  });

  it("route returns 429 + Retry-After when locked", async () => {
    const email = `route-${Date.now()}@sellflow.test`;
    const ip = "10.0.0.5";
    // Lock the account.
    await recordLoginFailure(email, ip);
    await recordLoginFailure(email, ip);

    const req = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email, password: "wrong" }),
    });
    const res = await login(req, {} as any);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const retry = Number(res.headers.get("Retry-After"));
    expect(retry).toBeGreaterThan(0);
  });
});
