# SellFlow — Stage 2, Task 6B: S-10 (Minimum Resale Price Enforcement) Report

**Date:** 2026-11-05
**Scope:** S-10 only. S-09, S-11, S-12 and S-14 were not started. No billing, entitlement, C-03, payment-processing, role, approval or commission-semantics change. No schema or migration change. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

> **Status:** A reseller can no longer record a resale price below the supplier's applicable minimum resale price. The check runs server-side in `createSupplierOrder()`, uses the agreement version that authorises the order, compares integer kobo only, and rejects before any order row is created. Zero, negative, fractional, malformed, oversized and unsafe values are rejected at the schema or service boundary. The private-price boundary is unchanged, public listing APIs still expose no private price, and MOQ remains an independent rule. **Commission remains informational and is not computed.**

---

## 1. Original vulnerability and root cause

`createSupplierOrder()` resolved the private wholesale price and the agreement terms server-side, enforced MOQ, then copied the reseller's planned selling price straight into the order line:

```ts
lines.push({
  listingId: listing.id,
  offerVersionId: listing.offer.currentVersionId,
  agreementVersionId: access.agreementVersionId,
  title: listing.title,
  qty: item.qty,
  unitPriceKobo: access.terms.priceKobo,
  lineTotalKobo: access.terms.priceKobo * item.qty,
  resalePriceKobo: item.resalePriceKobo ?? null,
});
```

`access.terms.minResaleKobo` was resolved and returned by `resolveResellerPrice()`, but it was never compared with `item.resalePriceKobo`. The supplier's minimum resale price was stored, displayed in the reseller UI and shown in the supplier dashboard, yet it had no effect on the only write path for a resale price.

The original reproduction was:

```text
SupplierOrderItem.resalePriceKobo = 1,000 kobo (₦10)
Agreement minResalePriceKobo      = 45,000 kobo (₦450)
POST /api/supplier/orders         → 201 Created
```

The baseline run in this task reproduced it again on a fresh isolated database: the below-minimum order returned **201**, the order was persisted, and no rejection message was produced.

**Root cause:** the minimum resale price was treated as display data, not as a server-side business rule. The reseller UI pre-filled the minimum, but a pre-filled input is not enforcement. The server accepted any integer the client sent, including zero and values far below the floor.

**What this was not:** the vulnerability was not in `resolveResellerPrice()` and not in the public-price boundary. The price-access gate correctly returned the agreed terms only to an approved reseller with an active agreement. The defect was that the returned floor was not applied to the resale price the reseller submitted.

---

## 2. Pricing-field definitions and business-rule interpretation

The existing schema, PRD, seed data and UI copy define four distinct prices. They are not interchangeable.

| Field | Meaning | Visibility | Who sets it |
|---|---|---|---|
| `ProductListing.publicPriceKobo` | Suggested / public retail price shown in the marketplace | Public | Supplier, on listing create/update |
| `ResellerOfferVersion.resellerPriceKobo` | Approved private wholesale price the reseller pays | Private, gated by agreement | Supplier, on offer creation/version |
| `ResellerOfferVersion.minResalePriceKobo` | Floor on the reseller's own resale price | Private, gated by agreement | Supplier, on offer creation/version |
| `ResellerAgreementVersion.resellerPriceKobo` | Snapshot of the wholesale price the approved reseller accepted | Private to the parties | Created by approval / agreement version / accepted proposal |
| `ResellerAgreementVersion.minResalePriceKobo` | Snapshot of the floor the approved reseller accepted | Private to the parties | Same |
| `SupplierOrderItem.unitPriceKobo` | Wholesale price actually charged on the order | Parties to the order | Server-resolved from the agreement, never the body |
| `SupplierOrderItem.resalePriceKobo` | The reseller's planned selling price, used for profit math | Parties to the order | Reseller, at order creation |
| `commissionType` / `commissionValue` | Informational commission terms | Private, gated by agreement | Supplier, on offer/agreement versions |
| `moq` | Minimum order quantity | Public (listing) / private (offer/agreement) | Supplier |

