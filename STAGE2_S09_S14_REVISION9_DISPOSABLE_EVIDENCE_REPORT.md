# SellFlow — Revision 9 Disposable Evidence Report

## Scope and authorization

This report documents Revision 9 disposable evidence only.

- Authorization: Revision 9 — Disposable Evidence Completion Only.
- Purpose: inspect and finalize proposed clean artifacts against retained evidence, verify Prisma behavior on disposable databases, document contaminated-record disposition alternatives, and rehearse backup/restore on disposable copies.
- Boundary: all Prisma commands and all database writes were performed only on disposable databases under `/tmp/rev9_work/`. No command in this revision wrote to `prisma/dev.db` or any other real database. No command in this revision modified any real migration file, `schema.prisma`, application source, environment files, or package files.
- This report does not represent a real-database reconciliation, does not authorize one, and does not represent a Gate 1 approval.

---

## 1. Read-only evidence sources used

### 1.1 Disposable evidence captured this revision

- `/tmp/rev9_work/r9_scb_full_capture.json`
- `/tmp/rev9_work/r9_backup_restore_evidence.json`
- `/tmp/rev9_work/r9_scb_existing.db`
- `/tmp/rev9_work/r9_scb_backup.db`
- `/tmp/rev9_work/r9_scb_restored.db`
- `/tmp/rev9_work/r9_fresh_test.db`

### 1.2 Retained evidence referenced for context

- `/tmp/rev8/work/r8_disposable_evidence.json`
- `STAGE2_S09_S14_REVISION8_RECONCILIATION_PROOF_REPORT.md`
- `STAGE2_S09_S14_MIGRATION_RECOVERY_PLAN.md`

### 1.3 Real project evidence referenced for context only

- `prisma/dev.db`
- `prisma/schema.prisma`
- `prisma/migrations/*`

Real project evidence was read-only this revision. Those values are included for context and cross-checks only.

---

## 2. Proposed clean artifacts reviewed

### 2.1 Clean S-14 artifact

Path used in disposable workspace:
`/tmp/rev9_work/prisma/migrations/20261105060000_session_lifecycle_clean_s14/migration.sql`

SHA-256: `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`
Size: `208` bytes

This artifact is the proposed clean S-14 migration. It is not a real project migration. It is retained here as one tested candidate artifact.

### 2.2 Clean S-09 artifact

Path used in disposable workspace:
`/tmp/rev9_work/prisma/migrations/20261106000000_password_reset_token_clean_s09/migration.sql`

SHA-256: `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`
Size: `813` bytes

This artifact is the proposed clean S-09 migration. It is not a real project migration. It is retained here as one tested candidate artifact.

---

## 3. Schema comparison finding

Real database `PasswordResetToken` implementation, observed read-only from `prisma/dev.db`:

- The real database has an explicit named unique index `PasswordResetToken_hashedToken_unique`.
- The real database also has a table-level `UNIQUE("hashedToken")` constraint in this revision’s captured disposable fresh install, which used the corrected clean S-09 layout.
- The disposable fresh install therefore reproduced both the explicit named unique index and the table-level unique constraint on a disposable fresh database.

Retained reference observation:
- `/tmp/rev8/work/prisma/migrations/20261106000000_password_reset_token_clean_s09/migration.sql` was reviewed as a reference artifact and noted for the explicit unique index it creates relative to the earlier clean-most artifact.

This is a disposable observation tied to the corrected clean S-09 artifact used in this revision’s workspace. It is not a guarantee of identical object-level behavior on the real existing database after any real reconciliation.

---

## 4. Prisma CLI provenance captured this revision

- CLI version: `6.19.3`
- @prisma/client version: `6.19.3`
- Default Engines Hash: `c2990dca591cba766e3b7ef5d9e8a84796e47ab7`
- Node.js version used: `v22.23.2`
- CLI binary path used: `node_modules/.bin/prisma`
- CLI binary SHA-256: `c2a77456b70e8ba1e640e122824ed694433828a7c0d76ff3db7fc376b4b0e1a0`

