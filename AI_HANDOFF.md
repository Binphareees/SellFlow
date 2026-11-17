# AI Handoff

## Read first

`STATE.md` (current status), `PRD_V0.2.md` (requirements register; source gaps marked), `VALIDATION_PLAN.md` (Phase 0 plan and gates), then `README.md`. Read `MVP_SPEC.md` only as history; it describes a superseded local-first build.

## Current status (2026-11-04)

**PRD v0.2: Approved. Implementation: AUTHORIZED on 2026-11-04 (owner Implementation GO, `STATE.md` D-019). Phase 0 validation: still incomplete. Validation GO: not granted.**

V1 code exists and runs locally (Next.js 15 App Router + Prisma + SQLite with first-party sessions — not the Vite PWA described in `TECH_STACK.md`; D-011 explains why).

**Development may resume now.** The owner granted Implementation GO on 2026-11-04, choosing to bypass the pending Phase 0 validation requirements rather than wait for them. Implement, fix and extend within the constraints below; the earlier prohibition on implementation is withdrawn.

**Implementation authorization is not validation approval.** Phase 0 has produced no interview evidence, no dated prototype commitments and no concierge results, so nothing here proves demand. `VALIDATION_PLAN.md` still defines the gate a validation GO would require, and no validation decision has been recorded.

## What to help with now

- **Implementation work is authorized.** Features, bug fixes, schema and migration changes and dependency updates are permitted under the constraints below; product requirements and architecture stay as approved unless the owner explicitly approves a change.
- Track every audit finding S-01 to S-15 as open work. Fixing one requires a test that fails before the fix, and the finding may only be marked resolved with that evidence.
- Keep the standing constraints: no payment gateway, wallet, escrow, transfer or bank verification; private reseller prices only through `src/server/price-access.ts`; money as integer kobo; zod-validated bodies; audited security actions.
- Run Phase 0 (still required for a validation GO): recruit business owners, suppliers and resellers; log interviews in `INTERVIEW_LOG.md`
- Confirm the target market (Nigerian businesses of all kinds) and country; select at least four diverse categories
- Complete the competitor check across the selected categories
- Collect dated prototype-testing commitments and record them in `PILOT_TRACKER.md`
- Run the two-week concierge experiment described in `VALIDATION_PLAN.md`
- Synthesize evidence and prepare the GO / REVISE / STOP decision for `STATE.md`
- Challenge weak signals: compliments without commitments are not evidence
- Keep the validation record honest: a validation GO is only recorded on its own evidence, never because implementation was authorized

## Security findings must stay tracked

`SELLFLOW_V02_AUDIT_REPORT.md` remains the source of record. Implementation GO does not close, downgrade or waive anything:

- **S-01 to S-07 and S-15 (P0)** and **S-08 to S-14 (P1)** are still open unless a fix is committed and verified by a test.
- Do not mark a finding resolved without a verifying check, and do not delete or rewrite the finding text.
- Do not demonstrate disputes with real users while S-01 (`GET /api/disputes?scope=all`) is unfixed.
- Out-of-scope subscription billing (C-03) is still awaiting an owner decision; do not expand it as if it were approved V1 scope.

## What not to do

- Do not claim validation has passed, that Phase 0 is complete, or that a validation GO exists because implementation was authorized
- Do not close, downgrade or silently drop audit findings S-01 to S-15; keep them tracked until fixed and verified
- Do not change the product requirements or architecture without explicit owner approval
- Do not use real customer records or published demo credentials in demonstrations
- Do not demonstrate disputes with real users until the global dispute-access vulnerability (audit S-01) is fixed
- Do not expose private reseller prices to unapproved participants
- Do not claim payment or delivery verification

## Coding contract (in force — implementation is authorized)

For every code change provide:

1. Exact file path
2. Exact start/end boundaries or insertion point
3. Complete replacement code
4. Commands/steps to verify
5. Expected result and likely troubleshooting

Rules: money is always integer kobo; reseller prices are read only through `src/server/price-access.ts`; every request body is validated with zod; security-relevant actions are audited; HTML and API responses are never cached by the service worker. Never add a payment gateway, wallet, escrow, transfer or bank verification. Do not silently overwrite files or expand the MVP. Do not invent credentials, endpoints, or test results.

## Constraints

- Zero-cost tooling; no paid APIs, no paid auth or image services
- No payment gateway, wallet, escrow, in-app transfer or bank verification — ever, by design
- WhatsApp is a prefilled link the seller taps, never an automated send
- SQLite for local work; the schema is written to move to Postgres unchanged (money as integer kobo)
- The service worker must never cache HTML or `/api/*` responses
- Subscription billing and paid-plan enforcement are present in the codebase but out of V1 scope; do not present them as authorized behavior

## After each milestone

Update `STATE.md` (status, decisions, changelog). Keep `VALIDATION_PLAN.md`, `INTERVIEW_LOG.md` and `PILOT_TRACKER.md` current during Phase 0. Do not tick roadmap items as done unless the evidence exists.
