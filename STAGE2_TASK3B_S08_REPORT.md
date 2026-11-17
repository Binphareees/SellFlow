# SellFlow — Stage 2, Task 3B: S-08 (Customer-Data Visibility) Report

**Date:** 2026-11-04
**Scope:** S-08 only. S-05 and every other finding are untouched. No schema, migration, seed, dependency, billing or entitlement change. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

---

## 1. Root cause and affected files

| File | Symbol | Role in the defect |
|---|---|---|
| `src/server/supplier.ts` | `getSupplierOrder()` | The only supplier-facing projection of a linked customer order. It hid the customer **only** when `visibility === "NONE"`. `ORDER_ONLY` and `FULL` both returned `customer.select = { name, phone }`, and `NONE` still shipped the linked order's `id` and `orderNumber`. |
| `src/server/supplier.ts` | `createSupplierOrder()`, `setSupplierOrderStatus()` | Both return `getSupplierOrder(...)`, so the `201` creation body and the `PATCH` body carried the same over-exposure. |
| `prisma/schema.prisma` | `ResellerAgreementVersion.customerDataVisibility` | `String @default("ORDER_ONLY")`, validated only at write time. Nothing normalized a hand-edited or legacy value at read time, so `"BOGUS"` behaved exactly like `FULL`. |
| `src/app/(app)/supplier/orders/[id]/page.tsx` | order detail | Renders `order.customerOrder.customer.name` when present — it was faithfully displaying what the server sent, not enforcing anything itself. |

**Root cause (two parts).**

1. *Policy was never a matrix.* The projection had one branch (`NONE`), so the default value `ORDER_ONLY` was implemented as if it were `FULL`. There was no single place that mapped a visibility value to fields, so the server response was the de-facto policy.
2. *Configuration failed open.* `terms?.customerDataVisibility ?? "ORDER_ONLY"` handled a missing agreement, but an unrecognized stored string flowed into `!== "NONE"` and therefore granted the widest access. Any bad write, legacy value or manual edit silently upgraded to full identity disclosure.

---

## 2. Verified visibility policy per party

**What the approved sources say.**

- PRD RE-05 (`PRD_V0.2.md` line 314): "Customer-data visibility may be `NONE`, `ORDER_ONLY` or `FULL`." Status: **Sourced**. The PRD does **not** map values to fields — it records the enum and nothing more.
- `src/lib/enums.ts` line 80: `/** Who may see the reseller's end customer details. */` — the setting governs the *supplier's* view of the reseller's customer.
- Audit correction S-08 (`SELLFLOW_V02_AUDIT_REPORT.md`): "Define `ORDER_ONLY` to return order metadata with the customer identity redacted… and reserve `FULL` for name/phone."
- Stage 1 architecture report (S-08 row): "NONE: no customer; ORDER_ONLY: name only, no phone; FULL: all" for both parties.

**Ambiguity, stated plainly.** The field-level mapping is a **documented source gap**: the PRD does not define what `ORDER_ONLY` may include, and the two internal documents differ on whether `ORDER_ONLY` may include the *name*. This report did not invent a permission. It applied the task's rule — a name is shown only where the approved policy explicitly permits it — and the PRD permits no customer identity under `ORDER_ONLY`. The narrower reading was chosen because it cannot leak; widening `ORDER_ONLY` later is a policy decision, not a code rewrite.

**Resulting policy, implemented and tested:**

| Visibility | Supplier sees | Reseller sees | Mediator sees |
|---|---|---|---|
| `NONE` | Nothing: `customerOrder: null` (no order number, no identity) | Full (owns the record) | Full |
| `ORDER_ONLY` (default) | Order metadata only — `id`, `workspaceId`, `orderNumber`; `customer: null` | Full | Full |
| `FULL` | Order metadata + `customer.name` + `customer.phone` | Full | Full |
| missing / unrecognized | Treated as `ORDER_ONLY` — metadata only, never identity | Full | Full |

**Why the reseller keeps full access.** The customer record lives in the reseller's own workspace (`Customer.workspaceId`); the reseller created it and edits it through the workspace API. `customerDataVisibility` is a supplier-facing contract term ("Customer details your resellers share with you", `src/components/supplier-actions.tsx` line 175; the marketplace shows it as "Customer data visible to supplier", `src/app/marketplace/[slug]/page.tsx` line 136). The tests now pin both halves of that asymmetry so a future change cannot quietly redact the reseller's own data or widen the supplier's.

