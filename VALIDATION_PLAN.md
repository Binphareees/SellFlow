# SellFlow Phase 0 Validation Plan

**Status:** Phase 0 — Pending (validation incomplete; no GO granted)
**Implementation:** **Authorized 2026-11-04** (owner Implementation GO, `STATE.md` D-019) — validation and development run in parallel
**Last updated:** 2026-11-04
**Decision date:** 2026-12-11 (**PROPOSED — awaiting user approval**)
**Original kill date:** 2026-11-06 (retained as history; no longer realistic)
**Canonical PRD:** `PRD_V0.2.md` (requirements register; complete approved text still missing)
**Related records:** `INTERVIEW_LOG.md`, `PILOT_TRACKER.md`, `STATE.md`

> **This plan governs validation, not permission to build.** Implementation was authorized by the owner on 2026-11-04 (D-019), so validation activities continue **in parallel with development** and do not block coding. Phase 0 is still incomplete: GO has not been granted, and no result in this plan may be described as “passed” until the evidence exists and is reviewed. Authorized implementation is not validation approval.

---

## 1. Purpose

Phase 0 answers one question:

> Do Nigerian businesses across a diverse but manageable sample have a recurring, costly problem that SellFlow can solve, and will real participants commit to testing it?

**Target market:** Nigerian businesses of **all kinds and sizes**, across industries. The market is not limited to fashion, accessories, boutiques or any single vertical. The sample is deliberately diverse so we can see whether the problems are shared across industries — but it stays small enough to recruit and support properly.

Compliments, enthusiasm and “this is a good idea” are **not** evidence. Only recorded behaviour, artifacts and dated commitments count.

The plan validates three participant groups and both sides of the marketplace:

- **A. Business owners** — customer, order, deposit/installment and payment-promise management.
- **B. Suppliers** — publishing products and reseller offers, protecting private prices, confirming stock and fulfilling orders.
- **C. Resellers** — applying to suppliers, promoting products, agreeing terms and placing supplier orders.

The marketplace side is only validated if **both** suppliers and resellers are interviewed and, where possible, observed in a real order flow.

**Do not assume every category uses every feature.** Some businesses need only business management (customers, orders, payments). Some suppliers and resellers need only the marketplace pillar. Some need both. Discovery must classify the need rather than force the full product on every participant.

---

## 2. What Phase 0 must prove

| Question | Evidence required |
|---|---|
| Is the problem real and recurring? | Specific past events, amounts lost, time wasted, repeated behaviour — not opinions |
| Is it costly? | Money, time, lost customers or embarrassment, with examples |
| Are existing tools inadequate? | Named tools, what they do badly, why participants stopped or work around them |
| Will participants change behaviour? | A dated commitment to test, not a vague “yes” |
| Does the marketplace work for both sides? | Supplier and reseller interviews plus at least one observed order flow |
| Is the problem shared across industries? | At least four distinct business categories in the sample, with comparable problem patterns recorded |
| Which product pillar does each category need? | A recorded pillar fit per participant: business management, marketplace, or both |
| Is the sample manageable and diverse? | 8–14 interviews across at least four categories, recruited without lowering evidence quality |

---

## 3. Participant groups

### A. Business owners

**Profile:** any Nigerian business that takes orders and tracks payments — retail, fashion, electronics, food, beauty, household goods, wholesale/distribution, services, and other relevant sectors. Business size varies: owner-run shops, small teams and larger businesses all qualify. Roughly 5–40 orders a week is a recruiting guide, not a filter. Orders may come through WhatsApp, Instagram, in person, phone or a combination.

**Focus:** last order walkthrough, where orders and payments are recorded, how balances are calculated, payment promises, reminder behaviour, money lost to forgotten balances. Also classify whether the business needs business management, marketplace, or both.

**Recruitment channels:** direct WhatsApp/Instagram outreach, market associations, trade and industry groups, referrals from the first interviewees, in-person visits to markets, plazas and business clusters.

### B. Suppliers / product owners

**Profile:** wholesaler, importer, manufacturer or product owner who supplies at least 3–5 resellers; has a price list that resellers should not share or undercut; confirms stock and fulfils orders.

