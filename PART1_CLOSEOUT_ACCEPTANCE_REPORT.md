# PART 1 CLOSEOUT — INDEPENDENT ACCEPTANCE EVIDENCE RECONCILIATION

**Date:** 2026-11-17
**Scope:** bounded closeout of Part 1. Documentation and register-validator corrections only.
**Not authorized and not done:** Part 2, S-09 UI/throttling, test repairs, migration edits, schema
changes, migration commands, database changes, application code changes.

**Headline:** Part 1 is **not** accepted. Three defects in the original Part 1 report are
corrected below, and one finding (S-14) is removed from the accepted set because its acceptance
cannot be demonstrated.

---

## 1. S-14 acceptance provenance

### 1.1 What exists

| Artifact | Content | Is it acceptance? |
|---|---|---|
| Implementation authorization | `D-019 Implementation GO`, 2026-11-04 (`STATE.md`). Authorizes implementation work in general. | **No** — authorization ≠ acceptance |
| Implementation report | `STAGE2_TASK8_S14_REPORT.md` | **No** — a report of work done |
| "Formal acceptance" report | `STAGE2_TASK8_S14_FINAL_ACCEPTANCE_REPORT.md` (2026-11-06). Header: **"Reviewer: Buffy (automated acceptance review)"**, "Decision: **ACCEPTED**" | **No** — agent self-assertion |
| Readiness re-review | `STAGE2_TASK8_S14_READINESS_REPORT.md` (2026-11-09) repeats "already implemented and accepted (2026-11-06)" | **No** — cites the agent report circularly |
| Test evidence | 500 PASS / 0 FAIL isolated run, log `/tmp/sf-s14-clean-final9.log` | **No** — a passing run is not acceptance |
| Owner acceptance decision | **None found anywhere in the repository** | — |

### 1.2 The decisive quotation

`STAGE2_TASK8_S14_FINAL_ACCEPTANCE_REPORT.md`, line 278:

> "The acceptance review is based on the automated verification run on 2026-11-06. A human owner
> review of the S-14 implementation and evidence may still be warranted before production release."

A report that says human owner review *may still be warranted* cannot itself constitute that
review. A repository-wide search for any owner acceptance statement returned nothing.

### 1.3 Conclusion

Formal acceptance of S-14 did **not** occur. The register now records S-14 as
**Verification in progress** with the note "No owner acceptance recorded", its evidence is
retained in a new *Pending owner acceptance* table, and the validator asserts that S-14 is not in
the accepted set. S-14 runtime behavior was not touched.

### 1.4 Same defect in other findings (reported, not changed)

| Finding | Provenance | Action taken |
|---|---|---|
| S-01 | `STAGE2_TASK9_S01_ACCEPTANCE_REPORT.md` line 7: "**Authorization:** Project owner GRANTED for this task (formal S-01 acceptance + cleanup)**" | Left Accepted — this is the only recorded owner grant |
| S-02 | Accepted on three documents; **`S02_FINAL_DISPOSITION.md` does not exist in the repository** | Left Accepted; missing-evidence caveat recorded; **owner decision required** |
| S-12 | Both acceptance reports are "Reviewer: Buffy (automated acceptance review)", `Decision: ACCEPTED`; no owner grant found | Left Accepted; caveat recorded; **owner decision required** |
| S-14 | As above, plus its own disclaimer | **Changed** to Verification in progress |

S-02 and S-12 are the same provenance class as S-14. They were not changed unilaterally because
the closeout instruction named S-14 and Part 1 forbids reopening accepted findings without
evidence of regression. They are flagged for the owner.

---

## 2. Migration checksum provenance — resolved

The discrepancy is **not** a mystery any more. A preserved copy of the applied bytes was found at
`prisma/disposable_scratch/clean_workspace/prisma/migrations/20261105060000_session_lifecycle_clean_s14/migration.sql`,
and it hashes to exactly the recorded checksum.

| File | SHA-256 | Contains `PasswordResetToken`? |
|---|---|---|
| Preserved applied copy (also the failed duplicate directory) | `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968` | **No** |
| Current `20261105060000_session_lifecycle/migration.sql` | `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40` | Yes |

`diff -u` of the two shows exactly **one added hunk, zero deletions, zero modifications**:

```diff
@@ -7,3 +7,18 @@
 CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt");
+
+-- S-09: single-use, hashed password-reset tokens. ...
+CREATE TABLE "PasswordResetToken" (
+  "id" TEXT NOT NULL PRIMARY KEY DEFAULT "cuid()",
+  ...
+  UNIQUE("hashedToken")
+);
+CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
+CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
```

### 2.1 Answers to the five questions

