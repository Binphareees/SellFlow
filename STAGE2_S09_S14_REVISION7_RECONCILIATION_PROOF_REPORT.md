# SellFlow — Revision 7 Reconciliation Proof Report

**Document type:** Disposable experiment report; no modification to real project resources.
**Prisma CLI:** not verified from a retained artifact in this turn.
**@prisma/client / prisma package versions:** not verified from a retained artifact in this turn.
**Node.js:** not verified from a retained artifact in this turn.
**Isolated disposal workspace:** `/tmp/rev7/work`
**Disposable DB root used by this revision:** `prisma/disposable_scratch/`
**Real project root:** `/home/binpharees/Documents/SellFlow-Bootcamp-v2`

This report reconstructs the Revision 7 disposable reconciliation proof using only evidence retained under `/tmp/rev7/work`. Where a value cannot be verified from an opened artifact, it is labeled UNVERIFIED.

---

## 1. Isolation and authorization

### 1.1 What was allowed
- read-only inspection of the real database,
- creation of disposable databases only under `prisma/disposable_scratch/`,
- creation of disposable migration artifacts only under `/tmp/rev7/work`,
- Prisma migration commands only against explicitly set disposable `DATABASE_URL` values,
- creation of this report and update of the recovery plan.

### 1.2 What was NOT done
- no write to `prisma/dev.db`,
- no migration command targeting the real database,
- no edit to real migration files or directories,
- no edit to `prisma/schema.prisma` or application code,
- no creation of real `migration_lock.toml`,
- no promotion of disposable artifacts into the real project tree,
- no backup, restore, seed, build, server, or integration test against any real resource,
- no rerun of migrations, database creation, or SQL edits in this turn.

### 1.3 Isolation evidence
The active migration tree used by the scenarios was rooted at `/tmp/rev7/work/prisma/migrations`.
The disposable databases used were:
- `prisma/disposable_scratch/sc1_final.db`
- `prisma/disposable_scratch/s2_fresh.db`
- `prisma/disposable_scratch/s3_sc1.db`
- `prisma/disposable_scratch/s3_sc2_fresh.db`
- `prisma/disposable_scratch/s3_sc2_fresh_v2.db`

These were not targets of any real project command. This turn did not re-execute them; it only read the retained artifacts that captured their state.

---

## 2. Environment and artifact inventory

### 2.1 Disposable workspace artifacts
The workspace `/tmp/rev7/work` contains the following retained artifacts:

- `README_REMEDIATION_BRIDGE.md`
- `contaminated_vs_clean_s14.diff`
- `real_dev_full_schema.json`
- `real_project_safety_pass.json`
- `revision7_disposable_artifact_inventory.json`
- `s1_existing_finalized_schema.json`
- `s1_existing_full_schema.json`
- `s2_fresh_db_schema_snapshot.json`
- `s2_fresh_full_schema.json`
- `s3_sc1_snapshot.json`
- `s3_sc2_fresh_v2_snapshot.json`
- `s3_sc2_snapshot.json`
- `sc1_final_db_schema_snapshot.json`
- `sc1_migration_inventory.json`
- `scenario1_construction_notes.md`
- `sqlite_reader.py`

Exact sizes and SHA-256s are recorded in `revision7_disposable_artifact_inventory.json`.

### 2.2 Active migration tree used by the scenarios
The disposable migration tree used by the scenarios was at:

`/tmp/rev7/work/prisma/migrations`

with these directories and files:

- `20261102203150_init/migration.sql` sha256 `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`
- `20261102213950_dispute_claim_link/migration.sql` sha256 `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`
- `20261102222213_subscriptions/migration.sql` sha256 `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`
- `20261104060000_login_throttle/migration.sql` sha256 `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`
- `20261105000000_stock_integrity/migration.sql` sha256 `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`
- `20261105060000_session_lifecycle_clean_s14/migration.sql` sha256 `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- `20261106000000_password_reset_token_clean_s09/migration.sql` sha256 `ecc6525a999ac7572d6638d184e3ab77a560ce387e3c757f853e9d32df9065c3`
- `20261107000000_test_future_migration_usability/migration.sql` sha256 `496ad4d0ae3ecc2e566a41f7c726a1c3bbec635a9cdd19e203700d21d19baa59`

tree tar sha256: `f314109f393fd67ebd7feb700b39caf37c46469df5486e479bf8eea4f44ff7dd`
tree tar bytes: `71680`

### 2.3 Disposable databases
- `sc1_final.db` size `954368`, sha256 `e7be1500f1f0357e6b3bf8e124d06e551231272d53630f532ce9f56268799724`, integrity `ok`, FK `[]`, row count `8`
- `s2_fresh.db` size `626688`, sha256 `9e21e38728781e10be340b27070e2b10e9e42072042cdbe6f5f081b107833237`, integrity `ok`, FK `[]`, row count `7`
- `s3_sc1.db` size `962560`, sha256 `5527fd1c797107121046776fe674849a0386fb807f472306aeeeb58da2a4ad0d`, integrity `ok`, FK `[]`, row count `9`
- `s3_sc2_fresh.db` size `626688`, sha256 `9e21e38728781e10be340b27070e2b10e9e42072042cdbe6f5f081b107833237`, integrity `ok`, FK `[]`, row count `7`
- `s3_sc2_fresh_v2.db` size `634880`, sha256 `c4f480983167ba85a7ea9cb1bbead5ac6b2f1dbc29dc13e2b58309fed5a80e1d`, integrity `ok`, FK `[]`, row count `8`

`UNVERIFIED`: exact Prisma CLI and package versions for this revision were not verified from a retained artifact before writing this report.

---

## 3. Preflight evidence on the real project

### 3.1 Real database state before any disposable experiment
- real DB path: `prisma/dev.db`
- real DB SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- real DB size: `954368` bytes
- real DB integrity: `ok`
- real DB foreign-key check: `[]`
- real `_prisma_migrations` row count: `6`

### 3.2 Real `_prisma_migrations` rows before any disposable experiment
- `20261102203150_init`, checksum `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`, id `229abdf1-f818-4f2b-97e9-494568dace66`, started `1794224543789`, finished `1794224544128`, steps `1`, rolled back `null`
- `20261102213950_dispute_claim_link`, checksum `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`, id `db69d6d5-ebb8-4cf0-a5f2-6fbad2801c79`, started `1794224544131`, finished `1794224544175`, steps `1`, rolled back `null`
- `20261102222213_subscriptions`, checksum `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`, id `4b773531-f9d4-422a-a10e-25d4a7f2a907`, started `1794224544180`, finished `1794224544215`, steps `1`, rolled back `null`
- `20261104060000_login_throttle`, checksum `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`, id `7962534c-18a5-438d-95ee-2345cad92724`, started `1794224544218`, finished `1794224544239`, steps `1`, rolled back `null`
- `20261105000000_stock_integrity`, checksum `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`, id `5fe073c9-d7ae-42f4-aed7-6a1336365064`, started `1794224544242`, finished `1794224544269`, steps `1`, rolled back `null`
- `20261105060000_session_lifecycle`, checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`, id `d68a8367-3aa8-4f77-8be7-641acc17a096`, started `1794224544273`, finished `1794224544289`, steps `1`, rolled back `null`

### 3.3 Real migration tree before any disposable experiment
- `20261102203150_init/migration.sql` sha256 `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`
- `20261102213950_dispute_claim_link/migration.sql` sha256 `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`
- `20261102222213_subscriptions/migration.sql` sha256 `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`
- `20261104060000_login_throttle/migration.sql` sha256 `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`
- `20261105000000_stock_integrity/migration.sql` sha256 `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`
- `20261105060000_session_lifecycle/migration.sql` sha256 `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`

### 3.4 Real `prisma/migration_lock.toml`
Not present in the real project tree for this revision.

---

## 4. PasswordResetToken uniqueness implementation in the real database

### 4.1 Real database object-level evidence
The real database contains `PasswordResetToken` with:

Table SQL:
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

Explicit unique index DDL:
```sql
CREATE UNIQUE INDEX "PasswordResetToken_hashedToken_unique" ON "PasswordResetToken"("hashedToken")
```

Indexes on `PasswordResetToken` from `PRAGMA index_list('PasswordResetToken')`:
- `PasswordResetToken_hashedToken_unique`, unique, origin `c`
- `PasswordResetToken_expiresAt_idx`, non-unique, origin `c`
- `PasswordResetToken_userId_idx`, non-unique, origin `c`
- `sqlite_autoindex_PasswordResetToken_1`, unique, origin `pk`

Foreign keys:
- from `User` `id` to `PasswordResetToken` `userId`, on delete `CASCADE`, on update `CASCADE`

So the real database has an explicit unique index `PasswordResetToken_hashedToken_unique`, and the `PasswordResetToken` table SQL does NOT contain a table-level `UNIQUE("hashedToken")`.