**Focus:** how prices are shared, price leakage and undercutting, stock confirmation, order recording, dispatch, payment claims, reseller trust and disputes.

**Recruitment channels:** supplier referrals from business owners, wholesale markets, reseller communities, direct outreach to known suppliers.

### C. Resellers / emerging vendors

**Profile:** sells products they do not own; sources from at least one regular supplier; adds a margin or earns commission; advertises on WhatsApp status and Instagram; drop-ships or holds small stock.

**Focus:** sourcing, supplier price changes, commission/margin agreements, advertising permission, minimum resale price, customer-data visibility, fulfilment and payment flow.

**Recruitment channels:** reseller communities, Instagram/WhatsApp sellers, supplier referrals, referrals from business owners.

> **Category-diversity discipline:** confirm the target market (Nigerian businesses of all kinds) and country first. Then select **at least four distinct business categories** for the sample. Do not narrow the whole market to one vertical, and do not let one category supply more than roughly half the interviews. The sample should be diverse enough to test whether the problem is shared, and small enough to recruit and support well.

### 3.1 Category coverage and pillar fit (hypotheses, confirm in discovery)

This table is a **recruitment guide, not an assumption**. Mark the expected pillar fit before outreach, then replace it with what the participant actually needs.

| Category | Business management (customers, orders, payments) | Marketplace (supplier/reseller) | Confirm in discovery |
|---|---|---|---|
| Retail / general goods | Likely | Sometimes | ☐ |
| Fashion / accessories | Likely | Sometimes | ☐ |
| Electronics / phones | Likely | Sometimes | ☐ |
| Food / groceries / restaurants | Likely | Sometimes | ☐ |
| Beauty / cosmetics / salon | Likely | Sometimes | ☐ |
| Household goods / furniture | Likely | Sometimes | ☐ |
| Wholesale / distribution | Likely | Likely | ☐ |
| Services / other | Possible | Possible | ☐ |

**Pillar-fit values to record per participant:** `BUSINESS_MANAGEMENT`, `MARKETPLACE`, `BOTH`, or `UNCLEAR`. A category that needs only one pillar is valid evidence; it is not a failed interview. The goal is to learn which businesses need which pillar, not to prove that everyone needs everything.

---

## 4. Recruitment strategy

### 4.1 Before outreach

- [ ] Confirm the target market (Nigerian businesses of all kinds) and country; record it in `STATE.md`.
- [ ] Select at least four business categories for the sample and record the planned category mix.
- [ ] Build a list of 20 named prospects per priority group (60 total), spread across the selected categories, with contact channel and relationship.
- [ ] Complete the competitor check: 5 tools the selected categories use today, and what each does badly.
- [ ] Prepare a short outreach message and a consent script.
- [ ] Prepare synthetic demonstration accounts and data (see §8).
- [ ] Confirm the decision date is approved; if not, record the approved date in `STATE.md`.

### 4.2 Outreach principles

- Lead with research, not a sales pitch.
- Ask about past behaviour, not future intent.
- Offer a small thank-you (e.g. airtime) if appropriate; never pay for a positive answer.
- Do not reveal the product before the discovery section.
- Ask permission before taking notes or recording.
- Offer voice/call or in-person first; chat interviews produce weaker evidence.

### 4.3 Outreach message (edit to the participant’s language)

> Hi [name]. I’m researching how [business category] businesses handle orders, payments and suppliers. Could I ask about how you handled your last few orders? It’s a short research conversation, not a sales call. I’m learning, not selling.

### 4.4 Sample targets

| Group | Prospects listed | Interviews target | Notes |
|---|---|---|---|
| A. Business owners | 20 | 4–6 | Spread across at least four categories |
| B. Suppliers | 20 | 3–4 | Must include at least one active supplier; categories may vary |
| C. Resellers | 20 | 3–4 | Must include at least one active reseller; categories may vary |
| **Total** | **60** | **8–14** | Gate requires at least 8 completed and at least four categories |

**Manageable diversity rule:** aim for 2–3 interviews in each of four to six categories rather than 8 interviews in one category. No single category should exceed roughly half the completed interviews. If recruitment in one category stalls, replace it with another category rather than dropping diversity.

