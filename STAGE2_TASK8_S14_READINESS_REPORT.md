# S-14 Implementation-Readiness Review — Stage 2 Task 8

**Finding:** S-14 — Session Lifecycle Security
**Stage:** 2 — Task 8
**Review type:** Implementation-readiness investigation (read-only)
**Date:** 2026-11-09 (this review); implementation approved 2026-11-04 (D-019)
**S-14 implementation status:** Already implemented and accepted (2026-11-06)
**Purpose of this review:** Re-establish what remains outstanding for S-14, verify the current implementation against the finding, and prepare a safe implementation/verification plan for any remaining follow-up work. This review does **not** start S-09 or any other finding.

---

## Executive Summary

S-14 Session Lifecycle Security is **already implemented and accepted** (acceptance 2026-11-06). The 2026-11-04 audit finding described five verified weaknesses (V1–V5) plus two lower-severity issues (V6, V7) in the pre-implementation session architecture. The implementation addressed all of them except where explicitly deferred or gated on other work.

**Current state:** the session subsystem now has absolute expiry, idle expiry, rotation on login, rotation on every privilege change, an owner-scoped session inventory, bounded cleanup, and atomic privilege-change commits. The implementation was verified by 38 unique S-14 test assertions across lifecycle/idle/expiry, atomicity, audit durability, concurrency and inventory, plus the full 500-check suite (500 PASS, 0 FAIL, 0 SKIP) in the accepted isolated E2E run.

**This review’s conclusion:** S-14 has no outstanding remediation gap against the original finding. The remaining items are (a) deferred features that were never part of S-14, (b) a follow-up decision already flagged in the S-14 submit-application review, and (c) gaps that belong to other findings (S-09 password change, product UI decisions) and are correctly out of S-14 scope. Nothing in this review indicates that S-14 acceptance should be reopened.

**If implementation follow-up is authorized**, the only S-14-aligned change with a clear security motivation is the flagged follow-up: making sure the RESELLER-grant-on-submit path and any other privilege-grant path are consistently audited/rotated under the same pattern. That is a completeness/consistency item, not a fix for a demonstrated exploit, and it must be verified under the existing S-14 test discipline (tests first, isolated database, fingerprint preserved, no production DB change).

**Phase 0 remains incomplete.** S-14 acceptance is not validation approval and does not close Phase 0.

---

## 1. Current S-14 status

| Item | Status |
|---|---|
| Original finding | Verified and documented in `STAGE2_TASK8_S14_INSPECTION.md` (2026-11-05) |
| Implementation | Completed and reported in `STAGE2_TASK8_S14_REPORT.md` (2026-11-05) |
| Final security review (atomicity) | Completed in `STAGE2_TASK8_S14_FINAL_REVIEW.md` (2026-11-05) |
| Submit-application path review | Completed in `STAGE2_TASK8_S14_SUBMIT_APPLICATION_REVIEW.md` (2026-11-05) |
| Formal acceptance | 2026-11-06, `STAGE2_TASK8_S14_FINAL_ACCEPTANCE_REPORT.md` |
| Project state record | `STATE.md` marks S-14 Accepted (Stage 2 Task 8) |
| Authorizing decision | D-019 Implementation GO, 2026-11-04 |

S-14 is **not open**. This review does not reopen it. It re-confirms what was fixed, what was deferred, and what remains as follow-up or out-of-scope.

---

## 2. Exact files and functions involved

### Core session primitives
- `src/lib/auth/session.ts`
  - `sessionTtlMs()` — absolute lifetime, clamped 1–90 days
  - `sessionIdleMs()` — idle lifetime, clamped 1–30 and never beyond absolute
  - `hashToken()`, `clientIpHash()`, `sessionMeta()` — token + forensic metadata
  - `startSession(userId, meta, client?)` — creates a session row with `lastUsedAt`
  - `rotateSessionForUser(userId, meta, client?)` — revokes all live sessions, issues replacement
  - `applySessionCookie()`, `clearSessionCookie()` — cookie writes
  - `revokeCurrentSession()` — revokes the presented token only
  - `getAuthContext()` — resolves session, enforces revoked/absolute-expired/idle-expired/disabled/profile-missing, throttled `lastUsedAt` refresh
  - `requireAuth()` — throws 401 when no valid context
