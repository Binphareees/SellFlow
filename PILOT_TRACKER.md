# SellFlow Pilot Tracker — Phase 0

**Status:** Blank template — no participants or activity recorded
**Phase:** 0 — validation and concierge experiment
**Owner:** _name_
**Started:** _YYYY-MM-DD_
**Last updated:** _YYYY-MM-DD_
**Decision date:** 2026-12-11 (**PROPOSED — awaiting user approval**)
**Environment / database:** _e.g. pilot SQLite file, staging Postgres_
**Canonical onboarding tool:** `npm run pilot:seed` (`scripts/seed-pilot.mjs`)

> **Implementation authorized, validation not complete (2026-11-04).** Implementation GO (D-019) lets development proceed **in parallel** with this tracker's work. Nothing recorded here is satisfied by shipping code: the tracker measures real participant behaviour and remains blank until real events happen.

This is the operational record for Phase 0 participants, marketplace activity and the two-week
concierge experiment. The interview record is `INTERVIEW_LOG.md`; the plan and gates are
`VALIDATION_PLAN.md`.

> **Do not invent participants, activity or results.** One row per real event, recorded on the same
> day. The committed version stays blank. A filled-in copy contains participant details and private
> prices and must stay private.

Related docs: `VALIDATION_PLAN.md` (plan and gates), `PRD_V0.2.md` (requirements register),
`INTERVIEW_LOG.md` (interviews), `templates/DISCOVERY_INTERVIEW_SCRIPTS.md` (field scripts),
`STATE.md` (decisions).

## Rules for this file

- **Keep the filled-in copy private.** It contains participant contact details and private
  wholesale prices. Do not publish it, attach it to a public issue, or commit a filled-in copy to a
  public repository.
- One row per real participant, offer, application, approval, agreement, order, claim, delivery and
  dispute. No invented data.
- Never write passwords, session tokens, bank details or full customer phone numbers here.
  Use the account IDs printed by the seeder and a masked phone where a human needs to call.
- Record IDs exactly as printed by the seeder; they are the only reliable way to find the record later.
- A reseller agreement is **ACTIVE** only when both sides accepted and `currentVersionId` is set.
  If it is not active, the reseller must not see wholesale prices.
- Money is recorded in whole Naira in this tracker, but the database stores integer kobo.
  The seeder converts Naira input to kobo; never type kobo into a Naira column.
- Update this file on the same day as the event, not from memory at the end of the week.
- Do not record a demo as a pilot activity. Demonstrations use synthetic accounts and are not
  marketplace evidence.

## Onboarding a pilot pair

```bash
# 1. Validate the answers without writing anything
npm run pilot:seed -- --config ./pilot-pair.json --dry-run

# 2. Write supplier + catalogue + reseller + pre-approved agreements
npm run pilot:seed -- --config ./pilot-pair.json --yes

# Interactive alternative (passwords are hidden while typing)
npm run pilot:seed
```

The seeder aborts if either email already exists and writes everything in one transaction. Copy the
printed User / Profile / Workspace / SupplierProfile / Application / Agreement IDs into the tables
below.

---

## 1. Participants

### 1a. Suppliers

| Pilot ID | Onboarded | Business name | Business category | Pillar fit | Contact name | Phone (masked) | Email | City / State | Tier | User ID | Profile ID | Workspace ID | SupplierProfile ID | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| S-001 | | | | BOTH / MKT | | | | | | | | | | Invited / Active / Paused | |
| S-002 | | | | | | | | | | | | | | | |
| S-003 | | | | | | | | | | | | | | | |

### 1b. Resellers

| Pilot ID | Onboarded | Business name | Business category | Pillar fit | Contact name | Phone (masked) | Email | City / State | Tier | User ID | Profile ID | Workspace ID | Application ID | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| R-001 | | | | BOTH / MKT | | | | | | | | | | Invited / Active / Paused | |
| R-002 | | | | | | | | | | | | | | | |
| R-003 | | | | | | | | | | | | | | | |

### 1c. Business-management participants

