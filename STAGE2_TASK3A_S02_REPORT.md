# SellFlow — Stage 2, Task 3A: S-02 (Cross-Workspace Customer Exposure) Report

**Date:** 2026-11-04
**Authorization:** Implementation GO, D-019 (2026-11-04). Phase 0 validation remains incomplete; this report does not claim the platform is pilot-safe.
**Scope:** S-02 only. S-08 (the full `customerDataVisibility` matrix) and every other finding are untouched. No schema, migration, seed, dependency, billing or entitlement change.

---

## 1. Root cause and affected files

| File | Symbol | Role in the defect |
|---|---|---|
| `src/server/supplier.ts` | `createSupplierOrder()` | Copied `input.customerOrderId` straight into `SupplierOrder.customerOrderId` (line ~610) with no lookup and no workspace comparison. The only checks were that the supplier exists and is not the caller. |
| `src/lib/validation.ts` | `supplierOrderCreateSchema` | `customerOrderId: z.string().cuid().optional()` — shape only. A CUID from any workspace validates. |
| `src/server/supplier.ts` | `getSupplierOrder()` | Included `customerOrder { id, orderNumber, customer { name, phone } }` for any party. The only reduction was `visibility === "NONE"` for suppliers, so an `ORDER_ONLY` agreement (the default) returns full name **and phone**. |
| `src/app/api/supplier/orders/route.ts` | `POST` | `requireReseller()` then `readBody(supplierOrderCreateSchema)` then the service. No ownership logic, correctly leaving it to the service. |
| `prisma/schema.prisma` | `CustomerOrder`, `SupplierOrder` | `CustomerOrder.workspaceId` exists and `SupplierOrder.customerOrderId @unique`; nothing at the database level ties the two together. |

**Root cause.** A cross-entity reference was treated as a scalar. `customerOrderId` came from the request body, was never resolved against the caller's workspace, and `getSupplierOrder` projected the linked customer to the supplier. The caller's workspace was already known server-side (`workspaceIdForProfile(profileId)`), so the check was simply missing.

A secondary defect surfaced while testing: a *nonexistent* `customerOrderId` produced an unhandled Prisma foreign-key error and a `500`, which both leaked an internal failure mode and confirmed the value was not found.

---

## 2. Exact cross-workspace exposure path

```
1. Attacker (reseller, workspace A) learns or guesses a CustomerOrder id from workspace B.
2. POST /api/supplier/orders
     { supplierProfileId: <any supplier>, customerOrderId: <B's order id>,
       items: [{ listingId: <any published listing>, qty: 6 }] }
   → 201; SupplierOrder.customerOrderId is written on the attacker's order.
3. The supplier now calls GET /api/supplier/orders/<new order id>.
   → getSupplierOrder includes customerOrder.customer.{name, phone} because the
     agreement's visibility is ORDER_ONLY (the default) and the supplier is a party.
4. Workspace B's customer name and phone are disclosed to a supplier who has no
   relationship with that business; B's order number is disclosed too.
```

The supplier is an unwitting recipient; the attacker needs only the ID, and IDs are returned by workspace APIs and appear in links. The relation `SupplierOrder.customerOrderId @unique` also means the attacker can "burn" the link: once attached, the legitimate reseller can no longer link that customer order to a supplier order.

**Update path:** there is none. `customerOrderId` is written only in `createSupplierOrder`; the only supplier-order update route is `PATCH /api/supplier/orders/[id]`, whose schema is `{ status, note }` (plus the S-04 transition map). No other service updates the column. The ownership rule therefore has exactly one write site, and the tests confirm PATCH cannot re-associate a customer order.

---

## 3. Regression tests added

8 assertions in `scripts/verify-api.mjs`, section **“S-02: a customer order may only be linked inside its own workspace”**:

| # | Assertion | Expected |
|---|---|---|
| 1 | A newly registered account can create a customer in its own workspace | `201` |
| 2 | That account can create its own customer order | `201` |
| 3 | Reseller (workspace A) links workspace B's customer order on a supplier order | `400` |
| 4 | That response contains no foreign customer name, phone or order number | true |
| 5 | A nonexistent `customerOrderId` fails identically (same status, same message) | `400` / `400` |
| 6 | The same reseller links **its own** customer order | `201`, `customerOrderId` stored |
| 7 | The supplier reads that linked order and sees the own-workspace customer order | `200` |
| 8 | A row written *before* the fix (inserted directly with a foreign link) is not projected to the supplier | `200` with `customerOrder: null` |