**Pillar coverage rule:** the sample must include participants who need business management, participants who need the marketplace, and, where possible, participants who need both. The exact split is discovered, not assumed.

---

## 5. Interview method and open-ended questions

**Format:** 25–30 minutes; voice/call first, in person second, chat last.
**Rule:** ask about the past. “How did you handle the last order?” beats “Would you use an app?”
**Recording:** take notes with consent; never publish names, customer details or price lists.
**Full scripts:** `templates/DISCOVERY_INTERVIEW_SCRIPTS.md`.

### 5.1 Business owners — core questions

1. Walk me through the last order you delivered, from the first message to the final payment.
2. Where did you write down the customer, the order and what they paid?
3. Right now, how many customers owe you money? How do you know?
4. Tell me about the last time you forgot an order, lost a message or got a balance wrong. What did it cost you?
5. When a customer pays in two or three parts, how do you record the second payment? Does the first one still show?
6. When a customer says “I’ll send it on Friday,” where does that promise go?
7. How do you remind someone who owes you? How does that feel?
8. What have you tried before, and why did you stop?
9. What do you pay for any tool or service for your business today?
10. If one part of this got fixed, which would matter most?

### 5.2 Suppliers — core questions

1. Walk me through the last time you sent a new price list. What did you send, and to whom?
2. Have you ever found a reseller selling below your price or sharing your list? What happened?
3. How do you confirm stock when a reseller asks? How many times a day?
4. What happens when you confirm stock and it is actually finished? Tell me about the last time.
5. Take the last reseller order. How did it come in, and what did you do step by step?
6. Where do you record what was ordered, paid and dispatched?
7. When a reseller says “I sent the money,” how do you verify before releasing goods?
8. What is the hardest part of working with resellers — money, stock or attitude?
9. What must a reseller tool never show for you to be comfortable?
10. Would you let one trusted reseller test an ordering link for a week? Which reseller and which products?

### 5.3 Resellers — core questions

1. Take the last product you started selling. How did you find it, and what did you do before advertising it?
2. Who gave you the price — the supplier directly or a middleman? Did you negotiate?
3. How do you make your money — buy and resell, or commission? Where is the agreement written?
4. Has a supplier changed the price after you quoted a customer? What happened?
5. Did the supplier permit you to use their photos and content?
6. Who sets the minimum price you can sell at? Can you sell higher?
7. When a customer pays you, what happens next? Who delivers?
8. Does your supplier know your customer’s name and number? Do you want them to?
9. If the item is finished after the customer has paid, what do you do?
10. Would you let me set up 3 products from your main supplier and send it to one real customer this week? What day?

### 5.4 Pillar-fit classification (ask every participant)

After the discovery questions, classify the participant without leading them toward the full product:

1. “Which of these is the bigger headache for you today — keeping track of customers, orders and money, or finding and managing suppliers and resellers?”
2. “If you could fix only one of those, which one would you fix first?”
3. “Do you ever sell other people’s products, or supply products to other people who sell them?” (Maps to marketplace.)
4. “Do you need both sides to work together, or would one side alone be useful?”
5. “Which part of what I described would you never use?”

Record one value: `BUSINESS_MANAGEMENT`, `MARKETPLACE`, `BOTH`, or `UNCLEAR`. Do not mark a participant `BOTH` just because both features exist. A participant who needs only one pillar is valid evidence.

### 5.5 Universal probes

- “Tell me more about that.”
- “What happened next?”
- “Show me.”
- “What did that cost you — money, time or the customer?”
- “When was the last time? Not generally — that specific time.”
- “Why did you do it that way and not the other way?”

### 5.6 What to capture verbatim

- The exact words used for the pain (“I dey always forget”, “e dey stress me”, “I just dey guess”).
- The amount lost or owed, where stated.
- The tool or workaround used today.
- The specific event, date and consequence.
- Any commitment and the exact start date.

---

## 6. Demonstration scenarios

Demonstrations use **synthetic accounts and synthetic data only**. Do not use real customer records, real participant data or published demo credentials. See §8 for the full restriction list.

