# SellFlow — Stage 2, Task 8: S-14 Session Lifecycle Security — Implementation Report

**Date:** 2026-11-05
**Scope:** S-14 only. S-09, S-07 follow-ups, billing/subscriptions/C-03 and every other finding were not touched. No password reset or password change was added. No device-management UI was built.
**Status:** Implemented and verified. Phase 0 remains incomplete; nothing here claims the product is pilot-safe.

---

## 1. Approved policy, implemented as specified

| Rule | Implemented value |
|---|---|
| Absolute lifetime | 30 days (`SESSION_MAX_AGE_DAYS`), clamped **1–90**; invalid values fall back to 30 |
| Idle lifetime | **7 days** (`SESSION_IDLE_DAYS`), clamped 1–30 and never longer than the absolute lifetime |
| Activity refresh | `lastUsedAt` written at most once per **5 minutes** |
| Rotation | On login (retires the token presented with that login) and on every security-sensitive privilege change |
| Revocation after privilege change | All sessions of the affected account are revoked; the acting user receives a freshly issued session in the same response |
| Inventory | Owner-scoped list + revoke-one + revoke-others |
| Device UI | Excluded |
| Reuse detection | Deferred, as approved |
| Cleanup | Bounded, opportunistic on sign-in |
| Password-change hook | Not applicable: **no password-change flow exists**; the revocation primitive is ready for S-09 |

---

## 2. What changed

### 2.1 Schema and migration (additive only)

```prisma
lastUsedAt DateTime @default(now())
@@index([userId, lastUsedAt])
```

`prisma/migrations/20261105060000_session_lifecycle/migration.sql`:

```sql
ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt");
```

**Backfill decision:** `DEFAULT CURRENT_TIMESTAMP` stamps existing rows with the
migration moment — deliberately *not* `createdAt`. Sessions therefore survive the
deploy: nobody is silently signed out because their session happens to be older
than the idle window. The idle clock starts at deploy for pre-existing rows, which
is the trade-off documented in the inspection report. No column removed, renamed
or re-hashed; `expiresAt` and its index are untouched.

### 2.2 `src/lib/auth/session.ts`

- `sessionTtlMs()` — clamps `SESSION_MAX_AGE_DAYS` to 1–90 (integer days).
- `sessionIdleMs()` — clamps `SESSION_IDLE_DAYS` to 1–30 and to at most the absolute lifetime.
- `startSession()` — records `lastUsedAt` alongside `createdAt`.
- `getAuthContext()` — rejects revoked, absolutely expired, **idle-expired**, disabled
  and profile-less sessions; refreshes `lastUsedAt` with a conditional
  `updateMany` (only when the stored value is older than the 5-minute window), so
  parallel requests cannot race into repeated writes. A failed refresh is logged
  and does not sign the user out. Activity never extends `expiresAt`.
- `rotateSessionForUser(userId, meta)` — revokes every live session of the account,
  then issues a replacement. Called only after the underlying write has committed.
- `sessionMeta(request)` — user-agent + validated IP for the replacement session.
- `AuthContext` now carries `sessionId`, which the inventory endpoints use for
  "current" and for owner-scoped revocation.

### 2.3 `src/lib/auth/revocation.ts` (new)

`revokeSessionByToken`, `revokeAllSessionsForUser`, `revokeOtherSessionsForUser`,
`revokeOwnedSession`, `listSessionsForUser`, `pruneSessions(limit = 50)`. Every
function is scoped by a server-derived id; none accepts a client-supplied account.
`listSessionsForUser` selects metadata only — never `tokenHash` or a token.

### 2.4 Privilege-change wiring

