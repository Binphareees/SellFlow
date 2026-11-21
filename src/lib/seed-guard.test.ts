import { describe, it, expect } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import {
  demoSeedRefusalReason,
  classifyDemoSeedTarget,
  isPrivilegedDemoSeedAuthorized,
  privilegedDemoSeedRefusalReason,
} from "../../scripts/seed-guard";

const DISPOSABLE = `file:${os.tmpdir()}/sellflow-disposable-test.db`;

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

describe("S-15 seed-guard fails closed (demo seed)", () => {
  it("refuses when NODE_ENV is unset", () => {
    const e = env({ SEED_DEMO_DATA: "true", DATABASE_URL: DISPOSABLE });
    expect(demoSeedRefusalReason(e)).not.toBeNull();
  });

  it("refuses when NODE_ENV is production", () => {
    const e = env({ NODE_ENV: "production", SEED_DEMO_DATA: "true", DATABASE_URL: DISPOSABLE });
    expect(demoSeedRefusalReason(e)).toMatch(/not a demo environment/i);
  });

  it("refuses when NODE_ENV is staging/ci/preview", () => {
    for (const ne of ["staging", "ci", "preview"]) {
      const e = env({ NODE_ENV: ne, SEED_DEMO_DATA: "true", DATABASE_URL: DISPOSABLE });
      expect(demoSeedRefusalReason(e)).not.toBeNull();
    }
  });

  it("refuses when SEED_DEMO_DATA is missing", () => {
    const e = env({ NODE_ENV: "development", DATABASE_URL: DISPOSABLE });
    expect(demoSeedRefusalReason(e)).toMatch(/SEED_DEMO_DATA=true is required/i);
  });

  it("refuses a postgres target", () => {
    const e = env({ NODE_ENV: "development", SEED_DEMO_DATA: "true", DATABASE_URL: "postgresql://user:pass@host/db" });
    expect(demoSeedRefusalReason(e)).not.toBeNull();
  });

  it("refuses a production-like path under /var", () => {
    const e = env({ NODE_ENV: "development", SEED_DEMO_DATA: "true", DATABASE_URL: "file:/var/lib/sellflow/prod.db" });
    expect(demoSeedRefusalReason(e)).not.toBeNull();
    expect(classifyDemoSeedTarget("file:/var/lib/sellflow/prod.db").allowed).toBe(false);
  });

  it("refuses a production-shaped filename", () => {
    const e = env({ NODE_ENV: "development", SEED_DEMO_DATA: "true", DATABASE_URL: "file:/tmp/sellflow.production.db" });
    expect(demoSeedRefusalReason(e)).not.toBeNull();
  });

  it("refuses unresolved interpolation", () => {
    const e = env({ NODE_ENV: "development", SEED_DEMO_DATA: "true", DATABASE_URL: "file:/tmp/${DB_NAME}.db" });
    expect(demoSeedRefusalReason(e)).not.toBeNull();
  });

  it("allows explicit dev opt-in against a disposable file target", () => {
    const e = env({ NODE_ENV: "development", SEED_DEMO_DATA: "true", DATABASE_URL: DISPOSABLE });
    expect(demoSeedRefusalReason(e)).toBeNull();
  });

  it("allows test env opt-in against a disposable file target", () => {
    const e = env({ NODE_ENV: "test", SEED_DEMO_DATA: "true", DATABASE_URL: DISPOSABLE });
    expect(demoSeedRefusalReason(e)).toBeNull();
  });
});

describe("S-15 seed-guard fails closed (privileged demo seed)", () => {
  it("refuses privileged seed without explicit opt-in", () => {
    const e = env({ NODE_ENV: "development", SEED_DEMO_DATA: "true", DATABASE_URL: DISPOSABLE });
    expect(isPrivilegedDemoSeedAuthorized(e)).toBe(false);
    expect(privilegedDemoSeedRefusalReason(e)).toMatch(/explicit authorization/i);
  });

  it("refuses privileged seed when demo seed itself is refused", () => {
    const e = env({ NODE_ENV: "production", SEED_DEMO_DATA: "true", DATABASE_URL: DISPOSABLE, SEED_PRIVILEGED_DEMO_ACCOUNTS: "true" });
    expect(privilegedDemoSeedRefusalReason(e)).not.toBeNull();
  });

  it("allows privileged seed only with explicit opt-in on disposable target", () => {
    const e = env({ NODE_ENV: "development", SEED_DEMO_DATA: "true", DATABASE_URL: DISPOSABLE, SEED_PRIVILEGED_DEMO_ACCOUNTS: "true" });
    expect(privilegedDemoSeedRefusalReason(e)).toBeNull();
  });
});

describe("S-06 no public demo credentials in src/", () => {
  it("does not expose @sellflow.test demo emails in non-test source files", () => {
    const root = path.resolve(process.cwd(), "src");
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(full);
        } else if (/\.(ts|tsx|js|jsx|md|html)$/.test(entry.name) && !entry.name.endsWith(".test.ts") && !entry.name.endsWith(".test.tsx")) {
          const content = fs.readFileSync(full, "utf8");
          if (/@sellflow\.test\b/.test(content)) offenders.push(path.relative(root, full));
        }
      }
    }
    walk(root);
    expect(offenders).toEqual([]);
  });
});
