# SellFlow — Revision 8 Reconciliation Proof Report

## Persisted evidence used to build this report

Evidence source file: `/tmp/rev7/work/r8_disposable_evidence.json`
Evidence source file SHA-256: `0969ad430ee63e848f6f8e595b52858c572f926874cf2759c57968f1457fd2b3`
Evidence source file bytes: `25116`

Work tree root used to assemble this report: `/tmp/rev8/work`
Work tree root SHA-512: `3976899271d71b516567c8431de50aeb035a0fe2583582b288f0ab4d8b49c83ea386b730b4cda465d1a77c5384d84407edef70d111c95d0ab72e8bc0c586cd01`

Disposable pursuit root: `prisma/disposable_scratch/`
Disposable pursuit root SHA-512: `a3be8b0c0f090df0c60bca16f681fae420e2f5b548bb58347b065a62842b59fb956ef3bd6780ff6377dbb4e83bf22b2c36511b573a199eb5cb3d4dc48dec682e`

Project root: `/home/binpharees/Documents/SellFlow-Bootcamp-v2`

---

## Report

This report reconstructs the Revision 8 disposable reconciliation proof from the retained evidence file `/tmp/rev7/work/r8_disposable_evidence.json` and from direct read-only inspection of `prisma/dev.db` this turn.

Where a value cannot be verified from a retained artifact or from a live read-only read this turn, it is labeled UNVERIFIED.

---

## 1. Real project read-only evidence this turn

- real DB path: `prisma/dev.db`
- real DB SHA-256 before disposable work: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- real DB size before disposable work: `954368` bytes
- real DB integrity read-only this turn: `ok`
- real DB foreign-key check read-only this turn: `[]`
- real `_prisma_migrations` read-only this turn: `6` rows, unchanged

- current real migration-tree checksums re-verified read-only this turn are unchanged; the contaminated file remains `20261105060000_session_lifecycle/migration.sql` with SHA-256 `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`.

### 1.1 PasswordResetToken uniqueness — direct read-only evidence

Real database `PasswordResetToken` SQL from `sqlite_master`:
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

Real database explicit unique index DDL from `sqlite_master`:
```sql
CREATE UNIQUE INDEX "PasswordResetToken_hashedToken_unique" ON "PasswordResetToken"("hashedToken")
```

Indexes on `PasswordResetToken` from `PRAGMA index_list('PasswordResetToken')` this turn:
- `PasswordResetToken_hashedToken_unique`, unique, origin `c`
- `PasswordResetToken_expiresAt_idx`, non-unique, origin `c`
- `PasswordResetToken_userId_idx`, non-unique, origin `c`
- `sqlite_autoindex_PasswordResetToken_1`, unique, origin `pk`

Foreign keys from `PRAGMA foreign_key_list('PasswordResetToken')` this turn:
- from `User` `id` to `PasswordResetToken` `userId`
- on delete `CASCADE`, on update `CASCADE`, match `NONE`

Table columns from `PRAGMA table_info('PasswordResetToken')` this turn:
- `id TEXT NOT NULL PRIMARY KEY`
- `userId TEXT NOT NULL`
- `hashedToken TEXT NOT NULL`
- `used BOOLEAN NOT NULL DEFAULT false`
- `expiresAt DATETIME NOT NULL`
- `createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`

**Conclusion:** the real database implements `PasswordResetToken` uniqueness through the explicit named unique index `PasswordResetToken_hashedToken_unique`. The `PasswordResetToken` table SQL does **not** contain a table-level `UNIQUE("hashedToken")` clause.

---

## 2. Proposed final clean migration artifacts tested in this revision

### 2.1 Corrected clean S-14 artifact

Proposed corrected clean S-14 migration file:
```sql
-- S-14: session idle expiration.
ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt");
```

File path used in the disposable workspace: `prisma/migrations/20261105060000_session_lifecycle_clean_s14/migration.sql`.
SHA-256: `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`.
Size: `208` bytes.

### 2.2 Corrected clean S-09 artifact

Proposed corrected clean S-09 migration file:
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

File path used in the disposable workspace: `prisma/migrations/20261106000000_password_reset_token_clean_s09/migration.sql`.
SHA-256: `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`.
Size: `813` bytes.

