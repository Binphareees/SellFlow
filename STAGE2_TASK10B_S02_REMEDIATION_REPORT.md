# STAGE 2 TASK 10B — S-02 CLARIFICATION + READ-SIDE DEFENSE-IN-DEPTH

**Finding:** S-02 — HIGH: unvalidated `customerOrderId` creates a cross-tenant order link (IDOR)  
**Task:** STAGE 2 TASK 10B — S-02 clarification and read-side defense-in-depth  
**Date:** 2026-11-06  
**Authorization:** Project owner GRANTED for this S-02-only documentation + minor hardening task  
**Classification:** Clarification + defense-in-depth. **Not** the remediation of a demonstrated active no-workspace bypass.

---

## 1. Summary

### What Task 10B did
Task 10B tightened two things in `src/server/supplier.ts`:

1. **Write side (`createSupplierOrder`):** made the `customerOrderId` workspace-ownership rejection **explicit and unconditional** for a reseller with no `businessWorkspace`, using the same generic message as for a foreign / deleted / nonexistent order.
2. **Read side (`getSupplierOrder`):** added an explicit `resellerWorkspaceId === null` short-circuit so a linked customer order is never projected to a reseller that has no workspace, even if a link were inserted directly.

### What Task 10B did **not** do
Task 10B did **not** fix a demonstrated, exploitable no-workspace bypass through the API. The pre-Task-10B `createSupplierOrder()` already rejected a no-workspace reseller's link, because the original code ended with `if (!owned) throw badRequest(...)` after the ternary, and when `workspaceIdForProfile()` returned `null` the ternary produced `owned = null`, so `!owned` was `true` and the request was rejected.

The original S-02 vulnerability (cross-workspace `customerOrderId` link + supplier-side customer PII disclosure) was **real and was remediated by Task 3A**. Task 10B's changes are clarifications / defense-in-depth on top of an already-correct control, not the fix for a proven active vulnerability.

### Files changed (on disk)
- `src/server/supplier.ts` — write-side link check made unconditional/explicit + read-side projection given an explicit no-workspace short-circuit.
- `scripts/verify-api.mjs` — three regression checks added to the existing S-02 test block (isolated-DB branch only).

### Verification
- Typecheck: `npx tsc --noEmit --incremental false` — exit 0
- Production build: `npm run build` — exit 0
- Isolated E2E harness: `node scripts/test-e2e-clean.mjs --skip-build --keep`
  - Exit status: 0
  - Summary: `[harness] PASSED in 257.1s (isolated DB, api=0, pwa=0)`
  - PASS: 502, FAIL: 0, no crash
  - `prisma/dev.db` fingerprint unchanged: `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`, 589824 bytes (start + end of run)
- All existing S-02 checks pass; the three new regression checks pass.

### Result
The changes are consistent with the already-correct S-02 control and make intent clearer. S-02 is **not** formally accepted by this task — it was remediated by Task 3A and is recorded as remediated/accepted in `STATE.md` (with Task 10B noted as clarification + defense-in-depth). No formal S-02 acceptance report is created by this task.

---

## 2. Evidence basis and historical limitation

### 2.1 Original S-02 vulnerability (verified, pre-Task-3A)
The original S-02 finding was staged and reproduced in `STAGE2_TASK3A_S02_REPORT.md`:
- A reseller could `POST /api/supplier/orders` with a foreign workspace's `customerOrderId`; the server wrote it with no workspace/ownership check.
- The supplier GET then returned the linked customer's `name` and `phone` (`customerOrder.customer { name, phone }`).
- Nonexistent `customerOrderId` produced a 500 Prisma FK error (unhandled), confirming the value was not validated.
- The update path does not exist: `customerOrderId` is written only in `createSupplierOrder`; the only supplier-order update route is `PATCH /api/supplier/orders/[id]` (schema `{ status, note }`); no other service updates the column.
- `CustomerOrder.workspaceId` exists and `SupplierOrder.customerOrderId @unique`, but nothing at the DB level ties the two workspaces together.

That reproduction is the evidence that the original S-02 vulnerability was real. It is the primary evidence for the S-02 finding and for the Task 3A remediation.

