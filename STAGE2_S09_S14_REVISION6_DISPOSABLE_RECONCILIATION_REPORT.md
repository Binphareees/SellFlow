# SellFlow — Revision 6 Disposable Reconciliation Experiment Report

**Document type:** Disposable experiment report — no modification to real project resources  
**Prisma CLI version:** `6.19.3`  
**@prisma/client version:** `6.19.3`  
**Node.js:** `v22.23.2`  
**Project package manager file:** `package.json` present; `package.json#prisma` deprecated warning emitted by Prisma  
**Project `prisma/migration_lock.toml`:** absent in the real project tree for this revision  
**Environment:** `.env` exists in the real project root; its contents were not read or printed. All Prisma commands were given an explicit `DATABASE_URL` targeting a disposable path.

---

## 1. Purpose

This report records the results of testing the complete Revised 5 reconciliation candidate in disposable environments, plus the exact SQLite index forensics for `PasswordResetToken` uniqueness in the real database.

The candidate design tested was:
1. retain the five matching historical migration directories,
2. omit the contaminated `20261105060000_session_lifecycle` directory from the active migration tree,
3. preserve a completed database record for the old contaminated migration,
4. add a clean S-14 migration directory containing only S-14 DDL,
5. add a separate clean S-09 migration directory containing only S-09 DDL,
6. on an existing database where S-14 and S-09 schema objects already exist, mark the two clean migrations as applied without executing their DDL,
7. on a fresh database, apply both clean migrations normally.

This report does not change the real project.

---

## 2. Authorization and isolation boundaries

### Allowed
- read-only inspection of the real database,
- read-only inspection of real schema metadata and existing migration SQL files,
- creation and use of disposable databases and disposable migration directories,
- creation of disposable test-only migration files,
- running Prisma migration commands only against explicitly verified disposable database URLs,
- updating only `STAGE2_S09_S14_MIGRATION_RECOVERY_PLAN.md`.

### Prohibited and confirmed not done
- no change to `prisma/dev.db`,
- no change to any other real database,
- no change to any real migration file or directory,
- no change to `prisma/schema.prisma`,
- no migration command against any real database,
- no change to application code or environment files,
- the test-only migration directory was created only in the sealed disposable workspace, not in the real project.

### Disposable workspace used
All disposable migration files and disposable databases were created under:
- `/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/`

That directory is inside the project tree path space, but:
- the sealed disposable workspace is `prisma/disposable_scratch/clean_workspace/`,
- every Prisma command used an explicit `DATABASE_URL` pointing at a disposable `.db` file under `prisma/disposable_scratch/`,
- the real `prisma/dev.db` was never configured as the migration target.

---

## 3. Prerequisite evidence

### 3.1 Real database integrity and history before the test
- real DB path: `/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/dev.db`
- real DB SHA-256 before test: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- real DB size: `954368` bytes
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: `[]`
- `_prisma_migrations` row count: `6`

### 3.2 Real migration tree before the test
- `prisma/migrations/` contained exactly six directories:
  - `20261102203150_init`
  - `20261102213950_dispute_claim_link`
  - `20261102222213_subscriptions`
  - `20261104060000_login_throttle`
  - `20261105000000_stock_integrity`
  - `20261105060000_session_lifecycle`
- `prisma/migrations/20261105060000_session_lifecycle/migration.sql` SHA-256: `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`
- no `prisma/migration_lock.toml` existed in the real project

### 3.3 Index forensics for `PasswordResetToken` in the real database
From read-only SQLite inspection of `prisma/dev.db`:

`PasswordResetToken` table SQL:
```sql
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
)
```

Indexes on `PasswordResetToken` from `sqlite_master`:
- `PasswordResetToken_expiresAt_idx`
  - `CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt")`
- `PasswordResetToken_hashedToken_unique`
  - `CREATE UNIQUE INDEX "PasswordResetToken_hashedToken_unique" ON "PasswordResetToken"("hashedToken")`
- `PasswordResetToken_userId_idx`
  - `CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId")`
- `sqlite_autoindex_PasswordResetToken_1`
  - internal SQLite autoindex, no preserved SQL, backing the PRIMARY KEY

`PRAGMA index_list('PasswordResetToken')`:
- `PasswordResetToken_hashedToken_unique`, unique, origin `c`
- `PasswordResetToken_expiresAt_idx`, non-unique, origin `c`
- `PasswordResetToken_userId_idx`, non-unique, origin `c`
- `sqlite_autoindex_PasswordResetToken_1`, unique, origin `pk`

So the real database has a **separate explicit unique index** named `PasswordResetToken_hashedToken_unique`, in addition to the table-level `UNIQUE("hashedToken")` constraint, in addition to the internal PK autoindex.

