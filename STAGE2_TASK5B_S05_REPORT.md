# SellFlow — Stage 2, Task 5B: S-05 (Login Throttling & Client-IP Capture) Report

**Date:** 2026-11-04
**Scope:** S-05 only. S-07, S-09, S-10, S-11, S-12 and S-14 were not started. No billing, entitlement, C-03, role/permission, password-reset or email-verification change. One additive schema model was required and is documented below. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

> **Status:** Password sign-in is now durably throttled per normalized account identity and per validated source IP. The threshold response is HTTP 429 with `Retry-After`, unknown and known accounts are indistinguishable, locks are bounded and cannot be extended by continued attacks, successful sign-in clears the account counter, and concurrent attempts cannot lose increments. Client IPs are only read from forwarding headers when an explicitly configured trusted proxy proves itself; arbitrary header text is never stored as an IP. Login and registration both pass a validated IP into `startSession()`.

---

## 1. Root cause

The Stage 1 architecture inspection found that password sign-in had no throttle of any kind:

```text
grep -rniE "rate.?limit|throttl|lockout|attempt" src scripts
→ no auth match (only unrelated order-number retry variables)
```

The login route called `authenticate()` on every request, and on failure returned the same `401 INVALID_CREDENTIALS` indefinitely. There was no counter, no window, no lock, no delay and no durable state. An attacker could therefore submit an unlimited number of password guesses. The documented `MAX_AUTH_ATTEMPTS` setting existed in `.env.production.example`, but the application never read it.

The same inspection found a second, related defect: both login and registration called `startSession(..., { ip: null })`. `Session.ipHash` was therefore always `NULL`, even though `clientIpHash(request)` existed for audit metadata. That helper also trusted the **leftmost** `X-Forwarded-For` value and `X-Real-IP` unconditionally:

```ts
const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
const realIp = request.headers.get("x-real-ip")?.trim();
return hashIp(forwarded || realIp || null);
```

Consequences:

1. No brute-force resistance at all for password login.
2. No IP-based resistance to password spraying across many accounts.
3. Session records could not support abuse investigation because the IP was never stored.
4. Audit metadata recorded whatever text an attacker put in `X-Forwarded-For`, including non-IP strings.

The throttle belongs in the login route around `authenticate()`; the IP policy belongs in a small shared module used by login, registration and `startSession()`.

---

## 2. Failing baseline (recorded before implementation)

The 46 S-05 assertions were added to `scripts/verify-api.mjs` and the harness was taught to supply a per-run trusted-proxy secret and the same thresholds the server uses. The baseline was then run against the **unmodified application**:

```text
npm run test:e2e:clean -- --skip-build
```

Result: **15 S-05 failures**, exit 1, 69.2 s. The API suite stopped before the PWA stage. The harness still proved `prisma/dev.db` untouched (`sha256=522a35fcabbf`, size `589824`).

```text
FAIL  registration records a validated client IP when a trusted proxy supplies one (S-05) — ipHash null
FAIL  login records a validated client IP when a trusted proxy supplies one (S-05) — ipHash null
FAIL  the attempt that reaches the account limit is throttled (S-05) — status 401, details null
FAIL  a throttled login advertises a Retry-After interval (S-05) — Retry-After null
FAIL  repeated incorrect passwords trigger throttling (S-05) — 401,401,401,401,401
FAIL  correct credentials are rejected while the account is locked (S-05) — status 200
FAIL  throttling does not disclose whether an account exists (S-05) — known 200/undefined, unknown 401/INVALID_CREDENTIALS
FAIL  failures after a success start from zero and only then reach the limit (S-05) — after 401,401,401,401, final 401
FAIL  repeated failures from one source IP trigger throttling (S-05) — 401 × 20
FAIL  a correct password is rejected when the source IP is throttled (S-05) — status 200
FAIL  a spoofed forwarding header cannot change the recorded audit IP (S-05) — metadata trusted the forged value
FAIL  an invalid IP is never hashed into the audit trail (S-05) — metadata held a hash of non-IP text
FAIL  a missing IP is stored as null, not fabricated (S-05) — metadata held a hash despite no address
FAIL  concurrent attempts trigger the throttle (S-05) — 401 × 10
FAIL  concurrent attempts cannot bypass the lockout threshold (S-05) — status 200
```

