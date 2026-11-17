# SellFlow — Stage 2, Task 5A: S-13 (CSRF / Origin Validation) Report

**Date:** 2026-11-04
**Scope:** S-13 only. S-05, S-07, S-09, S-10, S-11, S-12 and S-14 were not started. No schema, migration, dependency, billing, entitlement or C-03 change. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

> **Status:** State-changing API requests are now checked centrally for a same-origin `Origin`/`Referer`. Foreign, malformed, opaque and authenticated headerless mutations are refused with HTTP 403 before the route handler runs. Ordinary GETs and unauthenticated login/register still work.

---

## 1. Root cause

The architecture inspection demonstrated that a mutation carrying a foreign `Origin` was accepted with HTTP 201.

`src/lib/api.ts` wraps every API route with `route()`, but the wrapper only converted thrown errors into JSON. It never inspected the request method or the `Origin`/`Referer` headers. Every route therefore accepted a cross-origin state-changing request as long as the caller had a valid session cookie (or the route was public). The session cookie is `SameSite=Lax`, which mitigates many cross-site POSTs, but it is not a complete CSRF defence and does not cover every browser/proxy combination.

There was no Origin, Referer or CSRF handling anywhere in `src/`:

```text
grep -rniE "origin|referer|csrf|sec-fetch-site" src
→ no application matches (only unrelated button/link class names)
```

The centralized wrapper is the correct enforcement point: 50 API route files import `route()`, so adding the check there covers all of them without duplicating logic in individual handlers.

---

## 2. Failing baseline (recorded before implementation)

The S-13 regression block was added to `scripts/verify-api.mjs` and run against the **unmodified** application through the isolated harness:

```text
npm run test:e2e:clean -- --skip-build
```

Result: **9 failures**, exit 1. The API suite stopped before the PWA stage.

```text
PASS  S-13 setup: a same-origin registration still succeeds — status 201
PASS  S-13 setup: the probe workspace starts empty — count 0
FAIL  a foreign Origin cannot perform an authenticated mutation (S-13) — status 201
FAIL  a rejected foreign-Origin request produces HTTP 403 and changes no records (S-13) — status 201, count 1
FAIL  an authenticated mutation without Origin or Referer is refused (S-13) — status 201
FAIL  a malformed Origin header is refused safely (S-13) — status 201
FAIL  an opaque Origin: null is refused (S-13) — status 201
FAIL  a foreign Referer is refused when Origin is absent (S-13) — status 201
FAIL  forwarded headers cannot establish the expected origin (S-13) — status 201
FAIL  no rejected S-13 request modified the database — count 6
PASS  a legitimate same-origin mutation still succeeds (S-13) — status 201
PASS  a same-origin Referer is accepted when Origin is absent (S-13) — status 201
PASS  a forwarded host does not break a legitimate same-origin mutation (S-13) — status 201
PASS  GET requests continue to work regardless of Origin (S-13) — status 200
PASS  an unauthenticated mutation without Origin is still rejected (S-13) — status 401
FAIL  an unauthenticated foreign-Origin mutation is still rejected (S-13) — status 401
PASS  existing role authorization is unchanged for same-origin mutations (S-13) — status 403
```

The baseline proves the defect directly: foreign, missing, malformed and `null` origins all created records (HTTP 201), and the probe workspace grew from 0 to 6 customers. The harness reported `prisma/dev.db` untouched (`sha256=522a35fcabbf…`) and used only its temporary database.

---

## 3. Exact implementation

### 3.1 Central check in the shared wrapper

`src/lib/api.ts` now calls `assertSameOrigin(request)` at the start of `route()`, before the handler:

```ts
export function route<Ctx = unknown>(handler: (request: Request, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      assertSameOrigin(request);
      return await handler(request, ctx);
    } catch (error) {
      // existing ApiError / ZodError / 500 handling unchanged
    }
  };
}
```

A refusal throws the existing `forbidden()` helper, so the response keeps the established shape and status:

```json
{ "error": "Cross-origin request rejected", "code": "FORBIDDEN", "details": null }
```

with HTTP 403 and `Cache-Control: private, no-store`.

### 3.2 Methods covered

```ts
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
```

- `GET`, `HEAD` and `OPTIONS` are not checked. Ordinary reads keep working.
- Every other method (`POST`, `PATCH`, `PUT`, `DELETE`, etc.) is checked before the handler runs.

### 3.3 Expected origin

The expected origin is **configured**, not inferred from request headers:

```ts
const configured =
  normaliseOrigin(process.env.APP_ORIGIN) ??
  normaliseOrigin(process.env.NEXT_PUBLIC_APP_URL);
if (configured) return new Set([configured]);

if (process.env.NODE_ENV === "production") return new Set();
// development/test fallback: request URL + Host
```

