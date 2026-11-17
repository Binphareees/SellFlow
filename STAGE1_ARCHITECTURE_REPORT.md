# SellFlow — Stage 1: V1 Architecture Inspection Report

**Date:** 2026-11-04
**Authorization:** Implementation GO granted 2026-11-04 (D-019). Phase 0 validation remains incomplete; no validation GO exists.
**Stage status:** Read-only inspection complete. No application code, schema, migration, dependency or project database was changed by this task.
**Method:** Full source read, route/model inventory, and executable baseline against a **throwaway database created in `/tmp`** (migrated and seeded there, never the project database).

**Evidence legend**

| Tag | Meaning |
|---|---|
| **[V]** | Verified by running a command or an HTTP request in this task |
| **[C]** | Verified by reading the code; not executed |
| **[A]** | Assumption or inference, explicitly not verified |

---

## 1. Executive summary

SellFlow is a real, coherent V1: a Next.js 15 App Router application with 31 Prisma models, 51 JSON route handlers, first-party session auth, an additive role model, server-enforced private reseller pricing, versioned offers/agreements, a five-party supplier-order lifecycle, a dispute/mediation trail and an installable PWA. The engineering baseline is **green**:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0 [V]** |
| `npx prisma validate` | **valid [V]** |
| `npx prisma migrate status` | **3 migrations, up to date [V]** |
| `npm run build` | **exit 0**, BUILD_ID `kubf8Zl07lqi5kvWZom-_` **[V]** |
| `GET /api/health` | **200**, `status: ok`, db up (1 ms), version `1.0.0` / `match`, env `production` **[V]** |
| `verify-api.mjs` on a clean throwaway DB | **135 / 135 passed [V]** |
| `npm run test:pwa` | **31 / 31 passed [V]** |

The product is **not safe to pilot**. Every P0 security finding from the 2026-11-04 audit was reproduced live on throwaway data: a brand-new account reads every dispute (S-01); a reseller can link a supplier order to another workspace's customer order and the supplier then sees that customer's name and phone (S-02); a reseller can self-assign `CONFIRMED` to a payment claim (S-03); a supplier can jump an order from `AWAITING_PAYMENT` to `COMPLETED` (S-04); the landing page still prints the shared demo password (S-06); registration grants tier 1 with no email verification (S-07); there is no login throttling (S-05); commercial terms are stored but not enforced (S-10); stock confirmation moves no stock (S-11); a foreign `Origin` header does not block a mutation (S-13). None of this is resolved, and no finding is marked resolved here.

The strongest part of the system is the private-pricing boundary: `src/server/price-access.ts` is a single gate, public queries cannot select price columns, denials are audited and return reason codes, and the suite proves the price string never appears in a guest or unapproved response.

**Bottom line:** engineering foundation is worth keeping; security, fulfilment integrity and scope control are what block a pilot. Stage 2 should be a security sprint, not feature work, and must start with S-01 to S-04.

---

## 2. Actual architecture

### 2.1 Stack (verified from `package.json`, code and build)

| Layer | Implementation |
|---|---|
| Runtime | Node.js (build ran on v18.19.1 **[V]**; the pre-existing dev server on :4322 runs v22.23.2 **[V]**) |
| Framework | Next.js `15.5.28` App Router, React `19.2.0`, TypeScript 5 strict |
| Data | Prisma `6.19.3` + SQLite (`prisma/dev.db`); 3 migrations; `output: "standalone"` |
| Auth | First-party: bcryptjs cost 12, random 32-byte session token, salted SHA-256 at rest, httpOnly cookie |
| Validation | zod 4 schemas in `src/lib/validation.ts`, parsed by `readBody()` |
| Styling | One hand-written `src/app/globals.css`; no UI library, no CSS framework |
| PWA | `public/manifest.json`, `public/sw.js` (network-first HTML, no `/api/*`, SWR on `/_next/static|/icons|/manifest.json`), `public/offline.html` |
| Dependencies | Only next, react, react-dom, @prisma/client, bcryptjs, zod (+ dev: prisma, tsx, typescript) — **zero third-party services, SDKs, mailers, payment or analytics integration** **[V]** |

### 2.2 Layering

```
src/app/api/**/route.ts     HTTP surface: auth gate → zod body → service call → json()
src/app/**/page.tsx         Server Components: auth → service read → render (no client data fetching for initial state)
src/components/*.tsx        Client interactive forms; call the same JSON API via src/lib/client.ts
src/server/*.ts             Business rules: workspace, supplier, price-access, disputes, accounts
src/lib/*.ts                Cross-cutting: api envelope, audit, money, enums, validation, plans, subscription
prisma/schema.prisma        Data model and invariants
```

- **Request flow:** `route()` in `src/lib/api.ts` wraps every handler, converts `ApiError` into `{ error, code, details }` with `Cache-Control: private, no-store`, turns zod failures into 422 field maps, and hides internals behind a generic 500 while logging the cause.
- **Session resolution:** `getAuthContext()` (`src/lib/auth/session.ts`) loads the session, profile, roles, owned workspace and supplier profile per request; `requireAuth`, `requireWorkspace`, `requireSupplier`, `requireReseller`, `requireMediator`, `requirePlatformAdmin` build on it.
- **Rendering:** every authenticated page is `dynamic = "force-dynamic"`; the `(app)` layout redirects unauthenticated users server-side. Public marketplace pages resolve the session but render for guests.
- **Money:** always integer kobo (`Int` columns, `src/lib/money.ts`), parsed from user input with `parseMoneyToMinor`, balances recomputed server-side.
- **Deployment:** 4-stage `Dockerfile` (`deps → builder → migrator → runner`, plus a `pilot` profile), `docker-compose.yml` with a 30 s healthcheck and a SQLite volume, `scripts/deploy.sh` (typecheck → E2E → migrate → candidate health → swap).
- **No realtime, no queues, no background jobs, no file uploads** (listing images are URLs only).