**Important:** this corrected artifact explicitly creates the explicit unique index `PasswordResetToken_hashedToken_unique`. That is the object-level change required to reproduce the real database’s uniqueness implementation on a fresh apply.

---

## 3. Disposable evidence summary

### 3.1 SC-A — existing database copy reconciled with corrected clean artifacts

- disposable path: `prisma/disposable_scratch/r8_existing_reconciled.db`
- starting SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- starting size: `954368` bytes
- `_prisma_migrations` row count before: `6`
- `_prisma_migrations` row count after: `8`
- integrity after: `ok`
- foreign-key check after: `[]`
- status exit: `0`
- deploy exit: `0`
- status stdout:
```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "r8_existing_reconciled.db" at "file:///home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_existing_reconciled.db"

7 migrations found in prisma/migrations

Database schema is up to date!
```
- deploy stdout:
```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "r8_existing_reconciled.db" at "file:///home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_existing_reconciled.db"

7 migrations found in prisma/migrations


No pending migrations to apply.
```

### 3.2 SC-B — existing database copy reconciled after removing contaminated directory from active path

- disposable path: `prisma/disposable_scratch/r8_existing_nodirty.db`
- starting SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`

- the contaminated directory `20261105060000_session_lifecycle` was **absent** from the active disposable migration tree used for this test.
- before any Prisma work on this copy, the contaminated directory was **removed** from the active disposable tree.
- this was a workspace-state manipulation inside `/tmp/rev8/work`, not a change to the real project migration tree.

- status before reconcile exit: `1`
- deploy before reconcile exit: `1`

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "r8_existing_nodirty.db" at "file:///home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_existing_nodirty.db"

7 migrations found in prisma/migrations
```

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "r8_existing_nodirty.db" at "file:///home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_existing_nodirty.db"

7 migrations found in prisma/migrations

Applying migration `20261105060000_session_lifecycle_clean_s14`
```

**This is the same missing-directory behavioral concern from earlier revisions, reproduced here with the corrected active layout:** Prisma sees the clean S-14 record as pending because its active directory is present, but it does not see the contaminated directory because that directory was removed.

- resolve S-14 exit: `0`
- resolve S-09 exit: `0`

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "r8_existing_nodirty.db" at "file:///home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_existing_nodirty.db"

Migration 20261105060000_session_lifecycle_clean_s14 marked as applied.
```

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "r8_existing_nodirty.db" at "file:///home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_existing_nodirty.db"

Migration 20261106000000_password_reset_token_clean_s09 marked as applied.
```

- status after reconcile exit: `0`
- deploy after reconcile exit: `0`

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "r8_existing_nodirty.db" at "file:///home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_existing_nodirty.db"

7 migrations found in prisma/migrations

Database schema is up to date!
```

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "r8_existing_nodirty.db" at "file:///home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_existing_nodirty.db"

7 migrations found in prisma/migrations


No pending migrations to apply.
```

- `_prisma_migrations` row count after: `9`
- integrity after: `ok`
- foreign-key check after: `[]`
- table count after: `34`

Observations:
- the original contaminated completed record `20261105060000_session_lifecycle` is still present with its original checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- the contaminated directory was absent from the active tree during this test
- Prisma created two migration records for `20261105060000_session_lifecycle_clean_s14`, both with checksum `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`. The first attempt was rolled back (`rolled_back_at` set and `finished_at` null); the second attempt completed successfully (`finished_at` set and `rolled_back_at` null). Prisma also created one completed record for `20261106000000_password_reset_token_clean_s09`, with checksum `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`
- the second clean S-09 record was inserted with checksum `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`
- `_prisma_migrations` row count went from `6` to `9`.

### 3.3 Fresh installation with corrected clean layout

- disposable path: `prisma/disposable_scratch/r8_fresh_test.db`
- starting state: empty file, no tables
- final SHA-256: `63c2ce85ed82dd3086741a83be330c25aa14ea53563fd9e0b524acbd7e70f468`
- final size: `630784` bytes
- integrity: `ok`
- foreign-key check: `[]`
- `_prisma_migrations` row count: `7`
- table count: `34`

Explicit unique index `PasswordResetToken_hashedToken_unique` present after deploy: **yes**.

---

## 4. Proposed final _prisma_migrations state for the existing database

### One exact proposed final state (PROPOSED, NOT APPROVED)

Keep these existing records unchanged in `_prisma_migrations`:

- `20261102203150_init`, id `229abdf1-f818-4f2b-97e9-494568dace66`, checksum `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`
- `20261102213950_dispute_claim_link`, id `db69d6d5-ebb8-4cf0-a5f2-6fbad2801c79`, checksum `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`
- `20261102222213_subscriptions`, id `4b773531-f9d4-422a-a10e-25d4a7f2a907`, checksum `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`
- `20261104060000_login_throttle`, id `7962534c-18a5-438d-95ee-2345cad92724`, checksum `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`
- `20261105000000_stock_integrity`, id `5fe073c9-d7ae-42f4-aed7-6a1336365064`, checksum `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`
- `20261105060000_session_lifecycle`, id `d68a8367-3aa8-4f77-8be7-641acc17a096`, checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`