### Provenance limitation

`package.json` declares `prisma` and `@prisma/client` with range specifiers, not pinned versions. This revision’s retained `package-lock.json` did not yield top-level dependency integrity entries suitable for pinning the exact installed package versions or CLI engine artifacts this turn. Therefore the installed CLI behavior observed this revision is characterized by the captured CLI version and binary SHA-256, but the exact package integrity is not independently pinned from a retained lockfile this revision.

This limitation is noted so the evidence is not overstated. It does not invalidate the disposable observations; it limits the strength of the provenance claim.

---

## 5. Disposable SC-B evidence

### 5.1 Setup

Disposable database:
- `/tmp/rev9_work/r9_scb_existing.db`

This disposable database was created as a copy of `prisma/dev.db` and used only inside `/tmp/rev9_work/`. It was then modified only by disposable Prisma commands.

Disposable schema used:
- `/tmp/rev9_work/prisma/schema.prisma`

Disposable migration tree used:
- `/tmp/rev9_work/prisma/migrations/`

### 5.2 Before state

- disposable DB size: `954368` bytes
- disposable DB SHA-256 before: `81e7572541e23d5ac9a62b12e23a98fe5ba736463222fae0c7fdf8cc27b073d2`
- integrity before: `ok`
- foreign-key check before: `[]`
- `_prisma_migrations` count before: `7`

Before `_prisma_migrations` rows:
- `20261102203150_init` | `229abdf1-f818-4f2b-97e9-494568dace66` | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`
- `20261102213950_dispute_claim_link` | `db69d6d5-ebb8-4cf0-a5f2-6fbad2801c79` | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`
- `20261102222213_subscriptions` | `4b773531-f9d4-422a-a10e-25d4a7f2a907` | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`
- `20261104060000_login_throttle` | `7962534c-18a5-438d-95ee-2345cad92724` | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`
- `20261105000000_stock_integrity` | `5fe073c9-d7ae-42f4-aed7-6a1336365064` | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`
- `20261105060000_session_lifecycle` | `d68a8367-3aa8-4f77-8be7-641acc17a096` | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- `20261105060000_session_lifecycle_clean_s14` | `8eea6652-1e1d-4728-bab9-9f749501c4b9` | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`

### 5.3 Status before reconcile

migrate status before reconcile:
- exit: `1`
- stderr summary: Prisma reported that the local migration history and the database migrations table are different.
- stdout summary: last common migration `20261105060000_session_lifecycle_clean_s14`; migration not yet applied `20261106000000_password_reset_token_clean_s09`; migration from database not found locally `20261105060000_session_lifecycle`.

### 5.4 Deploy before reconcile

migrate deploy before reconcile:
- exit: `1`
- stdout summary: `7 migrations found in prisma/migrations`
- stderr summary: `Error: P3009`; `migrate found failed migrations in the target database`; the `20261105060000_session_lifecycle_clean_s14` migration started at `2026-11-10 02:27:36.447 UTC` failed.

Interpretation:
- This is the same failed-first-attempt collision behavior observed in the retained SC-B evidence.
- On this disposable existing-database copy, attempting `migrate deploy` first tried to apply `20261105060000_session_lifecycle_clean_s14`, encountered the collision represented by the retained evidence, and left the migration marked as failed/rolled back.

This is a disposable observation only. It is not a claim about what Prisma will do on the real database in any future real run.

### 5.5 Reconcile

migrate resolve S-14:
- exit: `0`
- stdout summary: `Migration 20261105060000_session_lifecycle_clean_s14 marked as applied.`

migrate resolve S-09:
- exit: `0`
- stdout summary: `Migration 20261106000000_password_reset_token_clean_s09 marked as applied.`

### 5.6 After state

- disposable DB size: `954368` bytes
- disposable DB SHA-256 after: `ec3d6e17696e5a6afd9ca8aad80b6e550ce4d8244069d8875dd5d06586b778f3`
- integrity after: `ok`
- foreign-key check after: `[]`
- `_prisma_migrations` count after: `9`