### 4.2 Exact witness artifacts
Exact witness files were written into the disposable workspace:
- `witness/02_password_reset_token_sql.txt`
- `witness/03_unique_index_sql.txt`
- `witness/04_index_list_password_resettoken.txt`
- `witness/05_index_xinfo_unique.txt`
- `witness/06_table_level_unique_present.txt`
- `witness/07_unique_index_present.txt`

These witness files were not opened again in this turn because the same evidence was already captured in `s1_existing_finalized_schema.json` and `real_dev_full_schema.json`. Their exact SHA-256 values are recorded in `revision7_disposable_artifact_inventory.json` under `workspace.artifacts`.

---

## 5. Scenario 1 — existing database reconciliation with the original contaminated record retained

### 5.1 Starting disposable database
- source: copy of `prisma/dev.db`
- disposable path: `prisma/disposable_scratch/sc1_final.db`
- starting SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`

### 5.2 Starting migration history
Before any Prisma command, the disposable database contained:

- `20261102203150_init`, checksum `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`, id `229abdf1-f818-4f2b-97e9-494568dace66`, started `1794224543789`, finished `1794224544128`, steps `1`, rolled back `null`
- `20261102213950_dispute_claim_link`, checksum `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`, id `db69d6d5-ebb8-4cf0-a5f2-6fbad2801c79`, started `1794224544131`, finished `1794224544175`, steps `1`, rolled back `null`
- `20261102222213_subscriptions`, checksum `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`, id `4b773531-f9d4-422a-a10e-25d4a7f2a907`, started `1794224544180`, finished `1794224544215`, steps `1`, rolled back `null`
- `20261104060000_login_throttle`, checksum `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`, id `7962534c-18a5-438d-95ee-2345cad92724`, started `1794224544218`, finished `1794224544239`, steps `1`, rolled back `null`
- `20261105000000_stock_integrity`, checksum `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`, id `5fe073c9-d7ae-42f4-aed7-6a1336365064`, started `1794224544242`, finished `1794224544269`, steps `1`, rolled back `null`
- `20261105060000_session_lifecycle`, checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`, id `d68a8367-3aa8-4f77-8be7-641acc17a096`, started `1794224544273`, finished `1794224544289`, steps `1`, rolled back `null`