### 2.3 Notable architectural constraints

- SQLite is single-writer; order-number allocation uses count-based sequences with P2002 retries (4 attempts) in `createOrder` and `createSupplierOrder`.
- Enum-like columns are `String` with validation at the API boundary (`src/lib/enums.ts`), designed to map to Postgres enums later.
- Subscription billing is fully wired into workspace entitlements (`assertCapacity`, `assertFeature`) although it is out of V1 scope (conflict C-03).

---

## 3. Database model inventory

31 models in `prisma/schema.prisma` **[V]** (`grep -c "^model "`).

| Group | Models | Purpose |
|---|---|---|
| Identity | `User`, `Profile`, `ProfileRole`, `VerificationEvent`, `Session` | One account, one profile, additive roles, tier history, hashed session tokens |
| Workspace | `BusinessWorkspace`, `Customer`, `Product`, `CustomerOrder`, `OrderItem`, `ManualPayment`, `PaymentPlan`, `PaymentPromise` | Bookkeeping: catalogue, orders, manual money, promises |
| Marketplace | `SupplierProfile`, `ProductListing`, `ResellerOffer`, `ResellerOfferVersion` | Public listing (retail price only) + private versioned offer |
| Network | `ResellerApplication`, `ResellerAgreement`, `ResellerAgreementVersion`, `NegotiationProposal` | Apply → approve → accept → versioned terms; structured counter-offers |
| Fulfilment | `SupplierOrder`, `SupplierOrderItem`, `PaymentStatusClaim`, `DispatchRecord`, `DeliveryConfirmation` | Lifecycle with party-recorded claims |
| Disputes | `Dispute`, `DisputeEvent` | Case + append-only trail; optional claim link |
| Billing (out of scope) | `Subscription`, `SubscriptionPayment` | Manual plan records and upgrade requests |
| Audit | `AuditLog` | Platform-wide security trail |

**Key invariants encoded**

- `BusinessWorkspace.ownerProfileId @unique` and `Profile.userId @unique` → exactly one workspace per account.
- `ProfileRole @@unique([profileId, role])` → roles are additive, never duplicated.
- `ResellerOffer.listingId @unique`; `ResellerOfferVersion @@unique([offerId, version])`; `ResellerAgreement @@unique([offerId, resellerProfileId])`; `ResellerAgreementVersion @@unique([agreementId, version])` → append-only versioning.
- `SupplierOrderItem` snapshots `offerVersionId`, `agreementVersionId`, `unitPriceKobo`, `lineTotalKobo` → later price edits cannot reprice history.
- `SupplierOrder.customerOrderId @unique` → at most one supplier order per customer order (but ownership is not validated; see S-02).
- `Dispute.claimId` optional; `DisputeEvent` append-only by convention (no update path).
- Money: all amount columns are `Int`; no `Decimal`/`Float` anywhere **[C]**.

**Indexes present** on tenant-scoped and listing keys (`[workspaceId, status]`, `[supplierProfileId, status]`, `[status, createdAt]`, `[category]`, etc.). **Gaps [C]:** no index on `AuditLog.entityId` alone (only composite), no full-text search (SQLite `LIKE` used), no unique constraint preventing duplicate open promises/claims.

**Migrations:** `20261102203150_init`, `20261102213950_dispute_claim_link`, `20261102222213_subscriptions` — 3 applied **[V]**.

**Seed data (`prisma/seed.ts`) [C]:** four accounts sharing `Password123!` (supplier, reseller, mediator, platform admin), two listings (`body-wave-wig-18in` retail ₦48,000 / reseller ₦38,000 / MOQ 6; `clip-in-extensions-set` ₦14,500 / ₦9,500), an approved application, an ACTIVE agreement, a demo supplier order with a disputed claim and an OPEN dispute, and a comped Supplier Pro subscription.

---

## 4. API route inventory

51 `route.ts` handlers **[V]**. Every handler returns JSON with `private, no-store`; every body is zod-validated.

