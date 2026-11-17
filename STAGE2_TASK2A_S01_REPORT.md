# SellFlow — Stage 2, Task 2A: S-01 (Dispute Scope Authorization) Report

**Date:** 2026-11-04
**Authorization:** Implementation GO, D-019 (2026-11-04). Phase 0 validation remains incomplete; this report makes no claim that SellFlow is pilot-safe.
**Scope:** S-01 only. No other security finding, schema, migration, seed, dependency, billing or entitlement behaviour was touched.

---

## 1. Root cause and affected files

**Affected code**

| File | Symbol | Role in the defect |
|---|---|---|
| `src/server/disputes.ts` | `listDisputes(viewer, options)` | Derived `scope` from the moderator flag **only as a default**: `const scope = options.scope ?? (moderator ? "all" : "mine")`. An explicit `scope: "all"` from any caller therefore selected the unfiltered query (`where = {}`). |
| `src/app/api/disputes/route.ts` | `GET` | Forwarded the raw `?scope=all` query value into the service after `requireAuth()` only; no role or mediator check. |
| `src/lib/auth/rbac.ts` | `isMediator(viewer)` | The correct predicate already existed (platform admin **or** `MEDIATOR` role) and was used for the default, but never enforced for an explicit request. |

**Root cause.** The service treated a **client-supplied scope** as a preference rather than a privilege. Authorization was implicit in the default value, so the only protection was that the UI never sends `scope=all`. Any authenticated account — including a brand-new registration with no marketplace role — could request the global collection:

```
GET /api/disputes?scope=all      →  200 { disputes: [ every dispute on the platform ] }
```

Confirmed in Stage 1 and again here before the fix (evidence in §3).

**Not affected / verified while inspecting**

- `disputeCounts()` already scopes non-moderators (`where = moderator ? {} : VISIBLE_TO_PARTY(...)`), so aggregate counts were not leaking.
- `getDispute()` and `partyContext()` already rejected non-parties (403) — direct access by id was safe.
- No other route or page passes `scope` (`/disputes` calls `listDisputes(ctx, { status })` with no scope), so the UI never relied on the vulnerable path.

---

## 2. Regression tests added

Added to `scripts/verify-api.mjs`, section **“S-01: scope=all is a mediator privilege, never a query flag”**, immediately after the seeded-dispute setup. 12 assertions:

| # | Assertion | Expectation |
|---|---|---|
| 1 | Guest `GET /api/disputes?scope=all` | 401 |
| 2 | Newly registered ordinary account (no marketplace role) `scope=all` | 403 |
| 3 | That denial carries no `disputes` array, no `DSP-…` reference, no `total`/`count` metadata | true |
| 4 | Ordinary reseller `scope=all` | 403 |
| 5 | Reseller denial text contains no dispute reference | true |
| 6 | Ordinary supplier `scope=all` | 403 |
| 7 | Ordinary account default list (no scope) still works and is **empty** (0 disputes) | 200 + `[]` |
| 8 | Ordinary account `GET /api/disputes/{foreignId}` (seeded dispute from another workspace) | 403 |
| 9 | A party (reseller) `?scope=mine` still sees the seeded dispute | 200 + present |
| 10 | The other party (supplier) default list still sees the seeded dispute | 200 + present |
| 11 | Mediator `scope=all` | 200 + seeded dispute present |
| 12 | Platform admin `scope=all` | 200 + seeded dispute present |

Tests run inside `npm run test:e2e:clean`, so they execute against a freshly migrated and seeded throwaway database, never `prisma/dev.db`.

---

## 3. Evidence the tests failed before the fix

Command: `npm run test:e2e:clean -- --skip-build` on the **unmodified** application.

```
harness_exit=1
pass=142 fail=5

FAIL  an ordinary account cannot list every dispute (S-01) — status 200
FAIL  the scope=all denial carries no dispute payload (S-01)
FAIL  a reseller cannot list every dispute (S-01) — status 200
FAIL  the reseller denial leaks no reference (S-01)
FAIL  a supplier cannot list every dispute (S-01) — status 200
5 CHECK(S) FAILED
[harness] FAILED after 15.4s: verify-api.mjs failed with exit code 1
```

The assertions that already held before the change show the invariants that had to be preserved:

```
PASS  guests cannot request every dispute — status 401
PASS  an ordinary account still reads only its own empty list — status 200, 0 dispute(s)
PASS  an unrelated account cannot open another workspace's dispute (S-01) — status 403
PASS  a party still sees its own disputes
PASS  a mediator can list every dispute — status 200
PASS  a platform admin can list every dispute — status 200
```

Failure mode matched Stage 1's live probe: ordinary accounts received **200** with the platform-wide dispute list, including `DSP-DEMO-01`, a case they were not party to.

---

## 4. Implementation and authorization behaviour chosen

**Behaviour: explicit `403 Forbidden`** for `scope=all` from anyone who is not a mediator/platform admin.