The enforced rule is:

> `SupplierOrderItem.resalePriceKobo` must be at least the `minResalePriceKobo` on the agreement version that authorised the order, when that minimum is set.

Consequences of that interpretation:

- The floor applies to the **resale price**, not to the lower **wholesale price**. An offer with `resellerPriceKobo < minResalePriceKobo` is normal and valid; the reseller buys at wholesale and sells at or above the floor. The tests explicitly assert this.
- The applicable floor is the one on the **agreement version recorded by the order**, not the listing's current offer version. An offer update alone does not retroactively change an agreement the reseller already accepted.
- A request body can never supply, lower or override the floor. The minimum is read from the resolved agreement version; client fields with the same names are stripped by zod.
- The resale price is optional, matching the existing schema and UI. If the reseller omits it, no resale price is recorded and no floor comparison is possible. If it is supplied, it must be a positive integer kobo and at or above the floor.
- The floor does not require the resale price to be at or below `publicPriceKobo`. No such rule exists in the source. Suggested retail remains a separate public figure.
- Commission is stored and displayed only. The order total is wholesale × quantity; no commission is added or subtracted. This preserves the existing informational behaviour and does not invent a formula.

---

## 3. Unresolved pricing ambiguity and scope mapping

The task's wording refers to "product creation/update" and "offer creation/update/approval". The actual data model does not put a resale price on a listing, offer or agreement version:

- Listings carry `publicPriceKobo` (suggested retail).
- Offers and agreement versions carry `resellerPriceKobo` (wholesale) and `minResalePriceKobo` (floor).
- The only resale price in the schema is `SupplierOrderItem.resalePriceKobo`, written only by `createSupplierOrder()`.

Therefore the enforceable path is order creation. Reinterpreting `resellerPriceKobo` as the resale price would have rejected the normal marketplace case (wholesale below the floor) and broken the seeded catalogue. No such reinterpretation was made, and no new resale-price field was invented.

Offer creation, offer versioning, supplier approval, agreement versioning, proposal acceptance and offer activation are still covered: the tests verify that the supplier's floor is carried into the agreement version unchanged, that activation does not remove it, and that a below-minimum order is rejected after each path. There is no alternate route that writes a resale price.

Two further points are recorded rather than silently changed:

1. **No resale-price update route exists.** `PATCH /api/supplier/orders/[id]` accepts only `status` and `note`; a `resalePriceKobo` in that body is stripped. The test confirms a status change cannot lower the stored resale price. If an update route is added later, it must call the same enforcement helper.
2. **The pilot seeder has extra supplier-side data-quality checks that the runtime API does not enforce.** `scripts/seed-pilot.mjs` rejects `minResale < wholesale` and `minResale > publicPrice`. The runtime API accepts those combinations because the PRD does not clearly make them invalid and because enforcing them would be a separate supplier-side data-quality rule, not the S-10 resale-floor rule. This is left as an explicit limitation, not guessed at.

**Commission before/after decision:** not needed. No code computes commission, so there is no before/after-commission amount for the floor to apply to. The field remains informational, as it was.

---

## 4. Failing test baseline (recorded before implementation)

The S-10 block was added to `scripts/verify-api.mjs` and run against the **unmodified application** through the isolated harness:

```text
npm run test:e2e:clean -- --skip-build
```

Result: **exit 1, 10 S-10 failures, 58.5 s**. The API suite stopped before the PWA stage. `prisma/dev.db` was untouched (`sha256=522a35fcabbf`, size `589824`).

```text
FAIL  a resale price below the seeded minimum is rejected (S-10) — status 201
FAIL  the below-minimum rejection names the floor and creates no order (S-10) — error none
FAIL  a resale price one kobo below the minimum is rejected (S-10) — status 201
FAIL  a zero resale price is rejected (S-10) — status 201
FAIL  a float just below the minimum cannot round up into acceptance (S-10) — status 201
FAIL  a float just above the minimum is still not integer kobo (S-10) — status 201
FAIL  a bulk quantity cannot bypass the resale floor (S-10) — status 201
FAIL  client-supplied minimum or wholesale values cannot lower the floor (S-10) — status 201
FAIL  rejected resale prices create no partial order (S-10) — 0→6
FAIL  the updated minimum is enforced after acceptance (S-10) — status 201
```