| Area | Routes | Responsibility | Gate |
|---|---|---|---|
| Auth | `POST auth/register`, `POST auth/login`, `POST auth/logout`, `GET auth/me` | Account creation (workspace in one transaction), session issue/revoke, session introspection | public / session |
| Profile | `POST profile/roles` | Self-activate `RESELLER`; refuses `SUPPLIER` and `MEDIATOR` | session |
| Workspace | `GET/POST workspace/customers`, `PATCH/DELETE workspace/customers/[id]`, `GET/POST workspace/products`, `PATCH workspace/products/[id]`, `GET/POST workspace/orders`, `GET/PATCH workspace/orders/[id]`, `POST orders/[id]/payments`, `POST orders/[id]/promises`, `POST payments/[id]/void`, `PATCH promises/[id]`, `GET workspace/dashboard` | Customers, catalogue, orders, manual payments, promises, debt-first dashboard | `requireWorkspace` |
| Marketplace (public) | `GET marketplace/listings`, `GET listings/[slug]`, `GET suppliers`, `GET suppliers/[id]` | Discovery: search, category, retail price band, stock, sort; supplier directory/storefront — public columns only | none (guest OK) |
| Marketplace (private price) | `GET marketplace/offers/[offerId]/price` | The only private-price read; reason-coded 403 | session + entitlement inside `resolveResellerPrice` |
| Marketplace (applications) | `GET/POST marketplace/applications` | Reseller's own applications; submit to one supplier | session |
| Supplier | `POST supplier/profile`, `GET/POST supplier/listings`, `POST supplier/offers/[id]/versions`, `PATCH supplier/offers/[id]`, `POST supplier/applications/[id]`, `POST supplier/agreements/[id]/versions`, `GET/POST supplier/orders`, `GET/PATCH supplier/orders/[id]`, `POST orders/[id]/stock`, `POST orders/[id]/claims`, `POST orders/[id]/claims/[claimId]`, `POST orders/[id]/dispatch`, `POST orders/[id]/delivery`, `GET supplier/dashboard` | Catalogue, offers, approvals, agreements, fulfilment, claims | `requireSupplier` (orders POST is `requireRole(RESELLER)`) |
| Reseller | `GET reseller/overview`, `POST reseller/agreements/[id]/accept` | Agreements, applications, orders; accept terms | `requireRole(RESELLER)` / session |
| Negotiation | `POST agreements/[id]/proposals`, `POST agreements/[id]/proposals/[proposalId]/accept` | Structured counter-offers | session + party check (`agreementParties`) |
| Disputes | `GET/POST disputes`, `GET disputes/[id]`, `POST disputes/[id]/events`, `POST disputes/[id]/status`, `POST disputes/[id]/resolve` | Case list/detail, append-only trail, mediator desk | session; mediator checks per action |
| Admin | `PATCH admin/profiles/[id]/verification` | Tier 2–3 review | `requirePlatformAdmin` |
| Billing (out of scope) | `GET billing`, `POST billing/upgrade`, `POST billing/cancel`, `POST billing/payments/[id]/decision` | Manual plan records | session / workspace / platform admin |
| Ops | `GET health` | Liveness: db round trip, uptime, version, env | public |

**Observations [C]**

- `POST supplier/orders` is the reseller's create path mounted under `/supplier`; naming is confusing but authorization is correct (`requireRole(RESELLER)`).
- `GET supplier/orders` and `GET supplier/listings` query Prisma directly in the route rather than through `src/server`, so tenant scoping is duplicated in three places.
- No route exists for password reset/change, email verification, receipts/statements, CSV export/import, or account deletion.

---

## 5. Authentication and authorization review

### 5.1 Session mechanics **[C]**, cookie **[V]**

- Token: `randomBytes(32).toString("base64url")`; stored as `sha256(token + SESSION_SECRET)` — a database leak cannot be replayed.
- Cookie: `sf_session`, `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`, expiry 30 days by default (`SESSION_MAX_AGE_DAYS`).
- Observed `Set-Cookie`: `Expires=Thu, 03 Dec 2026 …; Secure; HttpOnly; SameSite=lax` (30 days) **[V]**.
- `getAuthContext()` rejects revoked, expired, disabled-user and profile-less sessions.
- Logout revokes only the current token (`revokeCurrentSession`).
- **No rotation on privilege change, no absolute/idle distinction, no per-device session management** (S-14).
- **`startSession` is called with `ip: null` in both login and register routes**, so `Session.ipHash` is always `NULL`; the audit row still carries `clientIpHash(request)` **[C]**.

### 5.2 Roles and gates **[C]**

| Gate | Rule |
|---|---|
| `requireAuth` | any valid session |
| `requireWorkspace` | session with owned workspace (every account has one) |
| `requireRole(RESELLER)` | additive role present |
| `requireSupplier` | `SUPPLIER` role **and** `supplierProfileId` |
| `requireMediator` | `isMediator()` = platform admin **or** `MEDIATOR` role |
| `requirePlatformAdmin` | `User.isPlatformAdmin` |

- Registration creates `User → Profile → BUSINESS_OWNER → BusinessWorkspace` plus a `VerificationEvent 0→1` in one transaction; `verificationTier` is set to **1 without email verification** (S-07).
- Role self-service is limited to `RESELLER`; `SUPPLIER` requires creating a supplier profile (which also upserts the role); `MEDIATOR` is refused.
- **Inconsistency:** `getSupplierOrder()` treats a viewer as moderator only via `roles.includes(MEDIATOR)`, ignoring `isPlatformAdmin`, while disputes use `isMediator()` (admin included). A platform admin who is not also a `MEDIATOR` cannot read a supplier order but can read every dispute.

### 5.3 Tenancy and object-level authorization

- Workspace queries are consistently scoped by the session `workspaceId` (`src/server/workspace.ts`) — no body-supplied workspace IDs. **This is solid.**
- Supplier queries are scoped by `supplierProfileId` from the session.
- Marketplace private pricing is centralized in `resolveResellerPrice()` and is the only reader of `ResellerOfferVersion` / `ResellerAgreementVersion` prices.
- **Gap:** `SupplierOrder.customerOrderId` is accepted from the request body and never checked against the reseller's workspace (S-02, reproduced).
- **Gap:** `listDisputes(viewer, { scope: "all" })` skips the party filter for **any** authenticated caller (S-01, reproduced).

### 5.4 Audit trail

`audit()` writes to `AuditLog` and swallows failures by design (S-12). In this task the trail **does work**: on the throwaway copy the suite grew `AuditLog` from 56 to 91 rows across `auth.login`, `auth.register`, `customer.created`, `customer_order.created`, `dispute.*`, `marketplace.price_access_denied|granted`, `reseller_network.agreement_accepted` **[V]**. The seeded database ships with an **empty** `AuditLog`, which is what the 2026-11-04 audit observed — not a write failure. Best-effort swallowing remains the real weakness: a failed insert is invisible to the caller.

---

## 6. Business-management feature assessment

Compared against the requirements register in `PRD_V0.2.md` (no requirement invented).

