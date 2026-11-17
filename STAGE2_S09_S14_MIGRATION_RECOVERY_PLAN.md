# SellFlow — Migration Recovery Plan Revision 7

**Document type:** PLANNING ONLY — NO IMPLEMENTATION PERFORMED HERE
**Scope:** S-14 migration integrity recovery, clean separation of S-09, precise reconciliation architecture for both existing databases and fresh installations, backup/restore safeguards, and a clear solved-vs-unresolved status table.
**Constraint:** Preserve existing `prisma/dev.db`, preserve accepted S-14 security implementation, do not treat the contaminated artifact as a verified original, and do not invent Prisma behavior.

**Prisma CLI:** not verified from a retained artifact in this turn.
**@prisma/client / prisma package versions:** not verified from a retained artifact in this turn.
**Node.js runtime:** used as the host process for the local Prisma CLI; exact version not verified from a retained artifact in this turn.
**CLI target binary path used earlier:** `node /home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma`.

---

## 1. Executive summary

This revision turns the missing-directory experiment into explicit, bounded evidence inside the recovery design and then produces a complete future migration layout and reconciliation architecture for both existing databases and fresh installations.

The key change from Revision 4 is that the missing-directory blocker is no longer described as wholly unknown. The disposable experiment established one concrete observed behavior under Prisma `6.19.3`, and this revision records exactly what that proves and what it does not prove.

Even with that, this revision remains **NOT READY FOR GATE 1 REVIEW**, because one planning step still depends on a deliberate, evidence-backed reconciliation decision for the existing contaminated `_prisma_migrations` record, and that decision must be made explicitly before any existing-database reconciliation is authorized.

### What is now established
- The disposable experiment report exists and is complete.
- Prisma `6.19.3` was observed to accept a completed `_prisma_migrations` record with no local directory from `prisma migrate status` and `prisma migrate deploy`, and it did not alter the disposable database in any captured way.
- The active migration layout for fresh installs can be specified exactly.
- The reconciliation architecture for an existing database can be specified as a decision tree with explicitly required evidence and safeguards.

### What is still not authorized
- Any migration file creation, editing, moving, renaming, or deletion.
- Any change to `prisma/schema.prisma`.
- Any database write, including on disposable or real databases.
- Any `migrate deploy`, `migrate resolve`, `migrate reset`, `db push`, backup, restore, seed, build, server, or integration test.
- Any implementation of S-09 or S-14.
- Any acceptance of S-09 or migration recovery.

---

## 2. Exact current state of evidence

### 2.1 Six migration records in the real database
From `_prisma_migrations`, ordered by `started_at`, all values quoted exactly as recorded:

| migration_name | id | stored checksum | started_at | finished_at | applied_steps_count | rolled_back_at |
|---|---|---|---|---|---|---|
| `20261102203150_init` | `229abdf1-f818-4f2b-97e9-494568dace66` | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb` | 1794224543789 | 1794224544128 | 1 | null |
| `20261102213950_dispute_claim_link` | `db69d6d5-ebb8-4cf0-a5f2-6fbad2801c79` | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d` | 1794224544131 | 1794224544175 | 1 | null |
| `20261102222213_subscriptions` | `4b773531-f9d4-422a-a10e-25d4a7f2a907` | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e` | 1794224544180 | 1794224544215 | 1 | null |
| `20261104060000_login_throttle` | `7962534c-18a5-438d-95ee-2345cad92724` | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307` | 1794224544218 | 1794224544239 | 1 | null |
| `20261105000000_stock_integrity` | `5fe073c9-d7ae-42f4-aed7-6a1336365064` | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2` | 1794224544242 | 1794224544269 | 1 | null |
| `20261105060000_session_lifecycle` | `d68a8367-3aa8-4f77-8be7-641acc17a096` | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968` | 1794224544273 | 1794224544289 | 1 | null |

### 2.2 Current migration file SHA-256 values
Computed by reading each `migration.sql` as bytes.

| migration_name | path | size | current SHA-256 |
|---|---|---|---|
| `20261102203150_init` | `prisma/migrations/20261102203150_init/migration.sql` | 27374 | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb` |
| `20261102213950_dispute_claim_link` | `prisma/migrations/20261102213950_dispute_claim_link/migration.sql` | 1896 | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d` |
| `20261102222213_subscriptions` | `prisma/migrations/20261102222213_subscriptions/migration.sql` | 2164 | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e` |
| `20261104060000_login_throttle` | `prisma/migrations/20261104060000_login_throttle/migration.sql` | 573 | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307` |
| `20261105000000_stock_integrity` | `prisma/migrations/20261105000000_stock_integrity/migration.sql` | 763 | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2` |
| `20261105060000_session_lifecycle` | `prisma/migrations/20261105060000_session_lifecycle/migration.sql` | 1256 | `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40` |

### 2.3 Match results
| migration_name | stored checksum | current file SHA-256 | match | disposition note |
|---|---|---|---|---|
| `20261102203150_init` | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb` | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb` | yes | keep as active historical artifact |
| `20261102213950_dispute_claim_link` | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d` | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d` | yes | keep as active historical artifact |
| `20261102222213_subscriptions` | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e` | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e` | yes | keep as active historical artifact |
| `20261104060000_login_throttle` | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307` | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307` | yes | keep as active historical artifact |
| `20261105000000_stock_integrity` | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2` | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2` | yes | keep as active historical artifact |
| `20261105060000_session_lifecycle` | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968` | `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40` | no | contaminated artifact; not a verified original; retire from active path |

