# Stage 2 Task 9 — S-09 Independent Implementation Completeness Review Report

**Review type**: Independent, read-only completeness review of Stage 2 Task 9 (S-09: Password Reset and Password Change).
**Reviewer posture**: Verification and evidence only. No code changes, no migrations, no DB edits, no test edits, no config edits, no emails, no secrets.
**Date**: 2026-11-09.

---

## 1. Executive summary

The S-09 implementation defines the intended backend surfaces:
- unauthenticated password-reset request,
- unauthenticated password-reset completion,
- authenticated password change,

and wires them to existing primitives for password hashing, session revocation, throttling, and audit. The implementation also integrates the existing `src/lib/resend.ts` surface for the reset-request email.

However, this review found two blocking issues and several completeness gaps:

1. **Blocking — migration provenance and deployment reproducibility.** The `PasswordResetToken` table and indexes exist in the current database, and `prisma/schema.prisma` describes the model, but there is no corresponding S-09 migration directory or SQL file, and `_prisma_migrations` shows no applied S-09 migration record. The latest migration record is `20261105060000_session_lifecycle`.
2. **Blocking — missing user-facing password-reset workflow.** No “Forgot password?” entry point, reset-request form, reset-token/password form, or authenticated change-password form exists in the current UI. Backend routes alone do not satisfy the approved S-09 user-facing scope.
3. **Completeness gap — S-09 test coverage is not executed.** The only executed test suite is the Resend unit tests (19 tests). The S-09 auth integration test file exists only as an intentionally empty placeholder and is excluded from the executed test pattern.

Because of the blocking issues, this review does **not** accept S-09 as complete or accepted.

---

## 2. Final verdict

**NOT ACCEPTED**

The implementation is architecturally coherent for the backend path, but it is **not complete, not reproducible by the committed migration chain, and not user-facing**. These are blocking, not cosmetic.

---

## 3. Approved D1–D5 compliance assessment

This review assessed the technical implementation against the implemented D1–D5 definition in `STAGE2_TASK9_S09_IMPLEMENTATION_SPECIFICATION.md`, not against any product decisions outside the file.

- **D1 — Resend dependency and email delivery prerequisites**: Partially met as an integration dependency, but **not met as a deployment-verified capability**. The implementation depends on the existing Resend surface, but there is no evidence here that email delivery is operational or that a reset email can actually be delivered. The reset-request route handles provider failure safely, but safety of failure handling is not the same as operational readiness.
- **D2 — Password reset flow primitives**: Met for the core crypto/token/hash/expiry/single-use design in `src/lib/auth/reset-token.ts`.
- **D3 — Authenticated password change**: Met for the route logic in `src/app/api/auth/password/change/route.ts`, including current-password verification, password-policy enforcement, password update, other-session revocation, and current-session rotation.
- **D4 — Resend template integration**: Met as an integration call to `sendTemplatedEmail()`, with safe failure handling. Not met as a verified email path.
- **D5 — Demo-account recovery excluded**: Met in implementation posture. No demo-specific recovery path was added.

This compliance assessment is **not** an acceptance verdict. The blocking database-migration provenance, missing UI workflow, and absent S-09 test execution prevent acceptance.

---

## 4. Verified implementation inventory

### Backend routes implemented

- `src/app/api/auth/password-reset/request/route.ts`
- `src/app/api/auth/password-reset/reset/route.ts`
- `src/app/api/auth/password/change/route.ts`

### Auth primitives reused

- `src/lib/auth/password.ts`
- `src/lib/auth/revocation.ts`
- `src/lib/auth/throttle.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/identifiers.ts`
- `src/lib/auth/reset-token.ts` (new helper module)

### Resend integration

- `src/lib/resend.ts` reused; `sendTemplatedEmail()` is called from the reset-request route.

### Audit

- `src/lib/audit.ts` defines `AUDIT.PASSWORD_RESET` and `AUDIT.PASSWORD_CHANGED`.

### Schema

- `prisma/schema.prisma` contains the `PasswordResetToken` model and `User.resetTokens`.

### Documentation

- `STAGE2_TASK9_S09_IMPLEMENTATION_SPECIFICATION.md`
- `STAGE2_TASK9_S09_IMPLEMENTATION_REPORT.md`
- `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md`

### UI

- No dedicated S-09 UI components or pages were created.
- `src/app/login/page.tsx` and `src/components/auth-forms.tsx` were not changed.
- No “Forgot password?” link or reset/change forms exist in the current UI.

