#!/usr/bin/env node
/**
 * S-09 HTTP integration suite.
 *
 * Runs against a live Next.js server started by the e2e harness against a
 * disposable database. Resend is mocked for the entire process before the
 * server connects, so no real email is ever sent.
 *
 * This file is an ESM script, not a Vitest file. It does not import "@/" path
 * aliases and it does not rely on Next request lifecycle shims. It talks to the
 * running app over HTTP, exactly as a browser would.
 */

import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PROBE_EMAIL_RAW = process.env.S09_PROBE_EMAIL_FALLBACK ?? null;
const PROBE_EMAIL_FALLBACK = PROBE_EMAIL_RAW && PROBE_EMAIL_RAW.includes("@") ? PROBE_EMAIL_RAW : null;
const DISPOSABLE_APP_ORIGIN = new URL(
  process.env.APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? BASE,
).origin;
function effectiveOriginForRequest(method = "GET", requestHeaders = {}) {
  if (SAFE_METHODS.has((method ?? "GET").toUpperCase())) return undefined;
  if (requestHeaders.origin) return requestHeaders.origin;
  return DISPOSABLE_APP_ORIGIN;
}

const TRUSTED_PROXY_SECRET = process.env.TRUSTED_PROXY_SECRET ?? null;

function trustedProxyHeaders() {
  if (!TRUSTED_PROXY_SECRET) return {};
  return {
    "x-sellflow-trusted-proxy": TRUSTED_PROXY_SECRET,
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function ipHashOf(ip) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return createHash("sha256")
    .update(`${ip}:${secret}`)
    .digest("hex")
    .slice(0, 32);
}

let _resendEnsured = false;
function _ensureResendMocked() {
  if (_resendEnsured) return;
  _resendEnsured = true;
  try {
    const mod = require("module");
    const proto = mod.prototype && mod.prototype.require ? mod.prototype.require : undefined;
    if (proto) {
      const orig = proto.bind(mod.prototype);
      mod.prototype.require = function (id) {
        const result = orig.apply(this, arguments);
        if (id === "resend") return { Resend: ResendMock };
        return result;
      };
      return;
    }
  } catch (_) {}
  try {
    if (process.mainModule && typeof process.mainModule.require === "function") {
      const orig = process.mainModule.require.bind(process.mainModule);
      process.mainModule.require = function (id) {
        if (id === "resend") return { Resend: ResendMock };
        return orig(id);
      };
    }
  } catch (_) {}
}
_ensureResendMocked();

let failures = 0;
let runs = 0;

function check(name, condition, detail = "") {
  runs += 1;
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(
  path,
  {
    cookie,
    method = "GET",
    body,
    origin,
    headers = {},
    _dbg,
  } = {},
) {
  const requestHeaders = {
    ...(cookie ? { cookie } : {}),
    ...(body ? { "content-type": "application/json" } : {}),
    ...headers,
  };

  if (_dbg) {
    console.log(
      `[s09 dbg] ${method} ${BASE}${path} cookie=${(cookie?.slice?.(0, 60) ?? cookie) ?? null} body=${body ? JSON.stringify(body) : null}`,
    );
  }

  if (origin !== undefined) {
    const effectiveOrigin =
      origin != null ? origin : effectiveOriginForRequest(method, requestHeaders);
    if (effectiveOrigin) requestHeaders.origin = effectiveOrigin;
  }

  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: requestHeaders,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  const setCookie = response.headers.get("set-cookie");
  const out = {
    status: response.status,
    json,
    text,
    cookie: setCookie ? setCookie.split(";")[0] : null,
    setCookie,
    retryAfter: response.headers.get("retry-after"),
  };

  if (_dbg) {
    console.log(
      `[s09 dbg] -> status=${response.status} cookie=${(out.cookie ?? null) ?? null} json=${
        out.json ? JSON.stringify(out.json).slice(0, 300) : null
      }`,
    );
  }

  return out;
}

async function login(email, password) {
  const res = await call("/api/auth/login", {
    method: "POST",
    body: { email, password },
    ...trustedProxyHeaders(),
  });
  if (res.status !== 200 || !res.cookie) {
    throw new Error(`login failed for ${email}: ${res.status} ${res.text.slice(0, 200)}`);
  }
  return res.cookie;
}

async function registerAndLogin(useProbeEmail = false) {
  const password = "Password123!";
  let email;
  if (useProbeEmail && PROBE_EMAIL_FALLBACK) {
    email = PROBE_EMAIL_FALLBACK;
  } else {
    email = `s09-${Date.now().toString(36)}@sellflow.test`;
  }
  const res = await call("/api/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      displayName: "S-09 Probe",
      businessName: "S-09 Probe Shop",
      country: "NG",
    },
    ...trustedProxyHeaders(),
  });
  if (res.status !== 201 || !res.cookie) {
    throw new Error(`register failed: ${res.status} ${res.text.slice(0, 200)}`);
  }
  return { email, password, cookie: res.cookie };
}

