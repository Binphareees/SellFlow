# A17 & A6 — IMPLEMENTATION CLOSEOUT REPORT

**Date:** 2026-11-18
**Authorization:** owner-authorized execution of A17 test repairs and A6 schema-drift resolution.
**Scope discipline:** no S-09/S-12/S-06/S-13/S-15 implementation, no billing/entitlements/C-03, no UI,
no history rewrite, no `db push`, no deletion of untracked files or `prisma/disposable_scratch/`.

| Workstream | Result |
|---|---|
| **A17** — repair the two failing tests | **PASS** |
| **A6** — resolve schema drift | **PASS** |

Neither result constitutes owner acceptance on its own. Owner acceptance was granted separately on
2026-11-18 — see *Owner acceptance record* below — and does not alter any evidence in this report.

**Revision 2 — 2026-11-18, documentary correction (audit C-1).** Independent audit
`A17_A6_INDEPENDENT_ACCEPTANCE_AUDIT.md` finding **A6-F7** established that §2 of the A6 section below
incorrectly implied Prisma guarantees transactional rollback of all migration DDL. That blanket claim is
**withdrawn** and replaced by §2.1, which records the experimentally established behaviour and the
ordering risk it implies. `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md` §6 carried the same wording and
is corrected identically. C-2 and C-3 are recorded as standing audit notes at the end of this document.
This revision changed **documentation only**: no code, test, migration, schema, database content or Git
history was modified, and no migration was executed.

**Revision 3 — 2026-11-18, owner acceptance recorded.** The owner's formal acceptance decisions of
2026-11-18 are recorded in *Owner acceptance record* below and risk item 5 is corrected accordingly.
Revisions 1 and 2 are preserved unaltered; the historical statement that neither implementation result
constitutes acceptance on its own remains true, and nothing in this revision re-dates or rewrites the
evidence to suggest acceptance existed earlier. This revision changed **documentation only**.

---

# OWNER ACCEPTANCE RECORD

Authoritative record of owner decisions, added after the fact. It does not modify the implementation
evidence above or below, which stands exactly as originally observed.

| Item | Decision | Date | Basis |
|---|---|---|---|
| **A17** — test repairs | **ACCEPTED** | 2026-11-18 | Owner decision, recorded verbatim as "A17 — ACCEPTED." |
| **A6** — schema-drift resolution | **ACCEPTED** | 2026-11-18 | Owner decision, recorded verbatim as "A6 — ACCEPTED." |
| **S-14** | **Not accepted** | — | These decisions do not confer S-14 acceptance; its provenance concern remains open |
| **S-12** | **Not accepted** | — | These decisions do not confer S-12 acceptance; its provenance concern remains open |
| **A6-F9** — pre-DML failure residue | **UNVERIFIED / OPEN RISK** | — | Acceptance of A6 neither resolves nor waives A6-F9 |

Scope limits of these decisions:

- Acceptance covers the **A17** and **A6** workstreams only. It is not a blanket acceptance of the
  closeout report, of other workstreams, or of the open risks listed at the end of this document.
- **S-14/S-12 acceptance provenance remains outstanding.** The owner has not accepted either workstream
  through these decisions, and the evidence for who accepted them and when is still unresolved.
- **A6-F9 remains UNVERIFIED and open.** Acceptance of A6 is an owner decision about the delivered
  result, not a finding that pre-DML failure residue is impossible; §2.1 records the experimentally
  established behaviour and this report continues to carry the risk.
- **S-02's missing `S02_FINAL_DISPOSITION.md`** is not addressed by these decisions and remains
  unresolved unless separately established by existing evidence.

---

# A17 — TEST REPAIRS

## 1. Original failures (baseline 2026-11-17)

| Check | Observed | Why it failed |
|---|---|---|
| `outcome is stored` | `FAIL` | Asserted `resolved.json.dispute.outcome === "RESELLER_FAVOUR"` on the `POST /api/disputes/:id/resolve` response |
| `the health probe reports a healthy audit store (S-12)` | `FAIL — audit {"status":"degraded","failures":1,…}` | Process-global, monotonic failure counter had already been incremented by an earlier check |

Baseline totals: 484 executed, 481 passed, 2 failed, 1 skipped, **exit 1**.

## 2. Root causes