---

## 5. Database-object evidence

Verified directly against the database:

- `PasswordResetToken` table exists.
- Columns: `id`, `userId`, `hashedToken`, `used`, `expiresAt`, `createdAt`.
- Foreign key: `PasswordResetToken.userId` references `User.id` with `ON DELETE CASCADE`.
- Unique index exists: `PasswordResetToken_hashedToken_unique` on `hashedToken`.
- Indexes exist: `PasswordResetToken_userId_idx` on `userId`, `PasswordResetToken_expiresAt_idx` on `expiresAt`.

So **database objects exist** in the current database as intended.

---

## 6. Migration-file and migration-history evidence

### Migration-file existence

- `prisma/migrations/` contains:
  - `20261102203150_init`
  - `20261102213950_dispute_claim_link`
  - `20261102222213_subscriptions`
  - `20261104060000_login_throttle`
  - `20261105000000_stock_integrity`
  - `20261105060000_session_lifecycle`
  - `migration_lock.toml`
- There is **no S-09 migration directory** and **no S-09 migration SQL file** in `prisma/migrations/`.

### Migration-history completeness

Verified against `_prisma_migrations` via Prisma Client raw query. The applied migration records are:

- `20261102203150_init`
- `20261102213950_dispute_claim_link`
- `20261102222213_subscriptions`
- `20261104060000_login_throttle`
- `20261105000000_stock_integrity`
- `20261105060000_session_lifecycle`

There is **no S-09 migration record** in `_prisma_migrations`.

### Practical implications

- `prisma migrate status` reports the schema as current and lists 6 migrations found in `prisma/migrations`.
- `PasswordResetToken` exists in the database despite the missing migration record.
- This means the current database state is **not fully explained by the committed migration chain** in this review’s evidence.
- This review did not run `prisma db push`, `prisma migrate reset`, `prisma db execute` mutations, `prisma migrate deploy`, or any baseline/sync command, and did not modify the database.

This is a real provenance gap: an object exists in the DB that has no committed migration artifact establishing it through the ordinary migration mechanism.

---

## 7. Deployment-reproducibility assessment

On the evidence gathered:

- A clean database applying only the committed migrations in `prisma/migrations/` would **not** obtain `PasswordResetToken`, because no committed migration creates it.
- The current database cannot be reproduced purely from the committed migration history and the committed schema; something outside the reviewed migration artifacts produced the table.
- `prisma migrate status` appearing current is not equivalent to “the committed migration chain produces this schema.” The status reflects Prisma’s comparison of schema against the DB, not the provenance of the schema objects.

This is the smallest, cleanest blocking statement available from the evidence: **the S-09 schema change is not reproducible through the committed migration chain as reviewed**.

---

## 8. Password-reset security findings

### Reviewed paths

- Reset request: `src/app/api/auth/password-reset/request/route.ts`
- Token helpers: `src/lib/auth/reset-token.ts`
- Reset completion: `src/app/api/auth/password-reset/reset/route.ts`

### Strengths

- Reset-request route is unauthenticated and returns the same generic response regardless of whether the email exists.
- Token generation uses `randomBytes(32).toString("base64url")`.
- Only a salted SHA-256 hash is stored.
- Token lookup rejects missing, malformed, expired, used, and user-mismatch cases.
- `consumeResetToken()` marks the token used inside the password-reset transaction.
- Reset completion revokes all live sessions for the account in the same transaction.
- Failure handling in the reset-request route does not expose provider diagnostics or account-exists information.

### Concerns

- The reset-request route performs a user lookup before deciding whether to send a reset email. The response is generic, but the implementation path still branches on account existence internally, and it creates a reset token and attempts a template send for existing accounts. If token creation or email preparation fails, the route still returns the generic response, which is correct behavior, but this also means the enumeration-resistant property depends on no side channel leaking timing or error differences.
- Reset link construction uses `applicationOrigin()`, which is the right approach, but in development it falls back to the request URL. This is acceptable for local testing, but it depends on the implementation environment for the security guarantee in production.
- Rate limiting is not implemented on the reset-request endpoint. The S-09 spec and the existing auth primitives show a throttle module that is used for login; the reset-request route uses none of it. This is within the implemented scope, but it is a real, intentional gap for an unauthenticated abuse surface.

### Finding

- **High**: No rate limiting on the password-reset request endpoint.

---

## 9. Authenticated password-change findings