After `_prisma_migrations` rows:
- `20261102203150_init` | `229abdf1-f818-4f2b-97e9-494568dace66` | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`
- `20261102213950_dispute_claim_link` | `db69d6d5-ebb8-4cf0-a5f2-6fbad2801c79` | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`
- `20261102222213_subscriptions` | `4b773531-f9d4-422a-a10e-25d4a7f2a907` | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`
- `20261104060000_login_throttle` | `7962534c-18a5-438d-95ee-2345cad92724` | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`
- `20261105000000_stock_integrity` | `5fe073c9-d7ae-42f4-aed7-6a1336365064` | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`
- `20261105060000_session_lifecycle` | `d68a8367-3aa8-4f77-8be7-641acc17a096` | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- `20261105060000_session_lifecycle_clean_s14` | `8eea6652-1e1d-4728-bab9-9f749501c4b9` | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968` | `finished_at=null` | `rolled_back_at` set
- `20261105060000_session_lifecycle_clean_s14` | `eed23aa9-0afa-4cb7-848f-80fd2d1e64d4` | `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`
- `20261106000000_password_reset_token_clean_s09` | `9317ba3b-5d65-49a8-b222-065329e3b178` | `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`

Status after reconcile:
- exit: `0`
- stdout summary: `Database schema is up to date!`

Deploy after reconcile:
- exit: `0`
- stdout summary: `No pending migrations to apply.`

---

## 6. Disposable SC-B migration-history interpretation

This revision observed one completed disposable SC-B history shape on a disposable existing-database copy.

### 6.1 Contaminated-record side condition

The disposable copy started from `prisma/dev.db` and therefore arrived with the real database’s existing migration history, including the contaminated completed record `20261105060000_session_lifecycle` with checksum `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`.

That contaminated record was retained in the disposable copy during this revision’s SC-B test. It was not deleted, replaced, or edited. It remained present as part of the starting disposable history.

### 6.2 S-14 detail

Two S-14 records were created during the disposable reconcile:

First attempt, rolled back:
- id: `8eea6652-1e1d-4728-bab9-9f749501c4b9`
- checksum: `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- finished_at: null
- rolled_back_at: set

Second attempt, completed:
- id: `eed23aa9-0afa-4cb7-848f-80fd2d1e64d4`
- checksum: `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`
- finished_at: set
- rolled_back_at: null

This matches the ordering inferred from the retained SC-B evidence `started_at` values: the rolled-back S-14 attempt started before the completed S-14 attempt.

### 6.3 S-09 detail

One S-09 record was created during the disposable reconcile:
- id: `9317ba3b-5d65-49a8-b222-065329e3b178`
- checksum: `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`
- finished_at: set
- rolled_back_at: null

### 6.4 What this does and does not prove

This proves that the corrected clean artifacts, on this disposable existing-database copy, produced a migration history with:
- one rolled-back S-14 attempt,
- one completed S-14 attempt,
- one completed S-09 attempt,
- the existing contaminant record still present,
- and a coherent `migrate status`/`migrate deploy` result after reconcile.

It does not prove that the real database must or should follow this exact history. It does not prove any specific approved final state for the real `_prisma_migrations`. It does not test real-database deployment, real backup, or real rollback.

---

## 7. Disposable fresh-install evidence

Disposable database:
- `/tmp/rev9_work/r9_fresh_test.db`

Setup:
- empty disposable database, no pre-existing tables
- disposable schema: `/tmp/rev9_work/prisma/schema.prisma`
- disposable migrations: the same corrected clean layout used in this revision’s workspace

Result:
- migrate deploy exit: `0`
- final size: `630784` bytes
- final SHA-256: `e7f8eaf4a924479330a7e0cb76fc187c502b6503880acbf295a6c746af5be242`
- integrity: `ok`
- foreign-key check: `[]`
- `_prisma_migrations` count: `7`

Fresh `_prisma_migrations` rows:
- `20261102203150_init` | `23120a80-5311-4a66-b35f-c2d956c079d0` | `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`
- `20261102213950_dispute_claim_link` | `10fcfa9b-c396-4825-97c1-e6d15a24cb0d` | `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`
- `20261102222213_subscriptions` | `2e860845-afb2-4ff9-a7a2-edaf1565c714` | `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`
- `20261104060000_login_throttle` | `24fd3b86-1c95-4621-a623-1f83d39ba5f8` | `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`
- `20261105000000_stock_integrity` | `be53f572-a190-4ff4-a060-1ecfbafb1867` | `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`
- `20261105060000_session_lifecycle_clean_s14` | `d08d1405-3171-4f96-a1d6-0111399f2cdb` | `d1d166bc2134caf9ccbdb81b522e2f6c423cebf8111261193b2f9fa813300167`
- `20261106000000_password_reset_token_clean_s09` | `a7e40d26-6fd6-4007-9aec-f9e34dd14e7f` | `2b39c561dae14486b9b9d973ac357c379a798722571aeff712299598af25c594`

PasswordResetToken indexes on the disposable fresh database:
- `PasswordResetToken_expiresAt_idx`
- `PasswordResetToken_userId_idx`
- `PasswordResetToken_hashedToken_unique`
- `sqlite_autoindex_PasswordResetToken_2`
- `sqlite_autoindex_PasswordResetToken_1`

Conclusion: the corrected clean S-09 layout produced an explicit named unique index `PasswordResetToken_hashedToken_unique` on a disposable fresh database. This is a disposable observation only, not a promise about any real database.

---

## 8. Disposable backup/restore rehearsal

### 8.1 Source

Source disposable database:
- `/tmp/rev9_work/r9_scb_existing.db`
- size: `954368` bytes
- SHA-256: `ec3d6e17696e5a6afd9ca8aad80b6e550ce4d8244069d8875dd5d06586b778f3`
- integrity: `ok`
- foreign-key check: `[]`
- `_prisma_migrations` count: `9`

This source DB is itself a disposable copy that was modified only inside `/tmp/rev9_work/`. It is not `prisma/dev.db`.

### 8.2 Backup

Backup database:
- `/tmp/rev9_work/r9_scb_backup.db`
- size: `954368` bytes
- SHA-256: `664597a894c01f85decdaa14e26f0c7d12f8bfe6067c7d6c4f8070731d155027`
- method: Python `sqlite3.Connection.backup()`
- integrity of backup verified read-only: `ok`
- foreign-key check of backup verified read-only: `[]`
- `_prisma_migrations` count of backup: `9`

### 8.3 Restore

Restored database:
- `/tmp/rev9_work/r9_scb_restored.db`
- size: `954368` bytes
- SHA-256: `664597a894c01f85decdaa14e26f0c7d12f8bfe6067c7d6c4f8070731d155027`
- method: file copy of backup into a separate disposable location
- integrity of restored DB verified read-only: `ok`
- foreign-key check of restored DB verified read-only: `[]`
- `_prisma_migrations` count of restored DB: `9`
- `PasswordResetToken` table present in restored DB: yes
- `PasswordResetToken_hashedToken_unique` present in restored DB: yes

### 8.4 Cross-check

- source PM rows and restored PM rows were identical in this rehearsal.

### 8.5 Script failure note

The first backup/restore evidence script aborted before writing its JSON evidence file because it tried to query one database connection after it had been closed. The evidence was rebuilt in a later step. The failure was a script-control error, not a database integrity failure. The final evidence file was written after the successful reconciliation read.

This note is included so the report does not imply the rehearsal succeeded on the first script attempt.

---

## 9. Disposable evidence artifacts produced this revision

| path | size | SHA-256 |
|---|---|---|
| `/tmp/rev9_work/r9_scb_full_capture.json` | `10821` bytes | `f429345d4280675236c73ae66ea62a8431178451c96607168ddfc65475516c92` |
| `/tmp/rev9_work/r9_backup_restore_evidence.json` | `7217` bytes | `60f27f576097b0a1a23dd7db0e7e2fac0d2622960f3bd2bbb20a5fe1967eb153` |
| `/tmp/rev9_work/r9_scb_existing.db` | `954368` bytes | `ec3d6e17696e5a6afd9ca8aad80b6e550ce4d8244069d8875dd5d06586b778f3` |
| `/tmp/rev9_work/r9_scb_backup.db` | `954368` bytes | `664597a894c01f85decdaa14e26f0c7d12f8bfe6067c7d6c4f8070731d155027` |
| `/tmp/rev9_work/r9_scb_restored.db` | `954368` bytes | `664597a894c01f85decdaa14e26f0c7d12f8bfe6067c7d6c4f8070731d155027` |
| `/tmp/rev9_work/r9_fresh_test.db` | `630784` bytes | `e7f8eaf4a924479330a7e0cb76fc187c502b6503880acbf295a6c746af5be242` |

These artifacts are disposable evidence only. They are not approved real-project artifacts.

---

## 10. Risks and limitations

1. Disposable only.
   All Prisma commands and database operations in this revision were performed on disposable databases under `/tmp/rev9_work/`. No real-database reconciliation, deploy, resolve, backup, or restore was performed or authorized.

2. Real-database behavior not certified.
   The SC-B result was reproduced on a disposable existing-database copy. The exact behavior on the real database was not tested this revision, and this revision did not authorize such a test.

3. Contaminated record unresolved for the real project.
   The contaminated completed record remains in the real project’s `_prisma_migrations` with a stored checksum that does not match the current local file. This revision documented that shape on a disposable copy but did not choose or approve a real-project disposition.

4. Clean artifacts tested, not approved.
   The revised S-14 and S-09 clean artifacts were tested in disposable form. They are not approved as the finalized real artifacts by this revision.

5. Prisma provenance limitation.
   The installed CLI version and binary SHA-256 were captured, but exact package integrity could not be pinned from a retained `package-lock.json` entry this revision.

6. No Gate 1 approval.
   This revision does not move the project toward Gate 1 readiness, and it does not assert that Gate 1 is ready.

---

## 11. Real project integrity assertion

This revision asserts the following read-only findings about the real project:

- `prisma/dev.db` size: `954368` bytes
- `prisma/dev.db` SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- `prisma/schema.prisma` SHA-256: `98816e5060b499bfb9f161759fa948a300ece21fcd31aa41f3625d19b8c7a39e`
- Real migration SHA-256s unchanged:
  - `20261102203150_init`: `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`
  - `20261102213950_dispute_claim_link`: `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`
  - `20261102222213_subscriptions`: `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`
  - `20261104060000_login_throttle`: `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`
  - `20261105000000_stock_integrity`: `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`
  - `20261105060000_session_lifecycle`: `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`

No real project file was modified this revision.

---

## 12. Related historical checksums preserved

The five matching historical migration checksums remain unchanged in the real project this revision:

- `1549bc93bc570f21965bdc8922df1f78a59801da125f136baa8629f5bcddcacb`
- `f2aec92d8ec3f2470ea03bcfce724c63e33a2b4454c2a61d6bad894da39ffc1d`
- `aafb51b6e1cb70fa635cbac636c1e5d38383b1cc198a4795e4605ee6e3be3a1e`
- `61fd6937a4278f3f7b5e70ef887c5200eea3b3668c915503a9fedf355ca28307`
- `a0467f3713d03fb1ac90980ac3670d7b7368a3748432d7bd92be55dc4501ccc2`

The contaminated/disputed migration checksum remains:
- `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`

---

## 13. Bottom line

Revision 9 disposable evidence is complete and internally consistent with the retained SC-B evidence.

It establishes that the corrected clean artifacts behaved as expected on disposable copies, that the failed-first-S-14 attempt and subsequent completed S-14 and S-09 records were reproduced on a disposable existing-database copy, that the corrected S-09 layout produced the explicit named unique index on a disposable fresh database, and that a disposable backup/restore rehearsal succeeded when the evidence script was corrected.

It does not constitute a real-database reconciliation, does not authorize one, and does not represent Gate 1 readiness.