Each scenario must end with the participant’s reaction and a commitment ask. Do not defend the product; write down objections.

### Scenario 1 — Business owner records a part-paid order

1. Create a synthetic customer and order.
2. Record a deposit and show the remaining balance.
3. Show the debt-first home screen and the payment history.
4. Open the WhatsApp reminder draft; do not send it.
5. Ask: “What would you change? What would stop you using this after one week?”

**Feature labels:** workspace and balances are working; receipts, CSV and expenses are not available.

### Scenario 2 — Supplier publishes an offer and confirms stock

1. Create a synthetic supplier listing with a public retail price.
2. Show the private wholesale terms to an approved synthetic reseller only.
3. Approve a synthetic reseller application and show the agreement.
4. Confirm stock, record a payment claim, dispatch, and confirm delivery.
5. Ask: “What must this never show? What would make you distrust it?”

**Feature labels:** private pricing and the basic lifecycle are working; transition enforcement and stock restoration have known gaps.

### Scenario 3 — Reseller applies, sees a private price and places an order

1. Apply to the synthetic supplier.
2. Accept the agreement and open the private price.
3. Set a resale price at or above the minimum.
4. Place a supplier order and show the order status.
5. Ask: “Would you send this to a real customer? What would you need first?”

**Feature labels:** private pricing and order creation are working; commission settlement and minimum-resale enforcement have known gaps.

### Scenario 4 — Dispute walkthrough (synthetic only)

Use only synthetic accounts. Do not demonstrate disputes with real users until the global dispute-access vulnerability is fixed.

1. Raise a dispute on a synthetic order.
2. Add an evidence note.
3. Show the mediator review and resolution path.
4. Ask: “What would make this fair or unfair?”

**Feature labels:** the dispute workflow exists; party-scope enforcement has a known critical defect.

### Scenario 5 — PWA and offline fallback

1. Install the app on a phone.
2. Open it with the network disabled.
3. Show the offline screen and retry.
4. Ask: “What would you expect to still work offline?”

**Feature labels:** installability and the static offline fallback are working; offline creation, editing and sync are not available.

---

## 7. Evidence collection

### 7.1 Required records

| Evidence | Where recorded | Rule |
|---|---|---|
| Interview notes and verbatim quotes | `INTERVIEW_LOG.md` | One block per interview; no invented entries |
| Participant type, category, location, date | `INTERVIEW_LOG.md` | Use a participant reference, not a full name |
| Current workflow and tools | `INTERVIEW_LOG.md` | Describe what they actually use |
| Problems named without prompting | `INTERVIEW_LOG.md` | Mark whether the interviewer prompted |
| Artifacts (notebook page, price list, ad) | Private evidence folder | Consent required; redact names and numbers |
| Commitment and agreed start date | `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` | A “yes” without a date is not a commitment |
| Concierge observations | `PILOT_TRACKER.md` | Same-day notes, not end-of-week memory |
| Marketplace activity | `PILOT_TRACKER.md` | Offers, applications, approvals, stock, orders, claims, deliveries, disputes |
| Decision and rationale | `STATE.md` | GO / REVISE / STOP with date and evidence references |

### 7.2 Evidence quality rules

- Record the **specific event**, not a summary.
- Separate what the participant said from what the interviewer inferred.
- Mark prompted vs unprompted mentions.
- Never round a weak signal up to a strong one.
- Keep the filled-in records private; the committed files stay blank templates.
- Do not publish screenshots containing real names, phone numbers or prices.

### 7.3 Competitor check

List five tools the selected categories use today (e.g. WhatsApp Business labels/catalogue, notebook, Excel, ledger app, another marketplace) and record:

- What the tool does well.
- What it does badly for this workflow.
- Why the participant still uses it.
- What would have to be true for them to switch.

---

## 8. Security restrictions for demonstrations

These restrictions are mandatory for every interview, demo and concierge session.