The original ₦10-vs-₦450 reproduction is the first failure: the server returned **201** and created the order.

**Baseline calibration note:** the first version of the two float probes used `S10_MIN ± 1e-10`. At 4,000,456 the double ULP is about `4.66e-10`, so both values collapse to the same integer before the server sees them; the unmodified app accepted them. Those two lines were therefore test calibration, not security failures. The final suite uses representable fractions (`±0.25`) for the 422 checks and a dedicated sub-ULP check that expects the collapsed integer to be stored. The **eight substantive baseline failures** are: below-minimum accepted, no rejection, one-kobo-below accepted, zero accepted, bulk-below accepted, injected values accepted, the initial suite's `0→6` order count (including the two calibration probes), and the updated minimum accepted below.

---

## 5. Exact enforcement points

### 5.1 Service check in `createSupplierOrder()`

`src/server/supplier.ts` now resolves the agreement, enforces MOQ, then checks the resale price before adding the line. The order row is created only after every line passes, so a rejected line prevents the whole order (no partial order).

```ts
/**
 * The supplier's minimum resale price is a floor on the price the reseller
 * charges its own customer — not on the wholesale price it pays. The applicable
 * floor is the one recorded on the agreement version this order uses, so a
 * request body can never supply or lower it. Both sides are integer kobo, and a
 * supplied value must be a positive safe integer so no fractional, negative or
 * unsafe amount can slip through.
 */
function assertResalePriceAtOrAboveMinimum(
  title: string,
  resalePriceKobo: number | undefined,
  minResaleKobo: number | null,
) {
  if (resalePriceKobo === undefined) return;
  if (!Number.isSafeInteger(resalePriceKobo) || resalePriceKobo <= 0) {
    throw badRequest("Resale price must be a positive whole number of kobo");
  }
  if (minResaleKobo === null) return;
  if (!Number.isSafeInteger(minResaleKobo) || minResaleKobo < 0) {
    throw badRequest("The agreement has an invalid minimum resale price");
  }
  if (resalePriceKobo < minResaleKobo) {
    throw badRequest(
      `${title}: resale price cannot be below the supplier's minimum of ${formatMoney(minResaleKobo)}`,
    );
  }
}
```

Call site, after the existing MOQ check:

```ts
if (item.qty < access.terms.moq) {
  throw badRequest(`${listing.title} has a minimum order of ${access.terms.moq}`);
}