| Requirement | Status | Evidence / gap |
|---|---|---|
| BM-01 customers + normalized WhatsApp number | **Implemented** | `Customer.phone` normalized by zod `phone` preprocess; `wa.me` links in UI |
| BM-02 products with selling/cost price in kobo | **Implemented** | `Product.costPriceKobo/sellingPriceKobo`, `src/lib/money.ts` |
| BM-03 orders with line items and server-computed totals/cost | **Implemented** | `createOrder` recomputes from `Product` where linked; client price ignored for linked items |
| BM-04 manual payments as a list, never overwritten | **Implemented** | `ManualPayment` rows; void sets `voidedAt`, no delete route |
| BM-05 paid/balance/payment state derived | **Implemented** | `paidKoboOf`, `balanceOf`, `paymentState`; never trusted from client |
| BM-06 reject overpayment | **Implemented** | 409 with remaining balance; verified by suite **[V]** |
| BM-07 payment promises + follow-up | **Implemented (partial UX)** | `PaymentPromise` + dashboard list + resolve actions; no scheduled reminder/notification |
| BM-08 debt-first home screen | **Implemented** | `/dashboard`: Outstanding/Collected/Profit/Promises stats, "Who owes me" |
| BM-09 one-tap WhatsApp reminder, never auto-send | **Implemented** | `whatsappReminderText` + `wa.me` link |
| BM-10 gross profit = revenue − cost snapshot | **Implemented** | `summariseOrder().profitKobo`; shown per order and in aggregate |
| BM-11 order filters by status and payment state | **Implemented (API partial)** | `listOrders` supports both; UI exposes payment filter chips/status |
| BM-12 order edit, soft delete, undo, trash view | **Missing** | `orderUpdateSchema` only changes status/notes; `deletedAt` exists but no delete/restore route or trash view |
| BM-13 expenses and net profit | **Missing** (source gap) | No `Expense` model; only gross profit |
| BM-14 CSV import/export, backup/restore | **Missing** (partially sourced) | No export route, no restore |

**Assessment:** the workspace pillar is the most complete part of the product and matches the sourced requirements (BM-01..BM-11). The gaps (BM-12, BM-14) are bookkeeping durability features a real seller will ask for early, but they are not security-critical.

**Reporting:** the dashboard reports outstanding, collected, revenue, gross profit, debtor count and promise counts. There is **no** period filtering, per-customer statement, CSV or printable report.

---

## 7. Marketplace feature assessment

| Requirement | Status | Evidence / gap |
|---|---|---|
| MK-01 listing with public price, category, stock, MOQ | **Implemented** | `ProductListing`; supplier UI `ListingForm` |
| MK-02 discovery search/category/price band/stock/sort | **Implemented** | `listPublicListings`, `countPublicListings`; `popular` = real `SupplierOrderItem` counts |
| MK-03 supplier directory + storefront | **Implemented** | `/marketplace/suppliers`, `/marketplace/suppliers/[id]` |
| MK-04 apply to a specific supplier | **Implemented** | `submitApplication` scoped to one `supplierProfileId` |
| MK-05 approved reseller sees that supplier's private price only | **Implemented** | `resolveResellerPrice` requires role + per-supplier APPROVED application + ACTIVE agreement + ACTIVE offer; verified denial cases in suite **[V]** |
| MK-06 supplier order priced from agreement, not body | **Implemented** | `createSupplierOrder` ignores client price; suite asserts total **[V]** |
| MK-07 stock confirmation, claims, dispatch, delivery | **Implemented (integrity defects)** | Flows exist; S-03, S-04, S-11 |
| MK-08 one party per step, wrong party 403 | **Partial** | Delivery is reseller-only (good), claim confirmation is counterparty-only (good at decision time), but `setSupplierOrderStatus` lets the supplier set **any** status (S-04) |
| MK-09 public pages never expose private price | **Implemented** | `publicListingSelect` has no price columns; suite asserts the string is absent **[V]** |
| MK-10 validate both marketplace sides in Phase 0 | **Not started** | Phase 0 evidence absent |
| PR-01..PR-08 private pricing boundary | **Implemented** | Single module, reason codes, audited denials; moderator read logged |
| OV-01..OV-04 offer versioning, snapshots, no repricing | **Implemented** | `addOfferVersion`, `SupplierOrderItem.agreementVersionId`; suite verifies historical price **[V]** |
| OV-05/06 effective dates, archival effects | **Missing** (source gap) | `effectiveFrom/effectiveTo` columns exist; no enforcement or notification |
| RA-01..RA-05 apply/approve/accept/version/counter-offer | **Implemented** | `decideApplication` creates agreement v1 `PENDING_ACCEPTANCE`; accept activates |
| RA-06 dual acceptance of negotiated versions | **Partial** | `acceptProposal` stamps **both** party timestamps on one acceptance |
| RA-07 termination rules | **Partial** | `TERMINATED` status and fields exist; no terminate route |
| SO-01..SO-05 order lifecycle + claims | **Implemented** | Full happy path covered by suite **[V]** |
| SO-06 one-step-at-a-time transitions | **Not enforced** | `setSupplierOrderStatus` writes any status |
| SO-07 stock reserved/decremented/restored | **Not enforced** | `confirmStock` changes no stock; cancellation restores none (verified 24 → 24 **[V]**) |
| DM-01..DM-06 dispute raising, evidence, mediator, no self-resolve | **Implemented** | Party check on open; mediator-only resolve; suite verifies 403 **[V]** |
| DM-07 dispute visibility restricted | **Broken** | `scope=all` bypass (S-01, reproduced) |
| RE-01/RE-02 minimum resale price | **Not enforced** | Resale price is stored; a resale of ₦10 against a ₦450 minimum was accepted (S-10) **[V]** |
| RE-03 MOQ / payment terms / delivery / advertising | **MOQ only** | MOQ enforced in `createSupplierOrder`; other terms stored and displayed only |
| RE-04/RE-05 commission and customer-data visibility | **Partial** | Commission stored, never computed. `ORDER_ONLY` and `NONE` both return the customer for resellers; only the supplier is filtered when `NONE` |
| PT-01..PT-07 manual payment tracking | **Implemented** | Payment records, void, claims, counterparty confirmation; no verification claim anywhere |
| RS-01..RS-05 receipts and statements | **Missing** | No receipt/statement route, component or PDF/image generation |
| OF-01..OF-04 PWA installability and conservative caching | **Implemented** | `test:pwa` 31/31 **[V]** |
| VS-08 billing out of V1 scope | **Conflict open** | Billing influences order caps, payment plans, agreement versioning and negotiation (C-03) |