### 2.1 `outcome is stored`

`src/app/api/disputes/[id]/resolve/route.ts` returns `json({ dispute })`, and
`resolveDispute()` (in `src/server/disputes.ts`) returns `{ id: disputeId, status: input.status }`
from inside its transaction. The endpoint therefore returns **only `{ id, status }`** — the outcome is
written to the row and to the `DisputeEvent` trail, but it is not part of the mutation response.

Evidence that persistence was never broken: in the same run, `the audit trail keeps every step`
passed, `the mediator decision is in the trail` passed, and later detail reads of
`dispute.outcome === "MUTUAL"` passed. The assertion simply read a field the contract does not
promise. The suite's established pattern for outcome verification (`firstOutcomeDetail`,
`afterRejected`, `afterFailure`) is a **detail read**; the mutation-response assertion was the
outlier.

### 2.2 Audit-health probe

`auditHealth()` in `src/lib/audit.ts` keeps `failures` in module scope for the lifetime of the
server process and only ever increments (`failures += 1`). Several checks deliberately force a failed
audit write. The probe lived inside the S-14 block, which runs after those suites, so it observed a
counter that unrelated tests had already dirtied. Its own comment claimed it ran "before any S-14
operation", but not before the earlier suites.

## 3. Exact changes

Only `scripts/verify-api.mjs` was modified. No application code, endpoint, validation, schema or
security control was touched.

| Location | Change |
|---|---|
| `main()` start (after the `ONLY_S12` guard) | The S-12 health assertion now runs immediately after startup, with a comment explaining that the counter is monotonic and can only be read deterministically on a fresh server |
| Old S-14 block | Probe removed; comment now points to the new location |
| Dispute resolve block | `outcome is stored` now reads the dispute detail (same pattern as the other outcome assertions) and reports the observed value; a new assertion `the resolve response reports the new status` pins the real `{ id, status }` contract |

Neither change weakens verification: the outcome is still required to be `RESELLER_FAVOUR`, the
health probe still requires `status === "ok"` **and** `failures === 0`, and the response contract is
now asserted explicitly instead of accidentally.

## 4. Before and after

| Run | Executed | Pass | Fail | Skip | Exit |
|---|---|---|---|---|---|
| Before (2026-11-17) | 484 | 481 | 2 | 1 | **1** |
| After — run 1 (2026-11-18, full build) | 516 | **515** | **0** | 1 | **0** |
| After — run 2 (2026-11-18, `--skip-build`) | 516 | **515** | **0** | 1 | **0** |

Run 1 wall time 225.0 s; run 2 wall time 129.7 s; harness line for both:
`[harness] PASSED … (isolated DB, api=0, pwa=0)`.

The count rose by 32 because (a) one assertion was added and (b) the PWA suite now executes: in the
baseline run the harness reported `api exit=1 pwa exit=null`, so the PWA assertions never ran.

## 5. The repaired assertions, both runs

```
run 1  PASS  the health probe reports a healthy audit store (S-12) — audit {"status":"ok","failures":0,"lastFailureAt":null}
run 1  PASS  the resolve response reports the new status — status RESOLVED
run 1  PASS  outcome is stored — outcome RESELLER_FAVOUR
run 2  PASS  the health probe reports a healthy audit store (S-12) — audit {"status":"ok","failures":0,"lastFailureAt":null}
run 2  PASS  outcome is stored — outcome RESELLER_FAVOUR
```

**Individual execution:** `verify-api.mjs` has no per-check selector (its only mode switch is
`ONLY_S12`), and adding one would have changed the suite's semantics, so each affected assertion was
verified by its own named result line in two independent full runs, including one where the health
probe necessarily ran before the failing-audit paths. That is the determinism evidence the repair
targets.

## 6. Regression results

- PWA suite: runs and passes (31 checks) — previously blocked by the API exit.
- Isolation preserved: both runs passed isolation check 1 (canary workspace) and check 2 (`/proc`
  `DATABASE_URL` matches the temp file) and reported
  `project database untouched: sha256=59d9cb2c6bd8`.
- `npx prisma validate` exit 0; `npx tsc --noEmit --incremental false` exit 0.
- Register validator: 9/9, exit 0.
- The one skip is unchanged and pre-existing: "deleted-order regression needs the seeded reseller to
  own a workspace".

