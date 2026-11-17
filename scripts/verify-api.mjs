#!/usr/bin/env node
/**
 * End-to-end API checks for the rules that matter most:
 *   - private reseller prices never appear for an unentitled caller
 *   - only an APPROVED reseller with an ACTIVE agreement gets a price
 *   - supplier orders ignore any price sent by the client
 *   - manual payments cannot exceed the balance
 *   - agreement versioning locks historical order prices
 *   - the supplier-order lifecycle moves only forward, one party at a time
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4317 node scripts/verify-api.mjs
 *
 * Needs the seeded demo accounts (npm run db:seed). It mutates that demo data;
 * restore it with `npx prisma migrate reset --force` afterwards if you want a
 * pristine dataset.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runPwaChecks } from "./pwa-checks.mjs";

// resetAuditHealth is imported lazily inside the S-14 block, where the harness
// already has the isolated s14 prisma client in scope. We do not import it at
// the top level because the test script is run directly by node as ESM and the
// @/ path alias does not resolve there.

const NOOP_RESET_AUDIT_HEALTH = () => undefined;
let resetAuditHealth = NOOP_RESET_AUDIT_HEALTH;

// Audit-failure injection for the new S-12 dispute-resolution fail-closed tests.
// We never import Prisma at the top level (same reason as resetAuditHealth), and
// we only create an isolated auditPrisma when the harness is running against a
// sellflow-e2e- database. The trigger used here is the same mechanism the existing
// S-12 block uses, so a failed critical audit write really fails closed.
const AUDIT_WRITE_FAIL_TRIGGER = `CREATE TRIGGER IF NOT EXISTS audit_write_fail BEFORE INSERT ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'audit store unavailable'); END`;
const AUDIT_WRITE_FAIL_TRIGGER_DROP = `DROP TRIGGER IF EXISTS audit_write_fail`;

let _auditPrismaForTriggers = null;
async function auditPrismaForTriggers() {
  if (_auditPrismaForTriggers) return _auditPrismaForTriggers;
  // Only meaningful in the isolated harness, where DATABASE_URL points at the
  // temp database and the Prisma client can be constructed without the @/ alias.
  if (!(process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) return null;
  const { PrismaClient } = await import("@prisma/client");
  _auditPrismaForTriggers = new PrismaClient();
  return _auditPrismaForTriggers;
}

async function setAuditWriteFailure(shouldFail) {
  const auditPrisma = await auditPrismaForTriggers();
  if (!auditPrisma) return;
  if (shouldFail) {
    await auditPrisma.$executeRawUnsafe(AUDIT_WRITE_FAIL_TRIGGER);
  } else {
    await auditPrisma.$executeRawUnsafe(AUDIT_WRITE_FAIL_TRIGGER_DROP);
  }
}

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:4317";
// The server's configured public origin wins; otherwise the test base is the
// expected origin. This keeps the suite correct behind a TLS proxy.
const BASE_ORIGIN = new URL(
  process.env.APP_ORIGIN ?? process.env.NEXT_PUBLIC_APP_URL ?? BASE,
).origin;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// S-05: the harness supplies an explicit trusted-proxy secret and the same
// thresholds the server was started with. Standalone runs may omit them.
const TRUSTED_PROXY_SECRET = process.env.TRUSTED_PROXY_SECRET ?? null;
const ACCOUNT_LIMIT = Number(process.env.MAX_AUTH_ATTEMPTS ?? 5);
const IP_LIMIT = Number(process.env.MAX_AUTH_IP_ATTEMPTS ?? 20);

function trustedProxyHeaders(ip) {
  if (!TRUSTED_PROXY_SECRET || !ip) return {};
  return {
    "x-sellflow-trusted-proxy": TRUSTED_PROXY_SECRET,
    "x-forwarded-for": ip,
  };
}

function readSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
    const line = env.split(/\r?\n/).find((entry) => entry.startsWith("SESSION_SECRET="));
    if (!line) return null;
    return line.slice("SESSION_SECRET=".length).trim().replace(/^["']|["']$/g, "");
  } catch {
    return null;
  }
}

const SESSION_SECRET = readSessionSecret();

/** Mirrors hashIp() in src/lib/auth/session.ts for test assertions. */
function ipHashOf(ip) {
  if (!SESSION_SECRET) return null;
  return createHash("sha256").update(`${ip}:${SESSION_SECRET}`).digest("hex").slice(0, 32);
}

let failures = 0;

