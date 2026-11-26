import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { POST as register } from "@/app/api/auth/register/route";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error(
    "Refusing to run registration tests against prisma/dev.db. Point DATABASE_URL at a disposable database.",
  );
}

const prisma = new PrismaClient({ log: ["error"] });
const proxySecret = "register-test-proxy-secret";
const createdEmails: string[] = [];

beforeAll(async () => {
  await prisma.$connect();
  process.env.TRUSTED_PROXY_SECRET = proxySecret;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  await prisma.loginThrottle.deleteMany({ where: { scope: "REGISTRATION_IP" } });
  delete process.env.TRUSTED_PROXY_SECRET;
  delete process.env.MAX_REGISTRATION_IP_ATTEMPTS;
  await prisma.$disconnect();
});

function requestFor(email: string, ip: string): Request {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      "x-sellflow-trusted-proxy": proxySecret,
      "x-forwarded-for": ip,
    },
    body: JSON.stringify({
      email,
      password: "correct horse battery staple",
      displayName: "Test User",
      businessName: "Test Business",
    }),
  });
}

async function signUp(email: string, ip: string): Promise<Response> {
  createdEmails.push(email);
  return register(requestFor(email, ip), {} as never);
}

describe("registration hardening", () => {
  it("returns 429 with Retry-After on the N+1th attempt from one IP", async () => {
    process.env.MAX_REGISTRATION_IP_ATTEMPTS = "2";
    const ip = "203.0.113.10";
    const base = Date.now();

    const first = await signUp(`reg-one-${base}@example.com`, ip);
    const second = await signUp(`reg-two-${base}@example.com`, ip);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const third = await signUp(`reg-three-${base}@example.com`, ip);
    expect(third.status).toBe(429);
    const retryAfter = Number(third.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
  });

  it("gives one 201 and one 409 for concurrent sign-ups with one email", async () => {
    process.env.MAX_REGISTRATION_IP_ATTEMPTS = "20";
    const ip = "203.0.113.11";
    const email = `reg-race-${Date.now()}@example.com`;

    const [a, b] = await Promise.all([signUp(email, ip), signUp(email, ip)]);
    const statuses = [a.status, b.status].sort((left, right) => left - right);
    expect(statuses).toEqual([201, 409]);
    expect(statuses).not.toContain(500);
  });
});
