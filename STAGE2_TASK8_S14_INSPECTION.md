# SellFlow — Stage 2, Task 8: S-14 Session Lifecycle — Inspection Report

**Date:** 2026-11-05
**Status:** Inspection only. **No application code, schema, migration or shared database was modified.** No implementation has started; this document is submitted for review before any change.
**Scope:** S-14 only. S-09 (password recovery), email verification, billing/subscriptions/C-03 and all other findings were not touched.

**Shared database fingerprint (unchanged):** `sha256(prisma/dev.db) = 522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182` (589,824 bytes, mtime `1793746202`), verified before and after this inspection.

---

## 1. Existing session architecture

| Concern | Current implementation |
|---|---|
| Token | `randomBytes(32).toString("base64url")` — 256 bits of CSPRNG entropy (`src/lib/auth/session.ts:61`) |
| Storage | Only `hashToken(token)` = `sha256(token + ":" + SESSION_SECRET)`, unique-indexed (`Session.tokenHash`) |
| Cookie | `sf_session`, `httpOnly`, `SameSite=Lax`, `Path=/`, `secure` only when `NODE_ENV === "production"`, `expires` = session `expiresAt`, no `maxAge` |
| Lifetime | `SESSION_MAX_AGE_DAYS` (default 30) → `expiresAt = now + TTL`, fixed at creation, never extended (`sessionTtlMs()`, line 16) |
| Validation | `getAuthContext()`: look up by token hash, reject if `revokedAt` set, `expiresAt` in the past, user disabled, or profile missing; roles/permissions are re-read from the database on every request |
| Revocation | `revokeCurrentSession()` sets `revokedAt` for the presented token only. Logout calls it and clears the cookie. Nothing else revokes |
| Session rows | One row per login/registration; never deleted or pruned |
| Middleware | None — every page/route resolves the session server-side (`(app)/layout.tsx` redirects to `/login`; APIs use `requireAuth`/`requireRole`/`requireWorkspace`/`requireSupplier`/`requireAdmin`) |
| Model | `Session { id, userId, tokenHash @unique, userAgent?, ipHash?, expiresAt, createdAt, revokedAt? }` + indexes on `userId`, `expiresAt` and the unique token hash |
| Migration history | Created in `20261102203150_init`; unchanged by later migrations |

Nothing in the codebase compares the stored `userAgent`/`ipHash` with the presenting request — both are forensic metadata only.

---

## 2. Relevant files and every call site

**Core**
- `src/lib/auth/session.ts` — token generation, hashing, cookie helpers, `startSession`, `revokeCurrentSession`, `getAuthContext`, `requireAuth`, `AuthContext` type.
- `src/lib/auth/identifiers.ts` — `SESSION_SECRET` handling (production refuses to boot without ≥16 chars) and salted hashing.
- `src/lib/auth/client-ip.ts` — validated client IP resolution used for `ipHash`.
- `src/lib/auth/rbac.ts` — `requireAuth`, `requireRole`, `requireWorkspace`, `requireSupplier`, `requireReseller`, `requirePlatformAdmin`, `requireMediator`.
- `src/lib/api.ts` — `route()` wrapper, S-13 origin check (state-changing requests), `private, no-store` on all JSON.
- `prisma/schema.prisma:105–119` — `Session` model.

**Session creation (only two call sites)**
- `src/app/api/auth/login/route.ts:46` (`startSession`), cookie applied at line 69.
- `src/app/api/auth/register/route.ts:19`, cookie applied at line 48.

**Session use / invalidation**
- `src/app/api/auth/me/route.ts` — returns `authenticated: false` instead of 401.
- `src/app/api/auth/logout/route.ts:7` (`revokeCurrentSession`), line 19 (`clearSessionCookie`).
- `src/app/(app)/layout.tsx` — server-side guard for all signed-in pages.
- `src/app/marketplace/**`, all `src/app/api/**` handlers via the RBAC helpers (53 route files).
- `src/lib/client.ts` — browser `fetch` with `credentials: "same-origin"`.

**Role / privilege changes (no session invalidation today)**
- `src/server/supplier.ts:99` `grantRole()` — generic role grant, audited.
- `src/server/supplier.ts:81` SUPPLIER role granted when a supplier profile is created.
- `src/server/supplier.ts:289` / `:327` `ensureRole(…, RESELLER)` on application approval.
- `src/app/api/profile/roles/route.ts` — self-service RESELLER activation (MEDIATOR and SUPPLIER refused).
- `src/server/accounts.ts:98` `setVerificationTier()` — admin-only tier change, audited, transactional after S-12.
- `src/app/api/admin/profiles/[id]/verification/route.ts` — the only endpoint that changes another account's privileges.
- `prisma/seed.ts` — grants roles directly (demo only, guarded).