// S-10: the resale price is the reseller's planned selling price, so it is
// checked against the minimum resale price on the agreement version that
// authorises this order. The check runs before any order row is created.
assertResalePriceAtOrAboveMinimum(
  listing.title,
  item.resalePriceKobo,
  access.terms.minResaleKobo,
);
```

Why this is authoritative:

- `resellerProfileId` comes from the authenticated session (`requireRole(ROLE.RESELLER)`), not the body.
- `supplierProfileId`, `listingId` and `offerId` are resolved from the database; the listing lookup is scoped by the supplier id.
- `access` comes from `resolveResellerPrice()`, which requires an approved application, an active offer and an active agreement.
- `minResaleKobo` comes from the agreement version, never from the body.
- `unitPriceKobo` continues to come from the agreement, never from the body.
- The line records `agreementVersionId`, so the check is verifiable against the exact version used.

### 5.2 Schema check in `supplierOrderCreateSchema`

`src/lib/validation.ts` now rejects a supplied resale price of zero at the HTTP boundary:

```ts
listingId: z.string().cuid(),
qty: z.number().int().min(1).max(10_000),
// The reseller's planned selling price. It is optional, but a supplied
// value must be a positive whole number of kobo; the server then checks
// it against the agreement's minimum resale price.
resalePriceKobo: kobo.positive("Resale price must be greater than zero").optional(),
```

`kobo` already enforces `.int()`, `.min(0)` and `.max(100_000_000_000)`. The `.positive()` refinement adds the zero case. Negative, fractional, string, null, boolean, oversized and unsafe values are rejected by zod with **422**.

### 5.3 Every path that creates or activates terms

| Path | What it does | S-10 treatment |
|---|---|---|
| `createListing()` with `offer` | Creates the listing and offer version 1 with `resellerPriceKobo` and `minResalePriceKobo` | Stores the supplier's floor; no resale price exists here. Tested. |
| `addOfferVersion()` | Appends an offer version and makes it current/active | Stores the new floor; existing agreements keep their accepted version. Tested. |
| `setOfferStatus()` | Activates, pauses or archives an offer | Pausing closes the private price; reactivating cannot lower the agreement's floor. Tested. |
| `decideApplication()` | Supplier approval creates an agreement version from the offer's current terms | Copies the floor unchanged; the unaccepted agreement cannot read the price; a below-minimum order is still rejected. Tested. |
| `addAgreementVersion()` | Supplier pushes new terms to an approved reseller | Copies the new floor; the agreement is locked until the reseller accepts. Tested. |
| `acceptAgreement()` | Reseller accepts the current version | Activates the version whose floor is then enforced. Tested. |
| `createProposal()` / `acceptProposal()` | Negotiated terms create an agreement version | The proposal carries `minResalePriceKobo`; acceptance snapshots it. No resale price is supplied here, so no new enforcement is needed. Not changed. |
| `createSupplierOrder()` | The only writer of `SupplierOrderItem.resalePriceKobo` | **The enforcement point.** |
| `PATCH /api/supplier/orders/[id]` | Status/note only | `resalePriceKobo` is stripped; the stored value cannot be lowered. Tested. |

A repository-wide search confirms that `SupplierOrderItem.resalePriceKobo` has no other runtime writer. `prisma/seed.ts` writes one historical demo order item directly, as fixture data; it is not an API path.

### 5.4 Race / outdated-minimum analysis

The order line stores both `agreementVersionId` and `resalePriceKobo`. The check uses the same `access.agreementVersionId` that the line records, and the minimum from that version. If the supplier changes the agreement concurrently:

- the line still references the version whose minimum was checked; or
- the reseller's next request resolves the new version and checks against it.

A concurrent change cannot make a stored line reference a version whose minimum it violates. This is the existing version-lock design (OV-01..OV-04), not a new mechanism. The order is also application-atomic: all lines are validated before `supplierOrder.create`, so there is no partial order. No schema change was needed.

---

## 6. Integer-kobo validation strategy

- **Storage and arithmetic:** all amounts are integer kobo (`Int` columns). `unitPriceKobo × qty`, `lineTotalKobo`, and `totalKobo` are integer arithmetic. No float division or multiplication is used.
- **Schema:** `kobo` is `z.number().int().min(0).max(100_000_000_000)`. `resalePriceKobo` adds `.positive()`.
- **Service defence in depth:** `Number.isSafeInteger(resalePriceKobo) && resalePriceKobo > 0`; the minimum must be a safe integer `>= 0`.
- **Comparison:** direct `<` on two integers. There is no conversion through naira, no `parseFloat`, and no rounding in the comparison.
- **Range:** the schema maximum `100_000_000_000` is far below `Number.MAX_SAFE_INTEGER` (`9_007_199_254_740_991`), so every accepted value is exactly representable.
- **Sub-ULP inputs:** a delta smaller than the double ULP at the minimum collapses to the same integer before validation. It therefore cannot store a value below the floor; the stored value is exactly the integer minimum. The suite proves this.
- **Consistent errors:** schema violations return **422 `VALIDATION_ERROR`**; business-rule violations (floor and MOQ) return **400 `BAD_REQUEST`**. The floor message names the listing and the minimum in naira. This matches the existing MOQ behaviour in the same service. Clients should treat any 4xx as a rejection.

---

## 7. Regression test results — 55 S-10 assertions

Added to `scripts/verify-api.mjs` after the agreement version-lock checks. They use dedicated probe accounts, a dedicated listing/offer, and the isolated database. They do not alter seeded users or `prisma/dev.db`.

### 7.1 Required-scenario coverage

| # | Required scenario | Representative assertions |
|---|---|---|
| 1 | Product creation rejects a resale price below the configured minimum | Original ₦10-vs-₦450 reproduction; one-kobo-below; bulk-below |
| 2 | Product creation accepts a price exactly equal to the minimum | At-minimum order; updated-minimum exact match |
| 3 | Product creation accepts a price above the minimum | Above-minimum order; bulk at floor |
| 4 | Product update rejects lowering the price below the minimum | Status PATCH with `resalePriceKobo: 1` leaves the stored value unchanged; no resale-price update route exists |
| 5 | Product update accepts a valid price at or above the minimum | Offer v2 + agreement v2; accepted new floor; exact match accepted |
| 6 | Reseller offer creation cannot bypass the applicable minimum | New offer with floor; below-floor order rejected |
| 7 | Reseller offer updates cannot bypass the minimum | Offer v2 with a higher floor; agreement v2; below-floor rejected |
| 8 | Supplier approval cannot activate an invalid below-minimum offer | Approval copies the floor; unaccepted agreement cannot read the price; below-floor order rejected |
| 9 | Public listing responses do not expose private reseller prices | Public discovery/detail contain no `resellerPriceKobo`, `minResalePriceKobo`, `resalePriceKobo`, or private values |
| 10 | Unapproved resellers cannot access private reseller prices | Unapproved reseller 403; pending application 403; unapproved order 403 |
| 11 | Approved resellers retain access to their authorized private prices | Approved reseller 200 before and after the floor update |
| 12 | Bulk pricing remains governed by its separate minimum-quantity rules | Below-MOQ rejected; at-MOQ accepted; qty 10 at the floor accepted; qty 10 below the floor rejected |
| 13 | Suggested retail pricing remains distinct from reseller pricing | Public 5,000,789; wholesale 3,000,123; floor 4,000,456; resale 4,000,456; offer with wholesale below floor is valid |
| 14 | Zero, negative, malformed, fractional-kobo and excessively large values are handled safely | 0 → 422; −1 → 422; string → 422; `.25` fraction → 422; `100_000_000_001` → 422; `MAX_SAFE_INTEGER` → 422 |
| 15 | All comparisons use integer kobo and cannot be bypassed through floating-point conversion | Representable fractions rejected; sub-ULP input stores exactly the integer minimum; integer totals |
| 16 | Existing marketplace search and listing functionality remains intact | Search finds the new listing; full existing discovery suite green |

### 7.2 Selected results

```text
PASS  a resale price below the seeded minimum is rejected (S-10) — status 400
PASS  the below-minimum rejection names the floor and creates no order (S-10)
      — Body Wave Wig 18in: resale price cannot be below the supplier's minimum of ₦45,000
