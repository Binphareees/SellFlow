# SellFlow PRD v0.2 — Canonical Requirements Register

**Document ID:** PRD_V0.2
**Product:** SellFlow
**Market:** Nigeria first
**Approval status:** Approved (per current task context)
**Document status:** Canonical in-repo requirements register
**Last updated:** 2026-11-04

> ## Source-status notice — read before using this document
>
> The **complete approved PRD v0.2 text is not present in this repository, in git history, or in the current task context.** The only direct reference found is a single sentence in `.cloud-attachments/imported-conversation-8531d94e174765bae96644b652aed29d33da0f370cc1578b9b5d8fa9df690b14.json`, which cites “Section 21.1 of the approved SellFlow PRD v0.2” while requesting discovery interview scripts.
>
> This file is therefore a **requirements register**, not a verbatim copy of the approved PRD. It records only requirements that are explicitly supported by available source material, and it marks every unsupported area as a **source gap**. No missing requirement has been invented or reconstructed from guesswork.
>
> **Authority rule:** Where this register conflicts with the approved PRD v0.2 text, the approved PRD text wins. Supply the approved document so this register can be reconciled and re-issued.
>
> **Implementation rule:** Implementation is **authorized** as of 2026-11-04 by the project owner (Implementation GO, `STATE.md` D-019). That authorization came from the owner, not from this register: this document neither grants nor withholds it, and authorizing implementation did **not** approve the product or complete validation. **Phase 0 validation remains pending and no validation GO has been granted.**
>
> Historical note preserved: before 2026-11-04, implementation was frozen and this document recorded that it did not authorize implementation. Requirement **P0-09** (“Do not authorize implementation before a recorded GO”) records that earlier rule; it stays in the register as history and is superseded for authorization only by D-019, while remaining true as a statement about validation approval.

---

## 0. Document control

### 0.1 Status summary

| Item | Status |
|---|---|
| PRD v0.2 | Approved |
| Phase 0 validation | Pending |
| Interview evidence | Not yet established |
| Prototype commitments | Not yet established |
| Concierge experiment | Not completed |
| Validation GO decision | Not granted |
| Implementation authorization | **Granted 2026-11-04** (owner Implementation GO, `STATE.md` D-019) — Phase 0 validation remains pending |

### 0.2 Source inventory

| Source | What it provides | Reliability for this register |
|---|---|---|
| Current task brief | Required PRD sections; three participant groups; validation gate; security restrictions | Authoritative for this task |
| `README.md` | Actual architecture and enforced product behavior | Implementation documentation, not approved PRD text |
| `STATE.md` | Decisions D-001 to D-013; product history | Historical decisions |
| `VALIDATION_PLAN.md` | Original Phase 0 gate and interview structure | Approved validation intent |
| `templates/DISCOVERY_INTERVIEW_SCRIPTS.md` | Three-persona discovery scripts derived from PRD §21.1 | Derived artifact; explicitly notes the PRD is missing |
| `MVP_SPEC.md` | Original local-first MVP scope | Historical; superseded in part by D-011 |
| `prisma/schema.prisma` | Implemented data model and enumerations | Implementation evidence, not requirements authority |
| `SELLFLOW_V02_AUDIT_REPORT.md` | Audit of implementation against reconstructed requirements | Audit evidence |
| `.cloud-attachments/imported-conversation-*.json` | One citation of PRD §21.1 | Citation only; no PRD body |

### 0.3 Requirement status legend

| Status | Meaning |
|---|---|
| **Sourced** | Explicitly supported by the task brief or an existing repository document. |
| **Partially sourced** | The intent is supported, but detail needed for acceptance is missing. |
| **Source gap** | No approved text is available. The requirement is **not reconstructed**. |

### 0.4 Missing source register

The following material is missing and must be supplied before this register can be treated as a complete PRD:

1. The complete approved PRD v0.2 body, including clause numbering.
2. The full text of Section 21.1 (discovery research basis).
3. Per-feature acceptance criteria and edge-case rules.
4. The role and permission matrix, including whether `BUSINESS_OWNER` is a marketplace role.
5. Commission, payout and settlement rules for resellers.
6. Receipt and statement formats, fields, periods and delivery rules.
7. Approved offline behavior, sync model and conflict-resolution rules.
8. Privacy and regulatory requirements (including NDPR/NDPA obligations, retention and data-subject rights).
9. Business-model assumptions with numbers: pricing, conversion, cost and unit economics.
10. Arbitration of V1 scope conflicts, especially subscription billing and paid-plan enforcement.
11. Dispute service levels, appeal rules and outcome taxonomy beyond what is implemented.
12. Trust and reputation rules, including whether completed-order reviews are in V1.