1. **Was the file edited after application?** **Yes.** The applied bytes had no
   `PasswordResetToken` DDL; the current bytes do. File mtime 2026-11-09 17:39.
2. **Did the edit change schema semantics or only naming?** **Semantics** — it added a table and
   two indexes.
3. **Was the existing database created from the current file or a previous version?** For this
   table, **neither**: the migration row belongs to the previous version, and the table's DDL in
   `prisma/dev.db` has the shape Prisma's `db push` produces (named foreign key with
   `ON UPDATE CASCADE`, named unique index, `BOOLEAN` column), not the hand-written migration
   shape. Direct proof of the command is not recorded; the inference rests on DDL shape plus the
   absent DDL, and is consistent with `STAGE2_TASK9_S09_INDEPENDENT_REVIEW_REPORT.md`, which
   warned against relying on `db push` as the migration artifact.
4. **Do any other migrations have checksum inconsistencies?** **No.** All five others match their
   files exactly (verified per-row, read-only).
5. **Does a fresh deployment differ from the existing development database? Only in
   `PasswordResetToken`** — 107 objects in `dev.db` vs 106 fresh, and exactly one DDL body
   differs (§3).

### 2.2 Timeline

1. Migration authored with S-14 DDL only (`539bd5b6…`) and applied successfully.
2. A byte-identical duplicate (`…_clean_s14`, same checksum) applied later and failed with
   `duplicate column name: lastUsedAt`, 0 steps.
3. 2026-11-09 17:39: S-09 DDL appended to the already-applied file → `33b41fc7…`.
4. `prisma/dev.db` gained `PasswordResetToken` outside the migration path.
5. 2026-11-17: failed duplicate marked rolled back after proof it changed nothing.

**No migration file, migration command or database was modified in this closeout.**

---

## 3. Schema drift — exact comparison

`prisma migrate diff --from-migrations … --to-schema-datamodel …` reports
`[*] Redefined table "PasswordResetToken"` — one table, nothing else.

| Aspect | Fresh DB (migrations) | `prisma/dev.db` | Schema (`schema.prisma`) |
|---|---|---|---|
| Table | `PasswordResetToken` | `PasswordResetToken` | `model PasswordResetToken` |
| `id` | `TEXT NOT NULL PRIMARY KEY DEFAULT "cuid()"` | `TEXT NOT NULL PRIMARY KEY` | `String @id @default(cuid())` |
| `userId` | `TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE` | `TEXT NOT NULL` + named FK constraint | `String` + `@relation(onDelete: Cascade)` |
| `hashedToken` | `TEXT NOT NULL` | `TEXT NOT NULL` | `String` |
| `used` | `INTEGER NOT NULL DEFAULT 0` | `BOOLEAN NOT NULL DEFAULT false` | `Boolean @default(false)` |
| `expiresAt` | `DATETIME NOT NULL` | `DATETIME NOT NULL` | `DateTime` |
| `createdAt` | `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP` | same | `DateTime @default(now())` |
| Unique | table-level `UNIQUE("hashedToken")` → `sqlite_autoindex_PasswordResetToken_1` | `CREATE UNIQUE INDEX "PasswordResetToken_hashedToken_unique"` | `@@unique([hashedToken], map: "PasswordResetToken_hashedToken_unique")` |
| Indexes | `…_userId_idx`, `…_expiresAt_idx` | identical names | `@@index([userId])`, `@@index([expiresAt])` |
| Foreign key name | none (inline) | `PasswordResetToken_userId_fkey` | implicit name |

All other 5 migration steps produce byte-identical DDL in both databases.

### 3.1 Classification

- **Functionally equivalent but structurally different** — yes: uniqueness, cascade delete and
  column types behave identically for this application.
- **Genuine behavioral difference** — no, under current code paths: Prisma always supplies `id`,
  `User.id` is never updated (so the missing `ON UPDATE CASCADE` in the migration version is
  inert), and no application insert omits `id` (so the literal `DEFAULT "cuid()"` string is
  inert). It **would** become behavioral if raw SQL inserted without an `id`.
- **Migration provenance problem** — **yes, this is the root cause**: S-09 DDL was appended to an
  applied migration and the live table came from a schema-sync path.
- **Combination** — yes: provenance problem producing a functionally-equivalent structural
  difference, with two latent hazards (the literal default; pre-2026-11-09 databases that never
  received the table).

### 3.2 Recommended resolution (not implemented)

Create a **new** forward migration that aligns constraint naming with the datamodel (the datamodel
already names the unique constraint, so aligning the migration SQL is the smaller change), keeping
the historical checksum exception documented. Re-verify with a fresh disposable database and the
isolated harness. **Owner approval is required before any schema change.**

