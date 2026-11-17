# A6 — C-1 DOCUMENTATION CORRECTION CLOSEOUT

**Date:** 2026-11-18
**Basis:** owner review of `A17_A6_INDEPENDENT_ACCEPTANCE_AUDIT.md` (audit target `decfa68`).
Owner decisions: **A17 ACCEPTED**; **A6 CONDITIONALLY ACCEPTED, subject to C-1**.
**Authorization scope:** documentation correction only — correct the closeout report, withdraw the
transactional-rollback guarantee, document the measured DDL-before-DML behaviour and the DML-before-DROP
ordering rationale, record C-2 and C-3 as standing notes, produce this report.
**Not in scope and not performed:** S-14, S-12, S-02, billing/entitlements, C-03, code, tests, schema,
migrations, database contents, Git history.

| Item | Status |
|---|---|
| C-1 — transactional-rollback claim withdrawn and replaced with measured behaviour | **DONE** |
| C-2 — `migrate status` checksum-blindness recorded as a standing audit note | **DONE** |
| C-3 — non-literal "individual test execution" recorded as a standing audit note | **DONE** |
| Applied migration | **UNCHANGED** |
| Historical migrations / checksums | **UNCHANGED** |
| Database contents | **UNCHANGED** |

---

## 1. The claim that was wrong

`A17_A6_IMPLEMENTATION_CLOSEOUT_REPORT.md` revision 1, A6 §2, justified the pragma with:

> "`PRAGMA defer_foreign_keys = ON` is used because `PRAGMA foreign_keys` cannot be toggled inside the
> transaction Prisma wraps migrations in …"

Read plainly, that asserts Prisma executes migration DDL inside a rollback-capable transaction. The audit
disproved it as a blanket claim (finding **A6-F7**), and the same wording had been copied into
`docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md` §6, so both were corrected.

The pragma itself is still **justified and still needed** — `PRAGMA foreign_keys` genuinely cannot be
changed inside a transaction — but its stated *reason* no longer implies a rollback guarantee it does not
have.

## 2. What was measured (audit evidence, reproduced 5×)

Disposable `/tmp` databases: seven migrations applied, one `PasswordResetToken` row present, then one extra
migration that performs a destructive statement followed by a deliberate error.

| Case | Failing body | Outcome |
|---|---|---|
| A | `DROP TABLE …; SELECT * FROM nope;` | table gone, rows lost |
| E | `PRAGMA defer_foreign_keys=ON; DROP …; SELECT * FROM nope;` | table gone |
| F | `CREATE TEMP TABLE …; DROP …; SELECT * FROM nope;` | table gone |
| D | `INSERT …; DROP …; SELECT * FROM nope;` | rolled back — table present, 1 row |
| tx2 | as D, different database | rolled back — table present, 1 row |

**Recorded conclusion:** statements before a migration script's **first DML** are not rolled back on a
later failure; DDL following the first DML is. The mechanism is a hypothesis, not a Prisma guarantee, and
the report now says so explicitly.

## 3. Why this migration's ordering matters

`prisma/migrations/20261118000000_password_reset_token_alignment/migration.sql`:

| Line | Statement | Inside the rolled-back window? |
|---|---|---|
| 23 | `PRAGMA defer_foreign_keys = ON` | no (pre-DML) |
| 26 | `CREATE TABLE IF NOT EXISTS "PasswordResetToken"` | no (pre-DML) |
| 37 | `CREATE TABLE "new_PasswordResetToken"` | no (pre-DML) |
| 47 | `INSERT INTO "new_PasswordResetToken" … SELECT …` | **first DML** |
| 50 | `DROP TABLE "PasswordResetToken"` | yes |
| 52 | `ALTER TABLE … RENAME TO "PasswordResetToken"` | yes |
| 54, 56, 58 | unique + two non-unique indexes | yes |

The destructive `DROP` therefore sits after the first DML — exactly the recoverable configuration of cases
D/tx2. Had the script dropped before copying, any later failure would have destroyed the live table. This
is now documented as an **ordering requirement that must not be rearranged in future review**, not as a
guarantee that the runner will protect the operator.

**Residual risk now recorded:** a failure in the pre-DML prefix (either `CREATE TABLE`, or the `INSERT`
itself on a legacy database whose rows violate the new foreign key) aborts with the created objects still
present, so a naive retry collides with `new_PasswordResetToken` and needs manual cleanup. Whether that
residue in fact occurs was not isolated (audit **A6-F9**, UNVERIFIED); it is carried as an open risk. No
such failure occurred in this implementation: the migration succeeded on every state tested.

## 4. Standing audit notes (C-2, C-3)

- **C-2 — `migrate status` does not detect the historical checksum mismatch.** It prints "Database schema
  is up to date!" although the `20261105060000_session_lifecycle` row records `539bd5b6…` while the file
  hashes to `33b41fc7…`. Status validates schema shape and row presence, not checksum equality. The
  mismatch is therefore invisible in routine operation and can be excluded only by a explicit checksum
  comparison — it must never be inferred as absent.
- **C-3 — "run both affected tests individually" was not met literally.** `scripts/verify-api.mjs` has a
  single mode switch (`ONLY_S12`) and no per-check selector; none was added because that would have changed
  the suite's semantics during the repair. Equivalence was shown by named result lines in two independent
  full runs. Recorded as a process deviation, not a verification gap.

## 5. Files changed by this correction

| File | Change |
|---|---|
| `A17_A6_IMPLEMENTATION_CLOSEOUT_REPORT.md` | Revision 2: correction banner; A6 §2 claim replaced; new §2.1 (measured behaviour, ordering rationale, residual risk); §7 C-2 note; §9 pragma bullet qualified; new **Standing audit notes** and correction-status table; two new risk items |
| `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md` | §6: duplicated claim removed; pointer to §2.1 added |
| `A6_C1_DOCUMENTATION_CORRECTION_REPORT.md` | **New** — this report |

Not changed: `prisma/migrations/**` (including the A6 migration), `prisma/schema.prisma`, `prisma/dev.db`,
`scripts/**`, `src/**`, `STATE.md`, `README.md`, and all historical reports.

## 6. Verification performed

| Check | Result |
|---|---|
| Applied migration byte-identical to `decfa68` | **PASS** |
| Historical migration directories byte-identical to `decfa68` | **PASS** |
| `prisma/dev.db` SHA-256 / integrity / row counts unchanged (`59d9cb2c…`) | **PASS** |
| No migration executed; no experiment run against the project database | **PASS** |
| No residual "Prisma wraps migrations in a transaction" claim anywhere in the tree | **PASS** |
| C-1 / §2.1 / C-2 / C-3 present in the corrected documents | **PASS** |
| Tracked-tree diff limited to the two documentation files | **PASS** |

Commands and exact outputs are in the accompanying message.

## 7. Status

**C-1 is applied.** The documentation no longer asserts a rollback guarantee that Prisma does not provide,
the measured behaviour is recorded, and the reason this migration's ordering is safe is stated as an
empirical property of that ordering.

**A6 is therefore eligible for unconditional owner acceptance.** That final acceptance is the owner's to
grant; this report does not declare it, and neither acceptance nor A17's remains self-certified here.