**Assessment:** the marketplace is functionally deep — deeper than most V1s — but the fulfilment layer is a **record-keeping** state machine without integrity guarantees: stock is not a ledger, transitions are not constrained, and commercial terms are mostly decorative. That is the gap between "demo-complete" and "safe to run a real supplier relationship on".

---

## 8. Security findings assessment (S-01 to S-15)

All findings remain **OPEN**. Evidence below was produced in this task against a throwaway database; none of it changes the audit's severities or closes anything.

| ID | Location | Current implementation | Exploitation (evidence) | Severity | Recommended remediation | Verification test |
|---|---|---|---|---|---|---|
| **S-01** | `src/server/disputes.ts → listDisputes()`; `src/app/api/disputes/route.ts` GET | `scope = options.scope ?? (moderator ? "all" : "mine")`; when `scope==="all"` the `where` clause drops `VISIBLE_TO_PARTY` regardless of caller | **[V]** Registered a brand-new account and `GET /api/disputes?scope=all` → **200** with `DSP-DEMO-01`, a dispute the caller is not party to | **Critical** | Derive scope from the caller only: ignore `scope=all` unless `isMediator(viewer)`; return 403 otherwise. Keep `mine` as the only non-moderator scope | As a fresh reseller: `scope=all` → 403 or only own disputes; as mediator → all; counts endpoint stays scoped |
| **S-02** | `src/server/supplier.ts → createSupplierOrder()`; `getSupplierOrder()` | `customerOrderId` copied from body with no ownership check; `getSupplierOrder` includes `customerOrder.customer {name, phone}` | **[V]** New account created customer "Probe Secret Customer" + order; reseller created a supplier order with that `customerOrderId` → **201**, `customerOrderId` linked; supplier GET returned `name: "Probe Secret Customer"`, `phone: "2348001112222"` | **High** | Validate `customerOrderId` belongs to `resellerWorkspaceId`/session workspace before linking; never return another workspace's customer to the supplier | Cross-tenant link → 403/400; supplier response has no foreign customer fields; own-workspace link still 201 |
| **S-03** | `src/server/supplier.ts → recordPaymentClaim()`; `claimCreateSchema` | Client-supplied `status` from `CLAIM_STATE` is written verbatim, including `CONFIRMED`/`DISPUTED` | **[V]** Reseller `POST /claims {status:"CONFIRMED"}` → **201**, claim `status: CONFIRMED`, `claimedByRole: RESELLER` | **High** | Restrict creation to `SENT` (reseller) / `RECEIVED` (supplier); only the decision endpoint may set `CONFIRMED`/`DISPUTED`/`PARTIAL` | Claim created with `CONFIRMED` → 422; created with `SENT` → 201; only counterparty can confirm |
| **S-04** | `src/server/supplier.ts → setSupplierOrderStatus()`; `PATCH /api/supplier/orders/[id]` | Writes any `SUPPLIER_ORDER_STATUS` with no transition table and no side effects beyond timestamps | **[V]** `AWAITING_PAYMENT → COMPLETED` via one PATCH → **200** | **High** | Replace with an explicit transition map per actor; allow only adjacent legal steps; route dispatch/delivery through their services; remove blanket PATCH or restrict to `CANCELLED` with rules | Illegal jump → 409/403; legal sequence passes; audit records `from`/`to` |
| **S-05** | `src/app/api/auth/login/route.ts`; `src/server/accounts.ts → authenticate()` | No attempt counter, delay, lockout or IP throttle; `ip: null` passed to `startSession` | **[V]** 8 consecutive wrong passwords → **401 ×8**; correct password immediately after → **200** | **Medium** | Add per-email + per-IP attempt tracking (in-memory or table), exponential delay/lockout, surface as 429; pass the client IP to `startSession` | 6th failure within window → 429/423; correct password after lockout window → 200; audit records lockout |
| **S-06** | `prisma/seed.ts`; `src/app/page.tsx` ("Try the demo") | All demo accounts share `Password123!`; landing page prints `reseller@sellflow.test` / `Password123!` | **[V]** `GET /` contains both the email and the password string | **Medium** | Remove credentials from the landing page; generate a per-seed random password printed once to the console; force change on first login | Page HTML contains neither string (add to `verify-api.mjs`); seed output is not committed |
| **S-07** | `src/server/accounts.ts → registerAccount()` | Sets `verificationTier: 1` with comment "email is verified by the account itself"; no verification infrastructure exists | **[V]** Registration response `profile.verificationTier: 1` | **Medium** | Start at tier 0; add a verification token + email step, or rename the tier semantics; do not display "contact verified" without evidence | New account tier 0; tier 1 only after verification; UI label matches |
| **S-08** | `src/server/supplier.ts → getSupplierOrder()` | Customer identity is hidden from the supplier only when visibility is `NONE`; `ORDER_ONLY` returns full name/phone | **[C]** `visibility === "NONE"` is the only branch that nulls `customer`; reseller always sees full customer order | **High** | Define and enforce per-visibility projections (NONE: no customer; ORDER_ONLY: name only, no phone; FULL: all) for **both** parties; add `deliveryAddress`-style fields later | Matrix test per visibility value for supplier and reseller |
| **S-09** | `src/app/api/auth/**`, `src/components/auth-forms.tsx` | No password reset, change or recovery route or UI | **[C]** Route inventory has no such handler; a user who forgets the password is locked out permanently | **High** (product-blocking) | Token-based reset (single-use, hashed, short TTL), change-password for signed-in users, session revocation on change; requires an email transport decision | Reset token single-use + expiry; old sessions revoked; wrong token 400 |
| **S-10** | `src/server/supplier.ts` (order creation), `src/server/workspace.ts` | `minResalePriceKobo`, `commission*`, `paymentTermsDays`, `advertisingPermission` stored and displayed; only MOQ enforced | **[V]** Supplier order accepted with `resalePriceKobo: 1000` against `minResale: 45000` | **High** | Enforce minimum resale at order creation (and at resale-price update); decide commission semantics (compute on order, record ledger) or mark the field explicitly informational | Below-minimum resale → 422; at/above → 201; commission fields either computed or labelled |
| **S-11** | `src/server/supplier.ts → confirmStock()`, `setSupplierOrderStatus()`; `src/server/workspace.ts → updateOrderStatus()` | Stock confirmation writes `stockConfirmedQty` only; no decrement, no restore on cancel/decline; workspace orders decrement `Product.stockQty` but cancellation never restores | **[V]** Listing stock `24` before and `24` after a confirmed 6-unit order | **High** | Treat stock as a ledger: decrement `ProductListing.stockQty` (and offer stock) on confirmation, restore on decline/cancel; validate `confirmedQty <= qty`; record movement rows | Confirm → listing stock −6; cancel → restored; over-confirm → 422; concurrency test with two orders |
| **S-12** | `src/lib/audit.ts` | `audit()` catches and logs every failure; seeded DB has an empty `AuditLog` | **[V]** Writes do work (56→91 rows in the suite copy); **[C]** failures are invisible to callers | **Medium** | Make audit writes part of the transaction for security-critical actions, or queue with retry + alert; never silently discard; seed at least one entry | Simulated DB failure surfaces an alert/metric; critical action fails closed or is retried |
| **S-13** | all mutating routes; `src/lib/client.ts` | No CSRF token and no `Origin`/`Sec-Fetch-Site` validation; relies on `SameSite=Lax` + JSON content type | **[V]** `POST /api/workspace/customers` with `Origin: https://evil.example` → **201** | **Medium** | Add a same-origin check inside `route()` for non-GET requests (reject foreign `Origin`, allow missing for same-site navigations), or double-submit CSRF token | Foreign Origin mutation → 403; same-origin → success; missing Origin policy documented |
| **S-14** | `src/lib/auth/session.ts` | Fixed 30-day TTL (`SESSION_MAX_AGE_DAYS`), no rotation, no absolute cap, no device list, logout revokes one token | **[V]** Cookie `Expires` 30 days ahead | **Medium** | Short idle TTL + absolute cap, rotate token on login/privilege change, revoke all sessions on password/role change, list/revoke devices | Idle expiry enforced; rotation issues a new token; role change invalidates old sessions |
| **S-15** | `prisma/seed.ts` | Seed creates `mediator@sellflow.test` and `admin@sellflow.test` with shared password and privileged roles | **[C]** Both accounts exist after seed with `MEDIATOR` / `isPlatformAdmin` | **Low** (demo-only) | Gate privileged seed accounts behind an explicit flag; keep them out of any deployed environment | Seed without flag creates no mediator/admin; with flag still uses random passwords |

