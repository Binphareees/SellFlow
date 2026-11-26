import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";
import { listingCreateSchema, listingUpdateSchema } from "./validation";

type HeaderRule = { source: string; headers: Array<{ key: string; value: string }> };

async function headerRule(): Promise<HeaderRule> {
  const rules = (await nextConfig.headers!()) as HeaderRule[];
  const rule = rules.find((entry) => entry.source === "/(.*)");
  if (!rule) throw new Error("No catch-all header rule");
  return rule;
}

function headerValue(rule: HeaderRule, name: string): string | undefined {
  return rule.headers.find((header) => header.key.toLowerCase() === name.toLowerCase())?.value;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("security headers", () => {
  it("sets the baseline headers for every route", async () => {
    const rule = await headerRule();
    expect(headerValue(rule, "X-Content-Type-Options")).toBe("nosniff");
    expect(headerValue(rule, "X-Frame-Options")).toBe("DENY");
    expect(headerValue(rule, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(headerValue(rule, "Permissions-Policy")).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    const csp = headerValue(rule, "Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(headerValue(rule, "Strict-Transport-Security")).toBeUndefined();
  });

  it("adds unsafe-eval outside production and HSTS in production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    let rule = await headerRule();
    expect(headerValue(rule, "Content-Security-Policy")).toContain("'unsafe-eval'");

    vi.stubEnv("NODE_ENV", "production");
    rule = await headerRule();
    expect(headerValue(rule, "Content-Security-Policy")).not.toContain("'unsafe-eval'");
    expect(headerValue(rule, "Strict-Transport-Security")).toBe("max-age=31536000");
  });
});

describe("listing image URLs", () => {
  it("accepts https image URLs", () => {
    const parsed = listingCreateSchema.safeParse({
      title: "Test listing",
      publicPriceKobo: 1000,
      images: ["https://cdn.example.com/image.jpg"],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects http image URLs on create and update", () => {
    const created = listingCreateSchema.safeParse({
      title: "Test listing",
      publicPriceKobo: 1000,
      images: ["http://cdn.example.com/image.jpg"],
    });
    expect(created.success).toBe(false);

    const updated = listingUpdateSchema.safeParse({
      images: ["http://cdn.example.com/image.jpg"],
    });
    expect(updated.success).toBe(false);
  });
});