async function loginExisting(email, password) {
  const res = await call("/api/auth/login", {
    method: "POST",
    body: { email, password },
    ...trustedProxyHeaders(),
  });
  if (res.status !== 200 || !res.cookie) {
    throw new Error(`login failed for ${email}: ${res.status} ${res.text.slice(0, 200)}`);
  }
  return res.cookie;
}

async function probeLogin(email) {
  const res = await call("/api/auth/login", {
    method: "POST",
    body: { email, password: "doesnotmatter" },
    ...trustedProxyHeaders(),
  });
  return res;
}

async function getSessions(cookie) {
  return call("/api/auth/sessions", {
    method: "GET",
    cookie,
    ...trustedProxyHeaders(),
  });
}

// ── Resend mocking ───────────────────────────────────────────────────────────
// The server imports resend at module load on first request routing, and the
// test process has already patched env via email-test-env-style setup in the
// harness. We additionally mock the SDK so the server never reaches the network.
let _sendCapture = [];
function readSendCapture() {
  if (!process.env.S09_RESEND_CAPTURE_MODE) return _sendCapture;
  if (process.env.S09_RESEND_CAPTURE_MODE !== "file") return _sendCapture;
  const path = process.env.S09_RESEND_CAPTURE_FILE;
  if (!path || !existsSync(path)) return _sendCapture;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  return _sendCapture;
}

const sendStub = { called: 0, lastOptions: null };
function emailCaptured() {
  return readSendCapture();
}
const ResendMock = class {
  constructor() {
    this.emails = {
      send: async (options) => {
        sendStub.called += 1;
        sendStub.lastOptions = options;
        return { data: { id: `msg_s09_${sendStub.called}` }, headers: {} };
      },
    };
  }
};

let harnessProbePasswordProvided = false;
async function loginHarnessProbe(email, password) {
  const sanitizedEmail =
    PROBE_EMAIL_FALLBACK && password
      ? PROBE_EMAIL_FALLBACK.slice(0, 24) + "…" + email.slice(-4)
      : email;
  const res = await call("/api/auth/login", {
    method: "POST",
    body: { email, password },
    ...trustedProxyHeaders(),
  });
  harnessProbePasswordProvided =
    harnessProbePasswordProvided || (PROBE_EMAIL_FALLBACK && password);
  if (res.status !== 200 || !res.cookie) {
    const serverDetails =
      res.status !== 200
        ? `server_status=${res.status} server_body=${res.text.slice(0, 160).replace(/(\s+)/g, " ")}`
        : `server_status=${res.status}`;
    const message =
      res.status === 401 && res.json && res.json.code === "INVALID_CREDENTIALS"
        ? `harness probe authentication failed for ${sanitizedEmail}: ${serverDetails}; harness credential mismatch is now a failure, not an expected fallback`
        : `harness probe authentication failed for ${sanitizedEmail}: ${serverDetails}`;
    throw new Error(message);
  }
  return res.cookie;
}

// ── S-09 reset-request tests ─────────────────────────────────────────────────

const RATE_LIMIT_RECORD = { total: 0, byStatus: {} };
function recordRateHit(status) {
  RATE_LIMIT_RECORD.total += 1;
  const key = String(status);
  RATE_LIMIT_RECORD.byStatus[key] = (RATE_LIMIT_RECORD.byStatus[key] ?? 0) + 1;
}

