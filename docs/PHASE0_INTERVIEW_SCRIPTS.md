# SellFlow — Phase 0 Supplier & Reseller Interview Scripts (Standalone Field Guide)

**Document date:** 2026-11-20
**Prepared by:** Buffy (documentation only; no application code, schema, migration, register or database changes)
**Repository:** `/home/binpharees/Documents/SellFlow-Bootcamp-v2`
**Branch / HEAD:** `main` / `ae8d7ee555b31f149de017b6fb6f834e9ad9313b`
**Status:** Phase 0 incomplete; validation GO/REVISE/STOP not granted. SellFlow is **not** described as validated, Stage 3 ready, or pilot-launch ready.
**Basis:** `docs/PHASE0_PILOT_LAUNCH_VALIDATION_PLAN.md` (categories A–D, cross-category questions, Go/No-Go gates G-01…G-14, security pre-pilot gates), `VALIDATION_PLAN.md` (participant groups, interview method, commitment ladder, concierge experiment), `templates/DISCOVERY_INTERVIEW_SCRIPTS.md` (question bank, probes, fairness rules).
**Pairs with:** `INTERVIEW_LOG.md` (one block per interview, kept private when filled), `PILOT_TRACKER.md` (counters, kept private when filled), `STATE.md` (decision record only).

> **Scope note.** This guide covers the **supplier (B)** and **reseller (C)** sides of the marketplace only. Business-owner (A) interviews use `templates/DISCOVERY_INTERVIEW_SCRIPTS.md` §1. Do not run a supplier or reseller interview without having read §0 (how to use) and §8 (security restrictions) of the plan.

---

## 0. How to use this guide

- **Length:** 15–20 minutes per script. Never longer than 25. Nigerian traders are busy; long interviews get polite answers, not true ones.
- **Format:** voice call first, in person second, chat last. Chat produces short answers and loses the frustration in the voice — the best signal.
- **One rule:** ask about the **past**, not the future. "How did the last order go?" beats "Would you use an app that…". Every "would you" answer is worth almost nothing until a dated commitment exists.
- **Language:** standard English with the trade words they already use — wholesale MOQ, waybill, transfer receipt, reseller price list, stock hold, "I sent the money", "balance remain". Mix Pidgin only if the conversation is already going that way; never to perform. Lagos, Kano and Aba traders do not all speak the same way — follow the participant.
- **Do not reveal the product early.** In the discovery sections you are a researcher, not a founder. Say "I'm studying how [category] suppliers/resellers handle orders, prices and money." If asked directly: *"I'll show you what I'm working on at the end — I don't want to lead your answers before then."*
- **Consent, before you start:** *"I'll take notes while we talk — is that okay? I won't post your name, your customers' names, or your prices anywhere."*
- **Target market:** Nigerian businesses of all kinds and sizes. The sample must cover **at least four of the four required categories (A–D below)**, with no single category above roughly half the completed interviews.
- **Pillar fit:** record `BUSINESS_MANAGEMENT`, `MARKETPLACE`, `BOTH`, or `UNCLEAR` for every participant. A supplier or reseller who needs only one pillar is valid evidence, not a failed interview.
- **Security:** read §8 of the plan before any demo. Synthetic accounts and synthetic data only; no real customer records; no published demo credentials; no dispute demos with real users until S-01 is fixed and verified; never claim payment or delivery verification.

### 0.1 The four required categories (from plan §3)

| Code | Category | Why it matters for supplier/reseller validation |
|---|---|---|
| **A** | Fashion, apparel and footwear | Price lists, reseller undercutting, WhatsApp catalogue sharing, partial payments, size/colour variants |
| **B** | Beauty, cosmetics and haircare | Fast-moving stock, expiry/batch, frequent price changes, supplier-dependent resellers, visual catalogue |
| **C** | Phone accessories and consumer electronics | High-value items, fast price movement, warranty/serial concerns, margin pressure, price privacy |
| **D** | Packaged FMCG, provisions or home goods | Repeat orders, stock turnover, low margins, frequent small payments, multi-party flows |

### 0.2 What counts as evidence (and what does not)

- **Counts:** specific past events with dates, amounts lost/owed, tools named with weaknesses, dated commitments with agreed start dates, artifacts handed over (redacted price list, notebook page, ad screenshot), unprompted mentions.
- **Does not count:** compliments ("this is a good idea", "God bless you"), "yes" without a date, demo reactions without a commitment, opinions, invented or rounded metrics, activity performed by the operator rather than the participant.
- **Signal discipline:** score each interview strong / weak / none in the log. A warm "this is very good, God bless you" with no commitment is **none**. Do not round up.

---

## 1. Common rules, probes and safety

### 1.1 Universal probes (use when an answer is thin)