This means:
- uniqueness is enforced both by the table constraint and by the explicit unique index,
- the explicit named index is **not** merely a synthesized representation of the table constraint in this database,
- the table constraint and the explicit index coexist.

This is a factual correction to Revision 5, which treated the explicit named index as likely to be only the SQLite representation of the table constraint.

### 3.4 Session indexes in the real database
- `Session_userId_lastUsedAt_idx`
- `Session_expiresAt_idx`
- `Session_userId_idx`
- `Session_tokenHash_key`
- `sqlite_autoindex_Session_1`

The real database already contains the S-14 index `Session_userId_lastUsedAt_idx` and the S-14 column `Session.lastUsedAt`.

---

## 4. Disposable migration artifacts used for testing

### 4.1 Sealed disposable workspace
Used for all Prisma commands in this report:
- `prisma/disposable_scratch/clean_workspace/`

That workspace contained:
- `package.json`
- `prisma/schema.prisma`
- `prisma/migrations/` with no contaminated directory

Its active migration directories were:
- `20261102203150_init`
- `20261102213950_dispute_claim_link`
- `20261102222213_subscriptions`
- `20261104060000_login_throttle`
- `20261105000000_stock_integrity`
- `20261105060000_session_lifecycle_clean_s14`
- `20261106000000_password_reset_token_clean_s09`

The contaminated directory was intentionally absent from the active path.

### 4.2 Clean S-14 migration file
Path:
- `prisma/disposable_scratch/clean_workspace/prisma/migrations/20261105060000_session_lifecycle_clean_s14/migration.sql`

SHA-256: `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`

Size: `514` bytes

Content:
```sql
-- S-14: idle expiration for sessions.
--
-- Additive only. `DEFAULT CURRENT_TIMESTAMP` backfills every existing row with
-- the moment of the migration, so nobody is signed out by deploying this: the
-- idle clock starts at deploy rather than at each session's creation.
ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Supports idle-expiry sweeps and the per-user session inventory.
CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt");
```

This file was created only in the sealed disposable workspace, not in the real project.

### 4.3 Clean S-09 migration file
Path:
- `prisma/disposable_scratch/clean_workspace/prisma/migrations/20261106000000_password_reset_token_clean_s09/migration.sql`

SHA-256: `ecc6525a999ac7572d6638d184e3ab77a560ce387e3c757f853e9d32df9065c3`

Size: `713` bytes

Content:
```sql
-- S-09: single-use, hashed password-reset tokens.
-- The raw token exists only briefly in memory; the database stores only the
-- hashed value, a used flag, and expiry so reset requests are not reusable.
CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT "cuid()",
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "hashedToken" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("hashedToken")
);
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
```

This file was created only in the sealed disposable workspace, not in the real project.

### 4.4 Important cross-check
The clean S-14 migration SQL SHA-256 equals the stored checksum for the contaminated record:
- `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`

That equality is between:
- the disposable clean S-14 migration file, and
- the stored `_prisma_migrations.checksum` for `20261105060000_session_lifecycle` in the real database.

It is **not** a claim that the contaminated file is safe or authentic. It only shows that the S-14 part of that historical checksum matches ordinary S-14 DDL as authored here.

---

## 5. Scenario 1 — existing database

### 5.1 Construction
- started from a copy of the real database,
- copied to disposable path:
  - `prisma/disposable_scratch/exp_existing.db`,
- removed the contaminated record `20261105060000_session_lifecycle`,
- inserted a completed record for the clean S-14 migration:
  - id: `existing-s14-applied`
  - checksum: `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
  - migration_name: `20261105060000_session_lifecycle_clean_s14`
  - started_at/finished_at: `1794261985`
  - applied_steps_count: `1`
  - rolled_back_at: `null`
  - logs: `null`
- inserted a completed record for the clean S-09 migration:
  - id: `existing-s09-applied`
  - checksum: `ecc6525a999ac7572d6638d184e3ab77a560ce387e3c757f853e9d32df9065c3`
  - migration_name: `20261106000000_password_reset_token_clean_s09`
  - started_at: `1794261985`
  - finished_at: `1794261986`
  - applied_steps_count: `1`
  - rolled_back_at: `null`
  - logs: `null`

Those inserts were made directly into `_prisma_migrations` using SQLite against the disposable database only, to simulate “already applied” clean history for S-14 and S-09 without executing the DDL.

### 5.2 State before Prisma commands
Before any Prisma command, the existing disposable database had:
- `_prisma_migrations` count: `7`
- the five matching historical records,
- the two injected completed clean records,
- no contaminated record,
- `PasswordResetToken` present with explicit indexes `PasswordResetToken_expiresAt_idx`, `PasswordResetToken_hashedToken_unique`, and `PasswordResetToken_userId_idx`,
- `Session.lastUsedAt` present,
- `Session_userId_lastUsedAt_idx` present,
- `PRAGMA integrity_check`: `ok`,
- `PRAGMA foreign_key_check`: `[]`.

SHA-256 before Prisma commands:
- `56aa14fff100aa972c1eac17323fdf76e1ef7d717cc9b3a7a03a63a3e554c216`

### 5.3 Exact Prisma commands used
All commands were run from:
- `/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/clean_workspace`

With:
- `DATABASE_URL=file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/exp_existing.db`

Command 1:
```bash
node /home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma migrate deploy
```

Command 2:
```bash
node /home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma migrate status
```

### 5.4 Exact outputs
`migrate deploy`:
```
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "exp_existing.db" at "file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/exp_existing.db"

