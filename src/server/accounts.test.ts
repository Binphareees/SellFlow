import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the database client is replaced: the duplicate-email mapping is what is
// under test, so the real registration logic runs unchanged. The factory is
// hoisted, so the stubs live in vi.hoisted (see the vitest mocking docs).
const db = vi.hoisted(() => ({ findUnique: vi.fn(), transaction: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: db.findUnique }, $transaction: db.transaction },
}));

import { registerAccount } from "./accounts";

const input = {
  email: "racer@example.com",
  password: "correct horse battery staple",
  displayName: "Test User",
  businessName: "Test Business",
};

describe("registerAccount duplicate-email handling", () => {
  beforeEach(() => {
    db.findUnique.mockReset();
    db.transaction.mockReset();
    db.findUnique.mockResolvedValue(null);
  });

  it("maps a UNIQUE constraint failure on the email to a 409 conflict", async () => {
    db.transaction.mockRejectedValue(new Error("UNIQUE constraint failed: User.email"));

    await expect(registerAccount(input as never)).rejects.toMatchObject({ status: 409 });
  });

  it("maps Prisma P2002 to a 409 conflict", async () => {
    db.transaction.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`email`)"), {
        code: "P2002",
      }),
    );

    await expect(registerAccount(input as never)).rejects.toMatchObject({ status: 409 });
  });

  it("rethrows a foreign-key constraint failure instead of claiming the email exists", async () => {
    const original = new Error(
      "SQLITE_CONSTRAINT_FOREIGNKEY: FOREIGN KEY constraint failed on the field: `profileId`",
    );
    db.transaction.mockRejectedValue(original);

    await expect(registerAccount(input as never)).rejects.toBe(original);
  });

  it("rethrows a NOT NULL constraint failure instead of claiming the email exists", async () => {
    const original = new Error(
      "SQLITE_CONSTRAINT_NOTNULL: NOT NULL constraint failed: BusinessWorkspace.ownerProfileId",
    );
    db.transaction.mockRejectedValue(original);

    await expect(registerAccount(input as never)).rejects.toBe(original);
  });
});
