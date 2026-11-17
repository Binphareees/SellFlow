# SellFlow — Stage 2, Task 6C: S-11 (Stock Integrity) Report

**Date:** 2026-11-05
**Scope:** S-11 only. S-09, S-12 and S-14 were not started. No billing, entitlement, C-03, payment-processing, role, approval, commission or pricing-semantics change. No warehouse or multi-location feature was added. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

> **Status:** Supplier stock confirmation now validates every requested quantity server-side, deducts the authoritative listing pool atomically, adjusts by the delta on re-confirmation, and restores exactly once on decline or cancellation. Workspace customer orders reserve their own `Product.stockQty` atomically, reject insufficient stock instead of partially reserving, and restore only what they reserved on cancellation. Two concurrent confirmations can no longer consume the same units. The full isolated suite passes: **454 PASS, 0 FAIL**, including **57/57 S-11 checks**; typecheck, production build and Prisma validation pass. `prisma/dev.db` is byte-identical.

---

## 1. Original defect and root cause

The 2026-11-04 audit recorded two related gaps:

- **N-07 / Stock confirmation:** the supplier endpoint recorded `stockConfirmedQty` but never validated it against the ordered quantity or available stock, and never moved any inventory.
- **N-08 / Cancellation restoration:** customer-order creation decremented `Product.stockQty`, but cancelling the order never put it back.

The relevant pre-fix code did exactly this:

```ts
// confirmStock() — before
const order = await requireSupplierOrder(supplierProfileId, orderId);
await prisma.$transaction(async (tx) => {
  for (const item of input.items) {
    const belongs = order.items.some((o) => o.id === item.itemId);
    if (!belongs) throw badRequest("One of the items is not part of this order");
    await tx.supplierOrderItem.update({
      where: { id: item.itemId },
      data: { stockConfirmedQty: item.confirmedQty, note: input.note ?? null },
    });
  }
  await tx.supplierOrder.update({ where: { id: orderId }, data: { status: nextStatus, ... } });
});
```

```ts
// createOrder() — before: a partial, capped reservation
for (const line of lines) {
  if (!line.productId) continue;
  const product = productById.get(line.productId)!;
  if (product.stockQty <= 0) continue;
  await tx.product.update({
    where: { id: product.id },
    data: { stockQty: { decrement: Math.min(product.stockQty, line.qty) } },
  });
}
```

`updateOrderStatus()` then changed `status` with no stock work at all.

Reproduced on the unmodified application in the isolated harness:

| Reproduction | Pre-fix result |
|---|---|
| Order 5 units, confirm 6 | **200**, order `STOCK_CONFIRMED`, `stockConfirmedQty = 6` |
| Order 5 units, confirm 0 | **200**, order confirmed with zero |
| Order 150 units against 100 available, confirm 150 | **200**, confirmed |
| Confirm 5 units on a listing with 100 stock | listing stock stayed **100** |
| Cancel a confirmed order | stock stayed at the deducted value |
| Decline after confirming | stock was never restored |
| Two concurrent 60-unit confirmations against 100 | **both 200**, both confirmed |
| Workspace order for 5 units against 3 available | **201**, stock forced to 0, order created |
| Multi-line workspace order where line 2 exceeds stock | **201**, line 1 partially reserved |

**Root cause:** stock was treated as a display/reporting field. Supplier confirmation wrote a number without consulting the ordered quantity or the pool, and no write path recorded *what had been deducted*, so no cancellation path could know what to restore. Workspace creation reserved a capped amount without a transaction-wide availability check, so it could silently oversell and could not roll back a multi-line failure.

**What this was not:** the defect was not in listing discovery or the private-price boundary. `listPublicListings()` already filtered on `ProductListing.stockQty`, and the in-stock filter was already correct. The problem was that order fulfilment never changed the value that discovery read.

---

## 2. Inventory ownership model

SellFlow has three stock-shaped fields. They are **not** the same inventory, and this task did not merge them.