---

# A6 — SCHEMA DRIFT RESOLUTION

## 1. Original differences

Existing `prisma/dev.db` (107 objects) vs a fresh migration deployment (106 objects). One table:

| Aspect | Fresh (migrations) | `dev.db` (before) |
|---|---|---|
| Unique | inline `UNIQUE("hashedToken")` → implicit autoindex | named `PasswordResetToken_hashedToken_unique` |
| `id` | `TEXT … DEFAULT "cuid()"` | `TEXT NOT NULL PRIMARY KEY` |
| `used` | `INTEGER NOT NULL DEFAULT 0` | `BOOLEAN NOT NULL DEFAULT false` |
| FK | inline `REFERENCES … ON DELETE CASCADE` | named `…_userId_fkey` + `ON UPDATE CASCADE` |
| Indexes | `…_userId_idx`, `…_expiresAt_idx` | same names |

Cause (established earlier): S-09 DDL was appended to an already-applied migration, and the live
table was shaped by a schema-sync path. `prisma migrate diff` reported
`[*] Redefined table "PasswordResetToken"`.

## 2. Migration strategy

Forward-only, single new migration: rebuild the table into the datamodel shape. SQLite cannot drop an
inline table-level `UNIQUE`, so create-new → copy → drop-old → rename is the only supported route.
The script handles all three starting states:

1. `CREATE TABLE IF NOT EXISTS "PasswordResetToken"` (covers a database that never got the table),
2. rebuild into `new_PasswordResetToken` and copy every row,
3. drop, rename, recreate the named unique index and both non-unique indexes.

`PRAGMA defer_foreign_keys = ON` is used because `PRAGMA foreign_keys` cannot be changed inside a
transaction, so the deferral has to be requested explicitly. No table references `PasswordResetToken`,
so the rebuild cannot violate a parent relationship.

> **Corrected (revision 2, audit C-1).** Revision 1 justified this pragma by saying Prisma "wraps
> migrations in" a transaction. That is the claim being withdrawn: Prisma does **not** guarantee
> transactional rollback of all migration DDL. The next subsection states what was actually observed.

### 2.1 Transaction behaviour of SQLite migrations (corrected)

Prisma's migration runner is **not** a blanket rollback guarantee. Measured on disposable `/tmp`
databases (all seven migrations applied, one token row present, then a deliberately failing migration),
reproduced five times, the deciding factor is **statement ordering**:

| Case | Failing migration body | Result |
|---|---|---|
| A | `DROP TABLE PasswordResetToken; SELECT * FROM nope;` | **table gone, rows lost** |
| E | `PRAGMA defer_foreign_keys=ON; DROP …; SELECT * FROM nope;` | **table gone** |
| F | `CREATE TEMP TABLE t(x); DROP …; SELECT * FROM nope;` | **table gone** |
| D | `INSERT …; DROP …; SELECT * FROM nope;` | rolled back — table present, 1 row |
| tx2 | same as D, different database | rolled back — table present, 1 row |

**Established behaviour:** statements executed *before the first DML statement* of a migration script are
**not** rolled back when a later statement fails; once a DML statement has run, DDL after it *is* rolled
back with the rest of that unit of work. The underlying mechanism is a **hypothesis, not a proven
Prisma guarantee** — do not plan a destructive migration on it.

**Why this migration's ordering matters.** Its first DML is the `INSERT … SELECT` at line 47. The
`DROP TABLE` at line 50, the `ALTER TABLE … RENAME` at line 52 and the three index creations at lines
54–58 all follow that insert, so they sit inside the rolled-back window — the DML-first configuration
that cases D and tx2 showed to be recoverable. Reversing the order (drop first, then copy) would put the
destructive statement in the uncovered prefix and would lose the table on any later failure. The safety
of this migration is therefore an **empirical property of its statement ordering, not a documented
guarantee**, and it is the reason the ordering must not be rearranged in review.

