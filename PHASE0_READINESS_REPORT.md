# SellFlow — Phase 0 Readiness Report

**Report date:** 2026-11-04
**Prepared by:** Documentation reset (read-only with respect to application code)
**Scope:** Documentation and validation preparation only. No application feature was implemented, fixed or authorized by this report.
**Authorization update (2026-11-04):** After this report was written, the project owner granted **Implementation GO** and chose to resume development while Phase 0 stays open. Authorization only changed — every validation finding, documentation conflict and security finding below remains open as written. See §11.
**Related documents:** `PRD_V0.2.md`, `STATE.md`, `VALIDATION_PLAN.md`, `INTERVIEW_LOG.md`, `PILOT_TRACKER.md`, `SELLFLOW_V02_AUDIT_REPORT.md`

---

## 1. Current project status

| Item | Status |
|---|---|
| PRD v0.2 | Approved |
| Canonical in-repo PRD document | **Incomplete** — `PRD_V0.2.md` is a sourced requirements register with explicit gaps; the complete approved text is missing |
| Phase 0 validation | Pending |
| Interview evidence | Not yet established (zero completed interviews recorded) |
| Prototype commitments | Not yet established (zero dated commitments) |
| Concierge experiment | Not completed (not started) |
| Target market | Nigerian businesses of all kinds and sizes (confirmed) |
| Country | Nigeria (confirmed) |
| Category mix | Not selected — at least four categories required |
| Competitor check | Not done |
| Validation GO decision | Not granted |
| Implementation authorization | Not granted at the time of this report — **granted 2026-11-04** (owner Implementation GO; see §11) |
| V1 codebase | Exists and runs locally; frozen pending GO |
| Validation decision date | 2026-12-11 (PROPOSED — awaiting user approval) |
| Original kill date | 2026-11-06 (retained as history; no longer realistic) |

**Key distinction:** a working V1 codebase is not validation evidence. Code exists because an earlier owner instruction (D-010) skipped the gate. D-010 is now recorded as **superseded**, and the Phase 0 gate is back in force (D-014). PRD approval is not implementation authorization.

---

## 2. Documentation changes made

All changes are documentation-only. No file under `src/`, `prisma/`, `scripts/`, `public/`, no migration, no dependency manifest and no database was modified.

### 2.1 Created

| File | Purpose |
|---|---|
| `PRD_V0.2.md` | Canonical requirements register covering all 19 approved section headings. Every requirement is marked **Sourced**, **Partially sourced** or **Source gap**. Missing approved text is reported, not reconstructed. |
| `INTERVIEW_LOG.md` | Canonical blank interview record: participant reference, type, category, location, date, workflow, unprompted problems, existing tools, evidence, demo feedback, willingness to test, agreed start date, follow-up. Includes summary table, gate counters and evidence index. |
| `PHASE0_READINESS_REPORT.md` | This report. |

### 2.2 Rewritten or expanded

| File | Change |
|---|---|
| `STATE.md` | Status block set to the required approved state. Phase reset to 0. Implementation marked paused/not authorized. D-010 marked **Superseded** with history preserved. D-005 marked superseded by D-011. Added D-014 (restore gate and freeze), D-015 (PRD register), D-016 (proposed date), D-017 (documentation reconciliation). Counts corrected to 31 models and 135 checks, with historical counts labelled. Changelog history preserved, including an explicit withdrawal of the old “Validation is no longer a blocker” claim. |
| `VALIDATION_PLAN.md` | Rebuilt for three participant groups (business owners, suppliers, resellers). Adds recruitment strategy, open-ended discovery questions, five demonstration scenarios, evidence collection, commitment ladder, two-week concierge experiment, success/failure indicators, GO/REVISE/STOP process, gate checklist, security restrictions and proposed timeline. Preserves the original gate and the requirement to validate both marketplace sides. |
| `PILOT_TRACKER.md` | Expanded from an account tracker to a full Phase 0 operational record: suppliers, resellers, business-management participants, offers, applications, approvals, agreements, stock confirmations, supplier orders, payment claims, delivery confirmations, disputes, repeat activity, concierge observations, order volume, scorecard and seeder log. All tables remain blank. |
| `README.md` | Added status banner. Removed published demo credentials. Corrected model count (31), route-handler count (51), Docker stages (multi-stage with `migrator` and `pilot`), and check total (135). Added out-of-scope billing note and clarified the historical “cloud sync” wording. Revised the documentation index. |
| `AI_HANDOFF.md` | Rewritten to state Phase 0 pending and prohibit implementation, schema, migration and dependency changes until a recorded GO. |
| `MONETIZATION_AND_LAUNCH.md` | Added a status note: Phase 0 pending, billing out of V1 scope, this is not a launch approval. |
| `templates/INTERVIEW_LOG.md` | Reduced to a field card that links to the canonical root `INTERVIEW_LOG.md`, with the three participant types. |
| `templates/PILOT_TRACKER.md` | Outreach/funnel tracker aligned with the three-group model and linked to the canonical root tracker. |

