#!/usr/bin/env node
/**
 * Isolated S-12-only verification runner (Stage 2 Task 7 — S-12 Audit Durability).
 *
 * This is a dedicated entry point for the S-12 audit-durability checks. It reuses
 * the existing isolated-database setup pattern from scripts/test-e2e-clean.mjs, but
 * it does NOT run the full verification suite. It:
 *
 *   1. creates a uniquely named temporary directory under the OS temp directory,
 *   2. creates a fresh disposable SQLite database inside that directory,
 *   3. runs Prisma migrations against that database only,
 *   4. seeds only that database with the explicit demo opt-in environment variables,
 *   5. starts the Next.js server on an available port with DATABASE_URL pinned to the
 *      same temporary database,
 *   6. runs `node scripts/verify-api.mjs` against it with ONLY_S12=1, and
 *   7. stops only the server it started by signaling the direct spawned child and
 *      inspects/releases the port it used.
 *
 * The project database (prisma/dev.db) is fingerprinted before and after. A change
 * fails the run: this runner must never write to prisma/dev.db.
 *
 * This runner is intentionally small and S-12-focused. It does not import or run
 * the full verification suite, `verify-pwa`, or any other security finding.
 *
 * Cleanup notes:
 *   - During shutdown, the runner sends a signal only to the direct ChildProcess
 *     handle it obtained from `spawn()`. It does not use negative-PID signaling,
 *     bare-PID signaling through `process.kill()`, process-name killing, or any
 *     broad process matching.
 *   - Confirmation of cleanup is based on the direct spawned child exit event and
 *     port release. Direct-child exit is a direct-child event; it does not itself
 *     prove that inherited subprocesses have exited.
 *   - SIGINT and SIGTERM initiate graceful shutdown and then run the normal
 *     cleanup path. SIGKILL and machine crashes cannot guarantee cleanup.
 *   - If any cleanup step throws, later cleanup and final reporting still run.
 *
 * Interruption notes:
 *   - After every synchronous subprocess step, the runner checks whether a signal
 *     was received before starting the next step. If a signal arrived during one
 *     step, the runner cleans up and stops; it does not start another step.
 *   - waitForHealth() stops polling when a signal has been received.
 *
 * Persistence note:
 *   - When --keep is used, server logs are written to server.log inside the
 *     retained temporary directory. When --keep is not used, the directory (and
 *     any logs inside it) is removed only after the direct spawned child has
 *     exited and port release has been confirmed.
 *
 * Retention-on-failure note:
 *   - The temporary database is never deleted unless the direct spawned child
 *     exit has been confirmed and port release has been confirmed. A closed port
 *     alone does not unlock deletion, and a direct-child exit event alone does
 *     not unlock deletion when port release was required but not confirmed.
 *   - If these cleanup conditions cannot be confirmed, the temp directory is
 *     preserved even without --keep and its exact location is printed so it can
 *     be inspected manually.
 *
 * Usage:
 *   node scripts/test-s12-isolated.mjs             # build + run
 *   node scripts/test-s12-isolated.mjs --skip-build # reuse the current .next build
 *   node scripts/test-s12-isolated.mjs --keep       # keep the temp DB and server logs
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireForPath = createRequire(import.meta.url);
const PROJECT_DB = path.join(ROOT, "prisma", "dev.db");

const args = new Set(process.argv.slice(2));
const skipBuild = args.has("--skip-build");
const keepArtifacts = args.has("--keep");

// S-05 environment used by the existing isolated harness. We reuse the same values so
// the server is started with the same trusted-proxy configuration the verification
// script expects.
const AUTH_ENV = {
  TRUSTED_PROXY_SECRET: `s05-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  MAX_AUTH_ATTEMPTS: "5",
  MAX_AUTH_IP_ATTEMPTS: "20",
  AUTH_LOCKOUT_SECONDS: "900",
  AUTH_ATTEMPT_WINDOW_SECONDS: "900",
  AUTH_THROTTLE_RETENTION_SECONDS: "86400",
};

const log = (message) => console.log(`[s12-isolated] ${message}`);

class S12IsolationError extends Error {}

function assert(condition, message) {
  if (!condition) throw new S12IsolationError(message);
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
  throw new S12IsolationError("Could not find a free port after 12 attempts");
}

/**
 * Returns true when the given port is known to be in use.
 *
 * An inspection failure is treated as a real problem, not as evidence that the
 * port is free. We cannot assert safety when `ss` is unavailable.
 */