### 8.1 Additional observations (not audit findings, newly recorded)

| ID | Observation | Impact |
|---|---|---|
| N-01 | `startSession(user.id, { ip: null })` in login and register → `Session.ipHash` always null | Weak session forensics; S-05 work should fix this |
| N-02 | Moderator inconsistency: `getSupplierOrder` checks only `roles.includes(MEDIATOR)`, disputes use `isMediator()` (admin included) | A platform admin cannot read supplier orders but can read all disputes |
| N-03 | `recordPaymentClaim` contains a no-op ternary (`status: … ? order.status : order.status`) | Dead code; suggests an intended lifecycle rule was dropped |
| N-04 | `register` route maps conflicts by matching `error.message.includes("already exists")` | Brittle coupling to a string; use `ApiError`/Prisma error codes |
| N-05 | Supplier-facing routes query Prisma inline (`supplier/orders`, `supplier/listings`, `marketplace/applications`) | Tenant filters duplicated three ways; easy to drift |
| N-06 | No rate limit or size guard on public search endpoints (`q`, limit clamped to 60) | Minor scraping/DoS surface |
| N-07 | `confirmStock` accepts `confirmedQty` above the ordered quantity | Data integrity; part of S-11 |
| N-08 | Cancelling a workspace order does not restore `Product.stockQty` reserved at creation | Inventory drift; part of S-11 |

### 8.2 Verified strengths (must not be regressed)

- Private prices never appear in guest/unapproved responses: `publicListingSelect` has no price column, and the suite asserts the string is absent **[V]**.
- Price denials are audited with reason codes and never leak the number **[V]**.
- Overpayment, wrong-party lifecycle actions and non-party dispute access return 4xx with tests **[V]**.
- Session tokens are hashed at rest; passwords use bcrypt cost 12 **[C]**.
- All API responses are `private, no-store`; the service worker never caches HTML or `/api/*` **[V]**.

---

## 9. Test and build results (recorded, not historical)

