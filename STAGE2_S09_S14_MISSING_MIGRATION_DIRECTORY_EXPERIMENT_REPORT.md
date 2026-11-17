# SellFlow — Disposable Prisma Missing-Migration-Directory Experiment Report

**Document type:** Disposable experiment report — not a reconciliation, migration, or database change on any real project resource  
**Prisma CLI version examined:** `6.19.3`  
**Prisma Client version examined:** `6.19.3`  
**Node.js:** `v22.23.2`  
**Runtime used for commands:** project-installed `node_modules/.bin/prisma` resolved by absolute path from `/home/binpharees/Documents/SellFlow-Bootcamp-v2`

---

## 1. Executive result

The experiment was designed to test one narrow question:

> When a disposable database contains a completed `_prisma_migrations` record for a migration whose local directory is absent from the active `prisma/migrations/` tree, what does Prisma 6.19.3 do under `prisma migrate status` and `prisma migrate deploy`?

**Observed result:**
- Prisma reported `5 migrations found in prisma/migrations`.
- `prisma migrate status` exited `0` and printed `Database schema is up to date!`.
- `prisma migrate deploy` exited `0` and printed `No pending migrations to apply.`
- The disposable database was not changed by either command: it still contained 6 `_prisma_migrations` rows, including the injected record, and still did not contain `PasswordResetToken`.
- Integrity was `ok` and there were no foreign-key violations.

**Interpretation:**
- On this version and configuration, Prisma did **not** surface the injected completed migration as pending because its local directory was missing.
- Prisma did **not** attempt to re-apply it, nor did it refuse to run or complain about the missing local directory in the captured output.
- This is one observed behavior on one set of inputs, not a general statement about all Prisma versions, schemas, or migration shapes.

**Remaining uncertainty:**
- This experiment only covers `prisma migrate status` and `prisma migrate deploy` from a clean CLI invocation.
- It does not prove every future command path, every migration shape, or every Prisma version would behave the same way.
- It also does not determine the correct reconciliation approach for the real project, only that the immediate behavioral blocker is now observed rather than assumed.

---

## 2. Environment

### 2.1 Installed Prisma tooling
- `prisma`: `6.19.3`
- `@prisma/client`: `6.19.3`
- Prisma schema loaded from: `prisma/schema.prisma` (disposable copy)
- Query Engine (Node-API): `libquery-engine c2990dca591cba766e3b7ef5d9e8a84796e47ab7`
- Schema Engine: `schema-engine-cli c2990dca591cba766e3b7ef5d9e8a84796e47ab7`
- Binary target: `debian-openssl-3.0.x`
- OS / arch: `linux` / `x64`

### 2.2 Where Prisma was resolved from
All commands were run with:
- working directory: `/tmp/sellflow_exp_missing_dir`
- `DATABASE_URL=file:/tmp/sellflow_exp_missing_dir/prisma/exp.db`
- Prisma CLI resolved from `/home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma`

The disposable workspace itself contained no `node_modules` directory. So Prisma did not run from inside the disposable tree; it ran from the project’s installed copy.

---

## 3. Disposable workspace and database paths

All disposable artifacts were created under:

- `/tmp/sellflow_exp_missing_dir`
- disposable schema: `/tmp/sellflow_exp_missing_dir/prisma/schema.prisma`
- disposable migrations root: `/tmp/sellflow_exp_missing_dir/prisma/migrations`
- disposable database: `/tmp/sellflow_exp_missing_dir/prisma/exp.db`

Isolation checks performed:
- The disposable database path is not the real project database path.
- The workspace is under `/tmp`.
- The disposable `prisma/migrations/` tree contains only the five retained migration directories.
- `20261105060000_session_lifecycle` is genuinely absent from the disposable migration tree.
- The real project database file was never opened for modification.

---

## 4. Exact test setup

### 4.1 Disposable migration directory
Built as a copy-only subset of the current project migration tree:
- `prisma/migrations/20261102203150_init/`
- `prisma/migrations/20261102213950_dispute_claim_link/`
- `prisma/migrations/20261102222213_subscriptions/`
- `prisma/migrations/20261104060000_login_throttle/`
- `prisma/migrations/20261105000000_stock_integrity/`