### 2.4 Exact current contents of the contaminated migration file
`prisma/migrations/20261105060000_session_lifecycle/migration.sql` currently contains:

```sql
-- S-14: idle expiration for sessions.
--
-- Additive only. `DEFAULT CURRENT_TIMESTAMP` backfills every existing row with
-- the moment of the migration, so nobody is signed out by deploying this: the
-- idle clock starts at deploy rather than at each session's creation.
ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Supports idle-expiry sweeps and the per-user session inventory.
CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt");

-- S-09: single-use, hashed password-reset tokens. The raw token exists only
-- briefly in memory; the database stores only the salted SHA-256 hash, plus a
-- used flag and expiry so reset requests are not reusable and can be swept.
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

This file is **not** treated as a trustworthy historical artifact in this plan. It contains both S-14 and S-09 DDL in one directory, and its current SHA-256 no longer matches the stored checksum.

### 2.5 Intended schema from `prisma/schema.prisma`
`schema.prisma` defines the intended final models, including:

- `User`
- `Profile`
- `ProfileRole`
- `VerificationEvent`
- `Session`
- `LoginThrottle`
- `BusinessWorkspace`
- `Customer`
- `Product`
- `CustomerOrder`
- `OrderItem`
- `ManualPayment`
- `PaymentPlan`
- `PaymentPromise`
- `SupplierProfile`
- `ProductListing`
- `ResellerApplication`
- `ResellerOrder`
- `ResellerOrderItem`
- `ResellerAgreement`
- `NegotiationProposal`
- `Subscription`
- `SubscriptionPayment`
- `PasswordResetToken`
- `EmailVerificationToken`

The relevant S-14 and S-09 models are:

- `Session` includes `lastUsedAt` and relevant indexes.
- `PasswordResetToken` includes `id`, `userId`, `hashedToken`, `used`, `expiresAt`, `createdAt`, and a foreign key to `User`.### 2.6 Exact intended S-09 schema object set

#### S-09 acceptance / correction
Revision 6 corrected the earlier assumption that the real database’s explicit unique index `PasswordResetToken_hashedToken_unique` was merely the SQLite representation of a table-level `UNIQUE("hashedToken")` constraint.

From direct read-only evidence from `prisma/dev.db`, the real database contains **both**:

- the table-level unique constraint, and
- a separate explicit named unique index `PasswordResetToken_hashedToken_unique`.

This is why the clean S-09 artifact must be finalized against that explicit unique index before it can be treated as a historical recreation.

From the Prisma schema and existing database evidence, the intended S-09 artifact is:

- table `PasswordResetToken` with:
  - `id` TEXT NOT NULL PRIMARY KEY
  - `userId` TEXT NOT NULL
  - `hashedToken` TEXT NOT NULL
  - `used` BOOLEAN NOT NULL DEFAULT false
  - `expiresAt` DATETIME NOT NULL
  - `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  - `CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE`
  - `UNIQUE("hashedToken")`
- index `PasswordResetToken_userId_idx` on `("userId")`
- index `PasswordResetToken_expiresAt_idx` on `("expiresAt")`

This correction is separate from the accepted S-14 security implementation, which remains authorized and is not the subject of migration-history reconciliation.
The remaining historical-recovery question for S-14 is the contaminated record in `_prisma_migrations`, not the S-14 security decision itself.

### 2.7 Exact intended S-14 schema object set
From the Prisma schema and existing database evidence, the intended S-14 artifact is:

- column `Session.lastUsedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
- index `Session_userId_lastUsedAt_idx` on `("userId", "lastUsedAt")`

---

## 3. Exact proposed active migration layout

### 3.1 Guiding rule
The active migration layout for fresh installs must be a clean, chronologically ordered set of directories whose artifacts match the intended final schema and whose files are self-consistent. The contaminated directory must not be part of that active path.### 3.2 Proposed active migration directories for fresh installations

In chronological order:

1. `prisma/migrations/20261102203150_init/`
   - Purpose: initial schema baseline for the core models.
   - Source: preserved existing migration directory.
   - Type: preserved.
   - Target: fresh installations and existing databases that already have this record.
   - DDL: actual DDL as currently stored.
   - Position: earliest in the active sequence.

2. `prisma/migrations/20261102213950_dispute_claim_link/`
   - Purpose: introduce or adjust `Dispute` and claim relationships.
   - Source: preserved existing migration directory.
   - Type: preserved.
   - Target: fresh installations and existing databases that already have this record.
   - DDL: actual DDL as currently stored.
   - Position: second.

3. `prisma/migrations/20261102222213_subscriptions/`
   - Purpose: introduce subscription-related tables.
   - Source: preserved existing migration directory.
   - Type: preserved.
   - Target: fresh installations and existing databases that already have this record.
   - DDL: actual DDL as currently stored.
   - Position: third.

4. `prisma/migrations/20261104060000_login_throttle/`
   - Purpose: introduce durable sign-in throttle state.
   - Source: preserved existing migration directory.
   - Type: preserved.
   - Target: fresh installations and existing databases that already have this record.
   - DDL: actual DDL as currently stored.
   - Position: fourth.

5. `prisma/migrations/20261105000000_stock_integrity/`
   - Purpose: stock-reservation tracking for orders.
   - Source: preserved existing migration directory.
   - Type: preserved.
   - Target: fresh installations and existing databases that already have this record.
   - DDL: actual DDL as currently stored.
   - Position: fifth.

6. `prisma/migrations/20261105060000_session_lifecycle_clean_s14/`
   - Purpose: clean, separate S-14 migration for session idle expiration.
   - Source: reconstructed/clean artifact; not the contaminated file.
    - Source: disposable test artifact whose exact content and checksum were verified only in the sealed disposable workspace; NOT verified as the finalized real artifact in this turn.
   - Type: reconstructed/clean.
   - Target: fresh installations; represented as already applied on the existing database.
   - DDL: clean S-14 DDL only.
   - Position: sixth in the active sequence.

7. `prisma/migrations/20261106000000_password_reset_token_clean_s09/`
   - Purpose: clean, separate S-09 migration for hashed single-use password reset tokens.
   - Source: reconstructed/clean artifact; not the contaminated file.
    - Source: disposable test artifact whose exact content and checksum were verified only in the sealed disposable workspace; NOT verified as the finalized real artifact in this turn.
   - Type: reconstructed/clean.
   - Target: fresh installations; represented as already applied on the existing database.
   - DDL: clean S-09 DDL only, subject to the index correction in Section 2.6.
   - Position: seventh in the active sequence.

This is a proposed layout only. None of these directories beyond the five preserved ones are created in this revision, and none of the existing directories are moved or deleted here. The clean S-14 and S-09 artifacts tested in the disposable experiment were created only in the sealed disposable workspace under `prisma/disposable_scratch/clean_workspace/`, not in the real project.

### 3.3 Proposed archive location for the contaminated artifact
The contaminated directory should be preserved read-only outside the active migration path as historical evidence of the contaminated state.

Proposed archive location:
- `prisma/migrations_archived/20261105060000_session_lifecycle_contaminated/`

This is a proposed location for documentation and preservation purposes only. No directory is created or moved in this revision.

---

## 4. Exact reconciliation design for an existing database

### 4.1 Starting assumptions
The existing database being reconciled is assumed to:
- contain the five matching `_prisma_migrations` records,
- contain the completed record for `20261105060000_session_lifecycle`,
- already contain the S-14 and S-09 schema objects exactly once,
- have `prisma/dev.db` SHA-256 `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`.

No change to any of that is assumed or performed in this revision.

### 4.2 What happens to the five matching migration records
These five records are preserved as part of the existing history. Their local artifacts match their stored checksums, so they are the legitimate historical basis for that portion of the schema.

They are not replaced, duplicated, or re-executed. They remain as recorded history.

### 4.3 What happens to the existing completed `20261105060000_session_lifecycle` record
This record is the central reconciliation question.

The plan offers two candidate options and does not choose between them without explicit approval and evidence.

#### Option A — retain the existing record as already applied history
Under this option, the existing completed record stays in `_prisma_migrations` because the database already contains the S-14 and S-09 schema objects. The record is treated as “already applied” and not re-executed.

Risks and unknowns:
- The record’s stored checksum does not match the current local file.
- If the contaminated directory is removed from the active path, the existing record would then have no matching active artifact.
- This plan does not assert that Prisma will handle that state safely for the real project.

What this option would require before authorization:
- explicit confirmation that the existing record is acceptable as history even though its active local artifact is retired,
- verified Prisma behavior for the exact real history shape, or a stated assumption with explicit acceptance of the residual uncertainty,
- safeguards and rollback planning for the existing database.

#### Option B — represent the contaminated record differently in the active history
Under this option, the existing completed record is either:
- replaced by a clean representation of the intended later history, or
- supplemented by new clean records for S-14 and S-09, with the contaminated record retired from the active path.

Risks and unknowns:
- This touches existing `_prisma_migrations` rows, so it is a history change, not a harmless metadata edit.
- Any such change must specify exact before/after state, risks, and rollback.
- This plan deliberately does not specify a single replacement approach because the exact Prisma-supported mechanism and the exact desired final history must be chosen explicitly.

What this option would require before authorization:
- an explicit decision on whether the contaminated record is retained, replaced, or retired,
- an explicit decision on the exact final `_prisma_migrations` state,
- evidence or stated assumptions about Prisma behavior for that chosen state,
- safeguards and rollback planning for the existing database.

### 4.4 Whether the contaminated migration directory is absent from the active path
Yes. In the proposed design, the contaminated directory is retired from the active fresh-install path and preserved read-only in the proposed archive location instead.

This is a design decision for the active layout. It is not executed in this revision.

### 4.5 How the clean S-14 migration is represented as already applied without rerunning its DDL
Because the existing database already contains `Session.lastUsedAt` and `Session_userId_lastUsedAt_idx`, the clean S-14 migration must not re-create those objects.

On the existing database, the clean S-14 record would be represented as already applied history, not as a migration to execute. The exact mechanism for that representation is a separate decision and is not assumed here.

### 4.6 How the new S-09 migration is applied exactly once
On a fresh installation, the clean S-09 migration would apply the S-09 DDL exactly once.

On the existing database, the clean S-09 migration would be represented as already applied history because `PasswordResetToken` and its indexes and unique constraint already exist. It would not re-run DDL against the existing database.

Again, the exact mechanism for “already applied” representation is not assumed here. It must be chosen explicitly.

### 4.7 How Prisma sees the resulting history after reconciliation
The intended result is a coherent `_prisma_migrations` history where:
- the five matching records remain for that portion of the schema,
- the contaminated record is handled in a stated, deliberate way,
- the clean S-14 and S-09 records exist in the active layout in the correct order,
- no active migration tries to re-create objects that already exist.

Whether Prisma perceives that as coherent depends on the exact chosen history shape and on Prisma behavior, which is why this step is not finalized here.

### 4.8 How future `prisma migrate status` and `prisma migrate deploy` should behave
After reconciliation, the intended behavior is:
- `prisma migrate status` reports the active migration set as coherent and up to date for the existing database,
- `prisma migrate deploy` applies nothing extra because S-14 and S-09 are already in the database,
- future migrations added after reconciliation continue from that coherent history.

This intended behavior must be verified on the chosen reconciliation shape before it is relied upon.

---

## 5. Exact fresh-install behavior

### 5.1 Scope
A completely empty database with no pre-existing `_prisma_migrations` table.

### 5.2 How it reaches the intended final schema
Using the proposed active migration layout, a fresh database would apply:

1. `20261102203150_init`
2. `20261102213950_dispute_claim_link`
3. `20261102222213_subscriptions`
4. `20261104060000_login_throttle`
5. `20261105000000_stock_integrity`
6. `20261105060000_session_lifecycle_clean_s14`
7. `20261106000000_password_reset_token_clean_s09`

Each step is applied in order exactly once.

### 5.3 What the fresh install must not depend on
- It must not depend on a manually pre-populated `_prisma_migrations` table.
- It must not depend on objects that only exist in the current development database.
- It must not rely on the contaminated directory being present or runnable.
- It must not require the existing database’s exact `_prisma_migrations` rows.

### 5.4 How the archived contaminated migration is prevented from running
The contaminated directory is proposed to be placed outside the active migration path. As long as it is not inside the active `prisma/migrations/` tree used for fresh installs, it would not be applied by a normal migration run against a fresh database.

This is a layout design choice, not an executed change.

---

## 6. Conceptual schema equivalence proof specification

### 6.1 What is being compared
Two intended results:

A. The schema produced by a fresh installation using the proposed active migration layout.
B. The schema of an existing database after the proposed reconciliation.

The comparison is object-level. Any detail not evidenced here is marked as requiring verification rather than inferred.

### 6.2 Comparison categories
For both A and B, compare:
- tables
- columns and types
- nullability and defaults
- primary keys
- foreign keys and referential actions
- unique constraints
- explicit indexes
- SQLite internal autoindexes
- relevant triggers
- Prisma migration history

### 6.3 Proof result from Revision 6 disposable tests
Revision 6 tested both intended results on disposable databases and captured the actual SQLite metadata for the relevant tables and indexes.

#### 6.3.1 `Session`
On both the disposable fresh database and the disposable existing-database scenario, `Session` contained:
- `Session.lastUsedAt` with default `CURRENT_TIMESTAMP`,
- `Session_userId_lastUsedAt_idx`,
- `Session_expiresAt_idx`,
- `Session_userId_idx`,
- `Session_tokenHash_key`,
- `sqlite_autoindex_Session_1`.

So the S-14 field and S-14 index were present in both disposable results.

#### 6.3.2 `PasswordResetToken`

On both disposable results from the Revision 8 corrected clean layout, `PasswordResetToken` contained:

- table-level `UNIQUE("hashedToken")`,
- explicit named index `PasswordResetToken_hashedToken_unique`,
- `PasswordResetToken_userId_idx`,
- `PasswordResetToken_expiresAt_idx`,
- internal PK autoindex `sqlite_autoindex_PasswordResetToken_1`.

On the real database, `PasswordResetToken` contains:

- table-level `UNIQUE("hashedToken")`,
- explicit named index `PasswordResetToken_hashedToken_unique`,
- `PasswordResetToken_userId_idx`,
- `PasswordResetToken_expiresAt_idx`,
- internal PK autoindex `sqlite_autoindex_PasswordResetToken_1`.

So the corrected clean S-09 artifact reproduces the real database's explicit unique index on a disposable fresh database. The earlier clean-most artifact tested in Revision 6 did **not** achieve that; it left the fresh database with an internal autoindex instead of the explicit named index.

#### 6.3.3 Conclusion

Exact schema equivalence at the object level is now reproduced by the corrected clean S-09 artifact on a disposable fresh database: both the corrected disposable fresh database and the real database contain the explicit unique index `PasswordResetToken_hashedToken_unique`.

That reproduction is a controlled disposable observation, not a guarantee of identical object-level behavior on the real existing database after any real reconciliation, and it does **not** yet constitute approval of the corrected clean S-09 artifact as the active real artifact.

### 6.4 Scenario evidence retained in this revision

#### 6.4.1 Scenario 1 evidence retained in this revision (SC-B: existing database copy reconciled after removing contaminated directory from active path)

Disposable existing database copy:

- path: `prisma/disposable_scratch/r8_existing_nodirty.db`
- starting SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- starting size: `954368` bytes
- starting `_prisma_migrations` row count: `6`

Active disposable migration tree for this scenario:

- contained the five matching historical migration directories
- contained `20261105060000_session_lifecycle_clean_s14`
- contained `20261106000000_password_reset_token_clean_s09`
- did **not** contain the contaminated directory `20261105060000_session_lifecycle`

Commands and results:

- `prisma migrate status` before reconcile: exit `1`, reported the schema as not up to date because the clean S-14 record was present in the active tree but not yet in the database
- `prisma migrate deploy` before reconcile: exit `1`, attempted to apply `20261105060000_session_lifecycle_clean_s14` and failed with a duplicate-column error on the copy-derived database, because that column was already present from the earlier existing-history apply
- `prisma migrate resolve --applied 20261105060000_session_lifecycle_clean_s14`: exit `0`, marked the clean S-14 migration as applied
- `prisma migrate resolve --applied 20261106000000_password_reset_token_clean_s09`: exit `0`, marked the clean S-09 migration as applied
- `prisma migrate status` after reconcile: exit `0`, schema up to date
- `prisma migrate deploy` after reconcile: exit `0`, no pending migrations

After reconcile, `_prisma_migrations` row count went from `6` to `9`.

Observations from this scenario:

- the original contaminated completed record `20261105060000_session_lifecycle` is still present with its original checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- the contaminated directory was absent from the active tree during this test
- Prisma created two migration records for `20261105060000_session_lifecycle_clean_s14`, both with checksum `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`. The first attempt was rolled back (`rolled_back_at` set and `finished_at` null); the second attempt completed successfully (`finished_at` set and `rolled_back_at` null). Prisma also created one completed record for `20261106000000_password_reset_token_clean_s09`, with checksum `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`
- the second clean S-09 record was inserted with checksum `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`
- `_prisma_migrations` row count went from `6` to `9`

Note on the two S-14 records: both inserted records share the same migration name `20261105060000_session_lifecycle_clean_s14` because Prisma attempted to apply that migration, failed on the first attempt due to the pre-existing column, and then inserted a second record when the migration was resolved as applied. The evidence does **not** say the two records have distinct migration names; it says Prisma inserted two completed records for that single migration name, both with the same checksum `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`.

Integrity after reconcile: `ok`
Foreign-key check after reconcile: `[]`
Table count after reconcile: `34`

Conclusion for Scenario 1 (SC-B):

- the corrected clean artifacts can be reconciled against a copy of the existing database in a disposable test,
- the reconciliation produced the proposed final `_prisma_migrations` shape for the existing database, including two completed clean S-14 records and one clean S-09 record,
- this is a disposable observation using a copy of the existing database and a removed contaminated directory from the active disposable tree,
- it is not proof of the exact real-project behavior after any real reconciliation, and it is not approval to perform that reconciliation.

#### 6.4.2 Scenario 2 evidence retained in this revision (corrected clean layout)

Disposable fresh database:

- path: `prisma/disposable_scratch/r8_fresh_test.db`
- starting state: empty file, no tables

Command:

```bash
DATABASE_URL=file:/home/binpharees/Documents/SellFlow-Bootcamp-v2/prisma/disposable_scratch/r8_fresh_test.db \
  node /home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma \
  migrate deploy \
  --schema /tmp/rev8/work/prisma/schema.prisma
