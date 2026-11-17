# SellFlow — Stage 2, Task 2C: S-04 (Order Status Transition Authorization) Report

**Date:** 2026-11-04
**Authorization:** Implementation GO, D-019 (2026-11-04). Phase 0 validation remains incomplete; this report does not claim the platform is pilot-safe.
**Scope:** S-04 only. S-02 and every other finding are untouched. No schema, migration, seed, dependency, billing or entitlement change.

---

## 1. Root cause and affected files

| File | Symbol | Role in the defect |
|---|---|---|
| `src/server/supplier.ts` | `setSupplierOrderStatus()` (now ~line 990) | Took `status: string` and wrote it straight to `SupplierOrder.status` with no comparison against the current status. Timestamps (`completedAt`, `cancelledAt`) were the only side effects. |
| `src/app/api/supplier/orders/[id]/route.ts` | `PATCH` | `requireSupplier()` (supplier role + profile) then `readBody(supplierOrderStatusSchema)`, which only checks membership of `SUPPLIER_ORDER_STATUS`. Passes the value to the service. |
| `src/lib/validation.ts` | `supplierOrderStatusSchema` | `status: z.enum(SUPPLIER_ORDER_STATUS)` — a type guard, not a transition guard. Accepts all ten statuses from any state. |
| `src/lib/enums.ts` | `SUPPLIER_ORDER_STATUS` | Ten values: `SUBMITTED`, `STOCK_CONFIRMED`, `STOCK_DECLINED`, `AWAITING_PAYMENT`, `PAID`, `DISPATCHED`, `DELIVERED`, `COMPLETED`, `CANCELLED`, `DISPUTED`. |
| `src/server/supplier.ts` | `confirmStock`, `decidePaymentClaim`, `dispatchOrder`, `confirmDelivery` | These already enforce the intended one-party-per-step rules and write the evidence rows. The generic PATCH let a caller reach their end states without them. |

**Root cause.** Status was treated as an assignable field rather than the output of a step. Nothing compared `order.status` with the requested `status`, so a supplier could move `AWAITING_PAYMENT → COMPLETED` (or `SUBMITTED → DELIVERED`, `→ PAID`, `→ DISPATCHED`) in one request, skipping stock confirmation, payment claims, dispatch and the reseller's delivery confirmation. Because the route already required the supplier role and scoped the order to `auth.supplierProfileId`, this was a *state-machine* defect rather than a cross-tenant one: the right actor performing the wrong step.

---

## 2. Existing lifecycle and actor transition map

Derived from the implemented services, the schema, README ("Only the supplier confirms stock, dispatches and records terms. Only the reseller confirms delivery received") and PRD items SO-04/SO-05/SO-06. No new states were introduced.

| Current status | Legitimate next status | Owner | Path that must be used |
|---|---|---|---|
| `SUBMITTED` | `STOCK_CONFIRMED`, `STOCK_DECLINED` | Supplier | `POST .../stock` (`confirmStock`) |
| `SUBMITTED` / `STOCK_DECLINED` / `STOCK_CONFIRMED` / `AWAITING_PAYMENT` | `CANCELLED` | Supplier | `PATCH .../orders/[id]` (only route that records `cancelledAt`/`cancellationReason`) |
| `STOCK_CONFIRMED` | `AWAITING_PAYMENT` | Supplier | `PATCH .../orders/[id]` |
| `AWAITING_PAYMENT` | `PAID` | Supplier, via the counterparty's decision | `POST .../claims/[claimId]` → `decidePaymentClaim` when confirmed total covers the order |
| `STOCK_CONFIRMED` / `AWAITING_PAYMENT` / `PAID` | `DISPATCHED` | Supplier | `POST .../dispatch` (`dispatchOrder`), requires a `DispatchRecord` |
| `DISPATCHED` | `DELIVERED` or `DISPUTED` | Reseller | `POST .../delivery` (`confirmDelivery`), requires a `DeliveryConfirmation` |
| `DELIVERED` | `COMPLETED` | Supplier | `PATCH .../orders/[id]`, stamps `completedAt` |
| `COMPLETED`, `CANCELLED` | — | — | terminal |
| `DISPUTED` | — | — | resolved through the dispute workflow; no order-status PATCH |

