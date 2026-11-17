# S-14 Acceptance Findings — Stage 2 Task 8 (Authorized Read-Only Investigation)

**Finding:** S-14 — Session Lifecycle Security  
**Stage:** 2 — Task 8  
**Investigation type:** Authorized, read-only implementation + evidence investigation  
**Date:** 2026-11-10  
**Authorization boundary:** Read-only on real project state and `prisma/dev.db`. Safe isolated disposable checks only where relevant. No source edits, no schema edits, no migration edits, no new migrations, no test edits, no env edits, no build, no server start, no protected database modification.

---

## 1. Current baseline

- **Branch:** `main`
- **Current commit:** none verifiable in this environment — `git rev-parse HEAD` failed with `fatal: Needed a single revision`. The repository currently has unstaged/untracked state only; no commit was resolved on `HEAD`.
- **Working tree:** heavily populated with committed-looking project files on disk, plus many `??` untracked files including the Stage 2 reports and this investigation's working files.
- **Protected database:** `prisma/dev.db` — treated as read-only. It was not opened in writable mode, not migrated, not seeded, not reset, not touched by any application command. Its fineness relative to prior recorded hashes is covered separately below and is not asserted as reconciled.

**Baseline conclusion:** The environment does not present a clean committed `HEAD` for S-14. Acceptance must therefore rely on on-disk implementation and retained evidence, not a clean `git checkout` snapshot.

---

## 2. Files inspected

### 2.1 State / scope / plan documents
- `STATE.md`
- `PHASE0_READINESS_REPORT.md`
- `VALIDATION_PLAN.md`
- `SELLFLOW_V02_AUDIT_REPORT.md`
- `STAGE1_ARCHITECTURE_REPORT.md`

### 2.2 S-14 documentation and evidence
- `STAGE2_TASK8_S14_REPORT.md`
- `STAGE2_TASK8_S14_FINAL_ACCEPTANCE_REPORT.md`
- `STAGE2_S09_S14_MIGRATION_PROVENANCE_REPORT.md`

### 2.3 S-14 implementation files
- `prisma/schema.prisma`
- `prisma/migrations/20261105060000_session_lifecycle/migration.sql`
- `src/lib/auth/session.ts`
- `src/lib/auth/revocation.ts`
- `src/lib/auth/identifiers.ts`
- `src/lib/auth/client-ip.ts`
- `src/lib/auth/throttle.ts`
- `src/lib/auth/rbac.ts`
- `src/lib/api.ts`
- `src/lib/enums.ts`
- `src/lib/validation.ts`
- `src/lib/db.ts`
- `src/lib/audit.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/sessions/route.ts`
- `src/app/api/auth/sessions/[id]/route.ts`
- `src/app/api/auth/sessions/revoke-others/route.ts`
- `src/app/api/profile/roles/route.ts`
- `src/app/api/supplier/profile/route.ts`
- `src/app/api/admin/profiles/[id]/verification/route.ts`
- `src/app/api/marketplace/applications/route.ts`
- `src/server/accounts.ts`
- `src/server/supplier.ts`
- `src/lib/subscription.ts`
- `src/lib/customer-visibility.ts`
- `next.config.ts`
- `package.json`

### 2.4 Not inspected this pass (out of scope / explicitly excluded)
- Any non-auth/non-session source unrelated to S-09 or S-14.
- Billing / entitlements / C-03.
- S-12, S-13, S-15 implementation files beyond incidental compatibility observations.
- S-09 implementation files except where they reuse S-14 primitives.
- Any workspace outside `/home/binpharees/Documents/SellFlow-Bootcamp-v2`.

---

## 3. Protected database status and isolation evidence

### 3.1 `prisma/dev.db` — protected file, read-only posture
- Path: `prisma/dev.db`
- Disposition this turn: **not modified**.
- No migration, seed, reset, endpoint call, build, or server command targeted it.
- No writable/sqlite-mutation access was attempted.

### 3.2 Database discrepancy note — unresolved
Two different `prisma/dev.db` SHA-256 values are present in retained evidence:
- `81e7572541e23d5ac9a62b12e23a98fe5ba736463222fae0c7fdf8cc27b073d2`
- `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`

Both appear in retained reports/evidence artifacts referenced in the current workspace context. The discrepancy itself was **not resolved** in this turn, and no attempt was made to force, reconcile, or reproduce either value on the protected database.

**This is relevant to S-14 acceptance only as an evidence-quality caveat:** some retained S-14 evidence references an older protected-database fingerprint than the one currently observed on disk. That does not directly change the code review below, but it means a subset of older "database unchanged" assurances cannot be assumed to match the current protected file without separate verification.