Business owners who use the workspace (customers, orders, payments, promises) but are not necessarily
suppliers or resellers.

| Pilot ID | Onboarded | Business name | Business category | Pillar fit | Contact name | Phone (masked) | Email | City / State | Tier | User ID | Profile ID | Workspace ID | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B-001 | | | | BM / BOTH | | | | | | | | | Invited / Active / Paused | |
| B-002 | | | | | | | | | | | | | | |
| B-003 | | | | | | | | | | | | | | |

**Tier key:** 0 unverified · 1 contact verified · 2 business details reviewed · 3 documents verified.
Tier 2–3 is an operator decision; record the evidence reference in the participant's onboarding note,
not the evidence itself.

**Category examples:** retail, fashion, electronics, food, beauty, household goods, wholesale/distribution, services, other.
**Pillar key:** BM = business management only · MKT = marketplace only · BOTH = needs both · UNCLEAR = not yet established.
The sample should cover at least four categories; do not assume every category uses every feature.

### 1d. Category coverage

| Category | Suppliers | Resellers | Business owners | Total interviews | BM only | MKT only | Both | Unclear |
|---|---|---|---|---|---|---|---|---|
| Retail / general goods | | | | | | | | |
| Fashion / accessories | | | | | | | | |
| Electronics / phones | | | | | | | | |
| Food / groceries / restaurants | | | | | | | | |
| Beauty / cosmetics / salon | | | | | | | | |
| Household goods / furniture | | | | | | | | |
| Wholesale / distribution | | | | | | | | |
| Services / other | | | | | | | | |

**Diversity rule:** at least four categories; no single category above roughly half the completed interviews. Replace a stalled category with another rather than dropping diversity.

---

## 2. Marketplace activity

### 2a. Offers published

| Date | Offer ID | Supplier | Listing | Category | Public retail (₦) | Private wholesale (₦) | Min resale (₦) | MOQ | Stock qty | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | S-001 | | | | | | | | ACTIVE / PAUSED / ARCHIVED | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |

### 2b. Reseller applications

| Date | Application ID | Supplier | Reseller | Status | Decision date | Decided by | Reason / notes |
|---|---|---|---|---|---|---|---|
| | | S-001 | R-001 | PENDING / APPROVED / REJECTED / WITHDRAWN | | | |
| | | | | | | | |
| | | | | | | | |

### 2c. Supplier approvals

| Date | Application ID | Supplier | Reseller | Decision | Agreement created? | Agreement ID | Notes |
|---|---|---|---|---|---|---|---|
| | | S-001 | R-001 | APPROVED / REJECTED | Y / N | | |
| | | | | | | | |
| | | | | | | | |

### 2d. Active reseller agreements

One row per listing under an agreement. Private wholesale prices must never appear on a public page.

| Agreement ID | Supplier | Reseller | Listing | Public retail (₦) | Private wholesale (₦) | Min resale (₦) | MOQ | Payment terms (days) | Delivery | Status | Effective from | Accepted by supplier | Accepted by reseller | Last reviewed | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | S-001 | R-001 | | | | | | | SUPPLIER / RESELLER / SPLIT | ACTIVE | | | | | |
| | | | | | | | | | | | | | | | |
| | | | | | | | | | | | | | | | |

**Status values:** `DRAFT`, `PENDING_ACCEPTANCE`, `ACTIVE`, `SUPERSEDED`, `TERMINATED`.
An agreement only counts toward pilot activation when it is `ACTIVE` for the reseller in question.

### 2e. Stock confirmations

| Date | Supplier order ID | Supplier | Reseller | Decision | Ordered qty | Confirmed qty | Listing stock before | Listing stock after | Notes |
|---|---|---|---|---|---|---|---|---|---|
| | | S-001 | R-001 | CONFIRMED / PARTIAL / DECLINED | | | | | |
| | | | | | | | | | |
| | | | | | | | | | |

### 2f. Supplier orders