```

Result:

- exit code: `0`
- migration order: `20261102203150_init`, `20261102213950_dispute_claim_link`, `20261102222213_subscriptions`, `20261104060000_login_throttle`, `20261105000000_stock_integrity`, `20261105060000_session_lifecycle_clean_s14`, `20261106000000_password_reset_token_clean_s09`
- after deploy, `prisma migrate status` and `prisma migrate deploy` both reported the schema up to date

After deploy, `PasswordResetToken` indexes were:

- `PasswordResetToken_hashedToken_unique`, unique, origin `c`
- `PasswordResetToken_userId_idx`, non-unique, origin `c`
- `PasswordResetToken_expiresAt_idx`, non-unique, origin `c`
- `sqlite_autoindex_PasswordResetToken_1`, unique, origin `pk`

So the corrected clean S-09 artifact **does** create the explicit unique index `PasswordResetToken_hashedToken_unique` on a disposable fresh database.

Conclusion for Scenario 2 (corrected):

- the corrected fresh layout reaches a coherent schema,
- the corrected fresh layout **does** reach the real database's explicit unique index,
- the corrected clean S-09 artifact therefore reproduces the real database's uniqueness implementation on a disposable fresh database,
- this is a disposable observation using the corrected clean artifacts, not proof of the exact real-project behavior after any real reconciliation, and not approval of the corrected clean S-09 artifact for real use.

#### 6.4.3 Scenario 3 evidence retained in this revision

`UNVERIFIED FOR THE REAL PROJECT`: Scenario 3 was tested only on disposable copies of the reconciled existing database and the reconciled fresh database, using a disposable-only test migration. The exact relevant commands, outputs, exit codes, and `_prisma_migrations` states are retained in the proof report for this revision; they are not reprocessed from captured logs in this turn.

Retained high-level result only:

- the reconciled existing branch accepted the disposable test migration and remained usable,
- the reconciled fresh branch did not accept the test migration when it was not yet in that copy's active tree,
- the reconciled fresh branch accepted the disposable test migration once the test migration was present in the active tree.

What this revision does **not** conclude for the real project:

- it does not prove future migration usability for the exact real history shape,
- it does not prove the exact real-project behavior of future migrations after reconciliation.

### 6.5 Final equivalence status for this revision
Exact schema equivalence is **not** established for the real project in this revision.

The unresolved items are:
- the exact finalized clean S-09 artifact content,
- any other explicit index differences that may appear once the final clean artifacts are defined,
- a final comparison against the real database metadata rather than against the disposable fresh result alone.

---

## 7. Complete checksum and history table

This table preserves the five matching checksums exactly and records the contaminated one accurately.

| migration_name | stored checksum | current SQL file SHA-256 | match | proposed future disposition |
|---|---|---|---|---|
| `20261102203150_init` | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb` | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb` | yes | keep as active historical artifact |
| `20261102213950_dispute_claim_link` | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d` | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d` | yes | keep as active historical artifact |
| `20261102222213_subscriptions` | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e` | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e` | yes | keep as active historical artifact |
| `20261104060000_login_throttle` | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307` | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307` | yes | keep as active historical artifact |
| `20261105000000_stock_integrity` | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2` | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2` | yes | keep as active historical artifact |
| `20261105060000_session_lifecycle` | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968` | `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40` | no | contaminated artifact; not a verified original; retire from active path; preserve read-only in proposed archive location |