**PATCH now allows exactly these edges** (`SUPPLIER_STATUS_EDGES`): `SUBMITTED → CANCELLED`, `STOCK_DECLINED → CANCELLED`, `STOCK_CONFIRMED → {AWAITING_PAYMENT, CANCELLED}`, `AWAITING_PAYMENT → CANCELLED`, `DELIVERED → COMPLETED`. Everything else is `409`.

**Ambiguities found and how they were resolved (without inventing rules):**

- **Who marks `COMPLETED`?** PRD SO-08 (full matrix) is a source gap. The existing PATCH is supplier-only and already stamps `completedAt`, and the pilot tracker has a "Completed on" column, so completion stays a supplier action — now gated on `DELIVERED`.
- **Cancellation rules** are also a SO-08 gap. Implemented behaviour is a supplier PATCH with a reason, so cancellation remains available while nothing has been dispatched (`SUBMITTED`, `STOCK_DECLINED`, `STOCK_CONFIRMED`, `AWAITING_PAYMENT`). `DISPATCHED`/`DELIVERED` cancellation would need a returns flow that does not exist.
- **`PAID` is never accepted from PATCH**, because payment is established by a confirmed claim, and `PAID → CANCELLED` is deliberately refused: with no refund/ledger model, cancelling a paid order would strand a confirmed payment. Flagged in §9 rather than invented.
- **`DISPUTED`** is written by claim disputes and failed delivery confirmations only.

---

## 3. Regression tests added

15 assertions in `scripts/verify-api.mjs`.

**Section “S-04: one actor-owned lifecycle step at a time”** (order in `AWAITING_PAYMENT`):

| # | Assertion | Expected |
|---|---|---|
| 1 | Reseller PATCHes the supplier order to `COMPLETED` | `403` |
| 2 | Unrelated account (no supplier profile) PATCHes it | `403`/`404` |
| 3–7 | Supplier PATCHes `COMPLETED`, `DELIVERED`, `DISPATCHED`, `PAID`, `STOCK_CONFIRMED` from `AWAITING_PAYMENT` | `409` each |
| 8 | Unknown status `"SHIPPED"` | `400`/`422` |
| 9 | After all rejections: status still `AWAITING_PAYMENT`, 0 claims, 0 dispatches, no delivery row | true |
| 10 | A second order is created for the cancellation path | `201` |
| 11 | Supplier cancels that order before dispatch | `200`, `CANCELLED` |
| 12 | Cancelled order PATCHed back to `AWAITING_PAYMENT` | `409` |

**After the delivery step** (existing flow reaches `DELIVERED`):

| # | Assertion | Expected |
|---|---|---|
| 13 | Supplier completes the delivered order | `200`, `COMPLETED`, `completedAt` set |
| 14 | Completing it again | `409` |
| 15 | Latest `supplier_order.status_changed` audit row has `from: DELIVERED`, `to: COMPLETED`, `actorRole: SUPPLIER` | true |

Assertion 15 reads the audit table with Prisma inside the isolated harness only (guarded on `DATABASE_URL` containing `sellflow-e2e-`; it prints `SKIP` otherwise, so a manual run against a dev server cannot silently pass or touch project data). Requirement 10 asked for from/to/actor evidence where the audit mechanism supports it; there is no audit-read API, so this is the only honest way to assert it.

---

## 4. Evidence of failures before the fix

`npm run test:e2e:clean -- --skip-build` against the **unmodified** application:

```
harness_exit=1
pass=170 fail=9

FAIL  a supplier cannot jump from AWAITING_PAYMENT to COMPLETED (S-04) — status 200
FAIL  a supplier cannot jump from AWAITING_PAYMENT to DELIVERED (S-04) — status 200
FAIL  a supplier cannot jump from AWAITING_PAYMENT to DISPATCHED (S-04) — status 200
FAIL  a supplier cannot jump from AWAITING_PAYMENT to PAID (S-04) — status 200
FAIL  a supplier cannot jump from AWAITING_PAYMENT to STOCK_CONFIRMED (S-04) — status 200
FAIL  rejected transitions leave the order and its records untouched (S-04) — status STOCK_CONFIRMED, claims 0, dispatches 0
FAIL  a cancelled order cannot be reopened (S-04) — status 200
FAIL  a completed order cannot transition again (S-04) — status 200
FAIL  the completion is audited with from, to and actor (S-04) — COMPLETED → COMPLETED, SUPPLIER
9 CHECK(S) FAILED
```