**Moderators** are neither party; they retain full access because dispute resolution needs the customer context. That is unchanged and is listed under remaining concerns.

**Null vs omission.** The existing API contract already used `null` for a withheld customer (`customer: null`) and for a withheld link (`customerOrder: null`), so both are preserved rather than switching to omitted keys. The supplier order page already renders `customer` only when present, so no UI change was needed and nothing is hidden client-side.

---

## 3. Regression tests added

8 assertions in `scripts/verify-api.mjs`, section **“S-08: customer-data visibility is enforced per level, per party”**, immediately after the S-02 block so they reuse that block's linked order (`ownLink`) and workspace order (`newOrder`):

| # | Assertion | Expected |
|---|---|---|
| 1 | `FULL` shares the customer name and phone with the supplier | `200`, name/phone match the record |
| 2 | The supplier order **list** endpoint carries no customer identity | `200`, no name/phone in the body |
| 3 | `ORDER_ONLY` shares the order but not the customer identity | `200`, `orderNumber` matches, `customer` null, no name/phone anywhere in the body |
| 4 | The reseller still sees its own customer under `ORDER_ONLY` | `200`, name present |
| 5 | `NONE` hides the linked customer order from the supplier | `200`, `customerOrder: null`, no name/phone |
| 6 | The reseller still sees its own customer under `NONE` | `200`, name present |
| 7 | An invalid visibility value falls back to the safe default | `200`, `customer` null, no name/phone |
| 8 | Another supplier cannot change an offer's customer-data settings | `404`, version count unchanged, stored value unchanged |

**How the setting is exercised (assertion 4 requirement, "changing visibility settings changes the API projection").** The linked order snapshots the agreement version it was priced under (`SupplierOrderItem.agreementVersionId`), so an order's terms are its own record. The test therefore flips `ResellerAgreementVersion.customerDataVisibility` for **that snapshotted version** — `FULL → ORDER_ONLY → NONE → BOGUS` — reading the same order after each change, and restores `ORDER_ONLY` in a `finally` block. Editing the live offer instead would append a new version and, correctly, would not rewrite the historical order; that behaviour is intentional and is noted in §9.

**Assertion 8 setup.** The test reads the stranger account's profile and workspace from `/api/auth/me`, grants it a `SUPPLIER` `ProfileRole` and a `SupplierProfile` row directly in the isolated database (the fixture has only one supplier, and there is no second-supplier onboarding path cheap enough for an API suite), then has it `POST /api/supplier/offers/{offerId}/versions`. Both rows are deleted immediately afterwards so later suite stages and the PWA run see the original data.

All Prisma manipulation is inside the existing `DATABASE_URL.includes("sellflow-e2e-")` guard; outside the isolated harness each block prints `SKIP` and touches nothing.

---

## 4. Evidence of failures before the fix

`npm run test:e2e:clean -- --skip-build` against the **unmodified** application:

```
harness_exit=1
pass=192 fail=3

FAIL  ORDER_ONLY shares the order but not the customer identity (S-08) — status 200,
      customerOrder {"id":"…","workspaceId":"…","orderNumber":"SF-2611-0003",
                     "customer":{"name":"Ify Okafor","phone":"2348095556677"}}
FAIL  NONE hides the linked customer order from the supplier (S-08) — status 200,
      customerOrder {"id":"…","workspaceId":"…","orderNumber":"SF-2611-0003","customer":null}
FAIL  an invalid visibility value falls back to the safe default (S-08) — status 200,
      customer {"name":"Ify Okafor","phone":"2348095556677"}
```

This is the audit finding reproduced exactly: the default contract term (`ORDER_ONLY`) disclosed the end customer's name **and** phone number to the supplier. `NONE` withheld the identity but still handed over the linked order's internal id, workspace id and order number. A stored value of `BOGUS` behaved like `FULL`.

The five assertions that already passed are the guard rails: `FULL` disclosure, the supplier list endpoint, the reseller's own access under `ORDER_ONLY` and `NONE`, and cross-supplier settings isolation.