---

## 1. Product overview

**Approved intent available from source:** SellFlow is a mobile-first business-management and supplier-to-reseller commerce platform for **businesses of all kinds and sizes in Nigeria**. It is not limited to fashion, accessories, boutiques or any single vertical. Its core promise is: “Know who still owes you, and remind them in one tap.” It serves three sides: ordinary business owners, suppliers, and resellers.

**Target market (correction recorded 2026-11-04):** The overall target market is Nigerian businesses across industries and business sizes. Phase 0 uses a **manageable but diverse** sample drawn from categories such as retail, fashion, electronics, food, beauty, household goods, wholesale and distribution, and other relevant sectors. Diversity exists to test whether the problems are shared across industries — it does not mean every category must use every feature.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| PO-01 | Provide a business workspace for customers, orders, payments and balances. | Sourced | Task §1; README |
| PO-02 | Provide a supplier-to-reseller marketplace with public and private pricing. | Sourced | Task §1; README |
| PO-03 | Serve business owners, suppliers and resellers on one platform. | Sourced | Task §4; DISCOVERY |
| PO-04 | Be mobile-first and installable as a PWA. | Sourced | README; STATE D-003 |
| PO-05 | Keep money as integer minor units (kobo), never floating point. | Sourced | README; `src/lib/money.ts` |
| PO-06 | Exclude payment gateways, wallets, escrow, transfers and bank verification from V1. | Sourced | STATE D-013; README |
| PO-07 | Target Nigerian businesses of all kinds and sizes across industries; do not restrict the product to fashion, accessories or a single vertical. | Sourced | Owner correction 2026-11-04; task §1 |
| PO-08 | Validate a manageable but diverse sample covering at least four business categories, such as retail, fashion, electronics, food, beauty, household goods, wholesale/distribution and other relevant sectors. | Sourced | Owner correction 2026-11-04; VALIDATION |
| PO-09 | Do not assume every business category uses every feature. During discovery, classify each participant’s need as business management, supplier-to-reseller marketplace, or both. | Sourced | Owner correction 2026-11-04 |
| PO-10 | Keep the overall target market broad even if the early sample over-represents some categories. Category mix is a sampling decision, not a permanent narrowing of the market. | Sourced | Owner correction 2026-11-04 |

**Source status:** Product positioning and the three-sided model are sourced. The broad Nigerian target market and the category-diversity rule are sourced from the owner correction of 2026-11-04. The approved PRD’s detailed market analysis, personas, positioning language and success metrics remain a **source gap**.

---

## 2. Business management

**Approved intent available from source:** The workspace lets a business owner record customers, products, orders, manual payments and payment promises, and see who still owes money. The home screen is debt-first.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| BM-01 | Create and maintain customer records with a normalized WhatsApp number. | Sourced | README; `src/lib/money.ts` |
| BM-02 | Create and maintain products with selling price and cost price in kobo. | Sourced | README; `prisma/schema.prisma` |
| BM-03 | Create orders with line items, quantities and a server-computed total and cost snapshot. | Sourced | README |
| BM-04 | Record manual payments as a list; never overwrite payment history. | Sourced | README; STATE D-007 |
| BM-05 | Derive amount paid, balance due and payment state (`UNPAID`, `PART_PAID`, `PAID`). | Sourced | README; `src/server/workspace.ts` |
| BM-06 | Reject overpayment with a clear message; credit and refunds are out of scope. | Sourced | README; MVP_SPEC |
| BM-07 | Record payment promises and surface them for follow-up. | Sourced | README |
| BM-08 | Show a debt-first home screen (“Who owes me”) with outstanding totals. | Sourced | STATE D-006; MVP_SPEC |
| BM-09 | Provide one-tap WhatsApp reminders with prefilled text; never send automatically. | Sourced | README; MVP_SPEC |
| BM-10 | Show gross profit as order revenue minus cost snapshot. | Sourced | README; audit |
| BM-11 | Provide order filters by payment state and order status. | Sourced | README; MVP_SPEC |
| BM-12 | Support order edit, soft delete, undo and a trash view. | Partially sourced | MVP_SPEC lists this; current implementation lacks it |
| BM-13 | Record expenses and calculate net profit. | Source gap | Not specified in available approved text; not implemented |
| BM-14 | Import/export CSV and back up/restore data. | Partially sourced | MVP_SPEC lists export/restore; task §13 lists CSV; not implemented |