function portIsListening(port) {
  try {
    const output = execFileSync("ss", ["-ltn"], { encoding: "utf8" });
    return output
      .split("\n")
      .some((line) => new RegExp(`[:.]${port}\\s`).test(line));
  } catch (error) {
    throw new S12IsolationError(
      `port inspection failed: unable to verify whether port ${port} is free (${error.message ?? String(error)})`,
    );
  }
}

/** Listener metadata from `ss -ltnp`, for the given port. */
async function portListenerInfo(port) {
  try {
    const output = execFileSync("ss", ["-ltnp"], { encoding: "utf8" });
    const line = output.split("\n").find((entry) => new RegExp(`[:.]${port}\\s`).test(entry));
    const match = line?.match(/pid=(\d+)/);
    return match ? { listenerPid: Number(match[1]) } : null;
  } catch {
    return null;
  }
}

/** DATABASE_URL from a process environment, or null if unreadable. */
async function databaseUrlOf(pid) {
  try {
    const raw = readFileSync(`/proc/${pid}/environ`, "utf8");
    const entry = raw.split("\0").find((item) => item.startsWith("DATABASE_URL="));
    return entry ? entry.slice("DATABASE_URL=".length) : null;
  } catch {
    return null;
  }
}

/**
 * Send a signal to the direct spawned child via its ChildProcess handle.
 *
 * This uses only the direct ChildProcess handle. It does not use negative-PID signaling,
 * bare-PID signaling through `process.kill()`, process-name killing, or broad process
 * matching.
 *
 * A successful `child.kill()` is a signal delivery attempt, not proof of process
 * termination. `child.killed`, a short delay, and the exit event itself are not treated
 * as proof that inherited subprocesses have exited.
 */
async function sendSignalToChild(child, signal) {
  if (!child || typeof child.pid !== "number" || !Number.isFinite(child.pid)) {
    throw new S12IsolationError("cannot signal: no valid spawned child");
  }

  if (child.exitCode !== null && child.exitCode !== undefined) {
    throw new S12IsolationError("cannot signal: direct child has already exited with code " + child.exitCode);
  }

  if (child.signalCode !== null && child.signalCode !== undefined) {
    throw new S12IsolationError("cannot signal: direct child has already been terminated by signal " + child.signalCode);
  }

  const signaled = child.kill(signal);
  if (!signaled) {
    throw new S12IsolationError(
      `child.kill(${signal}) returned false for the direct spawned child (pid ${child.pid}); signal could not be delivered`,
    );
  }
}

/**
 * Wait for the direct spawned child to exit, with an explicit bound.
 *
 * Result shape: { exited, timedOut, exitCode?, signalCode?, error? }
 *
 * If the child has already exited, this returns immediately without waiting.
 * If the child has not exited within the bound, we stop waiting and report that
 * without assuming termination. An inconclusive or timed-out result means we did
 * not confirm direct-child exit, not that everything is safely gone.
 */
async function waitForDirectChildExit(child, timeoutMs) {
  if (!child || typeof child.pid !== "number" || !Number.isFinite(child.pid)) {
    return { exited: false, timedOut: true };
  }

  if (child.exitCode !== null && child.exitCode !== undefined) {
    return { exited: true, timedOut: false, exitCode: child.exitCode };
  }

  if (child.signalCode !== null && child.signalCode !== undefined) {
    return { exited: true, timedOut: false, signalCode: child.signalCode };
  }

  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        child.removeListener("exit", onExit);
        child.removeListener("error", onError);
        resolve({ exited: false, timedOut: true });
      }, timeoutMs);

      const onExit = (code, signal) => {
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        child.removeListener("error", onError);
        if (code !== null && code !== undefined) {
          resolve({ exited: true, timedOut: false, exitCode: code });
        } else if (signal !== null && signal !== undefined) {
          resolve({ exited: true, timedOut: false, signalCode: signal });
        } else {
          resolve({ exited: false, timedOut: false });
        }
      };

      const onError = () => {
        clearTimeout(timer);
        child.removeListener("exit", onExit);
        child.removeListener("error", onError);
        resolve({ exited: false, timedOut: false, error: true });
      };

      child.once("exit", onExit);
      child.once("error", onError);
    });
  } catch (error) {
    return { exited: false, timedOut: false, error: true };
  }
}