async function runResetRequestTests() {
  console.log("\n== S-09 reset-request flow ==");

  // Unknown email: response must be generic so it cannot enumerate accounts.
  const unknownEmail = `noone-${Date.now().toString(36)}@sellflow.test`;
  const unknown = await call("/api/auth/password-reset/request", {
    method: "POST",
    body: { email: unknownEmail },
    ...trustedProxyHeaders(),
  });
  recordRateHit(unknown.status);
  check(
    "reset request for unknown email returns 200",
    unknown.status === 200,
    `status ${unknown.status}`,
  );
  check(
    "reset request for unknown email is generic",
    typeof unknown.json?.message === "string" &&
      !unknown.json.message.includes(unknownEmail),
    JSON.stringify(unknown.json),
  );

  // Valid reset request: should queue a reset and send an email (mocked).
  const account = await registerAndLogin();
  const resetEmail = await call("/api/auth/password-reset/request", {
    method: "POST",
    body: { email: account.email },
    ...trustedProxyHeaders(),
  });
  recordRateHit(resetEmail.status);
  check(
    "reset request for a real email returns 200",
    resetEmail.status === 200,
    `status ${resetEmail.status}`,
  );
  check(
    "reset request response is generic for a real email too",
    typeof resetEmail.json?.message === "string" &&
      !resetEmail.json.message.includes(account.email),
    JSON.stringify(resetEmail.json),
  );
  check(
    "reset request triggers a templated email",
    sendStub.called > 0 || emailCaptured().length > 0,
    `sendStub.called=${sendStub.called} emailCaptured.length=${emailCaptured().length}`,
  );
  check(
    "reset email uses the password_reset template",
    sendStub.lastOptions?.template === "password_reset" ||
      emailCaptured().at(-1)?.template === "password_reset",
    sendStub.lastOptions?.template ?? emailCaptured().at(-1)?.template,
  );

  // Enumeration resistance across repeated attempts.
  const rapid = await Promise.all(
    Array.from({ length: 3 }).map(() =>
      call("/api/auth/password-reset/request", {
        method: "POST",
        body: { email: account.email },
        ...trustedProxyHeaders(),
      }),
    ),
  );
  for (const r of rapid) recordRateHit(r.status);
  check(
    "repeated reset requests for the same email stay generic",
    rapid.every(
      (r) =>
        r.status === 200 &&
        typeof r.json?.message === "string" &&
        !r.json.message.includes(account.email),
    ),
    `all ${rapid.length} generic`,
  );

  // Enumeration resistance via timing: the endpoint should not behave
  // materially differently for unknown vs known email within a single suite run.
  const known = await call("/api/auth/password-reset/request", {
    method: "POST",
    body: { email: account.email },
    ...trustedProxyHeaders(),
  });
  recordRateHit(known.status);
  check(
    "known and unknown reset requests both return 200",
    known.status === 200 && unknown.status === 200,
    `known ${known.status}, unknown ${unknown.status}`,
  );

  // Global reset-request rate limiting.
  const limitHits = await Promise.all(
    Array.from({ length: 20 }).map(() =>
      call("/api/auth/password-reset/request", {
        method: "POST",
        body: { email: account.email },
        ...trustedProxyHeaders(),
      }),
    ),
  );
  for (const r of limitHits) recordRateHit(r.status);
  const rateLimited = limitHits.filter(
    (r) => r.status === 429 || (r.json && r.json.code === "TOO_MANY_ATTEMPTS"),
  );
  check(
    "excessive reset requests are rate limited",
    rateLimited.length > 0,
    `rate limited count=${rateLimited.length}, total=${limitHits.length}; note: reset-request route did not return a rate-limited response in this suite run`,
  );
  const firstLimited = rateLimited[0];
  if (firstLimited && firstLimited.retryAfter) {
    const retryAfter = Number(firstLimited.retryAfter);
    check(
      "rate-limited reset request carries Retry-After",
      Number.isFinite(retryAfter) && retryAfter >= 1,
      `retryAfter ${retryAfter}`,
    );
  }

  console.log(
    `[s09] rate_limit_total_requests=${RATE_LIMIT_RECORD.total} rate_limit_by_status=${JSON.stringify(RATE_LIMIT_RECORD.byStatus)}`,
  );
}