Observations:
- the original contaminated completed record `20261105060000_session_lifecycle` is present with its original checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`,
- its name and checksum are unchanged,
- the five matching historical records are preserved,
- no clean S-14 or S-09 records are present initially.

### 5.3 Active migration tree for Scenario 1
The disposable migration tree contained these directories before the resolves:

- `20261102203150_init`
- `20261102213950_dispute_claim_link`
- `20261102222213_subscriptions`
- `20261104060000_login_throttle`
- `20261105000000_stock_integrity`
- `20261105060000_session_lifecycle_clean_s14`
- `20261106000000_password_reset_token_clean_s09`

The contaminated directory was intentionally absent from the active disposable tree.

### 5.4 Exact Prisma commands used
All commands used:
- `DATABASE_URL=file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/sc1_final.db`
- `--schema /tmp/rev7/work/prisma/schema.prisma`

Command 1:
```bash
prisma migrate resolve --applied 20261105060000_session_lifecycle_clean_s14 --schema /tmp/rev7/work/prisma/schema.prisma
```

Command 2:
```bash
prisma migrate resolve --applied 20261106000000_password_reset_token_clean_s09 --schema /tmp/rev7/work/prisma/schema.prisma
```

### 5.5 Command 1 result
Exit code: `0`
Output:
```
Migration 20261105060000_session_lifecycle_clean_s14 marked as applied.
```

### 5.6 `_prisma_migrations` immediately after first resolve
After the first resolve, the disposable database contained:

- `20261102203150_init`, checksum `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`, id `229abdf1-f818-4f2b-97e9-494568dace66`, started `1794224543789`, finished `1794224544128`, steps `1`, rolled back `null`
- `20261102213950_dispute_claim_link`, checksum `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`, id `db69d6d5-ebb8-4cf0-a5f2-6fbad2801c79`, started `1794224544131`, finished `1794224544175`, steps `1`, rolled back `null`
- `20261102222213_subscriptions`, checksum `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`, id `4b773531-f9d4-422a-a10e-25d4a7f2a907`, started `1794224544180`, finished `1794224544215`, steps `1`, rolled back `null`
- `20261104060000_login_throttle`, checksum `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`, id `7962534c-18a5-438d-95ee-2345cad92724`, started `1794224544218`, finished `1794224544239`, steps `1`, rolled back `null`
- `20261105000000_stock_integrity`, checksum `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`, id `5fe073c9-d7ae-42f4-aed7-6a1336365064`, started `1794224544242`, finished `1794224544269`, steps `1`, rolled back `null`
- `20261105060000_session_lifecycle`, checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`, id `d68a8367-3aa8-4f77-8be7-641acc17a096`, started `1794224544273`, finished `1794224544289`, steps `1`, rolled back `null`
- `20261105060000_session_lifecycle_clean_s14`, checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`, id `6db80943-dd34-4745-a69e-b3ec8f50d17c`, started `1794263198679`, finished `1794263198679`, steps `0`, rolled back `null`

Observations:
- the contaminated record is still present,
- its name and checksum are unchanged,
- a new completed record `20261105060000_session_lifecycle_clean_s14` was inserted,
- its checksum matches the clean S-14 migration file,
- no duplicate or unexpected records were created,
- no DDL was executed because the schema was not touched.

`UNVERIFIED`: exact stdout/stderr boundary of the first resolve command is not reprocessed from a captured log file in this turn; the output and exit code above are retained from the earlier experiment and confirmed by the present `_prisma_migrations` state.

### 5.7 Command 2 result
Exit code: `0`
Output:
```
Migration 20261106000000_password_reset_token_clean_s09 marked as applied.
```

### 5.8 `_prisma_migrations` immediately after second resolve
After the second resolve, the disposable database contained:

Before that resolve, `_prisma_migrations` had `7` rows.
After that resolve, `_prisma_migrations` had `8` rows.

Final rows:
- `20261102203150_init`, checksum `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`, id `229abdf1-f818-4f2b-97e9-494568dace66`, started `1794224543789`, finished `1794224544128`, steps `1`, rolled back `null`
- `20261102213950_dispute_claim_link`, checksum `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`, id `db69d6d5-ebb8-4cf0-a5f2-6fbad2801c79`, started `1794224544131`, finished `1794224544175`, steps `1`, rolled back `null`
- `20261102222213_subscriptions`, checksum `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`, id `4b773531-f9d4-422a-a10e-25d4a7f2a907`, started `1794224544180`, finished `1794224544215`, steps `1`, rolled back `null`
- `20261104060000_login_throttle`, checksum `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`, id `7962534c-18a5-438d-95ee-2345cad92724`, started `1794224544218`, finished `1794224544239`, steps `1`, rolled back `null`
- `20261105000000_stock_integrity`, checksum `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`, id `5fe073c9-d7ae-42f4-aed7-6a1336365064`, started `1794224544242`, finished `1794224544269`, steps `1`, rolled back `null`
- `20261105060000_session_lifecycle`, checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`, id `d68a8367-3aa8-4f77-8be7-641acc17a096`, started `1794224544273`, finished `1794224544289`, steps `1`, rolled back `null`
- `20261105060000_session_lifecycle_clean_s14`, checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`, id `6db80943-dd34-4745-a69e-b3ec8f50d17c`, started `1794263198679`, finished `1794263198679`, steps `0`, rolled back `null`
- `20261106000000_password_reset_token_clean_s09`, checksum `ecc6525a999ac7572d6638d184e3ab77a560ce387e3c757f853e9d32df9065c3`, id `553e708f-4896-4002-ae32-1ace7e23fb66`, started `1794263210466`, finished `1794263210466`, steps `0`, rolled back `null`

### 5.9 Schema unchanged proof
After both resolves, the disposable existing database still had:
- `Session.lastUsedAt`
- `Session_userId_lastUsedAt_idx`
- `PasswordResetToken`
- `PasswordResetToken_userId_idx`
- `PasswordResetToken_expiresAt_idx`
- explicit unique index `PasswordResetToken_hashedToken_unique`

Because the schema objects already existed and were not altered, the resolves represented “already applied” history without executing DDL against the existing schema.

### 5.10 Final Prisma smoke tests
`prisma migrate status` reported:
```
7 migrations found in prisma/migrations

Database schema is up to date!
```
Exit code: `0`.

`prisma migrate deploy` reported:
```
7 migrations found in prisma/migrations

No pending migrations to apply.
```
Exit code: `0`.

### 5.11 Final disposable database state for Scenario 1
Final DB:
- path: `prisma/disposable_scratch/sc1_final.db`
- SHA-256: `e7be1500f1f0357e6b3bf8e124d06e551231272d53630f532ce9f56268799724`
- size: `954368` bytes
- integrity: `ok`
- foreign-key check: `[]`
- `_prisma_migrations` row count: `8`

### 5.12 Conclusion for Scenario 1
Prisma supported the requested behavior exactly:
- `migrate resolve --applied` accepted each clean migration name,
- each resolve inserted exactly one completed history record with the correct checksum,
- the original contaminated record was retained unchanged,
- the schema was not altered,
- subsequent `migrate status` and `migrate deploy` saw the reconciled history as coherent and up to date.

---

## 6. Scenario 2 — fresh installation using the clean active migration layout

### 6.1 Disposable database
- disposable path: `prisma/disposable_scratch/s2_fresh.db`
- starting state: empty file, no tables

### 6.2 Exact command
```bash
prisma migrate deploy --schema /tmp/rev7/work/prisma/schema.prisma
```

### 6.3 Output
```
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
Exit code: `0`.

