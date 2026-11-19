import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { hashPassword, verifyPassword } from "./password";
import { createResetToken } from "./reset-token";
import { hashToken } from "./session";
import { auditCritical } from "@/lib/audit";
import { POST as resetPassword } from "@/app/api/auth/password-reset/reset/route";
import { POST as changePassword } from "@/app/api/auth/password/change/route";

// Regression tests for the S-09 P2028 defect: an audit write issued through the
// shared client while an interactive transaction held SQLite's write lock. The
// transaction then waited out its 5s timeout and the password update failed.
// These tests drive the real route handlers, so the old pattern fails here.

// The authenticated change route resolves its caller from the session cookie,
// which is not available outside a request scope. Only `requireAuth` is
// replaced; rotation and cookie helpers stay real.
const caller = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireAuth: async () => caller.auth,
  };
});

const databaseUrl = process.env.DATABASE_URL ?? "";
if (databaseUrl.includes("dev.db")) {
  throw new Error(
    "Refusing to run password-flow regression tests against prisma/dev.db. " +
      "Point DATABASE_URL at a disposable database.",
  );
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
    },
    body: JSON.stringify(body),
  });
}

describe("password reset and change transactions (S-09)", () => {
  let client: PrismaClient;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    client = new PrismaClient({ log: ["error"] });
    await client.$connect();
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      // Cascades remove profiles, sessions, reset tokens and audit rows.
      await client.user.deleteMany({ where: { id: { in: createdUserIds } } });
      await client.auditLog.deleteMany({
        where: { entityId: { in: createdUserIds } },
      });
    }
    await client.$disconnect();
  });

  async function makeUser(password: string, withProfile = false) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await client.user.create({
      data: {
        email: `password-flow-${suffix}@sellflow.test`,
        passwordHash: await hashPassword(password),
        ...(withProfile
          ? { profile: { create: { displayName: "Password Flow Test" } } }
          : {}),
      },
      include: { profile: true },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function makeSession(userId: string, token: string) {
    return client.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
  }

  it("completes a reset atomically, without a transaction timeout", async () => {
    const oldPassword = "OldResetPassword1!";
    const newPassword = "NewResetPassword2!";
    const user = await makeUser(oldPassword);
    const liveSession = await makeSession(user.id, `reset-session-${user.id}`);
    const { rawToken } = await createResetToken(user.id);

    const started = Date.now();
    const response = await resetPassword(
      post("/api/auth/password-reset/reset", { token: rawToken, password: newPassword }),
      undefined,
    );
    const elapsedMs = Date.now() - started;

    // The old implementation answered 500 here after a P2028 timeout.
    expect(response.status).toBe(200);
    expect(elapsedMs).toBeLessThan(5000);

    const stored = await client.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(newPassword, stored.passwordHash)).toBe(true);
    expect(await verifyPassword(oldPassword, stored.passwordHash)).toBe(false);

    const token = await client.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(token.used).toBe(true);

    const session = await client.session.findUniqueOrThrow({ where: { id: liveSession.id } });
    expect(session.revokedAt).not.toBeNull();

    const auditRows = await client.auditLog.count({
      where: { action: "auth.password_reset", entityId: user.id },
    });
    expect(auditRows).toBe(1);

    // One-time use: the same token cannot be replayed.
    const replay = await resetPassword(
      post("/api/auth/password-reset/reset", { token: rawToken, password: "AnotherPassword3!" }),
      undefined,
    );
    expect(replay.status).toBe(401);
    expect(
      await client.auditLog.count({
        where: { action: "auth.password_reset", entityId: user.id },
      }),
    ).toBe(1);
  }, 20_000);

  it("changes an authenticated password and rotates the session atomically", async () => {
    const oldPassword = "OldChangePassword1!";
    const newPassword = "NewChangePassword2!";
    const user = await makeUser(oldPassword, true);
    const currentSession = await makeSession(user.id, `change-current-${user.id}`);
    const otherSession = await makeSession(user.id, `change-other-${user.id}`);

    caller.auth = {
      sessionId: currentSession.id,
      user: {
        id: user.id,
        email: user.email,
        isPlatformAdmin: false,
        emailVerifiedAt: null,
      },
      profile: { id: user.profile!.id, displayName: "Password Flow Test" },
      roles: [],
      workspaceId: null,
      supplierProfileId: null,
    };

    const started = Date.now();
    const response = await changePassword(
      post("/api/auth/password/change", {
        currentPassword: oldPassword,
        newPassword,
      }),
      undefined,
    );
    const elapsedMs = Date.now() - started;

    // The old implementation answered 500 here after a P2028 timeout.
    expect(response.status).toBe(200);
    expect(elapsedMs).toBeLessThan(5000);
    expect(response.headers.get("set-cookie")).toContain("sf_session=");

    const stored = await client.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(newPassword, stored.passwordHash)).toBe(true);
    expect(await verifyPassword(oldPassword, stored.passwordHash)).toBe(false);

    for (const sessionId of [currentSession.id, otherSession.id]) {
      const session = await client.session.findUniqueOrThrow({ where: { id: sessionId } });
      expect(session.revokedAt).not.toBeNull();
    }

    // The replacement session is created in the same transaction.
    const liveSessions = await client.session.count({
      where: { userId: user.id, revokedAt: null },
    });
    expect(liveSessions).toBe(1);

    expect(
      await client.auditLog.count({
        where: { action: "auth.password_changed", entityId: user.id },
      }),
    ).toBe(1);
  }, 20_000);

  it("discards an audit row written through the transaction client on rollback", async () => {
    const entityId = `abort-${Date.now()}`;

    await expect(
      client.$transaction(async (tx) => {
        await auditCritical(
          {
            action: "test.password_flow_abort",
            entityType: "User",
            entityId,
          },
          { client: tx },
        );
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");

    expect(
      await client.auditLog.count({
        where: { action: "test.password_flow_abort", entityId },
      }),
    ).toBe(0);
  });
});
