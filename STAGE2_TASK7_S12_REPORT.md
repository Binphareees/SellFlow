# SellFlow — Stage 2, Task 7: S-12 (Audit Trail Empty, Writes Best-Effort) Report

**Date:** 2026-11-04
**Scope:** S-12 only. No other finding was started. No schema, migration, dependency, billing, entitlement or C-03 change. No password-reset, email-verification or session work. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

---

## 1. The finding and what was actually wrong

The audit finding reads: *"The inspected database contains 0 `AuditLog` rows despite seeded marketplace and dispute activity. `audit()` swallows all write failures after logging."*

Inspection split that into four distinct defects:

| # | Defect | File | Consequence |
|---|---|---|---|
| 1 | The demo dataset never writes an audit row | `prisma/seed.ts` | A freshly seeded database has an empty `AuditLog` even though seeded activity exists, so a working trail looks broken to every reviewer |
| 2 | `audit()` catches and logs, then drops the failure | `src/lib/audit.ts` | Audit loss is invisible: no metric, no counter, no health signal, and the request still reports success |
| 3 | Security-critical events are audited *after* their transaction commits | `src/server/accounts.ts` (`registerAccount`, `setVerificationTier`) | An account or tier elevation can exist permanently with no trail; the failure is silently swallowed by defect 2 |
| 4 | No way for a monitor to see audit health | `src/app/api/health/route.ts` | Operational alerting has nothing to alert on |

Root cause: auditing was written as a fire-and-forget convenience. `audit()` had no retry, no failure state, and no caller could learn that a write failed. Because the trail was also empty in the dataset under audit, there was no evidence to distinguish "auditing works" from "auditing is silently broken".

---

## 2. Tests first (8 assertions)

Added to `scripts/verify-api.mjs` immediately before the S-15 block, reusing the isolated-database Prisma client the S-05 block already opens (skips with a message if `DATABASE_URL` is not an isolated harness database).

| # | Assertion | What it proves |
|---|---|---|
| 1 | The demo dataset ships a representative audit trail (`seed-audit-*` rows ≥ 4) | The empty-database half of the finding |
| 2 | The health probe reports a healthy audit store (`status: "ok"`, `failures: 0`) | A monitoring surface exists |
| 3 | Registration commits its audit row with the account | Trail is written for a new security event |
| 4 | The trail grows with the action it describes (count increases) | Writes are not no-ops |
| 5 | A non-critical audit failure does not break the action | Availability requirement is preserved |
| 6 | A failed audit write is reported instead of silently dropped (`status: "degraded"`, `failures ≥ 1`, `lastFailureAt` set) | The silent-swallow defect |
| 7 | A security-critical action fails closed when it cannot be audited (HTTP 5xx **and** no account row) | Atomicity of the critical path |
| 8 | The trail resumes once the audit store recovers | Failure does not poison the process permanently |

**Fault injection.** SQLite cannot be made to fail on demand through Prisma, so the block installs a trigger that aborts every insert while leaving the table intact:

```sql
CREATE TRIGGER audit_write_fail BEFORE INSERT ON "AuditLog"
BEGIN SELECT RAISE(ABORT, 'audit store unavailable'); END
```

The trigger is dropped in a `finally` block, and the last assertion proves the recovery path. This is exactly the failure shape of a full disk, a read-only replica or a corrupt index — without mutating or dropping any table.

**Recorded failures before the fix** (`npm run test:e2e:clean -- --skip-build`, unmodified application):

```
harness_exit=1
pass=427 fail=4

FAIL  the demo dataset ships a representative audit trail (S-12) — 0 seeded events
FAIL  the health probe reports a healthy audit store (S-12) — audit undefined
FAIL  a failed audit write is reported instead of silently dropped (S-12) — audit undefined
FAIL  a security-critical action fails closed when it cannot be audited (S-12) — status 201, account created
```

The last line is the finding in one sentence: with every audit insert failing, registration returned **201** and the account existed. Four of the eight checks passed first time (trail grows, non-critical action survives, trail resumes) and act as guard rails against an over-correction.

---

## 3. Implementation

### 3.1 `src/lib/audit.ts` — retry, failure state, and a critical variant