- `src/lib/auth/revocation.ts`
  - `revokeSessionByToken(tokenHash)`
  - `revokeAllSessionsForUser(userId, client?)` — revokes every live session of an account
  - `revokeOtherSessionsForUser(userId, currentSessionId)`
  - `revokeOwnedSession(userId, sessionId)`
  - `listSessionsForUser(userId)` — metadata-only inventory
  - `pruneSessions(limit?)` — bounded opportunistic cleanup

### Privilege-change service layer
- `src/server/supplier.ts`
  - `ensureSupplierProfile(profileId, workspaceId, input, client?)` — creates supplier profile; on creation activates SUPPLIER via `profileRole.create` + `auditCritical(...)`, returns `{ supplier, activated }`
  - `grantRole(profileId, role, actorProfileId, client?)` — create-first, unique-violation = already-existed, audits only on creation
  - `ensureRole(profileId, role, actorProfileId, client?)` — returns `{ row, created }`; used by submit-application path
  - `submitApplication(...)` — may grant RESELLER via `ensureRole`, returns `{ application, roleGranted }`
  - `decideApplication(...)` — on APPROVAL, revokes applicant’s sessions inside the transaction

### Privilege-change routes
- `src/app/api/profile/roles/route.ts` — `POST` grants role inside transaction with rotation
- `src/app/api/supplier/profile/route.ts` — `POST` creates supplier profile; rotates only when `activated`
- `src/app/api/admin/profiles/[id]/verification/route.ts` — `PATCH` tier change; target sessions revoked inside `setVerificationTier`; self-elevation rotates after commit
- `src/app/api/marketplace/applications/route.ts` — `POST` submit; rotates only when `roleGranted`
- `src/app/api/supplier/applications/[id]/route.ts` — approval route that calls `decideApplication`

### Session management endpoints
- `src/app/api/auth/sessions/route.ts` — `GET` inventory
- `src/app/api/auth/sessions/[id]/route.ts` — `DELETE` revoke one owned session
- `src/app/api/auth/sessions/revoke-others/route.ts` — `POST` sign-out-everywhere

### Login / logout / me
- `src/app/api/auth/login/route.ts` — throttling, `revokeCurrentSession()` before `startSession()`, audit, cookie, opportunistic prune
- `src/app/api/auth/logout/route.ts` — `revokeCurrentSession()`, audit, clear cookie
- `src/app/api/auth/me/route.ts` — returns `authenticated: false` rather than 401

### Supporting modules
- `src/lib/auth/identifiers.ts` — `SESSION_SECRET`, salted hash
- `src/lib/auth/client-ip.ts` — validated IP resolution
- `src/lib/auth/rbac.ts` — `requireAuth/requireRole/requireWorkspace/requireSupplier/requireReseller/requirePlatformAdmin/requireMediator`
- `src/lib/auth/password.ts` — hash/verify
- `src/lib/auth/throttle.ts` — login lockout
- `src/lib/audit.ts` — `auditCritical`, `auditHealth`, `AuditWriteError`, etc.
- `src/lib/enums.ts` — `ROLE`, `AUDIT`, etc.
- `src/lib/api.ts` — `route()`, `json()`, `private, no-store`, S-13 origin check for state-changing requests

### Schema / migration
- `prisma/schema.prisma` — `Session` model with `lastUsedAt`, indexes on `userId`, `[userId, lastUsedAt]`, `expiresAt`
- `prisma/migrations/20261105060000_session_lifecycle/migration.sql` — additive `lastUsedAt` column + index, `DEFAULT CURRENT_TIMESTAMP`