### Reviewed path

- `src/app/api/auth/password/change/route.ts`

### Strengths

- Requires an active session.
- Verifies current password.
- Enforces existing password rules.
- Rejects if new password equals current password.
- Updates password and revokes other sessions in one transaction.
- Audits `auth.password_changed`.
- Rotates current session after the change by calling `revokeOtherSessionsForUser(...)` with the current session id.
- Reuses S-14 revocation primitives without modifying S-14.

### Concerns

- The route calls `requireAuth()` first, which reads session cookies. In normal Next request context this is correct, but this review could not execute the route through a real Next request scope. The correctness of cookie/session resolution and CSRF behavior depends on running under the real Next request lifecycle. This review did not execute those routes.
- `revokeOtherSessionsForUser()` is called inside the transaction to revoke other sessions, and then called again outside the transaction for current-session rotation. The second call is a separate operation after the commit. The implementation treats current-session rotation as a follow-up step, which is compatible with the idea that the password commit is atomic with the other-session revocation, but it introduces a second revocation step that is not part of the atomic commit.
- No rate limiting is implemented on this endpoint either. The implementation depends on the existing session/auth layer rather than a dedicated throttle for password change.

### Findings

- **Medium**: Password-change endpoint has no dedicated rate limiting.
- **Medium**: Current-session rotation happens after the commit as a separate operation, so the “rotate current session” step is not fully atomic with the password update transaction.

---

## 10. Demo-account and existing security-control compatibility

### Demo-account protections

- No demo-specific password recovery path exists in the implementation.
- The seeded demo accounts are ordinary accounts from the password-reset code’s perspective; they can use reset/change like anyone else, but there is no special demo recovery mechanism.
- This satisfies the “demo-account recovery disabled” posture from the review’s perspective.

### S-06 and S-15 protections

- No change was made to `prisma/seed.ts` or `scripts/seed-guard.ts`.
- No change was made to demo credential handling beyond the fact that demo accounts are normal accounts in the password system.
- The reset-request response does not reveal whether an email belongs to a demo account specifically.

### S-14 compatibility

- The implementation reuses `revokeOtherSessionsForUser()` and the session/rotation model, and does not modify S-14 files.
- On the evidence reviewed, S-14 primitives remain intact.

### S-12 compatibility

- No change to audit durability code beyond adding two audit action constants.
- `audit()` and `auditCritical()` are unchanged.

### S-13 compatibility

- No change to CSRF logic.
- This review did not study CSRF behavior under the working app in depth beyond noting that the routes go through `route()` in `src/lib/api.ts`.

### Billing, entitlements, C-03

- No changes to billing, entitlements, or C-03 surfaces.

---

## 11. UI completeness assessment

Reviewed:

- `src/app/login/page.tsx`
- `src/components/auth-forms.tsx`

Findings:

- There is **no “Forgot password?” entry point** on the login page.
- There is **no password-reset request form**.
- There is **no reset-token/password form**.
- There is **no authenticated change-password form**.

The backend alone does not satisfy the user-facing workflow. A complete S-09 user-facing experience requires UI entry points and forms, not just routes.

---

## 12. Actual S-09 test coverage and verification gaps

### Test files reviewed

- `src/lib/auth/password-change.test.ts`
- `vitest.config.ts`
- `tsconfig.json`

### Actual coverage

- The executed suite is `vitest run` with the pattern from `vitest.config.ts`, which only includes `src/lib/resend.test.ts`.
- That executed suite is **1 test file, 19 tests**, all Resend unit tests.
- The S-09 auth integration file `src/lib/auth/password-change.test.ts` is a **placeholder test suite** and does not exercise the routes or DB behavior.

### What was removed / excluded during implementation

- Earlier in implementation, more complete harness and integration tests were written and run, but they were removed from the committed test configuration because they could not run under the local harness without a real Next request scope. The final committed test file contains only the placeholder.
- This review did not modify that file.

### Verification gaps

- No S-09 route integration tests exercised the actual routes in this environment.
- No S-09 tests verified token creation, token lookup, token consumption, password update, session revocation, or reset-request enumeration resistance.
- TypeScript compilation and security scripts do not prove S-09 behavior.
- The Resend tests do **not** cover the S-09 reset-request flow, only the sender module itself.

---

## 13. Findings classified

### Critical