| Date | Supplier order ID | Supplier | Reseller | Items / summary | Order value (₦) | Status | Stock status | Payment claim status | Dispatched on | Delivered on | Completed on | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | S-001 | R-001 | | | SUBMITTED / STOCK_CONFIRMED / AWAITING_PAYMENT / PAID / DISPATCHED / DELIVERED / COMPLETED / CANCELLED / DISPUTED | PENDING / CONFIRMED / PARTIAL / DECLINED | NONE / CLAIMED / PARTIALLY_CONFIRMED / CONFIRMED / DISPUTED | | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |

### 2g. Payment-status claims

| Date | Claim ID | Supplier order ID | Claimed by | Role | Amount (₦) | Method | Reference | Status | Confirmed / disputed by | Decision date | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | S-001 / R-001 | SUPPLIER / RESELLER | | CASH / TRANSFER / POS / MOBILE | | SENT / RECEIVED / PARTIAL / CONFIRMED / DISPUTED | | | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |

### 2h. Delivery confirmations

| Date | Supplier order ID | Dispatched by | Courier | Tracking ref | Received qty OK? | Confirmed by | Notes |
|---|---|---|---|---|---|---|---|
| | | S-001 | | | Y / N | R-001 | |
| | | | | | | | |
| | | | | | | | |

### 2i. Agreement change log

| Date | Agreement ID | Change | Old value | New value | Changed by | Reason |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |

---

## 3. Disputes

Record every dispute raised during Phase 0, including ones resolved informally on WhatsApp. Link the
SellFlow dispute reference when one exists.

> **Do not demonstrate or run disputes with real users until the global dispute-access vulnerability
> (audit finding S-01) is fixed and verified.** Use synthetic accounts only.

| Dispute ref | Date raised | Raised by | Against | Order ref | Reason | Amount in dispute (₦) | Status | Mediator | Outcome | Resolution summary | Days open | Resolved on | Follow-up needed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | S-001 / R-001 | | | NON_DELIVERY / WRONG_ITEM / QUANTITY_MISMATCH / PAYMENT_NOT_RECEIVED / PRICE_MISMATCH / QUALITY / OTHER | | OPEN / UNDER_REVIEW / RESOLVED / CLOSED | | RESELLER_FAVOUR / SUPPLIER_FAVOUR / MUTUAL / NO_ACTION | | | | |
| | | | | | | | | | | | | | |
| | | | | | | | | | | | | | |

### 3a. Resolution summary

| Metric | Value | Notes |
|---|---|---|
| Disputes raised | | |
| Resolved / closed | | |
| Resolution rate | | resolved ÷ raised |
| Median days to resolve | | |
| Payment-not-received disputes | | |
| Disputes that needed a mediator | | |
| Reopened or escalated | | |

### 3b. Resolution detail (append-only notes)

| Date | Dispute ref | Event | Actor | Detail | Evidence reference |
|---|---|---|---|---|---|
| | | Opened / Evidence / Status change / Outcome / Closed | | | |
| | | | | | |

---

## 4. Repeat activity and experiment observations

### 4a. Repeat activity log

| Date | Participant | Activity | Day of experiment | Independent or assisted? | Notes |
|---|---|---|---|---|---|
| | S-001 / R-001 / B-001 | Login / order logged / payment recorded / supplier order / return visit | Day 1–14 | Independent / Assisted | |
| | | | | | |
| | | | | | |

### 4b. Day-3 and day-7 returns

| Participant | Onboarded | Day-3 returned? | Day-7 returned? | What they did | Notes |
|---|---|---|---|---|---|
| | | Y / N | Y / N | | |
| | | | | | |
| | | | | | |

### 4c. Concierge experiment observations

Record same-day observations from the two-week experiment. Distinguish participant actions from
operator interventions.

| Date | Participant | Observation | Blocker or friction | Operator intervention | Participant reaction | Follow-up |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |

### 4d. Experiment summary