| Flow | Behaviour |
|---|---|
| `POST /api/auth/login` | Retires the cookie presented with the login, then issues a new session; runs bounded cleanup afterwards |
| `POST /api/profile/roles` (self RESELLER) | Revokes all own sessions, issues a fresh cookie on the response |
| `POST /api/supplier/profile` (activates SUPPLIER) | Same rotation, cookie applied after the profile commits |
| `PATCH /api/admin/profiles/{id}/verification` | `setVerificationTier` revokes the affected account's sessions; if the admin elevated their own profile, the route issues them a replacement cookie |
| `decideApplication` (supplier approves a reseller) | Revokes the applicant's sessions after the decision commits |

Replacement cookies are always set on a response whose underlying write has
already resolved — no cookie is issued before a commit.

### 2.5 Session management API (new)

| Endpoint | Behaviour |
|---|---|
| `GET /api/auth/sessions` | The caller's live sessions: `id`, `createdAt`, `lastUsedAt`, `expiresAt`, `userAgent`, `ipHash`, `current`. No token material |
| `DELETE /api/auth/sessions/{id}` | Revokes one **owned** session; another account's id returns 404. Revoking the current session clears the cookie (sign-out) |
| `POST /api/auth/sessions/revoke-others` | "Sign out everywhere": revokes every session except the current one, which stays valid |

All three inherit the S-13 same-origin check for state-changing methods and
`private, no-store` caching.

---

## 3. Tests first: 24 assertions, 15 failing before the change

Added to `scripts/verify-api.mjs` before the S-12 block, against the isolated
harness database only.

**Recorded before the implementation** (`--skip-build`, unmodified app):

```
harness_exit=1
pass=392 fail=15

FAIL  the Session table carries lastUsedAt and the idle index (S-14) — column missing
FAIL  a pre-migration session row is backfilled, not invalidated (S-14) — insert or column missing
FAIL  a session idle for longer than 7 days stops authenticating (S-14) — lastUsedAt column missing
FAIL  a session active within the idle window still authenticates (S-14) — lastUsedAt column missing
FAIL  activity does not rewrite lastUsedAt more often than every 5 minutes (S-14) — lastUsedAt column missing
FAIL  activity older than the throttle window refreshes lastUsedAt (S-14) — lastUsedAt column missing
FAIL  signing in revokes the session token presented with the login (S-14) — status 200, old cookie presented
FAIL  activating a role revokes the old session and issues a fresh one (S-14) — status 200, old cookie still valid
FAIL  the replacement session carries the new role (S-14) — null
FAIL  a tier change revokes every session of the affected account (S-14) — status 200, target cookie still valid
FAIL  the session inventory lists the caller's own sessions only (S-14) — status 404, 0 sessions
FAIL  the session inventory marks exactly one current session (S-14) — 0 current
FAIL  sign out everywhere keeps the current session and ends the rest (S-14) — status 404
FAIL  revoking the current session signs the caller out and clears the cookie (S-14) — status 404, cookie none
FAIL  cleanup removes long-dead sessions and keeps live ones (S-14) — lastUsedAt column missing
```

Guard-rail checks passed first time and still pass: absolute expiry, logout scope,
the administrator staying signed in through another account's tier change, and six
concurrent authenticated reads.

**After the implementation:** all 24 S-14 assertions pass, including:

```
PASS  the Session table carries lastUsedAt and the idle index (S-14) — column present, indexes Session_userId_lastUsedAt_idx,…
PASS  a pre-migration session row is backfilled, not invalidated (S-14) — lastUsedAt Thu Nov 05 2026 02:23:33 …
PASS  an absolutely expired session stops authenticating (S-14)
PASS  a session idle for longer than 7 days stops authenticating (S-14)
PASS  a session active within the idle window still authenticates (S-14)
PASS  activity does not rewrite lastUsedAt more often than every 5 minutes (S-14)
PASS  activity older than the throttle window refreshes lastUsedAt (S-14)
PASS  signing in revokes the session token presented with the login (S-14)
PASS  the replacement session authenticates and the cookie changed (S-14)
PASS  a rotated session cookie keeps HttpOnly, SameSite=Lax and Path=/ (S-14)
PASS  activating a role revokes the old session and issues a fresh one (S-14)
PASS  the replacement session carries the new role (S-14) — ["BUSINESS_OWNER","RESELLER"]
PASS  a tier change revokes every session of the affected account (S-14)
PASS  a tier change leaves the acting administrator signed in (S-14)
PASS  logging out ends only the presented session (S-14)
PASS  the session inventory lists the caller's own sessions only (S-14) — 1 sessions
PASS  the session inventory exposes no token material (S-14)
PASS  the session inventory marks exactly one current session (S-14)
PASS  one account cannot revoke another account's session (S-14) — status 404
PASS  sign out everywhere keeps the current session and ends the rest (S-14)
PASS  revoking the current session signs the caller out and clears the cookie (S-14)
PASS  concurrent authenticated requests do not invalidate the session (S-14) — 6/6
PASS  cleanup removes long-dead sessions and keeps live ones (S-14) — 0 stale rows remain
```

---

## 4. Required evidence

### Migration and backward compatibility

- `[harness] applying migrations to the temp database` lists
  `20261105060000_session_lifecycle` among six migrations; the schema applied
  cleanly to a fresh database.
- The legacy-row assertion inserts a session row **without** `lastUsedAt`
  (the pre-migration shape) and finds a non-null value afterwards — proving the
  `DEFAULT` backfills rather than invalidating.
- No existing token format, hash, cookie name or table was changed, so sessions
  issued before the deploy remain valid (subject to the new idle clock).

### Session lifecycle and concurrency

- Idle: 8 days inactive refuses, 2 days inactive authenticates.
- Absolute: expired `expiresAt` refuses regardless of activity; activity updates
  `lastUsedAt` only, never `expiresAt`.
- Throttle: two immediate reads leave `lastUsedAt` byte-identical; a read after
  >5 minutes refreshes it.
- Concurrency: six parallel authenticated requests all return
  `authenticated: true` — ordinary reads never rotate or revoke.
- Rotation is limited to login and privilege changes, so no request race can
  invalidate a session by accident; the conditional `lastUsedAt` update is
  atomic, and a failed refresh is logged without affecting authentication.

### Ownership and revocation

- Inventory returns only the caller's sessions and marks exactly one current.
- Another account's session id returns 404 and leaves the victim's session valid.
- Revoke-others ends the other session and keeps the current one.
- Deleting the current session returns `Max-Age=0` and the cookie stops
  authenticating.
- Logout remains scoped to the presented session.
- No endpoint returns token hashes or token values.

### Regression results for existing authentication

- S-05 checks (cookie flags, `Secure` under `EXPECT_SECURE_COOKIE=1`, IP hashing,
  logout revocation) all pass.
- S-07, S-10 and S-11 pass after their probes adopt the rotated cookie (see §5).
- Absolute expiry of a stolen-but-expired token, cross-account isolation and the
  starter-canary isolation checks all still pass.

### Typecheck, build, full suite

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| Production build | succeeded in the preceding full harness run (the same `src` build was reused for the final `--skip-build` pass) |
| API assertions | **454 / 454** |
| PWA assertions | **31 / 31** |
| Total | **485 PASS / 0 FAIL**, harness `PASSED in 230.1s`, `api=0, pwa=0` |
| Isolation | canary workspace + `/proc` `DATABASE_URL` both passed |

### Database fingerprint

| Before | After |
|---|---|
| `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182` | **identical** |
| 589,824 bytes, mtime `1793746202` | identical |

The shared database was never opened for writing; the new migration ran only
against the harness temp database. `npm run db:reset` was not used. Servers on
`:3000` (pid 2802) and `:4322` (pid 927563) were untouched; the stale `:4318`
preview was already gone before this task.

---

## 5. Changes to previously written tests (behaviour, not weakened assertions)