The baseline proves each defect directly:

- Five wrong passwords returned `401` five times; the correct password afterwards returned `200`.
- Twenty wrong passwords from one IP returned `401` twenty times; the correct password afterwards returned `200`.
- A 10-request concurrent burst returned `401` ten times; the correct password afterwards returned `200`.
- Session `ipHash` was `null` even when a trusted proxy supplied a valid address.
- Audit metadata recorded a salted hash of `X-Forwarded-For` text supplied by the client, including invalid strings, and hashed something even when no IP was present.

The baseline used only the harness's throwaway SQLite file. No test targeted `prisma/dev.db`.

---

## 3. Throttling design and thresholds

### 3.1 Two independent scopes

| Scope | What it protects | Default limit | Default window | Default lock |
|---|---|---|---|---|
| `ACCOUNT` | One normalized email address | `MAX_AUTH_ATTEMPTS=5` | `AUTH_ATTEMPT_WINDOW_SECONDS=900` | `AUTH_LOCKOUT_SECONDS=900` |
| `IP` | One validated source address across all accounts | `MAX_AUTH_IP_ATTEMPTS=20` | `AUTH_ATTEMPT_WINDOW_SECONDS=900` | `AUTH_LOCKOUT_SECONDS=900` |

- The IP ceiling is deliberately higher than the account ceiling so a shared office/NAT address is not locked as quickly as a single targeted account.
- Both windows and locks are capped at **24 hours** in code, regardless of environment values.
- `AUTH_THROTTLE_RETENTION_SECONDS` defaults to `86400`; `AUTH_THROTTLE_MAX_ROWS` defaults to `50000`.
- Retention is forced to be at least the window and the lock, so a row is never pruned while it could still be active.
- Invalid or non-positive environment values fall back to the defaults.

### 3.2 When the limit is reached

`recordLoginFailure()` increments the counter and returns the resulting state. If the counter reaches the configured limit, that same attempt is answered with `429`; the account/IP is locked from that point. Observed behavior with defaults:

```text
account: 401, 401, 401, 401, 429   (5th failure locks)
IP:      401 × 19, 429             (20th failure locks)
```

### 3.3 Response contract

`src/lib/api.ts` gained `tooManyRequests(message, retryAfterSeconds)`:

```json
{
  "error": "Too many sign-in attempts. Try again later.",
  "code": "TOO_MANY_ATTEMPTS",
  "details": { "retryAfterSeconds": 900 }
}
```

with HTTP `429`, `Retry-After: 900`, and the existing `Cache-Control: private, no-store`.

The locked response is produced **before** password verification, so a locked account costs no bcrypt work and cannot be probed for password correctness.

### 3.4 No account-existence disclosure

- Before a lock, every failure mode (unknown email, wrong password, disabled account) returns the existing `401 INVALID_CREDENTIALS` with one message.
- After the threshold, known and unknown emails both return the identical `429 / TOO_MANY_ATTEMPTS / "Too many sign-in attempts. Try again later."`
- The test locks a real account and an unknown email and asserts the status, code and message are identical.

### 3.5 No permanent attacker-triggerable lockout

- A lock expires after `AUTH_LOCKOUT_SECONDS` (default 15 minutes; hard cap 24 hours).
- While a key is locked, `checkLoginThrottle()` returns the state without writing, and the route throws before `authenticate()`. Continued attacks therefore **cannot extend** the lock.
- `upsertFailure()` preserves a still-active `lockedUntil` if a concurrent request reaches it, rather than replacing it with a later value.
- No operator action is needed to unlock.

### 3.6 Success resets the account, not the IP

`clearLoginFailures(email)` deletes the `ACCOUNT` row for that normalized email. The `IP` row is intentionally **not** cleared: it is aggregate behaviour across accounts, and letting one valid account reset it would let an attacker with one known-good login erase password-spraying evidence. This is a deliberate policy, documented here and in code.

### 3.7 Storage bounds