### 2.3 Labelled superseded (content preserved)

| File | Label |
|---|---|
| `MVP_SPEC.md` | **SUPERSEDED** — original local-first IndexedDB MVP; actual build is server-rendered Next.js + Prisma. |
| `TECH_STACK.md` | **SUPERSEDED** — original Vite + IndexedDB + static-host plan; actual stack is Next.js 15 App Router + Prisma + SQLite. |
| `ROADMAP.md` | **PARTIALLY SUPERSEDED** — Phase 0 gates remain current; Phase 1 local-first tasks are historical. |

No existing file was deleted.

### 2.4 Target-market correction (2026-11-04)

The owner corrected the target market: SellFlow serves **Nigerian businesses of all kinds and sizes**, not a single fashion/accessories segment. The documentation now states:

- The overall market is broad and is not permanently narrowed by the Phase 0 sample.
- The interview sample is manageable but diverse: **at least four business categories**, with no category above roughly half the sample.
- Each participant's **pillar fit** is recorded: business management only, marketplace only, both, or unclear.
- No category is assumed to need every feature. A one-pillar need is valid evidence.
- The gate now includes category diversity (G-04) and pillar fit (G-11), and the PRD adds PO-07 to PO-10 and P0-10 to P0-12.
- This correction is recorded as D-018 in `STATE.md` and in the PRD change-control appendix.

---

## 3. Remaining documentation conflicts

| # | Conflict | Status | Required resolution |
|---|---|---|---|
| C-01 | The complete approved PRD v0.2 text is absent from the repository, git history and task context. Only a one-line citation of “Section 21.1” exists in an imported conversation. | **Open — blocking completeness** | Supply the approved PRD v0.2 document. Reconcile `PRD_V0.2.md` section by section and remove the source-gap markers. |
| C-02 | `BUSINESS_OWNER` is implemented as a `ProfileRole`, but available material suggests it may be a workspace role rather than a marketplace role. | Open | Confirm from the approved PRD role matrix. |
| C-03 | Subscription billing and paid-plan enforcement are fully implemented and wired into core entitlements, but are out of V1 scope. | Open | Written decision: authorize billing in V1 and update the PRD, or remove the billing surface and entitlement gates. Do not leave it ambiguous. |
| C-04 | “Cloud sync between devices” appears as out of scope in older text, while the server database already centralizes data. | Clarified in `README.md` | Confirm whether any real-time sync is intended in V1. Current wording: accounts can sign in on multiple devices; real-time sync and conflict handling are not V1 features. |
| C-05 | `ROADMAP.md` Phase 1 still describes the superseded 7-day local-first build. | Labelled historical | Keep as history; do not use as build instructions. A new post-GO plan is needed only after a recorded GO. |
| C-06 | `templates/DISCOVERY_INTERVIEW_SCRIPTS.md` states that the PRD is missing and that Section 21.1 wording may override it. | Accurate, retained | Update only after the approved PRD is supplied. |
| C-07 | Historical changelog entries in `STATE.md` contain old counts (29 models, 41/63 assertions). | Labelled historical with current corrections | No action; history is intentionally preserved. |
| C-08 | The audit report’s line-number references to old `STATE.md`/`README.md` content no longer match the rewritten files. | Expected | Treat the audit report as a dated snapshot; it is not a live status document. |

**No documentation conflict was resolved by inventing a requirement.** Where the approved text was unavailable, the requirement is marked as a source gap.

---

## 4. Missing validation decisions

These decisions are required before outreach can begin. None has been made.