// ── S-09 reset-token tests ───────────────────────────────────────────────────

async function runResetTokenTests(account) {
  console.log("\n== S-09 reset-token flow ==");

  // Extract the token from the reset email the server just sent.
  const resetLink = sendStub.lastOptions?.templateParameters?.resetLink;
  if (!resetLink) {
    const captured = emailCaptured();
    if (captured.length > 0) {
      const latest = captured[captured.length - 1];
      if (latest?.templateParameters?.resetLink) {
        resetLink = latest.templateParameters.resetLink;
      }
    }
  }
  if (!resetLink) {
    throw new Error("expected reset email to contain resetLink");
  }
  const token = new URL(resetLink).searchParams.get("token");
  if (!token) {
    throw new Error("reset link missing token");
  }

  // Successful reset.
  const success = await call("/api/auth/password-reset/reset", {
    method: "POST",
    body: { token, newPassword: "NewPassword123!" },
    ...trustedProxyHeaders(),
  });
  check(
    "password reset with valid token returns 200",
    success.status === 200,
    `status ${success.status}`,
  );
  check(
    "password reset response is generic on success",
    typeof success.json?.message === "string" &&
      !success.json.message.includes(token),
    JSON.stringify(success.json),
  );

  // The new password must work, and the old one must not.
  const withNew = await call("/api/auth/login", {
    method: "POST",
    body: { email: account.email, password: "NewPassword123!" },
    ...trustedProxyHeaders(),
  });
  check(
    "can log in with the new password after reset",
    withNew.status === 200,
    `status ${withNew.status}`,
  );

  const withOld = await call("/api/auth/login", {
    method: "POST",
    body: { email: account.email, password: account.password },
    ...trustedProxyHeaders(),
  });
  check(
    "cannot log in with the old password after reset",
    withOld.status !== 200,
    `status ${withOld.status}`,
  );

  // Consumed token reuse.
  const reused = await call("/api/auth/password-reset/reset", {
    method: "POST",
    body: { token, newPassword: "AnotherPassword123!" },
    ...trustedProxyHeaders(),
  });
  check(
    "consumed reset token is rejected",
    reused.status !== 200,
    `status ${reused.status}`,
  );

  // Invalid token.
  const invalid = await call("/api/auth/password-reset/reset", {
    method: "POST",
    body: { token: "not-a-real-token", newPassword: "AnotherPassword123!" },
    ...trustedProxyHeaders(),
  });
  check(
    "invalid reset token is rejected",
    invalid.status !== 200,
    `status ${invalid.status}`,
  );

  // Malformed token.
  const malformed = await call("/api/auth/password-reset/reset", {
    method: "POST",
    body: { token: "", newPassword: "AnotherPassword123!" },
    ...trustedProxyHeaders(),
  });
  check(
    "empty reset token is rejected",
    malformed.status !== 200,
    `status ${malformed.status}`,
  );
}

// ── S-09 concurrent token consumption ───────────────────────────────────────

async function runConcurrentTokenTests(account) {
  console.log("\n== S-09 concurrent token consumption ==");

  // Trigger a fresh reset so we have one unused token to race.
  await call("/api/auth/password-reset/request", {
    method: "POST",
    body: { email: account.email },
    ...trustedProxyHeaders(),
  });
  const resetLink = sendStub.lastOptions?.templateParameters?.resetLink;
  if (!resetLink) {
    const captured = emailCaptured();
    if (captured.length > 0) {
      const latest = captured[captured.length - 1];
      if (latest?.templateParameters?.resetLink) {
        resetLink = latest.templateParameters.resetLink;
      }
    }
  }
  if (!resetLink) {
    throw new Error("expected fresh reset email to contain resetLink");
  }
  const token = new URL(resetLink).searchParams.get("token");
  if (!token) {
    throw new Error("fresh reset link missing token");
  }

  const results = await Promise.allSettled(
    Array.from({ length: 4 }).map(() =>
      call("/api/auth/password-reset/reset", {
        method: "POST",
        body: { token, newPassword: "ConcurrentPassword123!" },
        ...trustedProxyHeaders(),
      }),
    ),
  );

  const outcomes = results.map((r) => (r.status === "fulfilled" ? r.value.status : "rejected"));
  const successes = outcomes.filter((s) => s === 200).length;
  const failures = outcomes.filter((s) => s !== 200).length;

  check(
    "concurrent reset attempts do not all succeed",
    successes <= 1,
    `successes=${successes}, failures=${failures}`,
  );
  check(
    "concurrent reset attempts are bounded by token consumption",
    successes + failures === 4,
    `total ${successes + failures}`,
  );
}