---

## 5. Exact implementation

**a) One projection module — `src/lib/customer-visibility.ts` (new, 55 lines):**

```ts
export function resolveCustomerDataPolicy(raw: string | null | undefined): CustomerDataVisibility {
  return (CUSTOMER_DATA_VISIBILITY as readonly string[]).includes(raw ?? "")
    ? (raw as CustomerDataVisibility)
    : "ORDER_ONLY";
}

export function projectCustomerOrderForSupplier(
  customerOrder: SupplierVisibleCustomerOrder | null,
  visibility: string | null | undefined,
): SupplierVisibleCustomerOrder | null {
  if (!customerOrder) return null;

  switch (resolveCustomerDataPolicy(visibility)) {
    case "FULL":       return customerOrder;
    case "ORDER_ONLY": return { ...customerOrder, customer: null };
    case "NONE":
    default:           return null;
  }
}
```

The parameter is a concrete structural type (`id`, `workspaceId`, `orderNumber`, `customer`), so the Prisma select and the policy cannot drift apart without a type error. Normalization is independent of the projection so a caller that only needs the policy can reuse it.

**b) The single call site — `getSupplierOrder()`:**

```ts
  const customerOrder = !linkBelongsToWorkspace
    ? null
    : isSupplier
      ? projectCustomerOrderForSupplier(order.customerOrder, terms?.customerDataVisibility)
      : order.customerOrder;
```

The S-02 workspace-ownership guard still runs first, so a foreign link is `null` before visibility is even consulted — defence in depth is preserved, not reordered. `getSupplierOrder` is the only function that projects a linked customer order: `GET /api/supplier/orders/[id]`, `POST /api/supplier/orders` (201 body), `PATCH /api/supplier/orders/[id]`, and the supplier order page all flow through it, so no route holds its own copy of the rule.

**c) Deliberately unchanged:** the `select` still fetches `customer { name, phone }` for `FULL`; delivery and dispute responses contain no customer columns (`DispatchRecord`, `DeliveryConfirmation`, `PaymentStatusClaim` have no name/phone fields); the supplier order list endpoint never included `customerOrder` and now has a test saying so; reseller pricing and order permissions are untouched.

**d) UI:** none required. The order page renders the customer only when `order.customerOrder.customer` exists and the link only when `customerOrder` exists, so `ORDER_ONLY` and `NONE` degrade to "Linked customer order: SF-…" and nothing respectively. No fields are hidden client-side — the server does not send them.

---

## 6. Passing results after the fix

`npm run test:e2e:clean` (isolated DB, migrations, seed, production build, API, PWA):

```
harness_exit=0
pass=226 fail=0
[harness] isolation check 1 passed: canary workspace "HARNESS-MW1CHCML" served from the temp database
[harness] isolation check 2 passed: pid 1151188 DATABASE_URL matches the temp file
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 219.0s (isolated DB, api=0, pwa=0)
```

The S-08 matrix:

```
PASS  FULL shares the customer name and phone with the supplier (S-08) — customer {"name":"Ify Okafor","phone":"2348095556677"}
PASS  the supplier order list carries no customer identity (S-08)
PASS  ORDER_ONLY shares the order but not the customer identity (S-08) — customerOrder {"id":"…","orderNumber":"SF-2611-0003","customer":null}
PASS  the reseller still sees its own customer under ORDER_ONLY (S-08)
PASS  NONE hides the linked customer order from the supplier (S-08) — customerOrder null
PASS  the reseller still sees its own customer under NONE (S-08)
PASS  an invalid visibility value falls back to the safe default (S-08) — customer null
PASS  another supplier cannot change an offer's customer-data settings (S-08) — status 404, versions 1→1
```

S-02 regressions still pass unchanged:

```
PASS  a reseller cannot link another workspace's customer order (S-02) — status 400
PASS  the foreign link response discloses no customer data (S-02)
PASS  a nonexistent customer order is rejected the same way (S-02) — foreign 400, missing 400
PASS  a pre-existing foreign link is not projected to the supplier (S-02) — status 200, customerOrder null
```