**Residual risk (pre-DML failure).** Everything before the first DML — the `PRAGMA` at line 23 and the
two `CREATE TABLE` statements at lines 26 and 37 — is outside that window. A failure there, or a failure
*of* the `INSERT` itself (for example a legacy row that violates the new foreign key), aborts the script
with the created objects still persisted. A naive retry would then collide with
`new_PasswordResetToken` and require manual cleanup. Whether that residue actually appears was not
isolated by the audit (finding A6-F9, **UNVERIFIED**), so it is carried as an open risk rather than a
known defect. Mitigation for any future destructive migration: verified backup plus a rehearsed failure
path before touching a database that holds real rows — the practice already used here.

## 3. Files created / modified

| File | Change |
|---|---|
| `prisma/migrations/20261118000000_password_reset_token_alignment/migration.sql` | **Created** |
| Historical migrations (6 dirs) | **Untouched** — verified by checksum |
| `prisma/schema.prisma` | **Untouched** |

## 4. Fresh-database validation

`migrate deploy` on an empty database: exit 0, all 7 migrations applied, 107 objects,
integrity `ok`, 0 FK violations, named unique index present.

**Parity:** `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel
prisma/schema.prisma` → exit 0, script content **"No difference detected."**

## 5. Existing-database validation

Recovery copy first, then the real file.

| State | Result |
|---|---|
| Copy of `dev.db` (`/tmp/a6-test/devcopy.db`) | deploy exit 0; 125/125 tokens; 228 users; integrity `ok`; 0 FK violations; canonical DDL |
| Legacy simulation (table dropped, re-deployed) | deploy exit 0; table recreated; integrity `ok`; 0 FK violations; named index present |
| Real `prisma/dev.db` | deploy exit 0; **125/125 tokens**, all 125 join to a live `User`; 228 users; 114 sessions; integrity `ok`; 0 FK violations; 107 objects; `migrate status` exit 0 |

## 6. Data-preservation evidence

- Recovery copy: `/home/binpharees/Documents/sellflow-baseline-backups/a6-20261118/dev.db.before`,
  SHA-256 `8ac491265645625384008039019d693646e28f31e8cdf4ccd8242690262bfb9e`, 954,368 bytes,
  integrity `ok`, 125 tokens / 228 users. Retained, not deleted.
- After: `prisma/dev.db` SHA-256 `59d9cb2c6bd8ee65c87479c486c2779fb4d5263a371673c7bf1dd5fd3885592c`,
  983,040 bytes. Same 125/228 counts, 125 distinct ids, 125 valid user joins, 0 FK violations.
- The file grew because the rebuild materialises the canonical table plus a named index.

## 7. Checksum and history verification

| Migration | Recorded vs file |
|---|---|
| init, dispute_claim_link, subscriptions, login_throttle, stock_integrity | **MATCH** |
| `20261105060000_session_lifecycle` | **DIFF** — historical, preserved deliberately (documented in `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md`) |
| `20261105060000_session_lifecycle_clean_s14` | **DIFF** — rolled-back duplicate with no directory; 0 steps |
| `20261118000000_password_reset_token_alignment` | **MATCH** |

No historical checksum was edited. No migration was deleted or reordered. `migrate status` exit 0.

> **Standing audit note C-2.** `prisma migrate status` reports "Database schema is up to date!" and does
> **not** surface the historical checksum mismatch on `20261105060000_session_lifecycle`. The anomaly is
> therefore silent in normal operation and appears only in a checksum audit or on `migrate dev`. This is
> pre-existing and deliberate (see `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md`), not introduced by
> `decfa68`, but it must not be treated as evidence that no mismatch exists.

## 8. Prisma validation

`npx prisma validate` → "The schema at prisma/schema.prisma is valid", exit 0.

## 9. SQLite limitations encountered

- Inline table-level `UNIQUE` cannot be dropped by `ALTER TABLE`; a rebuild is mandatory.
- `PRAGMA foreign_keys` is a no-op inside a transaction (documented SQLite behaviour);
  `defer_foreign_keys` is the usable form. Note that this pragma is the script's first statement and is
  therefore itself outside the transactional window described in §2.1; whether the deferral is still in
  force for the transactional part of the script was not measured. It does not affect the outcome here,
  because no table references `PasswordResetToken`.
- DDL whitespace does not affect Prisma's comparison; object names and shapes do — which is exactly
  why the constraint naming had to be normalised rather than merely re-formatted.

---

# FINAL INTEGRITY

## Git