| # | Decision | Owner | Why it blocks |
|---|---|---|---|
| V-01 | Select at least four business categories for a diverse but manageable sample, and confirm the category mix. | Project owner | Without it, interviews are either too narrow to test cross-industry relevance or too scattered to score. |
| V-02 | Approve the validation decision date. | Project owner | 2026-11-06 is not achievable; 2026-12-11 is proposed. |
| V-03 | Decide whether the concierge experiment uses real participant data (with consent) or synthetic data only. | Project owner | Affects privacy handling and what the experiment can prove. |
| V-04 | Decide the minimum evidence for “existing tools are inadequate.” | Project owner | The gate requires it, but the threshold must be defined before scoring. |
| V-05 | Decide whether supplier and reseller interviews must both reach 3, or whether 3 combined is acceptable. | Project owner | `VALIDATION_PLAN.md` proposes 3 each plus one observed order flow. |
| V-06 | Decide the billing-scope question (C-03). | Project owner | It changes what the pilot environment exposes. |
| V-07 | Decide whether P0 security fixes are a prerequisite for any real-user pilot. | Project owner | The audit recommends yes; `VALIDATION_PLAN.md` forbids real-user disputes until S-01 is fixed. |

---

## 5. Recommended recruitment plan

### 5.1 Target sample

| Group | Profile | Prospects listed | Interviews target |
|---|---|---|---|
| A. Business owners | Any Nigerian business that takes orders and tracks payments — retail, fashion, electronics, food, beauty, household goods, wholesale/distribution, services and other sectors; 5–40 orders per week is a guide, not a filter | 20 | 4–6, across ≥ 4 categories |
| B. Suppliers | Wholesaler, importer, manufacturer or product owner supplying 3–5+ resellers; has a price list to protect | 20 | 3–4 |
| C. Resellers | Sells products they do not own; sources from a regular supplier; advertises on WhatsApp/Instagram | 20 | 3–4 |
| **Total** | | **60** | **8–14** (gate minimum 8, ≥ 4 categories) |

**Diversity rule:** aim for 2–3 interviews in each of four to six categories, not 8 in one category. No category above roughly half the sample. Record each participant's pillar fit — business management, marketplace, both, or unclear. A business that needs only one pillar is valid evidence.

### 5.2 Channels

- Direct WhatsApp and Instagram outreach to known contacts.
- Market associations and in-person visits to markets/plazas.
- Referrals from the first interviewees (ask at the end of every interview).
- Supplier and reseller communities.
- Existing business relationships; no purchased lists.

### 5.3 Sequencing

1. Confirm the target market (Nigerian businesses of all kinds) and country; select at least four categories and record the mix in `STATE.md`.
2. Complete the competitor check (5 tools and their weaknesses across the selected categories).
3. Build the 60-name prospect list in the private copy of `PILOT_TRACKER.md`, spread across categories.
4. Recruit and interview business owners first; use them to refer suppliers and resellers.
5. Interview suppliers and resellers; attempt to observe at least one real supplier–reseller order flow.
6. Ask for one commitment per participant, in the order A → B → C.
7. Start the two-week concierge experiment only with participants who gave a dated commitment.

### 5.4 Recruitment rules

- Lead with research, not a sales pitch.
- Ask about past behaviour, never future intent.
- Never pay for a positive answer.
- Do not reveal the product before the discovery section.
- Obtain consent before notes or recording.
- Prefer voice/call or in-person; chat interviews produce weaker evidence.

---

## 6. Proposed validation timeline

**Proposed decision date: 2026-12-11 (Friday) — AWAITING USER APPROVAL.**
The original 2026-11-06 date is retained in `STATE.md` and `ROADMAP.md` as history. It allowed two days after the audit, which is not enough for recruitment, 8+ interviews, dated commitments and a two-week experiment.

| Period | Activity | Output |
|---|---|---|
| 2026-11-04 → 11-08 | Approve plan and date; confirm target market/country; select 4–6 categories; competitor check; build prospect lists; prepare synthetic demo accounts | Updated `STATE.md`; category plan; prospect list; competitor notes |
| 2026-11-09 → 11-13 | Outreach and first business-owner interviews | Interview logs; early patterns |
| 2026-11-16 → 11-20 | Supplier and reseller interviews; demos; commitment asks | ≥ 8 interviews; ≥ 3 dated commitments |
| 2026-11-20 | Gate checkpoint for G-01 to G-11 | Decision whether to start the experiment |
| 2026-11-23 → 12-04 | Two-week concierge experiment | Observation logs; activity and return data |
| 2026-12-07 → 12-11 | Synthesize evidence; decision meeting; record decision | `STATE.md` decision entry |
| 2026-12-11 | Proposed decision date | GO / REVISE / STOP |

**Buffer:** the schedule has no slack for a second recruitment wave. If recruitment slips by more than one week, the decision date must be re-approved, not silently extended.

---

## 7. Security restrictions for demonstrations

Mandatory for every interview, demo and concierge session:

1. **Do not use real customer records in demonstrations.** Use synthetic customers and orders.
2. **Do not use published demo credentials.** Create separate synthetic demonstration accounts; never use seeded accounts that are documented or shared.
3. **Do not expose private reseller prices to unapproved participants.** Show private prices only to a synthetic approved reseller, and never in a public screen or screenshot.
4. **Do not demonstrate disputes using real users until the global dispute-access vulnerability is fixed.** Audit finding S-01 (`GET /api/disputes?scope=all`) must be fixed and verified first.
5. **Do not claim payment or delivery verification.** SellFlow records manual claims; it does not verify that money moved or that goods arrived.
6. **Use synthetic demonstration accounts and data.** Reset or recreate them between sessions.
7. **Clearly distinguish working features from incomplete or unverified features.** Use the feature-status table in `VALIDATION_PLAN.md` §8.1 in every demo.

Additional handling rules:

- Do not screen-share a real workspace.
- Do not record video calls.
- Do not screenshot participants’ customers’ chats.
- Redact names, phone numbers and price lists in any retained artifact.
- Keep filled-in `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` private; the committed versions stay blank.

---

## 8. Outstanding audit findings

Source: `SELLFLOW_V02_AUDIT_REPORT.md` (read-only audit dated 2026-11-04). These findings remain open; no fix was made in this task.

### 8.1 P0 — must be fixed before any real-user pilot or GO

| ID | Finding | Severity |
|---|---|---|
| S-01 | Any authenticated user can list every dispute via `GET /api/disputes?scope=all`. | **Critical** |
| S-02 | Unvalidated `customerOrderId` allows a cross-tenant order link (IDOR) and leaks customer name/phone. | High |
| S-03 | A claimant can self-assign `CONFIRMED` or `DISPUTED` on a payment claim at creation. | High |
| S-04 | A supplier can jump the order lifecycle to any status, bypassing stock, dispatch, delivery and payment steps. | High |
| S-05 | No authentication rate limiting or account lockout. | Medium |
| S-06 | Demo credentials were published and seeded with a shared password. README credentials removed in this task; seed and landing-page behavior still need fixing. | Medium |
| S-07 | Registration grants verification tier 1 without email verification. | Medium |
| S-15 | Demo seed creates privileged mediator and platform-admin accounts. | Low |

### 8.2 P1 — required before a real-user pilot

| ID | Finding |
|---|---|
| S-08 | `ORDER_ONLY` customer-data visibility still returns customer name and phone. |
| S-09 | No password reset or change flow; users can be permanently locked out. |
| S-10 | Commercial terms (minimum resale, advertising, commission, payment terms) are stored but not enforced. |
| S-11 | Stock confirmation does not validate or decrement stock; cancellation does not restore it. |
| S-12 | Audit trail is empty in the audited database and audit writes are best-effort. |
| S-13 | No explicit CSRF origin check. |
| S-14 | Long-lived sessions without rotation. |
| — | Out-of-scope subscription billing is wired into core entitlements (see C-03). |

### 8.3 Test evidence from the audit (not re-run in this task)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Passed |
| `npx prisma validate` | Passed |
| `npx prisma migrate status` | Up to date (3 migrations) |
| `npm run build` | Passed |
| `npm run test:pwa` | 31/31 passed |
| API suite on a DB copy | 135/135 passed |

These results describe the code at audit time. They do **not** constitute Phase 0 validation and do not change the gate status. No test, build or server command was run during this documentation task.

### 8.4 Documentation findings already addressed

The audit’s documentation findings D-01 to D-14 were the basis for this reset. Addressed in this task: wrong phase/status in `STATE.md`, D-010 treated as active, stale counts, published credentials, superseded MVP/TECH_STACK specs, roadmap conflict, AI handoff contradiction, and blank tracking templates. Still open: the missing PRD source (D-08/§4) and the billing-scope decision.

---

## 9. Questions requiring user approval