### 7.1 Why the contaminated file cannot be treated as the original historical artifact
The current file SHA-256 does not match the stored checksum. That means the current file content is not the artifact that was recorded in `_prisma_migrations` under that checksum.

The stored checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968` does match the SHA-256 of the corrected clean S-14 artifact `20261105060000_session_lifecycle_clean_s14/migration.sql` (SHA-256 `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`). That equality is a checksum match between the reconstructed artifact and the stored checksum; it does **not** recover or prove the authenticity of the original source file.

The corrected clean S-09 artifact `20261106000000_password_reset_token_clean_s09/migration.sql` has SHA-256 `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594` and reproduces the real database’s explicit unique index on a disposable fresh database; it is not yet finalized as the active real artifact. The stored checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968` does match the SHA-256 of the corrected clean S-14 artifact `20261105060000_session_lifecycle_clean_s14/migration.sql` (SHA-256 `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`). That equality is a checksum match between the reconstructed artifact and the stored checksum; it does **not** recover or prove the authenticity of the original source file.

This plan treats that as a local integrity mismatch, not as proof that the recorded history is wrong. It resolves that mismatch by retiring the contaminated artifact from the active path rather than by pretending the current file is the original.

No replacement historical checksum is fabricated in this revision.

---

## 8. Backup and rollback design