**Source status:** Core workspace behavior is sourced. Expenses/net profit, exact order-edit rules, and backup/restore acceptance criteria are source gaps or historical MVP intent.

---

## 3. Supplier-to-reseller marketplace

**Approved intent available from source:** Suppliers publish products and reseller offers. Approved resellers see a private wholesale price per offer, apply to suppliers, accept agreements, and place supplier orders that move through stock confirmation, dispatch and delivery.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| MK-01 | Suppliers can publish product listings with a public retail price, category, stock and MOQ. | Sourced | README; DISCOVERY |
| MK-02 | Public discovery supports search, category, retail price band, stock filter and sorting. | Sourced | README |
| MK-03 | A public supplier directory and per-supplier storefront exist. | Sourced | README |
| MK-04 | Resellers can apply to a specific supplier for reseller access. | Sourced | README; DISCOVERY |
| MK-05 | Approved resellers see a private price for that supplier’s offer, never another reseller’s price. | Sourced | README; DISCOVERY |
| MK-06 | Supplier orders are created from agreed prices, not client-supplied prices. | Sourced | README; audit |
| MK-07 | Supplier orders support stock confirmation, payment claims, dispatch and delivery confirmation. | Sourced | README |
| MK-08 | Each lifecycle step is owned by one party; wrong-party actions return 403. | Sourced | README |
| MK-09 | Public pages must never expose private reseller prices. | Sourced | README; audit |
| MK-10 | Validate both marketplace sides during Phase 0. | Sourced | Task §4 |

**Source status:** Marketplace shape is sourced. Exact listing fields, category taxonomy, search ranking, storefront content rules and marketplace acceptance criteria are **source gaps**.

---

## 4. Account and role model

**Approved intent available from source:** One account owns one business workspace. Marketplace roles are additive on the same account. The implemented roles are `BUSINESS_OWNER`, `RESELLER`, `SUPPLIER` and `MEDIATOR`, plus a platform-admin flag.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| AR-01 | Registration creates `User → Profile → BUSINESS_OWNER role → BusinessWorkspace` in one transaction. | Sourced | README |
| AR-02 | An account has exactly one owned business workspace. | Sourced | README |
| AR-03 | `RESELLER`, `SUPPLIER` and `MEDIATOR` are additive roles on the same account. | Sourced | README |
| AR-04 | Reseller access is self-service through an application. | Sourced | README |
| AR-05 | Supplier access is activated by creating a supplier profile. | Sourced | README |
| AR-06 | Mediator and platform-admin access are platform-controlled. | Sourced | README |
| AR-07 | Verification tiers run from 0 (unverified) to 3 (documents verified). | Sourced | README; `src/lib/enums.ts` |
| AR-08 | Tier 2–3 requires platform review. | Sourced | README; `src/server/accounts.ts` |
| AR-09 | `BUSINESS_OWNER` is a workspace role, not a marketplace role. | Partially sourced | Audit flags a conflict: it is implemented as a `ProfileRole` |
| AR-10 | Define the full role/permission matrix and account-restriction rules. | Source gap | Not available in approved text |
| AR-11 | Require email verification before granting a “contact verified” tier. | Partially sourced | Audit finding S-07; approved PRD wording unavailable |
| AR-12 | Provide password reset/change and account recovery. | Source gap | Not specified in available text; not implemented |

**Source status:** The implemented role model is documented. The approved PRD’s exact role definitions, `BUSINESS_OWNER` treatment, verification evidence rules and account lifecycle are **source gaps**.

---

## 5. Public and private pricing