1. **Do not use real customer records in demonstrations.** Use synthetic customers and synthetic orders.
2. **Do not use published demo credentials.** Create separate synthetic demonstration accounts; never use seeded accounts that are documented or shared.
3. **Do not expose private reseller prices to unapproved participants.** Show private prices only to the synthetic approved reseller in the demo, and never in a public screen or screenshot.
4. **Do not demonstrate disputes using real users until the global dispute-access vulnerability is fixed.** The `GET /api/disputes?scope=all` bypass (audit finding S-01) must be fixed and verified first.
5. **Do not claim payment or delivery verification.** SellFlow records manual claims; it does not verify that money moved or that goods arrived.
6. **Use synthetic demonstration accounts and data.** Reset or recreate them between sessions.
7. **Clearly distinguish working features from incomplete or unverified features.** Use the feature-status table below in every demo.

### 8.1 Feature-status table for demonstrations

| Area | Status to disclose |
|---|---|
| Business workspace: customers, products, orders, payments, balances, promises | Working in the current build; core flows tested |
| Private reseller pricing | Working and server-enforced; guests and unapproved users receive 403 |
| Marketplace discovery, supplier directory, storefront | Working; public pages do not expose private prices |
| Applications, agreements, versioned terms | Working for the basic flow; negotiation/dual-acceptance semantics need review |
| Supplier order lifecycle | Partially working; transition enforcement and stock restoration have known gaps |
| Payment claims | Partially working; creation-time status handling has a known defect |
| Disputes | Workflow exists; party-scope access has a known critical defect — do not use with real users |
| Commercial terms (minimum resale, advertising, commission, payment terms) | Stored but not fully enforced |
| Receipts, statements, CSV import/export, expenses/net profit | Not available |
| Offline creation, editing, sync, conflict resolution | Not available; only a static offline fallback exists |
| Subscription billing | Present in the codebase but out of V1 scope; do not present as approved |
| Payment/delivery verification | Not provided; all payments and claims are manual records |

### 8.2 Data handling

- Use a private environment and private synthetic accounts.
- Do not screen-share a real workspace.
- Do not record video calls.
- Do not screenshot participants’ customers’ chats.
- If a participant asks to keep something off the record, keep it off the record.

---

## 9. Prototype-testing commitments

Ask for exactly one commitment, in this order. Offer the next only if the first is declined.

| Ask | What it means | Counts toward gate? |
|---|---|---|
| **A** | A dated commitment to use the prototype for a defined period (e.g. 7 days) and a confirmed start date | **Yes** |
| **B** | Hand over a real artifact: notebook page, price list, current ad, tracker screenshot (redacted) | **Yes** |
| **C** | A scheduled follow-up call or demo | No (supporting signal only) |

**Rules:**

- A “yes” without a date is **not** a commitment.
- Confirm the date, time and channel in writing before leaving.
- Send a same-day thank-you message with your contact details.
- Record the commitment in `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` the same day.
- Do not count the same participant twice for the same ask.

**Gate requirement:** at least **3 concrete prototype-testing commitments with agreed start dates**, ideally including at least one supplier and one reseller.

---

## 10. Two-week concierge experiment

**Purpose:** observe whether committed participants use the workflow in their real business with manual operator support, and whether they return without prompting.

**Definition:** “Concierge” means the operator helps with setup, answers questions and observes closely. It is not a self-serve launch, not a public release and not evidence of product-market fit on its own.

### 10.1 Participants

- At least one supplier–reseller pair, if commitments allow.
- At least two business owners.
- Total: 3–5 active participants, drawn only from people who made a dated commitment.
- Use real participant data only with explicit consent and in a private environment.

### 10.2 Week 1 — assisted onboarding

| Day | Activity | Evidence |
|---|---|---|
| 1 | Set up accounts and synthetic/real data with consent; confirm the workflow | Onboarding note |
| 2 | Observe the first real order or supplier order; do not coach unless blocked | Observation note |
| 3 | Check whether the participant returned unprompted | Return log |
| 4 | Record blockers and workarounds | Blocker list |
| 5 | Short feedback call: what was confusing, what was missing | Feedback note |

### 10.3 Week 2 — reduced support

| Day | Activity | Evidence |
|---|---|---|
| 8 | Stop proactive reminders; see whether they return | Return log |
| 9–10 | Observe repeat orders/payments | Activity log |
| 11 | Ask what they would pay for, if anything | Pricing note |
| 12 | Final interview: what changed, what did not | Interview log |
| 13–14 | Synthesize evidence; prepare the decision pack | Decision pack |