/**
 * Describe the direct-child exit result for logging only.
 */
function describeDirectChildExit(result) {
  if (result.exitCode !== undefined && result.exitCode !== null) {
    return `exit code ${result.exitCode}`;
  }
  if (result.signalCode !== undefined && result.signalCode !== null) {
    return `signal ${result.signalCode}`;
  }
  return "direct child exited with an unclassified result";
}

/**
 * Returns true once port inspection confirms nothing is listening on the given port.
 *
 * Inspection errors are propagated, because an unreadable `ss` means we cannot
 * assert that the port has been released.
 */
async function waitForPortClosed(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!portIsListening(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

/**
 * Wait for the server health endpoint.
 *
 * Polls with a fixed 400ms interval, respects shutdown requests, and uses a
 * 3s fetch timeout per attempt per poll.
 *
 * The caller provides `getSpawnError: () => spawnError` so the health wait can
 * observe changes to the outer spawnError variable. A stale closure over the
 * initial `null` value would not see an error assigned later during polling.
 *
 * On every poll cycle, `checkSpawnError()` also inspects the direct child's
 * `exitCode` and `signalCode`. If the child exits or is terminated by a signal
 * during health polling, polling stops immediately and the wait settles as a
 * failure. We do not wait out the full timeout for a server that never started.
 *
 * In addition to polling, the direct child's `error` and `exit` events are
 * attached. If either occurs before health succeeds, the health wait is settled
 * immediately as a failure. Both listeners are removed inside the shared settle()
 * function. Any in-flight fetch is aborted via an AbortController when the wait
 * fails so a late response cannot turn an already-failed health wait into a
 * success.
 */
async function waitForHealth(base, timeoutMs = 60_000, { getSpawnError, child } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let pendingTimer = null;
    const abortController = new AbortController();

    const clearTimer = () => {
      if (pendingTimer !== null) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    };

    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimer();
      abortController.abort();
      if (child) {
        child.removeListener("error", onChildError);
        child.removeListener("exit", onChildExit);
      }
      resolve(value);
    };

    const schedule = () => {
      if (settled) return;
      clearTimer();
      pendingTimer = setTimeout(tick, 400);
    };

    const logUnexpectedChildExit = () => {
      if (child) {
        const exitCode = child.exitCode;
        const signalCode = child.signalCode;
        if (exitCode !== null && exitCode !== undefined) {
          log(`server child exited during health wait with code ${exitCode}`);
        } else if (signalCode !== null && signalCode !== undefined) {
          log(`server child terminated by signal ${signalCode} during health wait`);
        }
      }
    };

    const onChildError = () => {
      if (settled) return;
      log("server child emitted an error event during health wait");
      settle(null);
    };

    const onChildExit = () => {
      if (settled) return;
      log("server child exited during health wait");
      settle(null);
    };

    if (child) {
      child.on("error", onChildError);
      child.on("exit", onChildExit);
    }

    const checkSpawnError = () => {
      const currentError = getSpawnError();
      if (currentError) {
        logUnexpectedChildExit();
        settle(null);
        return true;
      }
      return false;
    };

    const checkUnexpectedChildExit = () => {
      if (child) {
        const exitCode = child.exitCode;
        const signalCode = child.signalCode;
        if (exitCode !== null && exitCode !== undefined) {
          log(`server child exited during health wait with code ${exitCode}`);
          settle(null);
          return true;
        }
        if (signalCode !== null && signalCode !== undefined) {
          log(`server child terminated by signal ${signalCode} during health wait`);
          settle(null);
          return true;
        }
      }
      return false;
    };

    const tick = () => {
      if (settled) return;

      if (shutdownRequested) {
        settle(null);
        return;
      }

      if (checkSpawnError()) {
        return;
      }

      if (checkUnexpectedChildExit()) {
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        settle(null);
        return;
      }

      fetch(`${base}/api/health`, {
        signal: AbortSignal.any([abortController.signal, AbortSignal.timeout(3_000)]),
      })
        .then((response) => {
          if (settled) return;

          if (shutdownRequested || Date.now() - startedAt >= timeoutMs) {
            settle(null);
            return;
          }

          if (checkSpawnError()) {
            return;
          }

          if (checkUnexpectedChildExit()) {
            return;
          }

          if (response.ok) {
            response
              .json()
              .then((json) => {
                if (settled) return;

                if (shutdownRequested || Date.now() - startedAt >= timeoutMs) {
                  settle(null);
                  return;
                }

                if (checkSpawnError()) {
                  return;
                }

                if (checkUnexpectedChildExit()) {
                  return;
                }

                settle(json);
              })
              .catch(() => {
                if (settled) return;

                if (shutdownRequested || Date.now() - startedAt >= timeoutMs) {
                  settle(null);
                  return;
                }

                if (checkSpawnError()) {
                  return;
                }

                if (checkUnexpectedChildExit()) {
                  return;
                }

                schedule();
              });
          } else {
            schedule();
          }
        })
        .catch((error) => {
          if (settled) return;

          if (error && error.name === "AbortError") {
            // AbortSignal.any aborts when either the health-poll AbortController
            // is aborted (failure path) or the per-fetch 3s timeout fires.
            // Only treat the fetch timeout as a normal retry; the failure-path
            // abort is handled by settle() already having been called.
            if (!settled) {
              // This is the 3s per-fetch timeout, not a failure-path abort.
              schedule();
            }
            return;
          }

          if (shutdownRequested || Date.now() - startedAt >= timeoutMs) {
            settle(null);
            return;
          }

          if (checkSpawnError()) {
            return;
          }

          if (checkUnexpectedChildExit()) {
            return;
          }

          schedule();
        });
    };

    tick();
  });
}