- `APP_ORIGIN` is a runtime override (used by the isolated harness).
- `NEXT_PUBLIC_APP_URL` is the existing deployment value, set by the Docker build and by compose/deploy at runtime.
- In production with neither set, the allowed set is empty and every mutation fails closed with 403.
- In development/test only, the request URL and `Host` header are accepted as a convenience fallback.

**Forwarded headers are not trusted.** `X-Forwarded-Host` and `X-Forwarded-Proto` are never read. This matters because Next.js may rewrite `request.url` and even `Host` from those headers before the wrapper sees the request; the forwarded-header regression test caught exactly that during development. A reverse proxy deployment must therefore set `APP_ORIGIN` or `NEXT_PUBLIC_APP_URL` to the public origin. The existing compose/deploy path already sets `NEXT_PUBLIC_APP_URL`.

### 3.4 Safe comparison

`normaliseOrigin` parses with the WHATWG `URL` API and returns `url.origin`:

- scheme and host are lowercased;
- default ports are removed;
- `https://example.com:443` normalises to `https://example.com`;
- malformed values return `null`;
- opaque origins (`Origin: null`, `file:`) return `null`.

The check is exact set membership (`allowed.has(normalised)`), never substring matching. `https://evil.example.attacker.test` cannot match `https://evil.example`.

### 3.5 Header policy

1. **`Origin` present:** normalise and require an exact match. Foreign, malformed and `null` values are refused with 403.
2. **`Origin` absent, `Referer` present:** normalise the Referer and require an exact match. A foreign or malformed Referer is refused with 403.
3. **Both absent:** allow only when the request carries **no non-empty `sf_session` cookie**. A session cookie is ambient authority, so an authenticated mutation without either header is refused with 403. Unauthenticated calls (login, register, CLI use) still reach the handler and its existing auth checks.

The session cookie name is repeated as `SESSION_COOKIE_NAME = "sf_session"` in `src/lib/api.ts` to avoid an import cycle (`session.ts` imports `unauthorized` from `api.ts`). The comment says it must stay in sync with `SESSION_COOKIE`.

### 3.6 What did not change

- Authentication and authorization helpers (`requireAuth`, `requireWorkspace`, `requireRole`, `requireSupplier`, etc.) are untouched.
- Response conventions (`{ error, code, details }`, cache headers) are unchanged.
- No route handler received a duplicate Origin check.
- No schema, migration, dependency, billing, entitlement or C-03 change.
- The demo-seed guard from S-15 is untouched.

---

## 4. Regression test results — 17 S-13 assertions

Added to `scripts/verify-api.mjs` after the login setup. The block creates a dedicated probe account with a same-origin registration, then exercises that account's workspace. It never touches the shared development database.

| # | Assertion | Expected | Result |
|---|---|---|---|
| 1 | A same-origin registration still succeeds (setup) | 201 + session cookie | PASS |
| 2 | The probe workspace starts empty (setup) | 0 customers | PASS |
| 3 | A foreign Origin cannot perform an authenticated mutation | 403 | PASS |
| 4 | A rejected foreign-Origin request produces 403 and changes no records | 403, count unchanged, probe name absent | PASS |
| 5 | An authenticated mutation without Origin or Referer is refused | 403 | PASS |
| 6 | A malformed Origin header is refused safely | 403 | PASS |
| 7 | An opaque `Origin: null` is refused | 403 | PASS |
| 8 | A foreign Referer is refused when Origin is absent | 403 | PASS |
| 9 | Forwarded headers cannot establish the expected origin | 403 | PASS |
| 10 | No rejected S-13 request modified the database | count unchanged, no probe names | PASS |
| 11 | A legitimate same-origin mutation still succeeds | 201 + customer id | PASS |
| 12 | A same-origin Referer is accepted when Origin is absent | 201 | PASS |
| 13 | A forwarded host does not break a legitimate same-origin mutation | 201 | PASS |
| 14 | GET requests continue to work regardless of Origin | 200 | PASS |
| 15 | An unauthenticated mutation without Origin is still rejected | 401 | PASS |
| 16 | An unauthenticated foreign-Origin mutation is still rejected | 403 | PASS |
| 17 | Existing role authorization is unchanged for same-origin mutations | 403 | PASS |

**Required proofs coverage:**

| Required proof | Assertions |
|---|---|
| Foreign Origin cannot perform an authenticated mutation | 3, 4 |
| Legitimate same-origin mutation still succeeds | 11, 12, 13 |
| Rejected foreign-Origin request produces HTTP 403 | 3, 4 |
| Rejected requests do not modify database records | 4, 10 |
| GET requests continue working | 14 |
| Missing Origin follows a documented safe policy | 5, 15 |
| Existing authentication/authorization unchanged | 15, 17 plus the full existing suite |
| Unauthenticated mutations remain rejected | 15, 16 |