| Field | Owner | Meaning | Mutated by | Read by |
|---|---|---|---|---|
| `Product.stockQty` | Business workspace (reseller) | The workspace's own catalogue stock | Workspace product create/update; workspace customer orders reserve/release | Workspace dashboard and order builder |
| `ProductListing.stockQty` | Supplier profile | The supplier's advertised availability for a listing — the **authoritative supplier pool** | Supplier listing create; supplier order confirmation deducts; decline/cancel restores | Public marketplace, in-stock/out-of-stock filters, supplier dashboard |
| `ResellerOfferVersion.stockQty` | Supplier, per terms version | An **append-only snapshot** of the availability recorded in the private terms version | Offer version creation only | Private terms view (`price-access.ts`) |

The decisive evidence for treating `ProductListing.stockQty` as the supplier pool:

- `listPublicListings()` and `countPublicListings()` filter with `stockQty: { gt: 0 }` / `{ lte: 0 }` on `ProductListing`, and the marketplace cards and listing page render `listing.stockQty`.
- `ResellerOfferVersion` rows are immutable by design: `addOfferVersion()` appends a new version and repoints `currentVersionId`. Mutating an old version's stock would rewrite accepted history.
- `Product.stockQty` belongs to a different tenant entirely (the reseller workspace). A supplier confirmation must never touch it.

Consequences recorded deliberately:

- Confirming a supplier order moves `ProductListing.stockQty` only.
- The offer-version snapshot stays at its recorded value. The test asserts it remains **100** after a confirmation deducted the listing to 95.
- A workspace customer order moves `Product.stockQty` only. Supplier orders never touch it, and workspace orders never touch a listing.
- These two pools are independent even when a workspace product and a marketplace listing happen to describe the same physical item. Linking them would require a new cross-tenant model and is out of scope.

### 2.1 Complete mutation map

| Path | Field | Direction | Guard |
|---|---|---|---|
| `createListing()` | `ProductListing.stockQty` | Supplier sets initial availability | zod `int 0..1_000_000` |
| `createProduct()` / `updateProduct()` | `Product.stockQty` | Workspace sets its own stock | zod `int 0..1_000_000` |
| `addOfferVersion()` | `ResellerOfferVersion.stockQty` | Snapshot only | zod `int 0..1_000_000` |
| `confirmStock()` | `ProductListing.stockQty` | `-delta` on confirm, `+(-delta)` on reduction | conditional `updateMany`, positive-integer validation, order ownership |
| `confirmStock()` (DECLINED) | `ProductListing.stockQty` | Restores prior `stockDeductedQty` | same transaction, per-line marker |
| `setSupplierOrderStatus()` (`CANCELLED`) | `ProductListing.stockQty` | Restores `stockDeductedQty` | status-edge guard + optimistic claim |
| `createOrder()` | `Product.stockQty` | `-qty` per product, aggregated | conditional `updateMany`, all-or-nothing |
| `updateOrderStatus()` (`CANCELLED`) | `Product.stockQty` | Restores `stockDeductedQty` | status claim + per-line marker |

There is no product-delete or listing-delete route in the current API. If one is added, it must decide what happens to outstanding reservations; today a missing listing/product makes the restoration fail loudly with a conflict rather than silently skipping it.

---

## 3. Implemented rules

### 3.1 Supplier confirmation — `confirmStock()`

All checks and writes run inside one interactive transaction.

1. **Ownership:** the order is loaded with `where: { id: orderId, supplierProfileId }`. A foreign supplier gets 404 and cannot move stock.
2. **State:** only `SUBMITTED` or `STOCK_CONFIRMED` may be confirmed. `STOCK_DECLINED`, `CANCELLED`, `AWAITING_PAYMENT`, `PAID`, `DISPATCHED`, `DELIVERED`, `COMPLETED` and `DISPUTED` are rejected with 409.
3. **Line membership:** every `itemId` must belong to this order; duplicates in one request are rejected with 400.
4. **Completeness:** for `CONFIRMED`/`PARTIAL`, every line must be answered. An omitted line is not an implicit zero.
5. **Quantity validation:** each confirmed quantity must be a safe integer `> 0` and `<= ordered qty`. Zero, negative, fractional, non-numeric and over-ordered values are rejected before any write.
6. **Availability:** the net delta per listing must be obtainable from the live pool. If it is not, the transaction aborts with 409 and nothing is written.
7. **Deduction:** `ProductListing.stockQty` is decremented by the positive delta with a conditional `updateMany` (`stockQty >= delta`). If the same listing appears on multiple lines, deltas are aggregated first and checked against one pool.
8. **Adjustment:** if the supplier re-confirms a smaller quantity, the negative delta increments the pool back. Repeating the same confirmation produces delta `0` and moves nothing.
9. **Evidence:** `stockConfirmedQty` and `stockDeductedQty` are written per line; `stockStatus` becomes `CONFIRMED`, `PARTIAL` or `DECLINED`; `stockConfirmedAt`, `stockConfirmedByProfileId` and the note are recorded.
10. **Optimistic claim:** the order row is updated with `where: { id, supplierProfileId, status, stockConfirmedAt }`. Two requests that read the same decision cannot both succeed; the loser gets 409.