| | |
|---|---|
| Tracked tree | clean after commit |
| Untracked files | 21 (unchanged; none deleted, none archived) |
| `prisma/disposable_scratch/` | untouched |

Commits are listed in the accompanying message.

## Database

- `prisma/dev.db`: integrity `ok`, 0 FK violations, `migrate status` exit 0, 107 objects.
- Fingerprint change `8ac49126…` → `59d9cb2c…` is the authorized effect of the new migration and is
  fully documented here.

## Independent review findings

| # | Finding | Severity | Action |
|---|---|---|---|
| R-1 | Moving the health probe could have masked a genuine S-12 regression | Medium | Rejected by design: the probe still requires `ok` **and** `failures === 0`, and the later "failed audit write is reported" assertion still proves `degraded` reporting; both pass |
| R-2 | Reading `outcome` from a detail endpoint could hide a response regression | Medium | Mitigated by adding an explicit assertion for the real `{ id, status }` response contract |
| R-3 | The rebuild touches live data on `dev.db` | High | Recovery copy taken and verified before the operation; three starting states rehearsed on copies; counts, id uniqueness and FK joins verified after |
| R-4 | New migration could re-introduce drift instead of removing it | Medium | Parity diff now returns "No difference detected." |

## Outstanding risks and limitations

1. `prisma/dev.db` fingerprint changed by design; it is a development database, not committed.
2. The historical checksum mismatch on `20261105060000_session_lifecycle` remains (by instruction) and
   will keep showing as DIFF in any checksum audit. It is documented, not hidden.
3. The migration rebuilds the table rather than performing an in-place rename, so a future migration
   must not reintroduce an inline `UNIQUE`.
4. `A17` counts are higher than the historical 500 / 484 figures because the PWA suite now runs and an
   assertion was added; the numbers are not comparable across eras without that context.
5. **Owner acceptance (updated 2026-11-18):** A17 and A6 were formally **accepted by the owner on
   2026-11-18** — see *Owner acceptance record*. Acceptance does **not** extend to S-14 or S-12, whose
   provenance/acceptance concerns remain outstanding, and it does **not** resolve or waive A6-F9 (item 6).
6. Transactional safety is a property of statement ordering, not a Prisma guarantee (§2.1); a pre-DML
   failure can leave created objects behind (audit A6-F9, UNVERIFIED).
7. `prisma migrate status` does not detect the historical checksum mismatch (standing note C-2).

---

# STANDING AUDIT NOTES

Recorded on owner instruction together with the C-1 correction. Neither note is a defect in the shipped
work; both are permanent caveats on how the evidence may be read.

## C-2 — `migrate status` is silent about the historical checksum mismatch

`prisma migrate status` prints "Database schema is up to date!" on `prisma/dev.db` even though the row for
`20261105060000_session_lifecycle` records `539bd5b6…` while the file hashes to `33b41fc7…`. Status checks
schema shape and row presence, not recorded checksum equality. Consequence: the mismatch will never appear
in routine operation and cannot be ruled out by `migrate status` alone; only a checksum comparison over
`_prisma_migrations` against the file tree detects it. Retained deliberately — see
`docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md` §2.

## C-3 — "run both affected tests individually" was not satisfied literally

`scripts/verify-api.mjs` exposes only one selector (`ONLY_S12`); there is no per-check filter, and none was
added, because adding one would have changed the suite's mode semantics mid-repair. The two repaired
assertions were therefore evidenced by their own named result lines in two independent full runs, not by
isolated execution. This is a **process deviation, not a verification gap**: both assertions are named,
individually observed, and reproduced, and neither depends on state the other creates.

## Correction status

| Item | Status |
|---|---|
| C-1 — withdraw the transaction claim, document DDL-before-DML behaviour and DML-before-DROP ordering | **Applied** in this revision (§2, §2.1, §9; mirrored in `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md` §6) |
| C-2 — standing note on `migrate status` silence | **Applied** (§7 and above) |
| C-3 — standing note on non-literal individual execution | **Applied** (above) |
| Applied migration `20261118000000_password_reset_token_alignment` | **Unchanged** — byte-identical, not re-run |
| Historical migrations | **Unchanged** — no file, checksum or ordering touched |
| `prisma/dev.db` contents | **Unchanged** — no migration or experiment executed against it |
