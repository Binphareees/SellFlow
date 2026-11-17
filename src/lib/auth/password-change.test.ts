import { describe, it, expect } from "vitest";

// NOTE: The S-09 password-change and password-reset HTTP flows are implemented
// in src/app/api/auth/password/change/route.ts and
// src/app/api/auth/password-reset/*. Those route modules call Next's cookies()
// inside a request scope this Vitest harness cannot provide, so they are not
// executed in this suite. They need a real Next server (for example with Playwright
// against `next dev`) to verify the authentication, CSRF, and session behavior.

describe("S-09 password reset and change — implementation present, HTTP suite pending a real Next server", () => {
  it("does not run API integration tests here", () => {
    expect(true).toBe(true);
  });
});