### Tests
- `scripts/verify-api.mjs` — S-14 block (lines ~4419–5110): lifecycle/idle/expiry checks, atomicity checks via `s14_block_revoke` trigger, audit-durability checks via `s14_abort_role_granted_audit` trigger, concurrency checks, inventory checks, cleanup check, S-12 health-before-S-14 probe
- `scripts/test-e2e-clean.mjs` — isolated harness entry point
- Prior run log: `/tmp/sf-s14-clean-final9.log` (accepted run, 500 PASS)

---

## 3. Confirmed security weaknesses (as found, and whether fixed)

### V1 — Stolen token valid for up to 30 days and survives every privilege change
**Status: Fixed.**
- Token rotated on login (`revokeCurrentSession()` then `startSession()` in login route).
- Token rotated on every privilege-granting operation (roles, supplier activation, tier change, application approval, first-time RESELLER grant on submit).
- `getAuthContext()` re-reads roles/tier/profile from the database every request, so even without rotation the privileges are current — but rotation now ends the old credential itself.

### V2 — No idle expiration
**Status: Fixed.**
- `lastUsedAt` column added; `getAuthContext()` rejects sessions idle longer than `SESSION_IDLE_DAYS` (default 7).
- `lastUsedAt` refreshed at most every 5 minutes via conditional `updateMany`.

### V3 — No absolute-lifetime cap / unbounded config
**Status: Fixed.**
- `sessionTtlMs()` clamps `SESSION_MAX_AGE_DAYS` to 1–90.
- `sessionIdleMs()` clamps `SESSION_IDLE_DAYS` to 1–30 and never beyond absolute.
- Invalid/missing config falls back to the defaults (30 / 7).

### V4 — Login does not invalidate pre-existing session
**Status: Fixed.**
- Login route revokes the presented session before issuing the new one.

### V5 — Privilege changes do not revoke sessions
**Status: Fixed.**
- All four reviewed privilege-change flows plus the submit-application grant path rotate inside the same transaction as the change.

### V6 — No session inventory / sign-out-everything
**Status: Fixed.**
- `GET /api/auth/sessions`, `DELETE /api/auth/sessions/[id]`, `POST /api/auth/sessions/revoke-others`.

### V7 — Sessions accumulate without bound
**Status: Partially fixed.**
- Bounded opportunistic pruning on login (≤50 rows per sign-in, rows revoked or expired for >30 days).
- No scheduler exists in this deployment, so a large backlog drains over several logins rather than immediately. This is the documented limitation.

---

## 4. Existing protections (verified in this review)

- Token is 256-bit CSPRNG, stored only as salted SHA-256 hash (`hashToken`).
- Cookie is `httpOnly`, `SameSite=Lax`, `Path=/`, `Secure` only in production, absolute expiry set at creation.
- All JSON responses are `private, no-store`.
- Permissions/roles are never stored in the cookie or session row — they are re-read per request.
- Disabled users rejected (`user.disabledAt`).
- Profile-missing sessions rejected.
- Login throttling (S-05) and IP capture remain intact and separately tested.
- S-13 same-origin check covers state-changing session-inventory calls.
- Inventory endpoints return metadata only — never `tokenHash` or token value.
- Owner scoping: inventory/revoke use `ctx.user.id` / `auth.user.id`, never a client-supplied account id.
- Cross-account session id returns 404/403 and does not disturb the victim session.
- Production build config unchanged: `next.config.ts` has no `ignoreBuildErrors`; `package.json` build is `prisma generate && next build` with no `--no-lint`.

### Verified atomicity property
The privilege change, its audit row, the revocation of the affected account’s sessions, and (where applicable) the replacement session all commit or roll back together. The implementation does this by threading a `Db` client (Prisma client or transaction client) into `rotateSessionForUser` / `revokeAllSessionsForUser` / `startSession`, and by calling `auditCritical` with the transaction client for the security-critical audit writes.