**Approved intent available from source:** Listings have a public retail price. Reseller wholesale prices are private and must be enforced on the server, never hidden only in the UI.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| PR-01 | Public listing queries must not select private price columns. | Sourced | README; `src/server/price-access.ts` |
| PR-02 | Private prices are read only through a single server-side authorization module. | Sourced | README; audit |
| PR-03 | Access requires a session, the `RESELLER` role, an approved application for that supplier, an active agreement and an active offer. | Sourced | README |
| PR-04 | Denials return a reason code and never a price. | Sourced | README |
| PR-05 | Price-access denials are audited. | Sourced | README |
| PR-06 | The owning supplier and platform moderators may read the private price; moderator reads are logged. | Sourced | README |
| PR-07 | A guest or unapproved participant must receive 403 from the private-price endpoint. | Sourced | README; audit |
| PR-08 | Define the exact public/private field matrix and cache rules. | Source gap | Not available in approved text |

**Source status:** Private-price isolation is well sourced and verified by the audit. The full field-level pricing matrix is a **source gap**.

---

## 6. Supplier offers and versioning

**Approved intent available from source:** Supplier offers are versioned. Editing an offer creates a new version. Orders snapshot the agreement version and unit price so later edits never rewrite history.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| OV-01 | Editing offer terms appends a new `ResellerOfferVersion`. | Sourced | README |
| OV-02 | Each version carries price, minimum resale, commission, MOQ, stock, payment terms, delivery responsibility, advertising permission and customer-data visibility. | Sourced | `prisma/schema.prisma`; `src/lib/enums.ts` |
| OV-03 | Supplier order items snapshot `agreementVersionId` and `unitPriceKobo`. | Sourced | README |
| OV-04 | Historical orders must never be repriced by a later version. | Sourced | README |
| OV-05 | Define when a new version becomes effective and how resellers are notified. | Source gap | Not available in approved text |
| OV-06 | Define offer suspension/archival effects on existing orders. | Source gap | Not available in approved text |

**Source status:** Versioning intent is sourced. Effective-date, notification and archival rules are **source gaps**.

---

## 7. Reseller applications and agreements

**Approved intent available from source:** A reseller applies to a supplier. The supplier approves or rejects. Approval creates an agreement and version 1 in `PENDING_ACCEPTANCE`; the private price stays locked until the reseller accepts.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| RA-01 | Resellers can apply to a specific supplier. | Sourced | README |
| RA-02 | Suppliers can approve or reject an application. | Sourced | README |
| RA-03 | Approval creates `ResellerAgreement` plus version 1 as `PENDING_ACCEPTANCE`. | Sourced | README |
| RA-04 | The reseller must accept the agreement before the price is available. | Sourced | README |
| RA-05 | Agreements support versioned terms and counter-offers. | Sourced | README; `prisma/schema.prisma` |
| RA-06 | Define dual-acceptance rules for negotiated versions. | Source gap | Audit notes the current implementation sets both party timestamps on one acceptance |
| RA-07 | Define termination, suspension and re-application rules. | Partially sourced | `TERMINATED` status exists; approved rules unavailable |

**Source status:** Application and agreement flow is sourced. Negotiation acceptance semantics and termination rules are **source gaps**.

---

## 8. Supplier orders and fulfilment

**Approved intent available from source:** A reseller creates a supplier order from agreed prices. The supplier confirms stock, records payment claims, dispatches, and the reseller confirms delivery. Each step belongs to one party.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| SO-01 | Reseller creates a supplier order from a published listing and an active agreement. | Sourced | README |
| SO-02 | Unit prices come from the agreement; client-supplied prices are ignored. | Sourced | README; audit |
| SO-03 | Supplier confirms, partially confirms or declines stock. | Sourced | README |
| SO-04 | Payment claims are recorded by one party and confirmed or disputed by the other. | Sourced | README |
| SO-05 | Supplier records dispatch details; reseller confirms delivery received. | Sourced | README |
| SO-06 | Status moves forward one step at a time; illegal transitions are rejected. | Sourced | README; audit finds this is not currently enforced |
| SO-07 | Stock is reserved or decremented on confirmation and restored on cancellation/decline. | Partially sourced | Audit finds this is not currently enforced |
| SO-08 | Define the full transition matrix, cancellation rules and partial-fulfilment rules. | Source gap | Not available in approved text |
| SO-09 | Define delivery evidence requirements and who may mark delivery. | Partially sourced | README says reseller confirms; detail missing |

**Source status:** The lifecycle shape is sourced. The formal state machine, stock ledger and cancellation policy are **source gaps** or partial.

---

## 9. Disputes and moderation