class S12InterruptedError extends S12IsolationError {}

function runSync(label, command, commandArgs, env, { timeoutMs } = {}) {
  const before = Date.now();
  const result = timeoutMs != null
    ? spawnSync(command, commandArgs, {
        cwd: ROOT,
        env: { ...process.env, ...env },
        stdio: "inherit",
        timeout: timeoutMs,
      })
    : spawnSync(command, commandArgs, {
        cwd: ROOT,
        env: { ...process.env, ...env },
        stdio: "inherit",
      });
  const elapsedMs = Date.now() - before;

  let details = `after ${elapsedMs}ms`;
  if (result.error) {
    details = `after ${elapsedMs}ms; spawn error ${errorCodeLabel(result.error)}`;
    if (result.error && typeof result.error.message === "string" && result.error.message) {
      details += `: ${result.error.message}`;
    }
  } else if (result.signal) {
    details = `after ${elapsedMs}ms; terminated by signal ${result.signal}`;
  } else if (result.status == null) {
    details = `after ${elapsedMs}ms; exit status unavailable`;
  } else {
    details = `after ${elapsedMs}ms; exit code ${result.status}`;
  }

  assert(
    result.status === 0,
    `${label} failed ${details}`,
  );
}

function errorCodeLabel(error) {
  if (!error) return "unknown error";
  const code = error.code;
  if (code === "EPERM" || String(code).toUpperCase() === "EPERM") return "EPERM";
  if (code === "ESRCH" || String(code).toUpperCase() === "ESRCH") return "ESRCH";
  return error?.message ?? String(error);
}