The accepted test evidence used two scoped SQLite triggers in the isolated database:
- `s14_block_revoke` — aborts every `UPDATE OF "revokedAt"` on Session, to prove rollback when revocation fails.
- `s14_abort_role_granted_audit` — aborts `INSERT` on AuditLog when `action = 'profile.role_granted'` and `entityId` matches a probe profile, to prove rollback when the ROLE_GRANTED audit write fails.

Both triggers are created and dropped in `try/finally` in the test script, never in the app.

---

## 5. Missing protections / remaining gaps

None of the gaps below are outstanding against **the original S-14 finding**. They are either deferred, gated on other work, product decisions, or follow-up consistency items.

### 5.1 Deferred by design (not missing)
- **Reuse detection** — presenting a revoked token does not revoke the account’s other sessions. This was deferred in the inspection report and remains deferred. A stolen token that was already rotated simply fails.
- **Device-management UI** — the API exists; a settings UI is a separate product decision.
- **Sliding browser cookie** — the cookie keeps the absolute deadline; idle expiry is enforced server-side. A browser may still hold a cookie the server rejects; next request returns 401 and the visitor signs in.

### 5.2 Gated on other findings
- **Password-change session invalidation** — there is still no password-change endpoint. S-14 prepared the primitive (`revokeAllSessionsForUser`), but the caller is S-09. This is correctly out of S-14 scope.

### 5.3 Follow-up decision already flagged (S-14 submit-application review, §3 observation)
- `submitApplication()` grants RESELLER implicitly when the role does not yet exist, via `ensureRole()`. The review noted this as a role grant outside the four originally reviewed flows and worth a follow-up decision. The submit-application review then implemented exactly that path with the same audit+rotation pattern, so the gap it flagged is now closed.
- **Remaining open question (product/decision, not a defect):** are there any other privilege-granting paths in the codebase that should be brought under the same “grant + audit + rotate atomically” pattern? This is a completeness review, not a report of an exploited weakness.

### 5.4 Limitation, not a gap
- **Prune is opportunistic and bounded.** If the database accumulates very many dead session rows between sign-ins, cleanup is gradual. Acceptable given no scheduler; worth keeping in mind if session volume grows.
- **Idle expiry relies on app-server clock.** Clock skew between instances shifts the effective window.
- **Users are not told why a session ended.** Revoked/expired/idle all surface as `authenticated: false`/401.
- **`pruneSessions` and `listSessionsForUser` still run against the shared `prisma` client, not a caller-supplied transaction.** That is fine for their current call sites (login-time prune, owner inventory), but any future transactional use should thread a client.

---

## 6. Reproduction evidence

The original weaknesses were reproduced in the inspection report (manual reproduction steps for V1–V7). The implementation’s negative cases were reproduced via fault injection in the isolated harness:

- `s14_block_revoke` trigger proved that a failed revocation rolls back each privilege change (role grant, supplier activation, tier change, application approval, application grant) and that retrying after unblock commits and rotates.
- `s14_abort_role_granted_audit` trigger proved that a failed ROLE_GRANTED audit write rolls back the grant + application + rotation, and that the healthy path commits and rotates.
- Concurrency checks proved parallel authenticated reads do not error during rotation, and that two concurrent first-time grants produce correct per-profile role + audit records.

Positive cases were proved by direct HTTP assertions:
- idle > 7 days → unauthenticated; active within window → authenticated
- absolute expiry → unauthenticated
- login rotates (old cookie fails, new cookie authenticates, cookie changed, flags preserved)
- role activation rotates and new session carries the new role
- tier change revokes target’s sessions, leaves admin signed in
- logout scoped to presented session
- inventory lists only caller’s sessions, no token material, exactly one current
- cross-account revoke fails and leaves victim session valid
- sign-out-everywhere keeps current session, revokes the rest
- revoking current session clears cookie and signs out
- cleanup removes long-dead rows, keeps live ones