| # | Command / probe | Environment | Result |
|---|---|---|---|
| 1 | `node -v`, `npm -v` | host | v18.19.1 / 9.2.0 **[V]** |
| 2 | `npx tsc --noEmit` | host | **exit 0**, no diagnostics **[V]** |
| 3 | `npx prisma validate` | host | "schema is valid" **[V]** |
| 4 | `npx prisma migrate status` | `prisma/dev.db` | 3 migrations, **up to date** **[V]** |
| 5 | `npm run build` (`prisma generate && next build`) | host, standalone output | **exit 0**, BUILD_ID `kubf8Zl07lqi5kvWZom-_` **[V]** |
| 6 | `next start -p 4401` + `GET /api/health` | fresh `/tmp` DB | **200**, `status: ok`, db 1 ms, `version 1.0.0 / match`, `production` **[V]** |
| 7 | `node scripts/verify-api.mjs` (`BASE_URL=:4401`) | fresh `/tmp` DB (migrated + seeded there) | **135 / 135 passed**, exit 0 **[V]** |
| 8 | `npm run test:pwa` | own server, :4321 | **31 / 31 passed**, exit 0 **[V]** |
| 9 | Audit trail growth during suite | fresh `/tmp` DB | `AuditLog` **56 → 91** rows, 12 action types **[V]** |
| 10 | Security probes (S-01, S-02, S-03, S-04, S-05, S-06, S-07, S-10, S-11, S-13, S-14) | fresh `/tmp` DB, throwaway | All reproduced as described in §8 **[V]** |

### 9.1 Environment incidents during this stage (reported, not hidden)

1. **Port 4322 was already occupied** by a long-running `next-server` (pid 927563, elapsed ≈1 h 25 m, cwd = project, Node v22.23.2, parent pid 6382). It is **not** a process this task started, so it was left running.
2. My first isolated attempt bound `:4322` with `DATABASE_URL` pointing at a `/tmp` copy. The bind failed (`EADDRINUSE`), and the health check and API suite therefore ran against that pre-existing server, which serves **`prisma/dev.db`**. Consequence: **`prisma/dev.db` was mutated by one `verify-api.mjs` run** (mtime 01:49 → 01:50; a second run on a copy of it then reported 122/135 because the data was no longer a clean seed — prices, plan tier, dispute state and caps had changed, not the code).
3. The baseline in row 7 was then re-run correctly: fresh DB created in `/tmp` via `prisma migrate deploy` + `tsx prisma/seed.ts`, own server on a verified-free port with health uptime 2 s, giving **135/135**.
4. **No database reset, migration, seed or destructive command was run against the project database.** `prisma/dev.db` now holds the demo data as left by that single accidental suite run; restoring the pristine seed requires `npm run db:reset`, which Stage 1 restrictions forbid. This is a data-state issue only, with no schema or code impact.
5. All servers started by this task were stopped by process group; `:4399`, `:4401` have no listeners. The PWA suite's `:4321` server was stopped by the script itself.

### 9.2 What the passing suites do **not** cover

- No test asserts that `scope=all` is mediator-only (S-01 passes despite the hole).
- No test asserts `customerOrderId` ownership (S-02).
- No test asserts that a claim cannot be created `CONFIRMED` (S-03).
- No test asserts illegal status transitions (S-04).
- No test asserts lockout (S-05), landing-page secrecy (S-06), tier-0 registration (S-07), the visibility matrix (S-08), minimum-resale enforcement (S-10) or stock movement (S-11).
- No CSRF/Origin test (S-13), no session rotation test (S-14).
- No unit tests, no component tests, no load tests; the only automated checks are the two script suites.

---

## 10. Technical debt and incomplete features

**Security/process debt (blocking):** S-01 … S-15 as above; N-01 … N-08.

**Product incompleteness against the register**

| Area | Gap | Register |
|---|---|---|
| Orders | No edit, soft delete, undo or trash view | BM-12 |
| Data portability | No CSV import/export, no backup/restore | BM-14 |
| Accounting | No expenses, no net profit, no period reports | BM-13 |
| Receipts | No receipt image/PDF/share, no statements | RS-01..RS-05 |
| Account lifecycle | No password reset/change, no email verification at all | AR-11, AR-12, S-07, S-09 |
| Trust | No reviews/reputation (source gap), no fraud handling | TR-04..TR-06 |
| Negotiation | One acceptance stamps both parties | RA-06 |
| Agreements | No termination route/flow | RA-07 |
| Offers | `effectiveFrom/To` unenforced; no reseller notification | OV-05, OV-06 |
| Terms | Commission, payment terms, advertising, min-resale unenforced | RE-06 |
| Offline | Reads only; no offline writes/sync (source gap) | OF-05..OF-07 |
| Uploads | Listing images are URLs; no upload pipeline | — |
| Notifications | No email/SMS/push channel exists (also blocks password reset) | — |

**Scope debt:** subscription billing + entitlement gates are wired into core flows (order caps, payment plans, agreement versioning, negotiation, multi-supplier) while being outside V1 scope (C-03). This makes tests and product behaviour depend on an unapproved subsystem, and it is the single biggest documentation/scope conflict.

**Operational debt:** `package.json#prisma` seed config is deprecated (Prisma 7 warning) **[V]**; lockfile absent from the repository root listing (`package-lock.json` exists untracked) **[V]**; `MAX_AUTH_ATTEMPTS` is documented but unread **[C]**; health reports `versionStatus: unknown` under `node server.js` because `npm_package_version` is absent **[C]**; no CI configuration, no lint script, no test framework.

---

## 11. Recommended implementation priorities

Ordered by risk to a real pilot, with the verification that must accompany each.