| Metric | Value | Notes |
|---|---|---|
| Participants onboarded | | |
| Participants active in week 1 | | |
| Participants active in week 2 | | |
| Real orders logged | | |
| Supplier orders placed | | |
| Payments recorded | | |
| Repeat visits (day 3+) | | |
| Repeat visits (day 7+) | | |
| Participants who stopped | | Record reason |
| Biggest blocker | | |
| Would they pay? | | Record exact words |

---

## 5. Manual WhatsApp order volume

Phase 0 has no payment gateway by design. Orders and payments are recorded manually; this section
measures whether real WhatsApp order flow actually moves into SellFlow.

### 5a. Daily order log

| Date | Order ref (WhatsApp) | Participant | Direction | Items / summary | Order value (₦) | Deposit paid (₦) | Balance (₦) | Payment method | Logged in SellFlow? | SellFlow order # | Follow-up date | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| | | R-001 / S-001 / B-001 | Inbound / Outbound | | | | | CASH / TRANSFER / POS / MOBILE | Y / N | | | |
| | | | | | | | | | | | | |
| | | | | | | | | | | | | |

### 5b. Weekly volume roll-up

| Week starting | Participant | WhatsApp enquiries | Orders confirmed | Orders logged in SellFlow | Logged rate | GMV recorded (₦) | Payments recorded (₦) | Outstanding (₦) | Repeat customers | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| | R-001 | | | | | | | | | |
| | S-001 | | | | | | | | | |
| | | | | | | | | | | |

**Logged rate** = orders logged in SellFlow ÷ orders confirmed, as a percentage. This is the number
that matters: a participant who keeps using WhatsApp only has not adopted the product.

### 5c. Weekly total (all participants)

| Week starting | Active participants | WhatsApp orders confirmed | Orders logged in SellFlow | Logged rate | GMV recorded (₦) | Payments recorded (₦) | Outstanding (₦) | Notes |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
| | | | | | | | | |

---

## 6. Phase 0 scorecard

Update weekly. A compliment is not a signal; recorded behaviour is.

| Metric | Week 1 | Week 2 | Week 3 | Week 4 | Gate / target |
|---|---|---|---|---|---|
| Completed interviews | | | | | ≥ 8 |
| Distinct business categories | | | | | ≥ 4 |
| Largest single category share | | | | | ≤ ~50% |
| Participants needing business management only | | | | | Supporting |
| Participants needing marketplace only | | | | | Supporting |
| Participants needing both pillars | | | | | Supporting |
| Suppliers onboarded | | | | | ≥ 1 real supplier |
| Resellers onboarded | | | | | ≥ 3 committed resellers |
| Business owners onboarded | | | | | Supporting |
| Active agreements | | | | | ≥ 1 per active reseller |
| Participants who logged a real order | | | | | ≥ 3 |
| WhatsApp orders confirmed (all) | | | | | Track only |
| Orders logged in SellFlow | | | | | ≥ 60% of confirmed |
| GMV recorded (₦) | | | | | Track only |
| Payments recorded (₦) | | | | | Track only |
| Day-3 return | | | | | ≥ 2 participants |
| Day-7 return | | | | | ≥ 1 participant |
| Disputes raised / resolved | | | | | 100% logged |
| Serious paid-customisation conversations | | | | | ≥ 1 |
| Churn / stopped using | | | | | Record reason |

**GO / REVISE / STOP** is decided in `STATE.md` against `VALIDATION_PLAN.md`, not here.

---

## 7. Seeder run log

Keep a record of every onboarding run so an account can always be traced back to an operator and a
command. Never include passwords in this table.

| Run at | Operator | Environment / DB | Supplier email | Reseller email | Products created | Agreements created | Result | Command / config ref | Notes |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | Success / Aborted / Dry run | | |
| | | | | | | | | | |
| | | | | | | | | | |

---

## 8. Change log

| Date | Change | By |
|---|---|---|
| 2026-11-04 | Tracker expanded for Phase 0: added business-management participants, offers, applications, approvals, stock confirmations, supplier orders, payment claims, delivery confirmations, repeat activity and concierge observations. All tables remain blank. | Phase 0 documentation reset |
| | Tracker created for Phase 0 | |
