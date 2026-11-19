# A17 & A6 — INDEPENDENT ACCEPTANCE AUDIT

**Target commit:** `decfa68f79e847c89269f9f0fd2fd66cab8cfbba` ("fix: repair A17 test defects and resolve A6 schema drift")
**Audit date:** 2026-11-18
**Mode:** read-only. No repository file, database, migration, test or Git history was modified.
**Only artifact produced:** this document (new, untracked, uncommitted).
**Method:** every conclusion below comes from independently inspected artifacts — commit contents, source at
`decfa68`, migration SQL, live database read-only queries, retained harness logs, and fresh experiments
confined to `/tmp`.

---

## Summary verdicts

| Workstream | Verdict |
|---|---|
| **A17** — test repairs | **ACCEPT** |
| **A6** — schema-drift resolution | **ACCEPT**, with one mandatory documentation correction and one recommended hardening |

No evidence of fabrication was found: the reported counts, exit codes, PWA execution, data preservation,
parity result and checksum posture all match independently inspected evidence. One claim in the
implementation report is materially inaccurate (transactional execution) and is recorded as a FAIL below.

---

# A17 — TEST REPAIRS

### A17-F1 — Diff scope and contents
**PASS** · Severity: n/a

`git diff decfa68~1 decfa68 -- scripts/verify-api.mjs` contains **three hunks only**: the health probe
inserted at `main()` start, the resolve-block rewrite, and removal of the old probe comment block plus
probe. Net `+39 / −15`. No other test file changed. No assertion was deleted without replacement.

### A17-F2 — Corrected resolve-response contract
**PASS** · Severity: n/a

- `src/app/api/disputes/[id]/resolve/route.ts:14` — `return json({ dispute });`
- `src/server/disputes.ts:565` — `return { id: disputeId, status: input.status };`

The endpoint therefore returns only `{ id, status }`. The new assertion
`the resolve response reports the new status` (`scripts/verify-api.mjs`, hunk at `@@ -3869`) asserts
`resolved.json?.dispute?.status === "RESOLVED"`, which matches the real contract. The previous assertion
demanded `outcome`, which the response never carried — the original failure was a test/contract mismatch,
not a persistence defect.

### A17-F3 — Persistence independently established
**PASS** · Severity: n/a

The rewritten check now reads the dispute detail (`GET /api/disputes/:id`) and requires
`outcome === "RESELLER_FAVOUR"`. This is the same verification pattern the suite already used for
`MUTUAL` outcomes later in the file, so it is not a bespoke workaround. Runtime proof:
`PASS outcome is stored — outcome RESELLER_FAVOUR` in both retained runs.

### A17-F4 — Probe relocation justified and not masking failures
**PASS** · Severity: n/a

- `src/lib/audit.ts:32` — `let failures = 0;` module scope; `noteFailure()` does `failures += 1` (line ~57)
  and never decrements; `resetAuditHealth()` only resets the local module instance, not the server process.
  The counter is therefore monotonic per server process — relocating the probe to a fresh process is the
  only deterministic fix that does not add a production reset endpoint.
- Ordering proof from raw log: probe at line **178**, first deliberate audit-failure assertion at line **610**.
- Not masking: `PASS a failed audit write is reported instead of silently dropped (S-12) — audit
  {"status":"degraded","failures":3,…}` still runs (line 610), followed by the fail-closed and recovery
  assertions at lines 611–612. The degraded path remains covered.
- `git show decfa68:scripts/verify-api.mjs | grep healthBefore` → no matches: the old in-S14 probe is gone,
  so there is no duplicate or silently retained weaker copy.

**Implication:** the assertion now proves "a freshly started server reports a healthy audit store", which is
the intended S-12 monitoring surface. It no longer proves anything about post-failure state — but that was
never its job, and the post-failure state is asserted separately.

### A17-F5 — PWA suite ran in both executions
**PASS** · Severity: n/a