### 3.3 Disposable isolation evidence
This investigation did **not** run `prisma migrate deploy`, `prisma db execute`, seed, build, server, or HTTP tests this turn.

S-14 disposable isolation is established by **retained evidence**, not by fresh execution:
- `STAGE2_TASK8_S14_FINAL_ACCEPTANCE_REPORT.md` records a prior fresh isolated E2E run with 500 PASS / 0 FAIL / 0 SKIP, typecheck exit 0, and production build exit 0.
- The same report records `prisma/dev.db` fingerprint unchanged before and after that prior run.

**Acceptance caveat:** S-14 was accepted on prior retained evidence, but no fresh disposable E2E rerun was performed this turn, so the current investigation does not independently reproduce the runtime results.

---

## 4. S-14 implementation status

### 4.1 Schema and migration
- `Session.lastUsedAt` exists in `prisma/schema.prisma`.
- `@@index([userId, lastUsedAt])` exists in `prisma/schema.prisma`.
- Migration `prisma/migrations/20261105060000_session_lifecycle/migration.sql` contains:
  - `ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`;
  - `CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt")`.
- The same migration file also contains `PasswordResetToken` DDL, which is S-09, not S-14.

### 4.2 Session lifecycle primitives
- `sessionTtlMs()` clamps `SESSION_MAX_AGE_DAYS` to 1–90 days.
- `sessionIdleMs()` clamps `SESSION_IDLE_DAYS` to 1–30 days and to at most the absolute lifetime.
- `startSession()` records `lastUsedAt` alongside `createdAt`.
- `getAuthContext()` rejects revoked, absolutely expired, idle-expired, disabled, and profile-less sessions; refreshes `lastUsedAt` at most once every 5 minutes via a conditional `updateMany`; never extends `expiresAt`.
- `rotateSessionForUser()` revokes every live session of the account then issues a replacement.
- `sessionMeta()` captures user-agent and validated IP.

### 4.3 Revocation and inventory primitives
- `revokeSessionByToken()`
- `revokeAllSessionsForUser()`
- `revokeOtherSessionsForUser()`
- `revokeOwnedSession()`
- `listSessionsForUser()` — metadata only, no token material
- `pruneSessions()`

### 4.4 Auth route behavior
- `POST /api/auth/login`: revokes the presented session before issuing a new one; applies the new session cookie after the new session is created.
- `GET /api/auth/sessions`: returns caller's own sessions only; marks exactly one current session; no token material.
- `DELETE /api/auth/sessions/{id}`: revokes one owned session only; another account's id returns 404; revoking current session clears cookie.
- `POST /api/auth/sessions/revoke-others`: revokes every session except the current one.
- `POST /api/profile/roles`: rotates session after successful role grant inside the transaction.
- `POST /api/supplier/profile`: rotates session after supplier activation when activation occurred; does not rotate on plain edit.
- `PATCH /api/admin/profiles/{id}/verification`: revokes affected account's sessions; rotates acting admin's session only when the admin elevated their own profile.

### 4.5 Domain service atomicity
- `src/server/supplier.ts`:
  - `ensureSupplierProfile()` and `grantRole()` use create-first concurrency with unique-constraint serialization;
  - `ensureRole()` returns `{ row, created: boolean }` so rotation happens only on a real privilege change;
  - `auditCritical()` is used so a failed audit write poisons the transaction and rolls back the privilege change and any rotation.
- `src/app/api/marketplace/applications/route.ts`: threads the transaction client into `submitApplication()` and rotates only when `roleGranted` is true.

### 4.6 Session cookie attributes
- `applySessionCookie()` sets:
  - `httpOnly: true`;
  - `sameSite: "lax"`;
  - `secure: process.env.NODE_ENV === "production"`;
  - `path: "/"`;
  - explicit `expires`.
- `clearSessionCookie()` sets `maxAge: 0` with the same flags.

---

## 5. S-14 requirement-by-requirement findings

### Session creation
- **Status: PASS — by code inspection.**
- Sessions are created only server-side via `startSession()` with a random base64url token, salted hash storage via `hashToken()`, and deterministic expiry.

### Session expiration
- **Status: PASS — by code inspection.**
- Absolute expiry: `expiresAt` set at creation and never extended.
- Idle expiry: `lastUsedAt` + `sessionIdleMs()` enforced in `getAuthContext()`.
- Both lifetimes are clamped on read from environment.

### Session rotation
- **Status: PASS — by code inspection.**
- Rotation occurs on login and on privilege changes via `rotateSessionForUser()`.
- Rotation is gated so it happens only on actual privilege changes (`created: boolean` pattern in `ensureRole()`), not on no-op re-grants.