**Password handling**
- `src/server/accounts.ts:69` `authenticate()` verifies the password and only updates `lastLoginAt`.
- `src/lib/auth/password.ts` — hashing/verification primitives.
- **No password-change endpoint exists.** `src/app/api/**` contains only `auth/login`, `auth/register`, `auth/logout`, `auth/me`. Account recovery/change is S-09, explicitly out of scope.

**Tests**
- `scripts/verify-api.mjs` — S-05 block (~lines 512–900) covers cookie flags, session IP recording, `Secure` under `EXPECT_SECURE_COOKIE=1`, logout revocation, and cross-account IP isolation.
- `scripts/test-e2e-clean.mjs` — isolation canary logs in through the API.
- `scripts/verify-pwa.mjs` — no session assertions.
- **No test exists for expiry, idle time, rotation, fixation, replay, revocation on privilege change, or concurrent requests.**

---

## 3. Current vulnerabilities and reproduction

### V1 — A stolen token is valid for up to 30 days and survives every privilege change (High)

The token is never rotated, has no idle clock, and is not bound to the device that created it. `getAuthContext()` checks only `revokedAt`, `expiresAt`, user status and profile existence.

Reproduction:
1. Sign in as `reseller@sellflow.test`; copy the `sf_session` cookie value (browser devtools, a device backup, a leaked HAR file, or a shared machine).
2. `curl -H 'cookie: sf_session=<value>' http://localhost:3000/api/auth/me` → `authenticated: true`.
3. Wait arbitrarily long (up to `SESSION_MAX_AGE_DAYS`), change the account's password (once S-09 exists), role or verification tier, and repeat step 2 from another machine with any `User-Agent`/IP → still `authenticated: true` with the *new* privileges, because roles are re-read per request. The stolen session never loses access.
4. Only `POST /api/auth/logout` with that exact cookie ends it — and the legitimate owner has no way to revoke a session they cannot see.

### V2 — No idle expiration (High)

`expiresAt` is fixed at creation. A session left unattended on a shared or stolen laptop stays usable for the full window; nothing distinguishes an active session from an abandoned one.

Reproduction: sign in, make no further requests for 29 days (`expiresAt` remains in the future), then request `/api/auth/me` → `authenticated: true`. Directly observable without waiting by reading the row: `expiresAt - createdAt = SESSION_MAX_AGE_DAYS` regardless of use, and there is no `lastUsedAt` column at all.

### V3 — No absolute-lifetime hardening and no configuration bounds (Medium)

`sessionTtlMs()` accepts any finite positive number of days. `SESSION_MAX_AGE_DAYS=3650` yields a ten-year session; a fractional value yields a fractional day. There is no cap and no maximum enforced in code or deployment config (`.env.production.example` ships `30`). The absolute deadline is also the *only* deadline, so V2's idle requirement cannot be expressed at all.

### V4 — Login does not invalidate a pre-existing session (Medium; fixation-adjacent)

`POST /api/auth/login` always mints a new session and never revokes the token presented in the request. Tokens are server-generated, so classic session fixation (attacker chooses the identifier) is not directly exploitable today — but if a token is planted in a victim's browser by any means, signing in does not clear it, and the planted token remains valid alongside the fresh one.

Reproduction: with a valid `sf_session` cookie for victim A, log in again; count `Session` rows for A → the old row is still unrevoked and still authenticates.

### V5 — Privilege changes do not revoke sessions (Medium)

`grantRole`, `ensureRole`, supplier-profile role grant, and `setVerificationTier` change authorisation with no session effect. Permissions do refresh (roles are read per request, which is good), but a stolen or abandoned session keeps the *account's current* privileges indefinitely, and there is no signal that a privilege change happened mid-session.

Reproduction: sign in as an ordinary account in two browsers; activate RESELLER in browser 1 (`POST /api/profile/roles`); browser 2's session immediately has the new role and is never asked to re-authenticate. Elevate a victim's tier as platform admin; the victim's session continues without rotation.

### V6 — No session inventory or "sign out everywhere" (Medium)

There is no way to see or revoke other sessions. `logout` affects one token. A user who suspects compromise has only "change password", which (when S-09 lands) will not revoke anything either, because no password-change hook exists.