- "Tell me more about that."
- "What happened next?"
- "Why did you do it that way and not the other way?"
- "What did that cost you — money, time, or the customer?"
- "When was the last time? Not generally — that specific time."
- "Show me." *(single strongest probe in this guide)*
- "And how did that feel?" *(once per interview only)*

### 1.2 Phrases to avoid

| Avoid | Say instead |
|---|---|
| "Would you use an app that…" | "How do you handle it now?" |
| "Don't you think it's stressful?" | "How does that work for you?" |
| "Most suppliers tell me…" | "Some people mention… does that happen to you?" |
| "So you'd pay ₦5,000 for this?" | "What do you pay for any tool today, and how much?" |
| "That's a great idea" | "That's useful — why do you say that?" |
| "You should try…" | Say nothing. Write it down. |

### 1.3 Commitment ladder (same as `VALIDATION_PLAN.md` §9)

| Ask | What it means | Counts toward gate? |
|---|---|---|
| **A** | Dated commitment to test the prototype for a defined period, with a confirmed start date | **Yes** |
| **B** | Hand over a real artifact (price list, notebook page, current ad, tracker screenshot — redacted) | **Yes** |
| **C** | A scheduled follow-up call or demo | No (supporting signal only) |

A "yes" without a date is **not** a commitment. Confirm date, time and channel in writing before leaving.

### 1.4 Security restrictions (mandatory for every interview and demo)

1. Do not use real customer records in demonstrations. Use synthetic customers and synthetic orders.
2. Do not use published demo credentials. Create separate synthetic demonstration accounts.
3. Do not expose private reseller prices to unapproved participants. Show private prices only to the synthetic approved reseller in the demo, never in a public screen or screenshot.
4. Do not demonstrate disputes using real users until the global dispute-access vulnerability (S-01) is fixed and verified. Use synthetic accounts only.
5. Do not claim payment or delivery verification. SellFlow records manual claims; it does not verify that money moved or that goods arrived.
6. Use synthetic demonstration accounts and data; reset or recreate them between sessions.
7. Clearly distinguish working features from incomplete or unverified features (see plan §8.1 feature-status table).
8. Do not screen-share a real workspace; do not record video calls; do not screenshot participants' customers' chats. Redact names, phone numbers and price lists in retained artifacts. If a participant asks to keep something off the record, keep it off the record.

### 1.5 Feature status to disclose in every demo (plan §8.1)

| Area | Status to disclose |
|---|---|
| Business workspace: customers, products, orders, payments, balances, promises | Working; core flows tested |
| Private reseller pricing | Working and server-enforced; guests and unapproved users receive 403 |
| Marketplace discovery, supplier directory, storefront | Working; public pages do not expose private prices |
| Applications, agreements, versioned terms | Working for the basic flow; negotiation/dual-acceptance semantics need review |
| Supplier order lifecycle | Partially working; transition enforcement and stock restoration have known gaps |
| Payment claims | Partially working; creation-time status handling has a known defect |
| Disputes | Workflow exists; party-scope access has a known critical defect — do not use with real users |
| Commercial terms (minimum resale, advertising, commission, payment terms) | Stored but not fully enforced |
| Receipts, statements, CSV import/export, expenses/net profit | Not available |
| Offline creation, editing, sync, conflict resolution | Not available; only a static offline fallback exists |
| Subscription billing | Present in codebase but out of V1 scope; do not present as approved |
| Payment/delivery verification | Not provided; all payments and claims are manual records |

---

## 2. Supplier discovery & workflow script (15–20 min)

**Who:** wholesaler, importer, manufacturer or product owner who supplies at least 3–5 resellers; has a price list resellers should not share or undercut; confirms stock and fulfils orders.
**Categories to cover:** at least across A, B, C and D — no single category above roughly half of supplier interviews.
**Focus:** how prices are shared, price leakage and undercutting, stock confirmation, order recording, dispatch, payment claims, reseller trust and disputes, partial-payment cancellation and held stock (Decision 6), willingness to run a 2-week live catalog/order pilot without automated payment gateway settlement.

### S-A. Introduction & framing (≈3 min)

**Open:**
> "Good afternoon ma/sir. My name is ____. I'm studying how suppliers and product owners manage their resellers — how orders come in, how you confirm stock, and how you protect your prices. Not a sales call; I want to learn how it actually works from someone doing it.
>
> About 15–20 minutes. If a question doesn't apply, just wave it off and we'll move.
>
> I'd also like to see how you currently share prices and confirm stock — a screenshot is fine, and you can blur anything you don't want me to see.
>
> Can I take notes?"

**If they're guarded about prices** (common — price lists are their competitive asset):
> "You don't need to tell me your actual costs or margins. I only care about the *process* — who sees the price, how they see it, and what goes wrong. Blur the numbers if you like."

**If they ask "are you building an app?":**
> "I'm looking at whether this problem is worth solving at all. That's why I'm asking before I build anything. At the end I'll show you a rough idea and you tell me if it's nonsense."