**Approved intent available from source:** A dispute is a written record attached to a supplier order and optionally to a payment claim. Only the two parties and mediators may see it. The event trail is append-only. A party cannot resolve their own dispute.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| DM-01 | A dispute can be raised only by a party to the supplier order. | Sourced | README |
| DM-02 | A dispute may link to a specific payment claim. | Sourced | README |
| DM-03 | Both parties and mediators can add evidence notes. | Sourced | README |
| DM-04 | The dispute event trail is append-only. | Sourced | README |
| DM-05 | Mediators can take a dispute up for review, resolve it with an outcome, or close it. | Sourced | README |
| DM-06 | A party can never resolve their own dispute. | Sourced | README |
| DM-07 | Dispute visibility is restricted to the two parties and mediators. | Sourced | README; audit finds a `scope=all` bypass |
| DM-08 | Define appeal rules, service levels and the full outcome taxonomy. | Source gap | Not available in approved text |
| DM-09 | Define whether disputes can be reopened and by whom. | Source gap | Not available in approved text |

**Source status:** Core dispute behavior is sourced. Appeals, SLAs, reopening and full outcome definitions are **source gaps**. The current `scope=all` access bypass is an implementation defect, not an approved requirement.

---

## 10. Trust and reputation

**Approved intent available from source:** Trust is supported by verification tiers, audit trails and dispute history. The available material does not define a review or reputation system.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| TR-01 | Display verification tiers and verification events. | Sourced | README; `prisma/schema.prisma` |
| TR-02 | Keep an audit trail of security-relevant actions. | Sourced | README |
| TR-03 | Preserve dispute history as part of trust evidence. | Sourced | README |
| TR-04 | Define completed-order reviews and reputation scoring. | Source gap | Task lists “trust and reputation”; no approved rules available; not implemented |
| TR-05 | Define how trust signals affect ranking, access or approval. | Source gap | Not available in approved text |
| TR-06 | Define fraud, abuse and account-restriction handling. | Source gap | Not available in approved text |

**Source status:** Verification and audit are sourced. Reviews, reputation scoring, fraud handling and restriction workflows are **source gaps**.

---

## 11. Reseller economics

**Approved intent available from source:** A reseller buys at a private wholesale price and sells at their own price, subject to the supplier’s minimum resale price and other agreed terms. The data model supports commission type (`NONE`, `PERCENT`, `FIXED`), minimum resale, MOQ, payment terms, delivery responsibility, advertising permission and customer-data visibility.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| RE-01 | A reseller may set a resale price at or above the agreed minimum. | Sourced | README; DISCOVERY |
| RE-02 | The supplier may set a minimum resale price per offer. | Sourced | `prisma/schema.prisma` |
| RE-03 | The supplier may set MOQ, payment terms, delivery responsibility and advertising permission. | Sourced | `prisma/schema.prisma` |
| RE-04 | Commission may be `NONE`, `PERCENT` or `FIXED`. | Sourced | `src/lib/enums.ts` |
| RE-05 | Customer-data visibility may be `NONE`, `ORDER_ONLY` or `FULL`. | Sourced | `src/lib/enums.ts` |
| RE-06 | Enforce minimum resale, advertising permission, commission and payment terms at the relevant actions. | Partially sourced | Terms exist; audit finds they are stored but not enforced |
| RE-07 | Define commission calculation, payout timing and settlement evidence. | Source gap | Not available in approved text; not implemented |
| RE-08 | Define how refunds, returns and cancelled orders affect commission. | Source gap | Not available in approved text |

**Source status:** The term set is sourced. Enforcement details, commission settlement and refund treatment are **source gaps**.

---

## 12. Payment tracking

**Approved intent available from source:** Payments are manual records. SellFlow does not move money, verify bank transfers or guarantee payment. Balances are derived from the payment list. Supplier payment claims are party-recorded and confirmed by the counterparty.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| PT-01 | Record manual payments with amount, method, date, reference and note. | Sourced | README |
| PT-02 | Store amounts as integer kobo. | Sourced | README |
| PT-03 | Reject overpayment. | Sourced | README |
| PT-04 | Void a payment without deleting history. | Sourced | README |
| PT-05 | Derive balances from the sum of non-voided payments. | Sourced | README |
| PT-06 | Record supplier payment claims as `SENT` or `RECEIVED` and require counterparty confirmation. | Sourced | README |
| PT-07 | Never claim that a payment was verified by SellFlow. | Sourced | README; task §7 |
| PT-08 | Define reconciliation, refund and credit-note behavior. | Source gap | Not available in approved text; refunds/credits are out of scope in MVP_SPEC |