- **Retry.** A non-critical write is attempted three times with short backoff (`20 ms`, `60 ms`). SQLite's transient `SQLITE_BUSY`/lock errors are the realistic failure in this deployment; a permanent failure still ends in the recorded-failure path.
- **Failure state.** A module-level counter plus `lastFailureAt`, exposed by `auditHealth()` → `{ status: "ok" | "degraded", failures, lastFailureAt }`. Nothing about the actor or payload is exposed.
- **Structured logging.** The existing `console.error("[audit] failed to write", action, error)` is kept (action name, no PII) and is now paired with the counter, so a log line is evidence rather than the only record.
- **`auditCritical(input, { client? })`.** A security-critical event. With a transaction client it performs a single insert and **throws `AuditWriteError`** on failure, which aborts the transaction; standalone it also throws after recording. It never returns success when the row was not written.
- **`audit()` keeps its contract.** It still never throws for non-critical events, because an audit failure must not take down an unrelated request. It now returns `boolean` and records the loss. Passing `client` to `audit()` is supported but documented as single-attempt: a failed statement inside an interactive transaction poisons it, so best-effort auditing must not be used inside one.

### 3.2 `src/server/accounts.ts` — two critical paths now commit atomically

- **`registerAccount`.** The `auth.register` row is written with `auditCritical(…, { client: tx })` inside the existing account/workspace transaction, using the ids created in that same transaction. An account cannot exist without its trail: if the insert fails, the whole transaction rolls back and the route returns 500.
- **`setVerificationTier`.** The `profile.tier_changed` row likewise moves inside the existing profile-update transaction. A tier elevation without a provable audit row is now impossible.

These are the two paths that create or elevate a principal, which is why they were chosen. The remaining ~38 call sites keep the non-critical contract (now retried and observable) — see limitations.

### 3.3 `src/app/api/health/route.ts` — audit health is published

The probe now returns an `audit` block and folds audit state into the overall status:

```
audit: { status: "ok" | "degraded", failures: number, lastFailureAt: string | null }
status: "ok" only when the database is up AND no audit write has failed
```

HTTP remains `200` while the database is up and `503` when it is down, so an uptime monitor does not flap on a single audit failure, but a monitor that reads the body (or alerts on `status !== "ok"`) sees the degradation. Nothing sensitive is exposed: counts and a timestamp only.

### 3.4 `prisma/seed.ts` — a representative demo trail

Four rows are upserted by fixed id (`seed-audit-*`) before the closing log, referencing the seeded entities that actually exist:

| id | action | entity |
|---|---|---|
| `seed-audit-login-reseller` | `auth.login` | reseller user |
| `seed-audit-login-supplier` | `auth.login` | supplier user |
| `seed-audit-role-supplier` | `profile.role_granted` | supplier profile |
| `seed-audit-order-reseller` | `supplier_order.created` | the seeded supplier order (or `seed-demo-order` when the dispute fixture already existed) |

They are marked `{ seeded: true }` in `metadataJson`, so demo rows are distinguishable from real ones. Upsert-with-empty-update keeps the trail append-only: re-seeding fills gaps and never rewrites or deletes an entry. The demo seed remains behind the S-15 guard, so this data can only be created in a development/test database with an explicit opt-in.

---

## 4. Verification

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | inside `test:e2e:clean` | **exit 0** |
| API suite | `scripts/verify-api.mjs` | **431 / 431** |
| PWA suite | `scripts/verify-pwa.mjs` | **31 / 31** |
| Combined | `npm run test:e2e:clean` | **PASSED**, 235.7 s, exit 0 |
| Isolation | canary workspace + `/proc` `DATABASE_URL` | both passed |
| Prior findings | S-01…S-11, S-13, S-15 assertions | all pass |
| Shared database | `md5sum prisma/dev.db` | `2ee44e7855bc5442c6e9c0d535eb8f0d`, 589824 bytes, mtime `1793746202` — unchanged |

```
pass=462 fail=0
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] PASSED in 235.7s (isolated DB, api=0, pwa=0)
harness_exit=0
```

462 = 431 API checks (the same 431 the pre-fix run executed, where 427 passed and 4 failed) plus 31 PWA checks. All four previously failing assertions now pass; the PWA stage did not run before the fix because the API failures abort it.