**Why this framing:** suppliers assume anyone asking about resellers is trying to poach them or sell them software. Naming their fear out loud (price protection) buys honesty.

### S-B. Warm-up (≈3 min)

1. "Tell me about the business — what do you supply, and how long have you been doing it?"
2. "Who sells for you? Are they formal resellers you know by name, or anybody who picks up from you?"
3. "Roughly how many active resellers do you have in a month? How many are consistent?"
4. "How does a reseller find out your current price — do you send a list, do they ask each time, is it on your status?"
5. "How do they place an order with you? WhatsApp, call, they come to the shop?"
6. "Who handles delivery — you, or the reseller?"
7. "How many people work with you on this — do you have someone answering the reseller chats?"

**Interviewer notes:**
- Q4 and Q5 set up the entire deep-dive. Note the *medium* of the price list: PDF, image, voice note, memory. Images get forwarded; that's the leak.
- If they have under 3 resellers, this persona's pain is probably not strong enough yet — say so in the log.
- **Maps to:** plan §3 categories A–D validation question 1 (price-privacy boundary), cross-category §4.1.

### S-C. Core problem deep-dive (≈8–10 min)

**S-C1 — Price privacy and leakage** (plan §3 Q1, cross-category §4.1)
- "Walk me through the last time you sent out a new price list. What did you send — image, PDF, typed message? Who did you send it to?"
- "Have you ever found a reseller selling below your price, or reselling to another reseller at cost? What happened?"
- "When that happened, how did you find out? Did someone tell you, or did you see it yourself?"
- "What do you do about it now — confront them, cut them off, ignore it?"
- "Do your resellers know each other's prices? Do they know what you charge another reseller?"
- "If a reseller had a link they could open to see *their own* price, and only their own — would that change anything for you? What would worry you about it?"
- "What is your wholesale MOQ per product, and does the MOQ change per reseller?" *(Lagos/Kano/Aba trade term: MOQ)*

**S-C2 — Stock confirmations** (plan §3 Q4, cross-category §4.3, S-11)
- "When a reseller asks 'is this still available?', how do you confirm it?"
- "How many times a day does that question come in?"
- "What happens when you say yes and it's actually finished — has that happened recently? Tell me about that one."
- "Do you keep a stock count anywhere? Or is it 'I know what's in the store'?"
- "When stock is low, how do your resellers find out — do you announce it, or do they find out by asking?"
- "Have you ever oversold stock you didn't have? What did it cost you?"

**S-C3 — Orders, fulfilment and manual payment claims (D-013)** (plan §3 Q2–Q3, cross-category §4.2)
- "Take the last order a reseller placed. How did it come in, and what did you do, step by step?"
- "Where do you write it down? Do you write it down at all?"
- "How do you know what you've dispatched and what you haven't?"
- "Have you ever sent the wrong quantity, or sent to the wrong reseller? What did it cost you?"
- "Who pays delivery? Has that ever caused a fight?"
- "When a reseller says 'I sent the money' — how do you verify before you release goods? Do you check the bank alert, ask for a transfer receipt screenshot, or trust them?"
- "Do you ever release goods before confirming the transfer? What happened?"
- "What evidence do you keep for a manual claim — transfer receipt, POS slip, cash count? Where does it live?"

**S-C4 — Partial payment, cancellation and held stock (Decision 6)** (plan §3 Q4, cross-category §4.3)
- "How are deposits and balances currently recorded — notebook, chat, Excel?"
- "What happens when an order is cancelled after partial payment? Tell me about the last time."
- "Should stock be restored immediately, held/quarantined, or require admin/mediator release when an order is cancelled after a deposit?"
- "When a reseller's order is cancelled after they paid a deposit, what do you do with the money — refund, credit note, or hold it?"
- "Who is allowed to release held stock in your business today — you only, a manager, or a third party?"
- "What audit trail do you need for cancellation, refund, credit and stock release? (waybill number, receipt number, date)"
- "Has stock ever been released twice, or restored twice, after a cancellation? What happened?"

**S-C5 — Trust, disputes and the reseller relationship** (plan §3 Q5, cross-category §4.4, S-01/S-03/S-04)
- "What's the hardest part of working with resellers — money, stock, or attitude? Rank them."
- "Have you ever stopped supplying someone? Why?"
- "Do resellers ever go behind you and buy directly from your own supplier? How do you protect against that?"
- "When a reseller disputes what they ordered or what they paid, how is it resolved today? Who mediates?"
- "What must a reseller tool never show, for you to be comfortable?"
- "Would you let one trusted reseller test an ordering link for a week? Which reseller and which products?"

**Listen for (unprompted) — tick in the log:**
- [ ] Price list leaking / resellers undercutting each other
- [ ] Being asked "is it available" ten times a day
- [ ] Overselling stock they don't have
- [ ] No record of what was dispatched to whom
- [ ] Resellers disputing what they ordered or paid
- [ ] Resellers taking their customer relationships
- [ ] Stock released or restored twice after a cancellation
- [ ] Manual claim with no evidence trail