### 10.4 Experiment rules

- Do not invent activity; log only what happened.
- Do not help so much that the participant appears independent when they are not.
- Record every intervention (setup, reminder, correction).
- If a participant stops using the product, record why; churn is evidence.
- Do not demonstrate disputes with real users until S-01 is fixed.

---

## 11. Success and failure indicators

### 11.1 GO indicators

All of the following must be true:

- [ ] At least **8 completed interviews** across **at least four distinct business categories**.
- [ ] No single category supplies more than roughly half the completed interviews.
- [ ] At least **4 independent, unprompted mentions** of the same meaningful problem, with category context recorded.
- [ ] At least **3 concrete prototype-testing commitments with agreed start dates**.
- [ ] Documented evidence that **existing tools are inadequate**.
- [ ] Both marketplace sides validated: at least **3 supplier** and **3 reseller** interviews, plus at least one observed supplier–reseller order flow (or a documented reason it could not be observed).
- [ ] **Pillar fit recorded** for every participant: business management, marketplace, both, or unclear.
- [ ] The two-week concierge experiment completed with recorded observations.
- [ ] At least **2 participants returned on day 3+** and at least **1 on day 7+**, or a documented explanation of why the sample was too small.
- [ ] The decision is recorded in `STATE.md`.

### 11.2 REVISE indicators

- The problem is real but different from the assumed one (e.g. catalogue, stock, price privacy rather than debt tracking).
- The category mix is too narrow to test cross-industry relevance, or so broad that recruitment and support are unmanageable; adjust the mix.
- One product pillar engages strongly while the other does not, and the evidence does not justify both.
- One marketplace side engages but the other does not.
- Commitments exist but the workflow does not fit the participant’s actual behaviour.
- Evidence is mixed and a short second sprint (maximum one) would resolve it.

### 11.3 STOP / PIVOT indicators

- No consistent problem across interviews.
- Existing tools are adequate and participants do not want to switch.
- Fewer than 3 commitments by the decision date.
- Participants revert to WhatsApp/notebooks after the experiment.
- The marketplace cannot be validated on both sides.

### 11.4 What does not count

- Compliments, “this is a good idea”, “God bless you”.
- A “yes” without a date.
- Interviews where the interviewer pitched for most of the time.
- Demo reactions without a commitment.
- Invented or rounded metrics.
- Activity performed by the operator rather than the participant.

---

## 12. GO / REVISE / STOP decision process

### 12.1 Decision meeting

- **When:** on or before the approved decision date.
- **Who:** project owner plus a note-taker; ideally one person not involved in recruitment.
- **Inputs:** `INTERVIEW_LOG.md`, `PILOT_TRACKER.md`, artifacts, concierge observations, competitor check.
- **Method:** score each gate item as met / not met / insufficient evidence. Do not average away a missing gate.

### 12.2 Decision definitions

| Decision | Meaning | Next action |
|---|---|---|
| **GO** | All gate items met; evidence supports proceeding | Record the validation GO in `STATE.md`. It confirms demand; it does not grant permission to build, which the owner authorized separately on 2026-11-04 (D-019). |
| **REVISE** | Problem is real but the category mix, problem or workflow needs adjustment | Record the change and run at most one short sprint; update this plan and `STATE.md` |
| **STOP / PIVOT** | No consistent problem, tools adequate, or fewer than 3 commitments | Record the lesson in `STATE.md`; stop or pivot; do not extend silently |

### 12.3 Recording the decision

Add a dated entry to `STATE.md` containing:

- Decision: GO / REVISE / STOP.
- Gate scorecard (each item met / not met).
- Evidence references (interview IDs, tracker rows, artifact references).
- Rationale and the biggest uncertainty.
- For REVISE: the specific change and the new short-sprint dates.
- For GO: the validation evidence that supports the decision, and the product scope the evidence justifies. Implementation is no longer gated on this decision (2026-11-04, D-019).

**No decision recorded by the date = not a GO.** Do not treat silence as approval.

---

## 13. Gate checklist

