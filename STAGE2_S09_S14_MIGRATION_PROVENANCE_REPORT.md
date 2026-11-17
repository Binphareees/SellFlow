# S-09 / S-14 Migration Provenance Report

**Objective:** Resolve migration-integrity questions after the S-09 remediation attempt, using read-only investigation only.

**Safety boundary:** Read-only. No migrations, builds, seeds, servers, or integration tests were run. No `.env`, `.env.local`, API keys, secrets, or credentials were read, printed, or exposed. No project files were edited, restored, deleted, moved, or created except the required report file.

**Repository:** `/home/binpharees/Documents/SellFlow-Bootcamp-v2`

---

## 1. Executive summary

- The migration directory `prisma/migrations/` exists only in the working tree and is **untracked** in Git.
- The file `prisma/migrations/20261105060000_session_lifecycle/migration.sql` exists on disk and contains S-14 DDL followed by appended S-09 `PasswordResetToken` DDL.
- On the current HEAD, **no `prisma/` tree exists at all**, and **no commit in the current repository contains any `prisma/migrations` path**.
- The only commit in this repository is `37fc6387f1cfa691b8a9ef39b77c7f35d27b65ff` on `main`, titled `Add project documentation and validation templates`. It contains only documentation and template files.
- `prisma/dev.db` exists on disk and is a valid SQLite file, but the `prisma db execute` CLI wrapper in this environment did not return row data for the read-only schema/metadata queries used here.
- Because there is no committed S-14 migration artifact in this repository, an **original S-14 migration SQL cannot be verified from Git history**.

**Conclusion labels used in this report:**

- ORIGINAL S-14 MIGRATION RECOVERABLE — not used; no exact historical copy was verified.
- ORIGINAL S-14 MIGRATION NOT FOUND — used.
- DATABASE APPLICATION STATUS CONFIRMED — not used.
- DATABASE APPLICATION STATUS UNRESOLVED — used.

---

## 2. Git provenance findings

### 2.1 Current Git state for the migration directory

From read-only Git commands:

- `git status --short -- "prisma/migrations"` returned `?? prisma/migrations/`
- `git ls-files "prisma/migrations"` returned empty
- `git ls-tree -r HEAD "prisma/migrations"` returned empty
- `git ls-tree -r HEAD "prisma"` returned empty
- `git ls-tree -r HEAD` listed only these paths:
  - `AI_HANDOFF.md`
  - `MONETIZATION_AND_LAUNCH.md`
  - `MVP_SPEC.md`
  - `README.md`
  - `ROADMAP.md`
  - `STATE.md`
  - `TECH_STACK.md`
  - `VALIDATION_PLAN.md`
  - `templates/INTERVIEW_LOG.md`
  - `templates/PILOT_TRACKER.md`

So the current Git tree contains **only documentation and templates**, and does **not** contain:

- `prisma/`
- `src/`
- `scripts/`
- `package.json`
- `prisma/schema.prisma`
- `prisma/migrations/`

### 2.2 Commit history

From read-only Git commands:

- `git branch --all` returned only `* main`
- `git tag -l` returned empty
- `git stash list` returned empty
- `git remote -v` returned empty
- `git log --all --oneline --name-status` returned a single commit:
  - `37fc638 Add project documentation and validation templates`
- `git reflog --all` returned a single reflog entry for that commit
- `git rev-list --all --objects` returned 13 objects total:
  - 1 commit
  - 2 trees
  - 10 blobs

So the repository is effectively a **single-commit initial snapshot** of documentation/template files.

### 2.3 Historical search for the S-14 migration

From read-only Git commands:

- `git log --all --oneline -- "prisma/migrations/20261105060000_session_lifecycle/migration.sql"` returned no history
- `git log --all --oneline -- "prisma/migrations"` returned no history
- `git log --all --oneline --name-only` filtered for `session_lifecycle` returned nothing
- `git log --all --oneline --name-only` filtered for `20261105060000` returned nothing
- `git log --all --oneline --diff-filter=AM -- "prisma/migrations"` returned nothing

Therefore:

- No reachable Git ref, including HEAD, contains any path under `prisma/migrations/`.
- No reachable Git ref contains a file named `20261105060000_session_lifecycle/migration.sql`.
- No reachable Git ref contains any file named `migration.sql`.