`prisma migrate status` reported:
```
7 migrations found in prisma/migrations

Database schema is up to date!
```
Exit code: `0`.

### 6.4 Migration order
The migrations were applied in this exact order:
1. `20261102203150_init`
2. `20261102213950_dispute_claim_link`
3. `20261102222213_subscriptions`
4. `20261104060000_login_throttle`
5. `20261105000000_stock_integrity`
6. `20261105060000_session_lifecycle_clean_s14`
7. `20261106000000_password_reset_token_clean_s09`

### 6.5 Fresh database schema outcome
After deploy:
- table count: `34`
- `Session.lastUsedAt` present
- `Session_userId_lastUsedAt_idx` present
- `PasswordResetToken` present
- `PasswordResetToken_userId_idx` present
- `PasswordResetToken_expiresAt_idx` present
- explicit unique index `PasswordResetToken_hashedToken_unique` NOT present
- instead, a SQLite autoindex backs the uniqueness constraint

Indexes on `PasswordResetToken` in the fresh database:
- `PasswordResetToken_expiresAt_idx`, non-unique, origin `c`
- `PasswordResetToken_userId_idx`, non-unique, origin `c`
- `sqlite_autoindex_PasswordResetToken_2`, unique, origin `u`
- `sqlite_autoindex_PasswordResetToken_1`, unique, origin `pk`

Table SQL:
```sql
CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT "cuid()",
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "hashedToken" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("hashedToken")
)
```

Session indexes:
- `Session_userId_lastUsedAt_idx`, non-unique, origin `c`
- `Session_expiresAt_idx`, non-unique, origin `c`
- `Session_userId_idx`, non-unique, origin `c`
- `Session_tokenHash_key`, unique, origin `c`
- `sqlite_autoindex_Session_1`, unique, origin `pk`

Thus the fresh disposable database does **not** match the real database’s explicit unique index.

---

## 7. Unique-index reconciliation

### 7.1 What Revision 6 already established
The real database has an explicit unique index `PasswordResetToken_hashedToken_unique`.
A clean S-09 artifact that only declares a table-level unique constraint does not necessarily reproduce that index on a fresh apply.

### 7.2 What this revision established
This revision reproduced that exact difference in disposable environments:
- the real database and the Scenario 1 reconciled database both contain `PasswordResetToken_hashedToken_unique`,
- the Scenario 2 fresh database does not; it uses `sqlite_autoindex_PasswordResetToken_2` instead.

### 7.3 Schema-level intent
The real schema contains:
```prisma
model PasswordResetToken {
  id         String   @id @default(cuid())
  userId     String
  hashedToken String
  used       Boolean  @default(false)
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([hashedToken], map: "PasswordResetToken_hashedToken_unique")
  @@index([userId])
  @@index([expiresAt])
}
```

The schema explicitly maps the hashedToken uniqueness to the named index `PasswordResetToken_hashedToken_unique`.

### 7.4 Logical equivalence
Logically, both the real database and the fresh database prevent duplicate `hashedToken` values.
That logical property is satisfied in both disposable results.

### 7.5 SQLite object-level equivalence
Object-level, they differ:
- real database: explicit unique index `PasswordResetToken_hashedToken_unique`
- fresh database: internal autoindex `sqlite_autoindex_PasswordResetToken_2`

So object-level equivalence does not hold between the real database and the fresh disposable result.

### 7.6 Exact SQL equivalence
Exact SQL equivalence also does not hold, because the fresh database’s `PasswordResetToken` object set differs from the real database’s object set by the presence of the explicit unique index.

### 7.7 Proposed final clean S-09 SQL
If exact historical recreation of the real database’s object set is the goal, the clean S-09 migration should explicitly create the explicit unique index in addition to the table DDL.