| # | Question | Proposed default |
|---|---|---|
| Q-01 | Do you approve **2026-12-11** as the validation decision date? | Approve; record in `STATE.md`. |
| Q-02 | Which **four to six business categories** should the initial sample cover, and in what proportions? | Choose a mix across retail, fashion, electronics, food, beauty, household goods, wholesale/distribution and services; no category above ~50%. |
| Q-03 | Will you supply the **complete approved PRD v0.2 text**? | Required to complete `PRD_V0.2.md`. |
| Q-04 | Is **subscription billing** in V1 or out? | Out of scope; remove or disable before pilot. |
| Q-05 | Are the **P0 security fixes** a prerequisite for any real-user pilot? | Yes; at minimum S-01 to S-04. |
| Q-06 | Should the concierge experiment use **real participant data** (with consent) or synthetic data only? | Real data with written consent, in a private environment. |
| Q-07 | Is **3 supplier + 3 reseller interviews plus one observed order flow** the right marketplace threshold? | Yes, as written in `VALIDATION_PLAN.md`. |
| Q-08 | Who is the **project owner and note-taker** for the decision meeting? | Owner must name them. |
| Q-09 | Should `MONETIZATION_AND_LAUNCH.md` remain as a later-stage document, or be folded into the PRD? | Keep as a later-stage document with the status note. |
| Q-10 | Do you want the **filled-in** interview and pilot records kept outside the repository? | Yes; commit only blank templates. |
| Q-11 | Is the **minimum-four-categories** rule the right diversity threshold, or should it be higher? | Keep four; add categories if recruitment allows. |

---

## 10. Completion statement

This task is complete as a documentation and validation-preparation exercise:

- The canonical requirements register exists and reports its missing source.
- `STATE.md` reflects the approved status and preserves history.
- Outdated documents are labelled superseded without deletion.
- The validation plan covers all three groups, the preserved gate, the concierge experiment, security restrictions and the decision process.
- Blank interview and pilot trackers exist.
- A realistic replacement date is proposed and marked as awaiting approval.
- No application code, schema, migration, dependency or database change was made.
- No interview, participant, commitment or result was invented.
- Validation has not passed and implementation has not been authorized.

**PRD v0.2: APPROVED**

**Phase 0: PENDING**

**GO: NOT GRANTED**

**Implementation: NOT AUTHORIZED** (as of this report; granted later the same day — see §11)

---

## 11. Authorization update (2026-11-04)

This section is an addition. Sections 1–10 above are preserved as issued and were not rewritten.

### 11.1 The owner's decision

On **2026-11-04** the project owner recorded **Implementation GO** — option 2 of the two paths this report described: resume development immediately and bypass the pending Phase 0 validation requirements. It is recorded as **D-019** in `STATE.md`, with the authorization date 2026-11-04.

### 11.2 What changed

| Item | Before | After 2026-11-04 |
|---|---|---|
| Implementation authorization | Not granted; frozen (D-014) | **Granted.** Development, fixes, schema/migration work and dependency changes may proceed |
| Implementation freeze (D-014) | In force | **Superseded for implementation only**; its Phase 0 gate requirement stands |
| Phase 0 validation | Pending | **Pending — unchanged** |
| Validation GO decision | Not granted | **Not granted — unchanged** |
| Interview evidence, commitments, concierge experiment | Not established | **Not established — unchanged** |
| Audit findings S-01 to S-15 | Open | **Open — unchanged and still tracked** |
| Documentation conflicts C-01 to C-08 | Open | **Open — unchanged** |
| Missing validation decisions V-01 to V-07 | Open | **Open — unchanged** |

### 11.3 What did not change

The decision authorizes building. It does not assert any of the following, and no document should read it that way:

- That the problem is validated, or that demand has been demonstrated.
- That any interview, commitment or concierge result now exists.
- That a validation GO has been granted, or that the 2026-12-11 decision date is met, approved or retired.
- That any audit finding S-01 to S-15 has been fixed, downgraded or waived.
- That the missing approved PRD text (C-01) has been supplied, or that the source-gap markers in `PRD_V0.2.md` can be removed.
- That subscription billing (C-03) is now in V1 scope.

### 11.4 Standing conditions carried into implementation

1. Phase 0 continues in parallel; `VALIDATION_PLAN.md`, `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` still apply.
2. Security findings stay tracked with their original severities until a fix is verified by a test; S-01 still blocks real-user dispute demonstrations.
3. The product boundary is unchanged: no payment gateway, wallet, escrow, transfer or bank verification; private reseller prices only through server entitlement checks; integer-kobo money; zod-validated request bodies; audited security actions; the service worker never caches HTML or `/api/*`.
4. A validation GO/REVISE/STOP decision is still owed and must be recorded in `STATE.md` on its own evidence.

### 11.5 Documents reconciled for this decision

`STATE.md` (D-019, header, status table, D-014 marked superseded, changelog), `AI_HANDOFF.md` (implementation prohibition withdrawn, findings-tracking requirement added), `README.md` (status banner), and this report (§11 only; no historical finding edited). No application code, Prisma schema, migration, dependency or database row was changed.