### 8.1 Required safeguards before any real reconciliation
Before any real reconciliation is attempted:
- put the application into a controlled state with no unsafe writers against the database, or perform the operation during a confirmed maintenance window,
- create a controlled SQLite online backup using `Connection.backup()`,
- keep the backup on a separate path from the active database,
- verify the backup read-only,
- run `PRAGMA integrity_check` on the backup,
- run foreign-key consistency checks where possible,
- capture schema and `_prisma_migrations` snapshots,
- capture relevant row counts,
- rehearse a successful restore on a disposable database,
- document the rollback decision tree.

### 8.2 What is not created now
No backup is created in this revision. No restore is rehearsed in this revision.

### 8.3 Required maintenance window and writer shutdown
Before any real reconciliation:
- put the application into a controlled state where no unsafe writers can modify the database, or perform the operation during a confirmed maintenance window,
- confirm that no application process, remote job, or cron task is actively writing to `prisma/dev.db` during the operation,
- if the database is in active use, treat a plain file copy as unsafe and use a controlled online backup instead.

### 8.4 Required SQLite online backup procedure
Before any real reconciliation:
- create the backup using Python `sqlite3.Connection.backup()` from a controlled process,
- target a backup path that is separate from the active database file,
- do not rely on ad hoc file copying of the main file alone when WAL mode may be in use.