| Evidence | Run 1 | Run 2 |
|---|---|---|
| `PWA CHECKS PASSED` line | 700 | 579 |
| Harness summary | `PASSED in 225.0s (isolated DB, api=0, pwa=0)` (line 706) | `PASSED in 129.7s (isolated DB, api=0, pwa=0)` (line 585) |
| PWA-specific PASS lines (layout/manifest/offline/apple-touch) | 34 | present |

`scripts/pwa-checks.mjs` contains **31** `check(` call-sites, which accounts for the jump from 484 to ~516
total results once the one added API assertion is included. This confirms the implementer's explanation of
the count increase rather than an unexplained inflation.

### A17-F6 — Reported counts and exit codes
**PASS** · Severity: n/a · Method: raw log inspection (no re-run, per read-only mode)

| Log | PASS | FAIL | SKIP | Result lines |
|---|---|---|---|---|
| `/tmp/a17-run1.log` | 515 | 0 | 1 | 516 |
| `/tmp/a17-run2.log` | 515 | 0 | 1 | 516 |

Both logs end with `[harness] PASSED`, which the harness emits only on exit 0, and both show `api=0 pwa=0`.
The single skip is the pre-existing precondition skip ("deleted-order regression needs the seeded reseller
to own a workspace"). Reported figures match exactly.

*Minor imprecision:* the report says "516 executed, 515 PASS"; strictly there are 516 results, of which 515
executed assertions passed and 1 was skipped. Not material.

### A17-F7 — "Run both affected tests individually"
**UNVERIFIED** · Severity: Low

The suite exposes only one selector (`ONLY_S12`, `scripts/verify-api.mjs:278`); there is no per-check
filter, and the implementer did not add one. Individual execution as literally requested therefore did not
happen. Equivalent evidence exists — each repaired assertion has its own named result line in two
independent full runs — but this is not the same as isolated execution. No corrective action required for
correctness; note it as a process deviation.

### A17-F8 — No weakening of assertions
**PASS** · Severity: n/a

`outcome is stored` still requires strict equality with `"RESELLER_FAVOUR"`; the health probe still requires
both `status === "ok"` and `failures === 0`; and coverage was added (explicit response-contract check), not
removed.

---

# A6 — SCHEMA DRIFT RESOLUTION

### A6-F1 — Migration SQL inspected
**PASS** · Severity: n/a

`prisma/migrations/20261118000000_password_reset_token_alignment/migration.sql`, 58 lines:
`PRAGMA defer_foreign_keys = ON` (23) → `CREATE TABLE IF NOT EXISTS` canonical shape (26–34) → create
`new_PasswordResetToken` (37–45) → `INSERT … SELECT` all six columns (47–48) → `DROP TABLE` (50) →
`ALTER TABLE … RENAME` (52) → named unique index (54) → two non-unique indexes (56, 58). Forward-only; no
historical migration touched.

### A6-F2 — Three starting states
**PASS** · Severity: n/a

- **Fresh:** full `migrate deploy` → exit 0, 107 objects, canonical DDL, integrity `ok`, 0 FK violations.
- **Existing (`dev.db`):** applied successfully (exit 0), 107 objects, canonical DDL.
- **Missing table:** reproduced by building a database from the six historical migrations, dropping
  `PasswordResetToken`, and re-deploying → exit 0, table recreated, named index present, integrity `ok`,
  0 FK violations.

### A6-F3 — Record preservation
**PASS** · Severity: n/a

Row-level comparison of `prisma/dev.db` against the verified recovery copy
(`/home/binpharees/Documents/sellflow-baseline-backups/a6-20261118/dev.db.before`):

| Property | Before | After | Same |
|---|---|---|---|
| Row count | 125 | 125 | yes |
| ID set (ordered) | 125 | 125 | yes |
| Full-row digest (id, userId, hashedToken, used, expiresAt, createdAt) | `03be4277038ea5cd6a9ee3c14715477e` | `03be4277038ea5cd6a9ee3c14715477e` | **yes** |
| Distinct `used` values | `0`,`1` | `0`,`1` | yes |
| Objects | 107 | 107 | yes |

This is stronger than a count check: every column of every row is byte-identical after the rebuild.

### A6-F4 — Foreign keys and integrity
**PASS** · Severity: n/a

`PRAGMA integrity_check` → `ok`; `PRAGMA foreign_key_check` → 0 rows; all 125 tokens join to a live `User`
(inspected separately). Before/after identical.

### A6-F5 — Prisma schema parity
**PASS** · Severity: n/a

`prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma`
(shadow database in `/tmp` only) → **"No difference detected."** The drift that motivated A6 is gone.

### A6-F6 — Checksums and provenance
**PASS** · Severity: n/a

| Migration | Recorded vs file |
|---|---|
| init, dispute_claim_link, subscriptions, login_throttle, stock_integrity | MATCH |
| `20261105060000_session_lifecycle` | **DIFF** — the historical anomaly, deliberately preserved |
| `20261105060000_session_lifecycle_clean_s14` | DIFF — rolled-back duplicate, no directory, 0 steps |
| `20261118000000_password_reset_token_alignment` | MATCH |

Historical migration files are byte-identical to the pre-Part-1 backup (`diff` against `/tmp/sf-bk` →
UNCHANGED for all six). `prisma/disposable_scratch/clean_workspace/…/session_lifecycle_clean_s14/migration.sql`
still hashes to `539bd5b6…`, i.e. the applied-bytes evidence was preserved, not rewritten.

### A6-F7 — Transaction safety and rollback behavior
**FAIL** · Severity: **Medium**

The implementation report states: *"Prisma wraps migrations in one [transaction], so the migration uses
`PRAGMA defer_foreign_keys = ON`."* Direct experiment contradicts that as a general claim.

Method: disposable projects in `/tmp` with the seven migrations applied, a token row inserted, then one
extra migration that performs a destructive statement followed by a deliberate error. Results, all reproduced:

| Case | Failing migration body | Outcome |
|---|---|---|
| A | `DROP TABLE PasswordResetToken; SELECT * FROM nope;` | **table gone**, rows lost |
| E | `PRAGMA defer_foreign_keys=ON; DROP …; SELECT * FROM nope;` | **table gone** |
| F | `CREATE TEMP TABLE t(x); DROP …; SELECT * FROM nope;` | **table gone** |
| D | `INSERT …; DROP …; SELECT * FROM nope;` | rollback worked; table present, 1 row |
| tx2 | same as D on a different DB | rollback worked; table present, 1 row |

**Consistent explanation (hypothesis, not proven):** statements appearing before the first DML statement are
executed outside the migration transaction; once a DML statement begins the transaction, subsequent DDL is
covered by it. Cases A/E/F lead with DDL/PRAGMA and lose their executed `DROP`; cases D/tx2 lead with an
`INSERT` and are fully rolled back.

**Why this matters for the actual migration:** its first DML is the `INSERT … SELECT` at line 47, so the
`DROP` at line 50 falls inside the transactional window and would be rolled back on a later failure — the
observed `INSERT`-first behaviour. But that safety is an **empirical property of statement ordering, not a
documented guarantee**, and it was neither tested nor stated by the implementer. Failure modes before the
`INSERT` (for example an FK violation on a legacy database) would persist the two `CREATE TABLE` statements
outside the transaction and leave the database dirty, blocking a plain retry.

**Required corrective action:** correct the transaction claim in `A17_A6_IMPLEMENTATION_CLOSEOUT_REPORT.md`
and record the failure-mode risk. **Do not edit the applied migration** (history rule). No data was lost in
this implementation: the migration succeeded on every state tested, and `dev.db` rows are byte-identical.

### A6-F8 — Repeatability / idempotency
**PASS** · Severity: n/a

Executing the migration SQL twice directly against a copy of the pre-migration database succeeded both times
(125 rows each, integrity `ok`, 0 FK violations). The `CREATE TABLE IF NOT EXISTS` guard plus rename-based
rebuild makes the script re-runnable. Note: a *failed* Prisma migration still blocks redeployment until
resolved (P3009), which is Prisma's documented behaviour, not a defect in this script.

### A6-F9 — Partial-failure residue
**UNVERIFIED** · Severity: Low

Whether a failed run can leave `new_PasswordResetToken` behind (which would break a naive retry) was not
isolated: in the DML-first experiments the scratch table was rolled back; in the DDL-first experiments it was
also absent. Not enough evidence either way — marked UNVERIFIED rather than assumed.

---

# REPOSITORY INTEGRITY

| # | Check | Result | Evidence |
|---|---|---|---|
| R1 | Commit exists and matches | **PASS** | `decfa68f79e847c89269f9f0fd2fd66cab8cfbba` |
| R2 | Changed-file inventory | **PASS** | 6 files: `A17_A6_IMPLEMENTATION_CLOSEOUT_REPORT.md` (A), `README.md` (M), `STATE.md` (M), `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md` (M), new migration (A), `scripts/verify-api.mjs` (M) |
| R3 | No unrelated security/billing changes | **PASS** | Filter for `^src/`, `schema.prisma`, billing/subscription/plans → **none**; A17/A6 touched no application code |
| R4 | 21 untracked exclusions untouched | **PASS** | Count 21; byte sizes identical to the previously recorded inventory (verified per path) |
| R5 | `prisma/disposable_scratch/` preserved | **PASS** | 8,996,059 bytes; the `539bd5b6…` applied-bytes copy still present |
| R6 | Historical S-14 checksum not rewritten | **PASS** | Recorded row still `539bd5b6…`; file still `33b41fc7…`; both unchanged |
| R7 | Audit did not alter the repo/DB | **PASS** | Tracked tree clean; `prisma/dev.db` still `59d9cb2c6bd8…` |

**Observation (Low severity, informational):** `prisma migrate status` reports "Database schema is up to
date!" without surfacing the modified-migration checksum mismatch. The anomaly is therefore silent in normal
operation and will only appear if someone audits checksums or runs `migrate dev`. This is the pre-documented
historical exception, not a regression introduced by `decfa68`.

---

# REQUIRED CORRECTIVE ACTIONS

| # | Action | Severity | Blocking? |
|---|---|---|---|
| C-1 | Correct the "Prisma wraps migrations in a transaction" claim in the closeout report; document the DDL-before-DML rollback finding and the pre-DML failure mode | Medium | No — documentation only; must be done before the report is treated as a reference |
| C-2 | Record the `migrate status` silence about the historical checksum mismatch as a standing audit note | Low | No |
| C-3 | Note that "run both tests individually" was not satisfied literally (no per-check selector exists) | Low | No |

**Recommended (not required):** before applying any future destructive migration to another database, take a
verified backup and rehearse the failure path, because rollback is not guaranteed for statements preceding the
first DML.

---

# OWNER RECOMMENDATIONS

## A17 — **ACCEPT**
The two failures are genuinely repaired, not suppressed: the resolve assertion now tests the real
`{ id, status }` contract and verifies persistence through the detail endpoint; the audit-health probe moved
to a deterministic point without losing degraded-path coverage; both runs show 515 PASS / 0 FAIL / 1 SKIP with
the harness reporting success, and the PWA suite demonstrably executed in both. Only deviation is the
non-literal "individual" execution (C-3).

## A6 — **ACCEPT** (conditional on C-1)
The drift is resolved: parity reports "No difference detected.", fresh/existing/missing states all deploy
cleanly, and every one of the 125 token rows is byte-identical before and after with intact keys and FK
integrity. No historical migration, checksum or evidence copy was altered. The condition is documentary: the
report overstates transactional safety (A6-F7), and that overstatement must be corrected so the next
destructive migration is not planned on a false guarantee.
