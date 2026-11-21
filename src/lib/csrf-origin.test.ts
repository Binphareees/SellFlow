import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { route } from "@/lib/api";

// A trivial handler wrapped in route() so the same-origin gate runs first.
const handler = route(async () => new Response("ok", { status: 200 }));

function req(method: string, headers: Record<string, string> = {}, url = "http://localhost/api/x", body?: string): Request {
  return new Request(url, { method, headers, body });
}

describe("S-13 CSRF same-origin gate (via route wrapper)", () => {
  it("matching Origin passes", async () => {
    const r = req("POST", { origin: "http://localhost" });
    const res = await handler(r, {} as any);
    expect(res.status).toBe(200);
  });

  it("foreign Origin fails with 403", async () => {
    const r = req("POST", { origin: "https://evil.example" });
    const res = await handler(r, {} as any);
    expect(res.status).toBe(403);
  });

  it("missing Origin with matching Referer passes", async () => {
    const r = req("POST", { referer: "http://localhost/page" });
    const res = await handler(r, {} as any);
    expect(res.status).toBe(200);
  });

  it("missing Origin with foreign Referer fails", async () => {
    const r = req("POST", { referer: "https://evil.example/page" });
    const res = await handler(r, {} as any);
    expect(res.status).toBe(403);
  });

  it("missing Origin + no Referer + session cookie fails closed", async () => {
    const r = req("POST", { cookie: "sf_session=abc123" });
    const res = await handler(r, {} as any);
    expect(res.status).toBe(403);
  });

  it("missing Origin + no Referer + no cookie passes (unauthenticated)", async () => {
    const r = req("POST");
    const res = await handler(r, {} as any);
    expect(res.status).toBe(200);
  });

  it("GET is not checked", async () => {
    const r = req("GET", { origin: "https://evil.example" });
    const res = await handler(r, {} as any);
    expect(res.status).toBe(200);
  });

  it("production mode fails closed (empty expected origins)", async () => {
    const prev = process.env.NODE_ENV;
    const prevOrigin = process.env.APP_ORIGIN;
    const prevPublic = process.env.NEXT_PUBLIC_APP_URL;
    (process.env as any).NODE_ENV = "production";
    delete process.env.APP_ORIGIN;
    delete process.env.NEXT_PUBLIC_APP_URL;
    try {
      const r = req("POST", { origin: "http://localhost" });
      const res = await handler(r, {} as any);
      expect(res.status).toBe(403);
    } finally {
      (process.env as any).NODE_ENV = prev ?? "";
      if (prevOrigin) process.env.APP_ORIGIN = prevOrigin;
      if (prevPublic) process.env.NEXT_PUBLIC_APP_URL = prevPublic;
    }
  });

  it("opaque null origin is rejected", async () => {
    const r = req("POST", { origin: "null" });
    const res = await handler(r, {} as any);
    expect(res.status).toBe(403);
  });
});

describe("S-13 route-level foreign Origin rejection", () => {
  it("POST /api/auth/login with foreign Origin returns 403", async () => {
    const { POST } = await import("@/app/api/auth/login/route");
    const r = new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", password: "x" }),
    });
    const res = await POST(r, {} as any);
    expect(res.status).toBe(403);
  });

  it("PATCH /api/workspace/products/[id] with foreign Origin returns 403", async () => {
    const { PATCH } = await import("@/app/api/workspace/products/[id]/route");
    const r = new Request("http://localhost/api/workspace/products/abc", {
      method: "PATCH",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    const res = await PATCH(r, { params: { id: "abc" } } as any);
    expect(res.status).toBe(403);
  });

  it("DELETE /api/workspace/customers/[id] with foreign Origin returns 403", async () => {
    const { DELETE } = await import("@/app/api/workspace/customers/[id]/route");
    const r = new Request("http://localhost/api/workspace/customers/abc", {
      method: "DELETE",
      headers: { origin: "https://evil.example" },
    });
    const res = await DELETE(r, { params: { id: "abc" } } as any);
    expect(res.status).toBe(403);
  });

  it("POST /api/supplier/orders with foreign Origin returns 403", async () => {
    const { POST } = await import("@/app/api/supplier/orders/route");
    const r = new Request("http://localhost/api/supplier/orders", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(r, {} as any);
    expect(res.status).toBe(403);
  });
});

describe("S-13 mutating route inventory (static)", () => {
  it("every mutating route.ts is wrapped in route()", () => {
    const apiRoot = path.resolve(process.cwd(), "src/app/api");
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === "route.ts") {
          const content = fs.readFileSync(full, "utf8");
          const hasMutating = /export const (POST|PATCH|PUT|DELETE)\b/.test(content);
          if (hasMutating && !/export const (POST|PATCH|PUT|DELETE) = route\(/.test(content)) {
            offenders.push(path.relative(apiRoot, full));
          }
        }
      }
    }
    walk(apiRoot);
    expect(offenders).toEqual([]);
  });
});
