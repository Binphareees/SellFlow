# S-09 Remediation Integrity Report

**Purpose:** Read-only integrity investigation of the S-09 remediation attempt, focused on the existing S-14 migration artifact.

**Constraint:** No edits, restores, deletes, creations, or applications. No migrations, builds, seeds, or integration tests. No modifications to S-06/S-12/S-13/S-14/S-15, billing/entitlements, or C-03.

**Investigation mode:** strictly read-only diagnostics from the workspace and Git working tree.

---

## 1. `git status --short`

From the investigation run:

```
 M AI_HANDOFF.md
 M MONETIZATION_AND_LAUNCH.md
 M MVP_SPEC.md
 M README.md
 M ROADMAP.md
 M STATE.md
 M TECH_STACK.md
 M VALIDATION_PLAN.md
 M templates/INTERVIEW_LOG.md
 M templates/PILOT_TRACKER.md
?? .cloud-attachments/
?? .dockerignore
?? .env.example
?? ...
?? prisma/
?? scripts/
?? src/
?? ...
?? prisma/migrations/20261105060000_session_lifecycle/migration.sql
```

Key point for this investigation:

- `prisma/migrations/20261105060000_session_lifecycle/migration.sql` appears as `??` (untracked) in `git status --short`.
- That means it is **not staged and not known to Git** as a tracked path in the current index tree at the time of investigation.
- Several other `prisma/*`, `scripts/*`, `src/*`, `public/*`, `templates/*`, `next.config.ts`, `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, and `docker-compose.yml` also appear as untracked or modified in this working tree snapshot.

Interpretation: the working tree contains a large set of non-staged artifacts, and the S-14 migration file is among them as an untracked file.

---

## 2. `git diff --stat`

From the investigation run:

```
AI_HANDOFF.md              |  69 ++++-
MONETIZATION_AND_LAUNCH.md |   2 +
MVP_SPEC.md                |   2 +
README.md                  | 297 ++++++++++++++++-----
ROADMAP.md                 |  24 +-
STATE.md                   | 101 +++++++--
TECH_STACK.md              |   2 +
VALIDATION_PLAN.md         | 617 ++++++++++++++++++++++++++++++++++++++++--------
templates/INTERVIEW_LOG.md |  45 ++--
templates/PILOT_TRACKER.md |  64 ++++-
10 files changed, 1095 insertions(+), 128 deletions(-)
```

Key point for this investigation:

- The `git diff --stat` output does **not** include `prisma/migrations/20261105060000_session_lifecycle/migration.sql`.
- That is consistent with the file being untracked (`??`) and not part of the diffable tracked-tree comparison at this snapshot.

---

## 3. Complete diff for `prisma/migrations/20261105060000_session_lifecycle/migration.sql`

**What this investigation can show:**

- A full read of the current file content.
- The file’s current checksum.

**What this investigation cannot show:**

- A `git diff` against a committed version, because **there is no committed version of this path on HEAD** in the current repository state.

### Current file content (read-only)

From the investigation run, `sed -n '1,240p'` on the file returned:

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

### Current file checksum (read-only)

From the investigation run:

- `md5=1eb245a60295cfd5f3c6b5aabf7d88d6`
- `size=1256 bytes`

---

## 4. Comparison against committed Git version

This investigation found **no committed version** of that path available for comparison.

Evidence:

- `git show "HEAD:prisma/migrations/20261105060000_session_lifecycle/migration.sql"` failed with “not present in HEAD tree” phrasing in the investigation output.
- `git ls-tree -r HEAD -- "prisma/migrations/20261105060000_session_lifecycle/migration.sql"` returned no entry.
- `git ls-tree -r HEAD` did not list `session_lifecycle` under `prisma/migrations/`.
- `git log --all --oneline -- "prisma/migrations/20261105060000_session_lifecycle/migration.sql"` returned no commits.

Therefore:

- A **committed-vs-working-tree comparison is not possible** from this repository state.
- Any claim that the file “changed from its committed version” cannot be verified by diffing against HEAD, because HEAD does not contain this file path.

This is a critical integrity finding: if this file path was ever part of the committed migration history, it is **not present in the current HEAD tree or reachable by path in the current commit graph**. That makes the “existing S-14 migration” framing ambiguous in this repository snapshot.

---

## 5. Is the S-14 migration tracked, and does its checksum differ from a committed version?

### Git tracking status

From the investigation run:

- `git status --short -- 'prisma/migrations/20261105060000_session_lifecycle/migration.sql'` = `?? prisma/migrations/20261105060000_session_lifecycle/migration.sql`
- `git ls-files --error-unmatch '...'` returned “did not match any file(s) known to git”.

So:

- In the current working tree/index state, this file is **untracked**.
- It is **not in the Git index** as a known path.
- It is **not present in HEAD** as a tracked path.

### Checksum comparison

A committed-version checksum could not be obtained because there is no committed version to hash.

What is known:

- Current working-tree file `md5=1eb245a60295cfd5f3c6b5aabf7d88d6`
- Current working-tree file `size=1256 bytes`
- No committed checksum available for comparison

Therefore:

- A “checksum differs from committed version” statement cannot be confirmed by Git in this state.
- The only verifiable checksum is the current working-tree checksum.

---

## 6. Every S-09 remediation file created or modified

### Files modified in this investigation window (from tool-call evidence)

The investigation could confirm the following **working-tree artifacts exist** and are unchanged/untracked in various ways:

**Confirmed present in working tree:**

- `prisma/migrations/20261105060000_session_lifecycle/migration.sql`
  - Present on disk with the S-09 DDL appended after the S-14 block.
  - Current md5 `1eb245a60295cfd5f3c6b5aabf7d88d6`, size 1256 bytes.
  - Untracked in Git (`??`) at investigation time.

- `scripts/s09-e2e-run.sh`
  - Present on disk.
  - Multiple edits were made earlier in the same remediation session (trap handling, migration-check path, inline node path, etc.).
  - This investigation did not re-diff it against a prior committed version; it confirmed only that the file exists in the working tree.

**Written during this remediation session (from earlier `write_file` evidence in the same turn):**

- `STAGE2_TASK9_S09_REMEDIATION_REPORT.md`
  - Created earlier in this turn.
  - Contains a claim that the S-09 DDL was appended into the existing S-14 migration artifact.

**Other S-09-related files seen in the working tree (untracked in this investigation snapshot):**

- `STAGE2_TASK9_S09_IMPLEMENTATION_REPORT.md`
- `STAGE2_TASK9_S09_IMPLEMENTATION_SPECIFICATION.md`
- `STAGE2_TASK9_S09_INDEPENDENT_REVIEW_REPORT.md`
- `STAGE2_TASK9_S09_READINESS_REPORT.md`
- `STAGE2_TASK9_S09_REMEDIATION_REPORT.md`

These are **report/specification artifacts**, not migration artifacts.

### Files not found / not created for S-09 migrations

- No separate `prisma/migrations/*s09*` directory exists.
- No new migration folder was created in this investigation window.
- No new migration file named for S-09 was created.

---

## 7. Separate S-09 migration directory

**Confirmed:** none exists in the working tree.

From the investigation run:

- `find prisma/migrations -maxdepth 2 -type f` listed these migration files:
  - `20261102203150_init/migration.sql`
  - `20261102213950_dispute_claim_link/migration.sql`
  - `20261102222213_subscriptions/migration.sql`
  - `20261104060000_login_throttle/migration.sql`
  - `20261105000000_stock_integrity/migration.sql`
  - `20261105060000_session_lifecycle/migration.sql`
  - `migration_lock.toml`
- No `prisma/migrations/<timestamp>_something_s09_...` folder or file was found.
- No `prisma/migrations/*20261109*` folder or file was found.

So:

- S-09 did **not** create a dedicated migration artifact directory in this workspace at this time.
- The only S-09 DDL present is the appended block inside `20261105060000_session_lifecycle/migration.sql`.

---

## 8. Read-only inspection of the development database migration records and schema

### Development database presence

From the investigation run:

- `prisma/dev.db` exists
- `size=954368 bytes`
- `md5=105539bf89ee435a2ae6f838014c927e`
- Modified time in investigation snapshot: `Nov 9 15:23`

### Read-only schema inspection

**`prisma migrate status` (read-only, no write):**

- exit `0`
- `6 migrations found in prisma/migrations`
- `Database schema is up to date!`

This indicates that, from Prisma’s perspective, the dev database’s migration history matches the set of migrations Prisma believes are relevant at investigation time.

**Table list via `prisma db execute --file` (read-only):**

- exit `0`
- SQL used: `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`
- SQL file size `65 bytes`
- The CLI returned `Script executed successfully.` but did **not** return a usable row list in the captured output.

So the readable evidence from the CLI probe is:

- The command executed against `prisma/dev.db` successfully.
- The CLI output did not include a table-name list in a form usable for assertions in this investigation.

### `_prisma_migrations` inspection (read-only, with caveats)

This investigation attempted several read-only probes of `_prisma_migrations`:

1. `SELECT COUNT(*) AS cnt FROM _prisma_migrations;`
   - exit `0`
   - result not usable as a row dump in captured CLI output.

2. `SELECT id, migration_name, appliedAt FROM _prisma_migrations ORDER BY appliedAt DESC LIMIT 8;`
   - exit `1`
   - error: `no such column: name in SELECT id, name, appliedAt ...`

3. `SELECT id, migration_name, appliedAt FROM _prisma_migrations ORDER BY appliedAt DESC LIMIT 12;`
   - exit `1`
   - error: `no such column: appliedAt`

4. `SELECT * FROM _prisma_migrations ORDER BY created_at DESC LIMIT 20;`
   - exit `1`
   - error: `no such column: created_at`

5. Direct `PRISMA_DB` probe with Prisma Client against `file:./prisma/dev.db`
   - `$queryRaw` failed with `Error code 14: Unable to open the database file`

So:

- The `_prisma_migrations` table exists in `prisma/dev.db` (implied by `prisma migrate status` and error messages about missing columns).
- The **exact column names** in `_prisma_migrations` could not be confirmed in this investigation because Prisma Client path resolution failed and the CLI probes tripped on incorrect column-name assumptions.

### Why Prisma Client failed on `file:./prisma/dev.db`

The Prisma Client probe used `datasources: { db: { url: "file:./prisma/dev.db" } }` in a short-lived Node invocation. That failed with “Unable to open the database file”.

Likely reasons (unverified, listed as possibilities only):

- Relative `file:./prisma/dev.db` resolves relative to the Node process CWD, which may not be the project root in that invocation.
- The Prisma Client runtime in this environment may not have opened the file for another reason.

This was later partially mitigated by running `prisma db execute --url "file:$(realpath prisma/dev.db)"`, which succeeded with exit `0` and `Script executed successfully.`. That confirms the CLI can reach the real absolute path, but the CLI still did not return a usable table-name list.

### Migration record provenance conclusion for dev.db

From the read-only evidence:

- `prisma/dev.db` is present.
- `prisma migrate status` reports the database schema is up to date relative to `prisma/migrations` as seen by the CLI.
- No migration was applied during this investigation; the investigation used read-only SQL probes only.
- The migration history inside `_prisma_migrations` could not be fully enumerated because column names could not be confirmed in this investigation.

Therefore:

- **No evidence was found in this investigation that dev.db was modified during this turn.**
- The only operations against `prisma/dev.db` were read-only SQL probes via `prisma db execute --file` with absolute paths.

---

## 9. Whether the existing S-14 migration was ever applied to the development database before the attempted modification

### What can be confirmed

1. `prisma/migrations/20261105060000_session_lifecycle/migration.sql` exists on disk with S-14 DDL plus appended S-09 DDL.
2. `prisma migrate status` lists `6 migrations found in prisma/migrations` and says the dev schema is up to date.
3. The migration list seen by `prisma migrate status` includes `20261105060000_session_lifecycle`.

### What cannot be confirmed with full certainty

1. **Whether the current on-disk version of the S-14 migration file is identical to the version that was previously applied to `prisma/dev.db`.**
   - Reason: no committed version of this file path is available in HEAD for diff/ checksum comparison.
   - Reason: the file is untracked in Git at investigation time.
2. **Whether `prisma/dev.db`’s `_prisma_migrations` record references this exact file path or checksum.**
   - Reason: `_prisma_migrations` column names could not be confirmed in this investigation, so the applied-migration rows could not be fully enumerated.
3. **Whether the S-14 migration was applied before or after any S-09 modification.**
   - Reason: this investigation is read-only and does not have a pre-modification record to compare against.

### Plausible but unverified interpretation

The most defensible neutral position:

- The dev database appears to be in a state consistent with the current `prisma/migrations` tree as seen by `prisma migrate status`.
- The current on-disk S-14 migration file contains S-09 DDL.
- There is **no verified evidence** in this investigation that `prisma/dev.db` was migrated using the current on-disk S-14 file content, because:
  - no pre-modification checksum was captured,
  - no committed version exists for comparison,
  - and the `_prisma_migrations` rows were not fully readable.

So the statement “the S-14 migration was applied to dev.db before modification” is **not confirmable** from this investigation’s evidence.

---

## Reconciliation of the contradictory migration-check result

### What was actually reported earlier

In an earlier isolated disposable-DB check run, the captured outputs included:

- `migrate_exit=0`
- `client_exit=0`
- `prisma_client_table_found=true`
- `prisma_client_table_names=["PasswordResetToken"]`
- A synthesized line: `DISPOSABLE_MIGRATION_CHECK=FAIL`

### Why the report looked contradictory

The contradiction was in the **synthesized pass/fail line**, not in the underlying Prisma Client result.

The synthesized line was computed from a stale grep-based condition on the CLI `db execute --file` output, and that CLI path did **not** return a usable `PasswordResetToken` row in the captured log. So `password_reset_token_sql_rows=0` in that path, and the synthetic final line said `FAIL`.

Meanwhile the **Prisma Client** check said:

- `client_exit=0`
- `prisma_client_table_found=true`
- `prisma_client_table_names=["PasswordResetToken"]`

So:

- The CLI-based grep check failed in the captured log.
- The Prisma Client check passed in the captured log.
- The final synthetic line was inconsistent because it was not based on the part that actually passed.

### Distinction required by your request

1. **Prisma Client query passing**
   - Confirmed in the earlier isolated run: exit 0 and `prisma_client_table_found=true`.
   - This means the disposable DB reachable at that URL contained a table named `PasswordResetToken` according to Prisma Client.

2. **Harness assertion passing**
   - **Not confirmed** by this investigation.
   - This investigation did not run the full harness to completion in a surviving post-migration log.
   - Earlier harness attempts failed earlier for unrelated harness mechanics (missing local node binary path, trap cleanup ordering, and later the CLI grep path).
   - Therefore “harness assertion passed” is not established by this investigation.

3. **Complete isolated migration-validation step passing**
   - **Not cleanly established** as reported earlier.
   - The earlier isolated run had migration exit 0 and Prisma Client exit 0, but the final synthesized step-level result was `FAIL` because it was based on the wrong assertion signal.
   - So the earlier “complete step passed” claim is not supported by the earlier captured evidence as written.

---

## Confirmed facts

- `prisma/migrations/20261105060000_session_lifecycle/migration.sql` exists on disk with S-14 DDL and appended S-09 DDL.
- Current file md5 = `1eb245a60295cfd5f3c6b5aabf7d88d6`, size = `1256 bytes`.
- In the current Git working tree/index state, that file is **untracked** (`??`) and **not present in HEAD** as a tracked path.
- No separate S-09 migration directory exists in `prisma/migrations`.
- `prisma/dev.db` exists (`md5=105539bf89ee435a2ae6f838014c927e`, size `954368 bytes`).
- `prisma migrate status` reports `6 migrations found in prisma/migrations` and `Database schema is up to date!`.
- The CLI can reach `prisma/dev.db` via absolute path; a read-only `SELECT name FROM sqlite_master ...` probe exited 0.
- No migration, build, seed, or integration test was run during this investigation.

---

## Unverified assumptions

- That the current on-disk S-14 migration file is identical to any prior committed version.
  - Not verifiable here because the file is not present in HEAD for this path.
- That the S-14 migration was applied to `prisma/dev.db` in its current form.
  - Not verifiable here because `_prisma_migrations` columns were not fully readable and no pre-modification record exists.
- That `prisma/dev.db` was untouched by the earlier remediation activity this turn.
  - Not fully provable from this investigation alone; the investigation only confirms no migration was run this turn and only read-only probes were used this turn.
- That `prisma migrate status` reflects the exact applied migration history inside `_prisma_migrations`.
  - Reasonable but not fully confirmed because the `_prisma_migrations` schema columns could not be enumerated here.

---

## Remaining integrity questions for decision-making

1. Is `prisma/migrations/20261105060000_session_lifecycle/migration.sql` supposed to be a previously committed S-14 migration artifact?
   - In this repository state, it is **not present on HEAD**, and it is **untracked** now. So the “existing committed S-14 migration” premise is not supported by the current Git state.

2. Was the S-09 DDL added by editing that file directly?
   - The current on-disk file contains the appended S-09 DDL. Whether that happened through an edit this session versus some other prior state is not separately provable from this read-only investigation without a prior committed or pre-edit snapshot.

3. Should a separate S-09 migration artifact be used instead?
   - That is a remediation design decision, not a finding this investigation can resolve.

---

## Conclusion

This investigation confirms that, in the current working tree:

- There is an on-disk S-14 migration artifact that now also contains S-09 DDL.
- That artifact is **untracked** and **not present in HEAD** as a tracked path.
- No separate S-09 migration artifact was created.
- `prisma/dev.db` exists and is reported by `prisma migrate status` as up to date relative to `prisma/migrations`.
- No migrations were applied during this investigation; only read-only probes were used.

It does **not** confirm:

- A prior committed version of the S-14 migration file.
- That the current file matches any previously applied version.
- That `prisma/dev.db` was or was not migrated against this exact file content.
- That the harness assertion or complete isolated validation step passed.

**Claim:** the S-14 migration artifact exists on disk with appended S-09 DDL and is untracked/unavailable in HEAD in this repository state; no separate S-09 migration exists; no migrations were applied during this investigation.

**Not claimed:** that the S-14 migration was applied to dev.db in its current form, that a committed version exists for comparison, or that any earlier remediation assertions passed cleanly.