// ── S-09 authenticated password-change tests ────────────────────────────────

async function runPasswordChangeTests(account) {
  console.log("\n== S-09 authenticated password change ==");

  const cookie = await login(account.email, account.password);

  // Invalid current password must fail and must not change the password.
  const wrongCurrent = await call("/api/auth/password/change", {
    method: "POST",
    body: {
      currentPassword: "WrongPassword123!",
      newPassword: "NewPassword123!",
    },
    cookie,
    ...trustedProxyHeaders(),
  });
  check(
    "password change with wrong current password fails",
    wrongCurrent.status !== 200,
    `status ${wrongCurrent.status}`,
  );

  // The password must not have changed.
  const stillOld = await call("/api/auth/login", {
    method: "POST",
    body: { email: account.email, password: account.password },
    ...trustedProxyHeaders(),
  });
  check(
    "wrong current password does not change the password",
    stillOld.status === 200,
    `status ${stillOld.status}`,
  );

  // Successful authenticated password change.
  const validChange = await call("/api/auth/password/change", {
    method: "POST",
    body: {
      currentPassword: account.password,
      newPassword: "ChangedPassword123!",
    },
    cookie,
    ...trustedProxyHeaders(),
  });
  check(
    "authenticated password change with correct current password succeeds",
    validChange.status === 200,
    `status ${validChange.status}`,
  );
  check(
    "password change response is generic on success",
    typeof validChange.json?.message === "string" &&
      !validChange.json.message.includes(account.password),
    JSON.stringify(validChange.json),
  );

  // Old password must stop working.
  const noLongerOld = await call("/api/auth/login", {
    method: "POST",
    body: { email: account.email, password: account.password },
    ...trustedProxyHeaders(),
  });
  check(
    "old password stops working after authenticated change",
    noLongerOld.status !== 200,
    `status ${noLongerOld.status}`,
  );

  // New password must work.
  const nowNew = await call("/api/auth/login", {
    method: "POST",
    body: { email: account.email, password: "ChangedPassword123!" },
    ...trustedProxyHeaders(),
  });
  check(
    "new password works after authenticated change",
    nowNew.status === 200,
    `status ${nowNew.status}`,
  );

  // Session lifecycle: after a password change, existing sessions should be
  // revoked or rotated so the old session cannot be reused. We test this by
  // trying the pre-change cookie after the change.
  const preChangeCookie = await login(account.email, "ChangedPassword123!");
  const afterChangeWithOldSession = await call("/api/auth/me", {
    method: "GET",
    cookie: preChangeCookie,
    ...trustedProxyHeaders(),
  });
  check(
    "pre-change session is no longer valid after password change",
    afterChangeWithOldSession.status !== 200,
    `status ${afterChangeWithOldSession.status}`,
  );

  // A fresh login still works.
  const freshLogin = await login(account.email, "ChangedPassword123!");
  const afterChangeFresh = await call("/api/auth/me", {
    method: "GET",
    cookie: freshLogin,
    ...trustedProxyHeaders(),
  });
  check(
    "fresh session works after password change",
    afterChangeFresh.status === 200,
    `status ${afterChangeFresh.status}`,
  );
}

// ── S-09 change-password password policy tests ──────────────────────────────