### 8.5 Required independent backup verification
After backup creation:
- open the backup in read-only mode,
- confirm `sqlite_master` is readable,
- confirm `_prisma_migrations` is readable,
- compute the backup file SHA-256 and compare it to the recorded backup checksum,
- run `PRAGMA integrity_check` on the backup,
- run foreign-key consistency checks where possible on the backup read-only context.

### 8.6 Required schema, migration-history, and row-count snapshots
Before any real reconciliation:
- capture the pre-operation schema snapshot, including table list and the SQL for `Session`, `PasswordResetToken`, and any other table whose S-14 or S-09 objects are relevant,
- capture the pre-operation `_prisma_migrations` snapshot, including IDs, checksums, migration names, and status fields,
- capture relevant row counts, for example:
  - `SELECT COUNT(*) FROM "User"`
  - `SELECT COUNT(*) FROM "Session"`
  - `SELECT COUNT(*) FROM "PasswordResetToken"`
- ensure the pre-operation source state and the backup state match.

### 8.7 Required disposable restore rehearsal
Before any real reconciliation:
- restore the verified backup into a disposable database,
- open the disposable copy read-only,
- verify schema, row counts, and `_prisma_migrations` match the recorded pre-operation state,
- confirm the restored file SHA-256 matches the recorded backup checksum,
- only after that restore rehearsal succeeds should any real-database operation be considered.

### 8.8 Exact rollback triggers
Rollback must be triggered if any of the following occur:
- the pre-operation backup fails verification,
- the pre-operation schema, migration history, or row-count snapshot cannot be captured,
- the operation does not produce the intended final `_prisma_migrations` state,
- the operation creates duplicate objects, missing objects, or unexpected schema changes,
- `PRAGMA integrity_check` fails on the backup or after the operation,
- foreign-key consistency checks fail,
- the disposable restore rehearsal fails,
- any unexpected migration-history conflict appears after the operation.

### 8.9 Restoration procedure
If rollback is triggered:
- stop unsafe writers against the database,
- restore the verified pre-operation backup over the active database using the documented backup file,
- verify the restored file SHA-256 matches the recorded backup checksum,
- verify `PRAGMA integrity_check` on the restored database,
- verify `_prisma_migrations` and relevant schema objects match the recorded pre-operation state,
- verify relevant row counts match the recorded pre-operation state,
- only then confirm whether the application may resume normal operation.

### 8.10 Conditions requiring stop and escalation
The operation must stop and escalate if:
- the backup cannot be verified,
- the disposable restore rehearsal cannot be performed successfully,
- the intended final `_prisma_migrations` state cannot be achieved without adding unvalidated assumptions,
- the uniqueness implementation for `PasswordResetToken` is not fully resolved before touching the real database,
- any required safeguard is missing,
- the person authorizing the operation has not explicitly approved the final history decision and the final clean artifact content.
 - the exact finalized clean S-09 artifact content has not been approved and validated against the real explicit unique index before any real operation.

### 8.11 What is not created now
No backup is created in this revision. No restore is rehearsed in this revision. The rollback tree above is a required precondition for any future real-database operation, not a completed safeguard.

---

## 9. Solved-vs-unresolved status table

| question | evidence | status | what is still required |
|---|---|---|---|
| Missing migration-directory behavior under Prisma 6.19.3 | Disposable experiment report; `prisma migrate status` and `prisma migrate deploy` both exited 0; disposable DB unchanged; injected record remained | RESOLVED AT THE DISPOSABLE-BEHAVIOR LEVEL | Real-project handling still depends on the final reconciliation decision for the contaminated record and the final `_prisma_migrations` state |
| Exact PasswordResetToken uniqueness implementation | Direct read-only SQLite evidence from `prisma/dev.db`: explicit `CREATE UNIQUE INDEX "PasswordResetToken_hashedToken_unique"`, table-level `UNIQUE("hashedToken")`, and PK autoindex `sqlite_autoindex_PasswordResetToken_1` | RESOLVED | The clean S-09 artifact must be finalized against that explicit unique index before it can be treated as a historical recreation |
| Existing database reconciliation | Revision 6 disposable existing-database test: `migrate deploy` exited 0 with no pending migrations; `migrate status` exited 0 with schema up to date; DB unchanged | PARTIALLY RESOLVED | Exact final history decision, exact clean artifact content, and exact final `_prisma_migrations` state still required; disposable plausibility is established |
| Fresh-install migration order | Revision 6 disposable fresh-database test: all seven clean migrations applied in order; exit code 0; schema up to date | PARTIALLY RESOLVED | Final clean S-09 artifact content still required before the fresh-install layout is final |
| S-14 historical migration reconstruction | schema.prisma and existing DB evidence show the intended S-14 objects; clean S-14 migration SQL SHA-256 equals the stored checksum for the contaminated record | PARTIALLY RESOLVED | Final approval of the clean S-14 file content as the intended active artifact still required |
| S-09 schema/index reconstruction | schema.prisma and existing DB evidence show the intended S-09 objects; uniqueness implementation is not a table constraint alone | RESOLVED AS A CORRECTION TO REVISION 5 | Clean S-09 artifact must reproduce or deliberately account for the explicit unique index; not yet authored/finalized for the real project |
| Schema equivalence | Revision 6 disposable tests show one object-level difference for `PasswordResetToken_hashedToken_unique` | PARTIALLY RESOLVED | Final equivalence depends on the finalized clean S-09 artifact and a final comparison against the real schema metadata |
| Backup/restore readiness | Backup/rollback decision tree now specified in Section 8 | UNRESOLVED | No real backup exists; no restore rehearsal has been performed; readiness cannot be asserted |
| Future migration usability | Revision 6 disposable test: a later disposable test migration applied successfully on the existing-database scenario and the history remained usable; this revision reproduced future-migration usability only on disposable copies | PARTIALLY RESOLVED | Usability for the exact real project history and for all future migrations is not yet proven |

