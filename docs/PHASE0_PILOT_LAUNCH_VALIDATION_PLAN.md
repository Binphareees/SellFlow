# SellFlow — Phase 0 Pilot Launch & Validation Preparation Plan

**Document date:** 2026-11-20  
**Prepared by:** Buffy (read-only planning; no application code, schema, migration, register or database changes)  
**Repository:** `/home/binpharees/Documents/SellFlow-Bootcamp-v2`  
**Branch / HEAD:** `main` / `615d4511a25134a129c25d402e76047db16f118a`  
**Status:** Phase 0 incomplete; validation GO/REVISE/STOP not granted; implementation authorized separately by D-019.

## 1. Scope and guardrails

This document is a planning artifact only. It does not implement S-03, S-04, S-09 or any other code change, does not change `STATE.md`, does not modify `prisma/dev.db`, and does not rewrite migration history. It preserves the V1 product boundary:

- Manual payment records/claims only (D-013). No payment gateway, wallet, escrow, bank verification or automated settlement.
- Integer kobo money math; no floating-point money.
- Private reseller prices only through server-side entitlement checks (`src/server/price-access.ts`).
- WhatsApp prefilled links only; no automated WhatsApp messaging.
- No subscription billing in V1 (C-03 remains open unless the owner decides otherwise).
- SellFlow is **not** described as validated, Stage 3 ready, or pilot-launch ready until the Phase 0 gates below pass.
- Stage 3 readiness: **NOT READY**. Phase 0 validation is incomplete and no validation GO has been granted.
- Owner Decision 6 status: implemented and committed (partial-payment cancellation, refund/credit ledger, and held-stock release); it remains subject to Phase 0 validation and security verification.

## 2. Existing Phase 0 and governance baseline

### 2.1 Canonical governance and planning files

| File | Current gate status | Notes |
|---|---|---|
| `STATE.md` | Phase 0 — Validate; gate not passed; validation decision proposed 2026-12-11 | Implementation authorized 2026-11-04 (D-019); validation still incomplete. S-01 and S-02 and S-12 and S-14 accepted; S-03, S-04, S-05, S-06, S-07, S-08, S-09, S-10, S-11, S-13, S-15 remain tracked. |
| `PHASE0_READINESS_REPORT.md` | Phase 0 pending; GO not granted | Documents D-019 and the standing requirement that validation evidence remains absent. |
| `VALIDATION_PLAN.md` | Phase 0 pending | Defines 8–14 interviews, at least 4 categories, business owner / supplier / reseller groups, concierge experiment, and GO/REVISE/STOP process. |
| `PILOT_TRACKER.md` | Blank template; no participants or activity recorded | Operational record only; must remain blank until real events occur. |
| `INTERVIEW_LOG.md` | Blank template; zero completed interviews recorded | Canonical interview evidence record. |
| `PRD_V0.2.md` | Requirements register with source gaps | Complete approved PRD text still missing (C-01). |
| `06-OWNER-DECISION-REGISTER.md` | Not present in this repository snapshot | Owner decision register is referenced in prompt context; repository evidence was taken from `STATE.md` and existing Phase 0 reports. |
| `MONETIZATION_AND_LAUNCH.md` | Later-stage document only | Explicitly not a launch approval. |
| `MVP_SPEC.md` | Superseded (historical local-first MVP) | Do not use as build or launch instructions. |
| `TECH_STACK.md` | Superseded (historical Vite/IndexedDB plan) | Current stack is Next.js 15 App Router + Prisma + SQLite. |
| `ROADMAP.md` | Partially superseded | Phase 0 gates remain current; Phase 1 local-first tasks are historical. |

### 2.2 Phase 0 baseline summary

- Target market: Nigerian businesses of all kinds and sizes (D-018). The market is not permanently narrowed to one vertical.
- Phase 0 gate: pending. No interview evidence, no dated prototype commitments, no concierge results, no category mix, no competitor check, no validation GO.
- Validation decision date: proposed 2026-12-11, awaiting user approval. The original 2026-11-06 date is retained as history only.
- Category mix: not selected. At least four distinct business categories are required, with no single category above roughly half the completed interviews.
- Security baseline: S-01 accepted; S-02 accepted; S-12 accepted; S-14 accepted. All other audited findings remain open/tracked and must be resolved or formally risk-accepted before external pilot onboarding.
- S-09 read-only audit baseline: reset-request throttling remains a known gap; no S-09 code changes were authorized by this planning task.
- Product boundary: no payment gateway, no real-time sync, no subscription billing in V1 unless the owner explicitly changes C-03.

## 3. Nigerian category validation plan

The sample must contain at least four distinct categories. The four categories below are the required pilot validation set. Recruitment should target roughly 2–3 participants per category, with no category exceeding roughly half of completed interviews.

### Category A — Fashion, apparel and footwear

**Why it matters:** Price lists, reseller undercutting, WhatsApp catalogue sharing, partial payments, size/color variants, and informal supplier relationships are common.