**Source status:** Manual payment tracking is sourced. Reconciliation and refund rules are **source gaps**.

---

## 13. Receipts and statements

**Approved intent available from source:** Sellers should be able to send a receipt in one tap, ideally as an image or PDF through the share sheet, with a download/print fallback. The task also lists statements.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| RS-01 | Generate a receipt for an order or payment. | Partially sourced | STATE D-008; MVP_SPEC; audit says not implemented |
| RS-02 | Share the receipt as an image or PDF through the Web Share API where supported. | Partially sourced | MVP_SPEC |
| RS-03 | Provide a download/print fallback. | Partially sourced | MVP_SPEC |
| RS-04 | Generate customer statements for a period. | Source gap | Task lists statements; no approved fields, period or format available |
| RS-05 | Define receipt numbering, branding, tax fields and retention. | Source gap | Not available in approved text |

**Source status:** Receipt intent is partially sourced. Statement requirements, formats and numbering are **source gaps**. Neither receipts nor statements are implemented in the current codebase.

---

## 14. Offline functionality

**Approved intent available from source:** SellFlow is an installable PWA. The current service worker never caches HTML or API responses and serves a static offline fallback. The original MVP spec wanted offline record creation and export/restore, but the approved v0.2 requirement is not available.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| OF-01 | The app is installable with a valid manifest and icons. | Sourced | README; audit |
| OF-02 | HTML navigations are network-first and never cached. | Sourced | README |
| OF-03 | `/api/*` is never intercepted or cached. | Sourced | README |
| OF-04 | A static offline screen explains the offline state and offers retry. | Sourced | README |
| OF-05 | Define whether orders/payments can be created or edited offline. | Source gap | Not available in approved text; current app requires network for writes |
| OF-06 | Define sync, queueing and conflict-resolution rules if offline writes are in scope. | Source gap | Not available in approved text; not implemented |
| OF-07 | Define how private prices and customer data are protected on a shared device. | Source gap | Not available in approved text |

**Source status:** Installability and conservative caching are sourced. Offline writes, sync and conflict resolution are **source gaps** and are not implemented.

---

## 15. Privacy and compliance

**Approved intent available from source:** Do not expose real customer records or private reseller prices. Use synthetic data in demonstrations. Obtain consent before recording interviews and never publish participant identities, customer names or price lists without permission.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| PC-01 | Do not use real customer records in demonstrations or public screenshots. | Sourced | Task §7; MVP_SPEC |
| PC-02 | Do not expose private reseller prices to unapproved participants. | Sourced | Task §7; README |
| PC-03 | Obtain consent before recording or note-taking in interviews. | Sourced | DISCOVERY |
| PC-04 | Never publish participant names, customer names, phone numbers or price lists without written permission. | Sourced | DISCOVERY |
| PC-05 | Keep secrets out of the repository. | Sourced | TECH_STACK; README |
| PC-06 | Define data retention, deletion and export rights. | Source gap | Not available in approved text |
| PC-07 | Define NDPR/NDPA compliance obligations, lawful basis and data-processing agreements. | Source gap | Not available in approved text |
| PC-08 | Define breach notification and incident response. | Source gap | Not available in approved text |

**Source status:** Demonstration and interview privacy rules are sourced. Regulatory, retention and incident-response requirements are **source gaps** and must be supplied by the approved PRD or legal review.

---

## 16. Security requirements

**Approved intent available from source:** Authorization is enforced on the server. Workspace data is scoped to the session workspace. Private prices are isolated. Sessions are httpOnly and hashed at rest. Security-relevant actions are audited. No fintech surface exists.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| SE-01 | Enforce authentication and authorization on every protected route. | Sourced | README; audit |
| SE-02 | Scope every workspace read/write to the session `workspaceId`, never a body-supplied ID. | Sourced | README |
| SE-03 | Enforce private-price access in one server module. | Sourced | README |
| SE-04 | Store passwords with bcrypt and session tokens as salted hashes. | Sourced | README; `src/lib/auth` |
| SE-05 | Use httpOnly, `SameSite=Lax` cookies; `Secure` in production. | Sourced | README; audit |
| SE-06 | Audit security-relevant actions. | Sourced | README |
| SE-07 | Reject wrong-party lifecycle actions with 403. | Sourced | README |
| SE-08 | Restrict dispute visibility to parties and mediators. | Sourced | README; audit finds a bypass |
| SE-09 | Prevent a claimant from self-confirming a payment claim. | Sourced | README; audit finds a creation-time bypass |
| SE-10 | Add authentication rate limiting and account lockout. | Partially sourced | Audit finding S-05; approved PRD wording unavailable |
| SE-11 | Validate cross-tenant references such as `customerOrderId`. | Partially sourced | Audit finding S-02; approved PRD wording unavailable |
| SE-12 | Define a formal threat model, security acceptance criteria and incident process. | Source gap | Not available in approved text |