The audit failure is the clearest evidence of damage: because the order was re-completed from `COMPLETED`, the trail recorded `COMPLETED → COMPLETED` — the previous state was already a forgery. The API stage aborted the harness, so the 31 PWA checks did not run in this baseline (170 + 9 = 179 API assertions).

Assertions that already held and had to keep holding:

```
PASS  a reseller cannot patch a supplier order (S-04) — status 403
PASS  an unrelated account cannot patch another party's order (S-04) — status 403
PASS  supplier moves the order to awaiting payment — status 200
PASS  a supplier can still cancel before dispatch — status 200, order CANCELLED
```

---

## 5. Exact implementation

`src/server/supplier.ts`, immediately above `setSupplierOrderStatus`:

```ts
/**
 * The only changes the generic status PATCH may make (audit finding S-04).
 * Every other step has a dedicated, party-owned service that records evidence:
 * `confirmStock`, payment claims, `dispatchOrder`, `confirmDelivery`. Keeping
 * this map here means no route can skip those steps by writing a status.
 */
const SUPPLIER_STATUS_EDGES: Record<string, readonly string[]> = {
  SUBMITTED: ["CANCELLED"],
  STOCK_DECLINED: ["CANCELLED"],
  STOCK_CONFIRMED: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["CANCELLED"],
  DELIVERED: ["COMPLETED"],
};
```

Inside the function, before the write:

```ts
  const allowed = SUPPLIER_STATUS_EDGES[order.status] ?? [];
  if (!allowed.includes(status)) {
    throw conflict(
      `An order cannot move from ${order.status} to ${status}; use the stock, payment claim, dispatch or delivery step`,
    );
  }
```

The rest of the function (update, `completedAt`/`cancelledAt` stamps, `audit({ from, to, note })`) is unchanged.

Why this is the smallest safe fix:

- Enforced in the **service**, so the route, future callers and any admin tooling inherit it.
- Authorization is already resolved before it: `requireSupplier()` at the route, `requireSupplierOrder()` scopes by `auth.supplierProfileId`, so a foreign order is a `404` and a non-supplier a `403`.
- The check runs **before any write**, so rejected requests cannot leave a partial mutation (asserted: 0 claims, 0 dispatches, no delivery, unchanged status).
- The map only encodes edges the existing services already implement; no new state, no new route, no schema change.
- The existing PATCH use (`STOCK_CONFIRMED → AWAITING_PAYMENT`) still works, and cancellation keeps working pre-dispatch.

---

## 6. Evidence of passing tests after the fix

`npm run test:e2e:clean` (full: isolated DB + migrations + seed + production build + API + PWA):

```
harness_exit=0
pass=210 fail=0
[harness] isolation check 1 passed: canary workspace "HARNESS-MW1BG5UV" served from the temp database
[harness] isolation check 2 passed: pid 1106745 DATABASE_URL matches the temp file
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 122.0s (isolated DB, api=0, pwa=0)
```

S-04 assertions and preserved workflows:

```
PASS  a reseller cannot patch a supplier order (S-04) — status 403
PASS  an unrelated account cannot patch another party's order (S-04) — status 403
PASS  a supplier cannot jump from AWAITING_PAYMENT to COMPLETED (S-04) — status 409
PASS  a supplier cannot jump from AWAITING_PAYMENT to DELIVERED (S-04) — status 409
PASS  a supplier cannot jump from AWAITING_PAYMENT to DISPATCHED (S-04) — status 409
PASS  a supplier cannot jump from AWAITING_PAYMENT to PAID (S-04) — status 409
PASS  a supplier cannot jump from AWAITING_PAYMENT to STOCK_CONFIRMED (S-04) — status 409
PASS  an unknown order status is rejected — status 422
PASS  rejected transitions leave the order and its records untouched (S-04) — status AWAITING_PAYMENT, claims 0, dispatches 0
PASS  a second order is created for the cancellation path — status 201
PASS  a supplier can still cancel before dispatch — status 200, order CANCELLED
PASS  a cancelled order cannot be reopened (S-04) — status 409
PASS  a supplier completes only after delivery — status 200, order COMPLETED
PASS  a completed order cannot transition again (S-04) — status 409
PASS  the completion is audited with from, to and actor (S-04) — DELIVERED → COMPLETED, SUPPLIER
```

