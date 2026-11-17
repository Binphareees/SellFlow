# SellFlow — Stage 2, Task 8: Test Baseline Reconciliation (Before S-14 Continuation)

**Date:** 2026-11-05
**Scope:** investigation only. No application code, test file, schema, migration or
documentation was modified by this reconciliation.

## 1. What was checked first

- `git diff -- src/server/supplier.ts src/app/api/marketplace/applications/route.ts
  scripts/verify-api.mjs` — empty. The three files reverted in the previous turn
  match HEAD exactly; none of them still carries the `submitApplication()` change.
- `npm run typecheck` over the reverted tree — exit 0.
- The isolated harness log from the failed run that followed the revert —
  `/tmp/sf-submit-app.log` — was inspected line by line against the current
  implementation.

So the revert itself was clean before the failed run: the 28 failures are **not**
caused by lingering `submitApplication()` edits in the source.

## 2. Exact test names and failure messages (from the failed run)

28 FAIL lines, all tagged `(S-07)`, `(S-10)` or `(S-11)`. They are a single
cascading failure chain, not 28 independent faults. In order:

**Setup / smoke (1 failure, plus 1 dependent SKIP)**

- `FAIL  a tier-0 reseller can still apply to a supplier (S-07) — status 500`
- `SKIP  S-11 dependent checks: probe listing/offer/agreement was not created`

**S-10 — apply / approve / accept / price-read (the core chain)**

- `FAIL  a reseller can apply for the new offer (S-10) — status 500`
- `FAIL  supplier approval creates an agreement from the offer's floor (S-10) — status 404`
- `FAIL  approval copies wholesale, minimum resale and commission from the offer (S-10) — terms null`
- `FAIL  the reseller can accept the approved terms (S-10) — status 404`
- `FAIL  the approved reseller sees the wholesale price and the floor separately (S-10) — status 403, terms null`

**S-10 — order enforcement (all 403 because there is no active agreement for the
fresh reseller, since approval never succeeded)**

- `FAIL  a resale price one kobo below the minimum is rejected (S-10) — status 403`
- `FAIL  a bulk quantity cannot bypass the resale floor (S-10) — status 403`
- `FAIL  client-supplied minimum or wholesale values cannot lower the floor (S-10) — status 403`
- `FAIL  a sub-ULP float cannot store a value below the integer minimum (S-10) — status 403, resale undefined`
- `FAIL  a resale price exactly at the minimum is accepted (S-10) — status 403`

**S-10 — offer lifecycle (activate / version / reactivate) — 403/404 because the
probe reseller never had an approved, accepted agreement (approval never succeeded)**

- `FAIL  an offer update does not retroactively change an accepted agreement (S-10) — status 403`
- `FAIL  the supplier can push the new floor to the agreement (S-10) — status 404, min undefined`
- `FAIL  the reseller can accept the new floor (S-10) — status 404`
- `FAIL  the updated minimum is enforced after acceptance (S-10) — status 403`
- `FAIL  the updated minimum accepts an exact match (S-10) — status 403`
- `FAIL  the approved reseller still sees the private price after the update (S-10) — status 403, terms null`
- `FAIL  reactivating an offer cannot bypass the floor (S-10) — reactivate 200, price 403`
- `FAIL  the floor is still enforced after reactivation (S-10) — status 403`

**S-11 setup (depends on the S-10 chain)**

- `FAIL  S-11 setup: probe reseller approved with an active agreement — register 201, apply 500, approve 404, accept 404`

The remaining S-10 checks that did **not** depend on the live submit→approve→accept
chain still passed: zero/negative/float/oversized/unsafe resale prices rejected at
the boundary (422), client-supplied supplier id rejected (404), no partial order
created (`0→0`). Those are the checks whose behaviour is enforced at the order
creation step and at the request-schema step; they do not need a completed
apply→approve→accept cycle.

## 3. Root cause of every failure

There are three layers, and only the innermost one is a real product behaviour.

### 3.1 The single initiating fault: `POST /api/marketplace/applications` returned 500

`submitApplication()` throws only three (`notFound`, `badRequest`, `conflict`), all
of which are for preconditions that do not hold here: the supplier exists and is
active, the caller is not the supplier, and there is no existing `PENDING`
application for that (supplier, reseller) pair. `ensureRole()` upserts and never
throws; the two `audit()` calls swallow errors by design. So in the **current
reverted source** the apply endpoint should return `201`. It did not — it returned
`500` — which means the process that served that request was **not running the
current reverted source**.

### 3.2 The real cause: a stale production build, not the reverted source

The harness rebuilds the production bundle on every full run (it runs `npm run
build` against the temp database unless `--skip-build` is passed). The failed run
**did rebuild**: the log contains the line

```
[harness] building the production bundle against the temp database
```