`stockStatus` is derived from the quantities, not taken on trust from the client: `DECLINED` for a decline, `PARTIAL` if any line is below its ordered quantity, otherwise `CONFIRMED`. The order status becomes `STOCK_DECLINED` or `STOCK_CONFIRMED` respectively.

### 3.2 Decline

`DECLINED` sets every line's `stockConfirmedQty` and `stockDeductedQty` to `0` and returns the previously deducted quantity to the listing. It therefore works both as a first response (nothing to restore) and as a reversal of an earlier confirmation (restores the exact prior amount). A repeated decline is rejected by the `stockConfirmedAt` claim with 409 and moves no stock. Declining also sets `stockRestoredAt` as a release marker.

### 3.3 Supplier cancellation

`setSupplierOrderStatus()` only permits the existing S-04 edges:

```ts
const SUPPLIER_STATUS_EDGES = {
  SUBMITTED: ["CANCELLED"],
  STOCK_DECLINED: ["CANCELLED"],
  STOCK_CONFIRMED: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["CANCELLED"],
  DELIVERED: ["COMPLETED"],
};
```

Cancellation claims the transition with `updateMany({ where: { id, supplierProfileId, status: <predecessor> } })`. Only the winner proceeds. It then restores each line's `stockDeductedQty` to its listing and clears the marker. A declined order has `stockDeductedQty = 0`, so cancelling it restores nothing. A second cancellation is rejected by the edge map (409) and cannot restore twice. All other S-04 edges, including the `COMPLETED` shortcut rejection, are unchanged.

### 3.4 Workspace order creation — `createOrder()`

- Catalogue lines reserve `qty`; ad-hoc lines (`productId` absent) reserve nothing.
- Quantities for the same product are aggregated across lines before checking, so two lines cannot each pass against the full pool.
- Each product is reserved with `updateMany({ where: { id, workspaceId, stockQty: { gte: required } }, data: { decrement } })`. A missing row or insufficient stock aborts the transaction with **409**, so **no order, payment, plan or promise row is created** and every earlier line is rolled back.
- `stockDeductedQty` is stored on each line, which is what makes exact restoration possible.
- The reservation runs before `customerOrder.create()`, inside the same transaction.
- A requested quantity of `0` is already rejected by `orderCreateSchema` at 422; the service never sees it.

This is a deliberate behaviour change: the pre-fix code partially reserved what was available and still created the order. That behaviour is precisely what allowed oversell, so it was replaced with all-or-nothing.

### 3.5 Workspace cancellation — `updateOrderStatus()`

- A second cancellation of an already-`CANCELLED` order returns the order with 200 and moves no stock (idempotent).
- Otherwise the cancellation is claimed with `updateMany({ where: { id, workspaceId, status: <predecessor>, deletedAt: null } })`, so two concurrent cancellations cannot both restore.
- Each line's `stockDeductedQty` is added back to its `Product.stockQty` (scoped by `workspaceId`) and cleared.
- `stockRestoredAt` is set on the order.
- Existing rules are preserved: a `DELIVERED` order can still only be cancelled; tenant scoping still comes from the session, not the body.

### 3.6 Validation matrix