The full happy path (stock → awaiting payment → claim → `PAID` → dispatch → delivery → `COMPLETED`) still passes end to end, as do the 31 PWA checks.

---

## 7. Full API/PWA, typecheck and build results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | inside `test:e2e:clean` (shared `.next`) | **exit 0** |
| API suite | `scripts/verify-api.mjs` | **179 / 179** |
| PWA suite | `scripts/verify-pwa.mjs` | **31 / 31** |
| Combined | `npm run test:e2e:clean` | **PASSED**, 122.0 s, exit 0 |
| Isolation | canary + `/proc` `DATABASE_URL` | both passed |
| Pre-existing servers | `ss -ltnp` after the run | `:3000` pid 2802, `:4318` pid 1057494, `:4322` pid 927563 — still listening, none signalled |

Note: the harness builds into the shared `.next` directory, as in Tasks 2A/2B. Both preview servers survived the run and were confirmed listening afterwards; nothing was stopped or restarted.

---

## 8. Project database unchanged

| Evidence | Value |
|---|---|
| `md5sum prisma/dev.db` before and after | `2ee44e7855bc5442c6e9c0d535eb8f0d` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` | **not run** |
| Migrations / seed / all test writes | only in `/tmp/sellflow-e2e-*/test.db`, deleted by the harness |

---

## 9. Limitations and unresolved lifecycle questions

1. **A supplier can still decline stock (`STOCK_DECLINED`) and then cancel**, producing a `CANCELLED` order whose stock was already declined. The lifecycle allows it, but whether `STOCK_DECLINED` should be terminal is a product question (SO-08).
2. **`PAID → CANCELLED` is currently impossible.** With no refund or ledger model, allowing it would leave a confirmed payment attached to a cancelled order; blocking it can strand an order if the supplier cannot fulfil after payment. A refund/cancellation policy is needed before this is resolved — flagged, not invented.
3. **Cancellation after dispatch has no path.** Returns/partial delivery are undefined (SO-08, SO-09); `DISPUTED` plus the dispute workflow is the only route today.
4. **No transition liveness:** a supplier can leave an order at `AWAITING_PAYMENT` indefinitely; there is no expiry, reminder or auto-cancel. Out of scope here.
5. **`COMPLETED` is not tied to payment.** `dispatchOrder` accepts `STOCK_CONFIRMED` (no payment required), so an order can be dispatched, delivered and completed without any confirmed claim. Whether payment must precede dispatch is a product rule the code does not state; this fix does not add one.
6. **Stock is still not decremented or restored** (S-11), so cancelling an order does not return stock. The transition map makes cancellation *legal*, not inventory-safe.
7. **Audit durability is unchanged** (S-12): `audit()` still swallows write failures, so a successful transition can in principle lack its trail. The new test asserts the row exists in a healthy database, not that a failed audit rolls the transition back.
8. **PATCH remains a generic status endpoint** rather than being removed. Removing it would break the cancellation and completion paths that have no dedicated routes; restricting it to the map is the minimal change that closes S-04.
9. **No optimistic concurrency:** two simultaneous PATCHes on the same order could race between the read and the write (last write wins). The transitions are narrow enough that the practical risk is low, but it is not transactional.
10. **Phase 0 remains incomplete.** S-02 and S-05…S-15 are still open; nothing here should be read as pilot readiness.

---

## 10. Exact list of changed files

| File | Change |
|---|---|
| `src/server/supplier.ts` | Added `SUPPLIER_STATUS_EDGES` and the pre-write transition guard in `setSupplierOrderStatus()`. No other function changed. |
| `scripts/verify-api.mjs` | 15 S-04 assertions (wrong-actor PATCH, five illegal jumps, unknown status, no-partial-mutation, cancellation path, terminal-state enforcement, completion gating, audit metadata). |
| `STAGE2_TASK2C_S04_REPORT.md` | This report. |

Not changed: `prisma/schema.prisma`, migrations, `prisma/seed.ts`, dependencies, billing/entitlements, `confirmStock`, `decidePaymentClaim`, `dispatchOrder`, `confirmDelivery`, UI components, `src/lib/validation.ts`, `prisma/dev.db`.

**S-04 fix complete. Stopping for review; S-02 has not been started.**