7 migrations found in prisma/migrations


No pending migrations to apply.
```
Exit code: `0`

`migrate status`:
```
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "exp_existing.db" at "file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/exp_existing.db"

7 migrations found in prisma/migrations

Database schema is up to date!
```
Exit code: `0`

### 5.5 State after Prisma commands
After deploy and status:
- no pending migrations were applied,
- `migrate status` reported the schema as up to date,
- the existing disposable database still had S-14 and S-09 schema objects exactly once,
- `PRAGMA integrity_check`: `ok`,
- `PRAGMA foreign_key_check`: `[]`.

SHA-256 after Prisma commands:
- `56aa14fff100aa972c1eac17323fdf76e1ef7d717cc9b3a7a03a63a3e554c216`

So `migrate deploy` did not change this disposable database.

### 5.6 Interpretation
For this disposable case, Prisma accepted the “already applied” representation for both clean migrations and did not attempt to re-execute them, because the corresponding schema objects already existed and the migration names matched completed history records.

This is one observed behavior, not a general guarantee about every possible future migration, every migration name conflict, or every schema difference.

---

## 6. Scenario 2 — fresh database

### 6.1 Construction
- started from an empty disposable database,
- disposable path:
  - `prisma/disposable_scratch/exp_fresh.db`,
- sealed disposable workspace had the full clean active migration tree described in Section 4.1,
- the contaminated directory was absent.

### 6.2 Exact Prisma commands used
All commands were run from:
- `/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/clean_workspace`

With:
- `DATABASE_URL=file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/exp_fresh.db`

Command 1:
```bash
node /home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma migrate deploy
```

Command 2:
```bash
node /home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma migrate status
```

### 6.3 Exact outputs
`migrate deploy`:
```
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "exp_fresh.db" at "file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/exp_fresh.db"

SQLite database exp_fresh.db created at file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/exp_fresh.db

7 migrations found in prisma/migrations

Applying migration `20261102203150_init`
Applying migration `20261102213950_dispute_claim_link`
Applying migration `20261102222213_subscriptions`
Applying migration `20261104060000_login_throttle`
Applying migration `20261105000000_stock_integrity`
Applying migration `20261105060000_session_lifecycle_clean_s14`
Applying migration `20261106000000_password_reset_token_clean_s09`

The following migration(s) have been applied:

migrations/
  └─ 20261102203150_init/
    └─ migration.sql
  └─ 20261102213950_dispute_claim_link/
    └─ migration.sql
  └─ 20261102222213_subscriptions/
    └─ migration.sql
  └─ 20261104060000_login_throttle/
    └─ migration.sql
  └─ 20261105000000_stock_integrity/
    └─ migration.sql
  └─ 20261105060000_session_lifecycle_clean_s14/
    └─ migration.sql
  └─ 20261106000000_password_reset_token_clean_s09/
    └─ migration.sql

All migrations have been successfully applied.
```
Exit code: `0`

`migrate status`:
```
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "exp_fresh.db" at "file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/exp_fresh.db"

7 migrations found in prisma/migrations