| Input | Where rejected | Status |
|---|---|---|
| Supplier order qty `0`, negative, float, string | `supplierOrderCreateSchema` | 422 |
| Workspace order qty `0`, negative, float, string | `orderCreateSchema` | 422 |
| Confirmed qty negative / fractional / string | `stockDecisionSchema` | 422 |
| Confirmed qty `0` on `CONFIRMED`/`PARTIAL` | `confirmStock()` | 400 |
| Confirmed qty above ordered qty | `confirmStock()` | 400 |
| Confirmed qty above available listing stock | `confirmStock()` | 409 |
| Unknown / foreign / duplicate item id | `confirmStock()` | 400 |
| Omitted line on `CONFIRMED`/`PARTIAL` | `confirmStock()` | 400 |
| Confirmation on a cancelled/declined/later-state order | `confirmStock()` | 409 |
| Workspace order above available product stock | `createOrder()` | 409 |
| Stock fields supplied by the client | zod strips unknown keys; stock is read from the DB | — |

Client-supplied `stockQty` values are never read by either fulfilment path. The S-11 test sends `stockQty: 999_999` with a 150-unit supplier order and asserts the real pool is unchanged after rejection.

---

## 4. Schema / ledger decision and justification

A full stock-movement ledger (append-only rows for every debit/credit with a reason, actor and reference) would be the most complete design. It was **not** introduced here, for these reasons:

- The defect is exact-once release, not reporting. A ledger needs a reconciliation job, a migration of historical movements and UI to read it; that is a much larger product change than S-11.
- The existing schema already has the natural aggregate (`ProductListing.stockQty`, `Product.stockQty`). The missing information was *how much this order currently holds*, not *every movement ever*.
- A minimal, auditable reservation marker solves the integrity problem without inventing history.

The migration adds four fields:

| Model | Field | Purpose |
|---|---|---|
| `SupplierOrder` | `stockRestoredAt DateTime?` | Marks that the order's release path ran |
| `SupplierOrderItem` | `stockDeductedQty Int @default(0)` | Net units this line currently holds in `ProductListing.stockQty` |
| `CustomerOrder` | `stockRestoredAt DateTime?` | Marks that the workspace cancellation released reservations |
| `OrderItem` | `stockDeductedQty Int @default(0)` | Net units this line currently holds in `Product.stockQty` |

Migration: `prisma/migrations/20261105000000_stock_integrity/migration.sql`. It is additive only — four `ALTER TABLE ... ADD COLUMN` statements, no data rewrite, no table rebuild.

**No backfill was performed, deliberately.** Existing rows receive `0`, which means "this order holds no tracked reservation". The pre-fix supplier path never deducted, so a non-zero backfill would invent deductions. The pre-fix workspace path deducted a capped amount but did not record it per line, so an exact backfill is impossible without guessing. Historical orders therefore keep today's balances and are not retroactively restored. This is a documented limitation, not a silent repair of existing discrepancies.

---

## 5. Transaction and concurrency strategy

Both services use Prisma interactive transactions plus atomic conditional writes:

- **Conditional decrement** — `updateMany({ where: { id, stockQty: { gte: delta } }, data: { decrement: delta } })`. The `count !== 1` check distinguishes "not enough stock" (row exists, predicate failed) from "listing disappeared". Concurrent requests cannot both pass the predicate.
- **Optimistic state claim** — supplier confirmations match on `status` **and** `stockConfirmedAt`; cancellations match on the predecessor `status`. The loser receives 409 and its transaction rolls back, so its stock movement never happens.
- **Aggregation before checks** — multi-line orders and multi-line confirmations aggregate per listing/product first, so separate lines cannot each consume the same pool.
- **All-or-nothing** — any failure throws inside the transaction, so no order row, line marker, listing decrement or workspace product decrement survives a partial attempt.
- **Tenant scoping inside the predicate** — supplier writes include `supplierProfileId`; workspace writes include `workspaceId`. Authorisation is not re-derived from client input.
- **Transient-lock retry only** — `withStockTransaction()` retries up to 3 times with a short backoff for `P2034`, `SQLITE_BUSY` and "database is locked". It rethrows every business conflict immediately, so a genuine 409 is never turned into a retry storm. A failed attempt rolled back, so retrying is safe.
- **SQLite reality** — writers are serialised. The conditional updates are still required because a stale read can pass a pre-check; the database predicate is the real guard.

The race test places two 60-unit orders against a 100-unit pool and fires both confirmations with `Promise.all`. Final result: exactly one **200** and one **409**, final stock **40**, winner `STOCK_CONFIRMED`, loser `SUBMITTED`.