**Source status:** Core authorization and session requirements are sourced. Rate limiting, threat modeling, incident response and formal security acceptance criteria are **source gaps** or audit-driven. Current implementation gaps are recorded in `SELLFLOW_V02_AUDIT_REPORT.md`; they do not change the requirement.

---

## 17. V1 scope and deferred features

**Approved intent available from source:** V1 includes the business workspace, the supplier-to-reseller marketplace, private pricing, versioned offers and agreements, supplier orders, disputes and an installable PWA. V1 excludes payment gateways, wallets, escrow, in-app transfers, automatic bank verification, AI features and a bulk-buyer role.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| VS-01 | In scope: business workspace (customers, products, orders, manual payments, promises, gross profit). | Sourced | README |
| VS-02 | In scope: marketplace discovery, private pricing, applications, agreements and versioning. | Sourced | README |
| VS-03 | In scope: supplier orders, stock confirmation, claims, dispatch, delivery and disputes. | Sourced | README |
| VS-04 | In scope: installable PWA with offline fallback. | Sourced | README |
| VS-05 | Out of scope: payment gateways, wallets, escrow, transfers and bank verification. | Sourced | STATE D-013; README |
| VS-06 | Out of scope: AI features. | Sourced | STATE D-004 |
| VS-07 | Out of scope: bulk-buyer role. | Sourced | README |
| VS-08 | Subscription billing and paid-plan enforcement are out of V1 scope. | Partially sourced | Audit finds them implemented; approved V1 boundary needs confirmation |
| VS-09 | Cloud sync between devices is out of scope. | Partially sourced | README says so; the server database already centralizes data, so the statement needs clarification |
| VS-10 | Resolve the V1 scope list against the approved PRD. | Source gap | The approved V1/deferred list is not available in full |

**Source status:** The broad V1 boundary is sourced. Subscription billing, cloud-sync wording and the full deferred-feature list are **source gaps** or conflicts requiring an explicit product decision.

---

## 18. Business model assumptions

**Approved intent available from source:** Tooling must stay at zero cost for the prototype. No AI API and no paid auth/image services. Payments remain manual. Monetization is a later experiment, anchored on what sellers already pay for tools, not on invented market rates.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| BZ-01 | Keep prototype tooling within free tiers; no paid APIs. | Sourced | TECH_STACK; AI_HANDOFF |
| BZ-02 | Do not add a payment gateway, wallet, escrow, transfer or bank verification. | Sourced | STATE D-013 |
| BZ-03 | Test a one-time customization offer only with a real seller. | Sourced | MONETIZATION |
| BZ-04 | Test any recurring plan only after repeat usage is observed. | Sourced | MONETIZATION |
| BZ-05 | Anchor pricing on what interviewees already pay for tools. | Sourced | MONETIZATION; VALIDATION |
| BZ-06 | Define pricing, conversion, churn, CAC and unit-economics assumptions with numbers. | Source gap | Not available in approved text |
| BZ-07 | Define the paid-plan feature boundary and whether billing is in V1. | Source gap | Conflicts with implemented subscription billing |

**Source status:** Cost guardrails and monetization sequencing are sourced. All numerical business-model assumptions are **source gaps**. The existing subscription implementation is out of scope and must not be treated as approved V1 behavior.

---

## 19. Phase 0 validation gate

**Approved intent available from source:** Phase 0 tests whether Nigerian businesses across a diverse but manageable sample have a recurring, costly problem that SellFlow can solve, and whether they will commit real usage. Validation is pending. No implementation is authorized until a recorded GO.

**Requirements register:**