---

## 4. Corrected acceptance matrix

The previous report marked **A17 PASS despite exit code 1**. That is corrected to **FAIL**.

| ID | Was | Is | Evidence |
|---|---|---|---|
| A1 | PASS | **PASS** | Backup re-verified: `1a17bf33…`, 2,194,229 B, 527 entries, readable |
| A2 | PASS | **PASS** | Recovery proven on copy: schema/row fingerprint unchanged |
| A3 | PASS | **PASS** | `migrate status` exit 0; 0 unresolved failed rows |
| A4 | PASS | **PASS** | `migrate deploy` exit 0 on empty DB |
| A5 | PASS | **PASS** | 34 tables incl. all required S-09/S-11/S-14 objects |
| A6 | BLOCKED | **BLOCKED** | Drift documented exactly (§3); owner approval or formal acceptance of the limitation still required |
| A7 | PASS | **PASS** | Commit `43264eb`, 243 files |
| A8 | PASS | **PASS** | No key material, no DB file staged; `.env.example` withheld |
| A9 | PASS | **PASS** | Clean tracked tree; **21** documented untracked exclusions (§5) — previously mis-stated as 19 |
| A10 | PASS | **PASS** | Register rebuilt to canonical IDs; validator 9/9 |
| A11 | PASS | **PASS** (caveat) | Open/accepted contradiction removed — S-12 appears once. Its underlying acceptance is agent-authored; flagged for owner |
| A12 | PASS | **PASS** | Validator exit 0, 9 checks |
| A13 | PASS | **PASS** | 33 models verified by count; 450 call-sites vs 484 executed checks |
| A14 | PASS | **PASS** | Doc rewritten with resolved checksum provenance and exact drift |
| A15 | PASS | **PASS** | `prisma validate` exit 0 |
| A16 | PASS | **PASS** | `tsc --noEmit --incremental false` exit 0 |
| A17 | **PASS (wrong)** | **FAIL** | 484 executed: 481 PASS, 2 FAIL, 1 SKIP, **exit code 1** |
| A18 | PASS | **PASS** | Backup diff: 5 Part-1 files, zero `src/` or migration changes |
| A19 | PASS | **PASS** | Independent review §6 |
| A20 | PASS | **PASS** | Findings corrected; unresolved items listed in §6 |

**A17 detail (unchanged by this closeout — the two failures were not repaired):**

1. `outcome is stored` — asserts `dispute.outcome` on the `POST /api/disputes/:id/resolve`
   response; `resolveDispute()` returns `{ id, status }`. The outcome *is* persisted (later detail
   reads of `outcome === "MUTUAL"` pass).
2. `the health probe reports a healthy audit store` — reads the process-global audit-failure
   counter after an earlier path incremented it (`failures: 1`). `STAGE2_TASK7_S12_REPORT.md`
   records the same assertion failing then passing.

Skipped: 1 ("deleted-order regression needs the seeded reseller to own a workspace"). Blocked: 0.

---

## 5. Untracked exclusion inventory — 21 entries

All 21 are present in the verified backup (per-path check). None is deleted.

| # | Path | Size | Class | In backup | Unique legitimate work? |
|---|---|---|---|---|---|
| 1 | `.cloud-attachments/` (1 JSON + dir) | 24 KB | Imported conversation data (potentially sensitive) | yes (2 entries) | No |
| 2 | `.env.example` | 257 B | **Environment template with an unclassified 36-char `SESSION_SECRET`** — treated as a possible secret | yes | Template only; must not be committed until the value is confirmed non-secret |
| 3 | `_correct_phase1.py` | 6.4 KB | Scratch report-rewriting script | yes | No |
| 4 | `_correct_phase3.py` | 9.3 KB | Scratch report-rewriting script | yes | No |
| 5 | `_r8_final_verify.py` | 4.7 KB | Scratch verification script | yes | No |
| 6 | `_r8_finalize_meta.py` | 2.0 KB | Scratch script | yes | No |
| 7 | `_r8_finalize_report.py` | 1.9 KB | Scratch script | yes | No |
| 8 | `_r8_inspect_meta.py` | 851 B | Scratch script | yes | No |
| 9 | `_r8_rebuild_report.py` | 18.6 KB | Scratch script | yes | No |
| 10 | `_r8_rewrite_report.py` | 15.9 KB | Scratch script | yes | No |
| 11 | `_r8_strip_extra_meta.py` | 1.8 KB | Scratch script | yes | No |
| 12 | `_r8_validate_report.py` | 1.2 KB | Scratch script | yes | No |
| 13 | `_r8_verify_cleanup.py` | 378 B | Scratch script | yes | No |
| 14 | `_s09_contract_inspection_out.txt` | 42.5 KB | Captured inspection output | yes | No |
| 15 | `home/` | 61.5 KB | Path artifact (11 entries); contains an **earlier variant** of `scripts/test-s12-isolated.mjs` (1052 lines / 39,743 B vs 1053 / 39,744 B; 5 changed lines — a class declaration moved and one quoting difference) | yes | No — superseded variant, not unique application work; the committed script is the maintained one |
| 16 | `prisma/disposable_scratch/` | 9.0 MB | Experiment DBs + duplicate migration dirs (48 entries) | yes | **No — but see warning below** |
| 17 | `prisma/schema.prisma.tmp` | 127 B | Generated temp (8-line generator block) | yes | No |
| 18 | `scripts/s09-e2e-run.sh.bak` | 30.3 KB | Superseded script backup | yes | No |
| 19 | `scripts/s09-e2e-run.sh.bak-s09-auth` | 30.5 KB | Superseded script backup | yes | No |
| 20 | `scripts/s09-e2e-run.sh.bak2` | 30.3 KB | Superseded script backup | yes | No |
| 21 | `tmp/` | 5.3 KB | Scratch (7 entries: repro script, log snippets) | yes | No |