Validation questions:
1. Price-privacy boundary: Can a supplier publish a public retail price while a named approved reseller sees a separate private wholesale price? Can an unapproved account or a browser screenshot leak that private price?
2. WhatsApp-first ordering: Does the participant already receive orders through WhatsApp status/messages, and can a prefilled WhatsApp message replace or reduce manual copy-paste?
3. Manual payment claim: When a reseller says “I sent the money,” how does the supplier currently verify before releasing goods? Is a manual claim with method/reference plus supplier confirmation acceptable?
4. Partial payment and held stock: When a customer pays a deposit, how is the balance tracked? What happens if an order is cancelled after deposit? Should stock be held/quarantined until an admin/mediator releases it?
5. Competitive differentiation: What is worse about current WhatsApp broadcast lists, Instagram catalogues and spreadsheet ledgers — price leakage, lost messages, balance errors, stock confusion, or dispute handling?

### Category B — Beauty, cosmetics and haircare

**Why it matters:** Fast-moving stock, expiry/batch concerns, frequent price changes, supplier-dependent resellers, and strong visual catalogue use.

Validation questions:
1. Price-privacy boundary: Do suppliers currently send price lists to resellers in ways that can be forwarded or screenshotted? Would server-enforced private pricing reduce undercutting?
2. WhatsApp-first ordering: Are orders and repeat purchases already initiated through WhatsApp/Instagram, and would a prefilled order link reduce back-and-forth?
3. Manual payment claim: Are payments often partial or installment-based, and how are claims currently recorded and confirmed?
4. Partial payment and held stock: If a beauty supplier confirms partial stock, how does the participant expect stock to be adjusted? What should happen to held stock if the order is cancelled?
5. Competitive differentiation: How do existing tools fail for expiry, stock availability, price consistency and reseller trust?

### Category C — Phone accessories and consumer electronics

**Why it matters:** High-value items, fast price movement, warranty/serial-number concerns, and pressure on margins make price privacy and payment claims especially important.

Validation questions:
1. Price-privacy boundary: Would suppliers trust the app enough to expose private wholesale pricing to approved resellers only? What must never be visible publicly?
2. WhatsApp-first ordering: Are high-value orders already negotiated on WhatsApp, and would an order-status trail reduce disputes?
3. Manual payment claim: How do participants handle proof of transfer, partial payments and balance reminders without claiming that money actually moved?
4. Partial payment and held stock: For high-value stock, should cancellation after partial payment preserve deducted stock until explicit release by an admin or mediator?
5. Competitive differentiation: What do spreadsheets, WhatsApp and informal ledgers fail to do for warranty, stock, margin and payment tracking?

### Category D — Packaged FMCG, provisions or home goods

**Why it matters:** Repeat orders, stock turnover, low margins, frequent small payments and multi-party supplier/reseller flows make operational discipline more important than feature breadth.

Validation questions:
1. Price-privacy boundary: Is public retail price enough for discovery while private wholesale terms remain gated by reseller approval?
2. WhatsApp-first ordering: Can prefilled WhatsApp messages support repeat orders without requiring a full e-commerce checkout?
3. Manual payment claim: Do suppliers need a claim workflow for cash, transfer, POS and mobile payments, with explicit confirmation rather than automatic settlement?
4. Partial payment and held stock: How should deposits, balances, cancellation and stock restoration be handled when stock moves quickly?
5. Competitive differentiation: Why would participants switch from WhatsApp lists, Telegram catalogues or manual notebooks to a structured order/payment record?

## 4. Cross-category validation questions

Every interview should test these V1-specific behaviours regardless of category:

### 4.1 Price privacy and entitlement

- What price can the general public see today?
- Who is allowed to see the supplier’s wholesale price?
- How does the participant currently prevent resellers from undercutting?
- What would make a supplier trust or distrust a private-price display?
- What should happen if a reseller agreement is inactive, suspended or terminated?

### 4.2 WhatsApp-first ordering and manual payment claims (D-013)

- Is the order initiated on WhatsApp today?
- Would a prefilled WhatsApp message be useful, or would it be ignored?
- How is payment proof currently shared?
- Who confirms payment, and when?
- What should the app record without pretending to verify that money moved?
- What dispute evidence should be attached to a manual claim?

### 4.3 Partial payment, refund/credit and held stock (Owner Decision 6)

- How are deposits and balances currently recorded?
- What happens when an order is cancelled after partial payment?
- Should stock be restored immediately, held/quarantined, or require admin/mediator release?
- What audit trail is needed for cancellation, refund, credit and stock release?
- Who is allowed to release held stock, and under what condition?

### 4.4 Competitive differentiation

- What tool or workaround is used today?
- What does it do well?
- What fails repeatedly?
- What would have to be true for the participant to switch?
- What would make the participant stop using SellFlow after one week?

## 5. Phase 0 Go / No-Go checklist

### 5.1 Business validation gates (all must pass for GO)

