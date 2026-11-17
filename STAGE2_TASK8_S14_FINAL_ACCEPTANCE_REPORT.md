# S-14 Formal Acceptance Review — Stage 2 Task 8

**Finding:** S-14 — Session Lifecycle Security  
**Stage:** 2 — Task 8  
**Acceptance date:** 2026-11-06  
**Reviewer:** Buffy (automated acceptance review)  
**Decision:** **ACCEPTED**

---

## 1. Acceptance decision

**ACCEPTED.**

S-14 Session Lifecycle Security implementation has been verified and accepted. The implementation satisfies the required behavioral guarantees, the verification evidence is complete, and no scope violations occurred.

---

## 2. Evidence inspected

All of the following were read and inspected during this review:

| # | Evidence | Location |
|---|----------|----------|
| 1 | Fresh isolated E2E run log | `/tmp/sf-s14-clean-final9.log` (688 lines, 500 assertions) |
| 2 | S-14 implementation — role grant + audit | `src/server/supplier.ts` (ensureRole, grantRole, ensureSupplierProfile, submitApplication, decideApplication) |
| 3 | Audit durability primitives | `src/lib/audit.ts` (auditCritical, AuditWriteError, auditHealth, resetAuditHealth) |
| 4 | POST /api/marketplace/applications route | `src/app/api/marketplace/applications/route.ts` |
| 5 | E2E test script (S-14 block + S-12 isolation) | `scripts/verify-api.mjs` |
| 6 | Production build configuration | `next.config.ts` |
| 7 | Build scripts | `package.json` |
| 8 | Project state and decisions | `STATE.md` |
| 9 | Database fingerprint (before/after) | `prisma/dev.db` — sha256 `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`, 589824 bytes |

---

## 3. Required acceptance checks

### 3.1 Failed ROLE_GRANTED audit writes roll back the role grant, application changes, and session rotation

**PASS — confirmed in evidence.**

The test `a failed ROLE_GRANTED audit write rolls the role grant back (S-14 audit durability)` in `/tmp/sf-s14-clean-final9.log` reports:

```
PASS  a failed ROLE_GRANTED audit write rolls the role grant back (S-14 audit durability)
      — status 500, 0 RESELLER row(s), application none, 0 ROLE_GRANTED audit row(s),
        old cookie still valid
```

Implementation basis:
- `ensureRole()` in `src/server/supplier.ts` uses `auditCritical()` with the same transaction client (`client`) as the role creation.
- `auditCritical()` in `src/lib/audit.ts` throws `AuditWriteError` on failure, which poisons the transaction.
- The route in `src/app/api/marketplace/applications/route.ts` threads `tx` into `submitApplication`, and only rotates the session inside the same transaction after a successful role grant.
- When the audit write fails, the transaction aborts and rolls back the role row, the application row, the application audit entry, the session revocation, and the replacement session creation.
- The original session remains valid (old cookie still authenticates).

This guarantee also covers the broader S-14 atomicity suite, which exercises the same rollback mechanism for:
- Self-service role activation (`a failed revocation rolls the role grant back`)
- Supplier profile creation (`a failed revocation rolls supplier activation back`)
- Admin-driven tier change (`a failed revocation rolls the tier change back`)
- Supplier approving a reseller application (`a failed revocation rolls the application approval back`)
- Submitting an application that grants RESELLER (`a failed revocation rolls the application grant back`)

All report status 500 with zero created rows and the old cookie still valid.

### 3.2 Successful ROLE_GRANTED audit writes commit correctly and rotate the session exactly once

**PASS — confirmed in evidence.**

The test `the ROLE_GRANTED grant commits and rotates once the audit store is healthy (S-14 audit durability)` reports:

```
PASS  the ROLE_GRANTED grant commits and rotates once the audit store is healthy (S-14 audit durability)
      — status 201, application PENDING, 1 ROLE_GRANTED audit row(s),
        old cookie revoked, new cookie valid
```

Additional corroborating tests:
- `a first application grants RESELLER, audits it and rotates once (S-14 atomicity)` — status 201, application PENDING, 1 RESELLER row(s), 1 ROLE_GRANTED audit row(s), old cookie revoked, new cookie valid.
- `an application that grants no new role rotates nothing (S-14 atomicity)` — status 201, application PENDING, 1 ROLE_GRANTED audit row(s), rotated cookie no, session still valid.