- Rows older than `AUTH_THROTTLE_RETENTION_SECONDS` are deleted after a failed login.
- If the table still exceeds `AUTH_THROTTLE_MAX_ROWS`, the oldest **unlocked or expired** rows are deleted first; active locks are removed last.
- Cleanup failures are caught and logged, so a cleanup problem can never turn a failed login into a `500`.
- The table therefore has a hard row cap even under sustained attack.

---

## 4. Keying and normalization

### 4.1 Account identity

```ts
export function normaliseAccountIdentity(email: string): string {
  return email.trim().toLowerCase();
}
```

The key is a salted SHA-256 hash of `account:<normalized email>`:

```ts
function accountKey(email: string): string {
  return hashIdentifier(`account:${normaliseAccountIdentity(email)}`);
}
```

This is what makes the lock resistant to trivial evasion. `RESELLER@SELLFLOW.TEST`, `  reseller@sellflow.test  ` and `Reseller@SellFlow.Test` all map to one key. The regression test deliberately alternates uppercase and whitespace-padded forms across the failure burst.

Unknown emails are keyed and throttled exactly like real ones. No `User` lookup is required to create a counter, so the throttle itself cannot leak existence through timing or storage behavior.

### 4.2 Source IP

```ts
function ipKey(ip: string): string {
  return hashIdentifier(`ip:${ip}`);
}
```

The IP is already validated and canonicalized before this point. IPv6 is expanded so `2001:db8::1` and `2001:0db8:0:0:0:0:0:1` produce the same key and the same session hash.

### 4.3 Why hashes, not raw values

`LoginThrottle.key` stores only a salted digest. A database leak does not hand over a list of targeted email addresses or client IPs. The salt is `SESSION_SECRET` via `src/lib/auth/identifiers.ts`, the same secret already required in production for session-token hashing.

### 4.4 Schema

One additive model, no existing model changed:

```prisma
model LoginThrottle {
  id              String    @id @default(cuid())
  scope           String    // ACCOUNT | IP
  key             String    // salted hash
  failures        Int       @default(0)
  windowStartedAt DateTime
  lockedUntil     DateTime?
  updatedAt       DateTime  @updatedAt

  @@unique([scope, key])
  @@index([updatedAt])
  @@index([lockedUntil])
}
```

Migration: `prisma/migrations/20261104060000_login_throttle/migration.sql` creates the table and the three indexes. `prisma migrate diff --from-migrations ... --to-schema-datamodel ...` reports **“No difference detected.”**

A separate table was necessary rather than columns on `User`:

- unknown emails must be throttled without creating a `User`;
- source IPs are not tied to a user;
- counters must survive restarts and multiple processes;
- rows need independent expiry, pruning and a row cap.

In-memory state would not be durable and would not coordinate multiple server processes.

---

## 5. Atomicity and concurrency

Each key is updated by **one** SQLite statement:

```sql
INSERT INTO "LoginThrottle" (...)
VALUES (...)
ON CONFLICT("scope","key") DO UPDATE SET
  "failures" = CASE WHEN window expired THEN 1 ELSE "failures" + 1 END,
  "windowStartedAt" = CASE WHEN window expired THEN now ELSE "windowStartedAt" END,
  "lockedUntil" = CASE
    WHEN currently locked THEN "lockedUntil"
    WHEN next failure count >= limit THEN lockUntil
    ELSE "lockedUntil"
  END,
  "updatedAt" = now
RETURNING "failures", "windowStartedAt", "lockedUntil";
```

Properties:

- **Atomic increment.** Concurrent requests cannot read-modify-write the same counter and lose an increment.
- **Window reset and lock decision in the same statement.** No request can observe a half-reset window.
- **Idempotent lock preservation.** A request that arrives while a lock is active keeps the existing `lockedUntil` rather than extending it.
- **Transient SQLite contention is retried** up to 5 times with a short backoff when the error matches `SQLITE_BUSY`, `database is locked`, `P2034` or `P2028`.
- The regression test fires `accountLimit + 5` concurrent wrong-password requests and asserts that none are accepted, that `429` appears, and that a subsequent correct password from a different IP is still `429`.

The account and IP keys are updated in sequence (two statements), not in one transaction. Each key is individually atomic; a process crash between the two can undercount the IP key by one, but can never bypass the account key or unlock an account. This is recorded as a limitation.

---

## 6. Trusted-proxy and client-IP policy