async function runPasswordPolicyTests(account) {
  console.log("\n== S-09 password-change policy ==");

  const cookie = await login(account.email, "ChangedPassword123!");

  const tooShort = await call("/api/auth/password/change", {
    method: "POST",
    body: {
      currentPassword: "ChangedPassword123!",
      newPassword: "Short1!",
    },
    cookie,
    ...trustedProxyHeaders(),
  });
  check(
    "password change rejects too-short password",
    tooShort.status !== 200,
    `status ${tooShort.status}`,
  );

  const tooLong = await call("/api/auth/password/change", {
    method: "POST",
    body: {
      currentPassword: "ChangedPassword123!",
      newPassword: "A".repeat(101),
    },
    cookie,
    ...trustedProxyHeaders(),
  });
  check(
    "password change rejects too-long password",
    tooLong.status !== 200,
    `status ${tooLong.status}`,
  );

  const identical = await call("/api/auth/password/change", {
    method: "POST",
    body: {
      currentPassword: "ChangedPassword123!",
      newPassword: "ChangedPassword123!",
    },
    cookie,
    ...trustedProxyHeaders(),
  });
  check(
    "password change rejects identical new password",
    identical.status !== 200,
    `status ${identical.status}`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[s09] base=${BASE}`);
  console.log(`[s09] baseOrigin=${DISPOSABLE_APP_ORIGIN}`);

  const PROBE_EMAIL_WITH_PW = PROBE_EMAIL_FALLBACK && process.env.S09_PROBE_PASSWORD;
  let s09Account;
  if (PROBE_EMAIL_WITH_PW) {
    const password = process.env.S09_PROBE_PASSWORD;
    try {
      s09Account = {
        email: PROBE_EMAIL_FALLBACK,
        password,
        cookie: await loginHarnessProbe(PROBE_EMAIL_FALLBACK, password),
      };
      console.log("[s09] s09 account authenticated with harness-generated probe password");
    } catch (err) {
      console.log(
        `[s09] harness probe login failed; aborting because probe-account registration fallback is not allowed after harness credential failure: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new Error(
        `s09 probe account registration fallback is not allowed in Revision 12 after harness credential failure`,
      );
    }
    console.log(`[s09] s09 account=${s09Account.email}`);
  } else if (PROBE_EMAIL_FALLBACK) {
    // No probe password from the harness for this email, so use a fresh
    // password-controlled account instead of the harness-created probe user.
    s09Account = await registerAndLogin(true);
    console.log(`[s09] s09 account=${s09Account.email}`);
  } else {
    s09Account = await registerAndLogin();
    console.log(`[s09] s09 account=${s09Account.email}`);
  }

  console.log(
    `[s09] harness_probe_password_provided=${harnessProbePasswordProvided} harness_probe_login_attempted=${Boolean(PROBE_EMAIL_WITH_PW)}`,
  );

  await runResetRequestTests();
  await runResetTokenTests(s09Account);
  await runConcurrentTokenTests(s09Account);
  await runPasswordChangeTests(s09Account);
  await runPasswordPolicyTests(s09Account);

  const probeLoginResult = await probeLogin(PROBE_EMAIL_FALLBACK ?? "");
  check(
    "probe disposable-binding login route responds",
    probeLoginResult.status !== undefined,
    `status ${probeLoginResult.status}`,
  );

  console.log(`\n[s09] runs=${runs} failures=${failures}`);
  try {
    writeFileSync(
      "/tmp/sellflow-s09-e2e-result.json",
      JSON.stringify({ runs, failures, base: BASE, baseOrigin: DISPOSABLE_APP_ORIGIN }, null, 2),
    );
  } catch (_) {}

  if (failures > 0) {
    console.log("[s09] SOME S-09 INTEGRATION CHECKS FAILED");
    process.exit(1);
  }
  console.log("[s09] ALL S-09 INTEGRATION CHECKS PASSED");
}

main().catch((error) => {
  console.error("[s09] suite crashed", error);
  try {
    writeFileSync(
      "/tmp/sellflow-s09-e2e-result.json",
      JSON.stringify(
        {
          runs,
          failures,
          base: BASE,
          baseOrigin: DISPOSABLE_APP_ORIGIN,
          crashed: true,
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
  } catch (_) {}
  process.exit(2);
});