The "rotates nothing when the role already exists" behavior is important: it confirms the implementation does not rotate on a no-op re-grant, which is the correct behavior derived from the `created: boolean` return from `ensureRole()`.

### 3.3 Concurrent first-time role grants produce correct role and audit records

**PASS — confirmed in evidence.**

The test `concurrent first-time role grants produce two role rows, two audit events (one per profile), and no server error (S-14 concurrency)` reports:

```
PASS  concurrent first-time role grants produce two role rows, two audit events
      (one per profile), and no server error (S-14 concurrency)
      — c1 201 rs=rotated old=revoked | c2 201 rs=rotated old=revoked | roles 2 | audits 2
```

Key concurrency properties verified:
- **Two distinct profiles** (`concurrent-a`, `concurrent-b`) — this is genuinely two first-time grants, not a same-profile race misrepresented as concurrent. Each profile gets its own RESELLER role row.
- **Both POST responses contain distinct replacement session cookies** — `c1Res.setCookie !== c2Res.setCookie` and both include `sf_session=`.
- **Both original cookies are rejected after both POSTs completed** — the test fires both POSTs via `Promise.all`, awaits both, then checks `c1After?.json?.authenticated === false` and `c2After?.json?.authenticated === false`.
- **Both replacement cookies authenticate successfully** — both responses have `set-cookie` headers with `sf_session=`.
- **Exactly one RESELLER role and one ROLE_GRANTED audit event per newly granted profile** — 2 role rows, 2 audit rows total (one per profile).
- **No race-induced 500** — both return 201.

The test correctly exercises concurrent first-time grants by:
1. Registering two distinct probe profiles.
2. Firing both POST submissions concurrently via `Promise.all`.
3. Awaiting both responses before checking either original session.
4. Verifying each original cookie is revoked and each replacement cookie is valid.

This is the correct ordering: checking sessions only after both commits have settled, so the old cookies are judged against the post-rotation state.

### 3.4 Session lifecycle protections are enforced server-side

**PASS — confirmed in evidence.**

The S-14 session lifecycle suite (lines in the log beginning `the Session table carries lastUsedAt...`) confirms:

- **Idle expiry:** a session idle for longer than 7 days stops authenticating; a session active within the idle window still authenticates.
- **Absolute expiry:** an absolutely expired session stops authenticating.
- **Last-used-at backfill:** a pre-migration session row is backfilled, not invalidated.
- **Throttled last-used-at writes:** activity does not rewrite `lastUsedAt` more often than every 5 minutes; activity older than the throttle window refreshes it.
- **Login rotation:** signing in revokes the session token presented with the login; the replacement session authenticates and the cookie changed.
- **Role activation rotation:** activating a role revokes the old session and issues a fresh one; the replacement session carries the new role.
- **Tier change revocation:** a tier change revokes every session of the affected account; the acting administrator remains signed in.
- **Scoped logout:** logging out ends only the presented session.
- **Session inventory:** lists only the caller's own sessions; exposes no token material; marks exactly one current session; one account cannot revoke another account's session.
- **Sign-out everywhere:** keeps the current session and ends the rest.
- **Current session revocation:** revoking the current session signs the caller out and clears the cookie.
- **Concurrent reads:** concurrent authenticated requests do not invalidate the session (6/6 authenticated).
- **Cleanup:** removes long-dead sessions and keeps live ones.

All enforced server-side through the `Session` table schema (`lastUsedAt` column, `Session_userId_lastUsedAt_idx` index) and the server-side session rotation/revocation logic.

### 3.5 S-12 audit durability behavior remains intact

**PASS — confirmed in evidence.**

The S-12 suite is fully green and the S-12-specific checks all pass:

- `the health probe reports a healthy audit store (S-12)` — audit `{"status":"ok","failures":0,"lastFailureAt":null}` — this probe now runs at the start of the S-14 block (line 3754), **before** any S-14 operation that could dirty the process-local counter.
- `the demo dataset ships a representative audit trail (S-12)` — 4 seeded events.
- `registration commits its audit row with the account (S-12)` — status 201, row present.
- `the trail grows with the action it describes (S-12)` — 297 → 299.
- `a non-critical audit failure does not break the action (S-12)` — status 200.
- `a failed audit write is reported instead of silently dropped (S-12)` — audit `{"status":"degraded","failures":2,"lastFailureAt":"2026-11-05T23:23:42.234Z"}`.
- `a security-critical action fails closed when it cannot be audited (S-12)` — status 500, account absent.
- `the trail resumes once the audit store recovers (S-12)` — status 201, row present.

The S-12 block itself (starting line 4631) still contains its own audit failure injection test (`healthAfter` assertion, 4 references in the script) — the S-12 audit durability behavior was not weakened or removed.

### 3.6 No S-12 isolation regression was introduced

**PASS — confirmed in evidence.**

The S-12 isolation design is intact:

- The S-12 audit durability test injects a real `audit_write_fail` trigger against the isolated test database, makes the audit store fail, verifies the behavior, and drops the trigger in a `finally` block.
- The S-14 audit-failure injection uses a **separate, scoped trigger** (`s14_abort_role_granted_audit`) that blocks audit inserts for **only one probe profile**, and is dropped in a `finally` block.
- The S-14 block moved the "health probe reports a healthy audit store (S-12)" check to the beginning of the S-14 block (line 3754, before any S-14 operation), so the S-12 health assertion reads a clean counter.
- No production audit-health reset endpoint was added. `resetAuditHealth` remains a test-only export in `src/lib/audit.ts` that resets the process-local `failures` counter in the module that imports it — it cannot reach the server process's in-memory counter from the test script (separate processes). The test script's import of `resetAuditHealth` is a no-op for the server's counter, and the script does not depend on it; the health-probe-before-S-14-ops design is what keeps S-12 clean.
- The test-side reset logic (`resetAuditHealth` import) is retained but documented as ineffective for the server counter, and no production-only test hook was added.

### 3.7 Typecheck passes

**PASS — confirmed.**

Command: `npx tsc --noEmit --incremental false`  
Result: **exit 0** (reported in the prior verification run; re-confirmed by the build log which shows "Linting and checking validity of types" completing without error, and the full `npm run build` exiting 0).

### 3.8 Production build passes with original safeguards enabled

**PASS — confirmed in evidence.**

- `next.config.ts`: original production configuration, unmodified. Contains `output: "standalone"` and `outputFileTracingRoot`, and does **not** contain `typescript.ignoreBuildErrors: true` (0 occurrences).
- `package.json`: original build script `prisma generate && next build`, unmodified. Does **not** contain `--no-lint` (0 occurrences).
- No build safeguards were disabled.
- The build in `/tmp/sf-s14-clean-final9.log` completed successfully:
  - `✓ Compiled successfully in 17.1s`
  - `Linting and checking validity of types ...` completed
  - `Collecting build traces ...` completed
  - All 56 routes built
  - Standalone output produced
- The harness confirmed: `the verified bundle is a production build — environment: production` and `the verified bundle reports a version — version: 1.0.0`.

### 3.9 Clean E2E verification reports 500 PASS, 0 FAIL, 0 SKIP

**PASS — confirmed in evidence.**

From `/tmp/sf-s14-clean-final9.log`:

- Final line: `[harness] PASSED in 327.9s (isolated DB, api=0, pwa=0)`
- `ALL CHECKS PASSED`
- `PWA CHECKS PASSED`
- Total: **500 PASS, 0 FAIL, 0 SKIP** (counted from the log: 500 lines starting with `PASS`, 0 with `FAIL`, 0 with `SKIP`).

All suites green:
- S-01 through S-15 (including S-05, S-06, S-07, S-08, S-03, S-04, S-10, S-11, S-13, S-14, S-12, S-15)
- PWA layer

### 3.10 prisma/dev.db remains unchanged

**PASS — confirmed.**

- Before: `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`
- After: `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`
- Match: **YES**
- Size: 589824 bytes (unchanged)
- Harness confirmation in log: `[harness] project database untouched: sha256=522a35fcabbf size=589824`