### 6.1 Default: trust nothing

`clientIp(request)` returns `null` unless **both** conditions hold:

1. `TRUSTED_PROXY_SECRET` is configured and non-empty, and
2. the request carries `x-sellflow-trusted-proxy` with that exact value (constant-time comparison).

Without a configured proxy, `X-Forwarded-For`, `X-Real-IP` and every other forwarding header are ignored. No header text is ever hashed as an IP. This is the safe default and is what production gets unless an operator opts in.

### 6.2 Trusted mode

When the proxy secret matches:

- `X-Forwarded-For` is split on commas and the **rightmost** non-empty entry is used. With one trusted proxy, that is the address the proxy itself saw; values further left may have been supplied by the client.
- If the rightmost entry is not a valid IP, the result is `null`. It never falls back to a client-supplied left-hand value.
- If `X-Forwarded-For` is absent, `X-Real-IP` is validated and used.
- Only one trusted proxy hop is supported.

The test sends `X-Forwarded-For: 203.0.113.77, 198.51.100.60` through a trusted proxy and asserts the stored hash matches `198.51.100.60`, not `203.0.113.77`.

### 6.3 Validation and canonicalization

`normaliseIp()` accepts only literals recognized by Node's `isIP()`:

- IPv4 is returned trimmed.
- IPv6 is lowercased and fully expanded to 8 groups.
- IPv4-mapped IPv6 is expanded consistently.
- Zone identifiers (`fe80::1%eth0`), malformed groups (`2001:db8:::1`), out-of-range octets (`999.1.1.1`) and arbitrary text (`definitely-not-an-ip`) return `null`.
- Leading/trailing whitespace is trimmed.

`startSession()` calls `normaliseIp(meta.ip)` again before hashing. This is defence in depth: even a future caller that passes raw header text cannot cause arbitrary text to be stored as a session IP.

### 6.4 Missing IP

If no trusted proxy supplies a valid address, the IP is `null`:

- `Session.ipHash` is `null`.
- The audit row's `ipHash` and `metadata.ipHash` are `null`.
- The account throttle still applies; the IP throttle is simply inactive for that request.
- Login and registration still succeed. Missing IP information is never fabricated.

### 6.5 Deployment contract

`.env.production.example` documents the required proxy behavior:

1. strip any client-supplied `x-sellflow-trusted-proxy`, `x-forwarded-for` and `x-real-ip`;
2. add `x-sellflow-trusted-proxy: <TRUSTED_PROXY_SECRET>`;
3. append the real client address to `x-forwarded-for`.

`docker-compose.yml` passes `TRUSTED_PROXY_SECRET`, `MAX_AUTH_IP_ATTEMPTS`, `AUTH_ATTEMPT_WINDOW_SECONDS`, `AUTH_LOCKOUT_SECONDS`, `AUTH_THROTTLE_RETENTION_SECONDS` and `AUTH_THROTTLE_MAX_ROWS` through to the container. `TRUSTED_PROXY_SECRET` defaults to empty.

---

## 7. Regression tests — 46 S-05 assertions

Added to `scripts/verify-api.mjs` after the existing S-13 block. They use dedicated probe accounts and never touch the seeded fixtures' passwords or the shared database.

