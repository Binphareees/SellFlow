import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createResetToken, findResetToken, consumeResetToken } from "./reset-token";
import { hashPassword } from "./password";

describe("reset-token helpers", () => {
  let client: PrismaClient;

  beforeAll(async () => {
    client = new PrismaClient({ log: ["error"] });
    await client.$connect();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it("creates, looks up, and consumes a token", async () => {
    const password = "ResetTokenPassword1!";
    const user = await client.user.create({
      data: {
        email: `reset-token-user-${Date.now()}@sellflow.test`,
        passwordHash: await hashPassword(password),
      },
    });

    const { rawToken, record } = await createResetToken(user.id);

    expect(rawToken).toBeTruthy();
    expect(record.userId).toBe(user.id);

    const found = await findResetToken(rawToken);
    expect(found).toMatchObject({
      userId: user.id,
      hashedToken: record.hashedToken,
    });

    const consumed = await consumeResetToken(record.hashedToken);
    expect(consumed).toBe(true);

    const afterReuse = await findResetToken(rawToken);
    expect(afterReuse).toBeNull();
  });

  it("rejects an unknown token", async () => {
    expect(await findResetToken("unknown-token")).toBeNull();
  });
});