Rationale over the alternative (silently downgrading to the caller's own list):

- It matches the established API convention: privileged collection reads (`requireMediator`, `requirePlatformAdmin`) answer 403 with `{ error, code: "FORBIDDEN" }`.
- Silently returning a narrower list makes a client believe it received the global collection, which hides permission bugs and could mislead a mediator tool built on the same endpoint.
- The denial is generated **before any query**, so no records, counts, pagination or existence hints are produced.

**Change (only hunk):**

```ts
export async function listDisputes(
  viewer: DisputeViewer,
  options: { status?: string; scope?: "mine" | "all" } = {},
) {
  const moderator = isMediator(viewer);

  // `scope` is a request, not an authorization. Only mediators and platform
  // admins may read across disputes; everyone else is confined to their own
  // cases (audit finding S-01). This is checked before any query runs, so a
  // denied caller receives no records, counts or other metadata.
  if (options.scope === "all" && !moderator) {
    throw forbidden("Only a platform mediator can view every dispute");
  }

  const scope = options.scope ?? (moderator ? "all" : "mine");
  …
```

Why this is the smallest safe fix:

- Enforced in the **service**, not the route, so every present and future caller inherits it.
- Uses the existing `isMediator()` predicate (platform admin **or** `MEDIATOR` role), so mediator and admin permissions are unchanged and consistent with the rest of the dispute module.
- Leaves the query, response shape, status filter, ordering, limit and `VISIBLE_TO_PARTY` filtering untouched.
- Route, UI, schema and every other dispute workflow are unchanged.

---

## 5. Evidence the tests pass after the fix

Command: `npm run test:e2e:clean` (full: isolated DB + migrations + seed + production build + API + PWA).

```
harness_exit=0
pass=178 fail=0
[harness] isolation check 1 passed: canary workspace "HARNESS-MW1AT0H8" served from the temp database
[harness] isolation check 2 passed: pid 1079705 DATABASE_URL matches the temp file
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 119.6s (isolated DB, api=0, pwa=0)
```

S-01 assertions and preserved behaviour after the fix:

```
PASS  guests cannot request every dispute — status 401
PASS  an ordinary account cannot list every dispute (S-01) — status 403
PASS  the scope=all denial carries no dispute payload (S-01)
PASS  a reseller cannot list every dispute (S-01) — status 403
PASS  the reseller denial leaks no reference (S-01)
PASS  a supplier cannot list every dispute (S-01) — status 403
PASS  an ordinary account still reads only its own empty list — status 200, 0 dispute(s)
PASS  an unrelated account cannot open another workspace's dispute (S-01) — status 403
PASS  a party still sees its own disputes
PASS  the other party still sees its own disputes
PASS  a mediator can list every dispute — status 200
PASS  a platform admin can list every dispute — status 200
PASS  an unrelated account sees no disputes
```

Total assertions: **178** (166 before this task + 12 new), 0 failures.

---

## 6. Full verification results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | executed inside `test:e2e:clean` | **exit 0** |
| API suite | `scripts/verify-api.mjs` on the throwaway DB | **147 / 147 passed** (135 + 12) |
| PWA suite | `scripts/verify-pwa.mjs` on the throwaway DB | **31 / 31 passed** |
| Combined run | `npm run test:e2e:clean` | **PASSED**, 119.6 s, exit 0 |
| Isolation | canary + `/proc` `DATABASE_URL` | both passed |
| Pre-existing servers | `ss -ltnp` after the run | `:3000` pid 2802, `:4318` pid 1057494, `:4322` pid 927563 — all still listening, none signalled |

---

## 7. Project database unchanged

| Evidence | Value |
|---|---|
| `md5sum prisma/dev.db` before and after | `2ee44e7855bc5442c6e9c0d535eb8f0d` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical, reported by the harness itself) |
| Reset / reseed of project data | **not run** (`db:reset` was never invoked) |

All writes during testing — migrations, seed, suite mutations, canary rename — happened inside `/tmp/sellflow-e2e-*/test.db`, which the harness deleted.

---

## 8. Limitations and remaining concerns

1. **S-01 is closed only on the verified path.** The service guard covers `GET /api/disputes` and any future caller of `listDisputes`. There is no other route that reads disputes across tenants today. This is not a general authorization framework — S-02, S-03, S-04 and the rest remain open, and the audit's P0 set is still blocking a pilot.
2. **Denied attempts are not audited.** A non-mediator asking for `scope=all` gets a 403 but leaves no `AuditLog` entry or metric. Adding a denial audit belongs with the S-12 audit-durability work rather than here.
3. **403 reveals the endpoint has a global scope.** That is inherent to an explicit denial and reveals no records, counts or existence information. The alternative (silent narrowing) was rejected in §4.
4. **No pagination exists**, so `scope=all` still returns up to 100 rows for mediators. Fine at pilot scale; worth revisiting before a large caseload.
5. **The suite has no coverage for future query parameters** that might select collections; the guard is property-specific (`scope === "all"`), which is deliberate — it fixes S-01 without redesigning the API.
6. **Pre-existing servers were not restarted.** Three servers are running from this folder (one unrelated on `:3000`); the harness's build rewrote `.next`, so a long-lived preview could momentarily serve mixed chunks. `:4318` and `:4322` were checked as still listening after the run.
7. **Phase 0 remains incomplete.** Nothing here validates demand, and this report must not be read as a pilot-readiness statement.

---

## 9. Files changed

| File | Change |
|---|---|
| `src/server/disputes.ts` | Added the `scope=all` authorization guard in `listDisputes` (4 comment lines + 3 code lines, no other edits). |
| `scripts/verify-api.mjs` | Added 12 regression assertions for S-01 (mediator/admin allowance, ordinary-role denial, no-leak checks, preserved own-scope access). |
| `STAGE2_TASK2A_S01_REPORT.md` | This report. |

Not changed: schema, migrations, seed data, dependencies, billing/entitlements, product requirements, other dispute workflows, `prisma/dev.db`.

**S-01 fix complete. No other security finding was started.**