| # | Assertion | Expected | Result |
|---|---|---|---|
| 1 | A fresh account registers (setup) | 201 + cookie | PASS |
| 2 | Registration records a validated client IP | session hash matches trusted IP | PASS |
| 3 | A legitimate login succeeds | 200 + cookie | PASS |
| 4 | Login cookie keeps `HttpOnly`, `SameSite=Lax`, `Path=/` | all present | PASS |
| 5 | Production login cookie is still `Secure` | `Secure` present | PASS |
| 6 | Login records a validated client IP | session hash matches trusted IP | PASS |
| 7 | Session creation still authenticates | `/api/auth/me` authenticated | PASS |
| 8 | Logout revokes the session and clears the cookie | 200 + `Max-Age=0` | PASS |
| 9 | The revoked session no longer authenticates | `authenticated:false` | PASS |
| 10 | S-13 still rejects a foreign-Origin login | 403 | PASS |
| 11 | The attempt reaching the account limit is throttled | 429 + `retryAfterSeconds` | PASS |
| 12 | A throttled login advertises `Retry-After` | header > 0 | PASS |
| 13 | Repeated incorrect passwords trigger throttling | burst contains 429 | PASS |
| 14 | No incorrect password is accepted during the burst | only 401/429 | PASS |
| 15 | Correct credentials are rejected while locked | 429, no cookie | PASS |
| 16 | Throttling does not disclose account existence | known and unknown identical | PASS |
| 17 | A second account registers (setup) | 201 | PASS |
| 18 | Throttling is scoped by account identity | other account 200 | PASS |
| 19 | Reset-probe account registers (setup) | 201 | PASS |
| 20 | A successful login clears the account counter | prior 401s, success 200 | PASS |
| 21 | Failures after success start from zero | 401 × 4 then 429 | PASS |
| 22 | Registration does not inherit a login lockout | 201 | PASS |
| 23 | Registering a locked account's email is a conflict, not a lockout | 409 | PASS |
| 24 | Repeated failures from one IP trigger throttling | burst contains 429 | PASS |
| 25 | Correct password is rejected when the IP is throttled | 429, no cookie | PASS |
| 26 | A different IP is unaffected | 200 + cookie | PASS |
| 27 | An IPv6 client IP is accepted | 200 + cookie | PASS |
| 28 | IPv6 is canonicalized before hashing | hash matches expanded form | PASS |
| 29 | An alternate IPv6 spelling still logs in | 200 | PASS |
| 30 | Alternate IPv6 spellings share one hash | identical hash | PASS |
| 31 | A trusted proxy chain still logs in | 200 | PASS |
| 32 | A trusted chain records the rightmost IP | rightmost hash, not leftmost | PASS |
| 33 | An untrusted forwarding header still logs in | 200 | PASS |
| 34 | A spoofed header cannot change the session IP | hash differs from spoof | PASS |
| 35 | A spoofed header cannot change the audit IP | both audit fields differ | PASS |
| 36 | An invalid IP header is handled safely | 200 + cookie | PASS |
| 37 | An invalid IP is never stored as a session address | `null` | PASS |
| 38 | An invalid IP is never hashed into the audit trail | both audit fields `null` | PASS |
| 39 | A login with no IP information still succeeds | 200 + cookie | PASS |
| 40 | A missing IP is stored as null, not fabricated | session + audit `null` | PASS |
| 41 | Registration handles invalid IP information safely | 201 | PASS |
| 42 | An invalid registration IP is stored as null | `null` | PASS |
| 43 | Concurrency-probe account registers (setup) | 201 | PASS |
| 44 | Concurrent wrong passwords are never accepted | only 401/429 | PASS |
| 45 | Concurrent attempts trigger the throttle | burst contains 429 | PASS |
| 46 | Concurrent attempts cannot bypass the lockout | subsequent correct login 429 | PASS |

### 7.1 Coverage of the 14 required S-05 scenarios

| Required scenario | Assertions |
|---|---|
| Legitimate login still works | 3, 7 |
| Repeated wrong passwords are throttled | 11, 13 |
| Correct credentials rejected during lockout | 15 |
| 429 with retry indication | 11, 12 |
| Unknown and known accounts indistinguishable | 16 |
| Email case/whitespace normalization | 13 (alternating uppercase/padded forms) |
| Success resets the relevant failure state | 20, 21 |
| IP-based throttling | 24, 25 |
| Other IPs unaffected | 26 |
| Forged forwarding headers cannot evade throttling or change the IP | 33–35 |
| Invalid IP text handled safely | 36–38 |
| Missing IP handled safely | 39–42 |
| Concurrency safety | 44–46 |
| Cookie/logout stability and S-13 protection | 4, 5, 8, 9, 10 |

### 7.2 Test mechanics

- `call()` now returns `setCookie` and `retryAfter` so cookie flags and the retry header can be asserted directly.
- `TRUSTED_PROXY_SECRET`, `MAX_AUTH_ATTEMPTS` and `MAX_AUTH_IP_ATTEMPTS` are read from the environment. When a secret is present, the suite can choose distinct source IPs; when absent, header assertions are skipped rather than weakening the default.
- `ipHashOf()` mirrors `hashIp()` from `src/lib/auth/session.ts` using the test's `SESSION_SECRET`.
- Database assertions run only when `DATABASE_URL` names a `sellflow-e2e-` temp file and import Prisma inside the suite.
- The harness generates a per-run `TRUSTED_PROXY_SECRET` and sets the same thresholds for the server and the suite.

