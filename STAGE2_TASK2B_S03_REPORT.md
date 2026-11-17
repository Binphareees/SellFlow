# SellFlow — Stage 2, Task 2B: S-03 (Claim Status Authorization) Report

**Date:** 2026-11-04
**Authorization:** Implementation GO, D-019 (2026-11-04). Phase 0 validation remains incomplete; this report does not claim the platform is pilot-safe.
**Scope:** S-03 only. S-02, S-04 and every other finding are untouched. No schema, migration, seed, dependency, billing or entitlement change was needed.

---

## 1. Root cause and affected files

| File | Symbol | Role in the defect |
|---|---|---|
| `src/lib/validation.ts` | `claimCreateSchema.status` | `z.enum(CLAIM_STATE).default("SENT")`. `CLAIM_STATE` includes the **decision** states `CONFIRMED`, `DISPUTED` and `PARTIAL`, so the request body could name any of them and the schema accepted it. |
| `src/server/supplier.ts` | `recordPaymentClaim()` (≈ line 752) | Wrote `status: input.status` verbatim into `PaymentStatusClaim`. Party check (`isSupplier`/`isReseller`) was correct, but nothing constrained the initial state. |
| `src/server/supplier.ts` | `decidePaymentClaim()` | Correct before this task: only the counterparty may decide, and a claim already `CONFIRMED`/`DISPUTED` cannot be decided again. This is exactly why a forged state was exploitable — it could not be undone. |
| `src/app/api/supplier/orders/[id]/claims/route.ts` | `POST` | Thin: `requireAuth` → `readBody(claimCreateSchema)` → `recordPaymentClaim`. No role-to-status logic, so the service was the only possible enforcement point. |
| `prisma/schema.prisma` | `PaymentStatusClaim`, `CLAIM_STATE` | Enum already contains `SENT`, `RECEIVED`, `PARTIAL`, `CONFIRMED`, `DISPUTED`. Unchanged. |

**Root cause.** Claim *creation* and claim *decision* shared one status enum, and creation trusted the client's choice from it. A claimant could therefore pre-set the outcome of their own claim:

- `status: "CONFIRMED"` → written as confirmed. `decidePaymentClaim()` then answers `409` ("This claim has already been decided"), so the counterparty could never dispute it, and `confirmedTotalKobo` counted it toward the order's confirmed payments.
- `status: "DISPUTED"` → forced the order into a disputed payment state without the supplier ever responding.
- `status: "PARTIAL"` → same class of forgery, and it is a decision state in this model.

The workflow already defined the correct rule by actor: a reseller declares money **sent**, a supplier records money **received**, and the counterparty confirms or disputes. Creation simply did not enforce it.

---

## 2. Tests added

Added to `scripts/verify-api.mjs` — section **“S-03: a claim's initial state belongs to the actor, not the body”**, 17 assertions inserted after the existing confirm-claim step (same order, same fixtures):

| # | Assertion | Expected |
|---|---|---|
| 1–4 | Reseller creates a claim with `CONFIRMED`, `DISPUTED`, `PARTIAL`, `RECEIVED` | `400` each |
| 5 | Claim count on the order is unchanged after the four rejected attempts | `1 → 1` |
| 6 | Reseller creates a claim with the permitted state `SENT` | `201`, claim `SENT` |
| 7 | Reseller omits `status` entirely | `201`, claim still `SENT` (derived, not defaulted) |
| 8 | Supplier creates a claim with `RECEIVED` on the same order | `201`, claim `RECEIVED` |
| 9–12 | Supplier creates a claim with `CONFIRMED`, `DISPUTED`, `PARTIAL`, `SENT` | `400` each |
| 13 | Claimant posts a decision on their own claim | `403` |
| 14 | Unrelated account posts a decision | `403` |
| 15 | After both denied decisions the claim is still `SENT` | true |
| 16 | The counterparty (supplier) confirms that claim | `200` |
| 17 | The claim then reads `CONFIRMED` — decision endpoint is the only path | true |

Legitimate flows are covered inside the same assertions rather than asserted twice: the original suite already exercises reseller claim → supplier confirm → dispatch → delivery, and that sequence still passes unchanged.

---

## 3. Evidence of failure before the fix

`npm run test:e2e:clean -- --skip-build` against the **unmodified** application:

```
harness_exit=1
pass=155 fail=9

FAIL  a reseller cannot create a claim as CONFIRMED (S-03) — status 201
FAIL  a reseller cannot create a claim as DISPUTED (S-03) — status 201
FAIL  a reseller cannot create a claim as PARTIAL (S-03) — status 201
FAIL  a reseller cannot create a claim as RECEIVED (S-03) — status 201
FAIL  a rejected claim writes nothing (S-03) — 1 → 5
FAIL  a supplier cannot create a claim as CONFIRMED (S-03) — status 201
FAIL  a supplier cannot create a claim as DISPUTED (S-03) — status 201
FAIL  a supplier cannot create a claim as PARTIAL (S-03) — status 201
FAIL  a supplier cannot create a claim as SENT (S-03) — status 201
9 CHECK(S) FAILED
```

`1 → 5` is the material proof: four forged claims were persisted on the order, one of them pre-`CONFIRMED`. The API stage aborted the harness, so the 31 PWA checks did not run in this baseline (155 + 9 = 164 API assertions; 195 total after the fix).

Assertions that already held before the change and had to keep holding:

```
PASS  claimant cannot confirm their own claim — status 403
PASS  reseller marks payment as sent — 201
PASS  supplier confirms the payment claim — 200
PASS  claim confirmation is recorded
```

---

## 4. Implementation and authorization rules

**Rule applied (existing product workflow, no new states):**

| Actor | Permitted initial status | Any other value |
|---|---|---|
| Reseller party | `SENT` (also when `status` is omitted) | `400 Bad Request` |
| Supplier party | `RECEIVED` (also when `status` is omitted) | `400 Bad Request` |
| Anyone else | — | `403 Forbidden` (unchanged party check) |

`CONFIRMED` / `DISPUTED` / `PARTIAL` remain writable **only** by `decidePaymentClaim()`, which already restricts the actor to the counterparty and refuses to re-decide a decided claim.

**Changes:**

`src/lib/validation.ts`
```ts
  /**
   * Optional and only a hint. The server derives the initial state from the
   * actor's role ("SENT" for a reseller, "RECEIVED" for a supplier) and
   * rejects anything else: CONFIRMED / DISPUTED / PARTIAL are decisions, not
   * claims (audit finding S-03).
   */
  status: z.enum(CLAIM_STATE).optional(),
```

The `.default("SENT")` was removed so "absent" is distinguishable from "explicitly SENT". Otherwise a supplier who omitted the field would have been rejected for a value they never sent.

`src/server/supplier.ts → recordPaymentClaim()`
```ts
  const initialStatus = isSupplier ? "RECEIVED" : "SENT";
  if (input.status !== undefined && input.status !== initialStatus) {
    throw badRequest(
      isSupplier
        ? "A supplier records a claim as RECEIVED; the counterparty confirms it afterwards"
        : "A reseller records a claim as SENT; only the supplier can confirm or dispute it",
    );
  }

  const claim = await prisma.paymentStatusClaim.create({
    data: {
      …
      status: initialStatus,        // was: input.status
```

While in that same write path, the no-op ternary recorded as N-03 (`status: order.status === … ? order.status : order.status`) was reduced to `data: { paymentClaimStatus: "CLAIMED" }`. It is behaviour-identical (it always wrote `order.status` back), it sits in the statement this fix touches, and leaving a dropped-lifecycle-rule artefact there invites the next reader to trust a rule that does not exist.

**Why enforcement lives in the service:** the route is a pass-through, but future callers (admin tooling, imports) would bypass a route-only check. `initialStatus` is derived from the actor's party relationship on the order, which the service already resolves — the request body only ever *loses* privileges.

**Behaviour of the decision endpoint (verified, unchanged):** `decidePaymentClaim` loads the claim with its order, rejects an actor who is neither the supplier nor the reseller party (`403`), rejects a already-decided claim (`409`), and writes `claim.status` plus the order's `paymentClaimStatus` in one transaction. No change was made there.

---

## 5. Evidence of passing tests after the fix

`npm run test:e2e:clean` (full: isolated DB + migrations + seed + production build + API + PWA):

```
harness_exit=0
pass=195 fail=0
[harness] isolation check 1 passed: canary workspace "HARNESS-MW1B3PBH" served from the temp database
[harness] isolation check 2 passed: pid 1092289 DATABASE_URL matches the temp file
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 119.8s (isolated DB, api=0, pwa=0)
```

S-03 assertions:

```
PASS  a reseller cannot create a claim as CONFIRMED (S-03) — status 400
PASS  a reseller cannot create a claim as DISPUTED (S-03) — status 400
PASS  a reseller cannot create a claim as PARTIAL (S-03) — status 400
PASS  a reseller cannot create a claim as RECEIVED (S-03) — status 400
PASS  a rejected claim writes nothing (S-03) — 1 → 1
PASS  a reseller can create a claim with the permitted initial state — status 201, claim SENT
PASS  omitting the status still derives SENT for a reseller — status 201, claim SENT
PASS  a supplier records a claim as RECEIVED — status 201, claim RECEIVED
PASS  a supplier cannot create a claim as CONFIRMED (S-03) — status 400
PASS  a supplier cannot create a claim as DISPUTED (S-03) — status 400
PASS  a supplier cannot create a claim as PARTIAL (S-03) — status 400
PASS  a supplier cannot create a claim as SENT (S-03) — status 400
PASS  a claimant cannot decide their own claim — status 403
PASS  an outsider cannot decide a claim — status 403
PASS  denied decisions leave the claim SENT (S-03) — SENT
PASS  the decision endpoint is the only path to CONFIRMED (S-03) — CONFIRMED
```

Totals: **195 assertions** (164 API + 31 PWA), 0 failures — 178 before this task plus 17 new.

---

## 6. Full API / PWA, typecheck and build results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | executed inside `test:e2e:clean` (isolated DB, separate build output) | **exit 0** |
| API suite | `scripts/verify-api.mjs` | **164 / 164** |
| PWA suite | `scripts/verify-pwa.mjs` | **31 / 31** |
| Combined | `npm run test:e2e:clean` | **PASSED**, 119.8 s, exit 0 |
| Isolation | canary served from temp DB; `/proc/<pid>/environ` `DATABASE_URL` matched | both passed |
| Pre-existing servers | `ss -ltnp` after the run | `:3000` pid 2802, `:4318` pid 1057494, `:4322` pid 927563 — all still listening, none signalled or restarted |

Note on build-directory constraints: the harness builds and runs against its own temp database, but Next's build still writes the shared `.next` directory, as in the previous task. The two preview servers on `:4318`/`:4322` survived the run and were confirmed listening afterwards; nothing was stopped.

---

## 7. Project database unchanged

| Evidence | Value |
|---|---|
| `md5sum prisma/dev.db` before and after | `2ee44e7855bc5442c6e9c0d535eb8f0d` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` | **not run** |
| Migrations / seed | applied only inside `/tmp/sellflow-e2e-*/test.db`, which the harness deletes |

---

## 8. Limitations and remaining concerns

1. **S-03 is fixed for claim creation only.** Claim *existence* rules are still loose: a supplier or reseller can open a new claim on an order at any lifecycle point, with no cap on number of claims or on the cumulative claimed amount. That is S-11 territory and was deliberately not touched.
2. **Only rejections, not attempts, are recorded.** A forged `status` returns 400 but leaves no `AuditLog` row or metric; detecting someone probing privileged states depends on future audit work (S-12).
3. **The enum is still permissive at the schema level.** `claimCreateSchema` accepts the literal string `CONFIRMED` and then the service rejects it. Narrowing the enum would move the failure to a `422` validation error; I kept service-layer enforcement because the task requires it there and it produces an actionable message. Behaviourally both refuse; the tests assert `400`.
4. **`PARTIAL` is treated as a decision state.** It is accepted only from `decidePaymentClaim`. No creation path legitimately needs it today, so nothing regressed.
5. **Decision-endpoint coverage is behavioural, not exhaustive.** Self-decision, outsider decision, denied-attempt immutability and the happy path are now asserted. The `409` re-decision guard and the disputed-order side effects are covered by the existing suite's dispute flow, but there is no dedicated assertion for re-deciding a claim.
6. **Suppliers can still record a claim after a dispute exists**, and payable-order states are not re-checked; that overlaps S-04's missing lifecycle rules.
7. **The UI was not changed.** `ClaimForm` already sent the correct status per role, so the fix only removes an over-privileged server path; no user-visible behaviour changes for legitimate use.
8. **Phase 0 remains incomplete.** S-02, S-04, S-05…S-15 are still open; nothing here should be read as pilot readiness.

---

## 9. Exact list of changed files

| File | Change |
|---|---|
| `src/lib/validation.ts` | `claimCreateSchema.status` is now optional (no `default("SENT")`) with a comment defining it as a hint only. |
| `src/server/supplier.ts` | `recordPaymentClaim()` derives `initialStatus` from the actor's party role, rejects any other supplied value with `400`, writes the derived value, and drops the no-op `status` ternary on the order update. |
| `scripts/verify-api.mjs` | 17 S-03 regression assertions (forged states for both actors, no-write check, permitted states, implicit derivation, decision authorization, immutability of denied decisions, decision-only path to `CONFIRMED`). |
| `STAGE2_TASK2B_S03_REPORT.md` | This report. |

Not changed: `prisma/schema.prisma`, migrations, `prisma/seed.ts`, dependencies, billing/entitlements, decision endpoint logic, UI components, other findings, `prisma/dev.db`.

**S-03 fix complete. Stopping for review; S-02 and S-04 have not been started.**