function errorMessageOrCode(error) {
  if (!error) return "unknown error";
  const code = error.code;
  if (code) return String(code);
  return error?.message ?? String(error);
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

let shutdownRequested = false;

function requestShutdown() {
  shutdownRequested = true;
}

process.on("SIGINT", () => {
  console.warn("[s12-isolated] received SIGINT; initiating graceful shutdown");
  requestShutdown();
});

process.on("SIGTERM", () => {
  console.warn("[s12-isolated] received SIGTERM; initiating graceful shutdown");
  requestShutdown();
});

async function main() {
  const startedAt = Date.now();
  const before = await fingerprint(PROJECT_DB);
  log(`project database: ${path.relative(ROOT, PROJECT_DB)} sha256=${before.sha256?.slice(0, 12) ?? "missing"}`);
  assert(before.exists, "prisma/dev.db is missing — refusing to invent a baseline");

  // If interrupted before we create the temp directory, there is nothing to clean
  // up except the process exit. The temp-directory creation and its dependent
  // initialization are placed inside the try block below so that if they fail, the
  // finally block still runs the after-fingerprint and the conservative cleanup
  // decision path.
  let tempDir = null;
  let tempDb = null;
  let tempUrl = null;
  let serverLogPath = null;
  let serverLogPathMarker = null;
  let child = null;
  let port = null;
  let s12Exit = null;
  let failure = null;
  let portReleaseConfirmed = false;
  let directChildExitConfirmed = false;

  const defaultDirectChildWaitMs = 15_000;

  async function stopServerAndConfirm() {
    if (!child) {
      // No server process was ever created. Nothing to terminate, and there is no server
      // to protect the temporary database from.
      directChildExitConfirmed = true;
      return;
    }

    log("stopping the harness server (direct spawned child only)");

    if (!child || typeof child.pid !== "number" || !Number.isFinite(child.pid)) {
      log("no valid spawned server child; not signaling; preserving artifacts");
      return;
    }

    // We do not use negative-PID signaling, bare-PID signaling through process.kill(),
    // process-name killing, or broad process matching. We target only the direct
    // ChildProcess handle we obtained from spawn().
    {
      let termErr = null;
      try {
        log("sending SIGTERM to the direct spawned child");
        await sendSignalToChild(child, "SIGTERM");
      } catch (error) {
        termErr = error;
        log(`SIGTERM to direct child failed: ${errorMessageOrCode(error)}`);
      }

      // After a signal attempt, wait for the direct child to exit within a bounded window.
      // A prior child.exit is handled inside waitForDirectChildExit(); this wait is for the
      // case where the signal was delivered and we need to observe the child exit event.
      {
        const waited = await waitForDirectChildExit(child, defaultDirectChildWaitMs);
        if (waited.exited) {
          directChildExitConfirmed = true;
          log(`direct spawned child exited after SIGTERM: ${describeDirectChildExit(waited)}`);
        } else if (waited.timedOut) {
          log("direct spawned child did not exit within the bounded wait after SIGTERM");
        } else if (waited.error) {
          log("direct spawned child emitted an error event while waiting after SIGTERM");
        } else {
          log("direct spawned child wait finished with an inconclusive result after SIGTERM");
        }
      }

      if (!directChildExitConfirmed) {
        if (child.exitCode !== null && child.exitCode !== undefined) {
          log("direct server child had already exited before SIGKILL; not signaling");
          return;
        }
        if (child.signalCode !== null && child.signalCode !== undefined) {
          log("direct server child had already been terminated by signal before SIGKILL; not signaling");
          return;
        }

        log("sending SIGKILL to the direct spawned child");
        let sigKillOk = false;
        try {
          await sendSignalToChild(child, "SIGKILL");
          sigKillOk = true;
        } catch (error) {
          log(`SIGKILL to direct child failed: ${errorMessageOrCode(error)}`);
          sigKillOk = false;
        }

        if (!sigKillOk) {
          log("could not signal the direct spawned child with SIGKILL; preservation path chosen");
          return;
        }

        const waited = await waitForDirectChildExit(child, 10_000);
        if (waited.exited) {
          directChildExitConfirmed = true;
          log(`direct spawned child exited after SIGKILL: ${describeDirectChildExit(waited)}`);
        } else if (waited.timedOut) {
          log("direct spawned child did not exit within the bounded wait after SIGKILL");
        } else if (waited.error) {
          log("direct spawned child emitted an error event while waiting after SIGKILL");
        } else {
          log("direct spawned child wait finished with an inconclusive result after SIGKILL");
        }
      }
    }

    // Port release is independent of a successful signal, child.killed, or the direct child
    // exit event. None of those is treated as proof that every inherited subprocess has ceased.
    // Termination confirmation for this runner therefore requires port release, plus a bounded
    // wait on the direct ChildProcess handle, and neither is accepted as a complete proof by
    // itself.
    if (port) {
      try {
        if (await waitForPortClosed(port, 5_000)) {
          portReleaseConfirmed = true;
          log(`port ${port} released`);
        } else {
          log(`port ${port} still open after direct-child cleanup attempt`);
        }
      } catch (error) {
        log(`port inspection after direct-child cleanup attempt failed: ${errorMessageOrCode(error)}`);
      }
    }
  }

  /**
   * Cleanup completeness predicate used by the finally block.
   *
   * Temporary artifacts are deleted only when every required cleanup condition is positively
   * confirmed. If any condition is missing, failed, or inconclusive, the artifacts are
   * preserved and the run is failed.
   */
  function cleanupRequirementsMet(directChildExitWasConfirmed, portReleaseConfirmed, port) {
    if (!directChildExitWasConfirmed) {
      return false;
    }
    // Port-release confirmation is required only when a port was allocated. If the runner
    // failed before allocating a port (and therefore never started a server process), there
    // is no listener whose release needs confirmation; direct-child exit confirmation is
    // sufficient on that path. When a port was allocated, confirmed port release remains
    // required and is not weakened.
    if (port != null && !portReleaseConfirmed) {
      return false;
    }
    return true;
  }

  try {
    // --- temp directory and dependent initialization (formerly outside try) ---
    // Placed here so that if mkdtemp() or the keep-artifact marker write fails,
    // the finally block still runs the after-fingerprint and the conservative
    // cleanup/retention decision path.
    tempDir = await mkdtemp(path.join(os.tmpdir(), "sellflow-e2e-s12-isolated-"));
    tempDb = path.join(tempDir, "test.db");
    tempUrl = `file:${tempDb}`;
    assert(path.resolve(tempDb) !== path.resolve(PROJECT_DB), "temp database resolved to the project database");

    serverLogPath = path.join(tempDir, "server.log");
    if (keepArtifacts) {
      // Write server logs into the retained directory so the --keep promise is real.
      serverLogPathMarker = await writeFile(serverLogPath, "").then(() => serverLogPath);
      log(`server log target: ${serverLogPath}`);
    }

    log(`temp database: ${tempDb}`);
    log(`DATABASE_URL pinned to: ${tempUrl}`);
    // --- end temp initialization ---

    log("applying migrations to the temp database");
    runSync("prisma migrate deploy", "npx", ["prisma", "migrate", "deploy"], { DATABASE_URL: tempUrl });
    if (shutdownRequested) {
      failure = new S12IsolationError("interrupted after migrate deploy");
      throw failure;
    }

    log("seeding the temp database");
    runSync("seed", "npx", ["tsx", "prisma/seed.ts"], {
      DATABASE_URL: tempUrl,
      NODE_ENV: "test",
      SEED_DEMO_DATA: "true",
    });
    if (shutdownRequested) {
      failure = new S12IsolationError("interrupted after seed");
      throw failure;
    }

    // A unique row the app can only return if it is reading the temp file.
    const canary = `S12-HARNESS-${Date.now().toString(36).toUpperCase()}`;
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
    if (shutdownRequested) {
      failure = new S12IsolationError("interrupted after canary write");
      throw failure;
    }

    if (skipBuild) {
      assert(existsSync(path.join(ROOT, ".next", "BUILD_ID")), "--skip-build needs an existing production build");
      log("reusing the existing .next build (--skip-build)");
    } else {
      log("building the production bundle against the temp database");
      runSync("npm run build", "npm", ["run", "build"], { DATABASE_URL: tempUrl });
    }
    if (shutdownRequested) {
      failure = new S12IsolationError("interrupted after build");
      throw failure;
    }

    if (shutdownRequested) {
      failure = new S12IsolationError("interrupted before starting the server");
      throw failure;
    }

    port = await findFreePort();
    const base = `http://127.0.0.1:${port}`;
    log(`starting the app on 127.0.0.1:${port}`);

    child = spawn(
      process.execPath,
      [requireForPath.resolve("next/dist/bin/next"), "start", "-p", String(port)],
      {
        cwd: ROOT,
        detached: false,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          ...AUTH_ENV,
          NODE_ENV: "production",
          DATABASE_URL: tempUrl,
          APP_ORIGIN: base,
        },
      },
    );

    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
      log(`server child errored at spawn: ${errorMessageOrCode(error)}`);
    });

    if (serverLogPathMarker) {
      const logFile = serverLogPathMarker;
      child.stdout.on("data", (chunk) =>
        writeFile(logFile, chunk.toString(), { flag: "a" }).catch(() => {}),
      );
      child.stderr.on("data", (chunk) =>
        writeFile(logFile, chunk.toString(), { flag: "a" }).catch(() => {}),
      );
    } else {
      child.stdout.on("data", () => {});
      child.stderr.on("data", () => {});
    }

    if (spawnError) {
      if (child.exitCode !== null && child.exitCode !== undefined) {
        log(`server child exited during spawn with code ${child.exitCode}`);
      }
      throw new S12IsolationError(`server failed to start: ${errorMessageOrCode(spawnError)}`);
    }

    const health = await waitForHealth(base, 60_000, { getSpawnError: () => spawnError, child });
    if (shutdownRequested) {
      failure = new S12IsolationError("interrupted while waiting for the server to become healthy");
      throw failure;
    }
    if (!health) {
      throw new S12IsolationError("the app never became healthy");
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
    const portInfo = await portListenerInfo(port);
    if (!portInfo?.listenerPid) {
      log("isolation check 2 skipped: listener PID could not be resolved");
    } else {
      const observed = await databaseUrlOf(portInfo.listenerPid);
      if (observed === null) {
        log("isolation check 2 skipped: /proc environment not readable on this host");
      } else {
        assert(
          observed === tempUrl,
          `isolation check failed: listening process DATABASE_URL is ${observed}, expected ${tempUrl}`,
        );
        log(`isolation check 2 passed: pid ${portInfo.listenerPid} DATABASE_URL matches the temp file`);
      }
    }

    if (shutdownRequested) {
      failure = new S12IsolationError("interrupted before running the S-12 verification suite");
      throw failure;
    }

    log("running the S-12 verification suite against the temp database");
    s12Exit = spawnSync("node", ["scripts/verify-api.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        ...AUTH_ENV,
        BASE_URL: base,
        DATABASE_URL: tempUrl,
        APP_ORIGIN: base,
        EXPECT_SECURE_COOKIE: "1",
        ONLY_S12: "1",
      },
    }).status;
    assert(s12Exit === 0, `verify-api.mjs exited with ${s12Exit} under ONLY_S12=1`);
  } catch (error) {
    failure = failure ?? error;
  } finally {
    let cleanupError = null;
    try {
      await stopServerAndConfirm();
    } catch (error) {
      cleanupError = error;
      log(`cleanup itself failed: ${errorMessageOrCode(error)}`);
    }

    // --- project database after-fingerprint, always attempted ---
    let after = null;
    let fingerprintError = null;
    try {
      after = await fingerprint(PROJECT_DB);
    } catch (error) {
      fingerprintError = error;
      log(`project database after-fingerprint failed: ${errorMessageOrCode(error)}`);
    }

    if (fingerprintError) {
      // We could not verify the final state of the project database.
      failure = failure ?? new S12IsolationError(`could not verify prisma/dev.db after the run: ${errorMessageOrCode(fingerprintError)}`);
      console.error("[s12-isolated] PROJECT DATABASE STATE COULD NOT BE VERIFIED. Do not assume it was untouched.");
    } else if (!sameFingerprint(before, after)) {
      failure = failure ?? new S12IsolationError("prisma/dev.db changed during the run — isolation was violated");
      console.error("[s12-isolated] PROJECT DATABASE CHANGED. Investigate before trusting any result.");
    } else {
      log(`project database untouched: sha256=${after.sha256.slice(0, 12)} size=${after.size}`);
    }

    // --- temp artifact retention/removal ---
    let artifactRemovalError = null;
    const directChildExitWasConfirmed = directChildExitConfirmed;

    if (cleanupRequirementsMet(directChildExitWasConfirmed, portReleaseConfirmed, port)) {
      if (keepArtifacts) {
        log(`keeping artifacts: ${tempDir} (server logs, if any, are inside that directory)`);
      } else {
        try {
          await rm(tempDir, { recursive: true, force: true });
          log("temp database and artifacts removed");
        } catch (error) {
          artifactRemovalError = error;
          console.error(`[s12-isolated] temporary artifacts could not be removed; preserving ${tempDir}`);
          failure = failure ?? new S12IsolationError(`temporary artifacts could not be removed: ${errorMessageOrCode(error)}`);
        }
      }
    } else {
      // Termination was not confirmed. Temporary-directory deletion is gated on direct-child
      // exit confirmation plus port release (when a port was used). None of these are skipped,
      // and none of these is treated as proved by a successful signal, child.killed, a short
      // delay, or an inconclusive wait result.
      console.error(
        `\n[s12-isolated] TERMINATION NOT CONFIRMED. ` +
          `Preserving the temporary database at ${tempDir} so it can be inspected. ` +
          `The direct spawned server child had pid ${child?.pid ?? "unknown"}.`,
      );
      if (port == null) {
        console.error("[s12-isolated] no port was allocated; cannot confirm port release");
      } else if (!portReleaseConfirmed) {
        console.error(`[s12-isolated] port ${port} could not be confirmed as released`);
      }
      if (!directChildExitWasConfirmed) {
        console.error("[s12-isolated] direct spawned child exit was not confirmed within the bounded wait");
      }
      if (cleanupError) {
        console.error(`[s12-isolated] cleanup was incomplete or failed: ${errorMessageOrCode(cleanupError)}`);
      }

      // Unconfirmed or inconclusive cleanup is a verification failure. The temporary DB is
      // preserved, but the run must not be reported as passing.
      failure = failure ?? new S12IsolationError(
        `process cleanup was not fully confirmed; temporary artifacts remain at ${tempDir}`,
      );
    }

    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    if (failure) {
      if (artifactRemovalError) {
        console.error(`\n[s12-isolated] temp artifacts remain at ${tempDir}: ${errorMessageOrCode(artifactRemovalError)}`);
      }
      if (fingerprintError) {
        console.error(`\n[s12-isolated] final project-database verification failed: ${errorMessageOrCode(fingerprintError)}`);
      }
      if (cleanupError) {
        console.error(`\n[s12-isolated] cleanup itself failed: ${errorMessageOrCode(cleanupError)}`);
      }
      console.error(`\n[s12-isolated] FAILED after ${seconds}s: ${failure.message}`);
      if (s12Exit !== null) console.error(`[s12-isolated] api exit=${s12Exit}`);
    } else if (artifactRemovalError) {
      failure = new S12IsolationError(`temporary artifacts could not be removed: ${errorMessageOrCode(artifactRemovalError)}`);
      console.error(`\n[s12-isolated] FAILED after ${seconds}s: temporary artifacts remain at ${tempDir}`);
      console.error(`[s12-isolated] temp artifacts were not removed: ${errorMessageOrCode(artifactRemovalError)}`);
    } else if (fingerprintError) {
      failure = new S12IsolationError(`final project-database verification failed: ${errorMessageOrCode(fingerprintError)}`);
      console.error(`\n[s12-isolated] FAILED after ${seconds}s: final project-database verification failed`);
      console.error(`[s12-isolated] final project-database verification failed: ${errorMessageOrCode(fingerprintError)}`);
    } else if (cleanupError) {
      failure = new S12IsolationError(`cleanup itself failed: ${errorMessageOrCode(cleanupError)}`);
      console.error(`\n[s12-isolated] FAILED after ${seconds}s: cleanup itself failed`);
      console.error(`[s12-isolated] cleanup itself failed: ${errorMessageOrCode(cleanupError)}`);
    } else {
      console.log(`\n[s12-isolated] S-12 ONLY PASSED in ${seconds}s (isolated DB, api=0, prisma/dev.db untouched)`);
    }

    if (failure) {
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(`[s12-isolated] crashed: ${error.message}`);
  process.exit(1);
});