**Totals: 226 assertions** (195 API + 31 PWA), 0 failures — the 218 from S-02 plus 8 new. (`ALL CHECKS PASSED` covers the API stage; the PWA stage ran in the same harness invocation.)

---

## 7. Full API/PWA, typecheck and build results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | inside `test:e2e:clean` (shared `.next`) | **exit 0** |
| API suite | `scripts/verify-api.mjs` | **195 / 195** |
| PWA suite | `scripts/verify-pwa.mjs` | **31 / 31** |
| Combined | `npm run test:e2e:clean` | **PASSED**, 219.0 s, exit 0 |
| DB isolation | canary workspace + `/proc` `DATABASE_URL` | both passed |
| Pre-existing servers | `ss -ltnp` after the run | `:3000` pid 2802, `:4318` pid 1057494, `:4322` pid 927563 — all still listening, none signalled |

No process was stopped or restarted; the harness built into the same `.next` directory as before and both preview servers survived.

---

## 8. Project database unchanged

| Evidence | Value |
|---|---|
| `md5sum prisma/dev.db` before and after | `2ee44e7855bc5442c6e9c0d535eb8f0d` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` | **not run** |
| Visibility flips, the foreign-supplier role/profile rows | only in `/tmp/sellflow-e2e-*/test.db`, deleted by the harness |

---

## 9. Remaining privacy concerns

1. **`ORDER_ONLY` does not disclose a name** under this implementation. If the product owner decides suppliers need a name to coordinate delivery, that is a policy change to `src/lib/customer-visibility.ts` plus the matrix test — not a defect.
2. **Historical orders keep the visibility they were priced under.** Because each order item snapshots its agreement version, changing the offer's current terms cannot retroactively widen or narrow past orders. This is intentional (price/terms immutability) but means a visibility change takes effect only for orders created after the new version is accepted.
3. **No delivery address exists** on customer orders, so "ship to the customer" is out of reach for `ORDER_ONLY` suppliers by data model, not by projection. Adding an address later must be routed through the same helper.
4. **Mediators still see full customer identity** on any order, with no per-read audit (`getSupplierOrder` accepts `MEDIATOR` roles; platform admins are not accepted — observation N-02). Legitimate for dispute work, but unaudited.
5. **No audit when a supplier reads customer identity**, and no audit when visibility is changed. Both belong with S-12.
6. **Misconfiguration is normalized silently.** An unrecognized stored value now fails closed but is not reported; a startup/back-office check should flag values outside the enum rather than hiding them.
7. **`customerOrder.workspaceId` and `id` are still returned** to the supplier under `ORDER_ONLY`. They are internal identifiers, not PII, but they are cross-workspace references; consider dropping them if nothing needs them.
8. **Pre-existing foreign links remain in the database.** S-02 hides them at projection time; a read-only audit query plus cleanup is still needed before a pilot.
9. **PWA/offline caching of supplier order pages** is governed by the service worker's caching rules; a previously viewed `FULL` order page could persist in a shared-device cache (PRD OF-07 is a source gap). Not addressed here.
10. **Phase 0 is still incomplete.** S-05, S-06, S-07 and S-09…S-15 remain open.

---

## 10. Exact list of changed files

| File | Change |
|---|---|
| `src/lib/customer-visibility.ts` | **New.** `resolveCustomerDataPolicy()` (safe default for missing/invalid values) and `projectCustomerOrderForSupplier()` — the single NONE / ORDER_ONLY / FULL matrix for supplier-facing views. |
| `src/server/supplier.ts` | `getSupplierOrder()` now calls the projection for suppliers instead of the single `NONE` branch; S-02 workspace guard unchanged and still evaluated first. |
| `scripts/verify-api.mjs` | 8 S-08 assertions: FULL disclosure, list-endpoint safety, ORDER_ONLY redaction, NONE suppression, reseller access under both levels, invalid-value fallback, cross-supplier settings isolation. |
| `STAGE2_TASK3B_S08_REPORT.md` | This report. |

Not changed: `prisma/schema.prisma`, migrations, `prisma/seed.ts`, dependencies, billing/entitlements, `src/app/api/**` routes, reseller pricing and order permissions, UI components, other findings, `prisma/dev.db`.

**S-08 fix complete. Stopping for review; S-05 and the remaining findings have not been started.**
