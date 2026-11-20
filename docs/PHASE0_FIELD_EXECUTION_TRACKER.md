# SellFlow — Phase 0 Field Execution Tracker (Standalone Operational Log)

**Document date:** 2026-11-21  
**Prepared by:** Buffy (documentation only; no application code, schema, migration, register or database changes)  
**Repository:** `/home/binpharees/Documents/SellFlow-Bootcamp-v2`  
**Branch / HEAD:** `main` / `f4d3fd22abc5da8cd27dd66d59d2dd5430c0ff2c`  
**Status:** Phase 0 incomplete; validation GO/REVISE/STOP not granted. SellFlow is **not** described as validated, Stage 3 ready, or pilot-launch ready.

**Grounding sources:** `docs/PHASE0_PILOT_LAUNCH_VALIDATION_PLAN.md` (categories A–D, Go/No-Go gates G-01…G-14, technical/security pre-pilot gates S-01…S-15, C-01, C-03) and `docs/PHASE0_INTERVIEW_SCRIPTS.md` (supplier/reseller scripts, commitment ladder A/B/C, capture templates, category coverage rules).

**Privacy rule (mandatory):** This file is committed to the repository and must remain PII-free. Use anonymized cohort IDs only (`SUP-NG-01`, `RES-NG-01`). Never store raw phone numbers, personal emails, legal names, customer names, or unredacted price lists here. Keep raw contact details, interview recordings, and redacted artifacts in a private off-repository sheet. Filled-in rows must be anonymized before commit; the canonical private copies live in `INTERVIEW_LOG.md` and `PILOT_TRACKER.md`.

**Product boundary preserved:** manual payment records/claims only (D-013, no gateway/wallet/escrow/bank verification); integer kobo math; server-side reseller price privacy (`src/server/price-access.ts`); WhatsApp prefilled links only; Decision 6 partial-payment cancellation and held-stock workflow; no subscription billing (C-03). No application code, schema, migration, test config, `STATE.md`, or `GEMINI.md` was modified by this document.

---

## §1 — Quota & Cohort Coverage Dashboard

Rollup of target vs. completed counts. Update after every interview and every pilot order. **No single category may exceed roughly 50% of completed interviews.**

### 1.1 Interview quota rollup (target from plan §3 and scripts §0.1)

| Dimension | Target | Completed | Remaining | Status |
|---|---:|---:|---:|---|
| Total interviews | ≥ 8 | 0 | ≥ 8 | Not started |
| Distinct categories represented | ≥ 4 (A–D) | 0 | ≥ 4 | Not started |
| Supplier interviews | ≥ 3 | 0 | ≥ 3 | Not started |
| Reseller interviews | ≥ 3 | 0 | ≥ 3 | Not started |
| Dated commitments (ladder A) | ≥ 3 | 0 | ≥ 3 | Not started |
| Observed supplier–reseller order flows | ≥ 1 (or documented reason) | 0 | ≥ 1 | Not started |
| Unprompted same-problem mentions | ≥ 4 | 0 | ≥ 4 | Not started |
| Concierge experiment days completed | 14 | 0 | 14 | Not started |
| Participants logging a real order | ≥ 3 | 0 | ≥ 3 | Not started |
| WhatsApp orders logged in SellFlow | ≥ 60% | n/a | n/a | Not started |
| Repeat usage by day 3 | ≥ 2 | 0 | ≥ 2 | Not started |
| Repeat usage by day 7 | ≥ 1 | 0 | ≥ 1 | Not started |

### 1.2 Coverage by role × category

| Category code | Category name | Supplier target | Supplier done | Reseller target | Reseller done | Total done | % of completed |
|---|---|---:|---:|---:|---:|---:|---:|
| A | Fashion, apparel and footwear | 1–2 | 0 | 1–2 | 0 | 0 | 0% |
| B | Beauty, cosmetics and haircare | 1–2 | 0 | 1–2 | 0 | 0 | 0% |
| C | Phone accessories and consumer electronics | 1–2 | 0 | 1–2 | 0 | 0 | 0% |
| D | Packaged FMCG, provisions, home goods | 1–2 | 0 | 1–2 | 0 | 0 | 0% |
| **Total** | | ≥ 3 | 0 | ≥ 3 | 0 | 0 | 100% |

### 1.3 Coverage by Nigerian commercial hub

| Hub | Supplier done | Reseller done | Total done | Notes |
|---|---:|---:|---:|---|
| Lagos | 0 | 0 | 0 | |
| Kano | 0 | 0 | 0 | |
| Aba | 0 | 0 | 0 | |
| Onitsha | 0 | 0 | 0 | |
| Abuja | 0 | 0 | 0 | |
| Other | 0 | 0 | 0 | Record hub name in private sheet only |

### 1.4 Pillar-fit tally (update after every interview)