S-12 assertions after the fix:

```
PASS  the demo dataset ships a representative audit trail (S-12) — 4 seeded events
PASS  the health probe reports a healthy audit store (S-12) — audit {"status":"ok","failures":0,"lastFailureAt":null}
PASS  registration commits its audit row with the account (S-12) — status 201, row present
PASS  the trail grows with the action it describes (S-12) — 222 → 224
PASS  a non-critical audit failure does not break the action (S-12) — status 200
PASS  a failed audit write is reported instead of silently dropped (S-12) — audit {"status":"degraded","failures":1,"lastFailureAt":"2026-11-04T22:26:17.688Z"}
PASS  a security-critical action fails closed when it cannot be audited (S-12) — status 500, account absent
PASS  the trail resumes once the audit store recovers (S-12) — status 201, row present
```

`npm run db:reset` was not run. The shared database was never opened by the tests: the harness copies migrations into a temp file, proves the app is reading that file twice, and deletes it afterwards.

**Processes.** The harness stops only its own process group. Observed afterwards: `:3000` (pid 2802) and `:4322` (pid 927563) still listening and untouched. The stale preview server on `:4318` (pid 1057494) is no longer running; it was not signalled by this task's commands, and I did not restart it.

---

## 5. Remaining limitations

1. **Non-critical audits are still best-effort.** Login, logout, orders, payments, disputes, price access and subscription events use `audit()`, which survives a broken audit store by design. They are now retried and counted, not silently dropped, but a lost row does not fail the request. Only registration and verification elevation are fully transactional; making all ~38 call sites critical would mean wrapping each mutation in a transaction, which is a larger change than S-12 requires.
2. **The failure counter is per-process and in memory.** It resets on restart and on a new deploy, and it is not persisted or scraped. A monitor must read `/api/health`; no alert rule or dashboard is configured by this task.
3. **The trail is append-only by convention, not enforcement.** Nothing prevents `UPDATE`/`DELETE` on `AuditLog`; there are no database permissions, triggers or hash chaining. That would need a schema/DB change and was deliberately out of scope.
4. **Retries can duplicate nothing but can still lose ordering.** A retried insert either succeeds once or fails; but concurrent writes may interleave timestamps, so ordering across actors is by `createdAt`, not guaranteed causal.
5. **Fault injection is SQLite-specific.** The trigger test proves behaviour on this project's database engine. A future Postgres/MySQL target needs its own fault-injection test.
6. **`/api/health` status semantics changed.** `status` can now be `degraded` while the HTTP code is 200 and the database is up. Any external monitor that only reads the status code will not notice an audit outage; it must read the body's `status`/`audit` fields.
7. **Seeded audit rows are synthetic.** They reference real seeded entities and are marked `{ seeded: true }`, but they are demo data, not a record of real actions.
8. **Phase 0 remains incomplete.** S-09 and S-14 remain open, and S-01…S-13/S-15 being green does not mean the product is pilot-safe.

---

## 6. Changed files

| File | Change |
|---|---|
| `src/lib/audit.ts` | Added bounded retry, failure counter + `auditHealth()`, `AuditWriteError`, and `auditCritical()`; documented the transaction contract; `AUDIT` table unchanged. |
| `src/server/accounts.ts` | `auth.register` and `profile.tier_changed` now written with `auditCritical(…, { client: tx })` inside their existing transactions; post-commit `audit()` calls removed. |
| `src/app/api/health/route.ts` | Publishes `audit: { status, failures, lastFailureAt }`; overall `status` degrades when audit writes have failed. |
| `prisma/seed.ts` | Upserts four idempotent, clearly-marked demo audit rows before the closing log. |
| `scripts/verify-api.mjs` | 8 S-12 assertions with reversible SQLite trigger fault injection. |
| `STAGE2_TASK7_S12_REPORT.md` | This report. |

Not changed: `prisma/schema.prisma`, migrations, dependencies, billing/entitlements/C-03, auth routes/session lifetime, deployment scripts, `prisma/dev.db`.

**S-12 complete. Stopping here; no other finding was started.**