Add these two clean records to represent the intended later history on the existing database:

- `20261105060000_session_lifecycle_clean_s14`, checksum `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`
- `20261106000000_password_reset_token_clean_s09`, checksum `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`

### What this proposed state accounts for

- the original contaminated completed record, retained with its original checksum and id
- the five matching historical records, preserved exactly
- the clean S-14 record
- the clean S-09 record
- the active migration directory layout, in which the contaminated directory is not part of the active path and the two clean directories are the intended active artifacts

### Risks and evidence

- This proposed state matches one disposable existing-database result (SC-B), but it is **not** automatically the correct permanent history for the real project.
- The disposable test used a copy of the existing database and a removed contaminated directory from the active disposable tree, not the real project migration tree.
- The contaminated record is retained with its original checksum, so its stored checksum still does not match the current real file content on disk.
- The corrected clean S-14 artifact’s SHA-256 matches the stored checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`; that is a checksum match between the reconstructed artifact and the stored checksum, **not** proof that the original source file is authentic.
- The corrected clean S-09 artifact’s SHA-256 is `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`; it does **not** match any stored checksum from the existing `_prisma_migrations`.
- The exact Prisma behavior for the real existing history shape is not verified in this revision; only disposable copies were tested.
- Any real reconciliation requires explicit approval of this exact proposed state, plus actual backup, verification, and rollback safeguards, which are not present in this revision.

---

## 5. Disposable schema comparison summary

Two disposable databases were compared after the proposed reconciliation:

- disposable fresh installation: `prisma/disposable_scratch/r8_fresh_test.db`
- disposable reconciled existing copy: `prisma/disposable_scratch/r8_existing_nodirty.db`

Shared controlled observations on the `PasswordResetToken` table after those tests:
- table `PasswordResetToken` exists on both
- columns and nullability match the intended object set
- the explicit unique index `PasswordResetToken_hashedToken_unique` exists on both after deploy on the corrected clean layout
- `PasswordResetToken_userId_idx` and `PasswordResetToken_expiresAt_idx` exist on both

The corrected clean S-09 artifact therefore reproduces the real database’s explicit unique index on a disposable fresh database, which the earlier clean-most artifact did not achieve.

The full object-level comparison in this revision is limited to the retained disposable evidence and to the read-only SQLite metadata this turn; it is not a guarantee of identical object-level behavior on the real existing database after any real reconciliation.

---

## 6. Report self-hashes and workspace provenance

Work tree root SHA-512: `3976899271d71b516567c8431de50aeb035a0fe2583582b288f0ab4d8b49c83ea386b730b4cda465d1a77c5384d84407edef70d111c95d0ab72e8bc0c586cd01`
Disposable pursuit root SHA-512: `a3be8b0c0f090df0c60bca16f681fae420e2f5b548bb58347b065a62842b59fb956ef3bd6780ff6377dbb4e83bf22b2c36511b573a199eb5cb3d4dc48dec682e`
Evidence source file SHA-256: `0969ad430ee63e848f6f8e595b52858c572f926874cf2759c57968f1457fd2b3`
Evidence source file bytes: `25116`