---

## 10. Gate 1 decision

**NOT READY FOR GATE 1 REVIEW**

### Reason
Revision 6 materially reduced the remaining blockers, but it did not resolve every Gate 1 requirement.

What Revision 6 now establishes:
- the missing-directory behavioral concern is supported by one observed disposable result, not by pure assumption,
- the exact SQLite uniqueness implementation for `PasswordResetToken` is now known from direct read-only evidence,
- the full reconciliation candidate was tested on disposable versions of the existing database and the fresh database,
- a future-migration usability case was tested on a disposable copy of the existing-database scenario,
- the backup/rollback decision tree is now specified as a required precondition.

What Revision 6 still does not authorize:
- the exact final decision for the real contaminated `_prisma_migrations` record,
- the exact final `_prisma_migrations` state for the real project,
- the exact finalized clean S-09 artifact content required to match the real database’s uniqueness implementation,
- the exact finalization of the clean S-14 artifact content as the intended active artifact,
- actual backup creation, restore rehearsal, or any real-database reconciliation.

### Remaining Gate 1 blockers
- the exact reconciliation decision for the real contaminated record,
- the exact finalized clean S-09 artifact content, including whether it must reproduce the explicit unique index for exact historical recreation,
- the exact finalized clean S-14 artifact content,
- the exact final `_prisma_migrations` state for the real project,
- the required backup, verification, and rollback safeguards actually prepared.
No real-database reconciliation, no real backup, and no real migration command are authorized in this revision, so none of those blockers are resolved here.

Until those are in place, the design is stronger and more evidence-backed than Revision 5, but it is still not ready for execution authorization.

---

## 11. Authorization boundaries

This revision does not authorize:
- creating, editing, renaming, moving, or deleting any migration file or directory in the real project,
- modifying `prisma/schema.prisma` or application code,
- writing to `prisma/dev.db` or any existing database,
- creating backups or restoring databases,
- running migration commands, `db push`, seeds, builds, servers, or integration tests against any real database,
- modifying `_prisma_migrations` in the real database,
- starting S-09 implementation or modifying S-14 implementation,
- authorizing S-09 implementation, which remains subject only to the approved decisions D1–D5 and is not authorized by this revision; this revision addresses the S-09 migration file and the S-09 migration-history question, not S-09 implementation acceptance,
- touching billing, entitlements, C-03, S-12, S-13, or S-15.

The clean S-14 and S-09 artifacts and the test-only migration used in this revision were created only in the sealed disposable workspace under `prisma/disposable_scratch/clean_workspace/`, not in the real project.

---

## 12. Final confirmation

- Only `STAGE2_S09_S14_MIGRATION_RECOVERY_PLAN.md` was updated.
- The new disposable reconciliation report `STAGE2_S09_S14_REVISION6_DISPOSABLE_RECONCILIATION_REPORT.md` was created.
- No migration files in the real project were modified.
- No database files were modified.
- No backups were created.
- No migration, build, seed, server, or integration-test commands were run against any real database.
- No S-09 or S-14 implementation changes were made.

This is a planning and read-only investigation deliverable only. Further action requires explicit approval, and Gate 1 is not yet ready.

### Files changed or created in this revision
- Updated: `STAGE2_S09_S14_MIGRATION_RECOVERY_PLAN.md` to Revision 8.
- Created: `STAGE2_S09_S14_REVISION8_RECONCILIATION_PROOF_REPORT.md`.

### Deliverable references to correct
- This plan now refers to the actual Revision 8 proof report at `STAGE2_S09_S14_REVISION8_RECONCILIATION_PROOF_REPORT.md`.
- Revision 7 artifacts and references are retained only as historical context; they are not the current proof artifacts.

### Disposable artifacts used but not promoted
- `prisma/disposable_scratch/` and all of its contents were used only for disposable testing and were not promoted into the real project migration tree.
