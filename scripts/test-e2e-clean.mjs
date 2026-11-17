#!/usr/bin/env node
/**
 * Isolated end-to-end run (`npm run test:e2e:clean`).
 *
 * Every invocation:
 *   1. creates a brand-new SQLite file under the OS temp directory,
 *   2. applies the committed Prisma migrations to it,
 *   3. seeds it with the demo dataset,
 *   4. builds the production bundle against it (unless --skip-build),
 *   5. starts `next start` on a verified-free port with DATABASE_URL pinned to
 *      that temp file,
 *   6. proves the running app is really reading that file (canary workspace name
 *      + /proc environment check),
 *   7. runs scripts/verify-api.mjs and scripts/verify-pwa.mjs against it,
 *   8. stops only the processes it started and deletes the temp database.
 *
 * The project database (prisma/dev.db) is fingerprinted before and after. A
 * change fails the run: this harness must never write to it.
 *
 * Usage:
 *   npm run test:e2e:clean                 # build + run everything
 *   npm run test:e2e:clean -- --skip-build # reuse the current .next build
 *   npm run test:e2e:clean -- --keep       # keep the temp DB and server logs
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_DB = path.join(ROOT, "prisma", "dev.db");
const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const keepArtifacts = args.has("--keep");

// S-05: a per-run secret makes the harness an explicitly trusted proxy, so the
// suite can exercise distinct source IPs without weakening the default policy.
const AUTH_ENV = {
  TRUSTED_PROXY_SECRET: `s05-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  MAX_AUTH_ATTEMPTS: "5",
  MAX_AUTH_IP_ATTEMPTS: "20",
  AUTH_LOCKOUT_SECONDS: "900",
  AUTH_ATTEMPT_WINDOW_SECONDS: "900",
  AUTH_THROTTLE_RETENTION_SECONDS: "86400",
};

const log = (message) => console.log(`[harness] ${message}`);

class HarnessError extends Error {}

function assert(condition, message) {
  if (!condition) throw new HarnessError(message);
}

async function fingerprint(file) {
  if (!existsSync(file)) return { exists: false };
  const info = await stat(file);
  const hash = createHash("sha256").update(await readFile(file)).digest("hex");
  return { exists: true, size: info.size, mtimeMs: Math.round(info.mtimeMs), sha256: hash };
}

function sameFingerprint(a, b) {
  return a.exists === b.exists && a.size === b.size && a.sha256 === b.sha256;
}

/** Reserves an ephemeral port, then checks nothing is listening on it. */
async function findFreePort(attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = await new Promise((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        const chosen = typeof address === "object" && address ? address.port : 0;
        server.close(() => resolve(chosen));
      });
    });
    if (!port) continue;
    if (!portIsListening(port)) return port;
  }
  throw new HarnessError("Could not find a free port after 12 attempts");
}

function portIsListening(port) {
  try {
    const output = execFileSync("ss", ["-ltn"], { encoding: "utf8" });
    return output
      .split("\n")
      .some((line) => new RegExp(`[:.]${port}\\s`).test(line));
  } catch {
    return false;
  }
}

