# S-09 password reset tokens — migration provenance

Purpose: durable, single-use, hashed password-reset tokens for email-based password
recovery (Stage 2 Task 9, audit finding S-09).

**Status of this document:** rewritten on 2026-11-17 during the Part 1 closeout after the
checksum discrepancy was resolved from a preserved copy of the applied migration. The
earlier version of this note said the migration was "the file name Prisma generated
during that run"; that was inaccurate in a more serious way than missing detail — the
`PasswordResetToken` DDL was **appended to an already-applied migration**.

No migration file, database or schema was changed while establishing this.

## 1. Where the model actually comes from

`PasswordResetToken` lives in the **S-14 session-lifecycle migration directory**:

| Item | Value |
|---|---|
| Migration directory | `prisma/migrations/20261105060000_session_lifecycle/` |
| Migration file | `prisma/migrations/20261105060000_session_lifecycle/migration.sql` |
| Current file SHA-256 | `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40` |
| Checksum recorded in `_prisma_migrations` | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968` |
| Table created | `PasswordResetToken` |

There is **no** `password_reset_tokens` migration and no standalone S-09 migration.

## 2. Provenance timeline (evidence-based)

| When | Event | Evidence |
|---|---|---|
| Migration authored | `20261105060000_session_lifecycle/migration.sql` contained **only** S-14 DDL (`Session.lastUsedAt` + `Session_userId_lastUsedAt_idx`). It did **not** contain `PasswordResetToken`. | The preserved copy at `prisma/disposable_scratch/clean_workspace/prisma/migrations/20261105060000_session_lifecycle_clean_s14/migration.sql` hashes to exactly the recorded `539bd5b6…`, and its `PasswordResetToken` section is **absent**. |
| Applied | Row written to `_prisma_migrations` with checksum `539bd5b6…`, `finished_at` set, `applied_steps_count = 1`. | Live `dev.db`, read-only query. |
| Duplicate applied | A byte-identical directory `…_clean_s14` was applied and failed: `duplicate column name: lastUsedAt`, 0 steps, `finished_at` NULL. | Its own log; both rows carry the same `539bd5b6…` checksum, proving the duplicate was a byte copy of the applied version. |
| `2026-11-09 17:39` | The real migration file was **edited**: the S-09 comment, `CREATE TABLE "PasswordResetToken"` and its two indexes were appended (15 added lines, no other change). File hash became `33b41fc7…`. | `diff -u` between the preserved `539bd5b6…` copy and the current file shows exactly one added hunk (the S-09 block) and no deletions or modifications. File mtime. |
| Since then | `prisma/dev.db` contains `PasswordResetToken`, but **not** with the DDL the current file produces: it has `id TEXT NOT NULL PRIMARY KEY` (no default), `used BOOLEAN NOT NULL DEFAULT false`, a **named** `CONSTRAINT "PasswordResetToken_userId_fkey" … ON UPDATE CASCADE`, and a **named** unique index `PasswordResetToken_hashedToken_unique`. | Live DDL, compared against a freshly migrated database (§4). |
| 2026-11-17 | The failed duplicate row was marked rolled back after proof that it changed nothing. No migration SQL was touched. | Part 1 recovery evidence. |

**Conclusion on the four questions**

1. *Was the file edited after application?* **Yes.** The applied bytes (`539bd5b6…`) had no
   `PasswordResetToken` DDL; the current bytes (`33b41fc7…`) do.
2. *Did the edit change schema semantics or only constraint naming?* **Semantics — it added
   an entire table and two indexes.** It was not a cosmetic rename.
3. *Was the existing development database created from the current file or a previous one?*
   **Neither, for this table.** The migration row belongs to the previous version. The
   table's DDL shape — named foreign key with `ON UPDATE CASCADE`, named unique index,
   `BOOLEAN` column — is what Prisma's schema-sync path (`db push`) generates, not what the
   hand-written migration SQL generates. The project's own
   `STAGE2_TASK9_S09_INDEPENDENT_REVIEW_REPORT.md` recommended exactly this reading and
   warned against relying on `db push` as the migration artifact (its §"recommendations").
   Direct proof of the exact command used is not recorded in any report; this is a strong
   inference from DDL shape plus the absent DDL in the applied version.
4. *Do any other migrations have checksum inconsistencies?* **No.** All five other applied
   migrations match their files byte-for-byte.

## 3. Consequence for reproducibility

`prisma migrate deploy` on an empty database **does** create `PasswordResetToken`, because
deploy executes the current file. This was verified in Part 1 (the disposable database
contains the table, its indexes and all six columns).

The hazard is the other direction: any database created **before** the 2026-11-09 edit and
migrated with the old bytes has the S-14 schema but no `PasswordResetToken` table, and
Prisma considers migrations up to date, so `migrate deploy` will never add it. Such a
database only works if something else (a `db push`) created the table.

## 4. Exact difference between a fresh deployment and `prisma/dev.db`

Object counts: `prisma/dev.db` has 107 table/index objects, a freshly migrated database has
106. Exactly one object differs:

| Aspect | Fresh DB (from migrations) | `prisma/dev.db` |
|---|---|---|
| Unique enforcement | table-level `UNIQUE("hashedToken")` → implicit `sqlite_autoindex_PasswordResetToken_1` | separate `CREATE UNIQUE INDEX "PasswordResetToken_hashedToken_unique"` |
| `id` column | `TEXT NOT NULL PRIMARY KEY DEFAULT "cuid()"` | `TEXT NOT NULL PRIMARY KEY` (no default) |
| `used` column | `INTEGER NOT NULL DEFAULT 0` | `BOOLEAN NOT NULL DEFAULT false` |
| Foreign key | inline `REFERENCES "User"("id") ON DELETE CASCADE` | named `CONSTRAINT "PasswordResetToken_userId_fkey" … ON DELETE CASCADE ON UPDATE CASCADE` |
| Indexes | `PasswordResetToken_userId_idx`, `PasswordResetToken_expiresAt_idx` | same two, same names |

All five other migration timestamps produce byte-identical DDL in both databases.

**Classification:** a **migration provenance problem** that manifests as a **structurally
different but functionally equivalent** schema. It is not a behavioral difference for the
application (Prisma always supplies `id`; `User.id` is never updated; uniqueness and cascade
delete are enforced in both). The two latent hazards are (a) the literal `DEFAULT "cuid()"`
string in the migration SQL, which would collide if a row were ever inserted without an
explicit `id` — the application never does this — and (b) a pre-2026-11-09 database that
never received the table at all.

## 5. Recommended resolution (not implemented — owner approval required)

1. Create a **new** forward migration (do not edit `20261105060000_session_lifecycle` again)
   that normalises the live database to the datamodel: replace the implicit/explicit unique
   constraint naming so `prisma migrate diff --from-migrations … --to-schema-datamodel …` is
   empty, and record the checksum mismatch as a known historical exception.
2. Before that, decide which shape is canonical: Prisma-managed (`db push`-style, named
   constraints) or hand-written migration SQL. The datamodel already uses
   `@@unique(..., map: "PasswordResetToken_hashedToken_unique")`, so aligning the migration
   SQL to that name is the smaller change.
3. Re-verify with a fresh disposable database plus the isolated harness, and record the
   `_prisma_migrations` checksum exception permanently in this document.

## 6. Security notes (unchanged)

- Reset tokens are stored only as a salted SHA-256 hash; the raw token is never persisted
  or logged.
- Token consumption, password update and session revocation occur in one interactive
  transaction.
- The reset-request response is identical whether or not an account exists.

## 7. Known functional gaps (unchanged; Part 2 scope)

- No `/reset-password` page exists, so the emailed reset link resolves to no route.
- The reset-request endpoint applies no throttling.
- `src/lib/auth/reset-token.test.ts` is not included in `vitest.config.ts`.