Proposed revised disposable clean S-09 SQL for exact object-set recreation:

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
CREATE UNIQUE INDEX "PasswordResetToken_hashedToken_unique" ON "PasswordResetToken"("hashedToken");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
```

This is a proposed revision for the final clean artifact only.
It was NOT applied in this revision.
It is reported here to make the reconciliation target explicit.

---

## 8. Scenario 3 — future migration usability

### 8.1 Test migration used
Disposal-only test migration:
- name: `20261107000000_test_future_migration_usability`
- content:
  ```sql
  CREATE TABLE "_future_migration_usability_test" (
    "id" TEXT NOT NULL PRIMARY KEY
  );
  ```
- SHA-256: `496ad4d0ae3ecc2e566a41f7c726a1c3bbec635a9cdd19e203700d21d19baa59`

### 8.2 Branch SC1 — reconciled existing copy
Disposable copy of the reconciled existing database:
- path: `prisma/disposable_scratch/s3_sc1.db`
- starting SHA-256: `e7be1500f1f0357e6b3bf8e124d06e551231272d53630f532ce9f56268799724`

Deploy result:
```
8 migrations found in prisma/migrations

Applying migration `20261107000000_test_future_migration_usability`

The following migration(s) have been applied:

migrations/
  └─ 20261107000000_test_future_migration_usability/
    └─ migration.sql

All migrations have been successfully applied.
```
Exit code: `0`.

`migrate status` reported:
```
8 migrations found in prisma/migrations

Database schema is up to date!
```
Exit code: `0`.

After deploy:
- `_prisma_migrations` row count: `9`
- explicit unique index present: `true`
- test table present: `true`

Final migration rows:
- `20261102203150_init`, started `1794224543789`, applied steps `1`
- `20261102213950_dispute_claim_link`, started `1794224544131`, applied steps `1`
- `20261102222213_subscriptions`, started `1794224544180`, applied steps `1`
- `20261104060000_login_throttle`, started `1794224544218`, applied steps `1`
- `20261105000000_stock_integrity`, started `1794224544242`, applied steps `1`
- `20261105060000_session_lifecycle`, started `1794224544273`, applied steps `1`
- `20261105060000_session_lifecycle_clean_s14`, started `1794263198679`, applied steps `0`
- `20261106000000_password_reset_token_clean_s09`, started `1794263210466`, applied steps `0`
- `20261107000000_test_future_migration_usability`, started `1794263412457`, applied steps `1`

This branch remained usable and preserved the explicit unique index.

### 8.3 Branch SC2 — reconciled fresh copy, first attempt
Disposable copy of the fresh database before the test migration was in the active tree:
- path: `prisma/disposable_scratch/s3_sc2_fresh.db`
- starting SHA-256: `9e21e38728781e10be340b27070e2b10e9e42072042cdbe6f5f081b107833237`

Deploy result:
```
7 migrations found in prisma/migrations

No pending migrations to apply.
```
Exit code: `0`.

`migrate status` reported:
```
7 migrations found in prisma/migrations

Database schema is up to date!
```
Exit code: `0`.

After that attempt:
- `_prisma_migrations` row count remained `7` for that copy
- test table present: `false` for that first attempt

This is the expected result when the active tree does not yet contain the test migration for that particular DB copy.
It does not indicate failure of the fresh branch itself.

### 8.4 Branch SC2 — reconciled fresh copy, second attempt with test migration in active tree
A fresh copy was redeployed against the active tree that included the test migration:
- path: `prisma/disposable_scratch/s3_sc2_fresh_v2.db`
- starting SHA-256: `9e21e38728781e10be340b27070e2b10e9e42072042cdbe6f5f081b107833237`

Deploy result:
```
8 migrations found in prisma/migrations

Applying migration `20261107000000_test_future_migration_usability`

All migrations have been successfully applied.
```
Exit code: `0`.

`migrate status` reported:
```
8 migrations found in prisma/migrations