**Warning — do not delete `prisma/disposable_scratch/` yet.** It holds the **only preserved copy of
the applied migration bytes** (`539bd5b6…`), which is the evidence for §2. It also contains
non-canonical migration directories (`20261106000000_password_reset_token_clean_s09`,
`20261107000000_test_future_migration_usability`) that must never enter `prisma/migrations/`.
Archive it when the owner approves the schema resolution.

---

## 6. Independent review findings

| # | Finding | Severity | Status |
|---|---|---|---|
| C-1 | S-14 marked Accepted on an agent-authored report; the report itself disclaims human review | **High** (register integrity) | **Corrected** — status Verification in progress; moved to pending table |
| C-2 | Part 1 marked A17 PASS although the command exited 1 | **High** (report accuracy) | **Corrected** — FAIL |
| C-3 | Part 1 reported 19 untracked exclusions; the actual number is 21 | Medium | **Corrected** — exact inventory §5 |
| C-4 | Part 1 claimed the applied DDL and current file "agree … on the resulting columns"; they do not agree at all — the applied file lacked the table | **High** (provenance) | **Corrected** — §2, and the S-09 doc rewritten |
| C-5 | `S02_FINAL_DISPOSITION.md` is cited as acceptance evidence but does not exist | Medium | **Documented**, owner decision required |
| C-6 | S-12 acceptance has the same agent-only provenance as S-14 | Medium | **Documented**, owner decision required |
| C-7 | Validator initially rejected its own new status string and double-counted pending rows in the accepted table | Low (tooling) | **Fixed** — status normalised to the vocabulary, section boundary corrected; 9/9 |
| C-8 | First attempt to move the S-14 row duplicated it instead of moving it | Low (tooling) | **Fixed** — verified single row per section |

Nothing above was hidden to obtain a passing result; C-5 and C-6 remain open by design.

---

## 7. Final Git status and backup verification

- Register validator: **9 passed, 0 failed**, exit 0.
- `prisma validate`: exit 0. `tsc --noEmit --incremental false`: exit 0.
- `prisma/dev.db`: unchanged, SHA-256 `8ac491265645625384008039019d693646e28f31e8cdf4ccd8242690262bfb9e`,
  954,368 bytes.
- Backup: `1a17bf333d25b3f79f9216e37ae692be0719771abfee3d970e9e37c8beca1498`, unchanged.
- No migration file, schema, application source, test, or database row was modified by this closeout.

---

## 8. Remaining owner decisions

1. **S-14** — accept or reject its implementation/verification evidence. Until then it stays
   Verification in progress.
2. **S-12** — confirm the agent-authored acceptance stands, or require an owner sign-off.
3. **S-02** — restore `S02_FINAL_DISPOSITION.md` or correct the citation.
4. **A6 / drift** — approve a forward naming-alignment migration, or formally accept the
   documented limitation as-is. No schema change will be made without this.
5. **`.env.example`** — confirm the `SESSION_SECRET` value is a non-secret placeholder so the file
   can be committed; otherwise keep it excluded and add a sanitised template.
6. **A17 failures** — authorize repair of the two test defects (needed before A17 can pass).
7. **`prisma/disposable_scratch/`** — approve archiving it once the drift decision is made.

**Part 1 is not accepted. Awaiting the owner's decision.**