Copy this table into the decision record.

| # | Gate item | Required | Status | Evidence |
|---|---|---|---|---|
| G-01 | Target market + country confirmed | Nigerian businesses of all kinds; country recorded | ☐ | |
| G-02 | Competitor check | 5 tools + weaknesses across selected categories | ☐ | |
| G-03 | Completed interviews | ≥ 8 | ☐ | |
| G-04 | Category diversity | ≥ 4 distinct business categories | ☐ | |
| G-05 | Unprompted same-problem mentions | ≥ 4 independent | ☐ | |
| G-06 | Prototype commitments with dates | ≥ 3 | ☐ | |
| G-07 | Existing tools inadequate | Documented | ☐ | |
| G-08 | Supplier-side validation | ≥ 3 interviews | ☐ | |
| G-09 | Reseller-side validation | ≥ 3 interviews | ☐ | |
| G-10 | Observed supplier–reseller order flow | ≥ 1 or documented reason | ☐ | |
| G-11 | Pillar fit recorded | Every participant classified | ☐ | |
| G-12 | Two-week concierge experiment | Completed | ☐ | |
| G-13 | Repeat activity | Day-3 and day-7 evidence | ☐ | |
| G-14 | Decision recorded in `STATE.md` | GO / REVISE / STOP | ☐ | |

**Current status: all items unchecked. Phase 0 has not passed.** Implementation is authorized in parallel (D-019, 2026-11-04); that does not check, relax or retire any gate item on this list.

---

## 14. Proposed timeline

**Decision date: 2026-12-11 (PROPOSED — awaiting user approval).**

| Period | Activity | Output |
|---|---|---|
| 2026-11-04 to 11-08 | Approve plan and date; confirm target market/country; select 4–6 categories; competitor check; build prospect lists; prepare synthetic demo accounts | Updated `STATE.md`; category plan; prospect list; competitor notes |
| 2026-11-09 to 11-13 | Outreach and first business-owner interviews across 2–3 categories | Interview logs; early cross-category patterns; pillar fit |
| 2026-11-16 to 11-20 | Remaining categories; supplier and reseller interviews; demos; commitment asks | ≥ 8 interviews; ≥ 4 categories; ≥ 3 dated commitments |
| 2026-11-20 | Gate checkpoint: are G-01 to G-10 on track? | Go/no-go to start the concierge experiment |
| 2026-11-23 to 12-04 | Two-week concierge experiment | Observation logs; activity and return data |
| 2026-12-07 to 12-11 | Synthesize evidence; decision meeting; record decision | `STATE.md` decision entry; readiness update |
| 2026-12-11 | Proposed decision date | GO / REVISE / STOP |

**If the date is not approved, record the approved date in `STATE.md` before outreach.** Do not silently retain 2026-11-06 or invent a new date.

---

## 15. Roles and record-keeping

| Role | Responsibility |
|---|---|
| Project owner | Recruitment, interviews, commitments, decision |
| Note-taker | Same-day interview log, verbatim quotes, evidence index |
| Operator (concierge) | Setup, observation, intervention log |
| Reviewer (optional) | Challenge weak signals and gate scoring |

**Update cadence:** after every interview and every concierge day. Do not reconstruct records from memory at the end of the week.

**Privacy:** the filled-in `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` contain participant details and must stay private. The committed versions remain blank templates.

---

## Appendix A — Consent script

> “I’ll take notes while we talk — is that okay? I won’t post your name, your customers’ names, or your prices anywhere. If you want something off the record, tell me and I’ll leave it out.”

## Appendix B — Commitment confirmation message

> “Thank you for today. To confirm: you’ll start using the prototype on [date] via [channel]. It should take about [time] per day. I’ll check in on [date] but you can message me anytime. If anything changes, tell me and we’ll move the date.”

## Appendix C — Decision record template

```
Date:
Decision: GO / REVISE / STOP
Gate score: G-01 [met/not met] ... G-14 [met/not met]
Evidence:
- Interviews: [IDs]
- Commitments: [IDs + dates]
- Concierge: [summary]
- Competitor check: [reference]
Rationale:
Biggest uncertainty:
Next action:
```