Database schema is up to date!
```
Exit code: `0`.

After deploy:
- `_prisma_migrations` row count: `8`
- test table present: `true`
- explicit unique index present: `false`

This branch remained usable, but it did **not** gain the explicit unique index, because the fresh branch still uses the autoindex backstop.

Final migration rows:
- `20261102203150_init`, started `1794263274656`, applied steps `1`
- `20261102213950_dispute_claim_link`, started `1794263275018`, applied steps `1`
- `20261102222213_subscriptions`, started `1794263275056`, applied steps `1`
- `20261104060000_login_throttle`, started `1794263275104`, applied steps `1`
- `20261105000000_stock_integrity`, started `1794263275132`, applied steps `1`
- `20261105060000_session_lifecycle_clean_s14`, started `1794263275163`, applied steps `1`
- `20261106000000_password_reset_token_clean_s09`, started `1794263275183`, applied steps `1`
- `20261107000000_test_future_migration_usability`, started `1794263446057`, applied steps `1`

---

## 9. Object-by-object schema comparison

### 9.1 Session
All databases in this revision contain `Session.lastUsedAt` and `Session_userId_lastUsedAt_idx`:
- real database: yes
- Scenario 1 reconciled database: yes
- Scenario 2 fresh database: yes
- Scenario 3 reconciled existing branch: yes
- Scenario 3 reconciled fresh branch: yes

### 9.2 PasswordResetToken
- real database: explicit unique index present
- Scenario 1 reconciled database: explicit unique index present
- Scenario 2 fresh database: explicit unique index absent; autoindex used
- Scenario 3 reconciled existing branch: explicit unique index present
- Scenario 3 reconciled fresh branch: explicit unique index absent; autoindex used

### 9.3 Comparison summary
Logical uniqueness:
- all results: satisfied

Object-level uniqueness implementation:
- real and existing-reconciled branches: explicit unique index
- fresh branches: internal autoindex

Exact SQL equivalence:
- real vs fresh: does not hold
- real vs existing-reconciled: holds for the objects captured in this revision

---

## 10. Backup and rollback decision tree

### 10.1 Required preconditions
Before any real reconciliation:
- confirm a maintenance window or controlled application state with no unsafe writers against the database,
- confirm no application, remote job, or cron task is actively writing to the database during the operation,
- if the database is in active use, do not rely on ad hoc file copying of the main file alone; use a controlled SQLite online backup.

### 10.2 Required backup procedure
Before any real reconciliation:
- create the backup using Python `sqlite3.Connection.backup()` from a controlled process,
- write the backup to a separate path from the active database,
- do not assume a plain file copy of the main file is safe when WAL-related state may exist.

### 10.3 Required independent backup verification
After backup creation, before any operation:
- open the backup read-only,
- confirm `sqlite_master` is readable,
- confirm `_prisma_migrations` is readable,
- compute the backup file SHA-256 and compare it to the recorded backup checksum,
- run `PRAGMA integrity_check` on the backup,
- run foreign-key consistency checks where possible on the backup read-only context,
- if backup verification fails, stop before any operation.

### 10.4 Required pre-operation snapshots
Before any real reconciliation:
- capture the pre-operation schema snapshot, including `Session` and `PasswordResetToken` SQL and the full index list for both tables,
- capture the pre-operation `_prisma_migrations` snapshot, including IDs, checksums, names, and status fields,
- capture relevant row counts, for example:
  - `SELECT COUNT(*) FROM "User"`
  - `SELECT COUNT(*) FROM "Session"`
  - `SELECT COUNT(*) FROM "PasswordResetToken"`
- ensure the pre-operation source state and backup state match.

### 10.5 Required disposable restore rehearsal
Before any real reconciliation:
- restore the verified backup into a disposable database,
- reopen the disposable copy read-only,
- verify schema, row counts, and `_prisma_migrations` match the recorded pre-operation state,
- confirm the restored file SHA-256 matches the recorded backup checksum,
- only after successful restore rehearsal should any real-database operation be considered.

### 10.6 Exact rollback triggers
Rollback should be triggered if any of the following occur:
- pre-operation backup verification fails,
- pre-operation schema, migration-history, or row-count snapshot cannot be captured,
- the operation does not produce the intended final `_prisma_migrations` state,
- the operation creates duplicate objects, missing objects, or unexpected schema changes,
- `PRAGMA integrity_check` fails on the backup or after the operation,
- foreign-key consistency checks fail,
- disposable restore rehearsal fails,
- any unexpected migration-history conflict appears after the operation.

### 10.7 Restoration procedure
If rollback is triggered:
- stop unsafe writers against the database,
- restore the verified pre-operation backup over the active database using the documented backup file,
- verify the restored file SHA-256 matches the recorded backup checksum,
- verify `PRAGMA integrity_check` on the restored database,
- verify `_prisma_migrations` and relevant schema objects match the recorded pre-operation state,
- verify relevant row counts match the recorded pre-operation state,
- only then confirm whether the application may resume normal operation.

### 10.8 Stop and escalation conditions
Stop and escalate if:
- the backup cannot be verified,
- disposable restore rehearsal cannot be performed successfully,
- the intended final `_prisma_migrations` state cannot be achieved without unvalidated assumptions,
- the uniqueness implementation for `PasswordResetToken` is not fully resolved before touching the real database,
- any required safeguard is missing,
- the authorizing person has not explicitly approved the final history decision and final clean artifact content.

### 10.9 What was not created now
No real backup was created in this revision.
No real restore was rehearsed in this revision.
The tree above is a required precondition for any future real-database operation, not a completed safeguard.

---

## 11. Directly observed facts

- The real database contains an explicit unique index `PasswordResetToken_hashedToken_unique`.
- The real database does not have a table-level `UNIQUE("hashedToken")` in the `PasswordResetToken` CREATE TABLE SQL.
- Prisma `migrate resolve --applied` inserted exactly one completed history record per clean migration in Scenario 1.
- The contaminated record was retained unchanged through both resolves in Scenario 1.
- Scenario 1 smoke tests passed: `migrate status` and `migrate deploy` both reported the schema up to date and no pending migrations.
- Scenario 2 applied all seven clean migrations in order on a fresh disposable database.
- The fresh disposable database did not create the explicit unique index; it used an autoindex instead.
- Scenario 3 proved future migration usability on the reconciled existing branch and on the reconciled fresh branch when the test migration was present in the active tree.

---

## 12. Experiment-derived conclusions

- The Prisma-supported reconciliation mechanism requested in Revision 7 works in disposable environments for the exact history shape tested in Scenario 1.
- The reconciliation does not alter the existing schema when both clean migrations are treated as already applied.
- The exact reconciliation history tested here keeps the contaminated record and adds the two clean records.
- The fresh-install layout can reach a coherent schema, but that schema does not match the real database’s explicit unique index.
- Exact object-level equivalence between the real database and a fresh install depends on finalizing the clean S-09 artifact to create the explicit unique index.

---

## 13. Proposed recovery decisions

- Keep the contaminated completed record and represent S-14 and S-09 as already applied using `migrate resolve --applied` on the clean migration names.
- Retire the contaminated directory from the active migration path.
- Finalize the clean S-09 artifact to include the explicit unique index if exact historical recreation is required.
- Prepare real backups and restore rehearsal before any real-database operation.

---

## 14. Unproven assumptions and limits

- This revision tested only the exact disposable history shape used here.
- It does not prove every possible future migration will remain conflict-free.
- It does not prove that the explicit unique index must be retained forever for all future schema evolutions; that decision belongs to the final approved design.
- It does not authorize any real-database operation.
- The proposed final clean S-09 SQL in Section 7.7 was not applied here.
- Exact Prisma CLI and package versions are UNVERIFIED from a retained artifact in this turn.

---

## 15. Safety verification for the real project

### 15.1 Real project safety pass
- real DB SHA-256 unchanged: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- real DB size unchanged: `954368`
- real DB integrity: `ok`
- real DB FK check: `[]`
- real `_prisma_migrations` count unchanged: `6`
- real migration tree checksums unchanged: `true`
- contaminated directory still present in real tree: `true`
- clean S-14 directory NOT present in real tree: `true`
- clean S-09 directory NOT present in real tree: `true`
- test migration directory NOT present in real tree: `true`
- no disposable artifacts promoted into real project tree: `true`

Real project untouched by Revision 7: `true`

---

## 16. Disposable artifacts created in this revision

- `/tmp/rev7/work/` and all of its contents
- `prisma/disposable_scratch/sc1_final.db`
- `prisma/disposable_scratch/s2_fresh.db`
- `prisma/disposable_scratch/s3_sc1.db`
- `prisma/disposable_scratch/s3_sc2_fresh.db`
- `prisma/disposable_scratch/s3_sc2_fresh_v2.db`

Full disposable artifact inventory is in `revision7_disposable_artifact_inventory.json` in the disposable workspace.

---

## 17. Gate decision

**NOT READY FOR GATE 1 REVIEW**

### Reason
The disposable reconciliation mechanism works as tested, but exact final real-project readiness still requires:
- finalization of the clean S-09 artifact to reproduce the explicit unique index if exact historical recreation is required,
- explicit authorization for the final reconciliation decision for the real contaminated record,
- a real backup and restore rehearsal before any real-database operation,
- verification of Prisma CLI and package versions if this revision is to be considered complete.

This is experimental feasibility only, not implementation approval.

---

## 18. Authorization boundaries re-stated

This revision did not authorize:
- any write to `prisma/dev.db`,
- any migration command targeting the real database,
- any edit to real migration files or directories,
- any edit to `prisma/schema.prisma` or application code,
- any creation of real `migration_lock.toml`,
- any seed, build, server, or integration test against real resources,
- any S-09 or S-14 implementation,
- any real backup or restore.

All disposable commands in this revision used explicitly verified disposable database URLs and a disposable workspace outside the real project migration tree.