**Excluded intentionally:**
- `prisma/migrations/20261105060000_session_lifecycle/` (absent from the disposable tree)

### 4.2 Disposable database
Created through Prisma by running `prisma migrate deploy` against an empty disposable database with `DATABASE_URL` pointing only at the disposable file.

That means:
- the five retained migrations were applied normally by Prisma,
- a real Prisma `_prisma_migrations` history was created for those five migrations,
- the database schema reflects those five migrations only.

### 4.3 Synthetic missing-directory record
After the five migrations were applied, one completed record was inserted directly into `_prisma_migrations` using SQLite from a **writable connection to the disposable database only**.

Inserted row:
- `id`: `missing-dir-exp-injected`
- `checksum`: `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- `migration_name`: `20261105060000_session_lifecycle`
- `started_at`: `1794257220`
- `finished_at`: `1794257220`
- `applied_steps_count`: `1`
- `rolled_back_at`: `null`
- `logs`: `null`

This checksum is the historical stored checksum documented in the recovery plan. It is used here only as synthetic test data for the disposable experiment. It is **not** a claim that the contaminated local file is authentic or safe.

### 4.4 Verification before testing
Before testing, the disposable setup was verified to contain:
- the database file inside the temporary workspace,
- the migration directory inside the temporary workspace,
- the omitted migration directory genuinely absent,
- the completed migration row present,
- the five retained directories and rows present,
- the real project database path not configured.

---

## 5. Migration rows before testing

After `migrate deploy` applied the five retained migrations and before the synthetic record was added, the disposable `_prisma_migrations` table contained 5 rows, one per retained migration.

The retained migrations had these names, in chronological order:
1. `20261102203150_init`
2. `20261102213950_dispute_claim_link`
3. `20261102222213_subscriptions`
4. `20261104060000_login_throttle`
5. `20261105000000_stock_integrity`

At that point, the disposable database did not yet contain any record named `20261105060000_session_lifecycle`.

---

## 6. Exact commands and outputs

### 6.1 `prisma migrate status`

Command:
```bash
cd /tmp/sellflow_exp_missing_dir
DATABASE_URL="file:/tmp/sellflow_exp_missing_dir/prisma/exp.db" \
  node /home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma migrate status
```

Exit code: `0`

Stdout/stderr:
```
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "exp.db" at "file:/tmp/sellflow_exp_missing_dir/prisma/exp.db"

5 migrations found in prisma/migrations

Database schema is up to date!
```

### 6.2 `prisma migrate deploy`

Command:
```bash
cd /tmp/sellflow_exp_missing_dir
DATABASE_URL="file:/tmp/sellflow_exp_missing_dir/prisma/exp.db" \
  node /home/binpharees/Documents/SellFlow-Bootcamp-v2/node_modules/.bin/prisma migrate deploy
```

Exit code: `0`

Stdout/stderr:
```
warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).

Prisma schema loaded from prisma/schema.prisma
Datasource "db": SQLite database "exp.db" at "file:/tmp/sellflow_exp_missing_dir/prisma/exp.db"

5 migrations found in prisma/migrations

No pending migrations to apply.
```

---

## 7. Migration rows after each command

### 7.1 After `prisma migrate status`
`_prisma_migrations` contained 6 rows, including the injected record.

After status:
- `missing-dir-exp-injected`
  - `migration_name`: `20261105060000_session_lifecycle`
  - `checksum`: `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
  - `started_at`: `1794257220`
  - `finished_at`: `1794257220`
  - `applied_steps_count`: `1`
  - `rolled_back_at`: `null`
  - `logs`: `null`
- the five retained rows were unchanged.

### 7.2 After `prisma migrate deploy`
`_prisma_migrations` again contained 6 rows, still including the injected record.

No new rows were added, no existing rows were removed, and the injected record still appeared as completed.

So:
- `_prisma_migrations` was not altered by either command.
- The injected record was not removed, revised, or marked as pending by the captured output.