| Pillar fit | Count | Notes |
|---|---:|---|
| BUSINESS_MANAGEMENT | 0 | |
| MARKETPLACE | 0 | |
| BOTH | 0 | Do not force toward "both" |
| UNCLEAR | 0 | |

---

## §2 — Anonymized Outreach & Interview Pipeline Log

**PII-free rules:** use anonymized cohort IDs only (`SUP-NG-01`, `RES-NG-01`). No raw phone numbers, personal emails, legal names, customer names, or unredacted price lists. Record channel as a category (Voice call / In person / Chat), not a handle. Keep raw contact details in a private off-repository sheet. Score signal strength honestly: strong / weak / none — a warm "God bless you" with no commitment is **none**.

### 2.1 Outreach & interview pipeline table

| Cohort ID | Role | Category | Hub | Channel | Outreach Date | Interview Status | Script Version | Commitment Tier (A/B/C) | Pilot Candidate? | Notes / Friction Signals |
|---|---|---|---|---|---|---|---|---|---|---|
| SUP-NG-01 | Supplier | A | Lagos | (voice call) | (YYYY-MM-DD) | Not started | v1 (2026-11-20) | none | No | Placeholder row — replace with anonymized real data |
| RES-NG-01 | Reseller | A | Lagos | (voice call) | (YYYY-MM-DD) | Not started | v1 (2026-11-20) | none | No | Placeholder row — replace with anonymized real data |

**Column guidance:**
- **Cohort ID:** `SUP-NG-01`… for suppliers, `RES-NG-01`… for resellers. Sequential per role.
- **Role:** Supplier (B) / Reseller (C). Business-owner (A) interviews are tracked separately via `templates/DISCOVERY_INTERVIEW_SCRIPTS.md` §1.
- **Category:** A / B / C / D (from plan §3).
- **Hub:** Lagos / Kano / Aba / Onitsha / Abuja / Other.
- **Channel:** Voice call / In person / Chat.
- **Interview Status:** Not contacted / Contacted / Scheduled / Completed / Declined / No-show.
- **Script Version:** date of the interview-script revision used (current `v1 (2026-11-20)`).
- **Commitment Tier:** A (dated commitment to test with confirmed start date) / B (real redacted artifact handed over) / C (scheduled follow-up call/demo, supporting only) / none. A "yes" without a date is **not** a commitment.
- **Pilot Candidate?:** Yes / No / Maybe — whether the participant is a candidate for the 2-week live pilot.
- **Notes / Friction Signals:** verbatim unprompted mentions, amounts lost, tools named with weaknesses, objections. No PII.

### 2.2 Commitment ladder reference (from scripts §1.3)

| Ask | Meaning | Counts toward G-08? |
|---|---|---|
| A | Dated commitment to test the prototype for a defined period, with a confirmed start date | Yes |
| B | Hand over a real redacted artifact (price list, notebook page, current ad, tracker screenshot) | Yes |
| C | Scheduled follow-up call or demo | No (supporting signal only) |

### 2.3 Interview evidence capture (per interview, link to private `INTERVIEW_LOG.md`)

For each completed interview, record in the private log (not here): interview ID, date, interviewer, note-taker, category, hub, channel, duration, consent, synthetic demo used, pillar fit, signal strength, unprompted mentions, verbatim quotes with amounts, commitment outcome with date/time/channel, and redacted artifacts. This tracker only holds anonymized rollups and cohort IDs.

---

## §3 — Live 2-Week Pilot Cohort & Order Ledger Tracker

Track active pilot pairs and order lifecycle. Statuses follow the supplier order lifecycle: `SUBMITTED` → `STOCK_CONFIRMED` → `PAID` → `DISPATCHED` → `DELIVERED` / `CANCELLED`. Payments are manual records/claims only (D-013); no gateway/wallet/escrow/bank verification. Partial-payment cancellations follow Decision 6 (stock held/quarantined, `PaymentReversal` ledger entry, explicit admin/mediator release).

### 3.1 Active pilot pairs

| Pair ID | Supplier ID | Reseller ID | Category | Products listed (count) | Start date | End date | Status | Notes |
|---|---|---|---|---:|---|---|---|---|
| (none yet) | | | | 0 | | | Not started | |

### 3.2 Pilot order ledger

| Order ID (anonymized) | Pair ID | Supplier ID | Reseller ID | Category | Items | Total (kobo) | Paid (kobo) | Status | Manual claim recorded? | Manual claim confirmed? | Cancelled after partial payment? | Stock held? | Stock released? | Notes |
|---|---|---|---|---|---|---:|---:|---|---|---|---|---|---|---|
| (none yet) | | | | | | 0 | 0 | | No | No | No | No | No | |