- **Missing S-09 migration provenance and deployment reproducibility.** The `PasswordResetToken` table exists in the database and is described in the schema, but there is no committed S-09 migration artifact and no corresponding record in `_prisma_migrations`. A clean database would not obtain the table through the committed migration chain.

### High

- **Missing user-facing password-reset workflow.** No login-page “Forgot password?” entry point, no reset-request form, no reset completion form.
- **No rate limiting on the password-reset request endpoint.** Unauthenticated abuse surface.

### Medium

- **Password-change current-session rotation is not atomic with the commit.** It happens as a separate step after the transaction.
- **No rate limiting on the authenticated password-change endpoint.**
- **S-09 HTTP flows were not executed in this environment.** They depend on a real Next request scope and could not be verified via the local harness.

### Low

- **Reset-request route still branches internally on account existence.** Response is generic, but the internal branching is a dependency point for enumeration resistance.

### Informational

- The `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md` file describes the intended migration, but there is no matching migration directory/file in `prisma/migrations/` and no migration record.
- The implementation report claims the migration was applied; the migration-history evidence does not support that claim in a reproducible sense.

---

## 14. Exact files and code locations supporting findings

- `prisma/schema.prisma` — `PasswordResetToken` model and `User.resetTokens`.
- `src/lib/auth/reset-token.ts` — token generation, hashing, lookup, consumption.
- `src/app/api/auth/password-reset/request/route.ts` — reset-request logic, generic response, token creation, origin-based link, Resend call.
- `src/app/api/auth/password-reset/reset/route.ts` — token validation, password update, session revocation, audit.
- `src/app/api/auth/password/change/route.ts` — current-password check, password-policy enforcement, password update, other-session revocation, current-session rotation, audit.
- `src/lib/app-origin.ts` — trusted-origin helper.
- `src/lib/resend.ts` — reused Resend integration.
- `src/lib/audit.ts` — `AUDIT.PASSWORD_RESET`, `AUDIT.PASSWORD_CHANGED`.
- `prisma/migrations/` — migration directories present and absent.
- `_prisma_migrations` — last record `20261105060000_session_lifecycle`; no S-09 record.
- Database schema evidence: `PasswordResetToken` table exists with unique index `PasswordResetToken_hashedToken_unique` and indexes `PasswordResetToken_userId_idx`, `PasswordResetToken_expiresAt_idx`.
- `vitest.config.ts` — only `src/lib/resend.test.ts` included.
- `src/lib/auth/password-change.test.ts` — placeholder only.
- `src/app/login/page.tsx` and `src/components/auth-forms.tsx` — no reset/change UI.

---

## 15. Recommended narrowly scoped remediation steps

These are recommendations for a separate authorized task. Do not implement them here.

1. **Create the missing S-09 migration artifact.** Generate and commit a migration that creates the `PasswordResetToken` table with the intended unique constraint and indexes. Do not rely on `prisma db push` or schema sync as the migration artifact.
2. **Reconcile migration history only through a safe, deliberate migration-creation process**, not by editing the migration record or the database to fabricate provenance. If implementation already produced the table via `db push` or a similar non-migration path, create the migration from schema diff and ensure the history is consistent.
3. **Add rate limiting to the reset-request endpoint** using the existing throttle primitives, with a conservative policy for an unauthenticated abuse surface.
4. **Add a minimal UI workflow** for “Forgot password?”, reset-request, reset-token entry, and authenticated change-password. At minimum, the login page should expose a reset entry point.
5. **Add real S-09 integration tests** that exercise:
   - reset-request enumeration resistance,
   - token creation/hash/expiry/single-use,
   - reset completion success and failure paths,
   - password-change current-password verification, policy, and session revocation/rotation.
6. **Verify the HTTP flows under a real Next request scope** (for example, Playwright against `next dev`) rather than relying on a direct route-module harness, because the routes call Next’s `cookies()` during request handling.

---

## 16. Confirmation of read-only posture

This review did not modify any project files, database contents, migration history, configuration, tests, or application code. It did not create or apply migrations, reset the database, push changes, deploy, or send emails. It read files and queried the database only for verification.

---

## 17. Verdict restatement

**NOT ACCEPTED**

Reasons:
- Blocking: S-09 migration provenance and deployment reproducibility are not established.
- Blocking: The user-facing password-reset workflow is absent.
- Completeness: Meaningful S-09 tests are not executed; only Resend unit tests run.
- Completeness: Reset-request rate limiting is absent.

The backend design is sound on the parts reviewed, but the implementation is not complete enough to accept.
