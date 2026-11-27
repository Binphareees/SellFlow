import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const ORIGINAL_FROM = process.env.RESEND_FROM_EMAIL;

async function readHealth() {
  const response = await GET();
  return { response, body: (await response.json()) as Record<string, unknown> };
}

describe("GET /api/health — email configuration", () => {
  afterEach(() => {
    process.env.RESEND_FROM_EMAIL = ORIGINAL_FROM;
  });

  it("reports email.configured true when the sender config is complete", async () => {
    const { body } = await readHealth();
    expect(body.email).toEqual({ configured: true });
  });

  it("reports email.configured false while leaving the HTTP status semantics alone", async () => {
    delete process.env.RESEND_FROM_EMAIL;

    const { response, body } = await readHealth();
    const database = body.database as { status: string };

    expect(body.email).toEqual({ configured: false });
    // Same rule as before T1: the database decides 200 vs 503, nothing else.
    expect(response.status).toBe(database.status === "up" ? 200 : 503);
  });

  it("never returns a secret value or a secret variable name", async () => {
    const { body } = await readHealth();
    const serialized = JSON.stringify(body);

    expect(serialized).not.toContain(process.env.RESEND_API_KEY ?? "re_testkey_notarealkey");
    expect(serialized).not.toMatch(/RESEND_/);
    expect(serialized).not.toContain("apiKey");
  });
});