Rotation is a deliberate product behaviour, so probes that reused a pre-rotation
cookie had to adopt the replacement one. No assertion was loosened:

- **S-07** — after supplier-profile creation and after RESELLER activation, the
  probe uses the response cookie. The tier assertion changed from "reflected in
  the existing session" to "the old session is retired and the next sign-in shows
  tier 2 with the right label" — that is exactly the new, stronger behaviour.
- **S-10** — the unapproved and approved reseller probes adopt their rotated
  cookies; after supplier approval (which grants RESELLER) the applicant signs in
  again before continuing.
- **S-11** — the probe reseller adopts its rotated cookie and re-authenticates
  after approval; the "stranger" supplier profile creation rotates `strangerCookie`,
  which the later S-01 dispute probes now reuse.

---

## 6. Limitations

1. **No reuse detection.** As approved, presenting a revoked token does not revoke
   the account's other sessions; a stolen token that was already rotated simply
   fails.
2. **No device-management UI.** The API is the deliverable; a settings page is a
   separate product decision.
3. **Sliding browser cookie is not refreshed.** The cookie keeps the absolute
   deadline; idle expiry is enforced server-side. A browser may still hold a
   cookie the server rejects — the next request returns 401 and the visitor signs
   in.
4. **Cleanup is opportunistic and bounded** (≤50 rows per sign-in). There is no
   scheduler in this deployment, so a very large backlog drains over several
   logins rather than in one sweep.
5. **Password-change revocation is only a primitive.** The `revokeAllSessionsForUser`
   hook exists, but S-09 owns the flow that must call it.
6. **Users are not told why a session ended.** A revoked/expired/idle session all
   surface as `authenticated: false`/401; no UI distinguishes them.
7. **Idle expiry relies on the app server clock**; clock skew between instances
   shifts the effective window.
8. **Session listing discloses metadata** (user agent, truncated IP hash) to the
   owner only; no raw IP or token is exposed.
9. **Phase 0 remains incomplete.** S-09 and the rest of the backlog remain open.

---

## 7. Changed files

| File | Change |
|---|---|
| `prisma/schema.prisma` | `Session.lastUsedAt`, `@@index([userId, lastUsedAt])` |
| `prisma/migrations/20261105060000_session_lifecycle/migration.sql` | Additive column + index, `DEFAULT CURRENT_TIMESTAMP` backfill |
| `src/lib/auth/session.ts` | Clamped lifetimes, idle check + throttled refresh, `sessionId` in `AuthContext`, `rotateSessionForUser`, `sessionMeta` |
| `src/lib/auth/revocation.ts` | **new** — revocation/inventory/pruning primitives |
| `src/app/api/auth/login/route.ts` | Retire the presented token, rotate, bounded cleanup |
| `src/app/api/auth/sessions/route.ts` | **new** — inventory |
| `src/app/api/auth/sessions/[id]/route.ts` | **new** — revoke one owned session |
| `src/app/api/auth/sessions/revoke-others/route.ts` | **new** — sign out everywhere |
| `src/app/api/profile/roles/route.ts` | Rotate after role activation |
| `src/app/api/supplier/profile/route.ts` | Rotate after SUPPLIER activation |
| `src/app/api/admin/profiles/[id]/verification/route.ts` | Rotate when the admin elevated their own profile |
| `src/server/accounts.ts` | `setVerificationTier` revokes the affected account's sessions |
| `src/server/supplier.ts` | `decideApplication` revokes the applicant's sessions |
| `scripts/verify-api.mjs` | 24 S-14 assertions; rotated-cookie adoption in S-07/S-10/S-11 probes |
| `STAGE2_TASK8_S14_REPORT.md` | This report |

Not changed: billing/subscriptions/entitlements/C-03, password recovery or change,
email verification, unrelated authorisation behaviour, deployment scripts,
`prisma/dev.db`.

**S-14 complete. Stopping here; no other finding was started.**