I did not rerun the full harness in this review. The retained log `/tmp/sf-s14-clean-final9.log` is the accepted evidence; this review re-read the implementation and tests and confirms the test claims match the code.

---

## 7. Required implementation changes

Against the original S-14 finding: **none required** — the finding is addressed.

For any follow-up consistency pass (only if authorized separately), the required changes are scoped and small:

1. **Audit every privilege-granting path for consistent “grant + audit + rotate atomically” behavior.**
   - Purpose: ensure no privilege grant can survive without a provable trail and without retiring the old credential, regardless of which code path triggers it.
   - How to test: for each candidate path, add an isolated-database check that (a) with revocation blocked, the privilege does not persist and the old session stays valid, and (b) after unblock, the privilege persists, the audit row exists, and the old session is revoked with a replacement issued to the actor where applicable.
   - Why necessary: uneven coverage leaves a class of privilege-change paths that behave like the pre-S-14 code. The motivation is completeness/consistency, not a specific demonstrated bypass.

2. **If reuse detection is later wanted, add it as a separate, separately reviewed change.**
   - Purpose: detect reuse of a revoked token and take a defined action (e.g., revoke the account’s remaining sessions + audit a `session.reuse_detected` event).
   - Why deferred: legitimate stale-tab/double-submit false positives are real; a grace/family design is needed. Not part of S-14.

3. **If a password-change flow is added (S-09), call `revokeAllSessionsForUser` for the affected account after the password update commits.**
   - Purpose: complete the password-change revocation guarantee that S-14 prepared the primitive for.
   - Why gated: no password-change flow exists yet; S-09 owns it.

No other implementation change is required to satisfy S-14.

---

## 8. Proposed implementation sequence (only if follow-up authorized)

This sequence is for a **follow-up completeness pass only**, not for re-implementing S-14.

1. **Inventory privilege-grant paths.** List every code path that grants or changes a privilege/role/tier and confirm whether it currently rotates and audits atomically. Candidates to review:
   - `grantRole` (self-service RESELLER activation) — done
   - `ensureSupplierProfile` SUPPLIER activation — done
   - `setVerificationTier` — done
   - `decideApplication` APPROVED — done
   - `submitApplication` first-time RESELLER grant via `ensureRole` — done
   - Any other `profileRole.create` / role-assignment / tier-elevation path reachable from the API
2. **Bring any uncovered privilege-grant path under the same pattern.**
   - Thread a transaction client through the grant + audit + revocation + replacement-session creation.
   - Use `auditCritical` for the security-critical audit write so a failure rolls back the change.
   - Apply the replacement cookie only after commit.
3. **Add an isolated-database test per newly covered path** using the existing `s14_block_revoke` trigger pattern (rollback when revocation fails; commit+rotate when it works).
4. **Keep the existing S-14 tests untouched** — they remain the regression gate for lifecycle, atomicity, inventory, cleanup, concurrency and audit durability.
5. **Run the full isolated suite** (`npm run test:e2e:clean`), typecheck, and production build; verify `prisma/dev.db` fingerprint unchanged.
6. **Do not touch** S-09, S-12, billing/subscriptions/entitlements/C-03, password recovery/change, email verification, or any non-session finding.

If the inventory in step 1 finds no uncovered privilege-grant path, the follow-up is effectively complete and no code change is needed.

---

## 9. Regression testing plan

The existing S-14 test block is the regression plan. It already covers:

- Lifecycle/idle/expiry: 23 unique lifecycle checks
- Atomicity: 12 unique atomicity checks (rollback + healthy retry for each flow)
- Audit durability: 4 unique audit-durability checks (failed ROLE_GRANTED audit rolls back; healthy path commits and rotates)
- Concurrency: 2 unique concurrency checks
- Inventory/revocation: 7 unique inventory/revocation checks
- Plus the S-12 health probe before any S-14 operation touches the audit counter