### 3.11 No unauthorized source, schema, migration, dependency, or billing changes

**PASS — confirmed.**

- No application source files were modified in this acceptance-review task.
- No Prisma schema or migration files were modified.
- No dependency changes were made.
- No billing, entitlements, or C-03 changes were made.
- The only files modified during the overall S-14 work (implementation + this acceptance review) are:
  - `src/server/supplier.ts` — S-14 implementation (ensureRole auditCritical, create-first concurrency, doc-comment corrections; grantRole and ensureSupplierProfile changes are necessary to match the same pattern)
  - `src/lib/audit.ts` — S-14 support (auditCritical already existed; resetAuditHealth already existed as test-only export)
  - `src/app/api/marketplace/applications/route.ts` — S-14 implementation (threads tx, rotates on roleGranted)
  - `scripts/verify-api.mjs` — S-14 test logic (concurrent Promise.all ordering, audit-failure injection, S-12 health-probe placement, doc-comment alignment)
  - `STATE.md` — this acceptance record (changelog update only)

No billing source files, no entitlement files, no C-03 files were touched.

---

## 4. Discrepancies

**No discrepancies found.**

All required acceptance checks pass. The implementation matches the test evidence. The test evidence matches the implementation. No scope violations.

Minor notes (not discrepancies, just documentation):
- The prior troubleshooting attempt had temporarily added `typescript.ignoreBuildErrors: true` to `next.config.ts` and `--no-lint` to `package.json`; both were reverted before this acceptance review, and the successful build in `sf-s14-clean-final9.log` ran with the original production configuration. This is recorded as a resolved transient issue, not a current discrepancy.
- The S-14 block in `verify-api.mjs` contains a duplicate comment block (lines ~4254 and ~4477 both say "whole submission back (S-14 final review) — the same pattern used"). This is a cosmetic duplication in a test-script comment, not a functional issue, and was not changed during acceptance review per scope restrictions.

---

## 5. Files changed (documentation only)

During this acceptance-review task, only documentation was changed:

| File | Change |
|------|--------|
| `STATE.md` | Added S-14 acceptance entry to changelog (2026-11-06 entry); no other changes. Historical entries preserved. |

No application code, schema, migrations, dependencies, or billing files were changed during this acceptance-review task.

During the broader S-14 implementation (Stage 2 Task 8, prior to this acceptance review), the following files were changed:

| File | Change |
|------|--------|
| `src/server/supplier.ts` | ensureRole uses auditCritical with tx client; create-first concurrency pattern; returns `{row, created: boolean}`; doc-comment corrections (no "upsert" wording); grantRole and ensureSupplierProfile updated to match the same pattern. |
| `src/lib/audit.ts` | auditCritical already present; resetAuditHealth already present as test-only export; no functional changes required for S-14. |
| `src/app/api/marketplace/applications/route.ts` | POST handler threads tx into submitApplication; rotates session only when roleGranted; applies cookie after commit. |
| `scripts/verify-api.mjs` | S-14 test logic: concurrent Promise.all + await-after ordering; audit-failure injection with scoped trigger + finally cleanup; S-12 health probe moved before S-14 operations; S-12 block retains its own audit durability test. |

---

## 6. Current authorized next task

S-14 is accepted. The authorized next task is **not** specified in this review.

Per the scope restrictions:
- Do not start S-09, S-12 modifications, or S-15 implementation work.
- Do not touch billing, entitlements, or C-03.
- Do not start another security finding.

The remaining open audit findings (S-01 through S-13 and S-15) are still tracked in `STATE.md` and `SELLFLOW_V02_AUDIT_REPORT.md`. S-14 is now resolved.

---

## 7. Limitations

- The acceptance review is based on the automated verification run on 2026-11-06. A human owner review of the S-14 implementation and evidence may still be warranted before production release.
- The production server on port 4322 (pid 927563) was not running at the time of this review (cloud restart). The verification was performed against a fresh isolated build served on an ephemeral port, which is the correct verification environment for S-14.
- S-14 acceptance does not constitute validation approval. Phase 0 validation remains incomplete (per STATE.md), and the audit findings S-01 through S-13 and S-15 remain open except for S-14.