| ID | Requirement | Status | Source |
|---|---|---|---|
| P0-01 | Confirm the target market (Nigerian businesses of all kinds) and country before outreach, and select a diverse category sample. | Sourced | Owner correction 2026-11-04; Task §4 |
| P0-02 | Complete at least 8 interviews. | Sourced | Task §4; VALIDATION |
| P0-03 | Record at least 4 independent, unprompted mentions of the same meaningful problem. | Sourced | Task §4; VALIDATION |
| P0-04 | Secure at least 3 concrete prototype-testing commitments with agreed start dates. | Sourced | Task §4; VALIDATION |
| P0-05 | Collect evidence that existing tools are inadequate. | Sourced | Task §4; VALIDATION |
| P0-06 | Validate both marketplace sides (suppliers and resellers) as well as business owners. | Sourced | Task §4 |
| P0-07 | Record the GO / REVISE / STOP decision in `STATE.md`. | Sourced | Task §4; VALIDATION |
| P0-08 | Do not claim validation has passed before the evidence exists. | Sourced | Task preamble |
| P0-09 | Do not authorize implementation before a recorded GO. | Sourced | Task preamble; STATE |
| P0-10 | Include at least four distinct business categories in the interview sample, drawn from retail, fashion, electronics, food, beauty, household goods, wholesale/distribution and other relevant sectors. | Sourced | Owner correction 2026-11-04 |
| P0-11 | Record each participant’s pillar fit (business management / marketplace / both). Do not require every category to use every feature, and do not treat a category that needs only one pillar as a failure. | Sourced | Owner correction 2026-11-04 |
| P0-12 | Keep the sample large enough to compare categories (minimum 8 interviews) but small enough to recruit and support without lowering evidence quality. | Sourced | Owner correction 2026-11-04; Task §4 |

**Gate status:** **PENDING.** No interviews, commitments, competitor check, category plan or concierge experiment are recorded. The gate is not met.

**Decision rule:** GO requires all of P0-02 through P0-07 and P0-10 through P0-12. REVISE applies when the problem is real but the category mix, problem or workflow needs adjustment. STOP/PIVOT applies when there is no consistent problem across categories, existing tools are adequate, or fewer than three commitments are secured by the decision date.

**Source status:** The gate criteria are explicitly sourced from the task and the original `VALIDATION_PLAN.md`. The approved PRD’s own Phase 0 wording and any additional gates are a **source gap**.

---

## Appendix A — Traceability summary

| PRD area | Primary in-repo evidence | Confidence |
|---|---|---|
| Product overview | README, task | High |
| Business management | README, MVP_SPEC, schema | High for core; gaps for expenses/backup |
| Marketplace | README, discovery scripts | High for shape; gaps for taxonomy |
| Accounts and roles | README, schema, audit | Medium; `BUSINESS_OWNER` conflict |
| Pricing | README, price-access, audit | High |
| Offers and versioning | README, schema | High for versioning; gaps for effective dates |
| Applications and agreements | README, schema | Medium; negotiation semantics unclear |
| Supplier orders | README, audit | Medium; state machine missing |
| Disputes | README, audit | Medium; appeals/SLA missing |
| Trust and reputation | README, audit | Low; reviews/reputation unspecified |
| Reseller economics | Schema, enums, README | Medium; enforcement/settlement missing |
| Payment tracking | README, schema | High |
| Receipts and statements | STATE D-008, MVP_SPEC | Low; not implemented |
| Offline | README, service worker | Medium; offline writes unspecified |
| Privacy and compliance | Task, MVP_SPEC, discovery scripts | Medium; regulatory detail missing |
| Security | README, audit | Medium; formal criteria missing |
| V1 scope | README, STATE, audit | Medium; billing conflict |
| Business model | MONETIZATION, STATE | Low; numbers missing |
| Phase 0 gate | Task, VALIDATION | High |

## Appendix B — Change control

| Date | Change | By |
|---|---|---|
| 2026-11-04 | Register created from available repository sources. Complete approved PRD text was not available; gaps marked. | Phase 0 documentation reset |
| 2026-11-04 | Target-market correction: the market is Nigerian businesses of all kinds, not a single fashion/accessories segment. Added PO-07 to PO-10 and P0-10 to P0-12, including category diversity and pillar-fit classification. | Owner correction |

**Next action:** Supply the approved PRD v0.2 text. Reconcile this register section by section, remove the source-gap markers that become sourced, and re-issue the document. Until then, this register is the best available index, not a substitute for the approved PRD.