---

## 6. Failing baseline (recorded before implementation)

The S-11 block was added to `scripts/verify-api.mjs` first and run against the **unmodified application** through the isolated harness:

```text
npm run test:e2e:clean -- --skip-build
```

Result: **exit 1, 394 PASS, 29 FAIL — all 29 failures S-11**. The API stage failed, so the standalone PWA stage did not run. `prisma/dev.db` was untouched.

```text
FAIL  S-11 confirmed quantity above the ordered quantity is rejected — status 200
FAIL  S-11 over-confirmation leaves the order unconfirmed — status STOCK_CONFIRMED, confirmed 6
FAIL  S-11 zero confirmed quantity is rejected for a confirmation — status 200
FAIL  S-11 duplicate item entries in one confirmation are rejected — status 200
FAIL  S-11 malformed confirmations leave stock and order unchanged — stock 100
FAIL  S-11 confirmation reduces the authoritative listing stock — status 200, stock 100
FAIL  S-11 the deducted quantity is tracked on the order line — deducted undefined
FAIL  S-11 cancellation clears the per-line deduction — deducted undefined
FAIL  S-11 cancellation records that stock was restored — restoredAt undefined
FAIL  S-11 partial confirmation deducts only the confirmed quantity — status 200, stock 100, stockStatus PARTIAL
FAIL  S-11 re-confirmation adjusts the deduction by the delta — status 200, stock 100
FAIL  S-11 repeating the same confirmation is idempotent — status 200, stock 100
FAIL  S-11 decline setup deducts stock — status 200, stock 100
FAIL  S-11 declining restores stock deducted by an earlier confirmation — status 200, stock 100
FAIL  S-11 confirmed quantity above available stock is rejected — status 200
FAIL  S-11 a rejected over-availability leaves the order unconfirmed — status STOCK_CONFIRMED
FAIL  S-11 a failing multi-line confirmation rolls back every line — status 200, stock 100
FAIL  S-11 a rolled-back confirmation leaves order and evidence untouched — status STOCK_CONFIRMED
FAIL  S-11 two concurrent confirmations cannot both consume the same stock — statuses 200,200
FAIL  S-11 concurrent oversell never drives stock below zero — stock 100
FAIL  S-11 only the winning concurrent confirmation changes its order — winner STOCK_CONFIRMED, loser STOCK_CONFIRMED
FAIL  S-11 existing S-04 transition edges remain intact — confirm 200, awaiting 200, jump 409, cancel 200
FAIL  S-11 the workspace reservation is tracked on the order line — deducted undefined
FAIL  S-11 workspace cancellation restores reserved stock — status 200, stock 6
FAIL  S-11 workspace cancellation clears the per-line reservation — deducted undefined
FAIL  S-11 workspace cancellation records that stock was restored — restoredAt undefined
FAIL  S-11 repeated workspace cancellation cannot restore stock twice — status 200, stock 6
FAIL  S-11 a workspace order cannot reserve more than is available — status 201, stock 0
FAIL  S-11 a failed workspace reservation rolls back every line — status 201, E 3, F 0
```

The first three failures reproduce the original finding directly. The concurrency pair is the most serious: both confirmations returned **200** on the unmodified app.

---

## 7. Regression coverage — 57 S-11 checks

The block creates a fresh probe listing (100 units) with an offer, registers and approves a probe reseller, accepts the agreement, and then exercises both inventory pools. It also uses the seeded listing to prove no cross-listing movement.