Reproduction: sign in three times (three browsers); only the current one can be ended; the other two rows remain `revokedAt = NULL` with no UI or API to reach them.

### V7 — Sessions accumulate without bound (Low)

Every login/registration inserts a row; expired and revoked rows are never deleted, and no maintenance job exists (`scripts/` contains no pruning). On SQLite this is a slow table/file growth and an ever-larger forensic surface.

Reproduction: log in 100 times → 100 `Session` rows; none are ever removed after expiry.

### Not vulnerabilities (verified, to avoid over-correcting)

- Token entropy is adequate (32 random bytes) and stored only as a salted SHA-256 hash; a database leak cannot be replayed.
- Cookie flags are correct (`httpOnly`, `SameSite=Lax`, `Secure` in production, `Path=/`).
- All JSON responses are `private, no-store`.
- Permissions are never cached in the cookie or session row, so role removal takes effect on the next request.
- Disabled users are rejected (`user.disabledAt`) without needing session revocation.

---

## 4. Proposed lifecycle rules and exact defaults

| Rule | Proposed value | Rationale |
|---|---|---|
| Absolute lifetime | **30 days** (`SESSION_MAX_AGE_DAYS`, default unchanged), clamped to **1–90**; non-integer/invalid falls back to 30 and logs a warning | Preserves today's behaviour while bounding a misconfiguration; no product decision needed to keep 30 |
| Idle timeout | **7 days** (`SESSION_IDLE_DAYS`, default 7, clamped 1–30, never greater than absolute) | Long enough for a weekly-returning reseller, short enough that an abandoned device stops working |
| Activity refresh | `lastUsedAt` updated at most once per **5 minutes** per session (conditional `updateMany`) | One write per 5 min per active session instead of one per request; keeps SQLite contention negligible |
| Rotation on login | Always issue a new token; **revoke any session presented in the login request** (if the cookie resolves) | Closes V4 without changing the happy path |
| Rotation on privilege change | Revoke **all** sessions of the affected user; the acting user's session is re-issued in the same response (`Set-Cookie`) | Closes V5; avoids logging the actor out mid-request |
| Password change (future S-09) | Revoke all sessions of that user, then issue a fresh one | Hook point defined now; no flow added in S-14 |
| Reuse detection | **Deferred, flagged below** | Requires rotation families/grace and has real false-positive risk across tabs |
| Session inventory | `GET /api/auth/sessions`, `DELETE /api/auth/sessions/[id]`, `POST /api/auth/sessions/revoke-others` | Smallest surface that satisfies V6; API only, no UI in S-14 |
| Pruning | Delete rows that are revoked **or** expired for more than 30 days, opportunistically at login (bounded, e.g. ≤50 per call) and via a documented maintenance command | No scheduler exists in this deployment; bounded deletes avoid a long lock |

Decision on "the acting user's session is re-issued": for `POST /api/profile/roles` the actor and target are the same account, so the route must return a fresh cookie after revocation. For admin-driven tier changes the actor is different, so their session is untouched.

## 4.1 Requirement-by-requirement analysis