PASS  an offer whose wholesale price is below the resale floor is valid (S-10)
      — wholesale 3000123, floor 4000456
PASS  an unapproved reseller cannot order even at a valid resale price (S-10) — status 403
PASS  supplier approval creates an agreement from the offer's floor (S-10) — status 200
PASS  approval copies wholesale, minimum resale and commission from the offer (S-10)
PASS  a resale price one kobo below the minimum is rejected (S-10) — status 400
PASS  a zero resale price is rejected (S-10) — status 422
PASS  a fractional-kobo resale price is rejected (S-10) — status 422
PASS  a float just below the minimum is rejected as non-integer kobo (S-10) — status 422
PASS  a bulk quantity cannot bypass the resale floor (S-10) — status 400
PASS  client-supplied minimum or wholesale values cannot lower the floor (S-10) — status 400
PASS  rejected resale prices create no partial order (S-10) — 0→0
PASS  a sub-ULP float cannot store a value below the integer minimum (S-10)
      — status 201, resale 4000456
PASS  a resale price exactly at the minimum is accepted (S-10) — status 201
PASS  the order stores the resale price separately from the wholesale price (S-10)
      — resale 4000456, unit 3000123, total 6000246
PASS  the floor applies to the resale price, not the lower wholesale price (S-10)
PASS  commission stays informational and is not added to the order total (S-10)
PASS  the stored resale price is checked against the agreement version it records (S-10)
PASS  a bulk quantity at the floor is accepted and totals the wholesale price (S-10)
PASS  no update route can lower a stored resale price (S-10) — patch 200, resale 4000456
PASS  an offer update does not retroactively change an accepted agreement (S-10)
PASS  the new floor is locked until the reseller accepts (S-10) — status 403
PASS  the updated minimum is enforced after acceptance (S-10) — status 400
PASS  pausing an offer closes the private price (S-10) — pause 200, price 403
PASS  reactivating an offer cannot bypass the floor (S-10)
PASS  the floor is still enforced after reactivation (S-10) — status 400
PASS  the approved reseller still sees the private price after the update (S-10)
```

### 7.3 Baseline vs final

| Metric | Baseline (unmodified app) | Final |
|---|---|---|
| S-10 failures | 10 (8 substantive + 2 float calibration) | 0 |
| Original ₦10-vs-₦450 order | 201 Created | 400 rejected |
| One kobo below the floor | 201 Created | 400 rejected |
| Zero resale price | 201 Created | 422 rejected |
| Bulk quantity below the floor | 201 Created | 400 rejected |
| Injected `minResalePriceKobo: 0` | 201 Created | 400 rejected |
| Orders created by rejected requests | 6 | 0 |
| Updated floor after acceptance | 201 Created | 400 rejected |
| At-minimum / above-minimum | 201 | 201 |
| Omitted resale price | 201 | 201 (preserved) |
| MOQ below minimum | 400 | 400 (unchanged) |
| Public/private price boundary | green | green |

---

## 8. Full E2E, typecheck, build and Prisma validation

| Check | Command | Result |
|---|---|---|
| Full isolated harness (final, fresh build) | `npm run test:e2e:clean` | **exit 0, 397 PASS, 0 FAIL, 119.4 s** |
| API suite | inside the harness | **366 / 366 pass** |
| Standalone PWA suite | inside the harness | **31 / 31 pass** |
| S-10 assertions | inside the API suite | **55 / 55 pass** |
| TypeScript | `npm run typecheck` | **exit 0** |
| Production build | `npm run build` | **exit 0** |
| Prisma schema | `npx prisma validate` | **valid** |
| Harness isolation | canary workspace + `/proc` `DATABASE_URL` check | both passed |
| Harness port | own free port `38769` (final run) | released |
| Existing servers | ports `3000`, `4317`, `4322` | not stopped or restarted |

```text
[harness] running the API suite against the temp database
ALL CHECKS PASSED
[harness] running the PWA suite against the temp database
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 119.4s (isolated DB, api=0, pwa=0)
```

### 8.1 Existing findings remain green

| Finding | Tagged PASS lines |
|---|---|
| S-01 | 6 |
| S-02 | 4 |
| S-03 | 11 |
| S-04 | 11 |
| S-05 | 46 |
| S-06 | 3 |
| S-07 | 27 |
| S-08 | 8 |
| S-10 | 55 |
| S-13 | 18 |
| S-15 | 21 |

No `FAIL` line appears in the final harness log. The full existing marketplace discovery, private-price, order, lifecycle, dispute, billing and admin checks passed unchanged.

---

## 9. Files changed

| File | Change |
|---|---|
| `src/server/supplier.ts` | Imported `formatMoney`; added `assertResalePriceAtOrAboveMinimum()`; called it in `createSupplierOrder()` after the MOQ check and before any order row is created. No other service behaviour changed. |
| `src/lib/validation.ts` | `supplierOrderCreateSchema` now requires a supplied `resalePriceKobo` to be a positive integer (`kobo.positive(...)`), rejecting zero at 422. |
| `scripts/verify-api.mjs` | Added 55 S-10 assertions covering all 16 required scenarios, including the original reproduction, integer/float boundaries, MOQ, offer/approval/activation paths, public/private boundaries and update resistance. |
| `STAGE2_TASK6B_S10_REPORT.md` | This report. |

**Not changed:** `prisma/schema.prisma`, migrations, `prisma/dev.db`, `prisma/seed.ts`, `scripts/seed-pilot.mjs`, `src/server/price-access.ts`, `publicListingSelect`, billing, entitlements, C-03, payment processing, roles, approval semantics, commission semantics, marketplace UI, `scripts/test-e2e-clean.mjs`, `scripts/deploy.sh`, `Dockerfile`, `docker-compose.yml`.

No schema or migration change was necessary. `minResalePriceKobo` already existed on offer and agreement versions; the fix applies the existing value.

---

## 10. Database fingerprint comparison

| Evidence | Value |
|---|---|
| `sha256sum prisma/dev.db` before and after | `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` against `prisma/dev.db` | **not run** |
| Test target | a fresh `mkdtemp` SQLite file under `/tmp`, removed by the harness |
| Shared development database writes | none |
| Schema/migration change | none |

The harness's S-15 checks exercise `db:reset` only against disposable databases; they passed and did not touch `prisma/dev.db`.

---

## 11. Remaining limitations

1. **The resale price is optional.** If the reseller omits it, no resale price is recorded and there is nothing to compare with the floor. This preserves the existing schema and UI behaviour. Making it mandatory would be a product decision and could break existing clients.
2. **There is no resale-price update route.** The current status PATCH ignores the field, so a stored resale price cannot be lowered today. If an update route is added, it must call `assertResalePriceAtOrAboveMinimum()` against the order's recorded agreement version; otherwise the floor could be bypassed after creation.
3. **Offer and agreement versions do not carry a resale price.** They carry the floor. The tests verify that every creation/update/approval/activation path preserves the floor and that the order check still applies. If a future feature adds a resale price to an offer, it must enforce the floor there too.
4. **The runtime API does not enforce the pilot seeder's extra supplier-side invariants.** `seed-pilot.mjs` rejects a minimum below the wholesale price and a minimum above the public retail price. The API accepts those combinations. That is a separate data-quality decision; enforcing it here would be a new business rule, not the S-10 resale-floor rule. The suite explicitly accepts the normal case where wholesale is below the floor.
5. **Commission remains informational.** No code computes commission, and the order total does not include it. If commission is later computed, the owner must decide whether the floor applies before or after commission. The current fix does not need that decision.
6. **The reseller's workspace customer-order price is not checked.** A workspace order line has `unitPriceKobo` (the price the reseller charges its customer), but there is no modeled link from that line to a supplier offer or its minimum. The enforced field is the supplier-order `resalePriceKobo`, which is the field the original finding and the marketplace UI use. Linking workspace order lines to supplier terms would require new modeling and was out of scope.
7. **Concurrent termination or pause is not re-checked between price resolution and order insert.** The order records the agreement version it used, so the stored line is internally consistent with the version whose floor was checked. A stricter "the agreement must still be active at insert" guarantee is a separate concurrency decision.
8. **Error status choice.** Business-rule rejections (floor and MOQ) return **400**; schema violations return **422**. The Stage 1 recommendation mentioned 422 for a below-minimum resale. This implementation chose consistency with the existing MOQ 400 in the same service. Both are 4xx rejections; clients should not depend on a specific code.
9. **Phase 0 remains incomplete.** S-09, S-11, S-12 and S-14 remain open. This report does not claim that validation passed or that SellFlow is pilot-safe.

---

**S-10 complete. Stopping for review; no other security task was started.**
