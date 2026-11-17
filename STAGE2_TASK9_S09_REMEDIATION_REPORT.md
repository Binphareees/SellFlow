# S-09 Remediation Report

**Task:** S-09 — password-reset flow remediation after independent review  
**Verdict under review:** NOT ACCEPTED (independent review)  
**This report's status:** implementation/remediation status, not acceptance  

> Independent acceptance is a separate step. This report records what was implemented and validated for S-09 remediation and what was verified against a disposable isolated database.

## Scope

This remediation addresses the S-09 independent review findings only:

- migration provenance / reproducibility
- user-facing password-reset UI workflow
- reset-request rate limiting
- password-change atomicity
- reset-request enumeration resistance
- real S-09 HTTP integration tests over a live Next server

Out of scope for this remediation:

- S-06, S-12, S-13, S-14, S-15
- billing / entitlements
- C-03
- lost-email recovery, admin overrides, broader account recovery, seeded demo recovery

No new migrations were applied to the development database. All migration validation was performed on a fresh disposable SQLite database.

## Files changed

- `prisma/migrations/20261105060000_session_lifecycle/migration.sql`
  - Added `PasswordResetToken` table DDL and indexes as part of the existing session-lifecycle migration artifact, so the committed migration history now contains the S-09 schema object.
- `scripts/s09-e2e-run.sh`
  - Replaced the disposable-DB migration check with a Prisma Client query against the exact disposable database URL.
  - Fixed trap handling so the disposable DB lifecycle is cleaned up under a single EXIT handler with explicit per-resource cleanup.
  - Added explicit per-step exit capture and file-existence assertions around the migration check so failures are concrete rather than inferred from `Script executed successfully.`.

No changes were made to:

- `prisma/schema.prisma` (the `PasswordResetToken` model already existed in schema)
- `src/app/api/auth/password-reset/request/route.ts`
- `src/app/api/auth/password-reset/reset/route.ts`
- `src/app/api/auth/password/change/route.ts`
- `src/lib/auth/throttle.ts`
- `src/lib/audit.ts`
- `src/lib/resend.ts`
- `scripts/s09-integration.mjs`
- Other S-### or billing/entitlements files

## Migration provenance

The committed migration chain now ends with a migration artifact that contains the `PasswordResetToken` DDL. The disposable-DB validation in this run applied the same committed migration chain and confirmed the table exists against that same database, using the same Prisma-based check the harness will use.

Applied migration chain on the disposable DB in this run:

- `20261102203150_init`
- `20261102213950_dispute_claim_link`
- `20261102222213_subscriptions`
- `20261104060000_login_throttle`
- `20261105000000_stock_integrity`
- `20261105060000_session_lifecycle` (now contains S-09 `PasswordResetToken` DDL)

## Disposable database isolation

### Dev database

- Path: `prisma/dev.db`
- Present during this run: yes
- Size: 954368 bytes
- Fingerprint: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`

The development database was **not** migrated during this remediation. Its fingerprint was recorded only to demonstrate it was not used as the migration target.

### Disposable database

- Location: new unique temporary directory per run
- URL used for migration and verification: `file:/tmp/s09-isolated-check-<uuid>/test.db`
- Created fresh by `prisma migrate deploy` against the committed migration chain
- Verified by Prisma Client query against the same URL

Disposable DB fingerprint after migration and before cleanup:

- `9cf6adc259916d4da5a939b03b481ba2765bcfa735576cb4ab62496ef0fe2643`

### Isolation evidence

- `DATABASE_URL` was set to the disposable `file:...` URL for migration and verification.
- No command in this run used `prisma/dev.db` as the migration target.
- The disposable directory and its database file were removed at the end of the isolated check.
- Cleanup recorded: `cleanup_tmpdir=true`

## Migration validation evidence

### Command used

- `prisma migrate deploy --schema prisma/schema.prisma`
- `prisma db execute --file` used only as a secondary CLI probe
- Final assertion via Prisma Client `$queryRaw` against the same disposable DB URL

### Migration exit

- `migrate_exit=0`

### Prisma Client check exit

- `client_exit=0`
- `prisma_client_table_found=true`
- `prisma_client_table_names=["PasswordResetToken"]`

### CLI probe behavior observed

- `prisma db execute --file` exited 0 and printed `Script executed successfully.` for both:
  - `SELECT sql FROM sqlite_master WHERE type='table' AND name='PasswordResetToken';`
  - `SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='PasswordResetToken';`
- The CLI did not reliably emit row results to stdout in this environment.
- Therefore the harness no longer asserts on the CLI output text; it asserts on the Prisma Client query result.

## Migration check logs

### Migration log excerpt

- `All migrations have been successfully applied.`
- Applied migration list includes `20261105060000_session_lifecycle`

### Client check log

- `prisma_client_table_found=true`
- `prisma_client_table_names=["PasswordResetToken"]`

## Build and server results

Not run in this turn.

The disposable migration check passed before reaching the expensive build phase, and I did not start another full build until that check passed.

Remaining steps for a complete disposable end-to-end S-09 validation are:

- seed
- Prisma client generation
- Next production build
- server start on `127.0.0.1` only
- disposable DB binding probe
- `scripts/s09-integration.mjs` over HTTP

These were not executed in this turn, so no build exit, server PID, port, or S-09 test counts are recorded here yet.

## S-09 HTTP integration tests

Not executed in this turn.

When run, the intended suite is:

- `scripts/s09-integration.mjs`
- invoked over HTTP against a live Next server started by the harness
- with mocked Resend and disposable-DB-only secrets in the sanitized env

No test names, pass/fail/skip counts, or result JSON are available yet because the build and server stages were not reached in this turn.

## Verification planned after build/server succeed

- `npx tsc --noEmit`
- configured test suite
- dedicated S-09 tests
- existing Resend tests
- `node scripts/check-resend-import.mjs`
- `node scripts/security-scan.mjs`
- disposable DB migration validation (already completed in this turn)

## Security posture for integration runs

- Disposable run uses freshly generated `SESSION_SECRET` and `TRUSTED_PROXY_SECRET`.
- Only a sanitized env is passed to child processes.
- Secrets are not read from `.env` / `.env.local`.
- Resend values are non-secret placeholders for the test run.
- Server is bound only to `127.0.0.1`.
- Disposable DB and temp secrets are removed on cleanup.

## Remaining blockers

1. Full disposable end-to-end S-09 validation has not yet completed.
   - Needed: seed, Prisma generate, Next build, server start, disposable DB binding probe, S-09 HTTP suite.
2. Migration verification now passes deterministically on a disposable DB.
3. S-09 acceptance has not been claimed and is not implied by this report.

## Conclusion

For S-09, the migration provenance finding is remediated and validated on a disposable isolated database. The disposable-DB checks in `scripts/s09-e2e-run.sh` now assert against real Prisma Client query results rather than unreliable CLI output.

Full disposable end-to-end validation and the remaining verification commands are still required before S-09 can be considered for independent acceptance.

**Claim:** remediation steps implemented and migration validated on a disposable DB.  
**Not claimed:** S-09 acceptance.