**1. Rotation / fixation / replay.**
*Current:* new token per login, no rotation, no fixation defence, no replay detection.
*Vulnerability:* V1, V4 — a captured token is usable for the full window; a planted cookie survives login.
*Proposal:* rotate on login (revoke the presented session first), rotate on privilege change, and on logout keep current behaviour. Replay detection (revoked-token reuse ⇒ revoke that user's sessions + audit `session.reuse_detected`) is **proposed but flagged for approval**, because a legitimate stale tab or double-submit can trigger it.
*Files:* `src/lib/auth/session.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/register/route.ts`, `src/app/api/auth/logout/route.ts`.

**2. Idle expiration.**
*Current:* none (no `lastUsedAt`).
*Vulnerability:* V2.
*Proposal:* add `lastUsedAt` (default `now()`), reject when `now − lastUsedAt > SESSION_IDLE_DAYS`, refresh at most every 5 minutes. The browser cookie keeps its absolute `expires` (server-rendered pages cannot re-set a cookie), so idle expiry is enforced server-side; an expired idle session gets the same `authenticated: false`/401 as an expired one.
*Files:* `src/lib/auth/session.ts`, `prisma/schema.prisma`, one additive migration.

**3. Absolute expiration.**
*Current:* exists (`expiresAt`), but unbounded configuration and no independent idle clock.
*Proposal:* keep `expiresAt` as the absolute deadline; clamp `SESSION_MAX_AGE_DAYS` to 1–90; never extend `expiresAt` on activity (only `lastUsedAt` moves). Cookie expiry stays equal to `expiresAt`.
*Files:* `src/lib/auth/session.ts`, `.env.example`, `.env.production.example`, `README.md` (documentation only).

**4. Revocation on security-sensitive change.**
*Current:* only logout; no password-change flow exists.
*Proposal:* `revokeUserSessions(userId, { exceptId? })`; call it from `grantRole`, `ensureRole` (only when a role is actually added), supplier role grant, and `setVerificationTier`; expose the hook that S-09 will call after a password change. Nothing revokes on read-only events.
*Files:* `src/lib/auth/session.ts`, `src/server/supplier.ts`, `src/server/accounts.ts`, `src/app/api/profile/roles/route.ts`, `src/app/api/admin/profiles/[id]/verification/route.ts`.

**5. Device/session management.**
*Current:* none.
*Proposal (smallest safe):* three endpoints — list own sessions (id, `createdAt`, `lastUsedAt`, `userAgent`, `ipHash`, `current`), revoke one own session by id (404 for someone else's id), revoke all except the current session. All scoped by `user.sub` server-side, never by a client-supplied user id, `private/no-store`, and state-changing calls already covered by the S-13 origin check. No UI in S-14; that is a product decision (below).
*Files:* `src/lib/auth/session.ts`, `src/app/api/auth/sessions/route.ts` (new), `src/app/api/auth/sessions/[id]/route.ts` (new), `src/app/api/auth/sessions/revoke-others/route.ts` (new).

---

## 5. Database changes and migration strategy

One additive change:

```prisma
model Session {
  // …
  lastUsedAt DateTime @default(now())
  @@index([userId, lastUsedAt])
}
```

Migration strategy:
1. Add the column with `DEFAULT CURRENT_TIMESTAMP` so SQLite can populate existing rows in one statement.
2. **Backfill `lastUsedAt = now()` for existing rows** (not `createdAt`). Choosing `createdAt` would instantly invalidate every session older than the idle window at deploy time — an unannounced mass sign-out. Starting the idle clock at deploy means nobody is logged out by the migration, at the cost of one extra idle window for pre-existing sessions.
3. Keep `expiresAt` and the `(expiresAt)` index; no data deletion, no column rename, no token re-hash.
4. No other table changes. Rotation needs no new columns unless reuse detection is approved (then a nullable `rotatedFromId`/`familyId` would be added in a **second** migration, reviewed separately).

Rollback: the column is additive and ignored by the current code, so a code rollback is safe without a destructive down-migration.

---

## 6. Backward compatibility and existing-session handling

- **Token format and hashing are unchanged**, so every cookie issued before the change keeps working until its absolute `expiresAt` (subject to the backfilled `lastUsedAt`).
- **Cookie name/flags unchanged**; only the value changes when a session rotates. No client code reads the cookie (it is `httpOnly`), so rotation is invisible to the React app.
- **Existing sessions are not revoked by the migration.** Sessions already past their absolute expiry stay invalid exactly as today; they will be pruned opportunistically.
- **`/api/auth/me` contract unchanged** (`authenticated: false` for any invalid session, including idle-expired).
- **Deployment config**: `SESSION_MAX_AGE_DAYS` keeps its meaning and default; the new `SESSION_IDLE_DAYS` is optional with a default, so existing `.env.production` files remain valid.
- **Clients in flight during rotation**: a tab that submits a request with the pre-rotation token after a privilege change gets 401 and must re-authenticate. Mitigated for the actor because their cookie is re-issued in the response; not mitigated for other devices, which is the intended security outcome.

---

## 7. Test plan (isolated harness only)

All tests run inside `scripts/test-e2e-clean.mjs` / `scripts/verify-api.mjs` against the temporary database; the shared `prisma/dev.db` is untouched and its fingerprint is verified before and after.

| # | Test | Assertion |
|---|---|---|
| 1 | Absolute expiry | Set `expiresAt` in the past via Prisma; `/api/auth/me` → `authenticated: false`; cookie still cleared/ignored |
| 2 | Activity cannot extend the absolute deadline | Make requests; `expiresAt` unchanged in the row |
| 3 | Idle expiry | Backdate `lastUsedAt` beyond `SESSION_IDLE_DAYS`; request → unauthenticated; backdate within the window → authenticated |
| 4 | Idle refresh is throttled | Two requests <5 min apart produce one `lastUsedAt` write (compare timestamps) |
| 5 | Rotation on login | Login again with an existing cookie; old token rejected, new token accepted, cookie value differs |
| 6 | Fixation defence | Present a valid token to `POST /api/auth/login`; that token is revoked afterwards and cannot be used from another client |
| 7 | Revocation on self role change | Activate RESELLER; pre-change cookie rejected, response cookie authenticates with the new role |
| 8 | Revocation on tier change | Admin elevates target's tier; target's pre-change session rejected, admin's session still valid |
| 9 | Logout scope | Logout revokes only the presented session; a second session of the same user still authenticates |
| 10 | Session listing isolation | User A sees only A's sessions; B cannot revoke A's session id (404/403) and A's session survives |
| 11 | Revoke-others | Leaves exactly the current session valid; all others revoked |
| 12 | Concurrent requests | Two parallel authenticated requests with the same valid token both succeed (no 500, no self-revocation); parallel requests straddling rotation are handled deterministically |
| 13 | Cookie invariants preserved | `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, `Max-Age=0` on logout (existing S-05 checks must still pass) |
| 14 | Expired/revoked rows cannot authenticate from another account | Cross-account token swap → unauthenticated |
| 15 | Pruning bounded and correct | Old revoked/expired rows removed, fresh and active rows kept |
| 16 | No-store on session endpoints | Session list/revoke responses carry `Cache-Control: private, no-store` |

A test is only accepted if it fails before the corresponding change and passes after — the tests-first discipline used for S-01…S-13 and S-15. Live verification also re-runs the full harness (`api` + `pwa`), typecheck, and the build.

---

## 8. Risks and unresolved product decisions

**Risks**
1. **Write amplification** from `lastUsedAt`: mitigated by the 5-minute throttle, but every active session still writes; on SQLite with many users this is the main performance risk and should be measured in the harness.
2. **Multi-tab rotation races**: rotating a token invalidates copies held by other tabs; unless a grace window exists, the next request from a stale tab 401s. This is the strongest argument for deferring reuse detection and for keeping rotation to login/privilege events, not every request.
3. **Mass sign-out on deploy** if the backfill uses `createdAt`; avoided by backfilling `now()`, but that weakens idle enforcement for pre-existing sessions for one window.
4. **Privilege-change rotation changes behaviour**: a reseller activating RESELLER keeps working (cookie re-issued), but other devices are signed out without an explanation screen. Product-visible.
5. **Timestamp trust**: idle expiry depends on the app server clock; no monotonic guarantee across containers.
6. **Session endpoints expand attack surface**: they must be strictly owner-scoped; the plan uses the authenticated profile's own id and never a client-supplied user id.
7. **No scheduler** for pruning; opportunistic deletes must stay bounded or they will lock SQLite during login.
8. **Password-change revocation cannot be completed in S-14** because no password-change flow exists; only the hook is prepared.

**Product decisions requiring review (not invented here)**
- **A. Idle timeout value.** Proposed 7 days with absolute 30. Alternative: 14 days idle, 30 absolute (fewer surprise sign-outs, more exposure).
- **B. Should absolute lifetime be shortened** from 30 days (e.g. 14) for a marketplace handling money? This changes user experience and is the owner's call.
- **C. Should a privilege change force full re-authentication** on the changed device, or re-issue silently (proposed: silently for the actor, forced for other devices)?
- **D. Is a device-management UI in scope**, or is the API sufficient for S-14? Proposed: API only.
- **E. Is reuse detection wanted** (revoked-token reuse revokes the whole account's sessions)? Proposed: defer; it needs a grace design and risks false positives.
- **F. "Remember me" / sliding browser cookie**: not implemented; the cookie keeps the absolute deadline. Confirm that idle sliding *without* browser-cookie refresh is acceptable (server rejects; browser just carries a stale cookie until absolute expiry).
- **G. Pruning policy**: opportunistic-at-login vs a documented operator command vs both.

---

## 9. Confirmation

- **No application code was modified.** Only this report was written. `git status` shows the same modified/untracked set as before the inspection (pre-existing work from earlier tasks); no source, schema, migration, script, config or test file was edited in this task.
- **No migration was created or applied.**
- **The shared database was not opened for writing and was not reset.** `sha256sum prisma/dev.db` before and after inspection: `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`, 589,824 bytes, mtime `1793746202` — identical.
- **No server was started, stopped or restarted**, and no preview process was touched.
- **Phase 0 validation remains incomplete.** This inspection does not claim that any security area is pilot-safe.

**Stopping here as instructed. Awaiting review and approval of the inspection findings, the proposed defaults (30-day absolute, 7-day idle, 5-minute activity throttle) and decisions A–G before any implementation begins.**
