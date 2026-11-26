# Roadmap

> **PARTIALLY SUPERSEDED — historical document (2026-11-04).** **Implementation is authorized as of 2026-11-04** (owner Implementation GO, `STATE.md` D-019) and proceeds in parallel with Phase 0, which remains incomplete with no GO granted. The Phase 0 validation gates remain current. The Phase 1 tasks and stack describe the original 7-day local-first MVP and are superseded by the server implementation. See `VALIDATION_PLAN.md`, `PRD_V0.2.md`, and `STATE.md`.

## Phase 0 - Validate (decision date PROPOSED 2026-12-11, awaiting approval; original 2026-11-06 retained as history)

> Runs in parallel with authorized implementation (D-019, 2026-11-04). Shipping code does not check off any item below; this section is still the validation gate.
- [ ] Confirm target market (Nigerian businesses of all kinds) + country; select at least 4 business categories
- [x] Competitor check (5 tools and their weaknesses) — documented in docs/PHASE0_TWO_WEEK_EXPERIMENT.md §1 (2026-11-21)
- [ ] 60 prospects listed across three groups (20 business owners, 20 suppliers, 20 resellers), spread across categories
- [ ] 8+ interviews logged across at least 4 categories, including both marketplace sides (3 supplier + 3 reseller)
- [ ] Pillar fit recorded for every participant (business management / marketplace / both)
- [ ] At least 4 independent unprompted mentions of the same meaningful problem
- [ ] At least 3 dated prototype-testing commitments
- [ ] Two-week concierge experiment completed and observed
- [ ] Synthetic demo accounts prepared; security restrictions followed
- [ ] GO / REVISE / STOP recorded in `STATE.md`

Phase 1 work is no longer gated on this decision: implementation was authorized on 2026-11-04 (D-019). The decision still governs whether the validated product proceeds.

## Phase 1 - 7-day MVP (historical local-first plan; implementation is authorized)
- [ ] Day 1: setup, mobile layout, IndexedDB layer, data model with payments list
- [ ] Day 2: add/edit order, payments, balance logic with integer money
- [ ] Day 3: "Who owes me" home, order list, filters, soft delete/undo
- [ ] Day 4: WhatsApp reminder (phone normalization) + receipt sharing
- [ ] Day 5: export/restore, persistent storage, PWA manifest, offline
- [ ] Day 6: real-phone testing, bug fixes, deploy, share-target experiment (drop if flaky)
- [ ] Day 7: pilot with committed testers; observe, do not coach

## Phase 2 - Improve from evidence
- [ ] Fix observed blockers
- [ ] Track completion of the core workflow, day-3 and day-7 returns
- [ ] Test willingness to pay for customization (branding, templates, language)
- [ ] Decide whether sync is truly needed

## Phase 3 - Monetize
- [ ] One-time customization offer to a real seller
- [ ] Verify payment provider availability, fees, requirements
- [ ] Publish privacy and data-handling notice