### Logout behavior
- **Status: PASS — by code inspection.**
- Logout is scoped to the presented session via `revokeCurrentSession()`.
- Current-session revocation clears the cookie.

### Session revocation
- **Status: PASS — by code inspection.**
- `revokeAllSessionsForUser()`, `revokeOtherSessionsForUser()`, `revokeOwnedSession()`, and `revokeSessionByToken()` exist.
- Revocation is used atomically with privilege changes where required.

### Concurrent session handling
- **Status: PASS — by code inspection.**
- Account-scoped revocation and inventory primitives exist.
- Owner-scoped inventory and revoke-one/revoke-others endpoints exist.
- Idempotency/creation race handled by unique constraint serialization.

### Cookie security attributes
- **Status: PASS — by code inspection.**
- `httpOnly`, `sameSite: "lax"`, `secure` in production, `path: "/"`, and explicit expiry are set.

### Authentication middleware
- **Status: PASS — by code inspection.**
- `requireAuth()` / `getAuthContext()` enforce revoked/absent/expired/idle/disabled/profile-less checks.

### Replay and fixation protections
- **Status: PASS — by code inspection.**
- Token presented with login is revoked before new session is issued.
- Privilege changes rotate/revoke existing sessions.
- Stored token format uses salted hash, so a raw token is not reusable from DB read alone.

### Database consistency
- **Status: PASS — by code inspection.**
- Session state is derived from `Session` table with appropriate indexes.
- Atomic patterns use transaction clients where privilege changes and revocation must commit together.

### Race conditions
- **Status: PASS — by code inspection.**
- `lastUsedAt` refresh is conditional to avoid parallel-request write amplification.
- Privilege changes use create-first unique-constraint serialization and transactional atomicity.

### Relevant regression tests
- **Status: NOT RE-EXECUTED this turn.**
- Retained S-14 acceptance evidence from prior runs is the basis; this investigation did not rerun the E2E suite.

---

## 6. Phase 0 outstanding requirements

Phase 0 remains incomplete per the inspected documentation:

From `STATE.md` and `PHASE0_READINESS_REPORT.md`:
- Target market is Nigeria, but at least four business categories for the sample still need selection/recording.
- Competitor check is not done.
- Interview evidence: zero completed interviews recorded.
- Prototype commitments: zero dated commitments recorded.
- Concierge experiment: not completed.
- PRD v0.2 source text: still marked missing/source-gap in `PRD_V0.2.md`.
- Validation GO: not granted.
- Validation decision date: proposed 2026-12-11, still awaiting approval.

**Phase 0 conclusion:** Outstanding requirements are documentation/validation evidence items, not S-14 code items. Phase 0 is not satisfied by the current S-14 investigation.

---

## 7. Tests executed this turn

- **None.**
- No `npx tsc`, no `npx vitest`, no `npm run build`, no `prisma migrate` command, no seed, no server start, no HTTP integration run was executed this turn.
- All test conclusions below are based on prior retained evidence and current file inspection only.

---

## 8. Failed or missing security controls

### 8.1 No new S-14 defect found this turn
- Direct inspection of the S-14 implementation files did not surface a new defect.
- The design still matches the accepted S-14 model: creation, expiry, rotation, logout, revocation, concurrency, cookie attributes, middleware, replay/fixation mitigations, DB consistency, and race handling are all present.

### 8.2 Acceptance caveats
- S-14 was accepted on prior retained disposable E2E evidence; this turn did not rerun that suite.
- The protected `prisma/dev.db` fingerprint discrepancy means some older "DB unchanged" lines in retained S-14 evidence are not independently reconfirmed against the current on-disk file this turn.

---

## 9. Files modified

**None.**

This investigation modified no source file, schema, migration, test, config, env, script, seed, or database. No `prisma/dev.db` access was writable.

---

## 10. Recommended next steps

1. If a fresh S-14 confirmation is desired, rerun the retained disposable E2E pattern under the authorized boundary and capture typecheck, build, and isolated DB results.
2. Decide whether the protected `prisma/dev.db` fingerprint discrepancy should be resolved before reusing old "database untouched" assurances, or whether those older assurances should be labeled fingerprint-dependent.
3. No S-14 remediation is required based on this investigation.

---

## 11. Explicit protection statement

During this investigation:
- `prisma/dev.db` was not modified, migrated, restored, repaired, checkpointed, vacuumed, or opened in writable mode.
- No application command was run that could have modified `prisma/dev.db`.
- No migration, schema, env, package, source, or test file was changed.
- No billing, entitlements, C-03, S-12, S-13, or S-15 work was started or modified.
- No S-09 work was started this turn beyond reading S-09 files as context for S-14 reuse.

**No protected database and no unrelated functionality was touched.**