### 2.4 Object store metadata

From read-only Git commands:

- `.git/objects` uses loose-object storage; no pack files were found.
- Total object count was 13.
- No dangling/unreachable objects were reported by `git fsck --no-progress` in the captured output.

So there is **no evidence of any removed or unreachable commit or blob** that could be recovered as a prior migration artifact.

### 2.5 Provenance interpretation

The most direct evidence-based interpretation is:

- `prisma/migrations/` is **not a previously committed S-14 migration directory that was later edited**.
- It is **not recoverable from Git history** in this repository.
- The current working-tree migration files are the only representation of those migration SQL files in this workspace.

A possible explanation is that `prisma/migrations/` was created locally and never committed, or that the repository was initialized from a snapshot that did not include the `prisma/` tree. This report can describe the evidence, but cannot prove the exact origin without an external copy.

---

## 3. Current migration SQL classification

File inspected read-only:

- `prisma/migrations/20261105060000_session_lifecycle/migration.sql`
- md5: `1eb245a60295cfd5f3c6b5aabf7d88d6`
- size: `1256 bytes`
- mode: `664`
- timestamps in this investigation:
  - atime: `2026-11-09 17:39:16.900344343 +0300`
  - mtime: `2026-11-09 17:39:16.899344347 +0300`
  - ctime: `2026-11-09 17:39:16.899344347 +0300`

### 3.1 SQL statements in order

The file contains, in order:

1. Comment banner:
   - `-- S-14: idle expiration for sessions.`
2. Comment block:
   - `-- Additive only. \`DEFAULT CURRENT_TIMESTAMP\` backfills every existing row with`
   - `-- the moment of the migration, so nobody is signed out by deploying this: the`
   - `-- idle clock starts at deploy rather than at each session's creation.`
3. DDL statement:
   - `ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;`
4. Comment line:
   - `-- Supports idle-expiry sweeps and the per-user session inventory.`
5. DDL statement:
   - `CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt");`
6. Comment banner:
   - `-- S-09: single-use, hashed password-reset tokens. The raw token exists only`
   - `-- briefly in memory; the database stores only the salted SHA-256 hash, plus a`
   - `-- used flag and expiry so reset requests are not reusable and can be swept.`
7. DDL statement:
   - `CREATE TABLE "PasswordResetToken" (...)`
8. DDL statement:
   - `CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");`
9. DDL statement:
   - `CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");`

### 3.2 S-14 vs S-09 classification

**S-14 statements:**

- `ALTER TABLE "Session" ADD COLUMN "lastUsedAt" ...`
- `CREATE INDEX "Session_userId_lastUsedAt_idx" ...`

These are consistent with session idle-expiration schema changes.

**S-09 statements:**

- `CREATE TABLE "PasswordResetToken" (...)`
- `CREATE INDEX "PasswordResetToken_userId_idx" ...`
- `CREATE INDEX "PasswordResetToken_expiresAt_idx" ...`

These are consistent with the S-09 `PasswordResetToken` model described in the prisma schema.

**Structure observation:**

- The S-09 DDL is **appended after the S-14 DDL** in the same migration file.
- No other unrelated DDL was found in this file.

---

## 4. Exact `_prisma_migrations` records

### 4.1 Attempted read methods

The investigation used read-only SQL probes against `prisma/dev.db`:

- `PRAGMA table_info('_prisma_migrations');`
- `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
- `SELECT sql FROM sqlite_master WHERE type='table' AND name='_prisma_migrations';`
- `SELECT * FROM _prisma_migrations ORDER BY id DESC LIMIT 200;`

All of these were issued via the `prisma db execute --url "file:/.../prisma/dev.db" --file ...` command, which is read-only with respect to the database file.

### 4.2 CLI result behavior observed

For the read-only `SELECT` probes above, the CLI returned only:

- deprecation warning text
- `Script executed successfully.`

The captured log sizes were consistently `256 bytes`, and the full log bytes ended with:

- `Script executed successfully.\n`

There was **no row data visible** in the captured CLI output for the metadata/query probes.

### 4.3 Direct binary inspection of `prisma/dev.db` header

The file header parsed read-only:

- SQLite format header: `SQLite format 3\0`
- Page size: `4096`
- File format write: `1`
- File format read: `1`
- Reserved bytes per page: `0`
- Max payload fraction: `64`
- Min payload fraction: `32`
- Leaf payload fraction: `32`
- File change counter: `554893312`
- Size in pages (LE at offset 28): `3909091328`
- Freelist trunk page: `0`
- Total freelist pages: `0`
- Schema cookie: `1979711488`
- Schema format number: `0`
- Default page cache size: `0`
- Largest root b-tree page: `554893312`
- Schema table root page number (LE at offset 96): `1887055360`

### 4.4 Header anomaly observation

The schema table root page number field appears inconsistent with a normal intact SQLite file:

- The bytes at offset 96-99 read as `\x76\x00\x00\x00\x04...`
- The `uint32` LE interpretation at offset 96 produced `1887055360`, which is implausibly large for a file of this size.
- The same 4 bytes interpreted as big-endian produced `3046000`, which is larger than the actual file page count (`954368 / 4096 = 233 pages`).

This suggests the SQLite header fields at offset 96+ are **not consistent** with a plain intact SQLite database header, or that the expected schema-root offset is being misread due to an unusual header layout.

### 4.5 `_prisma_migrations` schema and rows

Because the CLI did not return row data and direct SQLite parsing of the header was inconclusive, **the exact `_prisma_migrations` columns and rows could not be confirmed from the evidence gathered here**.

What is known:

- `prisma migrate status` reported `6 migrations found in prisma/migrations` and `Database schema is up to date!`
- That command ran read-only with respect to `prisma/dev.db` in this investigation.
- The CLI did not provide the underlying applied-migration rows in the captured output.

### 4.5.1 Plausible column names (unverified)

Prisma migration tables commonly include columns such as:

- `id`
- `migration_name`
- `checksum`
- `started_at`
- `finished_at`
- `rolled_back_at`
- `logs`

This report cannot confirm those exact column names for this database from the evidence gathered.

---

## 5. Development database schema findings

### 5.1 File presence

- `prisma/dev.db` exists.
- size: `954368 bytes`
- mode: `644`
- timestamps in this investigation:
  - atime: `2026-11-09 15:23:05.769602908 +0300`
  - mtime: `2026-11-09 15:23:05.763602815 +0300`
  - ctime: `2026-11-09 15:23:05.763602815 +0300`
- No extended attributes were read successfully.

### 5.2 SQLite validity

- The file begins with the expected SQLite format header.
- The file size is `954368 bytes`, which is consistent with a small SQLite database.

### 5.3 Schema read status

- Read-only `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;` executed through the CLI, but row output was not visible in the captured log.
- Direct binary parsing of the header did not yield a reliably interpretable schema table root page reference.

Therefore:

- This report cannot confirm the full table list from direct evidence here.
- The only schema hint from this investigation is `prisma migrate status`, which reported an up-to-date schema relative to `prisma/migrations`.

### 5.4 `PasswordResetToken` existence

From the evidence gathered:

- The on-disk migration file includes `CREATE TABLE "PasswordResetToken" ...`
- `prisma migrate status` reported the schema is up to date relative to `prisma/migrations`
- The CLI did not return schema/table metadata rows here

So:

- **It is plausible** that `PasswordResetToken` exists in `prisma/dev.db` if the current migration tree was applied.
- **It is not confirmed** by a direct read of `sqlite_master` rows in this investigation.

---

## 6. Any verified historical or backup copies

### 6.1 Local project search

Read-only file searches found:

- Only one SQLite file in the project tree outside `node_modules`, `.git`, `.next`, `dist`, `build`, `tmp`: `prisma/dev.db`.
- No backup, `.backup`, `.orig`, `.save`, or `.old` copies of `dev.db` were found.
- No file named like `*session_lifecycle*` or `*20261105060000*` was found except the migration directory and its file.
- No file named like `*password*` or `*reset*` was found under `prisma/`.

### 6.2 Git object search

- No Git object, ref, or history contained any `prisma/migrations` path.
- No Git object, ref, or history contained any `migration.sql` file.
- No pack or dangling-object evidence was found that could recover a prior migration artifact.

### 6.3 Other artifacts present

These were found by read-only tree search and are **not backups of the S-14 migration SQL**:

- `prisma/schema.prisma`
- `prisma/schema.prisma.tmp`
- `prisma/seed.ts`
- `prisma/migrations/migration_lock.toml`
- `prisma-generate.log`

None of those is a historical copy of the S-14 migration artifact.

### 6.4 Conclusion on historical copies

**No verified historical or backup copy of the original S-14 migration SQL exists in this workspace or in this Git repository.**

---

## 7. Confirmed facts, unresolved questions, and assumptions

### 7.1 Confirmed facts

1. The working tree contains `prisma/migrations/20261105060000_session_lifecycle/migration.sql`.
2. That file contains S-14 DDL and then appended S-09 `PasswordResetToken` DDL.
3. That file is untracked in Git.
4. HEAD contains no `prisma/` tree at all.
5. No commit in this repository contains any `prisma/migrations` path.
6. The repository has a single commit, on `main`, with no tags, no remotes, and no stashes.
7. `prisma/dev.db` exists and is a SQLite file.
8. `prisma migrate status` reported `6 migrations found in prisma/migrations` and `Database schema is up to date!`.
9. No migration, build, seed, server, or integration test was run during this investigation.
10. No `.env`, `.env.local`, API key, secret, or credential was read or exposed.

### 7.2 Unresolved questions

1. Was the S-14 migration previously committed in some other repository state that is not reachable here?
   - Not answerable from this repository; no such history exists here.
2. Was the S-14 migration created locally, copied from elsewhere, or reconstructed?
   - Not provable from evidence here; only the current working tree and Git state are available.
3. Does `prisma/dev.db` actually contain `_prisma_migrations` rows matching the current migration tree?
   - Not confirmed by direct row read here; `prisma migrate status` is consistent with that, but not a row-level proof.
4. What are the exact `_prisma_migrations` column names and applied-migration records?
   - Not readable from the evidence gathered here.
5. Was the original S-14 migration ever a separate committed artifact somewhere else?
   - Outside the scope of this repository; not verifiable here.

### 7.3 Assumptions

1. If `prisma migrate status` is correct, then the dev database’s applied state is consistent with the current `prisma/migrations` tree.
   - Reasonable, but not a substitute for direct `_prisma_migrations` row evidence.
2. The `prisma db execute` CLI wrapper in this environment is not returning row output for read-only metadata queries.
   - Based on repeated read-only probes here.
3. The SQLite header fields at offset 96+ are unusual or were misinterpreted by simple fixed-offset parsing.
   - Suggested by the inconsistent root-page values seen in this investigation.

---

## 8. Recommendation for the safest next step

### Recommended next step

Before any repair, obtain an **external verified copy** of the original S-14 migration SQL, if one exists, for example from:

- another clone or backup of the repository that contains the `prisma/migrations` history
- a prior artifact store, CI artifact, or exported migration snapshot
- a trusted teammate’s copy of the committed migration

If no external copy exists, do **not** assume the current working-tree file is the original S-14 migration artifact. In that case, the safest action is to:

- treat the current `prisma/migrations/20261105060000_session_lifecycle/migration.sql` as an uncommitted, unverified artifact
- create a separate, clearly-named S-09 migration artifact rather than relying on reconstructing the original S-14 file from memory

### What not to do next

Until the above is resolved:

- do not edit the existing migration file further
- do not run `prisma migrate dev/dev/deploy/reset/db push/db execute`
- do not attempt to reconstruct the original S-14 migration from memory
- do not edit `prisma/dev.db` or any other database
- do not run builds, seeds, servers, or integration tests for this purpose

---

## Conclusion

- **ORIGINAL S-14 MIGRATION RECOVERABLE:** No. No exact historical copy was verified.
- **ORIGINAL S-14 MIGRATION NOT FOUND:** Yes. No verified copy exists in this repository or workspace.
- **DATABASE APPLICATION STATUS CONFIRMED:** No. The exact `_prisma_migrations` records were not obtained.
- **DATABASE APPLICATION STATUS UNRESOLVED:** Yes.

**Final confirmation:**

- No migration commands were executed.
- No database writes occurred.
- No migration or source files were edited, restored, deleted, or created except this required report file.
- No builds, seeds, or integration tests were run.