| Required scenario | Covered by |
|---|---|
| Confirm deduction | listing 100 → 95; `stockDeductedQty = 5`; order `STOCK_CONFIRMED` |
| Over-confirm | 6 confirmed against 5 ordered → 400, stock 100, order `SUBMITTED` |
| Over-available | 150 confirmed against 100 → 409, stock 100, order `SUBMITTED`, client stock ignored |
| Invalid quantities | zero → 400; negative/fractional/non-numeric → 422; missing item id → 422; unknown item → 400; duplicate item → 400; requested qty 0 at order creation → 422 |
| Cancel / decline restoration | decline after confirm restores 100; supplier cancel restores 100; partial cancel restores only 4/6; declined order cancel restores nothing |
| Idempotent restoration | repeat decline → 409, stock 100; repeat supplier cancel → 409, stock 100; repeat workspace cancel → 200, stock 10 |
| Workspace cancellation | 10 → 6 on order, → 10 on cancel; marker cleared; `stockRestoredAt` set |
| Concurrent oversell | two 60-unit confirms against 100 → 200 + 409, stock 40; only winner confirmed; cancelling winner → 100 |
| Partial confirmation | 10 ordered, 4 confirmed → 96; 6 confirmed → 94 (delta adjustment); repeat 6 → 94 (idempotent); cancel → 100 |
| Rollback | multi-line 2 + 150 → 409, stock 100, all confirmed quantities null, first line marker 0; workspace 2 + 3 against 5/1 → 409, E 5, F 1, no order |
| S-04 transitions | confirm → `AWAITING_PAYMENT` 200 → `COMPLETED` 409 → cancel 200; stock 97 then 100; cancelled order cannot confirm (409) |
| Tenant isolation | foreign supplier confirm → 404, stock and order unchanged; another supplier's listing unchanged (18 → 18); unrelated workspace products unchanged (B 7, C 3) |
| Offer snapshot integrity | `ResellerOfferVersion.stockQty` stays 100 after listing deduction |
| Workspace ownership | workspace order reserves only `Product.stockQty`; unrelated products and another tenant's product untouched |

Two further checks are setup assertions (probe listing/offer created; probe reseller approved). **55 scenario assertions + 2 setup = 57.**

### 7.1 Baseline vs final

| Metric | Baseline | Final |
|---|---|---|
| S-11 checks passing | 28 / 57 | **57 / 57** |
| S-11 failures | **29** | **0** |
| Whole suite | 394 PASS / 29 FAIL (stopped before PWA) | **454 PASS / 0 FAIL** |
| Over-confirm | 200 | **400** |
| Zero confirm | 200 | **400** |
| Listing deduction | none (100) | **95** |
| Concurrent confirmations | both 200 | **200 + 409** |
| Workspace oversell | 201, stock forced to 0 | **409, stock 3** |
| Workspace cancel restoration | none (6) | **10** |

---

## 8. Full E2E, typecheck, build and Prisma validation

Final isolated run (`npm run test:e2e:clean -- --skip-build`, reusing the production build made by the preceding full harness run):

```text
[harness] running the API suite against the temp database
first block: 423 PASS, 0 FAIL   (392 API + 31 in-process PWA checks)
[harness] running the PWA suite against the temp database
standalone PWA: 31 PASS, 0 FAIL
combined: 454 PASS, 0 FAIL
S-11: 57 PASS, 0 FAIL
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 63.1s (isolated DB, api=0, pwa=0)
```

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0, no output |
| Production build inside the harness | succeeded |
| `npx prisma validate` | “The schema at prisma/schema.prisma is valid” |
| `npx prisma migrate deploy` on a disposable `/tmp/opencode` DB | all 5 migrations applied |
| `npx prisma migrate status` on that DB | “Database schema is up to date!” |
| `npx prisma migrate diff --from-url … --to-schema-datamodel …` | “No difference detected.” (exit 0) |

Prior suites remain green in the same run: S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-08, S-10, S-13 and S-15 all passed unchanged, as did marketplace discovery, private pricing, billing, admin and PWA checks.

No existing server was stopped or restarted. The pre-existing listeners remained: `:3000` pid 2802, `:4317` pid 931570, `:4322` pid 927563. The harness used its own ephemeral port and released it.

---