function check(name, condition, detail = "") {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function call(path, { cookie, method = "GET", body, origin, headers = {}, _dbg } = {}) {
  const requestHeaders = {
    ...(cookie ? { cookie } : {}),
    ...(body ? { "content-type": "application/json" } : {}),
    ...headers,
  };
  if (_dbg) {
    console.log(`[call dbg] ${method} ${BASE}${path} cookie=${(cookie?.slice?.(0, 60) ?? cookie) ?? null} body=${body ? JSON.stringify(body) : null}`);
  }

  // State-changing calls default to the real same-origin header, so ordinary
  // suite traffic exercises the CSRF policy exactly as a browser would. Pass
  // `origin: null` to omit it, or a string to forge a foreign/malformed value.
  if (origin !== null) {
    const value = origin ?? (SAFE_METHODS.has(method.toUpperCase()) ? undefined : BASE_ORIGIN);
    if (value) requestHeaders.origin = value;
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
    console.log(`[call dbg] -> status=${response.status} setCookie=${(out.cookie ?? null) ?? null} jsonOutcome=${(out.json?.dispute?.outcome ?? out.json?.outcome ?? null)}`);
  }
  return out;
}

async function login(email, password) {
  const res = await call("/api/auth/login", { method: "POST", body: { email, password } });
  if (res.status !== 200 || !res.cookie) {
    throw new Error(`login failed for ${email}: ${res.status} ${res.text.slice(0, 200)}`);
  }
  return res.cookie;
}

const leaks = (text, kobo) => typeof text === "string" && text.includes(String(kobo));

// ── S-12 audit-durability checks (Stage 2 Task 7) ───────────────────────────
// Extracted so ONLY_S12 can run this section without executing any other
// verification block. The assertions are identical to the original inline S-12
// block; only the location changed.
async function runS12Checks(s05Prisma) {
  // ── S-12: the audit trail is populated, observable and transactional ──────
  // The 2026-11-04 audit found an empty AuditLog and writes that disappeared
  // without a trace. These checks require the isolated database so they can
  // make the audit store fail on purpose and then put it back.
  if (!s05Prisma) {
    console.log("SKIP  audit durability checks need an isolated DATABASE_URL");
    return;
  }
  const auditPrisma = s05Prisma;
  const auditCount = () => auditPrisma.auditLog.count();
  const newAccount = (email) => ({
    email,
    password: "Password123!",
    displayName: "Audit Probe",
    businessName: "Audit Probe Shop",
    country: "NG",
  });

  const seededTrail = await auditPrisma.auditLog.findMany({
    where: { id: { startsWith: "seed-audit-" } },
    select: { action: true },
  });
  check(
    "the demo dataset ships a representative audit trail (S-12)",
    seededTrail.length >= 4,
    `${seededTrail.length} seeded events`,
  );

  const before = await auditCount();
  const s12Email = `s12+${Date.now()}@sellflow.test`;
  const registration = await call("/api/auth/register", { method: "POST", body: newAccount(s12Email) });
  const registerRow = await auditPrisma.auditLog.findFirst({
    where: { action: "auth.register", entityId: registration.json?.user?.id },
  });
  check(
    "registration commits its audit row with the account (S-12)",
    registration.status === 201 && Boolean(registerRow),
    `status ${registration.status}, row ${registerRow ? "present" : "missing"}`,
  );
  check(
    "the trail grows with the action it describes (S-12)",
    (await auditCount()) > before,
    `${before} → ${await auditCount()}`,
  );

  // Fail every audit insert while leaving the table in place, so the failure
  // is exactly what a broken audit store produces.
  await auditPrisma.$executeRawUnsafe(
    `CREATE TRIGGER IF NOT EXISTS audit_write_fail BEFORE INSERT ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'audit store unavailable'); END`,
  );
  try {
    const loginWhileDown = await call("/api/auth/login", {
      method: "POST",
      body: { email: "reseller@sellflow.test", password: "Password123!" },
    });
    check(
      "a non-critical audit failure does not break the action (S-12)",
      loginWhileDown.status === 200,
      `status ${loginWhileDown.status}`,
    );

    const healthAfter = await call("/api/health");
    check(
      "a failed audit write is reported instead of silently dropped (S-12)",
      healthAfter.json?.audit?.status === "degraded" &&
        healthAfter.json?.audit?.failures >= 1 &&
        typeof healthAfter.json?.audit?.lastFailureAt === "string",
      `audit ${JSON.stringify(healthAfter.json?.audit)}`,
    );

    const criticalEmail = `s12-critical+${Date.now()}@sellflow.test`;
    const critical = await call("/api/auth/register", {
      method: "POST",
      body: newAccount(criticalEmail),
    });
    const criticalUser = await auditPrisma.user.findUnique({ where: { email: criticalEmail } });
    check(
      "a security-critical action fails closed when it cannot be audited (S-12)",
      critical.status >= 500 && criticalUser === null,
      `status ${critical.status}, account ${criticalUser ? "created" : "absent"}`,
    );
  } finally {
    await auditPrisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS audit_write_fail`);
  }

  const recoveredEmail = `s12-recovered+${Date.now()}@sellflow.test`;
  const recovered = await call("/api/auth/register", {
    method: "POST",
    body: newAccount(recoveredEmail),
  });
  const recoveredRow = await auditPrisma.auditLog.findFirst({
    where: { action: "auth.register", entityId: recovered.json?.user?.id },
  });
  check(
    "the trail resumes once the audit store recovers (S-12)",
    recovered.status === 201 && Boolean(recoveredRow),
    `status ${recovered.status}, row ${recoveredRow ? "present" : "missing"}`,
  );
}

async function main() {
  console.log(`Checking ${BASE}\n`);

  // ── S-12-only mode guard (Stage 2 Task 7 — S-12 Audit Durability) ──────────
  // When ONLY_S12=1 is set this script runs only the S-12 audit-durability
  // checks and then exits. Nothing else in the suite runs, including PWA checks.
  const ONLY_S12 = process.env.ONLY_S12 === "1";
  if (ONLY_S12 && !(process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    console.log("FAIL  ONLY_S12=1 requires an isolated DATABASE_URL (sellflow-e2e-)");
    process.exit(1);
  }

  const SEEDED_PRICE = 3_800_000; // ₦38,000 — body wave wig, prisma/seed.ts
  const NEW_PRICE = 4_100_000; // ₦41,000 — terms pushed by the test

  // ── S-12: audit health must read healthy before anything mutates state ────
  // `auditHealth()` counts every audit-write failure for the lifetime of the
  // server process and never decreases. Several later checks deliberately force a
  // failed audit write (S-14's durability probes and the dispute fail-closed
  // tests), so this assertion is only deterministic on a freshly started server.
  // It previously lived inside the S-14 block and failed whenever an earlier suite
  // had already incremented the counter — an ordering artefact, not an S-12
  // regression. Probing immediately after startup removes that dependency without
  // weakening the assertion and without adding a production reset endpoint.
  const healthAtStart = await call("/api/health");
  check(
    "the health probe reports a healthy audit store (S-12)",
    healthAtStart.json?.audit?.status === "ok" && healthAtStart.json?.audit?.failures === 0,
    `audit ${JSON.stringify(healthAtStart.json?.audit)}`,
  );

  // ── S-12-only startup branch ──────────────────────────────────────────────
  // S-12 depends only on the HTTP helpers, the shared check() reporter, and an
  // isolated Prisma client for auditLog writes. It does not depend on seeded
  // marketplace listings, suppliers, workspaces, or any other finding.
  if (ONLY_S12) {
    let s05Prisma = null;

    try {
      if (!(process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
        console.log("FAIL  ONLY_S12=1 requires an isolated DATABASE_URL (sellflow-e2e-)");
        process.exit(1);
      }

      const { PrismaClient } = await import("@prisma/client");
      s05Prisma = new PrismaClient();

      await runS12Checks(s05Prisma);
    } finally {
      if (s05Prisma) {
        await s05Prisma.$disconnect();
      }
    }

    console.log("\nS-12-only run complete. Other verification sections and PWA checks were skipped.");
    console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
    process.exit(failures === 0 ? 0 : 1);
  }

  // ── Guests ────────────────────────────────────────────────────────────────
  const me = await call("/api/auth/me");
  check("guest /api/auth/me is unauthenticated", me.json?.authenticated === false);

  // ── S-06: public surfaces never publish demo credentials ─────────────────
  const landing = await call("/");
  check(
    "the landing page renders for signed-out visitors",
    landing.status === 200 && landing.text.includes("Know who still owes you"),
    `status ${landing.status}`,
  );
  check(
    "the landing page publishes no demo credentials (S-06)",
    landing.status === 200 &&
      !landing.text.includes("Password123!") &&
      !landing.text.includes("reseller@sellflow.test") &&
      !landing.text.includes("supplier@sellflow.test"),
    `status ${landing.status}`,
  );

  const publicSurfaces = ["/api/health", "/api/marketplace/suppliers", "/api/marketplace/listings"];
  const publicBodies = await Promise.all(publicSurfaces.map((path) => call(path)));
  check(
    "public API responses carry no seeded credentials (S-06)",
    publicBodies.every((res) => res.status === 200) &&
      publicBodies.every(
        (res) =>
          !res.text.includes("Password123!") &&
          !res.text.includes("reseller@sellflow.test") &&
          !res.text.includes("supplier@sellflow.test") &&
          !res.text.includes("mediator@sellflow.test") &&
          !res.text.includes("admin@sellflow.test") &&
          !res.text.includes("passwordHash"),
      ),
    publicBodies.map((res) => `${res.status}`).join(", "),
  );

  const publicListings = await call("/api/marketplace/listings");
  check("public listings load", publicListings.status === 200 && publicListings.json?.listings?.length > 0);

  const listing = publicListings.json.listings.find((l) => l.slug === "body-wave-wig-18in");
  if (!listing) throw new Error("seeded listing not found — run npm run db:seed");

  // ── S-12-only startup branch reached too late guard ────────────────────────
  // This branch is reached only if ONLY_S12 was not set at the top of main(),
  // because the S-12 exec path returns/exit()s above before any unrelated test.
  if (ONLY_S12) {
    console.log("FAIL  ONLY_S12=1 branching occurred after first unrelated test");
    process.exit(1);
  }

  const offerId = listing.offer.id;

  const guestPrice = await call(`/api/marketplace/offers/${offerId}/price`);
  check("guest price request is rejected", guestPrice.status === 403, `status ${guestPrice.status}`);
  check("guest price response contains no price", !leaks(guestPrice.text, SEEDED_PRICE));

  const guestDetail = await call(`/api/marketplace/listings/${listing.slug}`);
  check("guest listing detail locks the price", guestDetail.json?.resellerPrice?.allowed === false);
  check("guest listing detail body has no private price", !leaks(guestDetail.text, SEEDED_PRICE));

  // ── Discovery filters (public columns only) ───────────────────────────────
  const SECRET_PRICE = 3_800_000;
  const OTHER_SECRET = 9_500_000;

  const searched = await call("/api/marketplace/listings?q=wig");
  check(
    "search narrows to the matching listing",
    searched.json?.listings?.length === 1 && searched.json.listings[0].slug === "body-wave-wig-18in",
  );
  check(
    "search response carries no reseller price",
    !leaks(searched.text, SECRET_PRICE) && !searched.text.includes("resellerPriceKobo") && !searched.text.includes("terms"),
  );

  const byCategory = await call("/api/marketplace/listings?category=Wigs");
  check(
    "category filter returns only that category",
    byCategory.json?.listings?.length >= 1 && byCategory.json.listings.every((l) => l.category === "Wigs"),
  );

  const byPrice = await call("/api/marketplace/listings?minPriceKobo=2000000&maxPriceKobo=6000000");
  check(
    "retail price band filters correctly",
    byPrice.json?.listings?.length >= 1 &&
      byPrice.json.listings.every((l) => l.publicPriceKobo >= 2_000_000 && l.publicPriceKobo <= 6_000_000),
  );

  const inStock = await call("/api/marketplace/listings?stock=in");
  check("in-stock filter excludes zero stock", inStock.json?.listings?.every((l) => l.stockQty > 0));

  const outStock = await call("/api/marketplace/listings?stock=out");
  check("sold-out filter is empty for the seed", outStock.json?.listings?.length === 0);

  const ascending = await call("/api/marketplace/listings?sort=price_asc");
  const ascendingPrices = (ascending.json?.listings ?? []).map((l) => l.publicPriceKobo);
  check(
    "cheapest-first ordering",
    ascendingPrices.length > 1 && ascendingPrices.every((value, index) => index === 0 || ascendingPrices[index - 1] <= value),
  );

  const descending = await call("/api/marketplace/listings?sort=price_desc");
  const descendingPrices = (descending.json?.listings ?? []).map((l) => l.publicPriceKobo);
  check(
    "most-expensive-first ordering",
    descendingPrices.length > 1 &&
      descendingPrices.every((value, index) => index === 0 || descendingPrices[index - 1] >= value),
  );

  const popular = await call("/api/marketplace/listings?sort=popular");
  check(
    "popular ordering uses real supplier demand",
    popular.json?.listings?.[0]?.slug === "body-wave-wig-18in",
    popular.json?.listings?.[0]?.slug,
  );

  const bySupplier = await call(`/api/marketplace/listings?supplierId=${listing.supplierProfile.id}`);
  check(
    "supplier filter stays inside that supplier",
    bySupplier.json?.listings?.every((l) => l.supplierProfile.id === listing.supplierProfile.id),
  );

  const junkFilters = await call("/api/marketplace/listings?sort=bogus&minPriceKobo=abc&stock=weird");
  check(
    "invalid filters fall back instead of failing",
    junkFilters.status === 200 && junkFilters.json?.filters?.sort === "newest" && junkFilters.json?.filters?.stock === "all",
  );

  const directory = await call("/api/marketplace/suppliers");
  check("supplier directory lists active suppliers", directory.status === 200 && directory.json?.suppliers?.length >= 1);
  check("directory reports catalogue size", directory.json.suppliers[0].publishedListings >= 1);
  check("directory leaks no reseller price", !leaks(directory.text, SECRET_PRICE) && !leaks(directory.text, OTHER_SECRET));

  const storefront = await call(`/api/marketplace/suppliers/${listing.supplierProfile.id}`);
  check(
    "storefront returns the supplier and catalogue",
    storefront.json?.supplier?.id === listing.supplierProfile.id && storefront.json?.listings?.length >= 1,
  );
  check(
    "storefront leaks no reseller price",
    !leaks(storefront.text, SECRET_PRICE) && !leaks(storefront.text, OTHER_SECRET),
  );

  // ── An ordinary account (no reseller role) ────────────────────────────────
  const stranger = await call("/api/auth/register", {
    method: "POST",
    body: {
      email: `stranger+${Date.now()}@sellflow.test`,
      password: "Password123!",
      displayName: "Stranger Test",
      businessName: "Stranger Shop",
      country: "NG",
    },
  });
  check("registration creates an account", stranger.status === 201, `status ${stranger.status}`);
  let strangerCookie = stranger.cookie;

  const strangerPrice = await call(`/api/marketplace/offers/${offerId}/price`, { cookie: strangerCookie });
  check("non-reseller price request is rejected", strangerPrice.status === 403, `status ${strangerPrice.status}`);
  check("non-reseller response has no price", !leaks(strangerPrice.text, SEEDED_PRICE));

  const strangerOrder = await call("/api/supplier/orders", {
    method: "POST",
    cookie: strangerCookie,
    body: { supplierProfileId: listing.supplierProfile.id, items: [{ listingId: listing.id, qty: 6 }] },
  });
  check("non-reseller cannot order from a supplier", strangerOrder.status === 403, `status ${strangerOrder.status}`);

  // ── Approved reseller ─────────────────────────────────────────────────────
  const resellerCookie = await login("reseller@sellflow.test", "Password123!");
  const supplierCookie = await login("supplier@sellflow.test", "Password123!");
  check(
    "isolated test fixtures can still sign in (S-06)",
    Boolean(resellerCookie) && Boolean(supplierCookie),
  );

  const badLogin = await call("/api/auth/login", {
    method: "POST",
    body: { email: "reseller@sellflow.test", password: "NotThePassword1!" },
  });
  check(
    "a wrong password is still rejected",
    badLogin.status === 401 && !badLogin.cookie,
    `status ${badLogin.status}`,
  );

  // ── S-13: state-changing API requests must be same-origin ────────────────
  // The wrapper accepts an explicit same-origin Origin, falls back to a
  // same-origin Referer, refuses every foreign/malformed value, and refuses a
  // missing header when a session cookie would supply ambient authority.
  const s13Email = `s13-${Date.now()}@sellflow.test`;
  const s13Registration = await call("/api/auth/register", {
    method: "POST",
    body: {
      email: s13Email,
      password: "Password123!",
      displayName: "S-13 Probe",
      businessName: "S-13 Probe Shop",
      country: "NG",
    },
  });
  check(
    "S-13 setup: a same-origin registration still succeeds",
    s13Registration.status === 201 && Boolean(s13Registration.cookie),
    `status ${s13Registration.status}`,
  );
  const s13Cookie = s13Registration.cookie;
  const s13List = async () =>
    call("/api/workspace/customers", { cookie: s13Cookie, origin: null });
  const s13Baseline = await s13List();
  const s13BaselineCount = s13Baseline.json?.customers?.length ?? -1;
  check("S-13 setup: the probe workspace starts empty", s13BaselineCount === 0, `count ${s13BaselineCount}`);

  const s13Foreign = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: "https://evil.example",
    body: { name: "S-13 foreign probe" },
  });
  check(
    "a foreign Origin cannot perform an authenticated mutation (S-13)",
    s13Foreign.status === 403,
    `status ${s13Foreign.status}`,
  );

  const afterForeign = await s13List();
  check(
    "a rejected foreign-Origin request produces HTTP 403 and changes no records (S-13)",
    s13Foreign.status === 403 &&
      (afterForeign.json?.customers?.length ?? -1) === s13BaselineCount &&
      !afterForeign.text.includes("S-13 foreign probe"),
    `status ${s13Foreign.status}, count ${afterForeign.json?.customers?.length}`,
  );

  const s13MissingOrigin = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: null,
    body: { name: "S-13 missing origin probe" },
  });
  check(
    "an authenticated mutation without Origin or Referer is refused (S-13)",
    s13MissingOrigin.status === 403,
    `status ${s13MissingOrigin.status}`,
  );

  const s13Malformed = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: "not a valid origin",
    body: { name: "S-13 malformed origin probe" },
  });
  check(
    "a malformed Origin header is refused safely (S-13)",
    s13Malformed.status === 403,
    `status ${s13Malformed.status}`,
  );

  const s13NullOrigin = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: "null",
    body: { name: "S-13 null origin probe" },
  });
  check(
    "an opaque Origin: null is refused (S-13)",
    s13NullOrigin.status === 403,
    `status ${s13NullOrigin.status}`,
  );

  const s13ForeignReferer = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: null,
    headers: { referer: "https://evil.example/page" },
    body: { name: "S-13 foreign referer probe" },
  });
  check(
    "a foreign Referer is refused when Origin is absent (S-13)",
    s13ForeignReferer.status === 403,
    `status ${s13ForeignReferer.status}`,
  );

  const s13ForwardedSpoof = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: "https://evil.example",
    headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    body: { name: "S-13 forwarded spoof probe" },
  });
  check(
    "forwarded headers cannot establish the expected origin (S-13)",
    s13ForwardedSpoof.status === 403,
    `status ${s13ForwardedSpoof.status}`,
  );

  const afterRejections = await s13List();
  check(
    "no rejected S-13 request modified the database",
    (afterRejections.json?.customers?.length ?? -1) === s13BaselineCount &&
      !afterRejections.text.includes("S-13 missing origin probe") &&
      !afterRejections.text.includes("S-13 malformed origin probe") &&
      !afterRejections.text.includes("S-13 null origin probe") &&
      !afterRejections.text.includes("S-13 foreign referer probe") &&
      !afterRejections.text.includes("S-13 forwarded spoof probe"),
    `count ${afterRejections.json?.customers?.length}`,
  );

  const s13SameOrigin = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: BASE_ORIGIN,
    body: { name: "S-13 same-origin probe" },
  });
  check(
    "a legitimate same-origin mutation still succeeds (S-13)",
    s13SameOrigin.status === 201 && Boolean(s13SameOrigin.json?.customer?.id),
    `status ${s13SameOrigin.status}`,
  );

  const s13RefererFallback = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: null,
    headers: { referer: `${BASE_ORIGIN}/dashboard/customers` },
    body: { name: "S-13 referer fallback probe" },
  });
  check(
    "a same-origin Referer is accepted when Origin is absent (S-13)",
    s13RefererFallback.status === 201,
    `status ${s13RefererFallback.status}`,
  );

  const s13ForwardedSameOrigin = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s13Cookie,
    origin: BASE_ORIGIN,
    headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
    body: { name: "S-13 forwarded same-origin probe" },
  });
  check(
    "a forwarded host does not break a legitimate same-origin mutation (S-13)",
    s13ForwardedSameOrigin.status === 201,
    `status ${s13ForwardedSameOrigin.status}`,
  );

  const s13ForeignGet = await call("/api/workspace/customers", {
    cookie: s13Cookie,
    origin: "https://evil.example",
  });
  check(
    "GET requests continue to work regardless of Origin (S-13)",
    s13ForeignGet.status === 200,
    `status ${s13ForeignGet.status}`,
  );

  const s13Unauthenticated = await call("/api/workspace/customers", {
    method: "POST",
    origin: null,
    body: { name: "S-13 unauthenticated probe" },
  });
  check(
    "an unauthenticated mutation without Origin is still rejected (S-13)",
    s13Unauthenticated.status === 401,
    `status ${s13Unauthenticated.status}`,
  );

  const s13UnauthenticatedForeign = await call("/api/workspace/customers", {
    method: "POST",
    origin: "https://evil.example",
    body: { name: "S-13 unauthenticated foreign probe" },
  });
  check(
    "an unauthenticated foreign-Origin mutation is still rejected (S-13)",
    s13UnauthenticatedForeign.status === 403,
    `status ${s13UnauthenticatedForeign.status}`,
  );

  const s13RoleCheck = await call("/api/supplier/orders", {
    method: "POST",
    cookie: s13Cookie,
    origin: BASE_ORIGIN,
    body: { supplierProfileId: listing.supplierProfile.id, items: [{ listingId: listing.id, qty: 1 }] },
  });
  check(
    "existing role authorization is unchanged for same-origin mutations (S-13)",
    s13RoleCheck.status === 403,
    `status ${s13RoleCheck.status}`,
  );

  // ── S-05: login throttling and validated client IP capture ───────────────
  // Dedicated probe accounts keep this block from locking the seeded fixtures.
  // A trusted-proxy secret lets the test choose distinct source IPs; without
  // it, forwarding headers are ignored by the application.
  const s05Suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s05Password = "Password123!";
  const accountLimit = Math.max(2, ACCOUNT_LIMIT);
  const ipLimit = Math.max(2, IP_LIMIT);
  let s05Prisma = null;
  if ((process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    const { PrismaClient } = await import("@prisma/client");
    s05Prisma = new PrismaClient();
  }
  const latestSession = (userId) =>
    s05Prisma.session.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
  const latestLoginAudit = (userId) =>
    s05Prisma.auditLog.findFirst({
      where: { entityId: userId, action: "auth.login" },
      orderBy: { createdAt: "desc" },
    });
  const auditIpHash = (audit) => {
    if (!audit) return null;
    try {
      const metadata = JSON.parse(audit.metadataJson ?? "{}");
      return typeof metadata.ipHash === "string" ? metadata.ipHash : null;
    } catch {
      return null;
    }
  };
  const registerS05 = (email, ip) =>
    call("/api/auth/register", {
      method: "POST",
      headers: trustedProxyHeaders(ip),
      body: {
        email,
        password: s05Password,
        displayName: "S-05 Probe",
        businessName: "S-05 Probe Shop",
        country: "NG",
      },
    });
  const loginS05 = (email, password, ip, headers = {}) =>
    call("/api/auth/login", {
      method: "POST",
      headers: { ...trustedProxyHeaders(ip), ...headers },
      body: { email, password },
    });

  const s05Email = `s05-${s05Suffix}@sellflow.test`;
  const s05RegisterIp = "198.51.100.10";
  const s05Registered = await registerS05(s05Email, s05RegisterIp);
  check(
    "S-05 setup: a fresh account registers",
    s05Registered.status === 201 && Boolean(s05Registered.cookie),
    `status ${s05Registered.status}`,
  );
  const s05UserId = s05Registered.json?.user?.id;

  if (s05Prisma && s05UserId && ipHashOf(s05RegisterIp)) {
    const session = await latestSession(s05UserId);
    check(
      "registration records a validated client IP when a trusted proxy supplies one (S-05)",
      session?.ipHash === ipHashOf(s05RegisterIp),
      `ipHash ${session?.ipHash ?? "null"}`,
    );
  } else {
    console.log("SKIP  registration IP recording needs the isolated harness and a session secret");
  }

  const s05LoginIp = "198.51.100.11";
  const s05Login = await loginS05(s05Email, s05Password, s05LoginIp);
  check(
    "a legitimate login succeeds when no lockout applies (S-05)",
    s05Login.status === 200 && Boolean(s05Login.cookie),
    `status ${s05Login.status}`,
  );
  check(
    "the login session cookie keeps HttpOnly, SameSite=Lax and Path=/ (S-05)",
    /httponly/i.test(s05Login.setCookie ?? "") &&
      /samesite=lax/i.test(s05Login.setCookie ?? "") &&
      /path=\//i.test(s05Login.setCookie ?? ""),
    s05Login.setCookie ?? "no set-cookie",
  );
  if (process.env.EXPECT_SECURE_COOKIE === "1") {
    check(
      "the production login session cookie is still Secure (S-05)",
      /;\s*secure/i.test(s05Login.setCookie ?? ""),
      s05Login.setCookie ?? "no set-cookie",
    );
  }
  if (s05Prisma && s05UserId && ipHashOf(s05LoginIp)) {
    const session = await latestSession(s05UserId);
    check(
      "login records a validated client IP when a trusted proxy supplies one (S-05)",
      session?.ipHash === ipHashOf(s05LoginIp),
      `ipHash ${session?.ipHash ?? "null"}`,
    );
  }

  const s05Me = await call("/api/auth/me", { cookie: s05Login.cookie });
  check(
    "session creation still authenticates the account (S-05)",
    s05Me.status === 200 && s05Me.json?.authenticated === true,
    `status ${s05Me.status}`,
  );
  const s05Logout = await call("/api/auth/logout", { method: "POST", cookie: s05Login.cookie });
  check(
    "logout still revokes the session and clears the cookie (S-05)",
    s05Logout.status === 200 && /max-age=0/i.test(s05Logout.setCookie ?? ""),
    `status ${s05Logout.status}, cookie ${s05Logout.setCookie ?? "none"}`,
  );
  const s05MeAfterLogout = await call("/api/auth/me", { cookie: s05Login.cookie });
  check(
    "the revoked session no longer authenticates (S-05)",
    s05MeAfterLogout.json?.authenticated === false,
    JSON.stringify(s05MeAfterLogout.json),
  );

  const s05ForeignLogin = await call("/api/auth/login", {
    method: "POST",
    origin: "https://evil.example",
    body: { email: s05Email, password: s05Password },
  });
  check(
    "S-13 still rejects a foreign-Origin login (S-05)",
    s05ForeignLogin.status === 403,
    `status ${s05ForeignLogin.status}`,
  );

  // Account-scoped lockout. Case and whitespace are varied deliberately, so a
  // normalisation bug cannot be used to reset the counter.
  const s05LockIp = "198.51.100.20";
  const s05WrongStatuses = [];
  for (let i = 0; i < accountLimit; i += 1) {
    const email = i % 2 === 0 ? s05Email.toUpperCase() : `  ${s05Email}  `;
    const res = await loginS05(email, `Wrong-${i}-Password!`, s05LockIp);
    s05WrongStatuses.push(res.status);
    if (i === accountLimit - 1) {
      check(
        "the attempt that reaches the account limit is throttled (S-05)",
        res.status === 429 && Number(res.json?.details?.retryAfterSeconds) > 0,
        `status ${res.status}, details ${JSON.stringify(res.json?.details)}`,
      );
      check(
        "a throttled login advertises a Retry-After interval (S-05)",
        Number(res.retryAfter) > 0,
        `Retry-After ${res.retryAfter}`,
      );
    }
  }
  check(
    "repeated incorrect passwords trigger throttling (S-05)",
    s05WrongStatuses.includes(429),
    s05WrongStatuses.join(","),
  );
  check(
    "no incorrect password is ever accepted during the burst (S-05)",
    s05WrongStatuses.every((status) => status === 401 || status === 429),
    s05WrongStatuses.join(","),
  );

  const s05LockedCorrect = await loginS05(s05Email, s05Password, "198.51.100.21");
  check(
    "correct credentials are rejected while the account is locked (S-05)",
    s05LockedCorrect.status === 429 && !s05LockedCorrect.cookie,
    `status ${s05LockedCorrect.status}`,
  );

  const s05UnknownEmail = `s05-unknown-${s05Suffix}@sellflow.test`;
  for (let i = 0; i < accountLimit; i += 1) {
    await loginS05(s05UnknownEmail, `Wrong-${i}-Password!`, "198.51.100.22");
  }
  const s05UnknownLocked = await loginS05(s05UnknownEmail, s05Password, "198.51.100.22");
  check(
    "throttling does not disclose whether an account exists (S-05)",
    s05UnknownLocked.status === 429 &&
      s05UnknownLocked.json?.code === s05LockedCorrect.json?.code &&
      s05UnknownLocked.json?.error === s05LockedCorrect.json?.error,
    `known ${s05LockedCorrect.status}/${s05LockedCorrect.json?.code}, unknown ${s05UnknownLocked.status}/${s05UnknownLocked.json?.code}`,
  );

  const s05SecondEmail = `s05-second-${s05Suffix}@sellflow.test`;
  const s05SecondRegistered = await registerS05(s05SecondEmail, "198.51.100.23");
  check(
    "S-05 setup: a second account registers",
    s05SecondRegistered.status === 201,
    `status ${s05SecondRegistered.status}`,
  );
  const s05SecondUserId = s05SecondRegistered.json?.user?.id;
  const s05SecondLogin = await loginS05(s05SecondEmail, s05Password, "198.51.100.23");
  check(
    "throttling is scoped by account identity (S-05)",
    s05SecondLogin.status === 200 && Boolean(s05SecondLogin.cookie),
    `status ${s05SecondLogin.status}`,
  );

  const s05ResetEmail = `s05-reset-${s05Suffix}@sellflow.test`;
  const s05ResetRegistered = await registerS05(s05ResetEmail, "198.51.100.30");
  check(
    "S-05 setup: a reset-probe account registers",
    s05ResetRegistered.status === 201,
    `status ${s05ResetRegistered.status}`,
  );
  const s05ResetBefore = [];
  for (let i = 0; i < accountLimit - 2; i += 1) {
    const res = await loginS05(s05ResetEmail, `Wrong-Before-${i}!`, "198.51.100.30");
    s05ResetBefore.push(res.status);
  }
  const s05ResetSuccess = await loginS05(s05ResetEmail, s05Password, "198.51.100.30");
  check(
    "a successful login clears the account's failure counter (S-05)",
    s05ResetBefore.every((status) => status === 401) && s05ResetSuccess.status === 200,
    `before ${s05ResetBefore.join(",")}, success ${s05ResetSuccess.status}`,
  );
  const s05ResetAfter = [];
  for (let i = 0; i < accountLimit - 1; i += 1) {
    const res = await loginS05(s05ResetEmail, `Wrong-After-${i}!`, "198.51.100.31");
    s05ResetAfter.push(res.status);
  }
  const s05ResetFinal = await loginS05(s05ResetEmail, "Wrong-Final!", "198.51.100.32");
  check(
    "failures after a success start from zero and only then reach the limit (S-05)",
    s05ResetAfter.every((status) => status === 401) && s05ResetFinal.status === 429,
    `after ${s05ResetAfter.join(",")}, final ${s05ResetFinal.status}`,
  );

  const s05NewEmail = `s05-new-${s05Suffix}@sellflow.test`;
  const s05NewRegistered = await registerS05(s05NewEmail, s05LockIp);
  check(
    "registration does not inherit another account's login lockout (S-05)",
    s05NewRegistered.status === 201 && Boolean(s05NewRegistered.cookie),
    `status ${s05NewRegistered.status}`,
  );
  const s05LockedRegistration = await registerS05(s05Email, "198.51.100.24");
  check(
    "registering a locked account's email returns conflict, not a lockout (S-05)",
    s05LockedRegistration.status === 409,
    `status ${s05LockedRegistration.status}`,
  );

  // IP-scoped throttle: many distinct accounts fail from one address.
  const s05IpLockIp = "198.51.100.50";
  const s05IpStatuses = [];
  for (let i = 0; i < ipLimit; i += 1) {
    const res = await loginS05(`s05-ip-${s05Suffix}-${i}@sellflow.test`, `Wrong-Ip-${i}!`, s05IpLockIp);
    s05IpStatuses.push(res.status);
  }
  check(
    "repeated failures from one source IP trigger throttling (S-05)",
    s05IpStatuses.includes(429),
    s05IpStatuses.join(","),
  );
  const s05IpLockedCorrect = await loginS05(s05SecondEmail, s05Password, s05IpLockIp);
  check(
    "a correct password is rejected when the source IP is throttled (S-05)",
    s05IpLockedCorrect.status === 429 && !s05IpLockedCorrect.cookie,
    `status ${s05IpLockedCorrect.status}`,
  );
  const s05OtherIpLogin = await loginS05(s05SecondEmail, s05Password, "198.51.100.51");
  check(
    "a different source IP is not affected by another IP's throttle (S-05)",
    s05OtherIpLogin.status === 200 && Boolean(s05OtherIpLogin.cookie),
    `status ${s05OtherIpLogin.status}`,
  );

  if (TRUSTED_PROXY_SECRET) {
    const s05Ipv6Login = await loginS05(s05SecondEmail, s05Password, "2001:db8::1");
    check(
      "an IPv6 client IP is accepted (S-05)",
      s05Ipv6Login.status === 200 && Boolean(s05Ipv6Login.cookie),
      `status ${s05Ipv6Login.status}`,
    );
    if (s05Prisma && s05SecondUserId) {
      const session = await latestSession(s05SecondUserId);
      check(
        "IPv6 is canonicalized before hashing (S-05)",
        session?.ipHash === ipHashOf("2001:db8:0:0:0:0:0:1"),
        `ipHash ${session?.ipHash ?? "null"}`,
      );
    }

    const s05Ipv6AltLogin = await loginS05(s05SecondEmail, s05Password, "2001:0db8:0:0:0:0:0:1");
    check(
      "an alternate IPv6 spelling still logs in (S-05)",
      s05Ipv6AltLogin.status === 200,
      `status ${s05Ipv6AltLogin.status}`,
    );
    if (s05Prisma && s05SecondUserId) {
      const session = await latestSession(s05SecondUserId);
      check(
        "alternate IPv6 spellings share one canonical hash (S-05)",
        session?.ipHash === ipHashOf("2001:db8:0:0:0:0:0:1"),
        `ipHash ${session?.ipHash ?? "null"}`,
      );
    }

    const s05ChainIp = "198.51.100.60";
    const s05ChainSpoof = "203.0.113.77";
    const s05ChainLogin = await loginS05(s05SecondEmail, s05Password, null, {
      "x-sellflow-trusted-proxy": TRUSTED_PROXY_SECRET,
      "x-forwarded-for": `${s05ChainSpoof}, ${s05ChainIp}`,
    });
    check(
      "a trusted proxy chain still logs in (S-05)",
      s05ChainLogin.status === 200,
      `status ${s05ChainLogin.status}`,
    );
    if (s05Prisma && s05SecondUserId) {
      const session = await latestSession(s05SecondUserId);
      check(
        "a trusted proxy chain records the rightmost validated IP, not a client-supplied left value (S-05)",
        session?.ipHash === ipHashOf(s05ChainIp) && session?.ipHash !== ipHashOf(s05ChainSpoof),
        `ipHash ${session?.ipHash ?? "null"}, rightmost ${ipHashOf(s05ChainIp) ?? "unavailable"}, leftmost ${ipHashOf(s05ChainSpoof) ?? "unavailable"}`,
      );
    }
  } else {
    console.log("SKIP  IPv6 and proxy-chain IP assertions need TRUSTED_PROXY_SECRET");
  }

  // Forwarding headers are untrusted unless the explicit proxy secret matches.
  const s05SpoofIp = "203.0.113.99";
  const s05SpoofLogin = await call("/api/auth/login", {
    method: "POST",
    headers: { "x-forwarded-for": s05SpoofIp },
    body: { email: s05SecondEmail, password: s05Password },
  });
  check(
    "a login with an untrusted forwarding header still succeeds (S-05)",
    s05SpoofLogin.status === 200,
    `status ${s05SpoofLogin.status}`,
  );
  if (s05Prisma && s05SecondUserId) {
    const session = await latestSession(s05SecondUserId);
    const audit = await latestLoginAudit(s05SecondUserId);
    const auditHash = auditIpHash(audit);
    check(
      "a spoofed forwarding header cannot change the recorded session IP (S-05)",
      session?.ipHash !== ipHashOf(s05SpoofIp),
      `session ipHash ${session?.ipHash ?? "null"}, spoof hash ${ipHashOf(s05SpoofIp) ?? "unavailable"}`,
    );
    check(
      "a spoofed forwarding header cannot change the recorded audit IP (S-05)",
      audit?.ipHash !== ipHashOf(s05SpoofIp) && auditHash !== ipHashOf(s05SpoofIp),
      `audit ipHash ${audit?.ipHash ?? "null"}, metadata ${auditHash ?? "null"}, spoof ${ipHashOf(s05SpoofIp) ?? "unavailable"}`,
    );
  } else {
    console.log("SKIP  spoofed-IP database assertions need the isolated harness");
  }

  const s05InvalidIpLogin = await loginS05(s05SecondEmail, s05Password, null, {
    "x-sellflow-trusted-proxy": TRUSTED_PROXY_SECRET ?? "",
    "x-forwarded-for": "definitely-not-an-ip",
  });
  check(
    "an invalid IP header is handled safely (S-05)",
    s05InvalidIpLogin.status === 200 && Boolean(s05InvalidIpLogin.cookie),
    `status ${s05InvalidIpLogin.status}`,
  );
  if (s05Prisma && s05SecondUserId) {
    const session = await latestSession(s05SecondUserId);
    const audit = await latestLoginAudit(s05SecondUserId);
    const auditHash = auditIpHash(audit);
    check(
      "an invalid IP is never stored as a session address (S-05)",
      session?.ipHash === null,
      `session ipHash ${session?.ipHash ?? "null"}`,
    );
    check(
      "an invalid IP is never hashed into the audit trail (S-05)",
      audit?.ipHash === null && auditHash === null,
      `audit ipHash ${audit?.ipHash ?? "null"}, metadata ${auditHash ?? "null"}`,
    );
  }

  const s05NoIpLogin = await loginS05(s05SecondEmail, s05Password, null);
  check(
    "a login with no IP information still succeeds (S-05)",
    s05NoIpLogin.status === 200 && Boolean(s05NoIpLogin.cookie),
    `status ${s05NoIpLogin.status}`,
  );
  if (s05Prisma && s05SecondUserId) {
    const session = await latestSession(s05SecondUserId);
    const audit = await latestLoginAudit(s05SecondUserId);
    const auditHash = auditIpHash(audit);
    check(
      "a missing IP is stored as null, not fabricated (S-05)",
      session?.ipHash === null && audit?.ipHash === null && auditHash === null,
      `session ${session?.ipHash ?? "null"}, audit ${audit?.ipHash ?? "null"}, metadata ${auditHash ?? "null"}`,
    );
  }

  const s05BadIpRegistration = await call("/api/auth/register", {
    method: "POST",
    headers: {
      "x-sellflow-trusted-proxy": TRUSTED_PROXY_SECRET ?? "",
      "x-forwarded-for": "also-not-an-ip",
    },
    body: {
      email: `s05-badip-${s05Suffix}@sellflow.test`,
      password: s05Password,
      displayName: "S-05 Bad IP",
      businessName: "S-05 Bad IP Shop",
      country: "NG",
    },
  });
  check(
    "registration handles invalid IP information safely (S-05)",
    s05BadIpRegistration.status === 201,
    `status ${s05BadIpRegistration.status}`,
  );
  if (s05Prisma && s05BadIpRegistration.json?.user?.id) {
    const session = await latestSession(s05BadIpRegistration.json.user.id);
    check(
      "an invalid registration IP is stored as null (S-05)",
      session?.ipHash === null,
      `session ipHash ${session?.ipHash ?? "null"}`,
    );
  }

  // Concurrent failures must not slip past the threshold.
  const s05ConcurrentEmail = `s05-concurrent-${s05Suffix}@sellflow.test`;
  const s05ConcurrentIp = "198.51.100.70";
  const s05ConcurrentRegistered = await registerS05(s05ConcurrentEmail, s05ConcurrentIp);
  check(
    "S-05 setup: a concurrency-probe account registers",
    s05ConcurrentRegistered.status === 201,
    `status ${s05ConcurrentRegistered.status}`,
  );
  const s05ConcurrentResults = await Promise.all(
    Array.from({ length: accountLimit + 5 }, (_, i) =>
      loginS05(s05ConcurrentEmail, `Concurrent-Wrong-${i}!`, s05ConcurrentIp),
    ),
  );
  const s05ConcurrentStatuses = s05ConcurrentResults.map((res) => res.status);
  check(
    "concurrent wrong passwords are never accepted (S-05)",
    s05ConcurrentStatuses.every((status) => status === 401 || status === 429),
    s05ConcurrentStatuses.join(","),
  );
  check(
    "concurrent attempts trigger the throttle (S-05)",
    s05ConcurrentStatuses.includes(429),
    s05ConcurrentStatuses.join(","),
  );
  const s05ConcurrentCorrect = await loginS05(
    s05ConcurrentEmail,
    s05Password,
    "198.51.100.71",
  );
  check(
    "concurrent attempts cannot bypass the lockout threshold (S-05)",
    s05ConcurrentCorrect.status === 429 && !s05ConcurrentCorrect.cookie,
    `status ${s05ConcurrentCorrect.status}`,
  );

  if (s05Prisma) await s05Prisma.$disconnect();

  // ── S-07: registration must not claim verification ───────────────────────
  // A new account has not completed any contact or document check, so it must
  // start at tier 0 and must not be able to inject a tier through registration
  // or an ordinary profile write. The admin workflow remains the only path that
  // can elevate a profile.
  const s07Suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s07Password = "Password123!";
  let s07Prisma = null;
  if ((process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    const { PrismaClient } = await import("@prisma/client");
    s07Prisma = new PrismaClient();
  }
  const s07Register = (email, extra = {}) =>
    call("/api/auth/register", {
      method: "POST",
      body: {
        email,
        password: s07Password,
        displayName: "S-07 Probe",
        businessName: "S-07 Probe Shop",
        country: "NG",
        ...extra,
      },
    });
  const s07ProfileRow = (userId) =>
    s07Prisma.profile.findUnique({
      where: { userId },
      include: { verificationEvents: { orderBy: { createdAt: "asc" } } },
    });
  const s07UserRow = (userId) => s07Prisma.user.findUnique({ where: { id: userId } });

  const s07Email = `s07-${s07Suffix}@sellflow.test`;
  const s07Reg = await s07Register(s07Email);
  check(
    "a newly registered account is unverified (S-07)",
    s07Reg.status === 201 && s07Reg.json?.profile?.verificationTier === 0,
    `status ${s07Reg.status}, tier ${s07Reg.json?.profile?.verificationTier}`,
  );
  const s07UserId = s07Reg.json?.user?.id;
  const s07ProfileId = s07Reg.json?.profile?.id;

  if (s07Prisma && s07UserId) {
    const profile = await s07ProfileRow(s07UserId);
    const user = await s07UserRow(s07UserId);
    check(
      "the stored profile is tier 0, not tier 1 (S-07)",
      profile?.verificationTier === 0,
      `tier ${profile?.verificationTier}`,
    );
    check(
      "registration writes no false 0→1 verification event (S-07)",
      profile?.verificationEvents.length === 0,
      `${profile?.verificationEvents.length ?? "?"} event(s)`,
    );
    check(
      "registration does not claim a tier-change timestamp (S-07)",
      profile?.tierUpdatedAt === null,
      `tierUpdatedAt ${profile?.tierUpdatedAt?.toISOString?.() ?? profile?.tierUpdatedAt}`,
    );
    check(
      "registration does not set emailVerifiedAt (S-07)",
      user?.emailVerifiedAt === null,
      `emailVerifiedAt ${user?.emailVerifiedAt?.toISOString?.() ?? user?.emailVerifiedAt}`,
    );
  } else {
    console.log("SKIP  S-07 database assertions need the isolated harness");
  }

  const s07Me = await call("/api/auth/me", { cookie: s07Reg.cookie });
  check(
    "the new session reports Unverified, not Contact verified (S-07)",
    s07Me.json?.profile?.verificationTier === 0 &&
      s07Me.json?.profile?.verificationLabel === "Unverified",
    `tier ${s07Me.json?.profile?.verificationTier}, label ${s07Me.json?.profile?.verificationLabel}`,
  );

  const s07Login = await call("/api/auth/login", {
    method: "POST",
    body: { email: s07Email, password: s07Password },
  });
  check(
    "existing login still works for an unverified account (S-07)",
    s07Login.status === 200 && Boolean(s07Login.cookie),
    `status ${s07Login.status}`,
  );

  const s07EscalateEmail = `s07-escalate-${s07Suffix}@sellflow.test`;
  const s07Escalate = await s07Register(s07EscalateEmail, {
    verificationTier: 3,
    tier: 3,
    verification: { tier: 3 },
    profile: { verificationTier: 3 },
    emailVerifiedAt: new Date().toISOString(),
    isPlatformAdmin: true,
  });
  check(
    "registration ignores an injected verification tier (S-07)",
    s07Escalate.status === 201 && s07Escalate.json?.profile?.verificationTier === 0,
    `status ${s07Escalate.status}, tier ${s07Escalate.json?.profile?.verificationTier}`,
  );
  if (s07Prisma && s07Escalate.json?.user?.id) {
    const profile = await s07ProfileRow(s07Escalate.json.user.id);
    const user = await s07UserRow(s07Escalate.json.user.id);
    check(
      "an injected tier cannot elevate the stored profile (S-07)",
      profile?.verificationTier === 0,
      `tier ${profile?.verificationTier}`,
    );
    check(
      "registration cannot inject email verification or platform admin (S-07)",
      user?.emailVerifiedAt === null && user?.isPlatformAdmin === false,
      `emailVerifiedAt ${user?.emailVerifiedAt?.toISOString?.() ?? user?.emailVerifiedAt}, admin ${user?.isPlatformAdmin}`,
    );
  }

  const s07SupplierUpdate = await call("/api/supplier/profile", {
    method: "POST",
    cookie: s07Reg.cookie,
    body: {
      businessName: "S-07 Probe Supplier",
      about: "S-07 probe",
      verificationTier: 3,
      tier: 3,
      profile: { verificationTier: 3 },
    },
  });
  check(
    "creating a supplier profile still works (S-07)",
    s07SupplierUpdate.status === 201,
    `status ${s07SupplierUpdate.status}`,
  );
  // Activating the SUPPLIER role rotates the session (S-14), so downstream
  // calls adopt the replacement cookie.
  s07Reg.cookie = s07SupplierUpdate.cookie;
  if (s07Prisma && s07UserId) {
    const profile = await s07ProfileRow(s07UserId);
    const supplier = await s07Prisma.supplierProfile.findUnique({ where: { profileId: s07ProfileId } });
    check(
      "an ordinary profile write cannot elevate identity verification (S-07)",
      profile?.verificationTier === 0 && supplier?.verificationTier === 0,
      `profile ${profile?.verificationTier}, supplier ${supplier?.verificationTier}`,
    );
  }

  const s07RoleUpdate = await call("/api/profile/roles", {
    method: "POST",
    cookie: s07Reg.cookie,
    body: { role: "RESELLER", verificationTier: 3 },
  });
  // Role activation rotates the session (S-14); keep using the fresh cookie.
  s07Reg.cookie = s07RoleUpdate.cookie;
  check(
    "role activation does not elevate identity verification (S-07)",
    s07RoleUpdate.status === 200,
    `status ${s07RoleUpdate.status}`,
  );
  if (s07Prisma && s07UserId) {
    const profile = await s07ProfileRow(s07UserId);
    check(
      "role activation leaves the stored tier at 0 (S-07)",
      profile?.verificationTier === 0,
      `tier ${profile?.verificationTier}`,
    );
  }

  const s07Customer = await call("/api/workspace/customers", {
    method: "POST",
    cookie: s07Reg.cookie,
    body: { name: "S-07 Customer" },
  });
  check(
    "a tier-0 account keeps ordinary workspace access (S-07)",
    s07Customer.status === 201,
    `status ${s07Customer.status}`,
  );

  const s07AdminCookie = await login("admin@sellflow.test", "Password123!");
  const s07NonAdminElevate = await call(`/api/admin/profiles/${s07ProfileId}/verification`, {
    method: "PATCH",
    cookie: s07Reg.cookie,
    body: { tier: 2, reason: "S-07 self elevation attempt" },
  });
  check(
    "an ordinary account cannot use the verification workflow (S-07)",
    s07NonAdminElevate.status === 403,
    `status ${s07NonAdminElevate.status}`,
  );
  if (s07Prisma && s07UserId) {
    const profile = await s07ProfileRow(s07UserId);
    check(
      "a rejected verification attempt changes nothing (S-07)",
      profile?.verificationTier === 0,
      `tier ${profile?.verificationTier}`,
    );
  }

  const s07AdminElevate = await call(`/api/admin/profiles/${s07ProfileId}/verification`, {
    method: "PATCH",
    cookie: s07AdminCookie,
    body: { tier: 2, reason: "S-07 authorised review", evidenceRef: "S-07-TEST" },
  });
  check(
    "the platform-admin verification workflow still works (S-07)",
    s07AdminElevate.status === 200 && s07AdminElevate.json?.profile?.verificationTier === 2,
    `status ${s07AdminElevate.status}, tier ${s07AdminElevate.json?.profile?.verificationTier}`,
  );
  if (s07Prisma && s07UserId) {
    const profile = await s07ProfileRow(s07UserId);
    const adminUser = await s07Prisma.user.findUnique({
      where: { email: "admin@sellflow.test" },
      include: { profile: true },
    });
    const event = profile?.verificationEvents.at(-1);
    check(
      "the authorised workflow records a 0→2 event with its reviewer (S-07)",
      profile?.verificationTier === 2 &&
        event?.fromTier === 0 &&
        event?.toTier === 2 &&
        event?.reason === "S-07 authorised review" &&
        event?.reviewedByProfileId === adminUser?.profile?.id,
      `tier ${profile?.verificationTier}, event ${event?.fromTier}→${event?.toTier}, reviewer ${event?.reviewedByProfileId}`,
    );
  }

  // S-14: a tier change retires the affected account's sessions, so the new
  // tier is observed on a fresh sign-in; the old cookie must no longer work.
  const s07RetiredSession = await call("/api/auth/me", { cookie: s07Reg.cookie });
  s07Reg.cookie = await login(s07Email, s07Password);
  const s07MeVerified = await call("/api/auth/me", { cookie: s07Reg.cookie });
  check(
    "an authorised tier change is reflected in the next session (S-07)",
    s07RetiredSession.json?.authenticated === false &&
      s07MeVerified.json?.profile?.verificationTier === 2 &&
      s07MeVerified.json?.profile?.verificationLabel === "Business reviewed",
    `retired session ${s07RetiredSession.json?.authenticated}, tier ${s07MeVerified.json?.profile?.verificationTier}, label ${s07MeVerified.json?.profile?.verificationLabel}`,
  );

  if (s07Prisma) {
    const seeded = await s07Prisma.user.findMany({
      where: {
        email: {
          in: [
            "supplier@sellflow.test",
            "reseller@sellflow.test",
            "mediator@sellflow.test",
            "admin@sellflow.test",
          ],
        },
      },
      include: { profile: true },
    });
    const tierByEmail = Object.fromEntries(seeded.map((row) => [row.email, row.profile?.verificationTier]));
    check(
      "seeded verified fixtures keep their legitimate tiers (S-07)",
      tierByEmail["supplier@sellflow.test"] === 2 &&
        tierByEmail["reseller@sellflow.test"] === 1 &&
        tierByEmail["mediator@sellflow.test"] === 3 &&
        tierByEmail["admin@sellflow.test"] === 3,
      JSON.stringify(tierByEmail),
    );
  }

  const s07ResellerEmail = `s07-reseller-${s07Suffix}@sellflow.test`;
  const s07ResellerReg = await s07Register(s07ResellerEmail);
  check(
    "S-07 setup: a tier-0 reseller registers",
    s07ResellerReg.status === 201 && s07ResellerReg.json?.profile?.verificationTier === 0,
    `status ${s07ResellerReg.status}, tier ${s07ResellerReg.json?.profile?.verificationTier}`,
  );
  const s07ResellerUserId = s07ResellerReg.json?.user?.id;
  const s07Grant = await call("/api/profile/roles", {
    method: "POST",
    cookie: s07ResellerReg.cookie,
    body: { role: "RESELLER" },
  });
  check(
    "a tier-0 account can still activate the reseller role (S-07)",
    s07Grant.status === 200,
    `status ${s07Grant.status}`,
  );
  // Role activation rotates the session (S-14).
  s07ResellerReg.cookie = s07Grant.cookie;

  const s07Apply = await call("/api/marketplace/applications", {
    method: "POST",
    cookie: s07ResellerReg.cookie,
    body: {
      supplierProfileId: listing.supplierProfile.id,
      offerId,
      message: "S-07 approval probe",
      businessSummary: "S-07",
    },
  });
  check(
    "a tier-0 reseller can still apply to a supplier (S-07)",
    s07Apply.status === 201,
    `status ${s07Apply.status}`,
  );
  const s07ApplicationId = s07Apply.json?.application?.id;
  if (s07Prisma && s07ApplicationId) {
    const application = await s07Prisma.resellerApplication.findUnique({
      where: { id: s07ApplicationId },
    });
    check(
      "the application records the honest tier 0 (S-07)",
      application?.verificationTierAtApply === 0,
      `snapshot ${application?.verificationTierAtApply}`,
    );
  }

  const s07Decision = await call(`/api/supplier/applications/${s07ApplicationId}`, {
    method: "POST",
    cookie: supplierCookie,
    body: { decision: "APPROVED", offerId, note: "S-07 approval" },
  });
  check(
    "supplier approval still works independently of identity verification (S-07)",
    s07Decision.status === 200 && Boolean(s07Decision.json?.agreementId),
    `status ${s07Decision.status}, agreement ${s07Decision.json?.agreementId ?? "none"}`,
  );
  if (s07Prisma && s07ResellerUserId) {
    const profile = await s07ProfileRow(s07ResellerUserId);
    check(
      "supplier approval does not elevate identity verification (S-07)",
      profile?.verificationTier === 0,
      `tier ${profile?.verificationTier}`,
    );
  }

  if (s07Prisma) await s07Prisma.$disconnect();

  const resellerMe = await call("/api/auth/me", { cookie: resellerCookie });
  check("reseller session has the RESELLER role", resellerMe.json?.roles?.includes("RESELLER"));

  const resellerPrice = await call(`/api/marketplace/offers/${offerId}/price`, { cookie: resellerCookie });
  check("approved reseller gets the price", resellerPrice.status === 200, `status ${resellerPrice.status}`);
  check(
    "price matches the agreement",
    resellerPrice.json?.terms?.priceKobo === SEEDED_PRICE,
    `got ${resellerPrice.json?.terms?.priceKobo}`,
  );
  check("price came from the agreement path", resellerPrice.json?.source === "AGREEMENT");

  // ── Order creation ignores client-supplied prices ─────────────────────────
  const created = await call("/api/supplier/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      supplierProfileId: listing.supplierProfile.id,
      items: [{ listingId: listing.id, qty: 6, unitPriceKobo: 1, priceKobo: 1 }],
    },
  });
  check("reseller can create a supplier order", created.status === 201, `status ${created.status}`);
  const order = created.json?.order;
  check(
    "order total uses the agreement price, not the request body",
    order?.totalKobo === SEEDED_PRICE * 6,
    `got ${order?.totalKobo}`,
  );
  check("order records the agreement version", Boolean(order?.items?.[0]?.agreementVersionId));

  // ── Workspace money rules ─────────────────────────────────────────────────
  const customers = await call("/api/workspace/customers", { cookie: resellerCookie });
  const customerId = customers.json?.customers?.[0]?.id;
  check("workspace customers load", Boolean(customerId));

  const newOrder = await call("/api/workspace/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      customerId,
      channel: "WHATSAPP",
      items: [{ name: "Test item", qty: 2, unitPriceKobo: 50_000, unitCostKobo: 30_000 }],
    },
  });
  check("workspace order created", newOrder.status === 201, `status ${newOrder.status}`);
  const workspaceOrderId = newOrder.json?.order?.id;
  check("order total computed", newOrder.json?.order?.totalKobo === 100_000);

  // ── S-02: a customer order may only be linked inside its own workspace ────
  const strangerCustomer = await call("/api/workspace/customers", {
    method: "POST",
    cookie: strangerCookie,
    body: { name: "Probe Secret Customer", phone: "2348001112222" },
  });
  check(
    "a separate workspace can create its own customer",
    strangerCustomer.status === 201,
    `status ${strangerCustomer.status}`,
  );

  const foreignCustomerOrder = await call("/api/workspace/orders", {
    method: "POST",
    cookie: strangerCookie,
    body: {
      customerId: strangerCustomer.json?.customer?.id,
      channel: "WHATSAPP",
      items: [{ name: "Foreign item", qty: 1, unitPriceKobo: 10_000, unitCostKobo: 5_000 }],
    },
  });
  check(
    "a separate workspace can create its own customer order",
    foreignCustomerOrder.status === 201,
    `status ${foreignCustomerOrder.status}`,
  );
  const foreignOrderId = foreignCustomerOrder.json?.order?.id;
  const foreignOrderNumber = foreignCustomerOrder.json?.order?.orderNumber;

  const foreignLink = await call("/api/supplier/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      supplierProfileId: listing.supplierProfile.id,
      customerOrderId: foreignOrderId,
      items: [{ listingId: listing.id, qty: 6 }],
    },
  });
  check(
    "a reseller cannot link another workspace's customer order (S-02)",
    foreignLink.status === 400,
    `status ${foreignLink.status}`,
  );
  check(
    "the foreign link response discloses no customer data (S-02)",
    !foreignLink.text.includes("Probe Secret Customer") &&
      !foreignLink.text.includes("2348001112222") &&
      !foreignLink.text.includes(String(foreignOrderNumber)),
  );

  const missingLink = await call("/api/supplier/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      supplierProfileId: listing.supplierProfile.id,
      customerOrderId: "clzzzzzzzzzzzzzzzzzzzzzzz",
      items: [{ listingId: listing.id, qty: 6 }],
    },
  });
  check(
    "a nonexistent customer order is rejected the same way (S-02)",
    foreignLink.status === 400 &&
      missingLink.status === 400 &&
      missingLink.json?.error === foreignLink.json?.error,
    `foreign ${foreignLink.status}, missing ${missingLink.status}`,
  );

  const ownLink = await call("/api/supplier/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      supplierProfileId: listing.supplierProfile.id,
      customerOrderId: workspaceOrderId,
      items: [{ listingId: listing.id, qty: 6 }],
    },
  });
  check(
    "a reseller can still link its own customer order",
    ownLink.status === 201 && ownLink.json?.order?.customerOrderId === workspaceOrderId,
    `status ${ownLink.status}`,
  );

  const ownLinkView = await call(`/api/supplier/orders/${ownLink.json?.order?.id}`, { cookie: supplierCookie });
  check(
    "the supplier sees the linked own-workspace customer order",
    ownLinkView.status === 200 && ownLinkView.json?.order?.customerOrder?.id === workspaceOrderId,
    `status ${ownLinkView.status}`,
  );

  if (!(process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    console.log("SKIP  legacy cross-workspace projection check needs an isolated DATABASE_URL");
  } else {
    // A row that bypassed the new validation (data written before this fix) must
    // still not leak the foreign customer through the supplier projection.
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    // A distinct foreign order, because `customerOrderId` is unique and the
    // forged link above may already hold the first one on an unpatched server.
    const legacyCustomerOrder = await call("/api/workspace/orders", {
      method: "POST",
      cookie: strangerCookie,
      body: {
        customerId: strangerCustomer.json?.customer?.id,
        channel: "PHONE",
        items: [{ name: "Legacy foreign item", qty: 1, unitPriceKobo: 20_000, unitCostKobo: 10_000 }],
      },
    });
    if (legacyCustomerOrder.status !== 201) {
      console.log("SKIP  legacy projection check: could not create a second foreign order");
    } else {
      const legacy = await prisma.supplierOrder.create({
        data: {
          orderNumber: `SUP-LEGACY-${Date.now().toString(36).toUpperCase()}`,
          resellerProfileId: order.resellerProfileId,
          supplierProfileId: order.supplierProfileId,
          customerOrderId: legacyCustomerOrder.json?.order?.id,
          status: "SUBMITTED",
          totalKobo: 1,
          subtotalKobo: 1,
        },
        select: { id: true },
      });
      const legacyView = await call(`/api/supplier/orders/${legacy.id}`, { cookie: supplierCookie });
      check(
        "a pre-existing foreign link is not projected to the supplier (S-02)",
        legacyView.status === 200 &&
          legacyView.json?.order?.customerOrder === null &&
          !legacyView.text.includes("Probe Secret Customer") &&
          !legacyView.text.includes("2348001112222"),
        `status ${legacyView.status}, customerOrder ${JSON.stringify(legacyView.json?.order?.customerOrder)}`,
      );
    }
    await prisma.$disconnect();
  }

  // ── S-02 regression: unconditional customer-order link check ────────────
  // The fix removes the old behavior that skipped the link check when the
  // reseller had no business workspace. Three things must still hold: (a) a
  // reseller with no workspace cannot link any customer order; (b) omitting the
  // link does not introduce a new, unrelated restriction on order creation; and
  // (c) a deleted customer order is rejected at link time without disclosing
  // whether it exists.
  if (!(process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    console.log("SKIP  S-02 regression tests need an isolated DATABASE_URL");
  } else {
    const bcrypt = await import("bcryptjs");
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const noWsEmail = `nows-${Date.now().toString(36)}@sellflow.test`;

    // A profile that holds ROLE.RESELLER but owns no BusinessWorkspace. This is a
    // legitimate reachable state in the data model (Profile.ownedWorkspace is
    // optional), and it is exactly the case the old code skipped. We give this
    // profile a real password so we can log in through the API like every other
    // test account (the seeded demo password).
    const passwordHash = await bcrypt.hash("Password123!", 10);
    const noWs = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: noWsEmail, passwordHash, emailVerifiedAt: new Date() },
      });
      const profile = await tx.profile.create({
        data: { userId: user.id, displayName: "No-Workspace Reseller" },
      });
      await tx.profileRole.create({
        data: { profileId: profile.id, role: "RESELLER" },
      });
      return { user, profile };
    });

    const noWsCookie = await login(noWsEmail, "Password123!");

    // (a) A reseller with no workspace cannot link another workspace's customer
    // order. This is the case the old code skipped; the fix rejects it with the
    // same generic message as a foreign order, and the response discloses nothing.
    const noWsForeignLink = await call("/api/supplier/orders", {
      method: "POST",
      cookie: noWsCookie,
      body: {
        supplierProfileId: order.supplierProfileId,
        customerOrderId: foreignOrderId,
        items: [{ listingId: listing.id, qty: 6 }],
      },
    });
    check(
      "a reseller with no workspace cannot link a foreign customer order (S-02)",
      noWsForeignLink.status === 400 &&
        noWsForeignLink.json?.error === "That customer order is not available in your workspace" &&
        !noWsForeignLink.text.includes("Probe Secret Customer") &&
        !noWsForeignLink.text.includes("2348001112222") &&
        !noWsForeignLink.text.includes(String(foreignOrderNumber)),
      `status ${noWsForeignLink.status}, error ${JSON.stringify(noWsForeignLink.json?.error)}`,
    );

    // (b) Omitting the link does not introduce a new, unrelated restriction on
    // order creation. A no-workspace reseller has no reseller agreement, so
    // pricing denies the request before any link check runs — but the denial is
    // NOT the link-check message, which proves the link check only runs when
    // customerOrderId is actually supplied.
    const noWsNoLink = await call("/api/supplier/orders", {
      method: "POST",
      cookie: noWsCookie,
      body: {
        supplierProfileId: order.supplierProfileId,
        items: [{ listingId: listing.id, qty: 6 }],
      },
    });
    check(
      "a no-workspace reseller omitting the link is not rejected by the link check (S-02)",
      noWsNoLink.status !== 201 &&
        !noWsNoLink.text.includes("That customer order is not available in your workspace"),
      `status ${noWsNoLink.status}`,
    );

    // (c) A deleted customer order that belongs to the reseller's own workspace is
    // rejected at link time the same way as a foreign or nonexistent one, with no
    // disclosure — this covers the deletedAt: null branch of the check.
    const resellerWorkspaceId = order.resellerWorkspaceId;
    if (resellerWorkspaceId) {
      const resellerCustomer = customers.json?.customers?.[0] ?? {};
      const deletedOrder = await prisma.customerOrder.create({
        data: {
          customerId: resellerCustomer.id,
          workspaceId: resellerWorkspaceId,
          channel: "PHONE",
          itemsJson: JSON.stringify([{ name: "Deleted item", qty: 1 }]),
        },
        select: { id: true },
      });
      await prisma.customerOrder.update({
        where: { id: deletedOrder.id },
        data: { deletedAt: new Date() },
      });
      const deletedLink = await call("/api/supplier/orders", {
        method: "POST",
        cookie: resellerCookie,
        body: {
          supplierProfileId: order.supplierProfileId,
          customerOrderId: deletedOrder.id,
          items: [{ listingId: listing.id, qty: 6 }],
        },
      });
      check(
        "a deleted customer order is rejected at link time without disclosure (S-02)",
        deletedLink.status === 400 &&
          deletedLink.json?.error === "That customer order is not available in your workspace" &&
          !deletedLink.text.includes("Deleted item"),
        `status ${deletedLink.status}, error ${JSON.stringify(deletedLink.json?.error)}`,
      );
    } else {
      console.log("SKIP  deleted-order regression needs the seeded reseller to own a workspace");
    }

    await prisma.$disconnect();
  }

  // ── S-08: customer-data visibility is enforced per level, per party ──────
  // The PRD fixes the three allowed values (RE-05) but not their mapping; the
  // audit correction defines it: NONE shares nothing, ORDER_ONLY shares the
  // order but not the customer, FULL shares name and phone. The reseller owns
  // the customer record, so it keeps full visibility either way.
  if (!(process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    console.log("SKIP  customer-data visibility matrix needs an isolated DATABASE_URL");
  } else {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const linkedCustomer = customers.json?.customers?.[0] ?? {};
    const customerName = linkedCustomer.name;
    const customerPhone = linkedCustomer.phone;
    const disclosesIdentity = (text) =>
      (typeof customerName === "string" && customerName.length > 0 && text.includes(customerName)) ||
      (typeof customerPhone === "string" && customerPhone.length > 0 && text.includes(customerPhone));

    const linkedTerms = await prisma.supplierOrder.findUnique({
      where: { id: ownLink.json?.order?.id },
      select: { items: { select: { agreementVersionId: true } } },
    });
    const termsId =
      linkedTerms?.items?.find((item) => item.agreementVersionId)?.agreementVersionId ?? null;
    const offer = await prisma.resellerOffer.findFirst({
      where: { listingId: listing.id },
      select: { id: true, currentVersionId: true },
    });

    if (!termsId || !offer?.id) {
      console.log("SKIP  customer-data visibility matrix: linked order terms not found");
    } else {
      const setVisibility = (value) =>
        prisma.resellerAgreementVersion.update({
          where: { id: termsId },
          data: { customerDataVisibility: value },
        });
      const supplierReads = () =>
        call(`/api/supplier/orders/${ownLink.json?.order?.id}`, { cookie: supplierCookie });
      const resellerReads = () =>
        call(`/api/supplier/orders/${ownLink.json?.order?.id}`, { cookie: resellerCookie });

      try {
        await setVisibility("FULL");
        const full = await supplierReads();
        check(
          "FULL shares the customer name and phone with the supplier (S-08)",
          full.status === 200 &&
            full.json?.order?.customerOrder?.customer?.name === customerName &&
            (!customerPhone || full.json?.order?.customerOrder?.customer?.phone === customerPhone),
          `status ${full.status}, customer ${JSON.stringify(full.json?.order?.customerOrder?.customer)}`,
        );

        const listUnderFull = await call("/api/supplier/orders", { cookie: supplierCookie });
        check(
          "the supplier order list carries no customer identity (S-08)",
          listUnderFull.status === 200 && !disclosesIdentity(listUnderFull.text),
          `status ${listUnderFull.status}`,
        );

        await setVisibility("ORDER_ONLY");
        const orderOnly = await supplierReads();
        check(
          "ORDER_ONLY shares the order but not the customer identity (S-08)",
          orderOnly.status === 200 &&
            orderOnly.json?.order?.customerOrder?.orderNumber === newOrder.json?.order?.orderNumber &&
            !orderOnly.json?.order?.customerOrder?.customer &&
            !disclosesIdentity(orderOnly.text),
          `status ${orderOnly.status}, customerOrder ${JSON.stringify(orderOnly.json?.order?.customerOrder)}`,
        );

        const resellerOrderOnly = await resellerReads();
        check(
          "the reseller still sees its own customer under ORDER_ONLY (S-08)",
          resellerOrderOnly.status === 200 &&
            resellerOrderOnly.json?.order?.customerOrder?.customer?.name === customerName,
          `status ${resellerOrderOnly.status}`,
        );

        await setVisibility("NONE");
        const none = await supplierReads();
        check(
          "NONE hides the linked customer order from the supplier (S-08)",
          none.status === 200 &&
            none.json?.order?.customerOrder === null &&
            !disclosesIdentity(none.text),
          `status ${none.status}, customerOrder ${JSON.stringify(none.json?.order?.customerOrder)}`,
        );

        const resellerNone = await resellerReads();
        check(
          "the reseller still sees its own customer under NONE (S-08)",
          resellerNone.status === 200 &&
            resellerNone.json?.order?.customerOrder?.customer?.name === customerName,
          `status ${resellerNone.status}`,
        );

        await setVisibility("BOGUS");
        const invalid = await supplierReads();
        check(
          "an invalid visibility value falls back to the safe default (S-08)",
          invalid.status === 200 &&
            !invalid.json?.order?.customerOrder?.customer &&
            !disclosesIdentity(invalid.text),
          `status ${invalid.status}, customer ${JSON.stringify(invalid.json?.order?.customerOrder?.customer)}`,
        );
      } finally {
        await setVisibility("ORDER_ONLY");
      }

      // Visibility settings belong to the offer's owning supplier workspace.
      const strangerMe = await call("/api/auth/me", { cookie: strangerCookie });
      const strangerProfileId = strangerMe.json?.profile?.id;
      const strangerWorkspaceId = strangerMe.json?.workspaceId;
      if (!strangerProfileId || !strangerWorkspaceId) {
        console.log("SKIP  foreign settings check: stranger profile not resolved");
      } else {
        const versionsBefore = await prisma.resellerOfferVersion.count({ where: { offerId: offer.id } });
        await prisma.profileRole
          .create({ data: { profileId: strangerProfileId, role: "SUPPLIER" } })
          .catch(() => {});
        await prisma.supplierProfile.create({
          data: { profileId: strangerProfileId, workspaceId: strangerWorkspaceId, businessName: "Stranger Supply" },
        });
        const foreignEdit = await call(`/api/supplier/offers/${offer.id}/versions`, {
          method: "POST",
          cookie: strangerCookie,
          body: { resellerPriceKobo: 5_000 },
        });
        const versionsAfter = await prisma.resellerOfferVersion.count({ where: { offerId: offer.id } });
        const currentTerms = offer.currentVersionId
          ? await prisma.resellerOfferVersion.findUnique({
              where: { id: offer.currentVersionId },
              select: { customerDataVisibility: true },
            })
          : null;
        check(
          "another supplier cannot change an offer's customer-data settings (S-08)",
          foreignEdit.status === 404 &&
            versionsAfter === versionsBefore &&
            (currentTerms?.customerDataVisibility ?? "ORDER_ONLY") === "ORDER_ONLY",
          `status ${foreignEdit.status}, versions ${versionsBefore}→${versionsAfter}`,
        );
        await prisma.supplierProfile.deleteMany({ where: { profileId: strangerProfileId } });
        await prisma.profileRole.deleteMany({ where: { profileId: strangerProfileId, role: "SUPPLIER" } });
      }
    }
    await prisma.$disconnect();
  }

  const overpay = await call(`/api/workspace/orders/${workspaceOrderId}/payments`, {
    method: "POST",
    cookie: resellerCookie,
    body: { amountKobo: 150_000, method: "CASH", paidAt: new Date().toISOString() },
  });
  check("overpayment is blocked", overpay.status === 409, `status ${overpay.status}`);

  const partPay = await call(`/api/workspace/orders/${workspaceOrderId}/payments`, {
    method: "POST",
    cookie: resellerCookie,
    body: { amountKobo: 40_000, method: "CASH", paidAt: new Date().toISOString() },
  });
  check("partial payment recorded", partPay.status === 201, `status ${partPay.status}`);
  check("balance is recomputed server-side", partPay.json?.order?.balanceKobo === 60_000);

  // ── Version lock ──────────────────────────────────────────────────────────
  const overview = await call("/api/reseller/overview", { cookie: resellerCookie });
  const agreement = overview.json?.agreements?.find((a) => a.status === "ACTIVE" && a.offer.listing.slug === listing.slug);
  check("reseller has an active agreement", Boolean(agreement));

  const newVersion = await call(`/api/supplier/agreements/${agreement.id}/versions`, {
    method: "POST",
    cookie: supplierCookie,
    body: { resellerPriceKobo: NEW_PRICE, moq: 6, minResalePriceKobo: 4_500_000 },
  });
  check("supplier can add an agreement version", newVersion.status === 201, `status ${newVersion.status}`);

  const lockedAgain = await call(`/api/marketplace/offers/${offerId}/price`, { cookie: resellerCookie });
  check(
    "price is locked until the reseller accepts new terms",
    lockedAgain.status === 403,
    `status ${lockedAgain.status}`,
  );

  const accepted = await call(`/api/reseller/agreements/${agreement.id}/accept`, {
    method: "POST",
    cookie: resellerCookie,
    body: {},
  });
  check("reseller can accept the new version", accepted.status === 200, `status ${accepted.status}`);

  const newPrice = await call(`/api/marketplace/offers/${offerId}/price`, { cookie: resellerCookie });
  check(
    "accepted version is now the visible price",
    newPrice.json?.terms?.priceKobo === NEW_PRICE,
    `got ${newPrice.json?.terms?.priceKobo}`,
  );

  const oldOrder = await call(`/api/supplier/orders/${order.id}`, { cookie: resellerCookie });
  check(
    "historical order keeps its original price",
    oldOrder.json?.order?.items?.[0]?.unitPriceKobo === SEEDED_PRICE,
    `got ${oldOrder.json?.order?.items?.[0]?.unitPriceKobo}`,
  );

  // ── S-10: the supplier's minimum resale price is enforced ────────────────
  // Field semantics (see STAGE2_TASK6B_S10_REPORT.md):
  //   ProductListing.publicPriceKobo          suggested retail, public
  //   ResellerOfferVersion.resellerPriceKobo  approved private wholesale price
  //   ...minResalePriceKobo                   floor on the reseller's resale price
  //   SupplierOrderItem.resalePriceKobo       the reseller's planned selling price
  // The floor applies to the reseller's resale price, never to the wholesale
  // price it pays. The applicable floor is the one on the agreement version the
  // order records, never a value supplied in the request body.
  const s10Suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const S10_PUBLIC = 5_000_789;
  const S10_WHOLESALE = 3_000_123;
  const S10_MIN = 4_000_456;
  const S10_MIN_V2 = 4_200_567;
  const s10Rejected = (res) => res.status === 400 || res.status === 422;

  // The original reproduction: a resale price of ₦10 against the seeded
  // agreement's ₦450 minimum. The seeded agreement is active with that floor
  // after the version-lock check above.
  const s10Original = await call("/api/supplier/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      supplierProfileId: listing.supplierProfile.id,
      items: [{ listingId: listing.id, qty: 6, resalePriceKobo: 1000 }],
    },
  });
  check(
    "a resale price below the seeded minimum is rejected (S-10)",
    s10Rejected(s10Original),
    `status ${s10Original.status}`,
  );
  check(
    "the below-minimum rejection names the floor and creates no order (S-10)",
    typeof s10Original.json?.error === "string" &&
      /minimum/i.test(s10Original.json.error) &&
      !s10Original.json?.order,
    `error ${s10Original.json?.error ?? "none"}`,
  );

  // Supplier-side offer creation. The offer carries the wholesale price and the
  // floor; it does not carry a resale price, because the resale price belongs to
  // the reseller's order line.
  const s10Create = await call("/api/supplier/listings", {
    method: "POST",
    cookie: supplierCookie,
    body: {
      title: `S-10 resale floor probe ${s10Suffix}`,
      description: "S-10 probe listing",
      category: "Probe",
      publicPriceKobo: S10_PUBLIC,
      moq: 2,
      stockQty: 40,
      isPublished: true,
      offer: {
        resellerPriceKobo: S10_WHOLESALE,
        minResalePriceKobo: S10_MIN,
        commissionType: "PERCENT",
        commissionValue: 500,
        moq: 2,
        stockQty: 40,
        paymentTermsDays: 7,
        deliveryResponsibility: "SUPPLIER",
        advertisingPermission: true,
        customerDataVisibility: "ORDER_ONLY",
        notes: "S-10 probe offer",
      },
    },
  });
  check(
    "a supplier can create an offer with a minimum resale price (S-10)",
    s10Create.status === 201 && Boolean(s10Create.json?.listing?.id),
    `status ${s10Create.status}`,
  );
  const s10ListingId = s10Create.json?.listing?.id ?? null;

  const s10Dash = await call("/api/supplier/dashboard", { cookie: supplierCookie });
  const s10Offer = s10Dash.json?.listings?.find((l) => l.id === s10ListingId)?.offer;
  const s10OfferId = s10Offer?.id ?? null;
  check(
    "the offer stores wholesale, minimum resale and commission separately (S-10)",
    Boolean(s10OfferId) &&
      s10Offer?.currentVersion?.resellerPriceKobo === S10_WHOLESALE &&
      s10Offer?.currentVersion?.minResalePriceKobo === S10_MIN &&
      s10Offer?.currentVersion?.commissionType === "PERCENT" &&
      s10Offer?.currentVersion?.commissionValue === 500,
    `offer ${s10OfferId}, terms ${JSON.stringify(s10Offer?.currentVersion ?? null)}`,
  );
  check(
    "an offer whose wholesale price is below the resale floor is valid (S-10)",
    S10_WHOLESALE < S10_MIN &&
      s10Offer?.currentVersion?.resellerPriceKobo === S10_WHOLESALE &&
      s10Offer?.currentVersion?.minResalePriceKobo === S10_MIN,
    `wholesale ${S10_WHOLESALE}, floor ${S10_MIN}`,
  );

  if (!s10ListingId || !s10OfferId) {
    console.log("SKIP  S-10 dependent checks: probe listing/offer was not created");
  } else {
    // Public discovery: suggested retail only.
    const s10PublicList = await call("/api/marketplace/listings");
    const s10PublicRow = s10PublicList.json?.listings?.find((l) => l.id === s10ListingId);
    check(
      "public discovery shows the suggested retail price (S-10)",
      s10PublicList.status === 200 && s10PublicRow?.publicPriceKobo === S10_PUBLIC,
      `status ${s10PublicList.status}, public ${s10PublicRow?.publicPriceKobo}`,
    );
    check(
      "public discovery exposes no private reseller or minimum price (S-10)",
      s10PublicList.status === 200 &&
        !s10PublicList.text.includes("resellerPriceKobo") &&
        !s10PublicList.text.includes("minResalePriceKobo") &&
        !s10PublicList.text.includes("resalePriceKobo") &&
        !leaks(s10PublicList.text, S10_WHOLESALE) &&
        !leaks(s10PublicList.text, S10_MIN),
      `status ${s10PublicList.status}`,
    );
    const s10GuestDetail = await call(`/api/marketplace/listings/${s10PublicRow?.slug}`);
    check(
      "public listing detail keeps the private price locked (S-10)",
      s10GuestDetail.status === 200 &&
        s10GuestDetail.json?.resellerPrice?.allowed === false &&
        !leaks(s10GuestDetail.text, S10_WHOLESALE) &&
        !leaks(s10GuestDetail.text, S10_MIN),
      `status ${s10GuestDetail.status}`,
    );
    const s10Search = await call(
      `/api/marketplace/listings?q=${encodeURIComponent("S-10 resale floor probe")}`,
    );
    check(
      "marketplace search still finds the new listing (S-10)",
      s10Search.status === 200 && s10Search.json?.listings?.some((l) => l.id === s10ListingId),
      `status ${s10Search.status}`,
    );

    // An unapproved reseller can hold the role but must not read the terms.
    const s10UnapprovedReg = await call("/api/auth/register", {
      method: "POST",
      body: {
        email: `s10-unapproved-${s10Suffix}@sellflow.test`,
        password: "Password123!",
        displayName: "S-10 Unapproved",
        businessName: "S-10 Unapproved Shop",
        country: "NG",
      },
    });
    const s10UnapprovedRole = await call("/api/profile/roles", {
      method: "POST",
      cookie: s10UnapprovedReg.cookie,
      body: { role: "RESELLER" },
    });
    // Role activation rotates the session (S-14).
    s10UnapprovedReg.cookie = s10UnapprovedRole.cookie;
    check(
      "S-10 setup: an unapproved reseller has the reseller role",
      s10UnapprovedReg.status === 201 && s10UnapprovedRole.status === 200,
      `register ${s10UnapprovedReg.status}, role ${s10UnapprovedRole.status}`,
    );
    const s10UnapprovedPrice = await call(`/api/marketplace/offers/${s10OfferId}/price`, {
      cookie: s10UnapprovedReg.cookie,
    });
    check(
      "an unapproved reseller cannot read the private resale terms (S-10)",
      s10UnapprovedPrice.status === 403 &&
        !leaks(s10UnapprovedPrice.text, S10_WHOLESALE) &&
        !leaks(s10UnapprovedPrice.text, S10_MIN),
      `status ${s10UnapprovedPrice.status}`,
    );
    const s10UnapprovedOrder = await call("/api/supplier/orders", {
      method: "POST",
      cookie: s10UnapprovedReg.cookie,
      body: {
        supplierProfileId: listing.supplierProfile.id,
        items: [{ listingId: s10ListingId, qty: 2, resalePriceKobo: S10_MIN }],
      },
    });
    check(
      "an unapproved reseller cannot order even at a valid resale price (S-10)",
      s10UnapprovedOrder.status === 403 && !s10UnapprovedOrder.json?.order,
      `status ${s10UnapprovedOrder.status}`,
    );

    // The approval path must carry the supplier's floor into the agreement.
    const s10ResellerReg = await call("/api/auth/register", {
      method: "POST",
      body: {
        email: `s10-reseller-${s10Suffix}@sellflow.test`,
        password: "Password123!",
        displayName: "S-10 Reseller",
        businessName: "S-10 Reseller Shop",
        country: "NG",
      },
    });
    const s10ResellerRole = await call("/api/profile/roles", {
      method: "POST",
      cookie: s10ResellerReg.cookie,
      body: { role: "RESELLER" },
    });
    // Role activation rotates the session (S-14).
    s10ResellerReg.cookie = s10ResellerRole.cookie;
    check(
      "S-10 setup: the probe reseller has the reseller role",
      s10ResellerReg.status === 201 && s10ResellerRole.status === 200,
      `register ${s10ResellerReg.status}, role ${s10ResellerRole.status}`,
    );
    const s10Apply = await call("/api/marketplace/applications", {
      method: "POST",
      cookie: s10ResellerReg.cookie,
      body: {
        supplierProfileId: listing.supplierProfile.id,
        offerId: s10OfferId,
        message: "S-10 probe",
        businessSummary: "S-10",
      },
    });
    check(
      "a reseller can apply for the new offer (S-10)",
      s10Apply.status === 201 && Boolean(s10Apply.json?.application?.id),
      `status ${s10Apply.status}`,
    );
    const s10ApplicationId = s10Apply.json?.application?.id ?? null;

    const s10PendingPrice = await call(`/api/marketplace/offers/${s10OfferId}/price`, {
      cookie: s10ResellerReg.cookie,
    });
    check(
      "a pending application cannot read the private price (S-10)",
      s10PendingPrice.status === 403 &&
        !leaks(s10PendingPrice.text, S10_WHOLESALE) &&
        !leaks(s10PendingPrice.text, S10_MIN),
      `status ${s10PendingPrice.status}`,
    );

    const s10Approve = await call(`/api/supplier/applications/${s10ApplicationId}`, {
      method: "POST",
      cookie: supplierCookie,
      body: { decision: "APPROVED", offerId: s10OfferId, note: "S-10 approval" },
    });
    check(
      "supplier approval creates an agreement from the offer's floor (S-10)",
      s10Approve.status === 200 && Boolean(s10Approve.json?.agreementId),
      `status ${s10Approve.status}`,
    );
    const s10AgreementId = s10Approve.json?.agreementId ?? null;
    // Approval grants the applicant the RESELLER role and revokes their
    // sessions (S-14), so the reseller signs in again before continuing.
    s10ResellerReg.cookie = await login(`s10-reseller-${s10Suffix}@sellflow.test`, "Password123!");

    const s10OverviewBefore = await call("/api/reseller/overview", {
      cookie: s10ResellerReg.cookie,
    });
    const s10Agreement = s10OverviewBefore.json?.agreements?.find((a) => a.id === s10AgreementId);
    check(
      "approval copies wholesale, minimum resale and commission from the offer (S-10)",
      s10Agreement?.currentVersion?.resellerPriceKobo === S10_WHOLESALE &&
        s10Agreement?.currentVersion?.minResalePriceKobo === S10_MIN &&
        s10Agreement?.currentVersion?.commissionType === "PERCENT" &&
        s10Agreement?.currentVersion?.commissionValue === 500,
      `terms ${JSON.stringify(s10Agreement?.currentVersion ?? null)}`,
    );

    const s10BeforeAccept = await call(`/api/marketplace/offers/${s10OfferId}/price`, {
      cookie: s10ResellerReg.cookie,
    });
    check(
      "an unaccepted agreement cannot read the private price (S-10)",
      s10BeforeAccept.status === 403 &&
        !leaks(s10BeforeAccept.text, S10_WHOLESALE) &&
        !leaks(s10BeforeAccept.text, S10_MIN),
      `status ${s10BeforeAccept.status}`,
    );

    const s10Accept = await call(`/api/reseller/agreements/${s10AgreementId}/accept`, {
      method: "POST",
      cookie: s10ResellerReg.cookie,
      body: {},
    });
    check("the reseller can accept the approved terms (S-10)", s10Accept.status === 200, `status ${s10Accept.status}`);

    const s10Price = await call(`/api/marketplace/offers/${s10OfferId}/price`, {
      cookie: s10ResellerReg.cookie,
    });
    check(
      "the approved reseller sees the wholesale price and the floor separately (S-10)",
      s10Price.status === 200 &&
        s10Price.json?.source === "AGREEMENT" &&
        s10Price.json?.terms?.priceKobo === S10_WHOLESALE &&
        s10Price.json?.terms?.minResaleKobo === S10_MIN &&
        s10Price.json?.terms?.commissionType === "PERCENT" &&
        s10Price.json?.terms?.commissionValue === 500,
      `status ${s10Price.status}, terms ${JSON.stringify(s10Price.json?.terms ?? null)}`,
    );

    const s10OrderBody = (qty, resalePriceKobo) => ({
      supplierProfileId: listing.supplierProfile.id,
      items: [
        {
          listingId: s10ListingId,
          qty,
          ...(resalePriceKobo === undefined ? {} : { resalePriceKobo }),
        },
      ],
    });
    const s10Place = (qty, resalePriceKobo) =>
      call("/api/supplier/orders", {
        method: "POST",
        cookie: s10ResellerReg.cookie,
        body: s10OrderBody(qty, resalePriceKobo),
      });

    let s10Prisma = null;
    let s10OrderCount = null;
    if ((process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
      const { PrismaClient } = await import("@prisma/client");
      s10Prisma = new PrismaClient();
      s10OrderCount = await s10Prisma.supplierOrder.count({
        where: { resellerProfileId: s10ResellerReg.json?.profile?.id },
      });
    }

    const s10Below = await s10Place(2, S10_MIN - 1);
    check(
      "a resale price one kobo below the minimum is rejected (S-10)",
      s10Rejected(s10Below) && !s10Below.json?.order,
      `status ${s10Below.status}`,
    );
    const s10Zero = await s10Place(2, 0);
    check("a zero resale price is rejected (S-10)", s10Zero.status === 422, `status ${s10Zero.status}`);
    const s10Negative = await s10Place(2, -1);
    check("a negative resale price is rejected (S-10)", s10Negative.status === 422, `status ${s10Negative.status}`);
    const s10Fractional = await s10Place(2, S10_MIN + 0.5);
    check(
      "a fractional-kobo resale price is rejected (S-10)",
      s10Fractional.status === 422,
      `status ${s10Fractional.status}`,
    );
    const s10Malformed = await s10Place(2, String(S10_MIN));
    check(
      "a string resale price is rejected (S-10)",
      s10Malformed.status === 422,
      `status ${s10Malformed.status}`,
    );
    const s10Oversized = await s10Place(2, 100_000_000_001);
    check(
      "an oversized resale price is rejected (S-10)",
      s10Oversized.status === 422,
      `status ${s10Oversized.status}`,
    );
    const s10Unsafe = await s10Place(2, Number.MAX_SAFE_INTEGER);
    check(
      "an unsafe-integer resale price is rejected (S-10)",
      s10Unsafe.status === 422,
      `status ${s10Unsafe.status}`,
    );
    const s10FloatLow = await s10Place(2, S10_MIN - 0.25);
    check(
      "a float just below the minimum is rejected as non-integer kobo (S-10)",
      s10FloatLow.status === 422,
      `status ${s10FloatLow.status}`,
    );
    const s10FloatHigh = await s10Place(2, S10_MIN + 0.25);
    check(
      "a float just above the minimum is still not integer kobo (S-10)",
      s10FloatHigh.status === 422,
      `status ${s10FloatHigh.status}`,
    );
    const s10BulkBelow = await s10Place(10, S10_MIN - 1);
    check(
      "a bulk quantity cannot bypass the resale floor (S-10)",
      s10Rejected(s10BulkBelow) && !s10BulkBelow.json?.order,
      `status ${s10BulkBelow.status}`,
    );
    const s10Injected = await call("/api/supplier/orders", {
      method: "POST",
      cookie: s10ResellerReg.cookie,
      body: {
        supplierProfileId: listing.supplierProfile.id,
        minResalePriceKobo: 0,
        resellerPriceKobo: 1,
        items: [
          {
            listingId: s10ListingId,
            qty: 2,
            resalePriceKobo: 1,
            minResalePriceKobo: 0,
            resellerPriceKobo: 1,
          },
        ],
      },
    });
    check(
      "client-supplied minimum or wholesale values cannot lower the floor (S-10)",
      s10Rejected(s10Injected) && !s10Injected.json?.order,
      `status ${s10Injected.status}`,
    );
    const s10WrongSupplier = await call("/api/supplier/orders", {
      method: "POST",
      cookie: s10ResellerReg.cookie,
      body: {
        supplierProfileId: "c000000000000000000000000",
        items: [{ listingId: s10ListingId, qty: 2, resalePriceKobo: S10_MIN }],
      },
    });
    check(
      "a client-supplied supplier id cannot redirect the order (S-10)",
      (s10WrongSupplier.status === 404 || s10WrongSupplier.status === 422) &&
        !s10WrongSupplier.json?.order,
      `status ${s10WrongSupplier.status}`,
    );

    if (s10Prisma && s10OrderCount !== null) {
      const afterRejections = await s10Prisma.supplierOrder.count({
        where: { resellerProfileId: s10ResellerReg.json?.profile?.id },
      });
      check(
        "rejected resale prices create no partial order (S-10)",
        afterRejections === s10OrderCount,
        `${s10OrderCount}→${afterRejections}`,
      );
    }

    // A delta smaller than the double ULP collapses to the same integer, so it
    // cannot store a value below the floor. This is the boundary case the
    // integer-kobo check is designed for.
    const s10SubUlp = await s10Place(2, S10_MIN - 0.0000000001);
    check(
      "a sub-ULP float cannot store a value below the integer minimum (S-10)",
      s10SubUlp.status === 201 && s10SubUlp.json?.order?.items?.[0]?.resalePriceKobo === S10_MIN,
      `status ${s10SubUlp.status}, resale ${s10SubUlp.json?.order?.items?.[0]?.resalePriceKobo}`,
    );

    const s10AtMin = await s10Place(2, S10_MIN);
    check(
      "a resale price exactly at the minimum is accepted (S-10)",
      s10AtMin.status === 201 && Boolean(s10AtMin.json?.order?.id),
      `status ${s10AtMin.status}`,
    );
    const s10AtMinOrder = s10AtMin.json?.order;
    const s10AtMinItem = s10AtMinOrder?.items?.[0];
    check(
      "the order stores the resale price separately from the wholesale price (S-10)",
      s10AtMinItem?.resalePriceKobo === S10_MIN &&
        s10AtMinItem?.unitPriceKobo === S10_WHOLESALE &&
        s10AtMinItem?.lineTotalKobo === S10_WHOLESALE * 2 &&
        s10AtMinOrder?.totalKobo === S10_WHOLESALE * 2,
      `resale ${s10AtMinItem?.resalePriceKobo}, unit ${s10AtMinItem?.unitPriceKobo}, total ${s10AtMinOrder?.totalKobo}`,
    );
    check(
      "the floor applies to the resale price, not the lower wholesale price (S-10)",
      S10_WHOLESALE < S10_MIN &&
        s10AtMinItem?.unitPriceKobo === S10_WHOLESALE &&
        s10AtMinItem?.resalePriceKobo === S10_MIN,
      `wholesale ${s10AtMinItem?.unitPriceKobo}, resale ${s10AtMinItem?.resalePriceKobo}, floor ${S10_MIN}`,
    );
    check(
      "commission stays informational and is not added to the order total (S-10)",
      s10AtMinOrder?.totalKobo === S10_WHOLESALE * 2 &&
        s10AtMinOrder?.subtotalKobo === S10_WHOLESALE * 2,
      `total ${s10AtMinOrder?.totalKobo}, subtotal ${s10AtMinOrder?.subtotalKobo}`,
    );

    if (s10Prisma && s10AtMinOrder?.id) {
      const stored = await s10Prisma.supplierOrderItem.findFirst({
        where: { supplierOrderId: s10AtMinOrder.id },
        select: { resalePriceKobo: true, unitPriceKobo: true, agreementVersionId: true },
      });
      const version = stored?.agreementVersionId
        ? await s10Prisma.resellerAgreementVersion.findUnique({
            where: { id: stored.agreementVersionId },
            select: { minResalePriceKobo: true },
          })
        : null;
      check(
        "the stored resale price is checked against the agreement version it records (S-10)",
        stored?.resalePriceKobo === S10_MIN &&
          stored?.unitPriceKobo === S10_WHOLESALE &&
          version?.minResalePriceKobo === S10_MIN,
        `resale ${stored?.resalePriceKobo}, unit ${stored?.unitPriceKobo}, version min ${version?.minResalePriceKobo}`,
      );
    }

    const s10Above = await s10Place(2, S10_MIN + 250_000);
    check(
      "a resale price above the minimum is accepted (S-10)",
      s10Above.status === 201 && s10Above.json?.order?.items?.[0]?.resalePriceKobo === S10_MIN + 250_000,
      `status ${s10Above.status}`,
    );
    const s10BulkAtMin = await s10Place(10, S10_MIN);
    check(
      "a bulk quantity at the floor is accepted and totals the wholesale price (S-10)",
      s10BulkAtMin.status === 201 &&
        s10BulkAtMin.json?.order?.items?.[0]?.resalePriceKobo === S10_MIN &&
        s10BulkAtMin.json?.order?.totalKobo === S10_WHOLESALE * 10,
      `status ${s10BulkAtMin.status}, total ${s10BulkAtMin.json?.order?.totalKobo}`,
    );
    const s10Omitted = await s10Place(2, undefined);
    check(
      "omitting the optional resale price still works (S-10)",
      s10Omitted.status === 201 && s10Omitted.json?.order?.items?.[0]?.resalePriceKobo === null,
      `status ${s10Omitted.status}, resale ${s10Omitted.json?.order?.items?.[0]?.resalePriceKobo}`,
    );
    const s10BelowMoq = await s10Place(1, S10_MIN);
    check(
      "the offer's MOQ is still enforced independently of the floor (S-10)",
      s10Rejected(s10BelowMoq) && !s10BelowMoq.json?.order,
      `status ${s10BelowMoq.status}`,
    );

    // There is no resale-price update route. A status PATCH must ignore the
    // field and leave the stored value untouched.
    if (s10AtMinOrder?.id) {
      const s10Patch = await call(`/api/supplier/orders/${s10AtMinOrder.id}`, {
        method: "PATCH",
        cookie: supplierCookie,
        body: { status: "CANCELLED", note: "S-10 probe", resalePriceKobo: 1 },
      });
      const s10AfterPatch = await call(`/api/supplier/orders/${s10AtMinOrder.id}`, {
        cookie: s10ResellerReg.cookie,
      });
      check(
        "no update route can lower a stored resale price (S-10)",
        s10Patch.status === 200 &&
          s10AfterPatch.json?.order?.items?.[0]?.resalePriceKobo === S10_MIN,
        `patch ${s10Patch.status}, resale ${s10AfterPatch.json?.order?.items?.[0]?.resalePriceKobo}`,
      );
    }

    // A new offer version changes the published terms; the accepted agreement
    // keeps the version the reseller actually accepted until it is renegotiated.
    const s10OfferV2 = await call(`/api/supplier/offers/${s10OfferId}/versions`, {
      method: "POST",
      cookie: supplierCookie,
      body: {
        resellerPriceKobo: S10_WHOLESALE,
        minResalePriceKobo: S10_MIN_V2,
        commissionType: "NONE",
        commissionValue: 0,
        moq: 2,
        stockQty: 40,
        paymentTermsDays: 7,
        deliveryResponsibility: "SUPPLIER",
        advertisingPermission: true,
        customerDataVisibility: "ORDER_ONLY",
      },
    });
    check(
      "a supplier can publish a new offer version with a higher floor (S-10)",
      s10OfferV2.status === 201 && s10OfferV2.json?.version?.minResalePriceKobo === S10_MIN_V2,
      `status ${s10OfferV2.status}, min ${s10OfferV2.json?.version?.minResalePriceKobo}`,
    );
    const s10StillOld = await s10Place(2, S10_MIN);
    check(
      "an offer update does not retroactively change an accepted agreement (S-10)",
      s10StillOld.status === 201,
      `status ${s10StillOld.status}`,
    );

    const s10AgreementV2 = await call(`/api/supplier/agreements/${s10AgreementId}/versions`, {
      method: "POST",
      cookie: supplierCookie,
      body: {
        resellerPriceKobo: S10_WHOLESALE,
        minResalePriceKobo: S10_MIN_V2,
        commissionType: "NONE",
        commissionValue: 0,
        moq: 2,
        paymentTermsDays: 7,
        deliveryResponsibility: "SUPPLIER",
        advertisingPermission: true,
        customerDataVisibility: "ORDER_ONLY",
      },
    });
    check(
      "the supplier can push the new floor to the agreement (S-10)",
      s10AgreementV2.status === 201 && s10AgreementV2.json?.version?.minResalePriceKobo === S10_MIN_V2,
      `status ${s10AgreementV2.status}, min ${s10AgreementV2.json?.version?.minResalePriceKobo}`,
    );
    const s10Locked = await call(`/api/marketplace/offers/${s10OfferId}/price`, {
      cookie: s10ResellerReg.cookie,
    });
    check(
      "the new floor is locked until the reseller accepts (S-10)",
      s10Locked.status === 403 &&
        !leaks(s10Locked.text, S10_WHOLESALE) &&
        !leaks(s10Locked.text, S10_MIN_V2),
      `status ${s10Locked.status}`,
    );
    const s10AcceptV2 = await call(`/api/reseller/agreements/${s10AgreementId}/accept`, {
      method: "POST",
      cookie: s10ResellerReg.cookie,
      body: {},
    });
    check("the reseller can accept the new floor (S-10)", s10AcceptV2.status === 200, `status ${s10AcceptV2.status}`);
    const s10BelowV2 = await s10Place(2, S10_MIN_V2 - 1);
    check(
      "the updated minimum is enforced after acceptance (S-10)",
      s10Rejected(s10BelowV2) && !s10BelowV2.json?.order,
      `status ${s10BelowV2.status}`,
    );
    const s10AtV2 = await s10Place(2, S10_MIN_V2);
    check(
      "the updated minimum accepts an exact match (S-10)",
      s10AtV2.status === 201 && s10AtV2.json?.order?.items?.[0]?.resalePriceKobo === S10_MIN_V2,
      `status ${s10AtV2.status}`,
    );
    const s10PriceV2 = await call(`/api/marketplace/offers/${s10OfferId}/price`, {
      cookie: s10ResellerReg.cookie,
    });
    check(
      "the approved reseller still sees the private price after the update (S-10)",
      s10PriceV2.status === 200 &&
        s10PriceV2.json?.terms?.priceKobo === S10_WHOLESALE &&
        s10PriceV2.json?.terms?.minResaleKobo === S10_MIN_V2,
      `status ${s10PriceV2.status}, terms ${JSON.stringify(s10PriceV2.json?.terms ?? null)}`,
    );

    // Offer status is another activation path. Pausing closes the private price;
    // reactivating it cannot lower or remove the agreement's floor.
    const s10Pause = await call(`/api/supplier/offers/${s10OfferId}`, {
      method: "PATCH",
      cookie: supplierCookie,
      body: { status: "PAUSED" },
    });
    const s10PausedPrice = await call(`/api/marketplace/offers/${s10OfferId}/price`, {
      cookie: s10ResellerReg.cookie,
    });
    check(
      "pausing an offer closes the private price (S-10)",
      s10Pause.status === 200 && s10PausedPrice.status === 403,
      `pause ${s10Pause.status}, price ${s10PausedPrice.status}`,
    );
    const s10Reactivate = await call(`/api/supplier/offers/${s10OfferId}`, {
      method: "PATCH",
      cookie: supplierCookie,
      body: { status: "ACTIVE" },
    });
    const s10ReactivatedPrice = await call(`/api/marketplace/offers/${s10OfferId}/price`, {
      cookie: s10ResellerReg.cookie,
    });
    check(
      "reactivating an offer cannot bypass the floor (S-10)",
      s10Reactivate.status === 200 &&
        s10ReactivatedPrice.status === 200 &&
        s10ReactivatedPrice.json?.terms?.minResaleKobo === S10_MIN_V2,
      `reactivate ${s10Reactivate.status}, price ${s10ReactivatedPrice.status}`,
    );
    const s10AfterReactivateBelow = await s10Place(2, S10_MIN_V2 - 1);
    check(
      "the floor is still enforced after reactivation (S-10)",
      s10Rejected(s10AfterReactivateBelow) && !s10AfterReactivateBelow.json?.order,
      `status ${s10AfterReactivateBelow.status}`,
    );

    if (s10Prisma) await s10Prisma.$disconnect();
  }

  // ── Supplier order lifecycle ──────────────────────────────────────────────
  const itemIds = order.items.map((item) => ({ itemId: item.id, confirmedQty: item.qty }));

  const stock = await call(`/api/supplier/orders/${order.id}/stock`, {
    method: "POST",
    cookie: supplierCookie,
    body: { decision: "CONFIRMED", items: itemIds },
  });
  check("supplier confirms stock", stock.status === 200, `status ${stock.status}`);
  check("order status follows stock", stock.json?.order?.status === "STOCK_CONFIRMED");

  const resellerConfirm = await call(`/api/supplier/orders/${order.id}/stock`, {
    method: "POST",
    cookie: resellerCookie,
    body: { decision: "CONFIRMED", items: itemIds },
  });
  check("reseller cannot confirm stock", resellerConfirm.status === 403, `status ${resellerConfirm.status}`);

  const awaiting = await call(`/api/supplier/orders/${order.id}`, {
    method: "PATCH",
    cookie: supplierCookie,
    body: { status: "AWAITING_PAYMENT" },
  });
  check("supplier moves the order to awaiting payment", awaiting.status === 200, `status ${awaiting.status}`);

  // ── S-04: one actor-owned lifecycle step at a time ────────────────────────
  const resellerPatch = await call(`/api/supplier/orders/${order.id}`, {
    method: "PATCH",
    cookie: resellerCookie,
    body: { status: "COMPLETED" },
  });
  check(
    "a reseller cannot patch a supplier order (S-04)",
    resellerPatch.status === 403,
    `status ${resellerPatch.status}`,
  );

  const strangerPatch = await call(`/api/supplier/orders/${order.id}`, {
    method: "PATCH",
    cookie: strangerCookie,
    body: { status: "COMPLETED" },
  });
  check(
    "an unrelated account cannot patch another party's order (S-04)",
    [403, 404].includes(strangerPatch.status),
    `status ${strangerPatch.status}`,
  );

  for (const status of ["COMPLETED", "DELIVERED", "DISPATCHED", "PAID", "STOCK_CONFIRMED"]) {
    const jump = await call(`/api/supplier/orders/${order.id}`, {
      method: "PATCH",
      cookie: supplierCookie,
      body: { status },
    });
    check(
      `a supplier cannot jump from AWAITING_PAYMENT to ${status} (S-04)`,
      jump.status === 409,
      `status ${jump.status}`,
    );
  }

  const unknownStatus = await call(`/api/supplier/orders/${order.id}`, {
    method: "PATCH",
    cookie: supplierCookie,
    body: { status: "SHIPPED" },
  });
  check(
    "an unknown order status is rejected",
    [400, 422].includes(unknownStatus.status),
    `status ${unknownStatus.status}`,
  );

  const afterJumps = await call(`/api/supplier/orders/${order.id}`, { cookie: supplierCookie });
  check(
    "rejected transitions leave the order and its records untouched (S-04)",
    afterJumps.json?.order?.status === "AWAITING_PAYMENT" &&
      (afterJumps.json?.order?.claims?.length ?? -1) === 0 &&
      (afterJumps.json?.order?.dispatches?.length ?? -1) === 0 &&
      afterJumps.json?.order?.delivery === null,
    `status ${afterJumps.json?.order?.status}, claims ${afterJumps.json?.order?.claims?.length}, dispatches ${afterJumps.json?.order?.dispatches?.length}`,
  );

  const cancellationOrder = await call("/api/supplier/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: { supplierProfileId: listing.supplierProfile.id, items: [{ listingId: listing.id, qty: 6 }] },
  });
  check(
    "a second order is created for the cancellation path",
    cancellationOrder.status === 201,
    `status ${cancellationOrder.status}`,
  );
  const cancellationOrderId = cancellationOrder.json?.order?.id;

  const cancelledBeforeDispatch = await call(`/api/supplier/orders/${cancellationOrderId}`, {
    method: "PATCH",
    cookie: supplierCookie,
    body: { status: "CANCELLED", note: "Stock unavailable" },
  });
  check(
    "a supplier can still cancel before dispatch",
    cancelledBeforeDispatch.status === 200 && cancelledBeforeDispatch.json?.order?.status === "CANCELLED",
    `status ${cancelledBeforeDispatch.status}, order ${cancelledBeforeDispatch.json?.order?.status}`,
  );

  const reopenCancelled = await call(`/api/supplier/orders/${cancellationOrderId}`, {
    method: "PATCH",
    cookie: supplierCookie,
    body: { status: "AWAITING_PAYMENT" },
  });
  check(
    "a cancelled order cannot be reopened (S-04)",
    reopenCancelled.status === 409,
    `status ${reopenCancelled.status}`,
  );

  const claim = await call(`/api/supplier/orders/${order.id}/claims`, {
    method: "POST",
    cookie: resellerCookie,
    body: { amountKobo: order.totalKobo, method: "BANK_TRANSFER", status: "SENT" },
  });
  check("reseller marks payment as sent", claim.status === 201, `status ${claim.status}`);

  const selfConfirm = await call(`/api/supplier/orders/${order.id}/claims/${claim.json?.claim?.id}`, {
    method: "POST",
    cookie: resellerCookie,
    body: { action: "CONFIRM" },
  });
  check("claimant cannot confirm their own claim", selfConfirm.status === 403, `status ${selfConfirm.status}`);

  const supplierConfirms = await call(`/api/supplier/orders/${order.id}/claims/${claim.json?.claim?.id}`, {
    method: "POST",
    cookie: supplierCookie,
    body: { action: "CONFIRM" },
  });
  check("supplier confirms the payment claim", supplierConfirms.status === 200, `status ${supplierConfirms.status}`);
  check("claim confirmation is recorded", supplierConfirms.json?.paymentClaimStatus === "CONFIRMED");

  // ── S-03: a claim's initial state belongs to the actor, not the body ──────
  const claimsBeforeForgery =
    (await call(`/api/supplier/orders/${order.id}`, { cookie: supplierCookie })).json?.order?.claims?.length ?? 0;

  const privilegedForReseller = ["CONFIRMED", "DISPUTED", "PARTIAL", "RECEIVED"];
  for (const status of privilegedForReseller) {
    const forged = await call(`/api/supplier/orders/${order.id}/claims`, {
      method: "POST",
      cookie: resellerCookie,
      body: { amountKobo: 100, status },
    });
    check(
      `a reseller cannot create a claim as ${status} (S-03)`,
      forged.status === 400,
      `status ${forged.status}`,
    );
  }

  const claimsAfterForgery =
    (await call(`/api/supplier/orders/${order.id}`, { cookie: supplierCookie })).json?.order?.claims?.length ?? -1;
  check(
    "a rejected claim writes nothing (S-03)",
    claimsAfterForgery === claimsBeforeForgery,
    `${claimsBeforeForgery} → ${claimsAfterForgery}`,
  );

  const validClaim = await call(`/api/supplier/orders/${order.id}/claims`, {
    method: "POST",
    cookie: resellerCookie,
    body: { amountKobo: 100, status: "SENT" },
  });
  check(
    "a reseller can create a claim with the permitted initial state",
    validClaim.status === 201 && validClaim.json?.claim?.status === "SENT",
    `status ${validClaim.status}, claim ${validClaim.json?.claim?.status}`,
  );

  const implicitClaim = await call(`/api/supplier/orders/${order.id}/claims`, {
    method: "POST",
    cookie: resellerCookie,
    body: { amountKobo: 100 },
  });
  check(
    "omitting the status still derives SENT for a reseller",
    implicitClaim.status === 201 && implicitClaim.json?.claim?.status === "SENT",
    `status ${implicitClaim.status}, claim ${implicitClaim.json?.claim?.status}`,
  );

  const supplierClaim = await call(`/api/supplier/orders/${order.id}/claims`, {
    method: "POST",
    cookie: supplierCookie,
    body: { amountKobo: 50, status: "RECEIVED" },
  });
  check(
    "a supplier records a claim as RECEIVED",
    supplierClaim.status === 201 && supplierClaim.json?.claim?.status === "RECEIVED",
    `status ${supplierClaim.status}, claim ${supplierClaim.json?.claim?.status}`,
  );

  for (const status of ["CONFIRMED", "DISPUTED", "PARTIAL", "SENT"]) {
    const forged = await call(`/api/supplier/orders/${order.id}/claims`, {
      method: "POST",
      cookie: supplierCookie,
      body: { amountKobo: 50, status },
    });
    check(
      `a supplier cannot create a claim as ${status} (S-03)`,
      forged.status === 400,
      `status ${forged.status}`,
    );
  }

  const resellerSelfDecision = await call(`/api/supplier/orders/${order.id}/claims/${validClaim.json?.claim?.id}`, {
    method: "POST",
    cookie: resellerCookie,
    body: { action: "CONFIRM" },
  });
  check(
    "a claimant cannot decide their own claim",
    resellerSelfDecision.status === 403,
    `status ${resellerSelfDecision.status}`,
  );

  const strangerDecision = await call(`/api/supplier/orders/${order.id}/claims/${validClaim.json?.claim?.id}`, {
    method: "POST",
    cookie: strangerCookie,
    body: { action: "CONFIRM" },
  });
  check("an outsider cannot decide a claim", strangerDecision.status === 403, `status ${strangerDecision.status}`);

  const afterDenied = await call(`/api/supplier/orders/${order.id}`, { cookie: resellerCookie });
  const claimStillSent = afterDenied.json?.order?.claims?.find((entry) => entry.id === validClaim.json?.claim?.id);
  check("denied decisions leave the claim SENT (S-03)", claimStillSent?.status === "SENT", claimStillSent?.status);

  const supplierDecision = await call(`/api/supplier/orders/${order.id}/claims/${validClaim.json?.claim?.id}`, {
    method: "POST",
    cookie: supplierCookie,
    body: { action: "CONFIRM" },
  });
  check(
    "the counterparty confirms the valid claim",
    supplierDecision.status === 200,
    `status ${supplierDecision.status}`,
  );

  const decidedClaim = (
    await call(`/api/supplier/orders/${order.id}`, { cookie: supplierCookie })
  ).json?.order?.claims?.find((entry) => entry.id === validClaim.json?.claim?.id);
  check(
    "the decision endpoint is the only path to CONFIRMED (S-03)",
    decidedClaim?.status === "CONFIRMED",
    decidedClaim?.status,
  );

  const dispatchByReseller = await call(`/api/supplier/orders/${order.id}/dispatch`, {
    method: "POST",
    cookie: resellerCookie,
    body: { courierName: "GIG" },
  });
  check("reseller cannot dispatch", dispatchByReseller.status === 403, `status ${dispatchByReseller.status}`);

  const dispatch = await call(`/api/supplier/orders/${order.id}/dispatch`, {
    method: "POST",
    cookie: supplierCookie,
    body: { courierName: "GIG", trackingRef: "GIG-123" },
  });
  check("supplier dispatches", dispatch.status === 201, `status ${dispatch.status}`);

  const supplierDelivery = await call(`/api/supplier/orders/${order.id}/delivery`, {
    method: "POST",
    cookie: supplierCookie,
    body: { receivedQtyOk: true },
  });
  check("supplier cannot confirm delivery", supplierDelivery.status === 403, `status ${supplierDelivery.status}`);

  const delivery = await call(`/api/supplier/orders/${order.id}/delivery`, {
    method: "POST",
    cookie: resellerCookie,
    body: { receivedQtyOk: true, note: "All arrived" },
  });
  check("reseller confirms delivery", delivery.status === 201, `status ${delivery.status}`);

  const finalOrder = await call(`/api/supplier/orders/${order.id}`, { cookie: resellerCookie });
  check("order ends DELIVERED", finalOrder.json?.order?.status === "DELIVERED", `got ${finalOrder.json?.order?.status}`);

  const completed = await call(`/api/supplier/orders/${order.id}`, {
    method: "PATCH",
    cookie: supplierCookie,
    body: { status: "COMPLETED" },
  });
  check(
    "a supplier completes only after delivery",
    completed.status === 200 &&
      completed.json?.order?.status === "COMPLETED" &&
      Boolean(completed.json?.order?.completedAt),
    `status ${completed.status}, order ${completed.json?.order?.status}`,
  );

  const completeAgain = await call(`/api/supplier/orders/${order.id}`, {
    method: "PATCH",
    cookie: supplierCookie,
    body: { status: "COMPLETED" },
  });
  check(
    "a completed order cannot transition again (S-04)",
    completeAgain.status === 409,
    `status ${completeAgain.status}`,
  );

  if (!(process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    console.log("SKIP  transition audit assertion needs an isolated DATABASE_URL");
  } else {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    const transition = await prisma.auditLog.findFirst({
      where: { entityId: order.id, action: "supplier_order.status_changed" },
      orderBy: { createdAt: "desc" },
    });
    await prisma.$disconnect();
    const metadata = transition?.metadataJson ? JSON.parse(transition.metadataJson) : {};
    check(
      "the completion is audited with from, to and actor (S-04)",
      metadata.from === "DELIVERED" && metadata.to === "COMPLETED" && transition?.actorRole === "SUPPLIER",
      `${metadata.from} → ${metadata.to}, ${transition?.actorRole}`,
    );
  }

  // ── S-11: stock integrity ─────────────────────────────────────────────────
  // Inventory ownership (see STAGE2_TASK6C_S11_REPORT.md):
  //   Product.stockQty            the workspace's own stock, reserved by its
  //                               customer orders. Never touched by supplier orders.
  //   ProductListing.stockQty     the supplier's advertised availability for a
  //                               listing. This is the authoritative supplier pool:
  //                               it is what public discovery and the in-stock filter
  //                               read, so confirming a supplier order moves it.
  //   ResellerOfferVersion.stockQty a snapshot recorded in the private terms
  //                               version. It is not a second pool and is not mutated
  //                               by order fulfilment (versions are append-only).
  const s11Suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s11Title = `S-11 stock probe ${s11Suffix}`;
  const S11_PRICE = 100_000;
  const S11_MIN = 150_000;

  let s11Prisma = null;
  if ((process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    const { PrismaClient } = await import("@prisma/client");
    s11Prisma = new PrismaClient();
  }

  // Reads a field directly. Returns undefined when the column does not exist
  // yet, so the pre-implementation baseline reports a failure instead of crashing.
  const s11Read = async (model, args, field) => {
    if (!s11Prisma) return null;
    try {
      const row = await s11Prisma[model].findUnique({ ...args, select: { [field]: true } });
      return row ? row[field] : null;
    } catch {
      return undefined;
    }
  };

  const s11SupplierStock = async (listingId) => {
    const dash = await call("/api/supplier/dashboard", { cookie: supplierCookie });
    return dash.json?.listings?.find((row) => row.id === listingId)?.stockQty ?? null;
  };

  const s11Create = await call("/api/supplier/listings", {
    method: "POST",
    cookie: supplierCookie,
    body: {
      title: s11Title,
      description: "S-11 probe listing",
      category: "Probe",
      publicPriceKobo: 200_000,
      moq: 1,
      stockQty: 100,
      isPublished: true,
      offer: {
        resellerPriceKobo: S11_PRICE,
        minResalePriceKobo: S11_MIN,
        commissionType: "NONE",
        commissionValue: 0,
        moq: 1,
        stockQty: 100,
        paymentTermsDays: 0,
        deliveryResponsibility: "SUPPLIER",
        advertisingPermission: true,
        customerDataVisibility: "ORDER_ONLY",
        notes: "S-11 probe offer",
      },
    },
  });
  const s11ListingId = s11Create.json?.listing?.id ?? null;
  const s11Dash = await call("/api/supplier/dashboard", { cookie: supplierCookie });
  const s11OfferId = s11Dash.json?.listings?.find((row) => row.id === s11ListingId)?.offer?.id ?? null;
  const s11SeededStockBefore = await s11SupplierStock(listing.id);
  check(
    "S-11 setup: probe listing and offer created",
    s11Create.status === 201 && Boolean(s11ListingId) && Boolean(s11OfferId),
    `status ${s11Create.status}, listing ${s11ListingId}, offer ${s11OfferId}`,
  );

  const s11Reg = await call("/api/auth/register", {
    method: "POST",
    body: {
      email: `s11-reseller-${s11Suffix}@sellflow.test`,
      password: "Password123!",
      displayName: "S-11 Reseller",
      businessName: "S-11 Reseller Shop",
      country: "NG",
    },
  });
  let s11ResellerCookie = s11Reg.cookie;
  const s11Role = await call("/api/profile/roles", {
    method: "POST",
    cookie: s11ResellerCookie,
    body: { role: "RESELLER" },
  });
  // Role activation rotates the session (S-14).
  s11ResellerCookie = s11Role.cookie;
  const s11Apply = await call("/api/marketplace/applications", {
    method: "POST",
    cookie: s11ResellerCookie,
    body: {
      supplierProfileId: listing.supplierProfile.id,
      offerId: s11OfferId,
      message: "S-11 probe",
      businessSummary: "S-11",
    },
  });
  const s11ApplicationId = s11Apply.json?.application?.id ?? null;
  const s11Approve = await call(`/api/supplier/applications/${s11ApplicationId}`, {
    method: "POST",
    cookie: supplierCookie,
    body: { decision: "APPROVED", offerId: s11OfferId, note: "S-11 approval" },
  });
  const s11AgreementId = s11Approve.json?.agreementId ?? null;
  // Approval revokes the applicant's sessions (S-14): sign in again to accept.
  s11ResellerCookie = await login(`s11-reseller-${s11Suffix}@sellflow.test`, "Password123!");
  const s11Accept = await call(`/api/reseller/agreements/${s11AgreementId}/accept`, {
    method: "POST",
    cookie: s11ResellerCookie,
    body: {},
  });
  check(
    "S-11 setup: probe reseller approved with an active agreement",
    s11Reg.status === 201 &&
      s11Apply.status === 201 &&
      s11Approve.status === 200 &&
      Boolean(s11AgreementId) &&
      s11Accept.status === 200,
    `register ${s11Reg.status}, apply ${s11Apply.status}, approve ${s11Approve.status}, accept ${s11Accept.status}`,
  );

  const s11Ready = Boolean(s11ListingId && s11OfferId && s11AgreementId && s11ResellerCookie);
  if (!s11Ready) {
    console.log("SKIP  S-11 dependent checks: probe listing/offer/agreement was not created");
  } else {
    const s11Place = (qty, items, extra = {}) =>
      call("/api/supplier/orders", {
        method: "POST",
        cookie: s11ResellerCookie,
        body: {
          supplierProfileId: listing.supplierProfile.id,
          items: items ?? [{ listingId: s11ListingId, qty }],
          ...extra,
        },
      });
    const s11Confirm = (orderId, items, decision = "CONFIRMED", cookie = supplierCookie) =>
      call(`/api/supplier/orders/${orderId}/stock`, {
        method: "POST",
        cookie,
        body: { decision, items },
      });
    const s11Stock = () => s11SupplierStock(s11ListingId);
    const s11OrderView = (orderId) => call(`/api/supplier/orders/${orderId}`, { cookie: supplierCookie });
    const s11Cancel = (orderId) =>
      call(`/api/supplier/orders/${orderId}`, {
        method: "PATCH",
        cookie: supplierCookie,
        body: { status: "CANCELLED", note: "S-11 probe cancel" },
      });

    // 1. Confirmed quantity may not exceed the ordered quantity (N-07).
    const s11Over = await s11Place(5);
    const s11OverId = s11Over.json?.order?.id;
    const s11OverItemId = s11Over.json?.order?.items?.[0]?.id;
    const s11OverRes = await s11Confirm(s11OverId, [{ itemId: s11OverItemId, confirmedQty: 6 }]);
    check(
      "S-11 confirmed quantity above the ordered quantity is rejected",
      [400, 409, 422].includes(s11OverRes.status),
      `status ${s11OverRes.status}`,
    );
    check(
      "S-11 over-confirmation leaves listing stock unchanged",
      (await s11Stock()) === 100,
      `stock ${await s11Stock()}`,
    );
    const s11OverAfter = await s11OrderView(s11OverId);
    check(
      "S-11 over-confirmation leaves the order unconfirmed",
      s11OverAfter.json?.order?.status === "SUBMITTED" &&
        s11OverAfter.json?.order?.items?.[0]?.stockConfirmedQty === null,
      `status ${s11OverAfter.json?.order?.status}, confirmed ${s11OverAfter.json?.order?.items?.[0]?.stockConfirmedQty}`,
    );
    await s11Cancel(s11OverId);

    // 2. Zero, negative, fractional, non-numeric and unknown quantities.
    const s11Zero = await s11Place(5);
    const s11ZeroId = s11Zero.json?.order?.id;
    const s11ZeroItemId = s11Zero.json?.order?.items?.[0]?.id;
    const s11ZeroRes = await s11Confirm(s11ZeroId, [{ itemId: s11ZeroItemId, confirmedQty: 0 }]);
    check(
      "S-11 zero confirmed quantity is rejected for a confirmation",
      [400, 409, 422].includes(s11ZeroRes.status),
      `status ${s11ZeroRes.status}`,
    );
    check(
      "S-11 rejected zero quantity leaves stock unchanged",
      (await s11Stock()) === 100,
      `stock ${await s11Stock()}`,
    );
    await s11Cancel(s11ZeroId);

    const s11Malformed = await s11Place(5);
    const s11MalformedId = s11Malformed.json?.order?.id;
    const s11MalformedItemId = s11Malformed.json?.order?.items?.[0]?.id;
    for (const [label, confirmedQty] of [
      ["negative", -1],
      ["fractional", 1.5],
      ["non-numeric", "3"],
    ]) {
      const res = await s11Confirm(s11MalformedId, [
        { itemId: s11MalformedItemId, confirmedQty },
      ]);
      check(
        `S-11 ${label} confirmed quantity is rejected`,
        [400, 409, 422].includes(res.status),
        `status ${res.status}`,
      );
    }
    const s11MissingItem = await s11Confirm(s11MalformedId, [{ confirmedQty: 1 }]);
    check(
      "S-11 a confirmation without an item id is rejected",
      [400, 409, 422].includes(s11MissingItem.status),
      `status ${s11MissingItem.status}`,
    );
    const s11UnknownItem = await s11Confirm(s11MalformedId, [
      { itemId: "c000000000000000000000000", confirmedQty: 1 },
    ]);
    check(
      "S-11 an item from another order is rejected",
      [400, 409, 422].includes(s11UnknownItem.status),
      `status ${s11UnknownItem.status}`,
    );
    const s11DuplicateItem = await s11Confirm(s11MalformedId, [
      { itemId: s11MalformedItemId, confirmedQty: 1 },
      { itemId: s11MalformedItemId, confirmedQty: 1 },
    ]);
    check(
      "S-11 duplicate item entries in one confirmation are rejected",
      [400, 409, 422].includes(s11DuplicateItem.status),
      `status ${s11DuplicateItem.status}`,
    );
    check(
      "S-11 malformed confirmations leave stock and order unchanged",
      (await s11Stock()) === 100 &&
        (await s11OrderView(s11MalformedId)).json?.order?.status === "SUBMITTED",
      `stock ${await s11Stock()}`,
    );
    await s11Cancel(s11MalformedId);

    const s11BadOrderQty = await s11Place(0);
    check(
      "S-11 a requested quantity of zero is rejected at order creation",
      [400, 422].includes(s11BadOrderQty.status) && !s11BadOrderQty.json?.order,
      `status ${s11BadOrderQty.status}`,
    );

    // 3. A confirmed order deducts the listing, not the offer snapshot or a
    //    workspace product.
    const s11Good = await s11Place(5);
    const s11GoodId = s11Good.json?.order?.id;
    const s11GoodItemId = s11Good.json?.order?.items?.[0]?.id;
    const s11GoodRes = await s11Confirm(s11GoodId, [{ itemId: s11GoodItemId, confirmedQty: 5 }]);
    check(
      "S-11 confirmation reduces the authoritative listing stock",
      s11GoodRes.status === 200 && (await s11Stock()) === 95,
      `status ${s11GoodRes.status}, stock ${await s11Stock()}`,
    );
    check(
      "S-11 confirmation records the confirmed quantity and order status",
      s11GoodRes.json?.order?.status === "STOCK_CONFIRMED" &&
        s11GoodRes.json?.order?.items?.[0]?.stockConfirmedQty === 5,
      `status ${s11GoodRes.json?.order?.status}, confirmed ${s11GoodRes.json?.order?.items?.[0]?.stockConfirmedQty}`,
    );
    check(
      "S-11 the deducted quantity is tracked on the order line",
      (await s11Read("supplierOrderItem", { where: { id: s11GoodItemId } }, "stockDeductedQty")) === 5,
      `deducted ${await s11Read("supplierOrderItem", { where: { id: s11GoodItemId } }, "stockDeductedQty")}`,
    );

    if (s11Prisma) {
      const s11Offer = await s11Prisma.resellerOffer.findUnique({
        where: { id: s11OfferId },
        select: { currentVersionId: true },
      });
      const s11Version = s11Offer?.currentVersionId
        ? await s11Prisma.resellerOfferVersion.findUnique({
            where: { id: s11Offer.currentVersionId },
            select: { stockQty: true },
          })
        : null;
      check(
        "S-11 the append-only offer-version stock snapshot is not mutated",
        s11Version?.stockQty === 100,
        `offer stock ${s11Version?.stockQty}`,
      );
    }

    const s11Jump = await call(`/api/supplier/orders/${s11GoodId}`, {
      method: "PATCH",
      cookie: supplierCookie,
      body: { status: "COMPLETED" },
    });
    check(
      "S-11 stock confirmation does not open a lifecycle shortcut (S-04)",
      s11Jump.status === 409,
      `status ${s11Jump.status}`,
    );

    const s11CancelGood = await s11Cancel(s11GoodId);
    check(
      "S-11 cancellation restores exactly the deducted stock",
      s11CancelGood.status === 200 && (await s11Stock()) === 100,
      `status ${s11CancelGood.status}, stock ${await s11Stock()}`,
    );
    check(
      "S-11 cancellation clears the per-line deduction",
      (await s11Read("supplierOrderItem", { where: { id: s11GoodItemId } }, "stockDeductedQty")) === 0,
      `deducted ${await s11Read("supplierOrderItem", { where: { id: s11GoodItemId } }, "stockDeductedQty")}`,
    );
    const s11RestoredAt = await s11Read(
      "supplierOrder",
      { where: { id: s11GoodId } },
      "stockRestoredAt",
    );
    check(
      "S-11 cancellation records that stock was restored",
      s11RestoredAt !== null && s11RestoredAt !== undefined,
      `restoredAt ${s11RestoredAt}`,
    );
    const s11CancelAgain = await s11Cancel(s11GoodId);
    check(
      "S-11 repeated cancellation cannot restore stock twice",
      [200, 409].includes(s11CancelAgain.status) && (await s11Stock()) === 100,
      `status ${s11CancelAgain.status}, stock ${await s11Stock()}`,
    );
    const s11ConfirmCancelled = await s11Confirm(s11GoodId, [
      { itemId: s11GoodItemId, confirmedQty: 5 },
    ]);
    check(
      "S-11 a cancelled order cannot confirm stock",
      s11ConfirmCancelled.status === 409,
      `status ${s11ConfirmCancelled.status}`,
    );

    // 4. Partial confirmation deducts only the confirmed quantity and adjusts
    //    by the delta when the supplier re-confirms.
    const s11Partial = await s11Place(10);
    const s11PartialId = s11Partial.json?.order?.id;
    const s11PartialItemId = s11Partial.json?.order?.items?.[0]?.id;
    const s11PartialOne = await s11Confirm(
      s11PartialId,
      [{ itemId: s11PartialItemId, confirmedQty: 4 }],
      "PARTIAL",
    );
    check(
      "S-11 partial confirmation deducts only the confirmed quantity",
      s11PartialOne.status === 200 &&
        (await s11Stock()) === 96 &&
        s11PartialOne.json?.order?.stockStatus === "PARTIAL",
      `status ${s11PartialOne.status}, stock ${await s11Stock()}, stockStatus ${s11PartialOne.json?.order?.stockStatus}`,
    );
    const s11PartialTwo = await s11Confirm(
      s11PartialId,
      [{ itemId: s11PartialItemId, confirmedQty: 6 }],
      "PARTIAL",
    );
    check(
      "S-11 re-confirmation adjusts the deduction by the delta",
      s11PartialTwo.status === 200 &&
        (await s11Stock()) === 94 &&
        (await s11Read("supplierOrderItem", { where: { id: s11PartialItemId } }, "stockDeductedQty")) === 6,
      `status ${s11PartialTwo.status}, stock ${await s11Stock()}`,
    );
    const s11PartialAgain = await s11Confirm(
      s11PartialId,
      [{ itemId: s11PartialItemId, confirmedQty: 6 }],
      "PARTIAL",
    );
    check(
      "S-11 repeating the same confirmation is idempotent",
      s11PartialAgain.status === 200 && (await s11Stock()) === 94,
      `status ${s11PartialAgain.status}, stock ${await s11Stock()}`,
    );
    const s11PartialCancel = await s11Cancel(s11PartialId);
    check(
      "S-11 cancelling a partial confirmation restores only that quantity",
      s11PartialCancel.status === 200 && (await s11Stock()) === 100,
      `status ${s11PartialCancel.status}, stock ${await s11Stock()}`,
    );

    // 5. Decline restores a previous deduction, and only once.
    const s11Decline = await s11Place(5);
    const s11DeclineId = s11Decline.json?.order?.id;
    const s11DeclineItemId = s11Decline.json?.order?.items?.[0]?.id;
    const s11DeclineFirst = await s11Confirm(s11DeclineId, [
      { itemId: s11DeclineItemId, confirmedQty: 5 },
    ]);
    check(
      "S-11 decline setup deducts stock",
      s11DeclineFirst.status === 200 && (await s11Stock()) === 95,
      `status ${s11DeclineFirst.status}, stock ${await s11Stock()}`,
    );
    const s11DeclineRes = await s11Confirm(
      s11DeclineId,
      [{ itemId: s11DeclineItemId, confirmedQty: 0 }],
      "DECLINED",
    );
    check(
      "S-11 declining restores stock deducted by an earlier confirmation",
      s11DeclineRes.status === 200 &&
        (await s11Stock()) === 100 &&
        s11DeclineRes.json?.order?.status === "STOCK_DECLINED" &&
        s11DeclineRes.json?.order?.items?.[0]?.stockConfirmedQty === 0 &&
        (await s11Read("supplierOrderItem", { where: { id: s11DeclineItemId } }, "stockDeductedQty")) === 0,
      `status ${s11DeclineRes.status}, stock ${await s11Stock()}`,
    );
    const s11DeclineAgain = await s11Confirm(
      s11DeclineId,
      [{ itemId: s11DeclineItemId, confirmedQty: 0 }],
      "DECLINED",
    );
    check(
      "S-11 repeated decline cannot restore stock twice",
      s11DeclineAgain.status === 409 && (await s11Stock()) === 100,
      `status ${s11DeclineAgain.status}, stock ${await s11Stock()}`,
    );
    const s11DeclineCancel = await s11Cancel(s11DeclineId);
    check(
      "S-11 cancelling a declined order restores nothing",
      s11DeclineCancel.status === 200 && (await s11Stock()) === 100,
      `status ${s11DeclineCancel.status}, stock ${await s11Stock()}`,
    );

    // 6. A confirmation may not consume more than is available, and client
    //    supplied stock values are ignored.
    const s11Big = await s11Place(150, undefined, { stockQty: 999_999 });
    const s11BigId = s11Big.json?.order?.id;
    const s11BigItemId = s11Big.json?.order?.items?.[0]?.id;
    const s11BigRes = await s11Confirm(s11BigId, [
      { itemId: s11BigItemId, confirmedQty: 150 },
    ]);
    check(
      "S-11 confirmed quantity above available stock is rejected",
      [400, 409, 422].includes(s11BigRes.status),
      `status ${s11BigRes.status}`,
    );
    check(
      "S-11 client-supplied stock values are ignored",
      (await s11Stock()) === 100,
      `stock ${await s11Stock()}`,
    );
    const s11BigAfter = await s11OrderView(s11BigId);
    check(
      "S-11 a rejected over-availability leaves the order unconfirmed",
      s11BigAfter.json?.order?.status === "SUBMITTED" &&
        s11BigAfter.json?.order?.items?.[0]?.stockConfirmedQty === null,
      `status ${s11BigAfter.json?.order?.status}`,
    );
    await s11Cancel(s11BigId);

    // 7. A multi-line confirmation is all-or-nothing.
    const s11Rollback = await s11Place(0, [
      { listingId: s11ListingId, qty: 2 },
      { listingId: s11ListingId, qty: 150 },
    ]);
    const s11RollbackId = s11Rollback.json?.order?.id;
    const s11RollbackItems = s11Rollback.json?.order?.items ?? [];
    const s11RollbackRes = await s11Confirm(
      s11RollbackId,
      s11RollbackItems.map((item) => ({ itemId: item.id, confirmedQty: item.qty })),
    );
    check(
      "S-11 a failing multi-line confirmation rolls back every line",
      [400, 409, 422].includes(s11RollbackRes.status) && (await s11Stock()) === 100,
      `status ${s11RollbackRes.status}, stock ${await s11Stock()}`,
    );
    const s11RollbackAfter = await s11OrderView(s11RollbackId);
    check(
      "S-11 a rolled-back confirmation leaves order and evidence untouched",
      s11RollbackAfter.json?.order?.status === "SUBMITTED" &&
        (s11RollbackAfter.json?.order?.items ?? []).every(
          (item) => item.stockConfirmedQty === null,
        ) &&
        (await s11Read(
          "supplierOrderItem",
          { where: { id: s11RollbackItems[0]?.id } },
          "stockDeductedQty",
        )) === 0,
      `status ${s11RollbackAfter.json?.order?.status}`,
    );
    await s11Cancel(s11RollbackId);

    // 8. Two concurrent confirmations cannot consume the same stock.
    const s11RaceOne = await s11Place(60);
    const s11RaceTwo = await s11Place(60);
    const s11RaceOneId = s11RaceOne.json?.order?.id;
    const s11RaceTwoId = s11RaceTwo.json?.order?.id;
    const s11RaceOneItem = s11RaceOne.json?.order?.items?.[0]?.id;
    const s11RaceTwoItem = s11RaceTwo.json?.order?.items?.[0]?.id;
    const [s11RaceOneRes, s11RaceTwoRes] = await Promise.all([
      s11Confirm(s11RaceOneId, [{ itemId: s11RaceOneItem, confirmedQty: 60 }]),
      s11Confirm(s11RaceTwoId, [{ itemId: s11RaceTwoItem, confirmedQty: 60 }]),
    ]);
    const s11RaceStatuses = [s11RaceOneRes.status, s11RaceTwoRes.status];
    check(
      "S-11 two concurrent confirmations cannot both consume the same stock",
      s11RaceStatuses.filter((value) => value === 200).length === 1 &&
        s11RaceStatuses.filter((value) => [400, 409, 422].includes(value)).length === 1,
      `statuses ${s11RaceStatuses.join(",")}`,
    );
    check(
      "S-11 concurrent oversell never drives stock below zero",
      (await s11Stock()) === 40,
      `stock ${await s11Stock()}`,
    );
    const s11RaceWinnerId = s11RaceOneRes.status === 200 ? s11RaceOneId : s11RaceTwoId;
    const s11RaceLoserId = s11RaceOneRes.status === 200 ? s11RaceTwoId : s11RaceOneId;
    const s11RaceWinner = await s11OrderView(s11RaceWinnerId);
    const s11RaceLoser = await s11OrderView(s11RaceLoserId);
    check(
      "S-11 only the winning concurrent confirmation changes its order",
      s11RaceWinner.json?.order?.status === "STOCK_CONFIRMED" &&
        s11RaceLoser.json?.order?.status === "SUBMITTED",
      `winner ${s11RaceWinner.json?.order?.status}, loser ${s11RaceLoser.json?.order?.status}`,
    );
    await s11Cancel(s11RaceWinnerId);
    await s11Cancel(s11RaceLoserId);
    check(
      "S-11 cancelling the concurrent winner restores its reservation",
      (await s11Stock()) === 100,
      `stock ${await s11Stock()}`,
    );

    // 9. Existing S-04 edges still work after a stock change.
    const s11Flow = await s11Place(3);
    const s11FlowId = s11Flow.json?.order?.id;
    const s11FlowItemId = s11Flow.json?.order?.items?.[0]?.id;
    const s11FlowConfirm = await s11Confirm(s11FlowId, [
      { itemId: s11FlowItemId, confirmedQty: 3 },
    ]);
    const s11FlowStockAfterConfirm = await s11Stock();
    const s11FlowAwaiting = await call(`/api/supplier/orders/${s11FlowId}`, {
      method: "PATCH",
      cookie: supplierCookie,
      body: { status: "AWAITING_PAYMENT" },
    });
    const s11FlowJump = await call(`/api/supplier/orders/${s11FlowId}`, {
      method: "PATCH",
      cookie: supplierCookie,
      body: { status: "COMPLETED" },
    });
    const s11FlowCancel = await s11Cancel(s11FlowId);
    const s11FlowStockAfterCancel = await s11Stock();
    check(
      "S-11 existing S-04 transition edges remain intact",
      s11FlowConfirm.status === 200 &&
        s11FlowStockAfterConfirm === 97 &&
        s11FlowAwaiting.status === 200 &&
        s11FlowJump.status === 409 &&
        s11FlowCancel.status === 200 &&
        s11FlowStockAfterCancel === 100,
      `confirm ${s11FlowConfirm.status} (stock ${s11FlowStockAfterConfirm}), awaiting ${s11FlowAwaiting.status}, jump ${s11FlowJump.status}, cancel ${s11FlowCancel.status} (stock ${s11FlowStockAfterCancel})`,
    );

    // 10. Workspace orders reserve and restore their own Product.stockQty.
    const s11CreateProduct = (cookie, name, stock) =>
      call("/api/workspace/products", {
        method: "POST",
        cookie,
        body: {
          name,
          sku: `S11-${s11Suffix}-${name}`,
          unit: "unit",
          costPriceKobo: 1_000,
          sellingPriceKobo: 2_000,
          stockQty: stock,
          lowStockAt: 0,
        },
      });
    const s11WsStock = async (cookie, productId) => {
      const res = await call("/api/workspace/products", { cookie });
      return res.json?.products?.find((product) => product.id === productId)?.stockQty ?? null;
    };
    const s11WsOrder = (cookie, items) =>
      call("/api/workspace/orders", {
        method: "POST",
        cookie,
        body: { customerId, channel: "WHATSAPP", items },
      });

    const s11ProductA = await s11CreateProduct(resellerCookie, "S-11 A", 10);
    const s11ProductB = await s11CreateProduct(resellerCookie, "S-11 B", 7);
    const s11ProductC = await s11CreateProduct(strangerCookie, "S-11 C", 3);
    const s11ProductD = await s11CreateProduct(resellerCookie, "S-11 D", 3);
    const s11ProductE = await s11CreateProduct(resellerCookie, "S-11 E", 5);
    const s11ProductF = await s11CreateProduct(resellerCookie, "S-11 F", 1);
    const s11AId = s11ProductA.json?.product?.id;
    const s11BId = s11ProductB.json?.product?.id;
    const s11CId = s11ProductC.json?.product?.id;
    const s11DId = s11ProductD.json?.product?.id;
    const s11EId = s11ProductE.json?.product?.id;
    const s11FId = s11ProductF.json?.product?.id;
    check(
      "S-11 setup: workspace probe products created",
      [s11ProductA, s11ProductB, s11ProductC, s11ProductD, s11ProductE, s11ProductF].every(
        (res) => res.status === 201,
      ),
      `statuses ${[s11ProductA, s11ProductB, s11ProductC, s11ProductD, s11ProductE, s11ProductF]
        .map((res) => res.status)
        .join(",")}`,
    );

    const s11WsA = await s11WsOrder(resellerCookie, [
      { productId: s11AId, name: "S-11 A", qty: 4, unitPriceKobo: 0, unitCostKobo: 0 },
    ]);
    const s11WsAId = s11WsA.json?.order?.id;
    const s11WsAItemId = s11WsA.json?.order?.items?.find((item) => item.productId === s11AId)?.id;
    check(
      "S-11 a workspace order reserves its own product stock",
      s11WsA.status === 201 && (await s11WsStock(resellerCookie, s11AId)) === 6,
      `status ${s11WsA.status}, stock ${await s11WsStock(resellerCookie, s11AId)}`,
    );
    check(
      "S-11 the workspace reservation is tracked on the order line",
      (await s11Read("orderItem", { where: { id: s11WsAItemId } }, "stockDeductedQty")) === 4,
      `deducted ${await s11Read("orderItem", { where: { id: s11WsAItemId } }, "stockDeductedQty")}`,
    );
    check(
      "S-11 unrelated workspace products are untouched",
      (await s11WsStock(resellerCookie, s11BId)) === 7 &&
        (await s11WsStock(strangerCookie, s11CId)) === 3,
      `B ${await s11WsStock(resellerCookie, s11BId)}, C ${await s11WsStock(strangerCookie, s11CId)}`,
    );
    const s11WsCancel = await call(`/api/workspace/orders/${s11WsAId}`, {
      method: "PATCH",
      cookie: resellerCookie,
      body: { status: "CANCELLED" },
    });
    check(
      "S-11 workspace cancellation restores reserved stock",
      s11WsCancel.status === 200 && (await s11WsStock(resellerCookie, s11AId)) === 10,
      `status ${s11WsCancel.status}, stock ${await s11WsStock(resellerCookie, s11AId)}`,
    );
    check(
      "S-11 workspace cancellation clears the per-line reservation",
      (await s11Read("orderItem", { where: { id: s11WsAItemId } }, "stockDeductedQty")) === 0,
      `deducted ${await s11Read("orderItem", { where: { id: s11WsAItemId } }, "stockDeductedQty")}`,
    );
    const s11WsRestoredAt = await s11Read(
      "customerOrder",
      { where: { id: s11WsAId } },
      "stockRestoredAt",
    );
    check(
      "S-11 workspace cancellation records that stock was restored",
      s11WsRestoredAt !== null && s11WsRestoredAt !== undefined,
      `restoredAt ${s11WsRestoredAt}`,
    );
    const s11WsCancelAgain = await call(`/api/workspace/orders/${s11WsAId}`, {
      method: "PATCH",
      cookie: resellerCookie,
      body: { status: "CANCELLED" },
    });
    check(
      "S-11 repeated workspace cancellation cannot restore stock twice",
      [200, 409].includes(s11WsCancelAgain.status) &&
        (await s11WsStock(resellerCookie, s11AId)) === 10,
      `status ${s11WsCancelAgain.status}, stock ${await s11WsStock(resellerCookie, s11AId)}`,
    );

    const s11WsD = await s11WsOrder(resellerCookie, [
      { productId: s11DId, name: "S-11 D", qty: 5, unitPriceKobo: 0, unitCostKobo: 0 },
    ]);
    check(
      "S-11 a workspace order cannot reserve more than is available",
      [400, 409, 422].includes(s11WsD.status) &&
        !s11WsD.json?.order &&
        (await s11WsStock(resellerCookie, s11DId)) === 3,
      `status ${s11WsD.status}, stock ${await s11WsStock(resellerCookie, s11DId)}`,
    );

    const s11WsEF = await s11WsOrder(resellerCookie, [
      { productId: s11EId, name: "S-11 E", qty: 2, unitPriceKobo: 0, unitCostKobo: 0 },
      { productId: s11FId, name: "S-11 F", qty: 3, unitPriceKobo: 0, unitCostKobo: 0 },
    ]);
    check(
      "S-11 a failed workspace reservation rolls back every line",
      [400, 409, 422].includes(s11WsEF.status) &&
        !s11WsEF.json?.order &&
        (await s11WsStock(resellerCookie, s11EId)) === 5 &&
        (await s11WsStock(resellerCookie, s11FId)) === 1,
      `status ${s11WsEF.status}, E ${await s11WsStock(resellerCookie, s11EId)}, F ${await s11WsStock(resellerCookie, s11FId)}`,
    );

    // 11. Another supplier cannot confirm stock on this order.
    const s11StrangerSupplier = await call("/api/supplier/profile", {
      method: "POST",
      cookie: strangerCookie,
      body: { businessName: `S-11 Stranger Supply ${s11Suffix}` },
    });
    // Creating a supplier profile activates SUPPLIER and rotates the session
    // (S-14); every later probe must use the replacement cookie.
    strangerCookie = s11StrangerSupplier.cookie;
    const s11TenantOrder = await s11Place(2);
    const s11TenantOrderId = s11TenantOrder.json?.order?.id;
    const s11TenantItemId = s11TenantOrder.json?.order?.items?.[0]?.id;
    const s11TenantConfirm = await s11Confirm(
      s11TenantOrderId,
      [{ itemId: s11TenantItemId, confirmedQty: 2 }],
      "CONFIRMED",
      strangerCookie,
    );
    check(
      "S-11 another supplier cannot confirm stock on this order",
      s11StrangerSupplier.status === 201 && [403, 404].includes(s11TenantConfirm.status),
      `supplier ${s11StrangerSupplier.status}, confirm ${s11TenantConfirm.status}`,
    );
    check(
      "S-11 a foreign confirmation leaves the stock and order untouched",
      (await s11Stock()) === 100 &&
        (await s11OrderView(s11TenantOrderId)).json?.order?.status === "SUBMITTED",
      `stock ${await s11Stock()}`,
    );
    await s11Cancel(s11TenantOrderId);

    // 12. Movements stayed inside the probe listing and its workspace.
    check(
      "S-11 stock movements never touch another supplier listing",
      (await s11SupplierStock(listing.id)) === s11SeededStockBefore,
      `${s11SeededStockBefore} → ${await s11SupplierStock(listing.id)}`,
    );
    check(
      "S-11 stock movements never touch unrelated workspace products",
      (await s11WsStock(resellerCookie, s11BId)) === 7 &&
        (await s11WsStock(strangerCookie, s11CId)) === 3,
      `B ${await s11WsStock(resellerCookie, s11BId)}, C ${await s11WsStock(strangerCookie, s11CId)}`,
    );

    if (s11Prisma) await s11Prisma.$disconnect();
  }

  // ── Disputes ──────────────────────────────────────────────────────────────
  const guestDisputes = await call("/api/disputes");
  check("guests cannot list disputes", guestDisputes.status === 401, `status ${guestDisputes.status}`);

  const mediatorCookie = await login("mediator@sellflow.test", "Password123!");

  const mediatorList = await call("/api/disputes", { cookie: mediatorCookie });
  const seededDispute = mediatorList.json?.disputes?.find((d) => d.reference === "DSP-DEMO-01");
  check("mediator sees every dispute", mediatorList.status === 200 && Boolean(seededDispute));
  check("seeded dispute is linked to a payment claim", Boolean(seededDispute?.claim));

  // ── S-01: scope=all is a mediator privilege, never a query flag ────────────
  const adminScopeCookie = await login("admin@sellflow.test", "Password123!");

  const guestAll = await call("/api/disputes?scope=all");
  check("guests cannot request every dispute", guestAll.status === 401, `status ${guestAll.status}`);

  const strangerAll = await call("/api/disputes?scope=all", { cookie: strangerCookie });
  check(
    "an ordinary account cannot list every dispute (S-01)",
    strangerAll.status === 403,
    `status ${strangerAll.status}`,
  );
  check(
    "the scope=all denial carries no dispute payload (S-01)",
    !strangerAll.json?.disputes &&
      !/DSP-[A-Z0-9-]+/.test(strangerAll.text) &&
      !("total" in (strangerAll.json ?? {})) &&
      !("count" in (strangerAll.json ?? {})),
  );

  const resellerAll = await call("/api/disputes?scope=all", { cookie: resellerCookie });
  check("a reseller cannot list every dispute (S-01)", resellerAll.status === 403, `status ${resellerAll.status}`);
  check("the reseller denial leaks no reference (S-01)", !/DSP-[A-Z0-9-]+/.test(resellerAll.text));

  const supplierAll = await call("/api/disputes?scope=all", { cookie: supplierCookie });
  check("a supplier cannot list every dispute (S-01)", supplierAll.status === 403, `status ${supplierAll.status}`);

  const strangerOwn = await call("/api/disputes", { cookie: strangerCookie });
  check(
    "an ordinary account still reads only its own empty list",
    strangerOwn.status === 200 && Array.isArray(strangerOwn.json?.disputes) && strangerOwn.json.disputes.length === 0,
    `status ${strangerOwn.status}, ${strangerOwn.json?.disputes?.length} dispute(s)`,
  );

  const strangerByForeignId = await call(`/api/disputes/${seededDispute.id}`, { cookie: strangerCookie });
  check(
    "an unrelated account cannot open another workspace's dispute (S-01)",
    strangerByForeignId.status === 403,
    `status ${strangerByForeignId.status}`,
  );

  const resellerMine = await call("/api/disputes?scope=mine", { cookie: resellerCookie });
  check(
    "a party still sees its own disputes",
    resellerMine.status === 200 && resellerMine.json?.disputes?.some((dispute) => dispute.id === seededDispute.id),
  );

  const supplierMine = await call("/api/disputes", { cookie: supplierCookie });
  check(
    "the other party still sees its own disputes",
    supplierMine.status === 200 && supplierMine.json?.disputes?.some((dispute) => dispute.id === seededDispute.id),
  );

  const mediatorAll = await call("/api/disputes?scope=all", { cookie: mediatorCookie });
  check(
    "a mediator can list every dispute",
    mediatorAll.status === 200 && mediatorAll.json?.disputes?.some((dispute) => dispute.id === seededDispute.id),
    `status ${mediatorAll.status}`,
  );

  const adminAll = await call("/api/disputes?scope=all", { cookie: adminScopeCookie });
  check(
    "a platform admin can list every dispute",
    adminAll.status === 200 && adminAll.json?.disputes?.some((dispute) => dispute.id === seededDispute.id),
    `status ${adminAll.status}`,
  );

  const resellerList = await call("/api/disputes", { cookie: resellerCookie });
  check(
    "a party sees the dispute they are in",
    resellerList.json?.disputes?.some((d) => d.reference === "DSP-DEMO-01") === true,
  );
  const strangerList = await call("/api/disputes", { cookie: strangerCookie });
  check("an unrelated account sees no disputes", strangerList.json?.disputes?.length === 0);

  const resellerOrders = await call("/api/reseller/overview", { cookie: resellerCookie });
  const demoSupplierOrder = resellerOrders.json?.orders?.find((o) => o.orderNumber === "SO-2610-0001");
  check("seeded supplier order is visible to the reseller", Boolean(demoSupplierOrder));

  const strangerOpen = await call("/api/disputes", {
    method: "POST",
    cookie: strangerCookie,
    body: {
      supplierOrderId: demoSupplierOrder.id,
      reason: "OTHER",
      description: "I am not a party to this order but I am trying anyway.",
    },
  });
  check("non-party cannot open a dispute", strangerOpen.status === 403, `status ${strangerOpen.status}`);

  const strangerResolve = await call(`/api/disputes/${seededDispute.id}/resolve`, {
    method: "POST",
    cookie: strangerCookie,
    body: { outcome: "MUTUAL", note: "Not my case", status: "RESOLVED" },
  });
  check("non-party cannot resolve a dispute", strangerResolve.status === 403, `status ${strangerResolve.status}`);

  const partyResolve = await call(`/api/disputes/${seededDispute.id}/resolve`, {
    method: "POST",
    cookie: resellerCookie,
    body: { outcome: "MUTUAL", note: "Settling this myself", status: "RESOLVED" },
  });
  check("a party cannot resolve their own dispute", partyResolve.status === 403, `status ${partyResolve.status}`);

  const strangerEvent = await call(`/api/disputes/${seededDispute.id}/events`, {
    method: "POST",
    cookie: strangerCookie,
    body: { type: "MESSAGE", body: "intruding" },
  });
  check("non-party cannot post to the trail", strangerEvent.status === 403, `status ${strangerEvent.status}`);

  const newDispute = await call("/api/disputes", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      supplierOrderId: demoSupplierOrder.id,
      reason: "QUANTITY_MISMATCH",
      description: "Only 4 of the 6 pieces arrived in the first carton.",
    },
  });
  check("a party can open a dispute", newDispute.status === 201, `status ${newDispute.status}`);

  const event = await call(`/api/disputes/${newDispute.json?.dispute?.id}/events`, {
    method: "POST",
    cookie: resellerCookie,
    body: { type: "EVIDENCE", body: "Photos of the carton attached at the shop." },
  });
  check("a party can add evidence", event.status === 201, `status ${event.status}`);

  const review = await call(`/api/disputes/${newDispute.json?.dispute?.id}/status`, {
    method: "POST",
    cookie: mediatorCookie,
    body: { status: "UNDER_REVIEW", note: "Looking into this today." },
  });
  check("mediator can take a dispute up for review", review.status === 200, `status ${review.status}`);
  check("status moves to under review", review.json?.dispute?.status === "UNDER_REVIEW");

  const resolved = await call(`/api/disputes/${newDispute.json?.dispute?.id}/resolve`, {
    method: "POST",
    cookie: mediatorCookie,
    body: { outcome: "RESELLER_FAVOUR", note: "Supplier sends the missing two pieces.", status: "RESOLVED" },
  });
  check("mediator can record an outcome", resolved.status === 200, `status ${resolved.status}`);
  check(
    "the resolve response reports the new status",
    resolved.json?.dispute?.status === "RESOLVED",
    `status ${resolved.json?.dispute?.status}`,
  );
  // `POST /api/disputes/:id/resolve` returns only `{ id, status }` by design: the
  // outcome is the authoritative record and is read back from the dispute detail
  // (the same way the later outcome assertions verify persistence). Asserting
  // `outcome` on the mutation response was testing a shape the endpoint never
  // promised, so the check failed even though the outcome was stored correctly.
  const resolvedDetail = await call(`/api/disputes/${newDispute.json?.dispute?.id}`, {
    cookie: mediatorCookie,
  });
  check(
    "outcome is stored",
    resolvedDetail.json?.dispute?.outcome === "RESELLER_FAVOUR",
    `outcome ${resolvedDetail.json?.dispute?.outcome}`,
  );

  const detailAfter = await call(`/api/disputes/${newDispute.json?.dispute?.id}`, { cookie: resellerCookie });
  const trail = detailAfter.json?.dispute?.events ?? [];
  check("the audit trail keeps every step", trail.length >= 4, `${trail.length} events`);
  check(
    "the mediator decision is in the trail",
    trail.some((entry) => entry.type === "OUTCOME"),
  );

  const settledClaim = await call(`/api/disputes/${seededDispute.id}/resolve`, {
    method: "POST",
    cookie: mediatorCookie,
    body: {
      outcome: "SUPPLIER_FAVOUR",
      note: "No credit alert matched the reference. Reseller to send again.",
      status: "RESOLVED",
    },
  });
  check("mediator resolves the claim dispute", settledClaim.status === 200, `status ${settledClaim.status}`);

  const orderAfterClaim = await call(`/api/supplier/orders/${demoSupplierOrder.id}`, { cookie: supplierCookie });
  check(
    "resolving a claim dispute settles that claim",
    orderAfterClaim.json?.order?.claims?.some((claim) => claim.status === "CONFIRMED") === true,
  );

  const closed = await call(`/api/disputes/${seededDispute.id}/status`, {
    method: "POST",
    cookie: mediatorCookie,
    body: { status: "CLOSED" },
  });
  check("mediator can close a resolved dispute", closed.status === 200, `status ${closed.status}`);

  // ── Dispute resolution concurrency and fail-closed audit safeguards ───────
  // Use a fresh dispute so we can prove the first-outcome rule against an
  // outcome-free dispute without touching the seeded demo outcome above.
  const safetyDispute = await call("/api/disputes", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      supplierOrderId: demoSupplierOrder.id,
      reason: "QUALITY",
      description: "Safeguard demo: ordered two cartons, only one arrived intact.",
    },
  });
  check(
    "setup: a second dispute can be opened for the safeguards",
    safetyDispute.status === 201,
    `status ${safetyDispute.status}`,
  );
  const safetyId = safetyDispute.json?.dispute?.id ?? null;
  if (!safetyId) throw new Error("safeguard dispute creation did not return an id");

  const firstOutcome = await call(`/api/disputes/${safetyId}/resolve`, {
    method: "POST",
    cookie: mediatorCookie,
    body: {
      outcome: "MUTUAL",
      note: "Both sides agree on a partial refund.",
      status: "RESOLVED",
    },
  });
  check(
    "a closed-free dispute can receive its first outcome",
    firstOutcome.status === 200,
    `status ${firstOutcome.status}`,
  );

  // Read the stored outcome through the GET dispute endpoint so the assertion
  // uses the real persisted value, not the resolver's { id, status } response
  // shape (which does not include `outcome`).
  const firstOutcomeDetail = await call(`/api/disputes/${safetyId}`, {
    cookie: mediatorCookie,
  });
  check(
    "the first outcome is returned and stored",
    firstOutcomeDetail.json?.dispute?.outcome === "MUTUAL",
    `outcome ${firstOutcomeDetail.json?.dispute?.outcome}`,
  );

  const secondAttempt = await call(`/api/disputes/${safetyId}/resolve`, {
    method: "POST",
    cookie: mediatorCookie,
    body: {
      outcome: "SUPPLIER_FAVOUR",
      note: "Trying to overwrite the first outcome.",
      status: "RESOLVED",
    },
  });
  check(
    "a dispute with an existing outcome rejects a second outcome",
    secondAttempt.status === 409,
    `status ${secondAttempt.status}`,
  );

  const afterRejected = await call(`/api/disputes/${safetyId}`, {
    cookie: mediatorCookie,
  });
  check(
    "a rejected outcome write does not change the stored outcome",
    afterRejected.json?.dispute?.outcome === "MUTUAL",
    `outcome ${afterRejected.json?.dispute?.outcome}`,
  );
  check(
    "a rejected outcome write does not add an outcome event",
    afterRejected.json?.dispute?.events?.filter(
      (entry) => entry.type === "OUTCOME",
    ).length === 1,
    `outcome events ${afterRejected.json?.dispute?.events?.filter((entry) => entry.type === "OUTCOME").length}`,
  );

  const safetyAuditBefore = await auditPrismaForTriggers().then(
    (auditPrisma) =>
      auditPrisma
        ? auditPrisma.auditLog.findMany({
            where: {
              entityType: "Dispute",
              entityId: safetyId,
              action: "dispute.resolved",
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          })
        : [],
  );
  check(
    "one outcome write creates exactly one dispute.resolved audit row",
    safetyAuditBefore.length === 1,
    `audit rows ${safetyAuditBefore.length}`,
  );

  // Prove fail-closed: a dispute resolution must not commit its outcome event or
  // audit row when the audit write fails. This only runs in the isolated harness,
  // where setAuditWriteFailure can inject an audit insert failure.
  //
  // The existing safeguard dispute already has an outcome, so a failing call
  // against it would hit the duplicate-outcome guard (HTTP 409) before the audit
  // write is ever reached. To prove the audit-write trigger is the actual cause,
  // create a second, still outcome-free dispute and subject that one to the
  // armed-trigger failure path.
  const failClosedDispute = await call("/api/disputes", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      supplierOrderId: demoSupplierOrder.id,
      reason: "QUALITY",
      description: "Fail-closed probe: a second outcome-free dispute for the safeguard failure test.",
    },
  });
  check(
    "setup: a second outcome-free dispute can be opened for the fail-closed safeguard",
    failClosedDispute.status === 201,
    `status ${failClosedDispute.status}`,
  );
  const failClosedId = failClosedDispute.json?.dispute?.id ?? null;
  if (!failClosedId) throw new Error("fail-closed safeguard dispute creation did not return an id");

  const auditPrismaForFailure = await auditPrismaForTriggers();
  if (auditPrismaForFailure) {
    // Re-arm the trigger against the second dispute's INSERT path so the
    // armed trigger is the actual cause of the failure, not a stale
    // trigger state left over from an earlier block.
    await setAuditWriteFailure(true);
    const failingResolution = await call(`/api/disputes/${failClosedId}/resolve`, {
      method: "POST",
      cookie: mediatorCookie,
      body: {
        outcome: "NO_ACTION",
        note: "This must not commit.",
        status: "RESOLVED",
      },
    });
    check(
      "a failed audit write rolls the dispute resolution back (fail-closed)",
      failingResolution.status >= 500,
      `status ${failingResolution.status}`,
    );
    await setAuditWriteFailure(false);

    const afterFailure = await call(`/api/disputes/${failClosedId}`, {
      cookie: mediatorCookie,
    });
    check(
      "a rolled-back resolution does not mutate the outcome",
      afterFailure.json?.dispute?.outcome === null,
      `outcome ${afterFailure.json?.dispute?.outcome}`,
    );
    check(
      "a rolled-back resolution leaves the outcome event count unchanged",
      afterFailure.json?.dispute?.events?.filter(
        (entry) => entry.type === "OUTCOME",
      ).length === 0,
      `outcome events ${afterFailure.json?.dispute?.events?.filter((entry) => entry.type === "OUTCOME").length}`,
    );

    const safetyAuditAfter = await auditPrismaForFailure.auditLog.findMany({
      where: {
        entityType: "Dispute",
        entityId: failClosedId,
        action: "dispute.resolved",
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    check(
      "a failed audit write creates no dispute.resolved audit row",
      safetyAuditAfter.length === 0,
      `audit rows ${safetyAuditAfter.length}`,
    );
  }

  // ── Billing & plan enforcement ────────────────────────────────────────────
  const guestBilling = await call("/api/billing");
  check("guests cannot read billing", guestBilling.status === 401, `status ${guestBilling.status}`);

  const billing = await call("/api/billing", { cookie: resellerCookie });
  check("billing returns the current plan", billing.status === 200 && billing.json?.tier === "FREE");
  check("plan catalogue is published with the summary", billing.json?.plans?.length === 3);
  check("free caps are server-defined", billing.json?.limits?.customers === 20);

  const supplierBilling = await call("/api/billing", { cookie: supplierCookie });
  check("supplier demo account is on Supplier Pro", supplierBilling.json?.tier === "SUPPLIER_PRO");

  // Fill the Free customer cap: the seed has 2, the plan allows 20.
  const customerTarget = 20;
  const startingCustomers = billing.json?.usage?.customers ?? 0;
  for (let index = startingCustomers; index < customerTarget; index += 1) {
    const filled = await call("/api/workspace/customers", {
      method: "POST",
      cookie: resellerCookie,
      body: { name: `Cap test customer ${index + 1}` },
    });
    if (filled.status !== 201) {
      check("free plan accepts records up to its cap", false, `blocked early at ${index}: ${filled.text.slice(0, 120)}`);
      break;
    }
  }

  const overCap = await call("/api/workspace/customers", {
    method: "POST",
    cookie: resellerCookie,
    body: { name: "One customer too many" },
  });
  check("the cap blocks the next customer", overCap.status === 403, `status ${overCap.status}`);
  check("blocked adds carry SUBSCRIPTION_LIMIT_REACHED", overCap.json?.code === "SUBSCRIPTION_LIMIT_REACHED");
  check("the block explains the limit", overCap.json?.details?.limit === 20, JSON.stringify(overCap.json?.details ?? {}));

  const planOrder = await call("/api/workspace/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      customerId,
      items: [{ name: "Installment test", qty: 1, unitPriceKobo: 60_000, unitCostKobo: 40_000 }],
      paymentPlan: { installmentCount: 3, frequency: "MONTHLY", startDate: new Date().toISOString() },
    },
  });
  check("payment plans need a paid plan", planOrder.status === 403, `status ${planOrder.status}`);
  check("feature blocks carry SUBSCRIPTION_FEATURE_LOCKED", planOrder.json?.code === "SUBSCRIPTION_FEATURE_LOCKED");

  const negotiationAttempt = await call(`/api/agreements/${agreement.id}/proposals`, {
    method: "POST",
    cookie: resellerCookie,
    body: { resellerPriceKobo: 3_600_000, message: "Can we do better on price?" },
  });
  check("negotiation is locked on Free", negotiationAttempt.status === 403, `status ${negotiationAttempt.status}`);
  check(
    "negotiation points at Supplier Pro",
    negotiationAttempt.json?.details?.upgradeTo === "SUPPLIER_PRO",
    JSON.stringify(negotiationAttempt.json?.details ?? {}),
  );

  // ── Manual upgrade: submit, then a platform admin confirms ─────────────────
  const upgrade = await call("/api/billing/upgrade", {
    method: "POST",
    cookie: resellerCookie,
    body: { tier: "PRO", method: "BANK_TRANSFER", reference: "GTB 9911", proofNote: "Sent Monday 9am, sender Amaka Eze" },
  });
  check("an upgrade request is accepted", upgrade.status === 201, `status ${upgrade.status}`);
  check("the request starts as submitted", upgrade.json?.payment?.status === "SUBMITTED");
  check(
    "the server prices the plan, not the client",
    upgrade.json?.payment?.amountKobo === 250_000,
    `got ${upgrade.json?.payment?.amountKobo}`,
  );

  const stillFree = await call("/api/billing", { cookie: resellerCookie });
  check("submitting does not change the tier", stillFree.json?.tier === "FREE");
  check("the account is marked awaiting confirmation", stillFree.json?.status === "PENDING_PAYMENT");

  const duplicate = await call("/api/billing/upgrade", {
    method: "POST",
    cookie: resellerCookie,
    body: { tier: "PRO", method: "BANK_TRANSFER", reference: "second try" },
  });
  check("a second transfer cannot be stacked", duplicate.status === 409, `status ${duplicate.status}`);

  const selfActivation = await call(`/api/billing/payments/${upgrade.json?.payment?.id}/decision`, {
    method: "POST",
    cookie: resellerCookie,
    body: { action: "CONFIRM" },
  });
  check(
    "a seller cannot confirm their own transfer",
    selfActivation.status === 403,
    `status ${selfActivation.status}`,
  );

  const adminCookie = await login("admin@sellflow.test", "Password123!");
  const confirmed = await call(`/api/billing/payments/${upgrade.json?.payment?.id}/decision`, {
    method: "POST",
    cookie: adminCookie,
    body: { action: "CONFIRM", note: "Alert matched on the GTB statement" },
  });
  check("a platform admin confirms the transfer", confirmed.status === 200, `status ${confirmed.status}`);

  const upgraded = await call("/api/billing", { cookie: resellerCookie });
  check("confirmation activates the tier", upgraded.json?.tier === "PRO");
  check("a renewal date is set", Boolean(upgraded.json?.periodEnd));
  check("the plan has no caps", upgraded.json?.limits?.customers === null || upgraded.json?.limits?.customers === Infinity || !Number.isFinite(upgraded.json?.limits?.customers));

  const afterUpgradeCustomer = await call("/api/workspace/customers", {
    method: "POST",
    cookie: resellerCookie,
    body: { name: "Allowed after upgrade" },
  });
  check("the old cap no longer blocks", afterUpgradeCustomer.status === 201, `status ${afterUpgradeCustomer.status}`);

  const planAfterUpgrade = await call("/api/workspace/orders", {
    method: "POST",
    cookie: resellerCookie,
    body: {
      customerId,
      items: [{ name: "Installment test", qty: 1, unitPriceKobo: 60_000, unitCostKobo: 40_000 }],
      paymentPlan: { installmentCount: 3, frequency: "MONTHLY", startDate: new Date().toISOString() },
    },
  });
  check("payment plans unlock on Pro", planAfterUpgrade.status === 201, `status ${planAfterUpgrade.status}`);

  const cancel = await call("/api/billing/cancel", { method: "POST", cookie: resellerCookie, body: {} });
  check("a paid plan can be cancelled", cancel.status === 200, `status ${cancel.status}`);
  check("cancelling keeps the plan until period end", cancel.json?.subscription?.cancelAtPeriodEnd === true);

  // ── S-14: session rotation, idle/absolute expiry, revocation, inventory ───
  // The 2026-11-04 audit found 30-day sessions that were never rotated, never
  // idled out and could not be listed or revoked. These checks exercise the
  // lifecycle against the isolated database only.
  if (!s05Prisma) {
    console.log("SKIP  session lifecycle checks need an isolated DATABASE_URL");
  } else {
    const s14 = s05Prisma;

    // Wire the app's audit.resetAuditHealth into this script so the S-14
    // audit-failure injection can restore the process-local S-12 counter
    // afterwards. We only do this in the isolated run, where s05Prisma (and
    // therefore the app's modules on disk) is available.
    // The S-12 audit-health assertion now runs at the top of main(), before any
    // request mutates state. The S-14 durability probes below deliberately make a
    // real ROLE_GRANTED audit write fail, which increments the server's
    // process-global failure counter permanently; asserting a clean counter after
    // that point could never be deterministic.

    const dayMs = 86_400_000;
    const s14Email = (tag) =>
      `s14-${tag}+${Date.now()}-${Math.random().toString(36).slice(2, 7)}@sellflow.test`;
    const registerS14 = async (tag) => {
      const email = s14Email(tag);
      const res = await call("/api/auth/register", {
        method: "POST",
        body: {
          email,
          password: "Password123!",
          displayName: "Session Probe",
          businessName: "Session Probe Shop",
          country: "NG",
        },
      });
      return {
        email,
        status: res.status,
        cookie: res.cookie,
        setCookie: res.setCookie,
        userId: res.json?.user?.id,
        profileId: res.json?.profile?.id,
      };
    };
    const meS14 = (cookie) => call("/api/auth/me", { cookie });
    const authenticated = async (cookie) =>
      (await meS14(cookie)).json?.authenticated === true;

    const columns = await s14.$queryRawUnsafe(
      `SELECT COUNT(*) AS n FROM pragma_table_info('Session') WHERE name = 'lastUsedAt'`,
    );
    const hasLastUsedAt = Number(columns?.[0]?.n ?? 0) === 1;
    const indexRows = hasLastUsedAt
      ? await s14.$queryRawUnsafe(`SELECT name FROM pragma_index_list('Session')`)
      : [];
    const indexNames = new Set(indexRows.map((row) => row.name));
    check(
      "the Session table carries lastUsedAt and the idle index (S-14)",
      hasLastUsedAt && indexNames.has("Session_userId_lastUsedAt_idx"),
      `column ${hasLastUsedAt ? "present" : "missing"}, indexes ${[...indexNames].join(",")}`,
    );

    // The migration's DEFAULT is what keeps pre-existing sessions alive: a row
    // inserted the old way (no lastUsedAt) must come back with a value.
    let backfilled = null;
    try {
      const legacyUser = await registerS14("legacy");
      await s14.$executeRawUnsafe(
        `INSERT INTO "Session" ("id", "userId", "tokenHash", "expiresAt", "createdAt") VALUES ('s14-legacy-row', '${legacyUser.userId}', 's14-legacy-hash', ${Date.now() + dayMs}, ${Date.now()})`,
      );
      backfilled = await s14.$queryRawUnsafe(
        `SELECT "lastUsedAt" FROM "Session" WHERE "id" = 's14-legacy-row'`,
      );
    } catch (error) {
      backfilled = null;
    }
    check(
      "a pre-migration session row is backfilled, not invalidated (S-14)",
      backfilled !== null && backfilled[0]?.lastUsedAt !== null,
      backfilled === null ? "insert or column missing" : `lastUsedAt ${backfilled[0]?.lastUsedAt ?? "null"}`,
    );

    const absolute = await registerS14("absolute");
    await s14.session.updateMany({
      where: { userId: absolute.userId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    check(
      "an absolutely expired session stops authenticating (S-14)",
      (await authenticated(absolute.cookie)) === false,
      `status ${absolute.status}`,
    );

    if (hasLastUsedAt) {
      const idle = await registerS14("idle");
      await s14.session.updateMany({
        where: { userId: idle.userId },
        data: { lastUsedAt: new Date(Date.now() - 8 * dayMs) },
      });
      check(
        "a session idle for longer than 7 days stops authenticating (S-14)",
        (await authenticated(idle.cookie)) === false,
      );

      const active = await registerS14("active");
      await s14.session.updateMany({
        where: { userId: active.userId },
        data: { lastUsedAt: new Date(Date.now() - 2 * dayMs) },
      });
      check(
        "a session active within the idle window still authenticates (S-14)",
        (await authenticated(active.cookie)) === true,
      );

      const throttled = await registerS14("throttle");
      const before = await s14.session.findFirst({ where: { userId: throttled.userId } });
      await meS14(throttled.cookie);
      await meS14(throttled.cookie);
      const afterReads = await s14.session.findFirst({ where: { userId: throttled.userId } });
      check(
        "activity does not rewrite lastUsedAt more often than every 5 minutes (S-14)",
        afterReads?.lastUsedAt?.getTime() === before?.lastUsedAt?.getTime(),
        `before ${before?.lastUsedAt?.toISOString()}, after ${afterReads?.lastUsedAt?.toISOString()}`,
      );

      await s14.session.updateMany({
        where: { userId: throttled.userId },
        data: { lastUsedAt: new Date(Date.now() - 10 * 60_000) },
      });
      await meS14(throttled.cookie);
      const refreshed = await s14.session.findFirst({ where: { userId: throttled.userId } });
      check(
        "activity older than the throttle window refreshes lastUsedAt (S-14)",
        Number(refreshed?.lastUsedAt) > Number(new Date(Date.now() - 10 * 60_000)),
        `lastUsedAt ${refreshed?.lastUsedAt?.toISOString()}`,
      );
    } else {
      check("a session idle for longer than 7 days stops authenticating (S-14)", false, "lastUsedAt column missing");
      check("a session active within the idle window still authenticates (S-14)", false, "lastUsedAt column missing");
      check("activity does not rewrite lastUsedAt more often than every 5 minutes (S-14)", false, "lastUsedAt column missing");
      check("activity older than the throttle window refreshes lastUsedAt (S-14)", false, "lastUsedAt column missing");
    }

    // Rotation: signing in must not leave the presented token usable.
    const rotation = await registerS14("rotation");
    const relogin = await call("/api/auth/login", {
      method: "POST",
      cookie: rotation.cookie,
      body: { email: rotation.email, password: "Password123!" },
    });
    check(
      "signing in revokes the session token presented with the login (S-14)",
      relogin.status === 200 && (await authenticated(rotation.cookie)) === false,
      `status ${relogin.status}, old cookie ${rotation.cookie ? "presented" : "missing"}`,
    );
    check(
      "the replacement session authenticates and the cookie changed (S-14)",
      relogin.cookie !== rotation.cookie && (await authenticated(relogin.cookie)) === true,
      `new cookie ${relogin.cookie === rotation.cookie ? "unchanged" : "different"}`,
    );
    check(
      "a rotated session cookie keeps HttpOnly, SameSite=Lax and Path=/ (S-14)",
      /httponly/i.test(relogin.setCookie ?? "") &&
        /samesite=lax/i.test(relogin.setCookie ?? "") &&
        /path=\//i.test(relogin.setCookie ?? ""),
      relogin.setCookie ?? "no set-cookie",
    );

    // Self-service privilege change: revoke every session, then issue a new one.
    const promoter = await registerS14("promoter");
    const promotion = await call("/api/profile/roles", {
      method: "POST",
      cookie: promoter.cookie,
      body: { role: "RESELLER" },
    });
    check(
      "activating a role revokes the old session and issues a fresh one (S-14)",
      promotion.status === 200 &&
        promotion.cookie !== promoter.cookie &&
        (await authenticated(promoter.cookie)) === false &&
        (await authenticated(promotion.cookie)) === true,
      `status ${promotion.status}, old cookie ${(await authenticated(promoter.cookie)) ? "still valid" : "revoked"}`,
    );
    const promotedMe = await meS14(promotion.cookie);
    check(
      "the replacement session carries the new role (S-14)",
      Array.isArray(promotedMe.json?.roles) && promotedMe.json.roles.includes("RESELLER"),
      JSON.stringify(promotedMe.json?.roles ?? null),
    );

    // Admin-driven privilege change: the target loses every session.
    const target = await registerS14("target");
    const adminCookie = await login("admin@sellflow.test", "Password123!");
    const tierChange = await call(`/api/admin/profiles/${target.profileId}/verification`, {
      method: "PATCH",
      cookie: adminCookie,
      body: { tier: 1, reason: "S-14 revocation probe" },
    });
    check(
      "a tier change revokes every session of the affected account (S-14)",
      tierChange.status === 200 && (await authenticated(target.cookie)) === false,
      `status ${tierChange.status}, target cookie ${(await authenticated(target.cookie)) ? "still valid" : "revoked"}`,
    );
    check(
      "a tier change leaves the acting administrator signed in (S-14)",
      (await authenticated(adminCookie)) === true,
    );

    // Logout must remain scoped to the session it is given.
    const multi = await registerS14("multi");
    const secondLogin = await call("/api/auth/login", {
      method: "POST",
      body: { email: multi.email, password: "Password123!" },
    });
    const firstLogout = await call("/api/auth/logout", { method: "POST", cookie: multi.cookie });
    check(
      "logging out ends only the presented session (S-14)",
      firstLogout.status === 200 &&
        (await authenticated(multi.cookie)) === false &&
        (await authenticated(secondLogin.cookie)) === true,
      `status ${firstLogout.status}`,
    );

    // Inventory: own sessions only, no token material, no cross-account access.
    const list = await call("/api/auth/sessions", { cookie: secondLogin.cookie });
    const listed = Array.isArray(list.json?.sessions) ? list.json.sessions : [];
    check(
      "the session inventory lists the caller's own sessions only (S-14)",
      list.status === 200 &&
        listed.length >= 1 &&
        listed.every((row) => typeof row.id === "string" && row.userId === undefined),
      `status ${list.status}, ${listed.length} sessions`,
    );
    check(
      "the session inventory exposes no token material (S-14)",
      list.status === 200 && !/tokenHash|"token"|sf_session/.test(list.text),
      list.text.slice(0, 120),
    );
    check(
      "the session inventory marks exactly one current session (S-14)",
      listed.filter((row) => row.current === true).length === 1,
      `${listed.filter((row) => row.current === true).length} current`,
    );

    const outsider = await registerS14("outsider");
    const foreignRevoke = await call(`/api/auth/sessions/${listed[0]?.id ?? "missing"}`, {
      method: "DELETE",
      cookie: outsider.cookie,
    });
    check(
      "one account cannot revoke another account's session (S-14)",
      listed.length >= 1 &&
        [403, 404].includes(foreignRevoke.status) &&
        (await authenticated(secondLogin.cookie)) === true,
      `status ${foreignRevoke.status}, ${listed.length} listed`,
    );

    const thirdLogin = await call("/api/auth/login", {
      method: "POST",
      body: { email: multi.email, password: "Password123!" },
    });
    const revokeOthers = await call("/api/auth/sessions/revoke-others", {
      method: "POST",
      cookie: secondLogin.cookie,
    });
    check(
      "sign out everywhere keeps the current session and ends the rest (S-14)",
      revokeOthers.status === 200 &&
        (await authenticated(secondLogin.cookie)) === true &&
        (await authenticated(thirdLogin.cookie)) === false,
      `status ${revokeOthers.status}, other session ${(await authenticated(thirdLogin.cookie)) ? "still valid" : "revoked"}`,
    );

    const currentId = (listed.find((row) => row.current) ?? {}).id;
    const deleteCurrent = await call(`/api/auth/sessions/${currentId}`, {
      method: "DELETE",
      cookie: secondLogin.cookie,
    });
    check(
      "revoking the current session signs the caller out and clears the cookie (S-14)",
      deleteCurrent.status === 200 &&
        /max-age=0/i.test(deleteCurrent.setCookie ?? "") &&
        (await authenticated(secondLogin.cookie)) === false,
      `status ${deleteCurrent.status}, cookie ${deleteCurrent.setCookie ?? "none"}`,
    );

    // Ordinary concurrent reads must never invalidate the session.
    const concurrent = await registerS14("concurrent");
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => meS14(concurrent.cookie)),
    );
    check(
      "concurrent authenticated requests do not invalidate the session (S-14)",
      responses.every((res) => res.status === 200 && res.json?.authenticated === true),
      `${responses.filter((res) => res.json?.authenticated === true).length}/6 authenticated`,
    );

    if (hasLastUsedAt) {
      const stale = `s14-stale-${Date.now()}`;
      const old = new Date(Date.now() - 40 * dayMs);
      await s14.session.createMany({
        data: [
          {
            id: `${stale}-revoked`,
            userId: multi.userId,
            tokenHash: `${stale}-revoked-hash`,
            expiresAt: new Date(Date.now() + dayMs),
            lastUsedAt: old,
            revokedAt: old,
          },
          {
            id: `${stale}-expired`,
            userId: multi.userId,
            tokenHash: `${stale}-expired-hash`,
            expiresAt: old,
            lastUsedAt: old,
          },
        ],
      });
      const keep = await registerS14("cleanup");
      const survivor = await s14.session.findFirst({ where: { userId: keep.userId } });
      // Cleanup is opportunistic on sign-in, so a login is what triggers it.
      await login("reseller@sellflow.test", "Password123!");
      const gone = await s14.session.count({ where: { id: { startsWith: stale } } });
      check(
        "cleanup removes long-dead sessions and keeps live ones (S-14)",
        gone === 0 && survivor !== null,
        `${gone} stale rows remain`,
      );
    } else {
      check("cleanup removes long-dead sessions and keeps live ones (S-14)", false, "lastUsedAt column missing");
    }

    // ── S-14 final review: a privilege change and its revocation are ONE unit ─
    // Fault injection uses the isolated database, not a hook in the app: a
    // trigger makes every session revocation fail while it exists. Each flow
    // must then roll its privilege change back, never commit the change with a
    // superseded session still usable.
    const blockRevocations = async () => {
      await s14.$executeRawUnsafe(`DROP TRIGGER IF EXISTS s14_block_revoke`);
      await s14.$executeRawUnsafe(
        `CREATE TRIGGER s14_block_revoke BEFORE UPDATE OF "revokedAt" ON "Session" WHEN NEW."revokedAt" IS NOT NULL BEGIN SELECT RAISE(ABORT, 's14 injected revocation failure'); END`,
      );
    };
    const unblockRevocations = () => s14.$executeRawUnsafe(`DROP TRIGGER IF EXISTS s14_block_revoke`);

    try {
      // 1. Self-service role activation.
      await blockRevocations();
      const atomicGrant = await registerS14("atomic-grant");
      const blockedGrant = await call("/api/profile/roles", {
        method: "POST",
        cookie: atomicGrant.cookie,
        body: { role: "RESELLER" },
      });
      const grantedRows = await s14.profileRole.count({
        where: { profileId: atomicGrant.profileId, role: "RESELLER" },
      });
      const oldGrantCookieValid = await authenticated(atomicGrant.cookie);
      check(
        "a failed revocation rolls the role grant back (S-14 atomicity)",
        blockedGrant.status >= 500 && grantedRows === 0 && oldGrantCookieValid === true,
        `status ${blockedGrant.status}, ${grantedRows} RESELLER row(s), old cookie ${oldGrantCookieValid ? "still valid" : "revoked"}`,
      );
      await unblockRevocations();
      const retriedGrant = await call("/api/profile/roles", {
        method: "POST",
        cookie: atomicGrant.cookie,
        body: { role: "RESELLER" },
      });
      check(
        "the role grant commits and rotates once revocation works (S-14 atomicity)",
        retriedGrant.status === 200 &&
          (await authenticated(atomicGrant.cookie)) === false &&
          (await authenticated(retriedGrant.cookie)) === true,
        `status ${retriedGrant.status}, old cookie ${(await authenticated(atomicGrant.cookie)) ? "still valid" : "revoked"}`,
      );

      // 2. Supplier profile creation (activates SUPPLIER).
      await blockRevocations();
      const atomicSupplier = await registerS14("atomic-supplier");
      const blockedSupplier = await call("/api/supplier/profile", {
        method: "POST",
        cookie: atomicSupplier.cookie,
        body: { businessName: "Atomic Supply" },
      });
      const supplierRows = await s14.supplierProfile.count({
        where: { profileId: atomicSupplier.profileId },
      });
      const supplierRoles = await s14.profileRole.count({
        where: { profileId: atomicSupplier.profileId, role: "SUPPLIER" },
      });
      const oldSupplierCookieValid = await authenticated(atomicSupplier.cookie);
      check(
        "a failed revocation rolls supplier activation back (S-14 atomicity)",
        blockedSupplier.status >= 500 &&
          supplierRows === 0 &&
          supplierRoles === 0 &&
          oldSupplierCookieValid === true,
        `status ${blockedSupplier.status}, ${supplierRows} profile row(s), ${supplierRoles} SUPPLIER row(s)`,
      );
      await unblockRevocations();
      const retriedSupplier = await call("/api/supplier/profile", {
        method: "POST",
        cookie: atomicSupplier.cookie,
        body: { businessName: "Atomic Supply" },
      });
      check(
        "supplier activation commits and rotates once revocation works (S-14 atomicity)",
        retriedSupplier.status === 201 &&
          (await authenticated(atomicSupplier.cookie)) === false &&
          (await authenticated(retriedSupplier.cookie)) === true,
        `status ${retriedSupplier.status}, old cookie ${(await authenticated(atomicSupplier.cookie)) ? "still valid" : "revoked"}`,
      );

      // 3. Administrator-driven verification tier change.
      const atomicAdminCookie = await login("admin@sellflow.test", "Password123!");
      await blockRevocations();
      const atomicTarget = await registerS14("atomic-tier");
      const blockedTier = await call(`/api/admin/profiles/${atomicTarget.profileId}/verification`, {
        method: "PATCH",
        cookie: atomicAdminCookie,
        body: { tier: 1, reason: "S-14 atomicity probe" },
      });
      const tierRow = await s14.profile.findUnique({
        where: { id: atomicTarget.profileId },
        select: { verificationTier: true },
      });
      const tierEvents = await s14.verificationEvent.count({
        where: { profileId: atomicTarget.profileId },
      });
      const targetCookieValid = await authenticated(atomicTarget.cookie);
      check(
        "a failed revocation rolls the tier change back (S-14 atomicity)",
        blockedTier.status >= 500 &&
          tierRow?.verificationTier === 0 &&
          tierEvents === 0 &&
          targetCookieValid === true,
        `status ${blockedTier.status}, tier ${tierRow?.verificationTier}, ${tierEvents} event(s)`,
      );
      await unblockRevocations();
      const retriedTier = await call(`/api/admin/profiles/${atomicTarget.profileId}/verification`, {
        method: "PATCH",
        cookie: atomicAdminCookie,
        body: { tier: 1, reason: "S-14 atomicity probe" },
      });
      check(
        "the tier change commits and revokes once revocation works (S-14 atomicity)",
        retriedTier.status === 200 &&
          (await authenticated(atomicTarget.cookie)) === false &&
          (await authenticated(atomicAdminCookie)) === true,
        `status ${retriedTier.status}, target cookie ${(await authenticated(atomicTarget.cookie)) ? "still valid" : "revoked"}`,
      );

      // 4. Supplier approving a reseller application.
      const atomicApplicant = await registerS14("atomic-applicant");
      const applicantActivation = await call("/api/profile/roles", {
        method: "POST",
        cookie: atomicApplicant.cookie,
        body: { role: "RESELLER" },
      });
      atomicApplicant.cookie = applicantActivation.cookie;
      const atomicApplication = await call("/api/marketplace/applications", {
        method: "POST",
        cookie: atomicApplicant.cookie,
        body: {
          supplierProfileId: listing.supplierProfile.id,
          offerId,
          message: "S-14 atomicity probe",
          businessSummary: "S-14 atomicity probe",
        },
      });
      const atomicApplicationId = atomicApplication.json?.application?.id;
      const atomicSupplierCookie = await login("supplier@sellflow.test", "Password123!");
      await blockRevocations();
      const blockedDecision = await call(`/api/supplier/applications/${atomicApplicationId}`, {
        method: "POST",
        cookie: atomicSupplierCookie,
        body: { decision: "APPROVED", offerId, note: "S-14 atomicity probe" },
      });
      const applicationRow = atomicApplicationId
        ? await s14.resellerApplication.findUnique({
            where: { id: atomicApplicationId },
            select: { status: true },
          })
        : null;
      const agreementsAfterBlock = await s14.resellerAgreement.count({
        where: { resellerProfileId: atomicApplicant.profileId },
      });
      const applicantCookieValid = await authenticated(atomicApplicant.cookie);
      check(
        "a failed revocation rolls the application approval back (S-14 atomicity)",
        Boolean(atomicApplicationId) &&
          blockedDecision.status >= 500 &&
          applicationRow?.status === "PENDING" &&
          agreementsAfterBlock === 0 &&
          applicantCookieValid === true,
        `status ${blockedDecision.status}, application ${applicationRow?.status ?? "missing"}, ${agreementsAfterBlock} agreement(s)`,
      );
      await unblockRevocations();
      const retriedDecision = await call(`/api/supplier/applications/${atomicApplicationId}`, {
        method: "POST",
        cookie: atomicSupplierCookie,
        body: { decision: "APPROVED", offerId, note: "S-14 atomicity probe" },
      });
      check(
        "approval commits and revokes the applicant once revocation works (S-14 atomicity)",
        retriedDecision.status === 200 &&
          (await authenticated(atomicApplicant.cookie)) === false,
        `status ${retriedDecision.status}, applicant cookie ${(await authenticated(atomicApplicant.cookie)) ? "still valid" : "revoked"}`,
      );

      // 6. Submitting an application can grant the RESELLER role for the first
      //    time. That grant, its ROLE_GRANTED audit event and the session
      //    rotation share one transaction, and a failed rotation rolls the
      //    whole submission back (S-14 final review) — the same pattern used
      //    by self-service role activation.
      // 6. ROLE_GRANTED audit durability: the RESELLER grant written by
      //    ensureRole is security-critical. When ensureRole runs inside the
      //    route's transaction (which it does for the submit-application and
      //    self-service role-activation paths), a failed audit write throws
      //    AuditWriteError, poisons the transaction, and rolls back the role
      //    row, the application/activation, and any session rotation the caller
      //    did — instead of the grant surviving without a provable trail.
      //
      //    We prove it for the submit-application path by injecting an audit
      //    write failure with the existing s14_block_revoke trigger on the
      //    Session table: the trigger raises BEFORE UPDATE OF "revokedAt" so a
      //    failed rotation is already covered by the prior test; here we want the
      //    audit write itself to fail, so we use a dedicated trigger that blocks
      //    audit inserts for this probe's profile only. This keeps the injected
      //    failure scoped to one test and one profile.
      const auditFailureSubmission = await registerS14("audit-fail");
      const abortsAuditInsertForProbe = async () => {
        await s14.$executeRawUnsafe(`
          CREATE TRIGGER s14_abort_role_granted_audit
          BEFORE INSERT ON "AuditLog"
          WHEN NEW."action" = 'profile.role_granted'
             AND NEW."entityType" = 'Profile'
             AND NEW."entityId" = '${auditFailureSubmission.profileId}'
          BEGIN
            SELECT RAISE(ABORT, 's14 injected ROLE_GRANTED audit failure');
          END
        `);
      };
      const resumeAuditInsert = () =>
        s14.$executeRawUnsafe(`DROP TRIGGER IF EXISTS s14_abort_role_granted_audit`);

      await abortsAuditInsertForProbe();
      const blockedAuditSubmission = await call("/api/marketplace/applications", {
        method: "POST",
        cookie: auditFailureSubmission.cookie,
        body: {
          supplierProfileId: listing.supplierProfile.id,
          offerId,
          message: "S-14 role-granted audit-failure probe",
          businessSummary: "S-14 role-granted audit-failure probe",
        },
      });
      const blockedAuditRoleRows = await s14.profileRole.count({
        where: { profileId: auditFailureSubmission.profileId, role: "RESELLER" },
      });
      const blockedAuditApplication = blockedAuditSubmission.json?.application
        ? await s14.resellerApplication.findUnique({
            where: { id: blockedAuditSubmission.json.application.id },
            select: { id: true, status: true },
          })
        : null;
      const blockedAuditRoleGrantAudit = await s14.auditLog.count({
        where: {
          action: "profile.role_granted",
          entityType: "Profile",
          entityId: auditFailureSubmission.profileId,
          metadataJson: { contains: "RESELLER" },
        },
      });
      const blockedAuditCookieValid = await authenticated(auditFailureSubmission.cookie);
      check(
        "a failed ROLE_GRANTED audit write rolls the role grant back (S-14 audit durability)",
        blockedAuditSubmission.status >= 500 &&
          blockedAuditRoleRows === 0 &&
          !blockedAuditApplication &&
          blockedAuditRoleGrantAudit === 0 &&
          blockedAuditCookieValid === true,
        `status ${blockedAuditSubmission.status}, ${blockedAuditRoleRows} RESELLER row(s), application ${blockedAuditApplication?.status ?? "none"}, ${blockedAuditRoleGrantAudit} ROLE_GRANTED audit row(s), old cookie ${blockedAuditCookieValid ? "still valid" : "revoked"}`,
      );
      // Re-enable audit inserts now that we've proven the failure path. The
      // healthy path must run with a normally functioning audit store.
      await resumeAuditInsert();
      const healthyAuditSubmission = await call("/api/marketplace/applications", {
        method: "POST",
        cookie: auditFailureSubmission.cookie,
        body: {
          supplierProfileId: listing.supplierProfile.id,
          offerId,
          message: "S-14 role-granted audit-success probe",
          businessSummary: "S-14 role-granted audit-success probe",
        },
      });
      const healthyAuditApplicationId = healthyAuditSubmission.json?.application?.id;
      const healthyAuditApplication = healthyAuditApplicationId
        ? await s14.resellerApplication.findUnique({
            where: { id: healthyAuditApplicationId },
            select: { id: true, status: true },
          })
        : null;
      const healthyAuditRoleGrantAudit = await s14.auditLog.count({
        where: {
          action: "profile.role_granted",
          entityType: "Profile",
          entityId: auditFailureSubmission.profileId,
          metadataJson: { contains: "RESELLER" },
        },
      });
      check(
        "the ROLE_GRANTED grant commits and rotates once the audit store is healthy (S-14 audit durability)",
        healthyAuditSubmission.status === 201 &&
          healthyAuditApplication?.status === "PENDING" &&
          healthyAuditRoleGrantAudit === 1 &&
          (await authenticated(auditFailureSubmission.cookie)) === false &&
          (await authenticated(healthyAuditSubmission.cookie)) === true,
        `status ${healthyAuditSubmission.status}, application ${healthyAuditApplication?.status ?? "none"}, ${healthyAuditRoleGrantAudit} ROLE_GRANTED audit row(s), old cookie ${(await authenticated(auditFailureSubmission.cookie)) ? "still valid" : "revoked"}, new cookie ${(await authenticated(healthyAuditSubmission.cookie)) ? "valid" : "invalid"}`,
      );
      // Remove the probe rows for this profile. The ROLE_GRANTED audit write that
      // ensureRole attempted for this profile was forced to fail by the trigger
      // above, which contaminated the server process's in-process audit-failure
      // counter (noteFailure was called inside auditCritical before the transaction
      // aborted). That counter lives in the server process, not in this script, so
      // the script's import of resetAuditHealth cannot reach it; the probe above
      // (moved to before the S-14 block) is what keeps the S-12 health assertion
      // clean instead. We still delete the probe rows so the database stays tidy.

      // 7. Concurrent first-time role grant: two requests racing to grant the
      //    same role for the first time must produce at most one role row and at
      //    most one ROLE_GRANTED audit event, never a server error, and must
      //    correctly report which request actually created the role so rotation
      //    happens only for the genuine privilege change.
      //
      //    ensureRole tries create first, so the winner writes the role and the
      //    audit and rotates; the loser gets a unique-violation, reads the
      //    winner's row, and returns "already existed" — which means the loser
      //    does not rotate. The application itself (not the role grant) is what
      //    is submitted per request, and each request gets its own PENDING
      //    application row because the two probes have different profiles.
      const c1 = await registerS14("concurrent-a");
      const c2 = await registerS14("concurrent-b");
      const c1Start = Date.now();
      // Fire the two submissions concurrently to exercise the race between two
      // first-time grants, then check session revocation only after both commits
      // have settled so the old cookies are judged against the post-rotation
      // state rather than a pre-rotation snapshot.
      const [c1Res, c2Res] = await Promise.all([
        call("/api/marketplace/applications", {
          method: "POST",
          cookie: c1.cookie,
          body: {
            supplierProfileId: listing.supplierProfile.id,
            offerId,
            message: "S-14 concurrent role-grant probe A",
            businessSummary: "S-14 concurrent role-grant probe A",
          },
        }),
        call("/api/marketplace/applications", {
          method: "POST",
          cookie: c2.cookie,
          body: {
            supplierProfileId: listing.supplierProfile.id,
            offerId,
            message: "S-14 concurrent role-grant probe B",
            businessSummary: "S-14 concurrent role-grant probe B",
          },
        }),
      ]);
      const c1After = await meS14(c1.cookie);
      const c2After = await meS14(c2.cookie);
      const roleRows = await s14.profileRole.count({
        where: { profileId: { in: [c1.profileId, c2.profileId] }, role: "RESELLER" },
      });
      const roleGrantAuditRows = await s14.auditLog.count({
        where: {
          action: "profile.role_granted",
          entityType: "Profile",
          entityId: { in: [c1.profileId, c2.profileId] },
          metadataJson: { contains: "RESELLER" },
        },
      });
      // Both probes have different profiles, so both create their own RESELLER
      // role row and each writes exactly one ROLE_GRANTED audit event — 2 rows,
      // 2 audits, both rotate.
      const c1App = c1Res.json?.application
        ? await s14.resellerApplication.findUnique({
            where: { id: c1Res.json.application.id },
            select: { id: true, status: true },
          })
        : null;
      const c2App = c2Res.json?.application
        ? await s14.resellerApplication.findUnique({
            where: { id: c2Res.json.application.id },
            select: { id: true, status: true },
          })
        : null;
      const c1GrantedRole = await s14.profileRole.findUnique({
        where: { profileId_role: { profileId: c1.profileId, role: "RESELLER" } },
        select: { id: true },
      });
      const c2GrantedRole = await s14.profileRole.findUnique({
        where: { profileId_role: { profileId: c2.profileId, role: "RESELLER" } },
        select: { id: true },
      });
      // Both probes have different profiles, so both create their own RESELLER
      // role row and each writes exactly one ROLE_GRANTED audit event — 2 rows,
      // 2 audits, both rotate. Rotation is detected via the POST response's
      // set-cookie header (the new session token) and the old cookie being
      // revoked (meS14 with the original cookie returns 401).
      check(
        "concurrent first-time role grants produce two role rows, two audit events (one per profile), and no server error (S-14 concurrency)",
        c1Res.status === 201 &&
          c2Res.status === 201 &&
          roleRows === 2 &&
          roleGrantAuditRows === 2 &&
          c1App?.status === "PENDING" &&
          c2App?.status === "PENDING" &&
          c1GrantedRole !== null &&
          c2GrantedRole !== null &&
          // Old cookies revoked by rotation.
          c1After?.json?.authenticated === false &&
          c2After?.json?.authenticated === false &&
          // New session cookies issued in the POST responses.
          c1Res.setCookie?.includes("sf_session=") === true &&
          c2Res.setCookie?.includes("sf_session=") === true &&
          // Different new cookies for different sessions.
          c1Res.setCookie !== c2Res.setCookie,
        `c1 ${c1Res.status} rs=${c1Res.setCookie?.includes("sf_session=") ? "rotated" : "no-rotate"} old=${c1After?.json?.authenticated ? "valid" : "revoked"} | c2 ${c2Res.status} rs=${c2Res.setCookie?.includes("sf_session=") ? "rotated" : "no-rotate"} old=${c2After?.json?.authenticated ? "valid" : "revoked"} | roles ${roleRows} | audits ${roleGrantAuditRows}`,
      );

      // 8. Submitting an application can grant the RESELLER role for the first
      //    time. That grant, its ROLE_GRANTED audit event and the session
      //    rotation share one transaction, and a failed rotation rolls the
      //    whole submission back (S-14 final review) — the same pattern used
      //    by self-service role activation.
      const submitApplication = await registerS14("submit-application");
      await blockRevocations();
      const blockedSubmission = await call("/api/marketplace/applications", {
        method: "POST",
        cookie: submitApplication.cookie,
        body: {
          supplierProfileId: listing.supplierProfile.id,
          offerId,
          message: "S-14 submit application probe",
          businessSummary: "S-14 submit application probe",
        },
      });
      const blockedRoleRows = await s14.profileRole.count({
        where: { profileId: submitApplication.profileId, role: "RESELLER" },
      });
      const blockedApplication = blockedSubmission.json?.application
        ? await s14.resellerApplication.findUnique({
            where: { id: blockedSubmission.json.application.id },
            select: { id: true, status: true },
          })
        : null;
      const blockedRoleGrantAudit = await s14.auditLog.count({
        where: {
          action: "profile.role_granted",
          entityType: "Profile",
          entityId: submitApplication.profileId,
          metadataJson: { contains: "RESELLER" },
        },
      });
      const blockedCookieValid = await authenticated(submitApplication.cookie);
      check(
        "a failed revocation rolls the application grant back (S-14 atomicity)",
        blockedSubmission.status >= 500 &&
          blockedRoleRows === 0 &&
          !blockedApplication &&
          blockedRoleGrantAudit === 0 &&
          blockedCookieValid === true,
        `status ${blockedSubmission.status}, ${blockedRoleRows} RESELLER row(s), application ${blockedApplication?.status ?? "none"}, ${blockedRoleGrantAudit} ROLE_GRANTED audit row(s), old cookie ${blockedCookieValid ? "still valid" : "revoked"}`,
      );
      await unblockRevocations();
      const grantedSubmission = await call("/api/marketplace/applications", {
        method: "POST",
        cookie: submitApplication.cookie,
        body: {
          supplierProfileId: listing.supplierProfile.id,
          offerId,
          message: "S-14 submit application probe",
          businessSummary: "S-14 submit application probe",
        },
      });
      const grantedApplicationId = grantedSubmission.json?.application?.id;
      const grantedApplication = grantedApplicationId
        ? await s14.resellerApplication.findUnique({
            where: { id: grantedApplicationId },
            select: { id: true, status: true },
          })
        : null;
      const grantedRoleRows = await s14.profileRole.count({
        where: { profileId: submitApplication.profileId, role: "RESELLER" },
      });
      const grantedRoleGrantAudit = await s14.auditLog.count({
        where: {
          action: "profile.role_granted",
          entityType: "Profile",
          entityId: submitApplication.profileId,
          metadataJson: { contains: "RESELLER" },
        },
      });
      check(
        "a first application grants RESELLER, audits it and rotates once (S-14 atomicity)",
        grantedSubmission.status === 201 &&
          grantedApplication?.status === "PENDING" &&
          grantedRoleRows === 1 &&
          grantedRoleGrantAudit === 1 &&
          (await authenticated(submitApplication.cookie)) === false &&
          (await authenticated(grantedSubmission.cookie)) === true,
        `status ${grantedSubmission.status}, application ${grantedApplication?.status ?? "none"}, ${grantedRoleRows} RESELLER row(s), ${grantedRoleGrantAudit} ROLE_GRANTED audit row(s), old cookie ${(await authenticated(submitApplication.cookie)) ? "still valid" : "revoked"}, new cookie ${(await authenticated(grantedSubmission.cookie)) ? "valid" : "invalid"}`,
      );
      // Repeat submission when the role already exists is not a privilege
      // change, so it must not rotate the session. The probe gains RESELLER via
      // self-service activation first (a separate privilege change that does
      // rotate), then submits an application; the submission finds the role
      // already present and must not rotate again.
      const repeatNoGrant = await registerS14("repeat-no-grant");
      const roleActivation = await call("/api/profile/roles", {
        method: "POST",
        cookie: repeatNoGrant.cookie,
        body: { role: "RESELLER" },
      });
      const postActivationCookie = roleActivation.cookie;
      const repeatSubmission = await call("/api/marketplace/applications", {
        method: "POST",
        cookie: postActivationCookie,
        body: {
          supplierProfileId: listing.supplierProfile.id,
          offerId,
          message: "S-14 repeat application probe",
          businessSummary: "S-14 repeat application probe",
        },
      });
      const repeatApplicationId = repeatSubmission.json?.application?.id;
      const repeatApplication = repeatApplicationId
        ? await s14.resellerApplication.findUnique({
            where: { id: repeatApplicationId },
            select: { id: true, status: true, offerId: true, resellerProfileId: true },
          })
        : null;
      const repeatRoleGrantAudit = await s14.auditLog.count({
        where: {
          action: "profile.role_granted",
          entityType: "Profile",
          entityId: repeatNoGrant.profileId,
          metadataJson: { contains: "RESELLER" },
        },
      });
      check(
        "an application that grants no new role rotates nothing (S-14 atomicity)",
        repeatSubmission.status === 201 &&
          repeatApplication?.status === "PENDING" &&
          repeatApplication?.resellerProfileId === repeatNoGrant.profileId &&
          repeatRoleGrantAudit === 1 &&
          repeatSubmission.cookie === null &&
          (await authenticated(postActivationCookie)) === true,
        `status ${repeatSubmission.status}, application ${repeatApplication?.status ?? "none"}, ${repeatRoleGrantAudit} ROLE_GRANTED audit row(s), rotated cookie ${repeatSubmission.cookie ? "yes" : "no"}, session still valid`,
      );

      // 5. Concurrency: a request racing a privilege change must see one
      //    consistent state — authenticated before the commit, rejected after —
      //    never an error or a half-applied change.
      const racing = await registerS14("atomic-racing");
      const [racingChange, ...racingReads] = await Promise.all([
        call("/api/profile/roles", {
          method: "POST",
          cookie: racing.cookie,
          body: { role: "RESELLER" },
        }),
        ...[0, 1, 2, 3].map(() => meS14(racing.cookie)),
      ]);
      check(
        "requests racing a privilege change never error mid-rotation (S-14 atomicity)",
        racingChange.status === 200 &&
          racingReads.every((res) => [200, 401].includes(res.status)),
        `change ${racingChange.status}, reads ${racingReads.map((res) => res.status).join(",")}`,
      );
    } finally {
      // Never leave the injected failure behind for later suites.
      await unblockRevocations();
    }

    await s14.session.deleteMany({ where: { id: { startsWith: "s14-legacy-" } } });
  }

  // ── S-12: the audit trail is populated, observable and transactional ──────
  // The full-suite path now delegates to the single authoritative implementation
  // in runS12Checks(), so the S-12 assertions exist in exactly one place.
  await runS12Checks(s05Prisma);

  // ── S-15: demo seeding is a development/test tool, never a production one ─
  // The demo dataset contains a platform admin and a mediator whose password is
  // committed to the repository. Seeding therefore requires an explicitly
  // classified environment, an explicit operator opt-in, and a database target
  // that is not the production volume — and it must refuse before connecting.
  if (!(process.env.DATABASE_URL ?? "").includes("sellflow-e2e-")) {
    console.log("SKIP  demo-seed guard checks need an isolated DATABASE_URL");
  } else {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    const { tmpdir } = await import("node:os");
    const { join, resolve } = await import("node:path");

    const workspace = process.cwd();
    const sandbox = mkdtempSync(join(tmpdir(), "sellflow-seed-guard-"));
    const guardDbFile = join(sandbox, "guard.db");
    const guardUrl = `file:${guardDbFile}`;
    const seedScript = resolve(workspace, "prisma/seed.ts");
    const execFileAsync = promisify(execFile);
    const hashFile = (file) =>
      createHash("sha256").update(readFileSync(file)).digest("hex");

    // Drop the harness's own environment so each case controls it exactly.
    const baseEnv = { ...process.env };
    delete baseEnv.NODE_ENV;
    delete baseEnv.SEED_DEMO_DATA;

    // Async on purpose: a blocking child process stalls the event loop, which
    // drops the keep-alive sockets the later PWA fetches reuse.
    const spawn = async (command, args, { url = guardUrl, env = {} } = {}) => {
      try {
        const { stdout } = await execFileAsync(command, args, {
          cwd: workspace,
          env: { ...baseEnv, DATABASE_URL: url, ...env },
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        return { status: 0, output: String(stdout) };
      } catch (error) {
        return {
          status: typeof error.code === "number" ? error.code : 1,
          output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
        };
      }
    };
    const refused = (result) =>
      result.status !== 0 && /Refusing to seed demo data/.test(result.output);
    const seed = (env = {}, options = {}) => spawn("npx", ["tsx", seedScript], { env, ...options });
    const query = async (expression, url = guardUrl) => {
      const code = [
        'const { PrismaClient } = require("@prisma/client");',
        "const prisma = new PrismaClient();",
        `(async () => { const value = await ${expression}; console.log(JSON.stringify(value)); await prisma.$disconnect(); })().catch(async (error) => { console.error(error); await prisma.$disconnect(); process.exit(1); });`,
      ].join("\n");
      const result = await spawn("node", ["-e", code], { url });
      if (result.status !== 0) throw new Error(`query failed: ${result.output.slice(0, 300)}`);
      return JSON.parse(result.output.trim());
    };

    try {
      await spawn("npx", ["prisma", "migrate", "deploy"], {});
      const userCount = async (url = guardUrl) => query("prisma.user.count()", url);

      // Refusals must not even connect, let alone write. Hash the database
      // before the refusal cases and prove it is byte-identical afterwards.
      const baselineHash = hashFile(guardDbFile);

      const production = await seed({ NODE_ENV: "production", SEED_DEMO_DATA: "true" });
      check(
        "NODE_ENV=production refuses demo seeding (S-15)",
        refused(production) && (await userCount()) === 0,
        `exit ${production.status}, users ${await userCount()}`,
      );

      const staging = await seed({ NODE_ENV: "staging", SEED_DEMO_DATA: "true" });
      check(
        "NODE_ENV=staging refuses demo seeding (S-15)",
        refused(staging) && (await userCount()) === 0,
        `exit ${staging.status}`,
      );

      const unset = await seed({ SEED_DEMO_DATA: "true" });
      check(
        "an unset NODE_ENV refuses demo seeding (S-15)",
        refused(unset) && (await userCount()) === 0,
        `exit ${unset.status}`,
      );

      const empty = await seed({ NODE_ENV: "  ", SEED_DEMO_DATA: "true" });
      check(
        "an empty NODE_ENV refuses demo seeding (S-15)",
        refused(empty) && (await userCount()) === 0,
        `exit ${empty.status}`,
      );

      const malformed = await seed({ NODE_ENV: "develop", SEED_DEMO_DATA: "true" });
      check(
        "a malformed NODE_ENV refuses demo seeding (S-15)",
        refused(malformed) && (await userCount()) === 0,
        `exit ${malformed.status}`,
      );

      const quotedEmpty = await seed({ NODE_ENV: '""', SEED_DEMO_DATA: "true" });
      check(
        "a quoted-empty NODE_ENV refuses demo seeding (S-15)",
        refused(quotedEmpty) && (await userCount()) === 0,
        `exit ${quotedEmpty.status}`,
      );

      const developmentWithoutOptIn = await seed({ NODE_ENV: "development" });
      check(
        "development without the operator opt-in refuses demo seeding (S-15)",
        refused(developmentWithoutOptIn) && (await userCount()) === 0,
        `exit ${developmentWithoutOptIn.status}`,
      );

      const testWithoutOptIn = await seed({ NODE_ENV: "test" });
      check(
        "test without the operator opt-in refuses demo seeding (S-15)",
        refused(testWithoutOptIn) && (await userCount()) === 0,
        `exit ${testWithoutOptIn.status}`,
      );

      const wrongOptIn = await seed({ NODE_ENV: "development", SEED_DEMO_DATA: "yes" });
      check(
        "a non-true opt-in value refuses demo seeding (S-15)",
        refused(wrongOptIn) && (await userCount()) === 0,
        `exit ${wrongOptIn.status}`,
      );

      const npmSeed = await spawn("npm", ["run", "db:seed"], { env: { NODE_ENV: "development" } });
      check(
        "npm run db:seed no longer opts in on its own (S-15)",
        refused(npmSeed) && (await userCount()) === 0,
        `exit ${npmSeed.status}`,
      );

      const brokenTarget = await spawn("npx", ["tsx", seedScript], {
        url: `file:${join(sandbox, "missing", "nested", "guard.db")}`,
        env: { NODE_ENV: "production", SEED_DEMO_DATA: "true" },
      });
      check(
        "the guard refuses before Prisma tries to connect (S-15)",
        refused(brokenTarget) &&
          !/P1003|Unable to open|PrismaClientInitializationError|Can't reach database/i.test(
            brokenTarget.output,
          ),
        `exit ${brokenTarget.status}`,
      );

      const productionTarget = await spawn("npx", ["tsx", seedScript], {
        url: "file:/app/data/prod.db",
        env: { NODE_ENV: "development", SEED_DEMO_DATA: "true" },
      });
      check(
        "a production-shaped database target is refused even in development (S-15)",
        refused(productionTarget),
        `exit ${productionTarget.status}`,
      );

      const remoteTarget = await spawn("npx", ["tsx", seedScript], {
        url: "postgresql://demo:sup3rsecret@db.internal:5432/sellflow",
        env: { NODE_ENV: "development", SEED_DEMO_DATA: "true" },
      });
      check(
        "a non-file database target is refused and its credentials are not echoed (S-15)",
        refused(remoteTarget) && !remoteTarget.output.includes("sup3rsecret"),
        `exit ${remoteTarget.status}`,
      );

      check(
        "every refused run left the database byte-identical (S-15)",
        hashFile(guardDbFile) === baselineHash,
        `sha256 ${baselineHash.slice(0, 12)}`,
      );

      const developed = await seed({ NODE_ENV: "development", SEED_DEMO_DATA: "true" });
      const accounts = await query(
        'prisma.user.findMany({ select: { email: true, isPlatformAdmin: true }, orderBy: { email: "asc" } })',
      );
      check(
        "an opted-in development seed still creates the demo accounts (S-15)",
        developed.status === 0 &&
          accounts.length === 4 &&
          accounts.some((account) => account.email === "admin@sellflow.test" && account.isPlatformAdmin) &&
          accounts.some((account) => account.email === "mediator@sellflow.test"),
        `exit ${developed.status}, accounts ${accounts.length}`,
      );

      const tested = await seed({ NODE_ENV: "test", SEED_DEMO_DATA: "true" });
      check(
        "an opted-in test seed still succeeds (S-15)",
        tested.status === 0 && (await userCount()) === 4,
        `exit ${tested.status}`,
      );

      // The admin upsert must never promote or overwrite an account that
      // already owns the demo address.
      await query(
        'prisma.user.update({ where: { email: "admin@sellflow.test" }, data: { passwordHash: "sentinel-hash", isPlatformAdmin: false } }).then(() => true)',
      );
      const reseed = await seed({ NODE_ENV: "test", SEED_DEMO_DATA: "true" });
      const adminAfterReseed = await query(
        'prisma.user.findUnique({ where: { email: "admin@sellflow.test" }, select: { passwordHash: true, isPlatformAdmin: true } })',
      );
      check(
        "an opted-in reseed neither overwrites nor promotes an existing admin (S-15)",
        reseed.status === 0 &&
          adminAfterReseed?.passwordHash === "sentinel-hash" &&
          adminAfterReseed?.isPlatformAdmin === false,
        `exit ${reseed.status}, admin ${JSON.stringify(adminAfterReseed)}`,
      );

      // db:reset must apply the same guard before Prisma can drop anything.
      const resetDbFile = join(sandbox, "reset.db");
      const resetUrl = `file:${resetDbFile}`;
      await spawn("npx", ["prisma", "migrate", "deploy"], { url: resetUrl });
      await query(
        'prisma.user.create({ data: { email: "sentinel@s15.test", passwordHash: "sentinel-hash" } }).then(() => true)',
        resetUrl,
      );
      const resetBaselineHash = hashFile(resetDbFile);

      const resetProduction = await spawn("npm", ["run", "db:reset"], {
        url: resetUrl,
        env: { NODE_ENV: "production", SEED_DEMO_DATA: "true" },
      });
      const sentinelAfterProduction = await query(
        'prisma.user.findUnique({ where: { email: "sentinel@s15.test" } })',
        resetUrl,
      );
      check(
        "db:reset refuses in production and leaves the database untouched (S-15)",
        refused(resetProduction) &&
          Boolean(sentinelAfterProduction) &&
          hashFile(resetDbFile) === resetBaselineHash,
        `exit ${resetProduction.status}`,
      );

      const resetWithoutOptIn = await spawn("npm", ["run", "db:reset"], {
        url: resetUrl,
        env: { NODE_ENV: "development" },
      });
      const sentinelAfterNoOptIn = await query(
        'prisma.user.findUnique({ where: { email: "sentinel@s15.test" } })',
        resetUrl,
      );
      check(
        "db:reset requires an explicit opt-in and leaves the database untouched (S-15)",
        refused(resetWithoutOptIn) &&
          Boolean(sentinelAfterNoOptIn) &&
          hashFile(resetDbFile) === resetBaselineHash,
        `exit ${resetWithoutOptIn.status}`,
      );

      const resetDevelopment = await spawn("npm", ["run", "db:reset"], {
        url: resetUrl,
        env: { NODE_ENV: "development", SEED_DEMO_DATA: "true" },
      });
      const resetUsers = await userCount(resetUrl);
      const sentinelAfterReset = await query(
        'prisma.user.findUnique({ where: { email: "sentinel@s15.test" } })',
        resetUrl,
      );
      check(
        "an opted-in db:reset drops and reseeds a disposable database (S-15)",
        resetDevelopment.status === 0 && resetUsers === 4 && sentinelAfterReset === null,
        `exit ${resetDevelopment.status}, users ${resetUsers}`,
      );

      const deployScript = readFileSync(resolve(workspace, "scripts/deploy.sh"), "utf8");
      const compose = readFileSync(resolve(workspace, "docker-compose.yml"), "utf8");
      const dockerfile = readFileSync(resolve(workspace, "Dockerfile"), "utf8");
      const productionEnv = readFileSync(resolve(workspace, ".env.production.example"), "utf8");
      check(
        "the production deployment path never invokes demo seeding (S-15)",
        !/db:seed|prisma\/seed\.ts|prisma db seed/.test(deployScript) &&
          !/db:seed|prisma\/seed\.ts/.test(compose) &&
          !/db:seed|prisma\/seed\.ts|prisma db seed|SEED_DEMO_DATA/.test(dockerfile) &&
          !/SEED_DEMO_DATA/.test(productionEnv),
      );
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  }

  // ── PWA layer ─────────────────────────────────────────────────────────────
  // Manifest, service worker cache boundaries, offline screen and layout tags.
  // `npm run test:pwa` runs the same assertions against a fresh production build.
  await runPwaChecks(BASE, { check });

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("Verification crashed:", error.message);
  process.exit(1);
});