---

## 8. Full verification results

| Check | Command | Result |
|---|---|---|
| S-05 assertions | inside `npm run test:e2e:clean` | **46 / 46 pass** |
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | `npm run build` (standalone) | **exit 0** |
| Prisma schema | `npx prisma validate` | **valid** |
| Migration parity | `npx prisma migrate diff --from-migrations … --to-schema-datamodel …` | **No difference detected** |
| API suite | `scripts/verify-api.mjs` | **284 / 284 pass** (includes its embedded PWA pass) |
| Standalone PWA suite | `scripts/verify-pwa.mjs` | **31 / 31 pass** |
| Combined | `npm run test:e2e:clean` | **315 PASS, 0 FAIL**, exit 0, 155.3 s |
| Existing S-01, S-02, S-03, S-04, S-06, S-08, S-13, S-15 | same run | **all green** (82 tagged PASS lines) |
| S-13 checks | same run | **18 / 18 pass** |
| S-15 checks | same run | **21 / 21 pass** |
| Isolation | canary workspace + `/proc` `DATABASE_URL` check | both passed |
| Harness port | own free port `36883` | released |
| Existing servers | ports `3000`, `4317`, `4322` | not stopped or restarted |

```text
harness_exit=0
API suite PASS: 284
standalone PWA PASS: 31
combined PASS: 315
FAIL: 0
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 155.3s (isolated DB, api=0, pwa=0)
```

The API-suite total includes the PWA checks that `verify-api.mjs` runs at its end; the standalone PWA suite adds the remaining 31. The 46 S-05 assertions are inside the 284.

**Baseline vs final:**

| Metric | Baseline (unmodified app) | Final |
|---|---|---|
| S-05 failures | 15 | 0 |
| Account burst | `401 × 5`, then correct login `200` | `401 × 4, 429`, then correct login `429` |
| IP burst | `401 × 20`, then correct login `200` | `401 × 19, 429`, then correct login `429` |
| Concurrent burst | `401 × 10`, then correct login `200` | `401 × 4, 429 × 6`, then correct login `429` |
| Session IP | always `null` | validated trusted IP hash |
| Audit IP | hashed arbitrary header text | validated IP hash or `null` |

---

## 9. Database fingerprint and isolation

| Evidence | Value |
|---|---|
| `sha256sum prisma/dev.db` before and after | `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` against `prisma/dev.db` | **not run** |
| Test target | a fresh `mkdtemp` SQLite file under `/tmp`, removed by the harness |
| Shared development database writes | none |
| `prisma/dev.db` migration | **not applied**; the shared file has not been altered |