| Gate | Pass criteria | Fail criteria |
|---|---|---|
| G-01 Interview evidence | At least 8 completed interviews across at least 4 categories | Fewer than 8 interviews, or fewer than 4 categories |
| G-02 Problem evidence | Specific past events, amounts lost, time wasted, repeated behaviour recorded | Opinions, compliments or “good idea” statements only |
| G-03 Cost evidence | Money, time, lost customers or embarrassment documented with examples | No concrete cost evidence |
| G-04 Category diversity | No single category above roughly 50% of completed interviews | One category dominates the sample |
| G-05 Pillar fit | Each participant classified as business management, marketplace, both or unclear | Pillar fit not recorded or forced toward “both” |
| G-06 Marketplace both sides | At least 3 supplier interviews and 3 reseller interviews, plus at least one observed supplier-reseller order flow where possible | Only one marketplace side interviewed |
| G-07 Tool inadequacy | Named current tools and specific weaknesses documented | No competitor or workaround evidence |
| G-08 Commitments | At least 3 dated commitments to test, with agreed start dates | Vague “yes” without a date |
| G-09 Concierge experiment | Two-week experiment completed with same-day observations and return data | No experiment, or memory-based notes |
| G-10 Adoption behaviour | At least 3 participants log a real order; at least 60% of confirmed WhatsApp orders are logged in SellFlow | Participants continue using WhatsApp only |
| G-11 Repeat usage | At least 2 participants return by day 3 and at least 1 by day 7 | No repeat usage |
| G-12 Dispute handling | All disputes raised are logged; dispute walkthroughs use synthetic accounts until S-01 is fixed and verified | Real-user disputes demonstrated before S-01 fix |

### 5.2 Technical and security pre-pilot gates

Before onboarding external pilot users, the following must be either resolved and verified or formally risk-accepted by the owner in writing. Statuses below are taken from `STATE.md` as of this audit.

| Item | Current status | Required before external pilot |
|---|---|---|
| S-01 Dispute disclosure | Accepted | Keep accepted; no real-user dispute demo before acceptance evidence. |
| S-02 Cross-tenant customerOrderId IDOR | Accepted | Keep accepted; verify no regression in pilot environment. |
| S-03 Payment-claim self-assignment | Implemented — awaiting verification | Must be verified or formally risk-accepted before real payment claims. |
| S-04 Supplier lifecycle bypass | Implemented — awaiting verification | Must be verified or formally risk-accepted before real supplier orders. |
| S-05 Auth rate limiting / lockout | Implemented — awaiting verification | Must be verified before external accounts. |
| S-06 Published demo credentials | Authorized | Must be removed or guarded before any real-user pilot. |
| S-07 Email-less verification tier | Implemented — awaiting verification | Must be verified or formally risk-accepted before trusting tier-based access. |
| S-08 Customer visibility leak | Implemented — awaiting verification | Must be verified before exposing customer data to resellers. |
| S-09 Password reset/change | Implemented — awaiting verification | Must be verified or formally risk-accepted; reset-request throttling remains a known gap. |
| S-10 Commercial terms enforcement | Implemented — awaiting verification | Must be verified before relying on minimum resale or advertising terms. |
| S-11 Stock validation / restoration | Implemented — awaiting verification | Must be verified before relying on stock and cancellation behaviour. |
| S-12 Audit trail | Accepted | Keep accepted; audit limitations remain documented. |
| S-13 CSRF origin check | Implemented — awaiting verification | Must be verified before external browser sessions. |
| S-14 Long-lived sessions | Accepted | Keep accepted; session limitations remain documented. |
| S-15 Privileged demo seed accounts | Implemented — awaiting verification | Must be guarded before any shared or production-like environment. |
| C-03 Subscription billing scope | Open | Must be decided before pilot: authorize billing in V1 and update PRD, or remove/disable billing surface and entitlement gates. |
| C-01 Missing approved PRD text | Open | Should be supplied before final pilot scope sign-off. |

### 5.3 Launch readiness rule

No external pilot onboarding is permitted until:

1. All business validation gates G-01 to G-12 pass, or the owner records a REVISE/STOP decision with evidence.
2. Every security item in section 5.2 is either verified/accepted or explicitly risk-accepted in writing by the owner.
3. `PILOT_TRACKER.md` contains real participant and activity rows recorded on the same day as events.
4. A validation decision (GO / REVISE / STOP) is recorded in `STATE.md` with date and evidence references.

## 6. Interview and evidence operating rules

- Lead with research, not a sales pitch.
- Ask about past behaviour, never future intent.
- Do not reveal the product before the discovery section.
- Obtain consent before notes, screenshots or artifacts.
- Use synthetic accounts and synthetic data in all demonstrations.
- Do not use published demo credentials.
- Do not expose private reseller prices to unapproved participants.
- Do not demonstrate disputes with real users until S-01 is fixed and verified.
- Do not claim payment or delivery verification; SellFlow records manual claims only.
- Keep filled-in `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` private; committed versions stay blank.
- Redact names, phone numbers and price lists in retained artifacts.
- Record verbatim quotes, amounts, tools, specific events and commitments with dates.

## 7. Working-tree and DB checksum confirmation

```text
git status --short:
(clean)

sha256sum prisma/dev.db:
59d9cb2c6bd8ee65c87479c486c2779fb4d5263a371673c7bf1dd5fd3885592c
```

No application code, schema, migration, register or database file was modified by this planning document. No push to remote was performed. SellFlow remains not validated, and Stage 3 readiness is not claimed.