**Status values:** `SUBMITTED`, `STOCK_CONFIRMED`, `PAID`, `DISPATCHED`, `DELIVERED`, `CANCELLED`, `DISPUTED`.

**Order-level rules:**
- Record orders on the same day they occur (plan §5.3 rule 3).
- Manual payment claims: a reseller says "I sent the money"; the supplier confirms against bank alert/transfer receipt. The app records the claim; it does not move or verify money.
- Partial-payment cancellation (Decision 6): stock is held/quarantined (not restored) and a `PaymentReversal` ledger entry is created; release requires explicit admin/mediator action. Record `Stock held? = Yes` and `Stock released? = Yes/No`.
- Disputes: use synthetic accounts only until S-01 is fixed and verified; log all disputes raised.

### 3.3 Pilot adoption & repeat-usage counters

| Metric | Target | Current | Status |
|---|---:|---:|---|
| Participants logging a real order | ≥ 3 | 0 | Not started |
| Confirmed WhatsApp orders logged in SellFlow | ≥ 60% | 0% | Not started |
| Participants returning by day 3 | ≥ 2 | 0 | Not started |
| Participants returning by day 7 | ≥ 1 | 0 | Not started |
| Total orders created | — | 0 | |
| Total orders delivered | — | 0 | |
| Total orders cancelled | — | 0 | |
| Cancellations after partial payment | — | 0 | |
| Stock-hold releases performed | — | 0 | |
| Disputes raised (synthetic only) | — | 0 | |

---

## §4 — Gate Evidence Rollup (G-01…G-14) & Pre-Pilot Technical Gate Sign-Off

### 4.1 Business validation gates (plan §5.1)

Score each gate **Met / Not met / Insufficient evidence**. Do not average away a missing gate. Link captured interview IDs and pilot order IDs as evidence references.

| # | Gate | Required | Status | Evidence ref (interview IDs, tracker rows) |
|---|---|---|---|---|
| G-01 | Interview evidence | ≥ 8 completed interviews across ≥ 4 categories | ☐ Met ☐ Not met ☐ Insufficient | |
| G-02 | Problem evidence | Specific past events, amounts lost, time wasted, repeated behaviour recorded | ☐ Met ☐ Not met ☐ Insufficient | |
| G-03 | Cost evidence | Money, time, lost customers or embarrassment documented with examples | ☐ Met ☐ Not met ☐ Insufficient | |
| G-04 | Category diversity | No single category above roughly 50% of completed interviews | ☐ Met ☐ Not met ☐ Insufficient | |
| G-05 | Pillar fit | Every participant classified; not forced toward "both" | ☐ Met ☐ Not met ☐ Insufficient | |
| G-06 | Marketplace both sides | ≥ 3 supplier + ≥ 3 reseller interviews, plus ≥ 1 observed supplier–reseller order flow (or documented reason) | ☐ Met ☐ Not met ☐ Insufficient | |
| G-07 | Tool inadequacy | Named current tools and specific weaknesses documented | ☐ Met ☐ Not met ☐ Insufficient | |
| G-08 | Commitments | ≥ 3 dated commitments with agreed start dates | ☐ Met ☐ Not met ☐ Insufficient | |
| G-09 | Concierge experiment | Two-week experiment completed with same-day observations and return data | ☐ Met ☐ Not met ☐ Insufficient | |
| G-10 | Adoption behaviour | ≥ 3 participants log a real order; ≥ 60% of confirmed WhatsApp orders logged in SellFlow | ☐ Met ☐ Not met ☐ Insufficient | |
| G-11 | Repeat usage | ≥ 2 participants return by day 3; ≥ 1 by day 7 | ☐ Met ☐ Not met ☐ Insufficient | |
| G-12 | Dispute handling | All disputes raised are logged; dispute walkthroughs use synthetic accounts until S-01 is fixed and verified | ☐ Met ☐ Not met ☐ Insufficient | |
| G-13 | Unprompted same-problem mentions | ≥ 4 independent mentions | ☐ Met ☐ Not met ☐ Insufficient | |
| G-14 | Decision recorded in `STATE.md` | GO / REVISE / STOP with date and evidence references | ☐ Met ☐ Not met ☐ Insufficient | |

### 4.2 Technical and security pre-pilot gates (plan §5.2)

Before onboarding external pilot users, each item must be verified/accepted or formally risk-accepted in writing by the owner. Statuses are from `STATE.md` as of the latest sync.