**Test mechanics.** `call()` now sends `Origin: BASE_ORIGIN` on state-changing methods by default, so all ordinary suite traffic behaves like a browser. `origin: null` omits the header; a string forges a foreign/malformed value. `BASE_ORIGIN` resolves from `APP_ORIGIN`, then `NEXT_PUBLIC_APP_URL`, then the test base URL, so the suite also works behind a TLS proxy. The harness starts the app with `APP_ORIGIN` set to its own base URL and passes the same value to the API suite.

---

## 5. Full verification results

| Check | Command | Result |
|---|---|---|
| S-13 assertions | inside `npm run test:e2e:clean` | **17 / 17 pass** |
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | inside `npm run test:e2e:clean` (`npm run build`) | **exit 0** |
| API suite | `scripts/verify-api.mjs` | **238 / 238 pass** (includes its embedded PWA pass) |
| Standalone PWA suite | `scripts/verify-pwa.mjs` | **31 / 31 pass** |
| Combined | `npm run test:e2e:clean` | **269 PASS, 0 FAIL**, exit 0, 134.0 s |
| Existing S-01, S-02, S-03, S-04, S-06, S-08, S-15 | same run | **all green** (64 tagged PASS lines) |
| Isolation | canary workspace + `/proc` `DATABASE_URL` check | both passed |
| Existing servers | harness used its own port and stopped only its own process group | no existing server signalled |

```text
harness_exit=0
API suite PASS: 238
standalone PWA PASS: 31
combined PASS: 269
FAIL: 0
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 134.0s (isolated DB, api=0, pwa=0)
```

The API-suite total includes the PWA checks that `verify-api.mjs` runs at its end; the standalone PWA suite adds the remaining 31. The 17 S-13 assertions are inside the 238.

---

## 6. Database fingerprint

| Evidence | Value |
|---|---|
| `sha256sum prisma/dev.db` before and after | `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` against `prisma/dev.db` | **not run** |
| Test target | a fresh `mkdtemp` SQLite file under `/tmp`, removed by the harness |
| Shared development database writes | none |

---

## 7. Files changed

| File | Change |
|---|---|
| `src/lib/api.ts` | Added centralized `assertSameOrigin()` and called it at the start of `route()`. Normalised exact-origin comparison, safe methods skipped, configured-origin precedence, production fail-closed, Origin → Referer → cookie-aware missing-header policy. No handler-specific duplication. |
| `scripts/verify-api.mjs` | `call()` now sends a same-origin `Origin` on mutations and supports explicit omission/forgery. Added 17 S-13 assertions against a dedicated probe account. |
| `scripts/test-e2e-clean.mjs` | Sends `Origin` on the canary login; starts the app and API suite with `APP_ORIGIN` set to the harness base URL. |
| `STAGE2_TASK5A_S13_REPORT.md` | This report. |

**Not changed:** `prisma/schema.prisma`, migrations, dependencies, billing/entitlements/C-03, auth/session helpers, individual route handlers, `scripts/deploy.sh`, `docker-compose.yml`, `Dockerfile`, `scripts/seed-pilot.mjs`, `prisma/dev.db`, other findings.

---

## 8. Remaining limitations

1. **Authenticated headerless requests are refused.** A browser or client that strips both `Origin` and `Referer` while sending `sf_session` gets 403. This is the deliberate safe policy; such clients must send a correct `Origin` (or `Referer`). Unauthenticated login/register/CLI calls are unaffected.
2. **Production requires a configured public origin.** If neither `APP_ORIGIN` nor `NEXT_PUBLIC_APP_URL` is set in production, every mutation fails closed with 403. The existing compose/deploy path sets `NEXT_PUBLIC_APP_URL`; a custom reverse-proxy deployment must do the same. Only one canonical origin is supported.
3. **Referer is weaker than Origin.** It is accepted only when `Origin` is absent. A non-browser client can forge either header, but such a client already needs the session cookie; the CSRF threat is the browser-controlled header.
4. **The `sf_session` cookie name is duplicated** in `src/lib/api.ts` to avoid an import cycle. It must stay in sync with `SESSION_COOKIE` in `src/lib/auth/session.ts`.
5. **This is defence-in-depth, not a replacement for authorization.** It does not replace `SameSite=Lax`, authentication, role checks, rate limiting or audit logging.
6. **Only routes using `route()` are covered.** All 50 current API route files use it. A future API handler that bypasses the wrapper would also bypass this check.
7. **A misconfigured public origin fails closed.** If `NEXT_PUBLIC_APP_URL`/`APP_ORIGIN` does not match the browser's real origin (for example, `http` vs `https` behind a proxy), legitimate mutations are refused. That is intentional, but it makes the configuration a deployment prerequisite.
8. **Phase 0 remains incomplete.** S-05, S-07, S-09, S-10, S-11, S-12 and S-14 remain open. This report does not claim validation passed or that SellFlow is pilot-safe.

---

**S-13 complete. Stopping for review; no other security task was started.**