### 2.2 Original remediation (Task 3A)
Task 3A added, in `createSupplierOrder()`:
- When `customerOrderId` is supplied, resolve the reseller's workspace via `workspaceIdForProfile(resellerProfileId)`.
- Require the referenced `CustomerOrder` to exist, belong to that workspace, and have `deletedAt === null`; otherwise reject with the generic message.
- A read-side projection guard (`linkBelongsToWorkspace`) so a foreign link is not projected to the supplier.

That is the actual S-02 fix. See `STAGE2_TASK3A_S02_REPORT.md`.

### 2.3 Historical source limitation (important)
The repository's HEAD commit (`37fc638 Add project documentation and validation templates`) tracks only 10 files. The file `src/server/supplier.ts` is **not** tracked in HEAD; it is a working-tree file, so a verified **Git diff** of the original write-side code does **not** exist. The "before" code in this report is reconstructed from:
- the earlier source inspection and the staged reproduction in `STAGE2_TASK3A_S02_REPORT.md`,
- the Task 3A report's description of the remediation,
- the Task 10 review's note about the pre-Task-10B behavior, and
- the on-disk current code + the isolated-E2E regression results.

Where the exact original source text cannot be independently recovered from Git, this report states the reconstructed behavior and flags the limitation. It does **not** claim a verified Git diff where none exists.

---

## 3. Original vs current write-side behavior

### 3.1 Original write-side (pre-Task-10B), as reconstructed
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

**Behavior when the reseller has no workspace:**
- `workspaceIdForProfile()` returns `null`.
- The ternary condition is falsy → takes the `: null` branch → `owned = null`.
- `if (!owned)` → `if (!null)` → `if (true)` → throws the generic `badRequest(...)`.

So the original **already rejected** a no-workspace reseller from linking a customer order — it just arrived at the throw indirectly (via `owned = null`) instead of via an explicit early reject. The claim that the no-workspace check was "skipped" and that "a no-workspace reseller could link any customer order" is **not supported** by this code: the throw was reached, and the link was rejected.

What the original did **not** do: it conflated three reasons for `owned` being null — (a) no workspace, (b) order not found, (c) wrong workspace, (d) deleted — into one generic message. That conflation already existed for (b)/(c)/(d) by design (generic message), and (a) was a third, unintended way to arrive at the same message. The original also did not separately assert, in code, that "no workspace → reject"; it relied on the side effect of the ternary.

### 3.2 Current write-side (post-Task-10B)
```ts
// S-02 (remediated): a customer order may only be linked when the reseller
// belongs to the same workspace the order belongs to. This check is
// unconditional: a reseller with no business workspace cannot validate an
// intra-workspace link, so the request is rejected the same way as a
// foreign or deleted order — without saying whether the order exists.
if (input.customerOrderId) {
  const resellerWorkspaceId = await workspaceIdForProfile(resellerProfileId);
  if (!resellerWorkspaceId) {
    throw badRequest("That customer order is not available in your workspace");
  }
  const owned = await prisma.customerOrder.findFirst({
    where: { id: input.customerOrderId, workspaceId: resellerWorkspaceId, deletedAt: null },
    select: { id: true },
  });
  if (!owned) {
    throw badRequest("That customer order is not available in your workspace");
  }
}
```

**Behavior when the reseller has no workspace:** explicit early reject, same generic message. Same effective outcome as before.

**Behavior when the reseller has a workspace:** unchanged from Task 3A — requires the order to exist, be in that workspace, and not be deleted.

---

## 4. Original vs current read-side behavior

### 4.1 Original read-side (pre-Task-10B), as reconstructed
```ts
const customerOrder = !linkBelongsToWorkspace
  ? null
  : isSupplier
    ? projectCustomerOrderForSupplier(order.customerOrder, terms?.customerDataVisibility)
    : order.customerOrder;
```
where
```ts
const linkBelongsToWorkspace =
  !order.customerOrder ||
  (resellerWorkspaceId !== null && order.customerOrder.workspaceId === resellerWorkspaceId);
```

**When a linked customer order exists and `resellerWorkspaceId` is null:**
- `!order.customerOrder` is `false` (the link exists).
- `(resellerWorkspaceId !== null && ...)` is `(false && ...)` = `false`.
- So `linkBelongsToWorkspace = false || false = false`.
- The original projection: `!linkBelongsToWorkspace` → `!false` → `true` → returns `null`.