/** The PID that owns a listening TCP port, or null when it cannot be resolved. */
function listeningPid(port) {
  try {
    const output = execFileSync("ss", ["-ltnp"], { encoding: "utf8" });
    const line = output.split("\n").find((entry) => new RegExp(`[:.]${port}\\s`).test(entry));
    const match = line?.match(/pid=(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

/** DATABASE_URL from a process environment, or null if unreadable. */
async function databaseUrlOf(pid) {
  try {
    const raw = await readFile(`/proc/${pid}/environ`, "utf8");
    const entry = raw.split("\0").find((item) => item.startsWith("DATABASE_URL="));
    return entry ? entry.slice("DATABASE_URL=".length) : null;
  } catch {
    return null;
  }
}

async function waitForHealth(base, timeoutMs = 90_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return await response.json();
    } catch {
      // still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

function runSync(label, command, commandArgs, env) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  assert(result.status === 0, `${label} failed with exit code ${result.status ?? "unknown"}`);
}

function stopProcessGroup(child, signal) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

async function waitForPortClosed(port, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!portIsListening(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return !portIsListening(port);
}

async function login(base, email, password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email, password }),
  });
  assert(response.status === 200, `canary login failed with ${response.status}`);
  return response.json();
}

async function main() {
  const startedAt = Date.now();
  const before = await fingerprint(PROJECT_DB);
  log(`project database: ${path.relative(ROOT, PROJECT_DB)} sha256=${before.sha256?.slice(0, 12) ?? "missing"}`);
  assert(before.exists, "prisma/dev.db is missing — refusing to invent a baseline");

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sellflow-e2e-"));
  const tempDb = path.join(tempDir, "test.db");
  const tempUrl = `file:${tempDb}`;
  assert(path.resolve(tempDb) !== path.resolve(PROJECT_DB), "temp database resolved to the project database");

  log(`temp database: ${tempDb}`);
  log(`DATABASE_URL pinned to: ${tempUrl}`);

  let child = null;
  let port = null;
  let apiExit = null;
  let pwaExit = null;
  let failure = null;

  try {
    log("applying migrations to the temp database");
    runSync("prisma migrate deploy", "npx", ["prisma", "migrate", "deploy"], { DATABASE_URL: tempUrl });

    log("seeding the temp database");
    // The demo seed is guarded: it needs a test environment and an explicit
    // confirmation, so a deploy script cannot create demo admins by accident.
    runSync("seed", "npx", ["tsx", "prisma/seed.ts"], {
      DATABASE_URL: tempUrl,
      NODE_ENV: "test",
      SEED_DEMO_DATA: "true",
    });

    // A unique row the app can only return if it is reading the temp file.
    const canary = `HARNESS-${Date.now().toString(36).toUpperCase()}`;
    runSync(
      "canary write",
      "node",
      [
        "-e",
        [
          'const { PrismaClient } = require("@prisma/client");',
          "const prisma = new PrismaClient();",
          "(async () => {",
          '  const profile = await prisma.profile.findFirst({ where: { user: { email: "reseller@sellflow.test" } }, include: { ownedWorkspace: true } });',
          '  if (!profile?.ownedWorkspace) throw new Error("seeded reseller workspace missing");',
          "  await prisma.businessWorkspace.update({ where: { id: profile.ownedWorkspace.id }, data: { name: process.env.CANARY_NAME } });",
          "  await prisma.$disconnect();",
          "})().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });",
        ].join("\n"),
      ],
      { DATABASE_URL: tempUrl, CANARY_NAME: canary },
    );

    if (skipBuild) {
      assert(existsSync(path.join(ROOT, ".next", "BUILD_ID")), "--skip-build needs an existing production build");
      log("reusing the existing .next build (--skip-build)");
    } else {
      log("building the production bundle against the temp database");
      runSync("npm run build", "npm", ["run", "build"], { DATABASE_URL: tempUrl });
    }

    port = await findFreePort();
    const base = `http://127.0.0.1:${port}`;
    log(`starting the app on 127.0.0.1:${port}`);
    child = spawn("npx", ["next", "start", "-p", String(port)], {
      cwd: ROOT,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...AUTH_ENV,
        NODE_ENV: "production",
        DATABASE_URL: tempUrl,
        // Runtime-only, so --skip-build still works with a random test port.
        APP_ORIGIN: base,
      },
    });

    let serverLog = "";
    child.stdout?.on("data", (chunk) => (serverLog += chunk.toString()));
    child.stderr?.on("data", (chunk) => (serverLog += chunk.toString()));

    const health = await waitForHealth(base);
    if (!health) {
      console.error("[harness] server output:\n" + (serverLog.slice(-3_000) || "(none)"));
      throw new HarnessError("the app never became healthy");
    }
    assert(health.status === "ok" && health.database?.status === "up", "health reported a database problem");
    log(`app healthy: ${health.app?.version} (${health.app?.environment}) db=${health.database?.latencyMs}ms`);

    // Isolation proof 1: the app returns the canary workspace name.
    const session = await login(base, "reseller@sellflow.test", "Password123!");
    assert(
      session?.workspace?.name === canary,
      `isolation check failed: app reported workspace "${session?.workspace?.name}" instead of the temp-database canary`,
    );
    log(`isolation check 1 passed: canary workspace "${canary}" served from the temp database`);

    // Isolation proof 2: the listening process really carries the temp DATABASE_URL.
    const pid = listeningPid(port);
    if (pid) {
      const observed = await databaseUrlOf(pid);
      if (observed === null) {
        log("isolation check 2 skipped: /proc environment not readable on this host");
      } else {
        assert(
          observed === tempUrl,
          `isolation check failed: listening process DATABASE_URL is ${observed}, expected ${tempUrl}`,
        );
        log(`isolation check 2 passed: pid ${pid} DATABASE_URL matches the temp file`);
      }
    } else {
      log("isolation check 2 skipped: listener PID could not be resolved");
    }

    log("running the API suite against the temp database");
    apiExit = spawnSync("node", ["scripts/verify-api.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        ...AUTH_ENV,
        BASE_URL: base,
        DATABASE_URL: tempUrl,
        APP_ORIGIN: base,
        EXPECT_SECURE_COOKIE: "1",
      },
    }).status;
    assert(apiExit === 0, `verify-api.mjs failed with exit code ${apiExit}`);

    log("running the PWA suite against the temp database");
    const pwaPort = await findFreePort();
    pwaExit = spawnSync("node", ["scripts/verify-pwa.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: tempUrl, PWA_PORT: String(pwaPort) },
    }).status;
    assert(pwaExit === 0, `verify-pwa.mjs failed with exit code ${pwaExit}`);
  } catch (error) {
    failure = error;
  } finally {
    if (child) {
      log("stopping the harness server (process group only)");
      stopProcessGroup(child, "SIGTERM");
      if (port && !(await waitForPortClosed(port))) {
        log(`port ${port} still open after SIGTERM; sending SIGKILL to the harness process group`);
        stopProcessGroup(child, "SIGKILL");
        await waitForPortClosed(port, 5_000);
      }
      if (port) log(`port ${port} released`);
    }

    const after = await fingerprint(PROJECT_DB);
    if (!sameFingerprint(before, after)) {
      failure = failure ?? new HarnessError("prisma/dev.db changed during the run — isolation was violated");
      console.error("[harness] PROJECT DATABASE CHANGED. Investigate before trusting any result.");
    } else {
      log(`project database untouched: sha256=${after.sha256.slice(0, 12)} size=${after.size}`);
    }

    if (keepArtifacts) {
      log(`keeping artifacts: ${tempDir}`);
    } else {
      await rm(tempDir, { recursive: true, force: true });
      log("temp database and artifacts removed");
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (failure) {
      console.error(`\n[harness] FAILED after ${seconds}s: ${failure.message}`);
      if (apiExit !== null) console.error(`[harness] api exit=${apiExit} pwa exit=${pwaExit}`);
      process.exit(1);
    }
    console.log(`\n[harness] PASSED in ${seconds}s (isolated DB, api=0, pwa=0)`);
  }
}

main().catch((error) => {
  console.error(`[harness] crashed: ${error.message}`);
  process.exit(1);
});