`prisma/dev.db` was intentionally left un-migrated. Operators must apply the new migration in their own environment with `npx prisma migrate deploy` (or the deploy script's migrate stage). Tests use only throwaway databases created and removed by the harness.

---

## 10. Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added the additive `LoginThrottle` model and its indexes. No existing model changed. |
| `prisma/migrations/20261104060000_login_throttle/migration.sql` | New table + unique/index definitions. |
| `src/lib/auth/identifiers.ts` | New shared `authSecret()`, `hashIdentifier()`, `hashIp()`; centralizes the salt used by sessions, IP hashes and throttle keys. |
| `src/lib/auth/client-ip.ts` | New strict trusted-proxy contract, IPv4/IPv6 validation, IPv6 canonicalization, rightmost-XFF selection. |
| `src/lib/auth/throttle.ts` | New durable throttle service: config/thresholds, normalization, atomic upsert, lockout state, account reset, pruning and row cap. |
| `src/lib/auth/session.ts` | `clientIpHash()` now uses the validated IP; `startSession()` re-validates its `ip` argument; re-exports `hashIp`/`clientIp`. |
| `src/lib/api.ts` | `ApiError` accepts optional response headers; added `tooManyRequests()`; the error handler emits those headers. S-13 origin logic unchanged. |
| `src/app/api/auth/login/route.ts` | Pre-check lock state, record failures, return 429 with `Retry-After`, clear account failures on success, pass validated IP to `startSession()` and audit. |
| `src/app/api/auth/register/route.ts` | Pass the validated IP to `startSession()` and audit. No login lockout is applied to registration. |
| `scripts/verify-api.mjs` | Added 46 S-05 assertions, cookie/`Retry-After` capture, trusted-proxy test headers and optional DB assertions. |
| `scripts/test-e2e-clean.mjs` | Supplies a per-run `TRUSTED_PROXY_SECRET`, auth thresholds, and the secure-cookie expectation. |
| `.env.production.example` | Replaced the stale `MAX_AUTH_ATTEMPTS` note with the real throttle settings and the trusted-proxy contract. |
| `docker-compose.yml` | Passes the throttle and trusted-proxy variables to the container. |
| `STAGE2_TASK5B_S05_REPORT.md` | This report. |

**Not changed:** billing/entitlements/C-03, role and permission checks, password reset, email verification, `scripts/deploy.sh`, `Dockerfile`, `scripts/seed-pilot.mjs`, the S-15 seed/reset guards, and the S-13 origin logic. No dependencies were added or removed.

---

## 11. Remaining limitations

1. **IP throttling requires an explicitly configured trusted proxy.** With `TRUSTED_PROXY_SECRET` empty (the default), `clientIp()` returns `null` and only the account throttle is active. This is the safe default: the app cannot see a trustworthy address without proxy cooperation. Operators who need IP throttling must configure the proxy contract in `.env.production.example`.
2. **Only one trusted proxy hop is supported.** The rightmost `X-Forwarded-For` entry is used. A CDN-plus-origin chain must be collapsed to a single trusted hop, or the contract must be extended. Multi-hop chains are out of scope.
3. **The proxy must strip client-supplied headers.** If the proxy forwards a client's own `x-sellflow-trusted-proxy` or `x-forwarded-for` without sanitizing them, the guarantee is weakened. The secret is only as strong as the proxy configuration that protects it.
4. **Account and IP counters are two statements, not one transaction.** Each key is atomic, but a process crash between them can undercount the IP key by one. It cannot bypass or extend the account lock.
5. **SQLite is a single-writer database.** The upsert is atomic and transient contention is retried, but sustained heavy write contention can still surface as a `500` after the retry budget. A move to Postgres would remove this class of contention.
6. **A known account can be deliberately locked for up to 15 minutes (24 hours maximum) by an attacker.** This is inherent to any bounded account lockout. It is temporary, cannot be extended while locked, and requires no operator action to clear.
7. **A shared NAT/office IP can hit the IP ceiling.** The default of 20 is deliberately higher than the account default; it remains configurable. Large shared egress pools may need a higher value or a different policy.
8. **One valid login clears the account counter.** An attacker who already knows valid credentials can reset that account's failure state. The IP counter is intentionally not reset, which preserves spraying protection.
9. **Expiry depends on the server clock.** If the server clock moves backwards, locks last longer; if it moves forwards, locks end sooner. No external time source is used.
10. **The throttle is not a CAPTCHA or a distributed-attack defence.** It bounds guesses per account and per source IP. A botnet with many IPs and many accounts is only partially mitigated.
11. **`prisma/dev.db` does not have the new table.** The shared development database was deliberately not migrated. Login will fail against an un-migrated database because the throttle pre-check queries `LoginThrottle`; registration does not query that table but must still be migrated before deploying. Operators must run `prisma migrate deploy`. The harness applies migrations to its own temp database, which is why the suite is unaffected.
12. **No raw IP is stored anywhere.** Sessions and audits keep only a salted hash, which supports correlation but not geolocation or direct firewall action.
13. **Other findings remain open.** S-07 (email verification), S-09, S-10, S-11, S-12 and S-14 were not started. S-01, S-02, S-03, S-04, S-06, S-08, S-13 and S-15 remain green but are not re-opened here.
14. **Phase 0 remains incomplete.** This report does not claim validation passed, that the Implementation GO documentation is reconciled, or that SellFlow is pilot-safe.

---

**S-05 complete. Stopping for review; no other security task was started.**