So the **original read-side already hid** a linked customer order when the reseller had no workspace — because `linkBelongsToWorkspace` was already false in that case. This is why Task 10B's added `|| resellerWorkspaceId === null` clause is **not** fixing an established disclosure vulnerability; the original projection already returned `null` for that case.

The original read-side's only real gap (relative to the current code) was that it was not **explicit** about the no-workspace case: it relied on the side effect of `linkBelongsToWorkspace` being false. That is defense-in-depth clarity, not a fix for a demonstrated leak.

### 4.2 Current read-side (post-Task-10B)
```ts
// Defence in depth for rows written before the creation check existed: a link
// that does not point into the reseller's own workspace is never projected.
// After S-02 remediation this should never happen for new rows (the write-time
// check rejects a missing-workspace or foreign link), but we still guard the
// projection unconditionally so a directly-inserted legacy row cannot leak.
const resellerWorkspaceId = await workspaceIdForProfile(order.resellerProfileId);
const linkBelongsToWorkspace =
  !order.customerOrder ||
  (resellerWorkspaceId !== null && order.customerOrder.workspaceId === resellerWorkspaceId);

// A reseller with no workspace cannot have a valid intra-workspace link, so any
// customer order attached to one of their orders is treated as foreign and hidden.
const customerOrder =
  !linkBelongsToWorkspace || resellerWorkspaceId === null
    ? null
    : isSupplier
      ? projectCustomerOrderForSupplier(order.customerOrder, terms?.customerDataVisibility)
      : order.customerOrder;
```

The added `|| resellerWorkspaceId === null` makes the no-workspace hiding **explicit**. Because the original already returned `null` in that case (via `linkBelongsToWorkspace`), this clause **does not change behavior** for the no-workspace case; it is clarification + defense-in-depth.

---

## 5. Why Task 10B's checks are clarifications, not fixes for demonstrated vulnerabilities

### 5.1 Write-side "fix" is clarification, not a new rejection
The pre-Task-10B `createSupplierOrder()` already rejected a no-workspace reseller's link (via `owned = null` → throw). Task 10B's change makes the rejection **explicit and unconditional** (early `if (!resellerWorkspaceId)`), which is clearer and less fragile but **does not add a new rejection that did not already exist**. There was no demonstrated no-workspace bypass through the API to fix.

### 5.2 Read-side "fix" is explicit defense-in-depth, not a leak repair
The pre-Task-10B projection already returned `null` when `order.customerOrder` existed and `resellerWorkspaceId` was null (because `linkBelongsToWorkspace` was false). So Task 10B's added `|| resellerWorkspaceId === null` clause did **not** close a demonstrated disclosure; it made an already-happening hiding explicit. The case it guards (a directly-inserted legacy link on a no-workspace reseller's order) is one that should be impossible via the API, and the original projection already handled it. This is defense-in-depth, not leak remediation.

### 5.3 The real S-02 vulnerability was fixed by Task 3A
The demonstrable, reproducible S-02 vulnerability — cross-workspace `customerOrderId` link + supplier-side customer PII disclosure, plus the 500 on nonexistent ID — was fixed by Task 3A: the write-side workspace + exists + `deletedAt: null` check, plus the read-side `linkBelongsToWorkspace` guard. Task 10B did not introduce those; it built on them.

---

## 6. Absence of another production write path for `SupplierOrder.customerOrderId`

A grep across `src/` confirms that the **only** assignment to `SupplierOrder.customerOrderId` in production server code is `src/server/supplier.ts`, line 860, inside `createSupplierOrder()`:
```ts
customerOrderId: input.customerOrderId ?? null,
```
The only reads of `customerOrderId` in that file are the link-check condition (line 780) and the query filter (line 786). The `PATCH /api/supplier/orders/[id]` route uses `supplierOrderStatusSchema` (`{ status, note }`) and calls `setSupplierOrderStatus`, which does not touch `customerOrderId`. No admin/dispute/claim/delivery/dispatch/stock/payment/agreement/application/listing or workspace function writes `customerOrderId` on a `SupplierOrder`. The client sends `customerOrderId` in the POST body only; it does not write to the DB directly.

