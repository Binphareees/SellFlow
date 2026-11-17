#!/usr/bin/env node
/**
 * Production-bundle PWA verification.
 *
 *   npm run test:pwa            # verify the existing build, booted on a spare port
 *   npm run test:pwa -- --build # rebuild first (CI / before a release)
 *
 * Why a separate script: the assertions in `scripts/verify-api.mjs` run against
 * whatever is already deployed, while this one proves a *freshly built*
 * production bundle serves a valid manifest, a correctly scoped service worker,
 * the offline screen and the PWA tags.
 *
 * Note: `--build` rewrites `.next`, so it must not run while `next start` or
 * `next dev` is serving this folder. Stop the local server first.
 */

import { spawn, spawnSync } from "node:child_process";
import { runPwaChecks } from "./pwa-checks.mjs";

const args = new Set(process.argv.slice(2));
const shouldBuild = args.has("--build");
const port = Number(process.env.PWA_PORT ?? 4321);
const base = `http://127.0.0.1:${port}`;

let failures = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function waitForHealth(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) return true;
    } catch {
      // server still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    // Kill the whole group: `npx` sits in front of the real `next start`.
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function main() {
  if (shouldBuild) {
    console.log("Building the production bundle…\n");
    const build = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
    if (build.status !== 0) {
      console.error("\nProduction build failed — no PWA checks ran.");
      process.exit(1);
    }
    console.log("");
  }

  console.log(`Starting production server on ${base}\n`);
  const child = spawn("npx", ["next", "start", "-p", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
    env: { ...process.env, NODE_ENV: "production" },
  });

  let serverLog = "";
  child.stdout?.on("data", (chunk) => (serverLog += chunk.toString()));
  child.stderr?.on("data", (chunk) => (serverLog += chunk.toString()));

  try {
    if (!(await waitForHealth())) {
      console.error("The production server never became healthy. Output:\n");
      console.error(serverLog.slice(-2_000) || "(no output)");
      process.exit(1);
    }

    await runPwaChecks(base, { check, requireProduction: true });
  } finally {
    stopServer(child);
  }

  console.log(`\n${failures === 0 ? "PWA CHECKS PASSED" : `${failures} PWA CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("PWA verification crashed:", error.message);
  process.exit(1);
});
