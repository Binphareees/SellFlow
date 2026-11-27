import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const original = {
  nodeEnv: process.env.NODE_ENV,
  runtime: process.env.NEXT_RUNTIME,
  secret: process.env.TRUSTED_PROXY_SECRET,
};

// @types/node marks NODE_ENV readonly; the value is writable at runtime.
const env = process.env as Record<string, string | undefined>;

function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete env[name];
  else env[name] = value;
}

beforeEach(() => {
  setEnv("NODE_ENV", "production");
  setEnv("NEXT_RUNTIME", "nodejs");
  setEnv("TRUSTED_PROXY_SECRET", undefined);
});

afterEach(() => {
  setEnv("NODE_ENV", original.nodeEnv);
  setEnv("NEXT_RUNTIME", original.runtime);
  setEnv("TRUSTED_PROXY_SECRET", original.secret);
  vi.restoreAllMocks();
});

async function startupLines(): Promise<string[]> {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await register();
  const lines = error.mock.calls.map((call) => String(call[0]));
  error.mockRestore();
  return lines;
}

describe("instrumentation — trusted proxy startup warning", () => {
  it("warns that IP throttling is off when no trusted proxy secret is configured", async () => {
    const lines = await startupLines();
    const warning = lines.find((line) => /trusted proxy/i.test(line));

    expect(warning).toBeDefined();
    expect(warning ?? "").toMatch(/throttl/i);
    // Same rule as the email warning: no variable name, no value.
    expect(warning ?? "").not.toContain("TRUSTED_PROXY_SECRET");
  });

  it("stays quiet about the proxy when a secret is configured", async () => {
    setEnv("TRUSTED_PROXY_SECRET", "a".repeat(64));

    const lines = await startupLines();

    expect(lines.some((line) => /trusted proxy/i.test(line))).toBe(false);
    // The email warning is a separate condition: those values are present in
    // the test environment, so only the proxy line could have appeared.
    expect(lines.some((line) => /Email is not configured/i.test(line))).toBe(false);
    expect(lines.join("\n")).not.toContain("a".repeat(64));
  });

  it("logs nothing when the server is not a production node process", async () => {
    setEnv("NODE_ENV", "test");

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await register();

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});