**Conclusion:** there is no other production API path that can set `SupplierOrder.customerOrderId`. The link is write-once, in `createSupplierOrder`, protected by the workspace check. This is consistent with the S-02 finding's own statement that no update path exists.

---

## 7. Remaining consideration — optional legacy-row audit (not evidence of an active API vulnerability)

After Task 3A, any pre-existing `SupplierOrder.customerOrderId` pointing across workspaces (or onto a no-workspace reseller's order) is **hidden by the projection** but still present in the database. That is:
- **Not** an active API vulnerability — the read-side projection prevents disclosure, and the write-side check prevents new cross-workspace links via the API.
- A **data-hygiene / audit** consideration only — a one-off read-only query could enumerate such rows if desired, and a deliberate cleanup could be run later.

Task 10B's read-side explicit `resellerWorkspaceId === null` clause additionally guarantees these legacy rows are hidden for the no-workspace reseller case too. This report does **not** run a legacy-row cleanup or any database mutation (read-only documentation task), and it does **not** treat existing legacy rows as evidence of an active exploitable API gap.

---

## 8. Scope integrity

### Files changed by this task (on disk)
- `src/server/supplier.ts`
- `scripts/verify-api.mjs`

### Files NOT changed by this task
- No application source files other than `src/server/supplier.ts`.
- No `src/app/` route files.
- No Prisma schema, migrations, or `prisma/` files.
- No library files other than the normal imports of `src/server/supplier.ts`.
- No `package.json`, `package-lock.json`, `next.config.ts`, or dependency changes.
- No `STATE.md` change by this task (S-02 was moved to resolved by the separate documentation update; this task did not touch `STATE.md`).
- No billing, entitlement, or C-03 files touched.

### Findings not started or modified by this task
- S-01: not modified (accepted separately, Stage 2 Task 9).
- S-14: not modified (accepted separately, Stage 2 Task 8).
- S-03, S-09, S-12, S-15: not started, not modified.
- No other finding started.

### Historical source note
The repository HEAD tracks only 10 files; `src/server/supplier.ts` is a working-tree file. The original pre-Task-10B write-side code is reconstructed from the staged reproduction and remediation described in `STAGE2_TASK3A_S02_REPORT.md`, the Task 10 review notes, and the on-disk current code + isolated-E2E results — **not** from a verified Git diff. This report does not claim a verified Git diff where none exists.

---

## 9. Conclusion

- The **real** S-02 vulnerability (cross-workspace `customerOrderId` link + supplier-side customer PII disclosure) was **remediated by Task 3A** and verified by staged reproduction in `STAGE2_TASK3A_S02_REPORT.md`.
- **Task 10B** made the no-workspace rejection **explicit/unconditional** on the write side and added an **explicit no-workspace short-circuit** on the read side. These are **clarification + defense-in-depth**, not the fix for a demonstrated no-workspace bypass, because:
  - the pre-Task-10B `createSupplierOrder()` already rejected a no-workspace reseller's link (via `owned = null` → throw), and
  - the pre-Task-10B read-side projection already hid the link for a no-workspace reseller (because `linkBelongsToWorkspace` was false when a link existed and `resellerWorkspaceId` was null).
- There is **no other production write path** for `SupplierOrder.customerOrderId`; the link is write-once in `createSupplierOrder`, protected by the workspace check.
- Typecheck, production build, and the isolated E2E harness all pass; `prisma/dev.db` fingerprint is unchanged (`522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`, 589824 bytes).
- Per the owner's disposition, **S-02 is recorded as remediated by Task 3A, with Task 10B classified as clarification + read-side defense-in-depth — not as the fix for a demonstrated active no-workspace bypass.** `STATE.md` has been updated accordingly (S-02 moved to resolved; Task 3A listed as the remediation; Task 10B listed as clarification/defense-in-depth). S-01 and S-14 remain accepted. Phase 0 validation remains incomplete.

**Documentation-only task complete.** No production source, tests, schema, migrations, configuration, or database records were changed by this documentation update beyond the two working-tree files already edited by Task 10B (`src/server/supplier.ts`, `scripts/verify-api.mjs`) and the documentation files (`STATE.md`, `STAGE2_TASK10B_S02_REMEDIATION_REPORT.md`). Further follow-ups (optional legacy-row audit query, broader no-workspace-reseller product policy) are out of scope here.

*End of report.*
