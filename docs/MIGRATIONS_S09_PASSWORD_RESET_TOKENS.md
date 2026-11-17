# S-09 password reset tokens — migration provenance

Purpose: durable, single-use, hashed password reset tokens for email-based password
recovery (Stage 2 Task 9, audit finding S-09).

This document was corrected on 2026-11-17 (Part 1) because the previous version
described the migration as "the file name Prisma generated during that run", which
did not identify the actual artifact. That was inaccurate: no separate
`password_reset_tokens` migration exists.

## Where the model actually comes from

`PasswordResetToken` is created by the **S-14 session-lifecycle migration**:

| Item | Value |
|---|---|
| Migration directory | `prisma/migrations/20261105060000_session_lifecycle/` |
| Migration file | `prisma/migrations/20261105060000_session_lifecycle/migration.sql` |
| Table created | `PasswordResetToken` |
| Indexes created | `PasswordResetToken_userId_idx`, `PasswordResetToken_expiresAt_idx` |
| Unique constraint | `UNIQUE("hashedToken")` (created inline, **unnamed**) |

The same migration also adds `Session.lastUsedAt` and
`Session_userId_lastUsedAt_idx` for S-14. S-09 and S-14 therefore share one
migration directory; there is no standalone S-09 migration.

Schema declaration: `prisma/schema.prisma`, `model PasswordResetToken`.

## Applied state

Applied to the local development database: yes. `_prisma_migrations` records
`20261105060000_session_lifecycle` as completed, and the `PasswordResetToken`
table plus both indexes are present in `prisma/dev.db`.

Fresh-database reproduction: verified in Part 1. A disposable database built with
`prisma migrate deploy` alone contains `PasswordResetToken` with all five columns
(`id`, `userId`, `hashedToken`, `used`, `expiresAt`, `createdAt`), the unique index
and both non-unique indexes, followed by the guarded seed. No extra migration is
required to obtain the model.

## Remaining provenance limitations (known, not fixed here)

1. **Checksum drift.** The database recorded checksum `539bd5b6…` when the
   migration was applied, but the current `migration.sql` hashes to `33b41fc7…`.
   The file was edited after it was applied. The applied DDL and the current file
   agree on the resulting schema (the table exists with the intended columns), but
   the bytes no longer match the recorded checksum. Prisma's `migrate deploy` and
   `migrate status` do not object; a future `migrate dev` may. Do not edit this
   migration again; if the drift must be resolved, that is an owner-approved
   decision with its own verification.
2. **Constraint naming drift.** The migration creates an unnamed
   `UNIQUE("hashedToken")`, while the datamodel names the constraint
   `PasswordResetToken_hashedToken_unique` via `@@unique(..., map: ...)`. As a
   result `prisma migrate diff --from-migrations … --to-schema-datamodel …` emits
   `[*] Redefined table "PasswordResetToken"`. Uniqueness is still enforced; the
   difference is the constraint name Prisma would generate. Fixing it requires a
   new migration, which is outside Part 1's authorization.
3. **Mixed-purpose migration.** Adding S-09 DDL to the S-14 migration means the two
   findings cannot be deployed or reasoned about independently. This is recorded as
   technical debt; no split was performed.
4. **Historical failed duplicate.** A duplicated copy of this migration was once
   applied under the name `20261105060000_session_lifecycle_clean_s14` and failed
   on `duplicate column name: lastUsedAt` (zero applied steps). It was marked
   rolled back on 2026-11-17 after proving no schema or row change; see the Part 1
   baseline report. It is not part of the migration history that fresh deployments
   use.

## Security notes (unchanged)

- Reset tokens are stored only as a salted SHA-256 hash; the raw token is never
  persisted or logged.
- Token consumption, password update and session revocation occur in one
  interactive transaction.
- The reset-request response is identical whether or not an account exists.

## Known functional gaps (unchanged by this document)

- No `/reset-password` page exists, so the emailed reset link resolves to no
  route.
- The reset-request endpoint applies no throttling.
- `src/lib/auth/reset-token.test.ts` is not included in `vitest.config.ts`.

These gaps are recorded in `STATE.md` under S-09 and are scheduled for Part 2.