| Item | Current status (from `STATE.md`) | Verified / Risk-accepted? | Evidence / owner note |
|---|---|---|---|
| S-01 Dispute disclosure | Accepted | ☐ | |
| S-02 Cross-tenant customerOrderId IDOR | Accepted | ☐ | |
| S-03 Payment-claim self-assignment | Implemented — awaiting verification | ☐ | Tracked Vitest: `src/server/supplier-s03-s04.test.ts` (D1, D2, D3, D4, D7) |
| S-04 Supplier lifecycle bypass | Implemented — awaiting verification | ☐ | Tracked Vitest: `src/server/supplier-s03-s04.test.ts` (D5, D6, D8, `PAID -> CANCELLED`) |
| S-05 Auth rate limiting / lockout | Implemented — awaiting verification | ☐ | |
| S-06 Published demo credentials | Authorized | ☐ | |
| S-07 Email-less verification tier | Implemented — awaiting verification | ☐ | |
| S-08 Customer visibility leak | Implemented — awaiting verification | ☐ | |
| S-09 Password reset/change | Implemented — awaiting verification | ☐ | Tracked Vitest: `src/lib/auth/reset-request-throttle.test.ts`; `/reset-password` page, Postgres and Resend still unverified |
| S-10 Commercial terms enforcement | Implemented — awaiting verification | ☐ | |
| S-11 Stock validation / restoration | Implemented — awaiting verification | ☐ | |
| S-12 Audit trail | Accepted | ☐ | |
| S-13 CSRF origin check | Implemented — awaiting verification | ☐ | |
| S-14 Long-lived sessions | Accepted | ☐ | |
| S-15 Privileged demo seed accounts | Implemented — awaiting verification | ☐ | |
| C-03 Subscription billing scope | Open | ☐ | Must be decided before pilot |
| C-01 Missing approved PRD text | Open | ☐ | Should be supplied before final pilot scope sign-off |

### 4.3 Decision 6 tracking (Owner Decision 6)

| Item | Status | Evidence |
|---|---|---|
| Partial-payment cancellation implemented | Implemented (commits `90a3674`, `615d451`) | `src/server/workspace.ts` `updateOrderStatus` |
| `PaymentReversal` ledger (integer kobo) | Implemented | `prisma/schema.prisma` `PaymentReversal` |
| Held/quarantined stock (`stockHeldAt`) | Implemented | `src/server/workspace.ts` |
| Explicit admin/mediator held-stock release | Implemented | `src/server/workspace.ts` `releaseHeldStock` |
| Tracked Vitest coverage | Added (commit `4645b9d`) | `src/server/decision6-stock-hold.test.ts` |
| Phase 0 validation | Pending | Subject to G-01…G-14 and §4.2 |

---

## §5 — Weekly Review & Escalation Cadence

Log weekly field synthesis without claiming validation prematurely. Complete every week during Phase 0; do not mark a gate Met without evidence.

### 5.1 Weekly review checklist

- [ ] Update §1 quota dashboard (interviews completed, categories, hubs, pillar fit).
- [ ] Update §2 pipeline log (new outreach, completions, commitments).
- [ ] Update §3 pilot ledger (orders, statuses, claims, cancellations, stock holds).
- [ ] Record any unprompted mentions and amounts lost.
- [ ] Note any participant who declined or no-showed, and why.
- [ ] Update §4 gate scores with evidence references (interview IDs, tracker rows).
- [ ] Flag any technical/security gate that is blocking pilot onboarding.
- [ ] Write one line: "What surprised me this week was ____." If nothing surprised you, you probably asked leading questions.
- [ ] Send thank-you messages the same day; send commitment confirmations (plan Appendix B) the same day a commitment is made.

### 5.2 Escalation rules

- If a single category exceeds roughly 50% of completed interviews, stop recruiting in that category until others catch up.
- If fewer than 3 suppliers or 3 resellers are interviewed, do not score G-06 as Met.
- If no dated commitment is obtained after 8 interviews, escalate to the owner before continuing.
- If a real-user dispute arises before S-01 is fixed and verified, stop and switch to synthetic accounts only.
- If a participant asks to keep something off the record, keep it off the record; do not store it here.
- Do not describe SellFlow as validated or claim Phase 0 validation / Stage 3 readiness at any point. A validation decision (GO / REVISE / STOP) is recorded only in `STATE.md` with date and evidence references (G-14).

### 5.3 Evidence retention rules

- Keep filled-in `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` private; committed versions stay blank.
- Redact names, phone numbers and price lists in retained artifacts.
- Record verbatim quotes, amounts, tools, specific events and commitments with dates.
- Record orders and commitments on the same day they occur.

---

## Working-tree & DB checksum (at creation)

```text
git status --short:
(untracked: docs/PHASE0_FIELD_EXECUTION_TRACKER.md)

sha256sum prisma/dev.db:
59d9cb2c6bd8ee65c87479c486c2779fb4d5263a371673c7bf1dd5fd3885592c
```

No application code, schema, migration, register, test config, `STATE.md`, `GEMINI.md`, or database file was modified by this document. No Git commit or push was performed. SellFlow remains not validated, and Stage 3 readiness is not claimed.