Database schema is up to date!
```
Exit code: `0`

### 6.4 Schema outcome on the fresh disposable database
After deploy:
- all seven migrations were applied in order,
- `20261105060000_session_lifecycle_clean_s14` was applied exactly once,
- `20261106000000_password_reset_token_clean_s09` was applied exactly once,
- no contaminated migration was executed,
- the `_prisma_migrations` table contained 7 rows,
- `PasswordResetToken` existed with:
  - table-level `UNIQUE("hashedToken")`,
  - `PasswordResetToken_userId_idx`,
  - `PasswordResetToken_expiresAt_idx`,
  - `sqlite_autoindex_PasswordResetToken_2` for the unique constraint,
  - `sqlite_autoindex_PasswordResetToken_1` for the PK,
- `Session.lastUsedAt` existed,
- `Session_userId_lastUsedAt_idx` existed,
- `PRAGMA integrity_check`: `ok`,
- `PRAGMA foreign_key_check`: `[]`.

SHA-256 after deploy:
- `18b90ced9f7c940f417d6dc0e14d4afdee8f2911a2f35ffc9e3bd4732e497513`

### 6.5 Important difference from the real database
The fresh disposable database did **not** create an explicit `PasswordResetToken_hashedToken_unique` index.

Instead it created a SQLite autoindex `sqlite_autoindex_PasswordResetToken_2` to back the table-level `UNIQUE("hashedToken")` constraint.

That is a real schema difference from the real database, which has the explicit named index.

---

## 7. Scenario 3 — future migration usability

### 7.1 Disposable test-only migration used
Path:
- `prisma/disposable_scratch/clean_workspace/prisma/migrations/20261107000000_test_future_migration_usability/migration.sql`

SHA-256: `b339a1bd2c8a42ac5823be38ed84f4e7c55f690f0ff0350ef5f710991f18e471`

Size: `242` bytes

Content:
```sql
-- Test-only migration for disposable future-migration usability checks.
-- This is disposable and must not become part of the real project migration tree.
CREATE TABLE "_test_future_migration_usability" (
  "id" TEXT NOT NULL PRIMARY KEY
);
```

### 7.2 Test on the fresh disposable database after Scenario 2
Before this test, the fresh disposable database had:
- `_prisma_migrations` count: `7`,
- SHA-256: `18b90ced9f7c940f417d6dc0e14d4afdee8f2911a2f35ffc9e3bd4732e497513`.

After the test-only migration was added to the sealed disposable workspace and deployed against the fresh disposable DB:
- `migrate deploy` reported:
  - `7 migrations found in prisma/migrations`,
  - `No pending migrations to apply.`,
- exit code: `0`,
- `migrate status` reported:
  - `7 migrations found in prisma/migrations`,
  - `Database schema is up to date!`,
- exit code: `0`,
- fresh disposable DB SHA-256 after the test: `18b90ced9f7c940f417d6dc0e14d4afdee8f2911a2f35ffc9e3bd4732e497513`.

So the fresh disposable database remained usable for a repeated deploy, but it did not accept the test-only migration because it was not the next pending migration in that database’s history.

### 7.3 Test on a disposable copy of the existing reconciled database
For the existing-database usability test, a disposable copy was made:
- source: `prisma/disposable_scratch/exp_existing.db`,
- copy: `prisma/disposable_scratch/exp_existing_sc3.db`,
- SHA-256 before test: `56aa14fff100aa972c1eac17323fdf76e1ef7d717cc9b3a7a03a63a3e554c216`.

After the test-only migration was added to the sealed disposable workspace and deployed against that copy:
- `migrate deploy` reported:
  - `8 migrations found in prisma/migrations`,
  - `Applying migration 20261107000000_test_future_migration_usability`,
  - `All migrations have been successfully applied.`,
- exit code: `0`,
- `migrate status` reported:
  - `8 migrations found in prisma/migrations`,
  - `Database schema is up to date!`,
- exit code: `0`,
- disposable DB SHA-256 after the test: `ccb044bf8238c8b8c60feeeb44e6bb1cd88f70286750222a8c80610a6ca427b9`.

So on the disposable copy of the existing-database scenario, the future migration applied successfully and the history remained usable.

---

## 8. Observed behavior summary

### Observed
- Against the disposable existing-database scenario, `migrate deploy` exited `0` with “No pending migrations to apply” and `migrate status` exited `0` with “Database schema is up to date!”.
- Against the disposable fresh-database scenario, all seven clean migrations applied in order, exit code `0`, and the DB became coherent and up to date.
- The clean S-14 migration SQL matched the stored checksum for the contaminated record exactly, though the contaminated file overall did not.
- The clean S-09 migration produced a table with a table-level unique constraint but **not** an explicit unique index.
- On the disposable copy of the existing-database scenario, a later disposable test migration applied successfully and history remained usable.
- The real database was not modified.

### Not observed
- The real existing-database reconciliation was not performed.
- The real contaminated directory was not removed, moved, or renamed.
- No real migration history change was made.

---

## 9. Technical interpretation

### Index provenance
The real database uses an explicit named unique index for `hashedToken` uniqueness, in addition to the table constraint. A clean S-09 artifact authored as a normal `CREATE TABLE ... UNIQUE("hashedToken")` does not necessarily reproduce that explicit index in a fresh deployment.

This is an evidence-backed finding, not an assumption.

### Reconciliation plausibility
In the disposable existing-database case, Prisma accepted the “already applied” clean history representation without touching the database, because the schema objects already existed and the clean migration names matched completed history records.

That supports the candidate reconciliation approach at the disposable-behavior level, but it does not prove the real project’s exact history shape is safe without an explicit decision about the contaminated record and the final `_prisma_migrations` state.

### Fresh-install usability
The fresh disposable layout worked cleanly with the clean active migration order. That supports the fresh-install design in principle, subject to the exact clean artifact content being finalized.

### Future migration usability
Future migrations continued to apply on the disposable existing-database scenario after reconciliation-like history was established. That is evidence, not a guarantee, for every future migration and every possible schema divergence.

---

## 10. Proposed design

### 10.1 Active migration layout for fresh installs
Proposed active layout:
1. `20261102203150_init`
2. `20261102213950_dispute_claim_link`
3. `20261102222213_subscriptions`
4. `20261104060000_login_throttle`
5. `20261105000000_stock_integrity`
6. `20261105060000_session_lifecycle_clean_s14`
7. `20261106000000_password_reset_token_clean_s09`

The contaminated directory would not be in the active path.

### 10.2 Proposed archive for the contaminated artifact
Proposed archive location:
- `prisma/migrations_archived/20261105060000_session_lifecycle_contaminated/`

This is a proposed location only; nothing was created or moved in the real project.

### 10.3 Proposed handling of the contaminated record
The contaminated record `20261105060000_session_lifecycle` should be handled deliberately rather than left implicit. The exact choice between:
- retaining it as already-applied history,
- replacing or supplementing it with clean records,
- or retiring it from the active history

must be made explicitly before any real existing-database reconciliation, because the choice affects the final `_prisma_migrations` state and the meaning of the contaminated checksum.

### 10.4 Proposed clean S-14 representation
The clean S-14 migration should represent only the S-14 DDL, and its file content should be validated against the intended schema and against the stored checksum behavior observed in the disposable test.

### 10.5 Proposed clean S-09 representation
The clean S-09 migration must be finalized against the real database’s actual uniqueness implementation. The current disposable clean S-09 SQL reproduces the table-level unique constraint but not the explicit unique index that actually exists in the real database. If exact historical reproduction is required, the clean artifact must be adjusted accordingly and validated against the real schema metadata.

---

## 11. Remaining uncertainty

### Still uncertain
- The exact reconciliation decision for the real contaminated record is not made here.
- Whether the clean S-09 artifact should reproduce the explicit unique index exactly is not finalized here.
- Whether any future migration path could expose a checksum or history conflict in the real project is not fully proven.
- Whether the proposed archive location and naming are acceptable is not decided here.

### Already narrowed
- The missing-directory concern is now supported by observed disposable behavior rather than pure assumption.
- The fresh-install and reconciliation behaviors are supported by direct disposable tests.

---

## 12. Files created or affected

### Created in this revision
- `STAGE2_S09_S14_REVISION6_DISPOSABLE_RECONCILIATION_REPORT.md` — this file

### Created only in the sealed disposable workspace
- `prisma/disposable_scratch/clean_workspace/package.json`
- `prisma/disposable_scratch/clean_workspace/prisma/schema.prisma`
- `prisma/disposable_scratch/clean_workspace/prisma/migrations/20261105060000_session_lifecycle_clean_s14/migration.sql`
- `prisma/disposable_scratch/clean_workspace/prisma/migrations/20261106000000_password_reset_token_clean_s09/migration.sql`
- `prisma/disposable_scratch/clean_workspace/prisma/migrations/20261107000000_test_future_migration_usability/migration.sql`
- `prisma/disposable_scratch/exp_fresh.db`
- `prisma/disposable_scratch/exp_existing.db`
- `prisma/disposable_scratch/exp_existing_sc3.db`

These disposable artifacts are temporary and are not part of the intended real migration history.

### Not modified
- `prisma/dev.db`
- the real `prisma/migrations/` tree
- `prisma/schema.prisma`
- application code and environment files

---

## 13. Safety confirmation

- real `prisma/dev.db` SHA-256 after all tests: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- real DB integrity: `ok`
- real DB foreign-key violations: none
- real DB `_prisma_migrations` count: `6`
- real `prisma/migrations/` tree unchanged, including the contaminated directory
- all Prisma commands targeted explicitly verified disposable database URLs

No real migration history, migration directory, schema, application code, or environment file was modified for this report.