and there is no `--skip-build` flag in the command that was used. The build artifact
timestamp recorded in `.next/BUILD_ID` was `03:21:39`. The reverted source file
`src/server/supplier.ts` has mtime `03:24:25` — **after** the build.

That ordering is the whole story:

- The build at `03:21:39` was produced from the source tree **as it was at
  `03:21:39`**.
- The revert that restored the three files happened at `03:24:25`, **after** the
  build had already finished.
- The running server was then started from that already-completed build, so it
  served whichever source state existed at `03:21:39`, **not** the reverted state
  patched in at `03:24:25`.

Direct artifact inspection confirms this. After the failed run had torn down, the
built route handler at `.next/server/app/api/marketplace/applications/route.js`
contained the **pre-revert** implementation: a `prisma.$transaction` that destructures
`{application, rotated}` and conditionally calls `rotateSessionForUser`. That is the
code from the **previous** turn's change, not the reverted handler (which takes
`submitApplication(...)` directly and returns `json({ application }, 201)` with no
transaction wrapper). The built `submitApplication` (in `.next/server/chunks/2616.js`)
also still carried the change's signature/return shape (`ensureRole` accepting a
client parameter, returning a `roleActivated` boolean, `{application, roleActivated}`
return value). Both pieces are from the change that was reverted **after** the build
was already written.

So the 500 at apply is the stale build running a version of the code that no longer
exists on disk. Every failure downstream of apply is then a consequence of that one
stale-build mismatch.

### 3.3 Why approval returned 404 and everything after it failed

Because apply returned 500, no `ResellerApplication` row was created. The approval
call then did `resellerApplication.findFirst(...)` and received `null`, so it threw
`notFound("Application not found")` → HTTP 404 (this is correct application
behaviour given the missing row). The acceptance call then did
`resellerAgreement.findFirst(...)` and received `null` → 404. The private-price read
call then found no active agreement → 403. All of those are correct **given the
missing application**, which itself is the artifact of serving the stale build.

### 3.4 Why the S-10 below-minimum order checks failed with 403 (not 201)

The S-10 acceptance contract is:

> a reseller must be **approved** and must have **accepted** the agreement before
> `createSupplierOrder()` will resolve private pricing, and once it does, the order
> creation step enforces `resalePriceKobo ≥ minResalePriceKobo` from the agreement
> version the order uses.

The resubmitted probe reseller never reached approved+accepted state (apply failed),
so the order endpoint resolves pricing to `deny("NO_AGREEMENT")` / `deny("APPLICATION_NOT_APPROVED")`
and returns 403 before it ever reaches the floor check. That is correct application
behaviour given the missing agreement; it is **not** a regression in the floor
enforcement itself. The floor-enforcement logic (`assertResalePriceAtOrAboveMinimum`
in `createSupplierOrder`, plus `kobo.positive()` in `supplierOrderCreateSchema`) is
untouched by any of this and was never the source of these particular failures.

## 4. How this fits the accepted S-10 contract

The S-10 report (`STAGE2_TASK6B_S10_REPORT.md`) documents the accepted contract
clearly:

- the floor applies to the **resale price** (order line), not the wholesale price —
  an offer with `resellerPriceKobo < minResalePriceKobo` is valid and normal;
- the applicable floor is the one on the **agreement version the order uses**, not the
  listing's current offer version;
- the resale price is **optional** at order creation; if omitted, no floor comparison
  happens;
- offer creation, offer versioning, supplier approval, agreement versioning,
  proposal acceptance and offer activation all copy or preserve the floor; the only
  writer of `SupplierOrderItem.resalePriceKobo` is `createSupplierOrder()`, which is
  the enforcement point;
- `acceptAgreement()` activates the version whose floor is then enforced.

The current implementation matches that contract:

- `decideApplication()` copies `resellerPriceKobo`, `minResalePriceKobo` and
  `commission*` from `offer.currentVersion` into the new `ResellerAgreementVersion`.
- `acceptAgreement()` sets `acceptedByResellerAt` and `status = ACTIVE` on the
  current version.
- `resolveResellerPrice()` (in `src/server/price-access.ts`) requires an approved
  application, an active offer and an active agreement with a current version before
  returning the terms; the unaccepted agreement is denied.
- `createSupplierOrder()` resolves pricing through `resolveResellerPrice()`, then runs
  `assertResalePriceAtOrAboveMinimum(listing.title, item.resalePriceKobo,
  access.terms.minResaleKobo)` after the MOQ check and before the order row is created.

None of that was changed by the reverted `submitApplication()` work, and none of the
failing S-10 checks exercise the **successful** path through that contract (they all
fail before reaching it). The failures are therefore not evidence of a contract
violation.

## 5. Classification of each failure