## 9. Files changed

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `SupplierOrder.stockRestoredAt`, `SupplierOrderItem.stockDeductedQty`, `CustomerOrder.stockRestoredAt`, `OrderItem.stockDeductedQty`. No relation, enum or other model change. |
| `prisma/migrations/20261105000000_stock_integrity/migration.sql` | Additive migration for the four fields; existing rows default to `0`; no backfill. |
| `src/server/supplier.ts` | Rewrote `confirmStock()` with ownership/state/line/quantity/availability validation, atomic listing deduction and delta adjustment, optimistic claim, and per-line tracking. Rewrote `setSupplierOrderStatus()` to claim transitions atomically and restore reservations exactly once on cancellation. Added the transient-lock retry helper. S-04 edge map unchanged. |
| `src/server/workspace.ts` | `createOrder()` now reserves `Product.stockQty` atomically before creating the order and rejects insufficient stock with 409 instead of partially reserving. `updateOrderStatus()` restores per-line reservations exactly once on cancellation and is idempotent. Added the same retry helper. |
| `scripts/verify-api.mjs` | Added the 57-check S-11 block (including 2 setup assertions) covering all required scenarios; one S-04 assertion captures intermediate stock before the later cancellation. |
| `STAGE2_TASK6C_S11_REPORT.md` | This report. |

**Not changed:** billing, entitlements, C-03, payment processing, pricing semantics, commission semantics, roles, approval flow, marketplace UI, `src/server/price-access.ts`, `src/lib/validation.ts` schemas (the existing `stockDecisionSchema` already allowed `0` for declines), `prisma/seed.ts`, `scripts/seed-pilot.mjs`, `scripts/test-e2e-clean.mjs`, `scripts/deploy.sh`, `Dockerfile`, `docker-compose.yml`, `prisma/dev.db`.

All changes remain uncommitted. `prisma/`, `scripts/` and `src/` are untracked in this repository snapshot.

---

## 10. Database fingerprint comparison

| Evidence | Value |
|---|---|
| `sha256sum prisma/dev.db` before and after | `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` against `prisma/dev.db` | **not run** |
| Test target | a fresh `mkdtemp` SQLite file under `/tmp/opencode`, removed by the harness |
| Shared development database writes | none |
| Existing servers | untouched |

---

## 11. Remaining limitations

1. **`prisma/dev.db` was deliberately not migrated.** Its fingerprint is unchanged, so it does not contain the four new columns. Before the development app is run against that file, `npx prisma migrate deploy` (or `npx prisma migrate dev`) must be applied. The isolated harness applies migrations to its own fresh database, which is why the suite passes. This task was explicitly forbidden from resetting or writing `prisma/dev.db`, so the migration was verified only on a disposable database.
2. **No historical backfill.** Existing `OrderItem` and `SupplierOrderItem` rows have `stockDeductedQty = 0`. Pre-existing workspace orders will not restore stock when cancelled, and pre-existing supplier orders did not deduct anything. Backfilling would invent reservations; the existing discrepancies are left visible rather than silently repaired.
3. **Offer-version stock is not the pool and is not synchronised with it.** `ResellerOfferVersion.stockQty` remains an append-only snapshot. A supplier who appends a new offer version with a different `stockQty` does not change `ProductListing.stockQty`, and therefore does not change public availability. This is an existing modelling gap, not introduced here. The authoritative value is the listing; if the product wants offer-level availability, that is a separate design decision.
4. **Pending supplier orders do not reserve stock.** A supplier order is a request until the supplier confirms it. Two resellers can place orders for the same units; the first confirmation wins and the second receives 409. This matches the existing "confirm before paying" workflow. A soft reservation at order creation would be a product change.
5. **No full stock-movement ledger.** The system records the net reservation per line, the release timestamps and the existing audit events, but not every debit/credit as an append-only journal. Reconciliation and reporting are therefore limited to current balances plus order evidence.
6. **Deletion semantics are undefined for outstanding reservations.** There is no product- or listing-delete route today. If one is added, it must release or block outstanding reservations; the current restoration would fail loudly (409) rather than silently skip a missing row.
7. **SQLite concurrency is serialised.** The conditional updates and optimistic claims are correct under SQLite and remain correct under a server database, but the retry helper is tuned for SQLite lock contention (`P2034`, `SQLITE_BUSY`). A different database may need its own transient-error classification.
8. **Error status choices.** Business-rule rejections are **400** (bad quantity, over-ordered, duplicate/unknown line) or **409** (insufficient stock, wrong state, concurrent change); schema violations are **422**. Clients should treat all 4xx as rejections rather than depend on a specific code.
9. **Phase 0 remains incomplete.** S-09, S-12 and S-14 remain open. This report does not claim that validation passed or that SellFlow is pilot-safe.

---

**S-11 complete. Stopping for review; no other security task was started.**