| Priority | Work | Why now | Done when |
|---|---|---|---|
| **P0-1** | **S-01** dispute scope; **S-03** claim creation state; **S-04** transition map | Direct data exposure / fraud enablers, each a few lines | Regression tests fail before the fix, pass after; suite grows |
| **P0-2** | **S-02** `customerOrderId` ownership + customer projection (**S-08**) | Cross-tenant PII leak reproduced | Cross-tenant link rejected; visibility matrix tested |
| **P0-3** | **S-06** landing-page credentials + per-seed random passwords (**S-15**) | Published credentials on a public page | HTML assertion added to `verify-api.mjs`; seed prints once |
| **P0-4** | **S-13** same-origin check for mutating routes | Cheap, closes classic CSRF gap | Foreign-Origin POST → 403 |
| **P1-1** | **S-05** login throttling + real IP capture (**N-01**), **S-07** tier 0 at registration | Account takeover and fake trust signals | Lockout test; registration tier test |
| **P1-2** | **S-11** stock ledger + **S-10** minimum resale enforcement + `confirmedQty` cap (**N-07**, **N-08**) | Marketplace integrity is the product promise | Stock movement tests; min-resale rejection |
| **P1-3** | **S-12** audit durability, **S-14** session lifetime/rotation, **S-09** password reset/change | Forensics, session hygiene, account recovery | Audit failure behaviour tested; rotation + reset flows tested |
| **P2** | Decide **C-03** (billing in or out), then either finish or remove entitlement gates | Blocks scope clarity and several test expectations | Written decision in `STATE.md`; code matches |
| **P2** | Close `getSupplierOrder` moderator inconsistency (**N-02**), move inline route queries into `src/server` (**N-05**) | Consistency and maintainability | Single moderator predicate; no Prisma in routes |
| **P3** | Product gaps with the highest pilot value: receipts (RS-01..RS-03), CSV export (BM-14), order edit/trash (BM-12), period reporting | What real sellers will ask for first | Each has API + UI + tests |
| **P3** | CI: `typecheck`, `build`, `test:e2e` on a throwaway DB, `test:pwa`; lint + unit test framework | Prevent regressions in the P0 work | Pipeline green on PRs |

**Not recommended now:** reputation/reviews, offline writes/sync, i18n, notifications, bulk-buyer role, or any expansion of billing until C-03 is decided.

---

## 12. Proposed Stage 2 plan

**Stage 2 — Security Hardening Sprint (S-01 → S-04 first), no feature scope.**

1. **Test harness first (half day).** Add a `test:e2e:clean` path that creates a throwaway SQLite DB (`migrate deploy` + seed in `/tmp` or a temp dir), boots the app against it on an ephemeral port, runs `verify-api.mjs`, and tears down. This removes the “run against dev data and mutate it” hazard seen in Stage 1. Add the missing assertions as failing tests **before** any fix (S-01..S-04, S-06, S-07, S-10, S-11, S-13).
2. **S-01, S-03, S-04 (one PR).** Mediator-derived dispute scope; claim creation restricted to `SENT`/`RECEIVED`; explicit transition map with per-actor permissions and side-effect routing. Verify with the new tests plus the full suite (expect 135+).
3. **S-02 + S-08 (one PR).** Ownership validation for `customerOrderId`; projection matrix for `customerDataVisibility`; regression test proving no foreign customer fields.
4. **S-06 + S-15 + S-13 (one PR).** Remove landing-page credentials; random per-seed passwords; same-origin guard in `route()` for non-GET.
5. **S-05 + S-07 + N-01 (one PR).** Attempt tracking/lockout with 429, real IP into `startSession`, tier 0 at registration with an explicit verification step decision (email transport is a product decision; until then, do not claim “verified”).
6. **S-11 + S-10 + N-07/N-08 (one PR).** Stock ledger on listing/offer, restore on cancel/decline, `confirmedQty` validation, minimum-resale enforcement at order creation.
7. **S-12 + S-14 + S-09 (one PR).** Transactional/durable audit for critical actions, session rotation and absolute cap, password reset/change with revocation.
8. **C-03 decision and reconciliation (owner).** One written decision; then either complete billing properly or remove the entitlement gates and the billing surface from V1.
9. **Report and re-audit.** Produce a Stage 2 verification report with before/after test evidence, then ask for a fresh read-only audit before any real-user pilot.

**Explicit non-goals for Stage 2:** new product features, reputation, offline writes, i18n, notifications, UI redesign, dependency upgrades, schema redesign beyond what a fix strictly needs, and any change to product requirements.

**Exit criteria for Stage 2:** all P0/P1 findings closed with tests that failed before and pass after; no S-01..S-04 reproduction; `verify-api.mjs` and `test:pwa` green on a clean throwaway DB; documented C-03 decision; and no new high-severity finding introduced.

---

## Appendix — Files and symbols referenced

`prisma/schema.prisma`, `prisma/seed.ts`, `src/lib/api.ts`, `src/lib/audit.ts`, `src/lib/auth/session.ts`, `src/lib/auth/rbac.ts`, `src/lib/auth/password.ts`, `src/lib/validation.ts`, `src/lib/money.ts`, `src/lib/enums.ts`, `src/lib/plans.ts`, `src/lib/subscription.ts`, `src/server/accounts.ts`, `src/server/workspace.ts`, `src/server/supplier.ts`, `src/server/price-access.ts`, `src/server/disputes.ts`, `src/app/api/**/route.ts` (51), `src/app/(app)/**/page.tsx`, `src/app/marketplace/**/page.tsx`, `src/app/page.tsx`, `src/components/*.tsx`, `public/sw.js`, `public/manifest.json`, `public/offline.html`, `scripts/verify-api.mjs`, `scripts/pwa-checks.mjs`, `scripts/verify-pwa.mjs`, `Dockerfile`, `docker-compose.yml`, `scripts/deploy.sh`.