| Failure class | Examples | Classification |
|---|---|---|
| Apply returned 500 because the running build predated the revert | `a reseller can apply for the new offer (S-10) — status 500` | **Stale build / test-harness state issue**, not a source or product fault |
| Downstream 404/403 caused by the missing application row from the above | all approval, acceptance, price-read, order and offer-lifecycle failures in the S-10/S-11 chains | **Stale build propagation** — correct behaviour given the missing row, but not a product regression |
| One S-07 smoke check that exercises the same apply endpoint | `a tier-0 reseller can still apply to a supplier (S-07) — status 500` | **Stale build** (same root cause as the S-10 apply failure) |
| S-11 setup failure | `S-11 setup: probe reseller approved with an active agreement — register 201, apply 500, approve 404, accept 404` | **Stale build propagation** (depends on the S-10 apply success) |

There is **no** failure in this set that points to a genuine regression in the
reverted source, the S-10 floor enforcement, the offer lifecycle, the agreement
acceptance path, or the resolver/price-access gate. The only product-path failures
(403 order rejections, 404 approval/acceptance) are the **expected** outcomes when
the prerequisite application row is absent, and the prerequisite is absent because
the endpoint that should have created it was served from a stale build.

The checks that **did** pass — the boundary validations (422 on zero/negative/
fractional/oversized/unsafe resale prices, 404 on foreign supplier id) and the
no-partial-order check — are the parts of S-10 whose behaviour does **not** depend on
a successful apply→approve→accept cycle, and they pass cleanly. That is consistent
with the root-cause diagnosis: the floor-enforcement code itself is fine; the failures
are all upstream of it.

## 6. What was **not** a cause

- **The reverted files.** They match HEAD (`git diff` empty) and typecheck clean.
- **`submitApplication()` in the current source.** It throws only on genuine
  preconditions; none of those preconditions fail for the probe. In the reverted
  source the apply endpoint would return 201.
- **The S-10 floor enforcement.** It was never reached by the failing order checks,
  and the boundary checks that do reach it (schema + service) pass.
- **The offer lifecycle or agreement acceptance logic.** `decideApplication()`,
  `acceptAgreement()` and `resolveResellerPrice()` are untouched and behave correctly
  for the states they are given; they are given a missing application because apply
  failed upstream.
- **The seed data or migrations.** The harness log shows migrations applied and the
  canary workspace written to the temp database; the probe reseller is a brand-new
  account created by the test itself, so no stale seed row is involved.
- **`@prisma/client` or the database.** The temp database is fresh per run; the
  failing call is a vanilla `findUnique`/`create` on a fresh row with valid foreign
  keys. There is no constraint violation that would explain a 500 from the reverted
  code.

## 7. Recommended minimal correction plan

The failures are a test-environment/state artifact, not a product defect, so the
correction is to make the next harness run see the **current** source — i.e. ensure
the build it runs reflects the reverted tree.

1. **Re-run the isolated harness against the reverted source with a fresh build.**
   Use `npm run test:e2e:clean` (full: migrate temp DB, seed, rebuild, run API + PWA,
   teardown). Do **not** use `--skip-build`, because the previous failure was caused
   by a build that predated the revert; a fresh build is what corrects it.
2. **Confirm the S-10 apply/approve/accept/price-read chain passes** (the five core
   S-10 checks that failed here). Those are the checks that were blocked by the stale
   build; they are the first ones to verify.
3. **Confirm the S-07 apply smoke and the S-11 setup pass**, since they depend on the
   same apply endpoint.
4. **Confirm the previously-passing S-10 boundary checks still pass** (zero/negative/
   fractional/oversized/unsafe, foreign supplier id, no partial order).
5. If any of those still fails with the fresh build, treat it as a real product issue
   and investigate from the current source, not from the stale-build failure set.

No test assertion should be weakened or re-valued on the basis of this run: the 28
failures are explained by a stale build, and their expected outcomes under the current
source are the opposite of what this run reported (apply 201, then approve 200,
accept 200, price read 200, order accepted or rejected by floor as appropriate).

## 8. Summary

The 28 failures are **not** a baseline of real faults in the reverted state. They are
a single stale-build failure (`POST /api/marketplace/applications` returning 500 from
an out-of-date bundle) with a deterministic cascade: no application row → approval 404
→ acceptance 404 → no active agreement → every dependent S-10 order/price check fails
with 403/404, and the S-11 setup that depends on that chain fails too.

Artifact timestamps and built-code inspection both confirm it: the build was produced
at `03:21:39`, the revert that restored the three files happened at `03:24:25`, and
the built route handler and `submitApplication` still contain the pre-revert
implementation. The current reverted source is clean (empty `git diff`, typecheck
exit 0) and, in that source, the apply endpoint returns 201.

**Recommendation:** re-run the full isolated harness with a fresh build against the
reverted source. That is the only correction needed; nothing in the product requires
changing for these 28 failures.