---

## 8. Schema differences before and after

### Before the synthetic injection
- Disposable database had schema from the five retained migrations.
- `PasswordResetToken` did not exist.

### After `migrate status`
- No schema change.
- `PasswordResetToken` still did not exist.

### After `migrate deploy`
- No schema change.
- `PasswordResetToken` still did not exist.
- No indexes on `PasswordResetToken` existed.

### Conclusion on schema effects
In this experiment, neither command created or altered `PasswordResetToken`, and neither command altered the existing schema in any captured way.

---

## 9. Integrity and foreign-key check results

### Disposable database after injection
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: `[]` (no violations)

### Disposable database after status
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: `[]` (no violations)

### Disposable database after deploy
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: `[]` (no violations)

### Real project database
- File SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`
- Size: `954368` bytes
- `PRAGMA integrity_check`: `ok`
- `PRAGMA foreign_key_check`: `[]`
- `_prisma_migrations` count: `6`

No command was run against the real database, and its integrity and history remained unchanged.

---

## 10. Real database SHA-256 before and after

Before the experiment:
- `prisma/dev.db` SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`

After the experiment:
- `prisma/dev.db` SHA-256: `c80bf537c460e50f52de7bda902f0c11f16ba6ae95b7ad32a36db8fd2c3464cc`

The real database file was not modified by this experiment.

---

## 11. Does this experiment prove how Prisma handles an applied migration with no local directory?

It proves one thing, not everything.

**It proves, for Prisma 6.19.3 with this disposable setup and these commands:**
- a completed `_prisma_migrations` record can coexist with a missing local migration directory without causing the captured CLI to flag the database as pending or out of date,
- `migrate deploy` did not attempt to apply the missing migration, and
- `migrate status` reported “Database schema is up to date!” and exit code 0.

**It does not prove:**
- that this is the only possible behavior for every migration name, checksum mismatch, schema, or Prisma version,
- that future Prisma migrations will treat the record identically,
- that the missing-local-directory state is semantically acceptable in the real project,
- or that any particular reconciliation design is safe.

So this experiment narrows the blocker: it shows the immediate behavior is not “Prisma refuses to proceed because the directory is missing” in this disposable case. It does not fully resolve the broader reconciliation design.

---

## 12. Limitations and what remains unverified

### Limitations
- This is one disposable run, one Prisma version, one schema shape, and one missing-directory scenario.
- It uses a synthetic record inserted directly into `_prisma_migrations`, not a migration that Prisma itself created.
- It does not test commands beyond `prisma migrate status` and `prisma migrate deploy`.
- It does not test an existing database that already has the S-14/S-09 schema, only a clean disposable database with five applied migrations plus one injected record.

### Still unverified for the real project
- how Prisma would handle the actual contaminated migration file if its directory were removed from the active path but its record remained in `_prisma_migrations`,
- whether any future migrate operation could reinterpret the completed record in a way that matters for the contaminated artifact,
- whether the contaminated migration name or checksum should be preserved, retired, or represented differently in the real project,
- whether a later migration added after the missing-directory record would stay coherent.

### Recommendation
Use this experiment as evidence that the immediate fear — “Prisma fails immediately because the directory is absent” — did not materialize here. Keep the Gate 1 decision conservative until the reconciliation design for the contaminated record is also settled.

---

## 13. Authorization confirmation

This report was produced from a disposable experiment only.

No change was made to:
- `prisma/dev.db`
- any real project migration directory
- `prisma/schema.prisma`
- application source
- environment files
- package files

No `prisma migrate resolve`, migration repair, or migration-history reconciliation was performed on any real database.

---

## 14. Files produced by this experiment

- `STAGE2_S09_S14_MISSING_MIGRATION_DIRECTORY_EXPERIMENT_REPORT.md`
- disposable workspace: `/tmp/sellflow_exp_missing_dir` (temporary, not part of the project tree)

The disposable workspace contains:
- `package.json`
- `prisma/schema.prisma`
- `prisma/migrations/`
- `prisma/exp.db`

No project files were modified to produce this report.