Regression safeguards:
- S-05 cookie/IP/throttle/logout checks must still pass (they are separate from S-14 and run earlier in the suite).
- Any new privilege-grant path test must use the same isolated-database, fault-injection, fingerprint-preserved discipline.
- No production database change; `prisma/dev.db` fingerprint verified before and after.
- Build and typecheck must pass with original safeguards.

If a follow-up touches a privilege path that other suites depend on (for example the submit-application or approval flows that S-07/S-10/S-11 exercise), those suites must still pass and any rotated-cookie adoption must be preserved without weakening assertions.

---

## 10. Acceptance criteria

For the existing S-14 implementation (already met):
- Absolute expiry enforced; idle expiry enforced; activity refreshes `lastUsedAt` at most every 5 minutes and never extends `expiresAt`.
- Login rotates the presented session.
- Every privilege-grant path covered by S-14 rotates atomically with its audit and revocation.
- Session inventory is owner-scoped, returns no token material, marks exactly one current session.
- Sign-out-everything leaves the current session and revokes the rest.
- Revoking the current session clears the cookie and signs out.
- Cleanup is bounded and removes dead rows without disturbing live sessions.
- Fault injection proves rollback on failed revocation and on failed ROLE_GRANTED audit write.
- Full suite green; fingerprint unchanged; build/typecheck pass with safeguards intact.

For any follow-up completeness pass (to be met if authorized):
- Every privilege-grant path in the codebase is covered by the same atomic grant+audit+rotate pattern, or is explicitly documented as intentionally not a privilege change.
- Each newly covered path has an isolated-database rollback test.
- No regression in existing S-14/S-05/S-07/S-10/S-11 assertions, fingerprint, build or typecheck.

---

## 11. Blockers and unresolved questions

### No blockers to S-14’s current acceptance.
S-14 is complete and accepted. Nothing in this review blocks that.

### Unresolved / for later decision (not blockers, not S-09, not implementation now)
1. **Reuse detection deferred.** Wanted or not? If wanted, needs a grace/family design and a separate review.
2. **Idle timeout value and absolute lifetime.** Defaults are 7-day idle, 30-day absolute, clamped. If the business wants different values or a shorter absolute lifetime for a money-handling marketplace, that is a configuration/product decision, not an implementation defect.
3. **Privilege change UX.** Rotating on privilege change signs other devices out without an explanation screen. That is the intended security outcome; whether to add a screen/message is a product decision.
4. **Prune strategy.** Opportunistic bounded pruning is acceptable for now. If session volume grows, consider a documented operator command in addition to opportunistic pruning.
5. **Any remaining privilege-grant paths.** A short code inventory (step 1 of the proposed sequence) would confirm whether every privilege-grant path is covered by the S-14 pattern. If one is missing, that becomes the only concrete S-14-aligned follow-up.

### Phase 0
Phase 0 remains incomplete. S-14 acceptance does not constitute validation approval.

---

## Documentation cross-references

- Finding/inspection: `STAGE2_TASK8_S14_INSPECTION.md`
- Implementation: `STAGE2_TASK8_S14_REPORT.md`
- Atomicity review: `STAGE2_TASK8_S14_FINAL_REVIEW.md`
- Submit-application review: `STAGE2_TASK8_S14_SUBMIT_APPLICATION_REVIEW.md`
- Acceptance: `STAGE2_TASK8_S14_FINAL_ACCEPTANCE_REPORT.md`
- State: `STATE.md` (S-14 Accepted, Stage 2 Task 8)
- Implementation report’s changed-files list and limitations are the authoritative record of what S-14 changed and what it did not.

---

## Scope compliance

This review was read-only. It did not modify source, schema, migration, dependencies, tests, configuration, or the production database. It did not start S-09 or any other finding, and it did not modify S-12. It does not claim Phase 0 validation is complete.

---

*Prepared as an investigation/planning deliverable. No implementation changes were made.*