**Red flags:**
- They don't care about price privacy ("everybody knows my price") → the privacy feature has no value to them; check whether resellers care instead.
- They physically hand goods to 2 people only → the coordination problem doesn't exist yet.
- They already use a tool they're happy with → ask what it does well before assuming there's a gap.

### S-D. Conceptual solution & workflow feedback (≈3–4 min)

**Reveal — keep it verbal and plain, no jargon:**
> "Here's what I'm testing. Two parts.
>
> One: you put your products in once, with the price you want each reseller to see. When a reseller opens their link, they see **their** price — not your cost, not another reseller's price. You decide who sees what. Public retail price stays public; private wholesale terms stay gated.
>
> Two: when they order, it comes to you in one list — who ordered, what quantity, what they've paid, and whether it has been dispatched. Instead of scrolling twenty chats to find out what's pending. Stock status you update once, and everybody sees the same thing.
>
> Payments are manual: a reseller says 'I sent the money', you confirm against your bank alert or transfer receipt. The app records the claim; it does not move or verify money. No payment gateway, no wallet, no escrow."

**Feedback questions (one at a time; do not defend):**
1. "What's the first thing that worries you about that?"
2. "Would your resellers actually use a link, or would they still just message you on WhatsApp? Be honest." *(killer question — most will say they'd still message. Write down the reason.)*
3. "If a reseller orders through a link, do you trust that order the same way as a WhatsApp message? What's missing?"
4. "Should your resellers be able to see each other at all — even just names?"
5. "Should a reseller be able to set their own price for their own customer, higher than yours? Would you want to see what price they set?"
6. "What must this thing **never** show, for you to be comfortable?"
7. "Would you pay for this, or do you expect it free because it helps you sell? Small money, once, not monthly."
8. "Would you run a 2-week live catalog/order test with one trusted reseller, without any automated payment settlement — manual claims only? What would have to be true for you to say yes?"

### S-E. Closing & commitment request (≈3 min)

**Ask A (strongest):**
> "I want to test the ordering side with one real supplier. Would you let me set up 5 of your products, and give the link to **one** reseller you trust, for one week? No cost, and you can stop it any time. If yes, which reseller, and which 5 products?"

*If they hesitate on the reseller:* "Then just the 5 products and your price list format — I'll build it and show you before anyone sees it."

**Ask B:**
> "Can you send me your current price list the way you send it to resellers — image, PDF, or the message itself? Blur whatever you want."

**Ask C:**
> "Can I call you again in one week, after I've shown this to a few resellers, and ask whether their reaction matches what you expected?"

**Close:**
> "Thank you. I'll send you the setup before ____ so you can see exactly what your reseller would see. You can stop it any time."

**Log immediately, before the next interview:** quotes, amounts, tools, asks, outcome + date, signal strength, pillar fit, category.

---

## 3. Reseller discovery & workflow script (15–20 min)

**Who:** sells products they do not own; sources from at least one regular supplier; adds a margin or earns commission; advertises on WhatsApp status and Instagram; drop-ships or holds small stock.
**Categories to cover:** at least across A, B, C and D — no single category above roughly half of reseller interviews.
**Focus:** discovering verified suppliers and requesting private wholesale pricing access; submitting payment claims and tracking order status (SUBMITTED → STOCK_CONFIRMED → PAID → DISPATCHED → DELIVERED) vs raw WhatsApp chat threads; stock-outs, partial payments, delivery confirmation.

### R-A. Introduction & framing (≈3 min)

**Open:**
> "Hi, thank you for your time. My name is ____. I'm studying how vendors like you source products and sell them — how you get the goods, how you agree your own price, and how you deliver to customers. It's research, I'm not selling anything.
>
> About 15–20 minutes. No wrong answers — if something doesn't apply to you, just say so.
>
> I'd like to see how you currently get product photos and prices from your supplier — screenshots are fine, blur any name you want.
>
> Can I take notes?"

**Tone note:** this group is the most price-sensitive and most likely to feel judged ("you're not a real business"). Be warm, never condescending; never call their arrangement "informal" to their face.

**If they ask "are you building an app?":**
> "I'm looking at whether this problem is worth solving at all. That's why I'm asking before I build anything. At the end I'll show you a rough idea and you tell me if it's nonsense."

### R-B. Warm-up (≈3 min)

1. "What do you sell, and how did you start?"
2. "Where do your products come from — one supplier, or several? How did you find them?"
3. "On a normal week, how many orders do you get? Where do they come from — status, Instagram, referrals?"
4. "Is this your main income, or something on the side?"
5. "Who else does this in your circle — do you people compare notes on suppliers?"
6. "When you need a new product to sell, what do you actually do first?" *(Listen: do they scroll a supplier's status, ask in a group, or wait to be told?)*

### R-C. Core problem deep-dive (≈8–10 min)

**R-C1 — Discovering verified suppliers and private pricing access** (plan §3 Q1–Q2, cross-category §4.1)
- "Take the last product you started selling. How did you find it, and what did you have to do before you could advertise it?"
- "Who gave you the price — the supplier directly, or a middleman? Did you negotiate?"
- "How long did it take from 'I want to sell this' to 'I posted it'?"
- "What do you do when the supplier's price changes? How do you find out, and how do you update your own price?"
- "Has a supplier changed price on you after you'd already quoted a customer? What happened?"
- "How do you know a supplier is genuine and not a scammer — what checks do you do before you pay them?"
- "Has a supplier ever sent you a price list that was clearly meant for someone else, or refused to share prices until you were 'approved'?"
- "If a supplier gave you a private link showing only your price, would that feel safer than a WhatsApp image? What would make you trust or distrust it?"

**R-C2 — Commission, margin and advertising permission** (plan §3 Q5, cross-category §4.4, S-10)
- "How do you make your money — you buy and resell at your own price, or the supplier pays you a commission?"
- "If it's commission: how do you know what you're owed? Where is it written?"
- "Has a supplier ever shorted your commission, or 'forgotten' an order was yours? Tell me about that."
- "Do you have anything in writing with any supplier — chat agreement counts?"
- "Who sets the minimum price you can sell at? Can you sell higher?"
- "When you post a product, whose photos do you use?"
- "Did the supplier say you could use their photos and videos? Or did you just take them?"
- "Has a supplier ever complained that you used their content, or that you priced too low?"
- "What happens when two resellers post the same product with the same photos at different prices? Does that affect you?"

**R-C3 — Submitting payment claims and tracking order status vs raw WhatsApp** (plan §3 Q3, cross-category §4.2, S-03/S-04/S-11)
- "When a customer pays you, what happens next — do you send to the supplier, or you already have the item?"
- "Who delivers to the final customer?"
- "If the item is finished after the customer has paid — what do you do? Has that happened?"
- "Does your supplier know your customer's name and number? Do you want them to?"
- "When the customer has a complaint, who do they call — you or the supplier?"
- "Have you ever lost a customer because the supplier delayed or sent the wrong thing?"
- "Walk me through the last order you placed with a supplier, step by step. How did you know it was SUBMITTED, then STOCK_CONFIRMED, then PAID, then DISPATCHED, then DELIVERED — or did you just guess from WhatsApp chats?"
- "How do you tell a customer 'your order is on the way' when you're not sure the supplier has dispatched it?"
- "Have you ever told a customer an item was available when it wasn't, because the supplier's status said so? What happened?"

**R-C4 — Stock-outs, partial payments and delivery confirmation** (plan §3 Q4, cross-category §4.2–§4.3, Decision 6)
- "Does the customer pay you first, or pay the supplier directly?"
- "If they pay you, and you have to pay the supplier before delivery — what does that do to your cash?"
- "When the supplier owes you (commission or refund), how do you track it?"
- "How are deposits and balances currently recorded — notebook, chat, Excel?"
- "What happens when an order is cancelled after partial payment? Tell me about the last time."
- "If an item is out of stock after the customer has paid, who refunds — you or the supplier — and how is it tracked?"
- "How do you confirm delivery to your customer — waybill number, photo, 'I sent it' message? What counts as proof for you?"
- "Has a supplier ever told you an order was dispatched when it wasn't? How did you find out?"

**Listen for (unprompted) — tick in the log:**
- [ ] Supplier changing prices after quoting
- [ ] Not knowing what commission is owed
- [ ] Fear of losing a customer to the supplier
- [ ] No permission to use photos, or content stolen and reused by others
- [ ] Stock finishing after customer has paid
- [ ] Being blamed by the customer for the supplier's delay
- [ ] Order status tracked only in WhatsApp chats, no single source of truth
- [ ] Manual claim with no evidence trail

**Red flags:**
- They hold all their own stock and set all their own prices → they're closer to a business owner than a reseller.
- They sell one product from one supplier who is a family member → the coordination pain is absorbed by the relationship.
- They already use a tool they're happy with → ask what it does well before assuming there's a gap.

### R-D. Conceptual solution & workflow feedback (≈3–4 min)

**Reveal:**
> "What I'm testing: a supplier puts their products in with the price *they* want you to see. You get your own link — like a small shop with your name on it. You set your own selling price on top, and your customer sees **your** price and **your** name, not the supplier's.
>
> When a customer orders, the order goes to the supplier for fulfilment, but it's marked as yours — so your commission or your margin is recorded and you can see what you're owed.
>
> And you'd only see products the supplier has allowed you to sell, at the price they've allowed.
>
> Payments are manual: a customer says 'I sent the money', you record the claim, the supplier confirms against their bank alert or transfer receipt. The app records the claim; it does not move or verify money. No payment gateway, no wallet, no escrow."

**Feedback questions (one at a time; do not defend):**
1. "What's the first thing you like, and the first thing you don't trust?"
2. "If your customer opened that link, would they know it's not your own shop? Does that matter to you?"
3. "Would you be comfortable with the supplier seeing your customer's name and number? What if they could see the order but not the contact?" *(crux — their answer decides the data model)*
4. "Would you set your price higher than the supplier's minimum? What would stop you?"
5. "If the supplier updates their price, should your price change automatically, or should you approve it first?"
6. "How would you want to be paid — customer pays you directly, or pays the platform and you get your cut later?"
7. "Would you send this link to a customer who already trusts you, or only to new ones?" *(predicts real use)*
8. "What would make you abandon this after one week?"

### R-E. Closing & commitment request (≈3 min)

**Ask A (strongest):**
> "Would you let me set up a small version with 3 products from your main supplier, and send it to **one real customer** this week? Even one order is enough for me to learn. What day can you do it?"

*If the supplier hasn't agreed:* "Then let's do it with 3 products and I'll blur the supplier's name — I want to see whether a customer will actually buy from a link like that."

**Ask B:**
> "Can you send me one product you're currently advertising — the photo, your price, and what the supplier charges you (blur the number if you prefer)? I want to see how you present it."

**Ask C:**
> "Can I check back in a week and ask how many orders came through the link?"

**Close:**
> "Thank you, this was helpful. I'll message you so you have my number — and whatever we set up, you can stop it any time."

**Log immediately, before the next interview:** quotes, amounts, tools, asks, outcome + date, signal strength, pillar fit, category.

---

## 4. Structured interview capture & scoring template

Use one copy of this section per interview. Keep filled-in copies private (`INTERVIEW_LOG.md` / `PILOT_TRACKER.md`); committed versions stay blank.

### 4.1 Interview header (fill before the interview)

| Field | Value |
|---|---|
| Interview ID | (e.g. S-001, R-001) |
| Date | |
| Interviewer | |
| Note-taker | |
| Participant group | Supplier (B) / Reseller (C) |
| Category code | A / B / C / D |
| Category name | |
| Location (city/market) | |
| Channel | Voice call / In person / Chat |
| Duration (min) | |
| Consent obtained | Yes / No |
| Synthetic demo used | Yes / No (which scenario) |
| Pillar fit | BUSINESS_MANAGEMENT / MARKETPLACE / BOTH / UNCLEAR |
| Signal strength | Strong / Weak / None |

### 4.2 Response capture table (fill during/after the interview)

| # | Question (short label) | Response (verbatim where possible) | Prompted? (Y/N) | Evidence strength (Strong/Weak/None) | Maps to (plan ref) |
|---|---|---|---|---|---|
| 1 | Price list medium & sharing | | | | §3 Q1, §4.1 |
| 2 | Price leakage / undercutting incident | | | | §3 Q1, §4.1 |
| 3 | Reseller sees other resellers' prices? | | | | §3 Q1, §4.1 |
| 4 | Trust in private-price link | | | | §3 Q1, §4.1 |
| 5 | Stock confirmation method & frequency | | | | §3 Q4, §4.3, S-11 |
| 6 | Oversold / stock-out incident | | | | §3 Q4, §4.3, S-11 |
| 7 | Stock count method (notebook/memory) | | | | §3 Q4, §4.3 |
| 8 | Last reseller order walkthrough | | | | §3 Q2–Q3, §4.2 |
| 9 | Order record location | | | | §3 Q2–Q3, §4.2 |
| 10 | Dispatch tracking method | | | | §3 Q2–Q3, §4.2 |
| 11 | Manual payment claim verification | | | | §3 Q3, §4.2, D-013 |
| 12 | Evidence kept for claims (receipt/waybill) | | | | §3 Q3, §4.2, D-013 |
| 13 | Released goods before confirming transfer? | | | | §3 Q3, §4.2, D-013 |
| 14 | Deposit/balance recording method | | | | §3 Q4, §4.3, Decision 6 |
| 15 | Cancellation after partial payment (last case) | | | | §3 Q4, §4.3, Decision 6 |
| 16 | Held stock release rule (who/when) | | | | §3 Q4, §4.3, Decision 6 |
| 17 | Refund vs credit after cancellation | | | | §3 Q4, §4.3, Decision 6 |
| 18 | Stock released/restored twice incident | | | | §3 Q4, §4.3, Decision 6 |
| 19 | Hardest part ranking (money/stock/attitude) | | | | §3 Q5, §4.4 |
| 20 | Stopped supplying someone — why | | | | §3 Q5, §4.4 |
| 21 | Reseller bypass to own supplier | | | | §3 Q5, §4.4 |
| 22 | Dispute resolution today (who mediates) | | | | §3 Q5, §4.4, S-01/S-03/S-04 |
| 23 | "Must never show" answer | | | | §3 Q1, §4.1 |
| 24 | Willingness to run 2-week pilot (no gateway) | | | | §3 Q5, §10, D-013 |
| 25 | Reseller: supplier discovery method | | | | §3 Q1–Q2, §4.1 |
| 26 | Reseller: price change after quote incident | | | | §3 Q2, §4.1 |
| 27 | Reseller: commission/margin & written agreement | | | | §3 Q5, §4.4, S-10 |
| 28 | Reseller: advertising permission & photos | | | | §3 Q5, §4.4, S-10 |
| 29 | Reseller: order status tracking vs WhatsApp | | | | §3 Q3, §4.2, S-03/S-04/S-11 |
| 30 | Reseller: stock-out after customer paid | | | | §3 Q4, §4.2–§4.3, Decision 6 |
| 31 | Reseller: delivery confirmation method | | | | §3 Q3–Q4, §4.2 |
| 32 | Reseller: customer data visibility preference | | | | §3 Q5, §4.1, S-08 |
| 33 | Reseller: link to customer who already trusts them | | | | §3 Q2, §4.4 |
| 34 | Tools used today (name + weakness) | | | | §4.4, G-07 |
| 35 | Amount lost / owed (concrete) | | | | §2, G-03 |
| 36 | Commitment ask outcome (A/B/C/none + date) | | | | §9, G-06 |
| 37 | Artifact handed over (redacted) | | | | §9, G-06 |
| 38 | Pillar fit classification rationale | | | | §3.1, G-05/G-11 |
| 39 | Unprompted mentions ticked (list) | | | | G-02, G-05 |

### 4.3 Verbatim quotes & unprompted mentions (fill after the interview)

| Quote (exact words) | Context | Prompted? (Y/N) |
|---|---|---|
| | | |
| | | |

**Unprompted mention checklist (tick):**
- [ ] Loss of money (forgotten balance, under-collected, given out twice)
- [ ] Time wasted searching chats
- [ ] Embarrassment / awkwardness of chasing
- [ ] Trust problem with staff
- [ ] Records lost (phone spoilt, notebook finished, WhatsApp cleared)
- [ ] Confusion when a customer disputes what they paid
- [ ] Price list leaking / resellers undercutting each other
- [ ] Being asked "is it available" repeatedly
- [ ] Overselling stock not on hand
- [ ] No record of what was dispatched to whom
- [ ] Resellers disputing what they ordered or paid
- [ ] Resellers taking customer relationships
- [ ] Stock released or restored twice after cancellation
- [ ] Manual claim with no evidence trail
- [ ] Supplier changing prices after quoting
- [ ] Not knowing what commission is owed
- [ ] Fear of losing a customer to the supplier
- [ ] No permission to use photos / content stolen
- [ ] Stock finishing after customer paid
- [ ] Being blamed for supplier's delay
- [ ] Order status tracked only in WhatsApp chats
- [ ] Tool inadequacy named with specifics

### 4.4 Category coverage tracker (update after every interview)

| Category | Supplier interviews | Reseller interviews | Total | % of completed |
|---|---|---|---|---|
| A — Fashion, apparel, footwear | 0 | 0 | 0 | 0% |
| B — Beauty, cosmetics, haircare | 0 | 0 | 0 | 0% |
| C — Phone accessories, consumer electronics | 0 | 0 | 0 | 0% |
| D — Packaged FMCG, provisions, home goods | 0 | 0 | 0 | 0% |
| **Total** | **0** | **0** | **0** | **100%** |

**Rules:** at least 4 distinct categories represented; no single category above roughly 50% of completed interviews; at least 3 supplier and 3 reseller interviews; total at least 8.

### 4.5 Pillar-fit tally (update after every interview)

| Pillar fit | Count |
|---|---|
| BUSINESS_MANAGEMENT | 0 |
| MARKETPLACE | 0 |
| BOTH | 0 |
| UNCLEAR | 0 |

Do not mark a participant `BOTH` just because both features exist. A participant who needs only one pillar is valid evidence.

### 4.6 Commitment log (update same day)

| Interview ID | Ask (A/B/C/none) | Outcome | Agreed start date | Channel | Recorded in PILOT_TRACKER? (Y/N) |
|---|---|---|---|---|---|
| | | | | | |

A "yes" without a date is **not** a commitment. Confirm date, time and channel in writing before leaving.

### 4.7 Competitor / tool check (per category, 5 tools minimum)

| Tool / workaround used | What it does well | What it does badly | Why still used | What would have to be true to switch |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |

### 4.8 Go / No-Go scoring template (score at decision meeting)

Score each item **Met / Not met / Insufficient evidence**. Do not average away a missing gate.

| # | Gate (from plan §5.1 / §11 / §13) | Required | Status | Evidence ref (interview IDs, tracker rows) |
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

### 4.9 Technical and security pre-pilot gate checklist (plan §5.2)

Before onboarding external pilot users, each item must be verified/accepted or formally risk-accepted in writing by the owner.

| Item | Current status (from `STATE.md`) | Verified / Risk-accepted? | Evidence / owner note |
|---|---|---|---|
| S-01 Dispute disclosure | Accepted | ☐ | |
| S-02 Cross-tenant customerOrderId IDOR | Accepted | ☐ | |
| S-03 Payment-claim self-assignment | Implemented — awaiting verification | ☐ | |
| S-04 Supplier lifecycle bypass | Implemented — awaiting verification | ☐ | |
| S-05 Auth rate limiting / lockout | Implemented — awaiting verification | ☐ | |
| S-06 Published demo credentials | Authorized | ☐ | |
| S-07 Email-less verification tier | Implemented — awaiting verification | ☐ | |
| S-08 Customer visibility leak | Implemented — awaiting verification | ☐ | |
| S-09 Password reset/change (throttling now implemented in c86d3c0; `/reset-password` page and Postgres/Resend still unverified) | Implemented — awaiting verification | ☐ | |
| S-10 Commercial terms enforcement | Implemented — awaiting verification | ☐ | |
| S-11 Stock validation / restoration | Implemented — awaiting verification | ☐ | |
| S-12 Audit trail | Accepted | ☐ | |
| S-13 CSRF origin check | Implemented — awaiting verification | ☐ | |
| S-14 Long-lived sessions | Accepted | ☐ | |
| S-15 Privileged demo seed accounts | Implemented — awaiting verification | ☐ | |
| C-03 Subscription billing scope | Open | ☐ | |
| C-01 Missing approved PRD text | Open | ☐ | |

### 4.10 Post-interview 5-minute close-out (do not skip)

1. Fill one block in the canonical `INTERVIEW_LOG.md` — especially exact quotes, amount lost, and pillar fit.
2. Update counters in the canonical `PILOT_TRACKER.md`: interviews completed, category coverage, same problem named unprompted, commitments.
3. Write one line: *"What surprised me was ____."* If nothing surprised you, you probably asked leading questions.
4. Send the thank-you message the same day, with your name in it, so they can find you again.
5. If a commitment was made, send the confirmation message (plan Appendix B) the same day and record date, time and channel.

---

## 5. Mapping of this guide to the validation plan

| This guide | Plan reference | Purpose |
|---|---|---|
| §0 How to use | Plan §2, §4, §6 | Market, categories, consent, security, pillar fit |
| §1 Common rules/probes/safety | Plan §4.2, §6, §8 | Outreach principles, operating rules, security restrictions |
| §2 Supplier script S-A…S-E | Plan §3 Category A–D Q1–Q5, §4.3 cross-category, §9 commitment ladder | Supplier-side discovery, price privacy, stock, orders, manual claims, partial payment/held stock, pilot willingness |
| §3 Reseller script R-A…R-E | Plan §3 Category A–D Q1–Q5, §4.3 cross-category, §9 commitment ladder | Reseller-side discovery, supplier discovery, private pricing access, payment claims, order status tracking, stock-outs, partial payments, delivery confirmation |
| §4.1–4.3 Capture tables | Plan §7 evidence collection, §5.1 gates | Per-interview record, verbatim quotes, unprompted mentions |
| §4.4 Category tracker | Plan §3, §5.1 G-01/G-04/G-06 | Category diversity and marketplace both sides |
| §4.5 Pillar-fit tally | Plan §3.1, §5.1 G-05, §11 G-11 | Pillar fit not forced toward "both" |
| §4.6 Commitment log | Plan §9, §5.1 G-08 | Dated commitments only |
| §4.7 Competitor check | Plan §7.3, §5.1 G-07 | 5 tools + weaknesses |
| §4.8 Go/No-Go scoring | Plan §5.1, §11, §13 | Gate-by-gate scoring, no averaging away a missing gate |
| §4.9 Security pre-pilot gates | Plan §5.2 | Verified or formally risk-accepted before external pilot |
| §4.10 Close-out | Plan §7.1, §15 | Same-day records, no memory reconstruction |

---

## 6. Guardrails (read before every session)

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
- Do not describe SellFlow as validated, Stage 3 ready, or pilot-launch ready. Phase 0 is incomplete until the GO/REVISE/STOP decision is recorded in `STATE.md`.
- No payment gateway, wallet, escrow, bank verification or automated settlement is offered or implied at any point (D-013). No subscription billing is presented as approved (C-03 open).
- No application code, schema, migration, register, database or test file is changed by this document.

---

*End of field guide. After each session, complete §4.10 close-out before the next interview.*