Assertion 8 is the defence-in-depth check for data already in a database. It inserts one `SupplierOrder` row via Prisma against the isolated temp database (guarded on `DATABASE_URL` containing `sellflow-e2e-`; otherwise it prints `SKIP` and never touches project data), then reads it through the API as the supplier. It uses a second foreign order because `customerOrderId` is unique and, on an unpatched server, the forged link in assertion 3 already occupies the first.

---

## 4. Evidence of failures before the fix

`npm run test:e2e:clean -- --skip-build` against the **unmodified** application:

```
harness_exit=1
pass=183 fail=4

FAIL  a reseller cannot link another workspace's customer order (S-02) — status 201
FAIL  the foreign link response discloses no customer data (S-02)
FAIL  a nonexistent customer order is rejected the same way (S-02) — foreign 201, missing 500
FAIL  a pre-existing foreign link is not projected to the supplier (S-02) — status 200,
      customerOrder {"id":"…","orderNumber":"SF-2611-0002",
      "customer":{"name":"Probe Secret Customer","phone":"2348001112222"}}
```

The fourth failure is the disclosure itself: a supplier reading an order linked to another workspace's customer received the name and phone number. The third shows the unhandled foreign-key error (`500` instead of a clean rejection). Assertions 1, 2, 6 and 7 passed before the change, proving the legitimate path already worked and had to stay working.

---

## 5. Exact implementation

**a) Creation check — `createSupplierOrder()`, after the supplier/self-order checks and before any line resolution or write:**

```ts
  if (input.customerOrderId) {
    const workspaceId = await workspaceIdForProfile(resellerProfileId);
    const owned = workspaceId
      ? await prisma.customerOrder.findFirst({
          where: { id: input.customerOrderId, workspaceId, deletedAt: null },
          select: { id: true },
        })
      : null;
    if (!owned) throw badRequest("That customer order is not available in your workspace");
  }
```

The workspace comes from the authenticated reseller profile, never from the body. The same message is returned for a foreign id and a nonexistent one, so the endpoint is not an existence oracle. Because the check runs before `prisma.supplierOrder.create`, a rejected request writes nothing (no order, no items, no audit row).

**b) Projection guard — `getSupplierOrder()`:**

```ts
  const resellerWorkspaceId = await workspaceIdForProfile(order.resellerProfileId);
  const linkBelongsToWorkspace =
    !order.customerOrder ||
    (resellerWorkspaceId !== null && order.customerOrder.workspaceId === resellerWorkspaceId);

  const customerOrder = !linkBelongsToWorkspace
    ? null
    : isSupplier && visibility === "NONE"
      ? order.customerOrder
        ? { ...order.customerOrder, customer: null }
        : null
      : order.customerOrder;
```

The `customerOrder` select gained `workspaceId: true`. This hides links that predate the fix and would also cover any future write path that forgets the check. **The visibility policy itself is unchanged** — `ORDER_ONLY`/`NONE`/`FULL` semantics are S-08 and were deliberately not redesigned.

**c) Why not trust `SupplierOrder.resellerWorkspaceId`:** the column exists but is never populated by `createSupplierOrder`, so it is `null` for every existing row. The guard derives the workspace from `resellerProfileId`, which is always set. Filling the column is an S-08/data-migration decision, not part of this minimal fix.

No route, schema, seed or UI change. The marketplace order form already lists only the caller's own customer orders, so no legitimate client behaviour changes.

---

## 6. Evidence of passing tests after the fix

`npm run test:e2e:clean` (full: isolated DB + migrations + seed + production build + API + PWA):

```
harness_exit=0
pass=218 fail=0
[harness] isolation check 1 passed: canary workspace "HARNESS-MW1BSL7H" served from the temp database
[harness] isolation check 2 passed: pid 1123209 DATABASE_URL matches the temp file
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 213.1s (isolated DB, api=0, pwa=0)
```

S-02 assertions and the preserved legitimate path:

```
PASS  a separate workspace can create its own customer — status 201
PASS  a separate workspace can create its own customer order — status 201
PASS  a reseller cannot link another workspace's customer order (S-02) — status 400
PASS  the foreign link response discloses no customer data (S-02)
PASS  a nonexistent customer order is rejected the same way (S-02) — foreign 400, missing 400
PASS  a reseller can still link its own customer order — status 201
PASS  the supplier sees the linked own-workspace customer order — status 200
PASS  a pre-existing foreign link is not projected to the supplier (S-02) — status 200, customerOrder null
```

Totals: **218 assertions** (187 API + 31 PWA), 0 failures — 210 from before this task plus 8 new.

---

## 7. Full API/PWA, typecheck and build results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | inside `test:e2e:clean` (shared `.next`) | **exit 0** |
| API suite | `scripts/verify-api.mjs` | **187 / 187** |
| PWA suite | `scripts/verify-pwa.mjs` | **31 / 31** |
| Combined | `npm run test:e2e:clean` | **PASSED**, 213.1 s, exit 0 |
| Isolation | canary + `/proc` `DATABASE_URL` | both passed |
| Pre-existing servers | `ss -ltnp` after the run | `:3000` pid 2802, `:4318` pid 1057494, `:4322` pid 927563 — all still listening, none signalled |

The harness builds into the shared `.next` directory; both preview servers survived and were confirmed listening afterwards. Nothing was stopped or restarted.

---

## 8. Project database unchanged

| Evidence | Value |
|---|---|
| `md5sum prisma/dev.db` before and after | `2ee44e7855bc5442c6e9c0d535eb8f0d` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` | **not run** |
| Migrations, seed, forged legacy row | only in `/tmp/sellflow-e2e-*/test.db`, deleted by the harness |

---

## 9. Remaining privacy concerns

1. **S-08 is untouched and still real.** Under `ORDER_ONLY` (the default) the supplier receives the customer's **name and phone**; under `NONE` only the customer object is nulled while `orderNumber` remains. Whether `ORDER_ONLY` should expose a phone at all, and whether the reseller should also be projected, is the visibility-matrix work.
2. **Existing bad rows are hidden, not repaired.** The projection guard stops the leak, but any `SupplierOrder.customerOrderId` already pointing across workspaces stays in the database. A one-off audit/cleanup query is needed before a pilot (read-only detection is safe; the fix intentionally added no migration).
3. **No audit of rejected link attempts.** A blocked cross-workspace link returns 400 but records nothing, so probing is invisible. Belongs with S-12.
4. **The reject message is uniform** (good for non-disclosure) but it does confirm the endpoint validates the field; it reveals nothing about a specific id.
5. **Moderator reads are broader.** `getSupplierOrder` allows anyone with the `MEDIATOR` role to read orders (and thus customer data) across the platform; `isPlatformAdmin` is not accepted there (observation N-02). Mediator access is intentional, but it is not audited per read.
6. **No rate limiting.** An attacker can enumerate IDs cheaply; each attempt is a 400 but unlimited. S-05 covers authentication, not this endpoint.
7. **`customerOrderId` is still `@unique`**, so a rejected attempt cannot burn a link any more, but the schema still permits at most one supplier order per customer order — an intentional coordination rule.
8. **The check trusts `CustomerOrder.workspaceId`** as the tenancy anchor. That is consistent with the rest of `src/server/workspace.ts`, which scopes every query by session workspace.
9. **Phase 0 remains incomplete.** S-05…S-15 are still open; nothing here should be read as pilot readiness.

---

## 10. Exact list of changed files

| File | Change |
|---|---|
| `src/server/supplier.ts` | `createSupplierOrder()` validates `customerOrderId` against the session-derived workspace before any write; `getSupplierOrder()` selects `customerOrder.workspaceId` and only projects a link that belongs to the reseller's workspace (visibility policy unchanged). |
| `scripts/verify-api.mjs` | 8 S-02 assertions: foreign link rejection, no leaked fields, nonexistent-id parity, own-workspace link still works for both parties, pre-existing foreign link not projected. |
| `STAGE2_TASK3A_S02_REPORT.md` | This report. |

Not changed: `prisma/schema.prisma`, migrations, `prisma/seed.ts`, dependencies, billing/entitlements, `customerDataVisibility` handling, workspace services, UI components, other findings, `prisma/dev.db`.

**S-02 fix complete. Stopping for review; S-08 has not been started.**
