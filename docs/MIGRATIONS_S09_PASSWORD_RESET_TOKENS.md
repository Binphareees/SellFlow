# S-09 password reset tokens — migration provenance

Purpose: durable, single-use, hashed password-reset tokens for email-based password
recovery (Stage 2 Task 9, audit finding S-09).

**Status:** provenance problem **resolved forward-only on 2026-11-18** by
`prisma/migrations/20261118000000_password_reset_token_alignment`. No historical
migration or checksum was rewritten. This document keeps the full history.

## 1. Where the model comes from

| Item | Value |
|---|---|
| Migration directory | `prisma/migrations/20261105060000_session_lifecycle/` (historical) |
| Correcting migration | `prisma/migrations/20261118000000_password_reset_token_alignment/` |
| Table | `PasswordResetToken` |
| Current schema authority | `prisma/schema.prisma` → `model PasswordResetToken` |

There is **no** `password_reset_tokens` migration and no standalone S-09 migration.
The S-09 DDL was originally appended to the already-applied S-14 migration.

## 2. Provenance timeline (evidence-based)

| When | Event | Evidence |
|---|---|---|
| Migration authored | `20261105060000_session_lifecycle/migration.sql` contained **only** S-14 DDL (`Session.lastUsedAt` + index). It did **not** contain `PasswordResetToken`. | Preserved copy at `prisma/disposable_scratch/clean_workspace/prisma/migrations/20261105060000_session_lifecycle_clean_s14/migration.sql` hashes to the recorded `539bd5b6…`, and has no `PasswordResetToken` section. |
| Applied | Row written with checksum `539bd5b6…`, `finished_at` set, 1 step. | `_prisma_migrations`. |
| Duplicate applied | Byte-identical `…_clean_s14` directory failed: `duplicate column name: lastUsedAt`, 0 steps. | Both rows carry the same `539bd5b6…` checksum. |
| 2026-11-09 17:39 | Real file edited: S-09 comment, `CREATE TABLE "PasswordResetToken"` and two indexes appended (15 added lines, no other change) → `33b41fc7…`. | `diff -u` against the preserved copy shows one added hunk, zero deletions. |
| Until 2026-11-18 | `prisma/dev.db` held the table in a **different** shape (named unique index, named FK `ON UPDATE CASCADE`, `BOOLEAN used`) — the shape a schema-sync path produces, not the shape the appended SQL produces. | DDL comparison, §4. |
| 2026-11-17 | Failed duplicate row marked rolled back after proof it changed nothing. | Part 1 recovery evidence. |
| 2026-11-18 | Forward-only alignment migration added and deployed. Migrations and datamodel now agree; `migrate diff` reports **"No difference detected."** | §5. |

**Answers preserved for the record**

1. Was the file edited after application? **Yes** — the applied bytes had no `PasswordResetToken` DDL.
2. Semantics or naming? **Semantics** — a table and two indexes were added.
3. Was the existing database created from the current file? **No**, for this table: the migration
   row belongs to the previous version and the live DDL matched a schema-sync shape.
4. Any other checksum inconsistency? **No** — the only mismatch is
   `20261105060000_session_lifecycle` (historical, preserved deliberately) and its rolled-back
   duplicate.
5. Fresh vs existing database? Differed in exactly this one table; **identical since 2026-11-18**.

## 3. The correction (forward-only)

`20261118000000_password_reset_token_alignment/migration.sql` rebuilds the table into the
datamodel shape. SQLite cannot drop an inline table-level `UNIQUE` constraint, so a
create-new / copy / drop-old / rename rebuild is the only supported route. It is written to work
from **all three** possible starting states:

1. table **missing** (a database migrated with the pre-2026-11-09 bytes),
2. table with the **inline unnamed** `UNIQUE("hashedToken")` (fresh deployments before this fix),
3. table **already canonical** (`prisma/dev.db`).

All three were exercised on disposable databases before the real one was touched:

| Starting state | Result |
|---|---|
| Fresh, all migrations | deploy exit 0; 107 objects; parity diff **"No difference detected."** |
| Copy of `prisma/dev.db` | deploy exit 0; **125/125 rows** preserved; integrity `ok`; 0 FK violations |
| Legacy (table dropped) | deploy exit 0; table recreated empty with the named unique index; integrity `ok`; 0 FK violations |
| Real `prisma/dev.db` | deploy exit 0; **125/125 rows**, all joined to a live `User`; 228 users unchanged; integrity `ok`; 0 FK violations; 107 objects; `migrate status` exit 0 |

## 4. Historical structural difference (now unified)

| Aspect | Fresh DB before the fix | `prisma/dev.db` before the fix | Both after the fix |
|---|---|---|---|
| Unique | inline `UNIQUE("hashedToken")` → `sqlite_autoindex_PasswordResetToken_1` | named `PasswordResetToken_hashedToken_unique` | named `PasswordResetToken_hashedToken_unique` |
| `id` | `TEXT NOT NULL PRIMARY KEY DEFAULT "cuid()"` | `TEXT NOT NULL PRIMARY KEY` | `TEXT NOT NULL PRIMARY KEY` |
| `used` | `INTEGER NOT NULL DEFAULT 0` | `BOOLEAN NOT NULL DEFAULT false` | `BOOLEAN NOT NULL DEFAULT false` |
| FK | inline `REFERENCES … ON DELETE CASCADE` | named `…_userId_fkey` + `ON UPDATE CASCADE` | named `…_userId_fkey` + `ON UPDATE CASCADE` |
| Indexes | `…_userId_idx`, `…_expiresAt_idx` | same | same |

The literal `DEFAULT "cuid()"` string in the old fresh-deployment SQL was a latent hazard (it would
collide if a row were ever inserted without an explicit `id`; the application always supplies one).
It is gone from the migration-produced schema.

## 5. Verification commands (reproducible)

```bash
# parity: must print "No difference detected."
npx prisma migrate diff --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma --shadow-database-url file:/tmp/shadow.db

# existing database
DATABASE_URL="file:$PWD/prisma/dev.db" npx prisma migrate status
```

## 6. SQLite limitations encountered

- An inline table-level `UNIQUE` constraint cannot be dropped with `ALTER TABLE`; only a table
  rebuild changes it.
- `PRAGMA foreign_keys` cannot be toggled inside a transaction, and Prisma wraps migrations in one,
  so the migration uses `PRAGMA defer_foreign_keys = ON`. No other table references
  `PasswordResetToken`, so the rebuild cannot violate a parent relationship.
- DDL text formatting does not affect Prisma's comparison; object names and shapes do.

## 7. Known functional gaps (unchanged; Part 2 scope)

- No `/reset-password` page exists, so the emailed reset link resolves to no route.
- The reset-request endpoint applies no throttling.
- `src/lib/auth/reset-token.test.ts` is not included in `vitest.config.ts`.

## 8. Security notes (unchanged)

- Reset tokens are stored only as a salted SHA-256 hash; the raw token is never persisted or logged.
- Token consumption, password update and session revocation occur in one interactive transaction.
- The reset-request response is identical whether or not an account exists.
