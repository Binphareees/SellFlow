# SellFlow v0.2 — Technical & Product Audit Report

**Audit date:** 2026-11-04
**Repository:** `/home/binpharees/Documents/SellFlow-Bootcamp-v2`
**Auditor role:** Read-only technical/product auditor
**Authorized write:** This file only (`SELLFLOW_V02_AUDIT_REPORT.md`)

**Approved status at time of audit:**

| Item | Status |
|---|---|
| PRD v0.2 | Approved |
| Phase 0 validation gate | Pending |
| GO decision | Not granted |
| Further implementation | Not authorized — *historical: state at audit time; implementation was authorized on 2026-11-04 by D-019. See the clarification below.* |

> **Audit constraint:** No application code, schema, migration, dependency, database row, seed data, or existing document was modified. The only file created is this report. The project database `prisma/dev.db` was inspected read-only and was **not** written to. The full API suite was run against a **copy** of that database in `/tmp/opencode`.

---

## Status clarification (added 2026-11-04, after the audit)

This block is the only authorization-related change to this report. The audit's findings, severities, evidence and recommendations below are preserved exactly as issued and were **not** rewritten.

- On **2026-11-04** the project owner granted **Implementation GO** (`STATE.md` D-019) and chose to resume development while Phase 0 validation stays open. Implementation is therefore **authorized from that date forward**.
- Every statement in this report that implementation was “not authorized”, “frozen”, or that the audit recommended keeping it frozen describes the state **at audit time** (2026-11-04, before the owner's decision). Those statements remain historically accurate.
- **Nothing else changed:** Phase 0 is still pending, no validation GO has been granted, no interview, commitment or concierge evidence exists, and audit findings **S-01 to S-15 remain open at their original severities**. No finding is resolved, downgraded or waived.
- The P0 fixes, the missing PRD text (D-08/C-01) and the billing-scope decision (C-03) are still required; they are now tracked as authorized implementation work rather than as blockers to starting work.

---

## 1. Executive summary

SellFlow is a substantial, well-engineered Next.js 15 application. It has a real server-side data model (31 Prisma models), session authentication, role-based access control, a marketplace with server-enforced private reseller pricing, versioned agreements, a supplier-order lifecycle, a dispute/mediation workflow, and an installable PWA. Type checking, Prisma validation, the production build, the PWA suite, and the full API suite all pass.

However, the project is **not ready for a pilot or a GO decision**:

1. **The PRD v0.2 document is not in the repository.** No file matching `*prd*` exists. The only reference is a single sentence in an imported conversation attachment (`.cloud-attachments/imported-conversation-*.json`) citing “Section 21.1 of the approved SellFlow PRD v0.2.” A clause-by-clause compliance audit is therefore impossible. The compliance matrix in §4 is built from the task’s A–J functional areas and the in-repo specifications, and is explicitly marked as reconstructed.
2. **The documented project status contradicts the approved status.** `STATE.md` says “Phase 1 - Build,” “Implementation: In progress,” and records D-010 (“Skip the validation gate and build V1”). That directly conflicts with “Phase 0 Pending / GO not granted / implementation not authorized.”
3. **There are blocking security defects.** The most serious is a cross-tenant dispute disclosure: any authenticated user can call `GET /api/disputes?scope=all` and receive every dispute in the system. There are also a cross-tenant order-link IDOR, self-assigned payment-claim states, and an unrestricted supplier status transition endpoint.
4. **Out-of-scope subscription/billing functionality is fully built** — schema, migration, four API routes, UI, plan enforcement, seed data, and tests. It is explicitly outside V1 scope and also changes V1 behavior through feature/capacity gates.
5. **Phase 0 has no evidence.** Segment/country is undecided, the competitor check is not done, there are 0 tester commitments, and the interview/pilot trackers are blank templates.

**Overall verdict: NOT READY.** Engineering quality is high, but security, documentation integrity, scope control, and Phase 0 evidence all fail the gate. Implementation should remain frozen until the P0 items in §10 are resolved and Phase 0 produces a recorded GO.

---

## 2. Architecture

### 2.1 Runtime and stack (actual)

| Layer | Implementation |
|---|---|
| Framework | Next.js 15.5.28, App Router, React 19 |
| Language | TypeScript 5 |
| Database | SQLite via Prisma 6.19.3 |
| Auth | First-party sessions: bcrypt password hashes (cost 12), random token stored as salted SHA-256 digest, httpOnly `SameSite=Lax` cookie |
| Validation | Zod 4 at every API boundary |
| Styling | Plain CSS (`src/app/globals.css`) |
| PWA | Hand-written `public/sw.js`, `public/manifest.json`, self-contained `public/offline.html` |
| Deployment | Next.js `standalone` output; multi-stage `Dockerfile`; `docker-compose.yml` with an optional `pilot` profile |

### 2.2 Source layout

```
prisma/
  schema.prisma              31 models
  migrations/                3 migrations
  seed.ts                    demo data
src/
  app/
    api/                     51 route files
    (app)/                    authenticated workspace, supplier, reseller, disputes, billing
    marketplace/              public discovery + listing detail
    login/, register/         auth screens
  components/                client forms, shell, PWA registration
  lib/
    api.ts                   route wrapper, error envelope, no-store
    validation.ts            all request schemas
    auth/                    session, RBAC, password
    plans.ts, subscription.ts plan catalogue + server entitlement checks
    money.ts                 integer-kobo money + WhatsApp text
    enums.ts                 string enums
    audit.ts                 append-only audit writer
  server/
    workspace.ts             customers, products, orders, payments, promises, dashboard
    supplier.ts              listings, offers, agreements, supplier orders, claims, disputes linkage
    price-access.ts          the only reader of private reseller prices
    disputes.ts              dispute visibility, events, resolution
    accounts.ts              registration, authentication, verification
public/
  sw.js, manifest.json, offline.html, icons/
scripts/
  verify-api.mjs             135-check end-to-end suite (includes PWA checks)
  verify-pwa.mjs             production-bundle PWA checks
  seed-pilot.mjs             Phase 0 onboarding tool
  deploy.sh
```

### 2.3 Data model (31 models)

Identity and access: `User`, `Profile`, `ProfileRole`, `VerificationEvent`, `Session`.
Workspace: `BusinessWorkspace`, `Customer`, `Product`, `CustomerOrder`, `OrderItem`, `ManualPayment`, `PaymentPlan`, `PaymentPromise`.
Marketplace: `SupplierProfile`, `ProductListing`, `ResellerOffer`, `ResellerOfferVersion`, `ResellerApplication`, `ResellerAgreement`, `ResellerAgreementVersion`, `NegotiationProposal`.
Fulfilment: `SupplierOrder`, `SupplierOrderItem`, `PaymentStatusClaim`, `DispatchRecord`, `DeliveryConfirmation`.
Disputes: `Dispute`, `DisputeEvent`.
Billing (out of scope): `Subscription`, `SubscriptionPayment`.
Audit: `AuditLog`.

Money is stored as integer kobo throughout; `src/lib/money.ts` is the single conversion/formatting layer. The SQLite database currently has 32 tables including `_prisma_migrations`.

### 2.4 Request and authorization flow

- API handlers are wrapped by `route()` in `src/lib/api.ts`, which converts `ApiError` and Zod failures into JSON and sets `Cache-Control: private, no-store`.
- `getAuthContext()` resolves the session from the httpOnly cookie; `requireAuth`, `requireWorkspace`, `requireRole`, `requireSupplier`, `requireReseller`, `requirePlatformAdmin`, and `requireMediator` gate routes.
- Workspace queries always take `workspaceId` from the session, never from the request body.
- Private reseller prices are read only inside `src/server/price-access.ts`; public listing queries deliberately omit price columns. This design is sound and is verified by the API suite.
- Audit events are written through `src/lib/audit.ts`; failures are logged and swallowed so they never break a request.

### 2.5 Architectural strengths

- Clear separation of route handlers, services, validation, and presentation.
- Consistent integer-money discipline.
- Strong private-price isolation with denial reason codes and audited denials.
- Server-rendered authorization on every page; no client-side “logged in” guess.
- Conservative service worker that never caches HTML or API responses.
- Explicit error envelope and no internal error leakage.

### 2.6 Architectural risks

- SQLite is a single-file database with limited concurrent-write behavior; the Postgres migration is only described, not implemented.
- No background job/queue; reminders are links, not scheduled messages.
- No file storage; product images are JSON URLs.
- No explicit transition/state-machine layer for supplier orders.
- Audit writes are best-effort, not transactional.
- Billing/entitlement checks are woven into workspace and supplier services, so removing out-of-scope billing later is not a clean deletion.

---

## 3. Feature inventory

Legend: **Verified** = exercised by an automated test or a live read-only HTTP check during this audit; **Present** = code exists but was not exercised end-to-end; **Partial** = exists but a required behavior is missing or unenforced.

### 3.1 Identity and accounts

| Feature | Status | Notes |
|---|---|---|
| Email/password registration | Verified | Creates `User → Profile → BUSINESS_OWNER role → BusinessWorkspace` in one transaction |
| Login/logout | Verified | Generic invalid-credentials message; session revocation on logout |
| Session cookie | Verified | httpOnly, `SameSite=Lax`, `Secure` in production, 30-day default TTL |
| Role model | Present | `BUSINESS_OWNER`, `RESELLER`, `SUPPLIER`, `MEDIATOR` |
| Verification tiers | Partial | Tier 1 granted at registration without email verification; tiers 2–3 admin-only |
| Platform admin | Present | `isPlatformAdmin` flag; admin verification and billing decision routes |
| Password reset/change | Missing | No route or UI |
| Email verification | Missing | No token/flow; `emailVerifiedAt` is not set on registration |
| Account restriction workflow | Missing | `disabledAt` exists and is checked, but no admin route/UI to set it |

### 3.2 Business workspace

| Feature | Status | Notes |
|---|---|---|
| Customers CRUD + search + soft delete | Verified | Workspace-scoped; soft delete via `deletedAt` |
| Products CRUD + stock quantity | Verified | Selling and cost prices in kobo |
| Orders with line items | Verified | Server computes totals and cost snapshot |
| Manual payments + void | Verified | Overpayment rejected; void preserves history |
| Payment plans / promises | Verified | Promise list and WhatsApp reminder text |
| Balances and payment state | Verified | `UNPAID` / `PART_PAID` / `PAID` derived |
| Gross profit | Verified | `totalKobo − costKobo` |
| Expenses / net profit | Missing | No expense model or calculation |
| Order edit / delete / undo | Missing | Only status PATCH; no line-item edit, no order soft delete |
| Receipts / statements | Missing | No generated receipt, PDF, or statement |
| CSV import/export | Missing | No import/export route or UI |
| In-app notifications | Missing | Only WhatsApp deep links |
| File uploads | Missing | Images are URL strings |

### 3.3 Marketplace and reseller network

| Feature | Status | Notes |
|---|---|---|
| Public listings, search, category/price/stock filters, sort | Verified | Server-side; no private price columns selected |
| Supplier directory and storefront | Verified | Public |
| Listing detail with locked private price | Verified | Guest gets `resellerPrice.allowed = false`; no price/terms fields in body |
| Reseller application | Verified | Self-service; supplier approves/rejects |
| Agreement + versioned terms | Verified | Historical order prices locked to agreement version |
| Negotiation proposals | Present | Counter-offers create a new agreement version; acceptance sets both party timestamps at once |
| Minimum resale price enforcement | Missing | Stored and returned, never checked when a reseller records a resale price |
| Advertising permission enforcement | Missing | Stored and returned, never checked |
| Commission calculation | Missing | Stored and returned, never applied to any payout |
| Payment terms / delivery responsibility enforcement | Missing | Stored and returned, not enforced |
| Customer data visibility enforcement | Partial | `NONE` hides identity; `ORDER_ONLY` is treated like `FULL` and exposes name/phone |
| Completed-order reviews / reputation | Missing | No review model or UI |

### 3.4 Supplier orders and fulfilment

| Feature | Status | Notes |
|---|---|---|
| Reseller creates supplier order from agreed prices | Verified | Client-sent prices ignored |
| Stock confirmation | Partial | Records confirmed qty but does not validate against ordered qty or decrement listing stock |
| Payment status claims | Partial | Party claims work, but create-time status can be `CONFIRMED`/`DISPUTED` |
| Counterparty confirm/dispute | Verified | Only the other party can decide |
| Dispatch record | Verified | Courier/tracking fields |
| Delivery confirmation | Verified | Received-qty flag moves to `DELIVERED` or `DISPUTED` |
| Status transitions | Partial | Supplier PATCH accepts any lifecycle status with no transition rules |
| Cancellation stock restoration | Missing | Customer-order stock decrement is never restored on cancel/delete |
| Order-level messaging/notifications | Missing | No in-app notification |

### 3.5 Disputes and mediation

| Feature | Status | Notes |
|---|---|---|
| Raise dispute from order or claim | Verified | Party check enforced |
| Dispute list and counts | Partial | Party scoping is bypassable via `scope=all` |
| Append-only event trail | Verified | Events persist and are ordered |
| Mediator review/outcome/close | Verified | Mediator-only transitions |
| Claim settlement on resolution | Verified | Resolving a claim dispute settles the claim |
| Appeals workflow | Missing | No appeal model or route |
| Account restriction tied to disputes | Missing | No enforcement workflow |

### 3.6 PWA, offline, and mobile

| Feature | Status | Notes |
|---|---|---|
| Installable manifest + icons | Verified | 31/31 PWA checks pass |
| Service worker scope and cache boundaries | Verified | Never caches HTML or `/api/*` |
| Offline fallback screen | Verified | Static `offline.html` with retry |
| Offline record creation/editing | Missing | App requires network for all writes |
| Offline sync / conflict resolution | Missing | No queue, no conflict strategy |
| Hausa / i18n | Missing | English-only strings; no locale layer |

### 3.7 Billing (out of V1 scope)

| Feature | Status | Notes |
|---|---|---|
| Plan catalogue (FREE/PRO/SUPPLIER_PRO) | Present | `src/lib/plans.ts` |
| Manual upgrade claim | Present | `/api/billing/upgrade` |
| Admin payment decision | Present | `/api/billing/payments/[id]/decision` |
| Cancel at period end | Present | `/api/billing/cancel` |
| Feature/capacity enforcement | Present | `assertFeature`, `assertCapacity` used in workspace and supplier services |
| Gateway/card/wallet/escrow | Absent | Consistent with D-013 |

---

## 4. PRD compliance matrix

> **Critical limitation:** The approved PRD v0.2 source document is absent from the repository. The only artifact is a one-line citation in `.cloud-attachments/imported-conversation-8531d94e174765bae96644b652aed29d33da0f370cc1578b9b5d8fa9df690b14.json`. Consequently, exact clause numbers and wording cannot be verified. The A–J areas below are the audit’s reconstruction from the task brief, `README.md`, `MVP_SPEC.md`, `VALIDATION_PLAN.md`, `STATE.md`, and the implemented product. Treat this matrix as a functional gap analysis, not a verbatim PRD conformance certificate.

Status key:
- **Implemented and verified** — present and exercised by tests/live checks.
- **Implemented but untested** — present, no direct test evidence.
- **Partially implemented** — present but a required behavior is missing or unenforced.
- **Not implemented** — absent.
- **Cannot determine** — PRD text unavailable.

| ID | Requirement area | Status | Evidence / gap |
|---|---|---|---|
| A | Business workspace bookkeeping: customers, products, orders, deposits/installments, balances, promises | **Implemented and verified** | Workspace API and UI; API suite covers orders, overpayment, payments, promises |
| A2 | Expenses and net profit | **Not implemented** | Only gross profit (`total − cost`); no expense model |
| B | WhatsApp reminders | **Implemented and verified** | `whatsappReminderText` / `whatsappPromiseReminderText`; `wa.me` links; UI buttons |
| B2 | Receipts and statements | **Not implemented** | No receipt/statement generator or share sheet |
| B3 | CSV import/export and backup/restore | **Not implemented** | No route or UI |
| C | Marketplace discovery: search, filters, sort, supplier storefront, comparison | **Implemented and verified** | API suite covers search, category, price band, stock, sort, supplier filter, storefront |
| D | Private reseller pricing and price privacy | **Implemented and verified** | Guest price 403; no `resellerPriceKobo`/terms in public responses; suite asserts absence |
| E | Reseller applications, agreements, versioned terms, negotiation | **Implemented and verified** | Suite covers application approval, agreement activation, version locking |
| E2 | Commercial term enforcement (min resale, advertising, commission, payment terms, delivery) | **Partially implemented** | Terms are stored/returned but not enforced at order time |
| E3 | Customer data visibility (`NONE`/`ORDER_ONLY`/`FULL`) | **Partially implemented** | `ORDER_ONLY` exposes customer name/phone like `FULL` |
| F | Supplier order lifecycle: stock, payment claims, dispatch, delivery | **Partially implemented** | Lifecycle works and is tested, but transitions are unrestricted and claim states are self-assignable |
| F2 | Stock reservation, decrement, restoration | **Partially implemented** | Customer-order stock decrements; supplier confirmation does not; cancellation never restores |
| G | Disputes and mediation | **Partially implemented** | Workflow tested, but `scope=all` bypasses party scoping; no appeals |
| H | Accounts, roles, verification tiers, sessions | **Partially implemented** | Auth/RBAC solid; no email verification, no password reset/change, no restriction workflow |
| I | PWA installability and offline fallback | **Implemented and verified** | 31/31 PWA checks pass |
| I2 | Offline record creation/editing, sync, conflict resolution | **Not implemented** | Network required for writes; static offline page only |
| J | Subscription/billing/plan enforcement | **Implemented and verified** | Four billing routes, schema, UI, seed, tests; explicitly out of scope for V1 |
| K | Phase 0 validation gate | **Not implemented** | No segment, no competitor check, 0 commitments, blank trackers, no GO record; PRD text unavailable |
| L | Hausa / i18n | **Not implemented** | English-only |
| M | Reviews / reputation after completed orders | **Not implemented** | No model or UI |
| N | Appeals workflow | **Not implemented** | No model or route |

**Compliance conclusion:** Of the reconstructed areas, the core workspace, marketplace, private pricing, agreements, reminders, and PWA are implemented and verified. The supplier lifecycle, commercial terms, customer-data visibility, stock, disputes, and accounts are partial. Receipts, CSV, expenses, notifications, i18n, reviews, appeals, offline sync, and the Phase 0 gate are missing. Exact PRD v0.2 conformance cannot be certified without the document.

---

## 5. Security findings

Severity reflects exploitability and impact in a multi-tenant pilot. No credentials, tokens, or secrets are reproduced in this report.

### S-01 — CRITICAL: any authenticated user can list every dispute

- **Endpoint:** `GET /api/disputes?scope=all`
- **Files:** `src/app/api/disputes/route.ts`, `src/server/disputes.ts` (`listDisputes`)
- **Problem:** `listDisputes` sets `scope = options.scope ?? (moderator ? "all" : "mine")`. When the caller explicitly passes `scope=all`, the function applies `{}` as the `where` clause and never checks `isMediator(viewer)`. The route accepts `scope=all` from any authenticated user.
- **Impact:** Cross-tenant disclosure of every dispute: order numbers, supplier business names, claim amounts, statuses, and event counts. This violates the core multi-tenant boundary and the dispute privacy rule stated in the module’s own comment.
- **Correction:** Only honor `scope=all` when `isMediator(viewer)` is true. For non-moderators, always apply `VISIBLE_TO_PARTY(viewer.profile.id)` and ignore or reject `scope=all`. Add an API test asserting a non-party, non-mediator receives zero disputes even with `scope=all`.

### S-02 — HIGH: unvalidated `customerOrderId` creates a cross-tenant order link (IDOR)

- **Endpoint:** `POST /api/supplier/orders`
- **Files:** `src/server/supplier.ts` (`createSupplierOrder`, line ~610), `src/lib/validation.ts` (`supplierOrderCreateSchema`, line ~227)
- **Problem:** `customerOrderId` is accepted as any valid CUID. The service writes it directly to `SupplierOrder.customerOrderId` without verifying that the referenced `CustomerOrder` belongs to the caller’s workspace. `getSupplierOrder` then includes `customerOrder.customer.name` and `customerOrder.customer.phone` for the supplier.
- **Impact:** A reseller who obtains or guesses another workspace’s customer-order ID can attach it to a supplier order, causing that customer’s name and phone to be disclosed to a supplier. It also corrupts order coordination data.
- **Correction:** When `customerOrderId` is supplied, load the order and require `customerOrder.workspaceId === <caller’s workspaceId>` and `deletedAt === null`; otherwise reject with 403/404. Prefer deriving the link server-side rather than trusting the body.

### S-03 — HIGH: payment-claim state can be self-assigned as `CONFIRMED` or `DISPUTED`

- **Endpoint:** `POST /api/supplier/orders/[id]/claims`
- **Files:** `src/server/supplier.ts` (`recordPaymentClaim`, line ~772), `src/lib/validation.ts` (`claimCreateSchema`, line ~265)
- **Problem:** `claimCreateSchema.status` uses `CLAIM_STATE`, which includes `CONFIRMED` and `DISPUTED`. `recordPaymentClaim` writes the caller-supplied status directly. `decidePaymentClaim` refuses to act on a claim already in `CONFIRMED` or `DISPUTED` (“This claim has already been decided”), and counts `CONFIRMED` claims toward the confirmed total.
- **Impact:** A claimant can create a pre-`CONFIRMED` claim that the counterparty can never dispute, or a pre-`DISPUTED` claim that forces the order into `DISPUTED`. This undermines the payment-integrity model and can prematurely satisfy the confirmed-total calculation.
- **Correction:** On creation, allow only non-terminal states (`SENT`, `RECEIVED`, `PARTIAL`) and derive them server-side from the caller’s role. Terminal states must be set only by `decidePaymentClaim`. Add tests for both directions.

### S-04 — HIGH: supplier can jump the order lifecycle to any status

- **Endpoint:** `PATCH /api/supplier/orders/[id]`
- **Files:** `src/app/api/supplier/orders/[id]/route.ts`, `src/server/supplier.ts` (`setSupplierOrderStatus`, line ~980)
- **Problem:** The route validates only that `status` is a member of `SUPPLIER_ORDER_STATUS`. The service writes it with no transition table, no required predecessor state, and no required evidence (stock confirmation, dispatch, delivery confirmation, confirmed payment).
- **Impact:** A supplier can move `SUBMITTED → DELIVERED` or `→ COMPLETED`/`PAID`, bypassing stock confirmation, dispatch, delivery confirmation, and payment claims. This destroys the meaning of the lifecycle and the audit trail, and can be used to hide non-fulfilment.
- **Correction:** Implement an explicit transition map per actor. Only allow forward transitions the supplier owns; require a dispatch record before `DISPATCHED`, a delivery confirmation before `DELIVERED`, and confirmed claims before `PAID`/`COMPLETED`. Reject unknown transitions with 409.

### S-05 — MEDIUM: no authentication rate limiting or account lockout

- **Endpoint:** `POST /api/auth/login`
- **Files:** `src/app/api/auth/login/route.ts`, `.env.production.example` (lines ~70–77)
- **Problem:** `.env.production.example` documents `MAX_AUTH_ATTEMPTS` and explicitly notes that the build does not read it. The login route has no per-account or per-IP throttle.
- **Impact:** Credential stuffing and brute force are unthrottled, especially against the published demo accounts if seed data reaches a shared environment.
- **Correction:** Implement server-side per-account and per-IP counters with backoff/lockout, or require a documented reverse-proxy rate limit and make the app fail closed if it is absent. Remove the misleading env key or wire it up.

### S-06 — MEDIUM: demo credentials are published and seeded with a shared password

- **Files:** `README.md` (lines ~65–67), `src/app/page.tsx` (landing page), `prisma/seed.ts`
- **Problem:** The README and the public landing page publish demo account emails and a shared password. The seed creates supplier, reseller, mediator, and platform-admin accounts with that shared password.
- **Impact:** Any deployment that runs the seed with default data exposes privileged accounts. The mediator account can read every dispute; the admin account can verify profiles and decide billing payments.
- **Correction:** Remove credentials from the public landing page and README. Gate `prisma/seed.ts` to non-production, generate random per-run passwords, and require an explicit admin bootstrap secret. Rotate any credentials used in shared environments.

### S-07 — MEDIUM: registration grants verification tier 1 without email verification

- **File:** `src/server/accounts.ts` (`registerAccount`, line ~34)
- **Problem:** `verificationTier: 1` is set at registration with the comment “email is verified by the account itself,” but no email verification occurs and `emailVerifiedAt` is not set.
- **Impact:** Unverified contact details are presented as “contact verified,” inflating trust and enabling abuse of marketplace applications.
- **Correction:** Start at tier 0; grant tier 1 only after a verified email/phone challenge. Add a verification event when the tier changes.

### S-08 — MEDIUM: `ORDER_ONLY` customer-data visibility leaks customer identity

- **File:** `src/server/supplier.ts` (`getSupplierOrder`, lines ~666–674)
- **Problem:** The code hides the customer only when visibility is exactly `NONE`. `ORDER_ONLY` and `FULL` both return `customer.name` and `customer.phone`.
- **Impact:** A supplier sees end-customer identity under an agreement that was supposed to expose only order-level data.
- **Correction:** Define `ORDER_ONLY` to return order metadata with the customer identity redacted (or only a masked name), and reserve `FULL` for name/phone. Add tests for all three values.

### S-09 — MEDIUM: no password reset or change flow

- **Files:** none (absent)
- **Problem:** There is no reset-token model, no reset route, and no change-password endpoint.
- **Impact:** Users who forget a password are permanently locked out; support must edit the database. This is a pilot blocker.
- **Correction:** Add a single-use, expiring reset token (hashed at rest), a reset route, and an authenticated change-password route that revokes other sessions.

### S-10 — MEDIUM: commercial terms are stored but not enforced

- **Files:** `src/server/price-access.ts`, `src/server/supplier.ts`
- **Problem:** `minResalePriceKobo`, `advertisingPermission`, `commissionType`, `commissionValue`, `paymentTermsDays`, and `deliveryResponsibility` are selected and returned but never checked at order creation or anywhere else.
- **Impact:** A reseller can record a resale price below the agreed minimum, advertise without permission, and ignore payment/delivery terms; commission is never computed. Contractual controls are cosmetic.
- **Correction:** Enforce each term at the relevant action: reject resale prices below the minimum, gate advertising claims, compute commission on completed orders, and surface payment/delivery terms in the order lifecycle.

### S-11 — MEDIUM: stock confirmation does not validate or decrement stock; cancellation does not restore it

- **Files:** `src/server/supplier.ts` (`confirmStock`, lines ~692–730), `src/server/workspace.ts` (lines ~351–354)
- **Problem:** `confirmStock` writes `stockConfirmedQty` without checking it against the ordered quantity and without decrementing `ProductListing.stockQty` or the offer version’s `stockQty`. Customer-order creation decrements product stock with `Math.min(stockQty, qty)` but never restores it on cancellation or soft delete.
- **Impact:** Overselling, silent negative availability drift, and stock that never returns after cancellation.
- **Correction:** Validate `confirmedQty <= ordered qty`; decrement listing/offer stock on confirmation; restore on decline/cancel; record stock movements in a ledger so reconciliation is possible.

### S-12 — MEDIUM: audit trail is empty in the audited database and writes are best-effort

- **Files:** `src/lib/audit.ts`, `prisma/dev.db`
- **Problem:** The inspected database contains 0 `AuditLog` rows despite seeded marketplace and dispute activity. `audit()` swallows all write failures after logging.
- **Impact:** No forensic trail exists in the dataset under audit; in production, audit loss is silent.
- **Correction:** Seed representative audit rows, monitor/alert on audit write failure, and make security-critical audit writes part of the transaction they describe where feasible.

### S-13 — LOW: no explicit CSRF token

- **Files:** `src/lib/auth/session.ts`, all state-changing routes
- **Problem:** State-changing requests rely on `SameSite=Lax` cookies. There is no origin/referer check or CSRF token.
- **Impact:** `Lax` blocks most cross-site POSTs, but the defense is implicit and easy to weaken.
- **Correction:** Add an explicit `Origin`/`Referer` check for state-changing requests, or a double-submit CSRF token.

### S-14 — LOW: long-lived sessions without rotation

- **File:** `src/lib/auth/session.ts`
- **Problem:** Default TTL is 30 days; sessions are not rotated on login or privilege change.
- **Impact:** A stolen token remains valid for a long time.
- **Correction:** Shorten the TTL, rotate on login and role/tier changes, and provide “sign out everywhere.”

### S-15 — LOW: demo seed creates a platform admin and mediator

- **File:** `prisma/seed.ts`
- **Problem:** The seed creates privileged accounts alongside demo data.
- **Impact:** Combined with S-06, a seeded environment has privileged access with a known password.
- **Correction:** Separate demo seed from admin bootstrap; never create privileged accounts with shared credentials.

---

## 6. Testing results

All commands were run read-only with respect to the project database. The API suite mutates seeded data, so it was run only against a copy at `/tmp/opencode/sellflow-audit2.db`.

| # | Command | Result | Exit |
|---|---|---|---|
| 1 | `npx tsc --noEmit --incremental false` | No type errors | 0 |
| 2 | `npx prisma validate` | “The schema at prisma/schema.prisma is valid” | 0 |
| 3 | `npx prisma migrate status` | 3 migrations found; database schema up to date | 0 |
| 4 | `npm run build` | Production build completed | 0 |
| 5 | `npm run test:pwa` | 31/31 PWA checks passed | 0 |
| 6 | `BASE_URL=http://127.0.0.1:4318 node scripts/verify-api.mjs` (DB copy) | **135 PASS / 0 FAIL — ALL CHECKS PASSED** | 0 |
| 7 | Read-only live HTTP checks on `:4322` | See below | 0 |
| 8 | Read-only SQLite inspection | 32 tables; 4 users, 4 workspaces, 3 subscriptions, 2 customer orders, 1 supplier order, 1 dispute, 0 audit logs | 0 |

### 6.1 Live read-only HTTP checks

| Check | Observed |
|---|---|
| `/api/health` | 200 |
| Public listings | 200 |
| Public listing detail | 200 |
| Guest `resellerPrice.allowed` | `false` |
| Guest listing body contains `resellerPriceKobo` | No |
| Guest listing body contains `terms` | No |
| Guest offer price endpoint | 403 |
| Guest offer price body contains `terms` | No |
| Guest `/api/auth/me` | `authenticated: false` |
| Public suppliers | 200 |
| Unauthenticated admin verification PATCH | 401 |
| Unauthenticated `/api/billing` | 401 |

### 6.2 What the suite does not cover

The 135 passing checks are meaningful but do not cover:

- `GET /api/disputes?scope=all` as a non-moderator (S-01).
- Cross-workspace `customerOrderId` (S-02).
- Claim creation with `status: CONFIRMED`/`DISPUTED` (S-03).
- Arbitrary supplier status jumps (S-04).
- `ORDER_ONLY` customer identity exposure (S-08).
- Rate limiting/lockout (S-05).
- Password reset/change and email verification (S-07, S-09).
- Commercial term enforcement (S-10).
- Stock validation/decrement/restore (S-11).
- Offline write behavior, CSV, receipts, expenses, notifications, i18n, reviews, appeals.

**No test or build failed during this audit.** The passing suite should not be read as evidence that the findings above are absent; the suite simply does not exercise those paths.

---

## 7. Documentation conflicts

The repository contains multiple generations of documentation that contradict each other and the code. This is a material risk: an agent or developer following the wrong file will rebuild the wrong product or misstate readiness.

| # | Document | Claim | Reality | Severity |
|---|---|---|---|---|
| D-01 | `STATE.md` lines 4–5 | “Phase: 1 - Build”; “Implementation: In progress” | Approved status is Phase 0 Pending; implementation not authorized | **Critical** |
| D-02 | `STATE.md` D-010 (line 28) | Validation gate skipped; V1 built on owner instruction | Conflicts with the approved Phase 0 gate and “GO not granted” | **Critical** |
| D-03 | `STATE.md` line 39 | “29-model Prisma schema”; “41 API assertions” | Schema has 31 models; suite reports 135 checks | High |
| D-04 | `STATE.md` line 38 | “63 API assertions pass” | Suite reports 135 checks (API + PWA) | Medium |
| D-05 | `README.md` line 111 and 267 | “29 models” | 31 models | High |
| D-06 | `README.md` line 258 | “63 assertions” | 135 checks | Medium |
| D-07 | `README.md` lines 65–67 | Publishes demo emails and a shared password | Security risk; should not be public | High |
| D-08 | `MVP_SPEC.md` lines 3–16 | No accounts, no cloud sync, no inventory; IndexedDB-local | App has accounts, server DB, inventory, marketplace, disputes, subscriptions | **Critical** |
| D-09 | `TECH_STACK.md` lines 3–8 | React + Vite + IndexedDB + static host | Next.js 15 App Router + Prisma + SQLite + Node server | **Critical** |
| D-10 | `ROADMAP.md` Phase 1 | “Only after GO”; IndexedDB layer; 7-day local MVP | V1 already built on a different stack; gate not passed | High |
| D-11 | `AI_HANDOFF.md` lines 6–10 | “V1 is built and running”; directs helpers to run the pilot | Contradicts Phase 0 pending / no GO | High |
| D-12 | `VALIDATION_PLAN.md` | Phase 0 gates still open | Consistent with approved status, contradicts D-010 | — |
| D-13 | `PILOT_TRACKER.md`, `templates/PILOT_TRACKER.md`, `templates/INTERVIEW_LOG.md` | Blank templates with placeholder dates | No Phase 0 evidence exists | High |
| D-14 | `MONETIZATION_AND_LAUNCH.md` lines 18–21 | Paid plan only “later,” after repeat usage | Subscription billing is already fully built | High |
| D-15 | `scripts/deploy.sh` line 11 | “106-assertion suite” | Suite reports 135 checks | Low |
| D-16 | `.env.production.example` lines 70–77 | Documents `MAX_AUTH_ATTEMPTS` | Explicitly notes the build does not read it | Medium |
| D-17 | `STATE.md` D-013 | “No fintech surface, ever, in V1” | Manual subscription claims + admin confirmation are a payment-verification surface | Medium |

### 7.1 Recommended exact `STATE.md` changes (not applied)

The audit did not edit `STATE.md`. To align it with the approved status, apply the following:

1. **Line 4** — replace
   `**Phase:** 1 - Build (V1 foundation)`
   with
   `**Phase:** 0 - Validate (gate not passed; implementation not authorized)`

2. **Line 5** — replace
   `**Implementation:** In progress — schema, API and mobile UI for the workspace + marketplace are running locally`
   with
   `**Implementation:** Paused. V1 code exists but must not proceed until Phase 0 records a GO.`

3. **Line 28 (D-010)** — change status from `Accepted (owner instruction, 2026-11-02)` to `Superseded by audit (2026-11-04)` and append: “The Phase 0 gate is back in force; no further implementation until a recorded GO.”

4. **Add D-014** — `Phase 0 gate restored; PRD v0.2 approval does not authorize implementation` — `Accepted` — `Audit found no PRD v0.2 file, no validation evidence, and blocking security defects.`

5. **Line 38** — replace `63 API assertions pass` with `135 checks pass (API + PWA)`.

6. **Line 39** — replace `29-model Prisma schema` with `31-model Prisma schema` and `41 API assertions pass` with `135 checks pass (API + PWA)`.

7. **Add a changelog entry** — `2026-11-04: Read-only v0.2 audit completed (SELLFLOW_V02_AUDIT_REPORT.md). Status corrected to Phase 0 pending; implementation frozen pending GO.`

8. **Open items** — add `4. PRD v0.2 source document is missing from the repository; restore it or record its canonical location.`

Do **not** silently rewrite `MVP_SPEC.md`, `TECH_STACK.md`, or `ROADMAP.md`; they are historical v1 planning documents. Instead, add a short “Superseded by the server implementation — see README/STATE” banner at the top of each, or archive them.

---

## 8. Out-of-scope functionality

The following subscription/billing functionality is implemented but explicitly outside V1 scope. It is not a defect in isolation, but it is unauthorized scope and it changes V1 behavior.

### 8.1 Schema and migration

- `Subscription` model (`prisma/schema.prisma`)
- `SubscriptionPayment` model
- Migration `prisma/migrations/20261102222213_subscriptions/migration.sql`

### 8.2 Libraries

- `src/lib/plans.ts` — FREE/PRO/SUPPLIER_PRO catalogue, feature flags, limits, prices
- `src/lib/subscription.ts` — entitlements, usage, `assertFeature`, `assertCapacity`, `submitUpgrade`, `decidePayment`, `cancelPlan`

### 8.3 API routes

- `GET /api/billing`
- `POST /api/billing/upgrade`
- `POST /api/billing/cancel`
- `POST /api/billing/payments/[id]/decision` (platform admin only)

### 8.4 UI

- `src/app/(app)/settings/billing/page.tsx`
- `src/components/billing-actions.tsx`
- `src/components/upgrade-banner.tsx`
- Billing/usage links in `src/components/shell.tsx`

### 8.5 Data and tests

- Subscription seed data in `prisma/seed.ts`
- Plan/upgrade checks in `scripts/verify-api.mjs`
- Tier/capacity handling in `scripts/seed-pilot.mjs`

### 8.6 Why this matters beyond scope

`assertFeature` and `assertCapacity` are called from core workspace and supplier services. That means the out-of-scope billing system gates in-scope behavior: customer/order/product/supplier caps, negotiation proposals, and WhatsApp reminders. Removing billing later is therefore not a clean deletion; it is a behavioral change that needs an explicit decision.

**Recommendation:** Either (a) obtain explicit written authorization to include billing in V1 and update the PRD/STATE accordingly, or (b) remove the billing surface and entitlement gates before pilot, replacing them with unlimited V1 behavior. Do not leave it in an ambiguous “built but unapproved” state.

---

## 9. Missing functionality

Grouped by the reconstructed requirement areas. “Missing” means no model, route, or UI exists.

### 9.1 Core bookkeeping

- **Expenses and net profit** — only gross profit (`total − cost`) exists.
- **Receipts and statements** — no receipt/statement generator, PDF, or share sheet.
- **CSV import/export and backup/restore** — no route or UI.
- **Order edit/delete/undo** — only status PATCH; no line-item editing, no order soft delete/restore.
- **File uploads** — product images are URL strings only.

### 9.2 Marketplace and reseller network

- **Minimum resale price enforcement** — stored, not checked.
- **Advertising permission enforcement** — stored, not checked.
- **Commission calculation** — stored, not applied.
- **Payment terms and delivery responsibility enforcement** — stored, not enforced.
- **Reviews and reputation after completed orders** — no model or UI.
- **Appeals workflow** — no model or route.

### 9.3 Fulfilment and stock

- **Stock validation** — confirmed quantity is not checked against ordered quantity.
- **Stock decrement on supplier confirmation** — not performed.
- **Stock restoration on cancellation/decline** — not performed.
- **Stock movement ledger** — absent.

### 9.4 Accounts and trust

- **Email verification** — absent; tier 1 granted at registration.
- **Password reset and change** — absent.
- **Account restriction/suspension workflow** — `disabledAt` exists but no admin route/UI.
- **Session management UI** (“sign out everywhere”) — absent.

### 9.5 Communication and localization

- **In-app notifications** — absent.
- **Scheduled/recurring reminders** — only manual WhatsApp links.
- **Hausa / i18n** — English-only.

### 9.6 Offline and PWA

- **Offline record creation/editing** — absent.
- **Sync queue and conflict resolution** — absent.
- **Background sync** — absent.

### 9.7 Security and operations

- **Rate limiting / lockout** — absent (see S-05).
- **CSRF origin check** — absent (see S-13).
- **Audit log reliability** — best-effort only (see S-12).
- **Postgres migration** — described, not implemented.
- **Backup/restore automation** — absent.

---

## 10. Action plan

### P0 — Blockers: must be fixed before any pilot or GO

| # | Action | Finding | Acceptance criteria |
|---|---|---|---|
| P0-1 | Fix dispute scope authorization | S-01 | Non-moderator with `scope=all` receives only their party disputes; test added |
| P0-2 | Validate `customerOrderId` ownership | S-02 | Cross-workspace link rejected; test added |
| P0-3 | Restrict claim create-time status | S-03 | Only `SENT`/`RECEIVED`/`PARTIAL` accepted; terminal states only via decision; tests added |
| P0-4 | Enforce supplier order transitions | S-04 | Transition table; illegal jumps return 409; tests added |
| P0-5 | Remove published demo credentials; gate seed | S-06, S-15 | No credentials on public page/README; seed refuses production; privileged accounts require explicit bootstrap |
| P0-6 | Add rate limiting/lockout | S-05 | Per-account and per-IP throttling with tests; or documented enforced proxy |
| P0-7 | Correct `STATE.md` status and counts | §7 | Phase 0 pending; implementation paused; 31 models; 135 checks |
| P0-8 | Restore or formally locate PRD v0.2 | §4 | PRD file in repo or canonical location recorded |
| P0-9 | Freeze implementation | Status | No further feature work until recorded GO |

### P1 — Required before real-user pilot

| # | Action | Finding |
|---|---|---|
| P1-1 | Enforce `customerDataVisibility` correctly | S-08 |
| P1-2 | Enforce commercial terms (min resale, advertising, commission, payment/delivery) | S-10 |
| P1-3 | Validate/decrement/restore stock with a ledger | S-11 |
| P1-4 | Add password reset/change and email verification | S-07, S-09 |
| P1-5 | Add account restriction workflow | §9.4 |
| P1-6 | Add order edit/delete/undo | §9.1 |
| P1-7 | Add receipts/statements | §9.1 |
| P1-8 | Add CSV export/import | §9.1 |
| P1-9 | Make audit writes observable and seed audit data | S-12 |
| P1-10 | Resolve billing scope: authorize or remove | §8 |
| P1-11 | Add CSRF origin check and shorten/rotate sessions | S-13, S-14 |
| P1-12 | Add regression tests for all P0/P1 fixes | §6.2 |

### P2 — After GO, before scale

- Expenses and net profit.
- In-app notifications and scheduled reminders.
- Reviews/reputation.
- Appeals workflow.
- Hausa/i18n.
- Offline creation/sync/conflict resolution.
- File uploads.
- Pagination and performance work.
- Postgres migration and backup automation.
- Session management UI.

### Deferred — explicitly not now

- Subscription billing and paid-plan enforcement (unless re-authorized in writing).
- AI features (per D-004).
- Gateways, wallets, escrow, transfers, bank verification (per D-013).
- Web Share Target experiment.
- Full Docker/pilot-tooling hardening (outside core audit scope).

---

## 11. Phase 0 readiness

**Verdict: NOT READY.**

| Gate | Required | Actual | Status |
|---|---|---|---|
| Segment + country chosen | One segment, one country | “NOT DECIDED” (`STATE.md`) | ❌ |
| Competitor check | 5 tools and weaknesses | “NOT DONE” (`STATE.md`) | ❌ |
| Seller outreach list | 20 sellers | Blank template | ❌ |
| Interviews logged | 8–10+ | Blank `templates/INTERVIEW_LOG.md` | ❌ |
| Unprompted problem evidence | Recorded | None | ❌ |
| Commitments | A/B commitments recorded | 0 | ❌ |
| Clickable mockup shown | Recorded | No record | ❌ |
| GO/REVISE/STOP recorded | In `STATE.md` | No record; D-010 skips the gate | ❌ |
| PRD v0.2 available | Approved source document | Missing from repo | ❌ |
| Kill date realistic | Enough time to run the gate | 2026-11-06, two days after audit | ⚠️ |

The approved status must remain:

- **PRD v0.2:** Approved.
- **Phase 0:** Pending.
- **GO:** Not granted.
- **Further implementation:** Not authorized. *(Historical — describes the state at audit time. Implementation was authorized on 2026-11-04 by D-019; see the status clarification at the top of this report. Phase 0 remains pending and no security finding is resolved.)*

The existence of working V1 code does not satisfy Phase 0. Code is not demand evidence. The gate requires observed seller behavior and recorded commitments.

**Recommended immediate sequence:**

1. Freeze implementation and correct `STATE.md` (P0-7, P0-9).
2. Restore the PRD v0.2 document or record its canonical location (P0-8).
3. Fix the P0 security blockers so any pilot environment is safe (P0-1 to P0-6).
4. Run the Phase 0 validation plan: choose segment/country, do the competitor check, list 20 sellers, log 8–10 interviews, ask for commitments, show the mockup.
5. Record GO / REVISE / STOP in `STATE.md`. Only a recorded GO authorizes implementation.

---

## 12. Final assessment

### 12.1 Strengths

- The codebase is coherent, typed, and consistent in style.
- Money handling is disciplined (integer kobo everywhere).
- Private reseller pricing is genuinely server-enforced and the public API does not leak price fields; this is the strongest part of the implementation.
- The API suite is broad and passing (135/135), and the PWA checks are meaningful (31/31).
- Build, typecheck, Prisma validation, and migrations are clean.
- The UI is mobile-first with sensible touch targets and a conservative service worker.

### 12.2 Blocking weaknesses

- **Security:** one critical cross-tenant disclosure (S-01) and three high-severity integrity/IDOR issues (S-02, S-03, S-04), plus missing rate limiting and published demo credentials.
- **Scope:** subscription/billing is fully built and wired into core entitlements despite being out of V1 scope.
- **Documentation:** `STATE.md`, `README.md`, `MVP_SPEC.md`, `TECH_STACK.md`, `ROADMAP.md`, and `AI_HANDOFF.md` contradict the code and the approved status. Counts are stale (29 vs 31 models; 41/63/106 vs 135 checks).
- **Evidence:** Phase 0 has no interviews, no commitments, no competitor check, no segment, and no GO record.
- **Product gaps:** receipts, CSV, expenses/net profit, notifications, i18n, reviews, appeals, offline sync, order edit/delete, and password recovery are absent.

### 12.3 Release recommendation

**Do not proceed to pilot or GO.** The correct state is:

> PRD v0.2 Approved · Phase 0 Pending · GO Not Granted · Implementation Not Authorized

> **Clarification (2026-11-04):** the final clause is historical. Implementation is authorized as of 2026-11-04 (D-019) while Phase 0 stays pending; the PRD, Phase 0 and GO clauses still stand, and P0-1 to P0-9 remain open work.

Resolve P0-1 through P0-9, restore the PRD, complete Phase 0 with recorded evidence, and then re-audit. The engineering foundation is worth keeping; the process and security gaps are what block the gate.

### 12.4 Audit attestation

- No application code, schema, migration, dependency, seed, or existing document was modified.
- No database rows were inserted, updated, deleted, reset, migrated, or seeded.
- The full API suite ran only against `/tmp/opencode/sellflow-audit2.db`, a copy of `prisma/dev.db`.
- No passwords, API keys, session tokens, or other secrets are reproduced in this report.
- **No test or build failed during this audit.**
