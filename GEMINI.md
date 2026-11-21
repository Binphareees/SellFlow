# SellFlow — working context for Gemini CLI

You are working on **SellFlow**, a business-management + supplier→reseller commerce platform
for businesses of all kinds and sizes, starting with **Nigeria**. Core promise:
*"know who still owes you, and remind them in one tap."*

This file is loaded automatically every session. Read it before acting, then read `STATE.md`.

---

## 1. Source of truth — read in this order

| File | Role |
|---|---|
| `STATE.md` | **Canonical status.** Current phase, decisions (D-001…D-019), security register (S-01…S-15), acceptance evidence, changelog. Trust this over everything else. |
| `AI_HANDOFF.md` | Working agreement, coding contract, constraints, "what not to do". |
| `README.md` | Architecture, layout, API map, rules the code enforces, verification commands. |
| `PRD_V0.2.md` | Requirements register. Explicitly incomplete — gaps are marked; the verbatim approved PRD is missing. |
| `VALIDATION_PLAN.md` | Phase 0 plan, gate criteria, concierge experiment. |
| `SELLFLOW_V02_AUDIT_REPORT.md` | Defines the canonical security finding IDs S-01…S-15. |
| `MVP_SPEC.md`, `TECH_STACK.md`, parts of `ROADMAP.md` | **Historical only.** They describe a superseded Vite/IndexedDB build. Do not implement from them. |

Root also contains many `STAGE2_*` / `A17_A6_*` / `PART1_*` reports — evidence artifacts, not instructions.

---

## 2. Current status (as of 2026-11-21)

- **Phase 0 validation: INCOMPLETE.** No interviews, no dated prototype commitments, no concierge results.
- **Implementation: AUTHORIZED 2026-11-04** (D-019). Build and fix freely within the constraints below.
- **Validation GO: NOT GRANTED.** Implementation authorization ≠ validation approval. Never conflate them.
- **Validation decision date:** proposed 2026-12-11, awaiting owner approval.

**Phase 0 still owes:** target market/categories selected (≥4 diverse categories), competitor check,
interview evidence in `INTERVIEW_LOG.md`, dated commitments in `PILOT_TRACKER.md`, two-week concierge
experiment, and the GO/REVISE/STOP decision.

### Security findings — never close one without evidence

Accepted (dated acceptance record exists): **S-01, S-02, S-05, S-08, S-12, S-13, S-14, S-15**.
Authorized (residual risk documented; owner sign-off recorded 2026-11-21): **S-06**.

Open / implemented-awaiting-verification: **S-03, S-04, S-07, S-09, S-10, S-11**.
Authorized but residual risk documented: **S-06**.

Rule: a finding is `Accepted` only when a dated acceptance record exists **and** the implementation is
present. An implementation report alone is not acceptance. Do not rewrite, downgrade or delete finding text.
`npm run validate:register` enforces the table's structure.

**C-2 (open):** historical migration checksum anomaly (`33b41fc7…` on disk vs `539bd5b6…` recorded as applied).
Acceptance of S-14 neither resolves nor waives it. Do not recalculate checksums to make it go away.

---

## 3. Stack and layout

- **Next.js 15.5.28** (App Router, TypeScript), **React 19**
- **Prisma 6 + SQLite** locally (`prisma/dev.db`), schema written to move to Postgres unchanged
- **First-party auth** — bcrypt + hashed session tokens in an httpOnly cookie (no auth vendor)
- **Hand-written CSS** in `src/app/globals.css` (no Tailwind, no CSS-in-JS)
- 33 Prisma models · 57 API route handlers · 7 migrations

```
prisma/schema.prisma    33 models: identity, access, workspace, marketplace, network,
                        fulfilment, disputes, billing, audit
prisma/seed.ts          demo data (guarded — see S-06/S-15)
prisma/migrations/      forward-only
src/app/(app)/          authenticated pages
src/app/marketplace/    PUBLIC discovery pages (own shell for guests)
src/app/api/            57 JSON route handlers
src/components/         mobile UI + client forms
src/lib/                auth/, api.ts (envelope + zod), money.ts, validation.ts
src/server/             THE RULES LIVE HERE — price-access, workspace, supplier,
                        disputes, accounts
public/                 manifest.json, sw.js, offline.html, icons/
scripts/                verify-api, test-e2e-clean, test-s12-isolated, verify-pwa,
                        validate-security-register, seed-pilot, deploy
```

---

## 4. Commands

```bash
npm run dev              # http://localhost:3000
npm run build            # prisma generate && next build
npm run typecheck        # tsc --noEmit
npm run test:e2e:clean   # full isolated suite on a disposable DB (never touches dev.db)
npm run test:pwa         # builds prod bundle, asserts PWA layer
npm run validate:register
npm run db:seed          # demo supplier/reseller/mediator/admin
npm run pilot:seed       # real pilot onboarding (interactive, --dry-run first)
```

Baseline (2026-11-18, isolated): **516 executed, 515 PASS, 0 FAIL, 1 SKIP**. Reproduced twice.

Tracked Vitest baseline (2026-11-21, disposable SQLite DB): **10 test files, 87 tests PASS** covering Owner Decision 6 (`src/server/decision6-stock-hold.test.ts`), S-09 (`src/lib/auth/reset-request-throttle.test.ts`), S-03/S-04 (`src/server/supplier-s03-s04.test.ts`), S-05 (`src/lib/auth/login-throttle.test.ts`), S-06/S-15 (`src/lib/seed-guard.test.ts`), S-08 (`src/lib/customer-visibility.test.ts`), and S-13 (`src/lib/csrf-origin.test.ts`), wired into `vitest.config.ts`; `npx tsc --noEmit` and `npm run build` PASS; `prisma/dev.db` checksum `59d9cb2c6bd8ee65c87479c486c2779fb4d5263a371673c7bf1dd5fd3885592c` unchanged.

---

## 5. Hard rules — these are not style preferences

1. **Money is always integer kobo.** Use `src/lib/money.ts`. Never floats.
2. **Reseller prices are read ONLY through `src/server/price-access.ts`.** It requires session → `RESELLER`
   role → `APPROVED` application for that exact supplier → `ACTIVE` agreement → active offer. Denials are
   audited and return a reason code, never a price. Public listing selects must never touch price columns.
3. **No fintech surface, ever.** No payment gateway, wallet, escrow, transfer or bank verification. Payments
   are manual records and party claims. Do not add one even if asked casually.
4. **Every request body is zod-validated** via `src/lib/validation.ts` + `src/lib/api.ts`.
5. **Security-relevant actions are audited** to `AuditLog` (registration, login, price grants/denials, role
   and tier changes, status transitions, claims, disputes).
6. **The service worker must never cache HTML or `/api/*`.** Static assets only, plus the offline page.
7. **WhatsApp is a prefilled link the seller taps** — never an automated send.
8. **Zero-cost tooling.** No paid APIs, no paid auth/image services.
9. **One step per party.** Only the supplier confirms stock/dispatch/terms; only the reseller confirms
   delivery. Violations return 403, never a silent no-op.
10. **Subscription billing (C-03) is out of V1 scope.** It exists in code; do not present or expand it as
    authorized behaviour without an explicit owner decision.

---

## 6. How to deliver a change (coding contract)

For every code change, provide:

1. Exact file path
2. Exact start/end boundaries or insertion point
3. Complete replacement code (not a fragment)
4. Commands to verify
5. Expected result and likely troubleshooting

Never silently overwrite files, invent endpoints, invent credentials, or invent test results.
Do not expand the MVP without explicit approval.

---

## 7. Work in progress — do not clobber

As of 2026-11-21, `main` is clean at commit `f067bc3e3311b81c06370503912037da99de7c26`; there are no uncommitted working-tree changes in this repository.

Phase 0 documentation suite (all PII-free, anonymized cohort IDs where applicable):

- `docs/PHASE0_PILOT_LAUNCH_VALIDATION_PLAN.md`
- `docs/PHASE0_INTERVIEW_SCRIPTS.md`
- `docs/PHASE0_FIELD_EXECUTION_TRACKER.md`

Standing guardrails remain in force:

- `prisma/dev.db` is untouched (`59d9cb2c6bd8ee65c87479c486c2779fb4d5263a371673c7bf1dd5fd3885592c`).
- The C-2 migration checksum anomaly remains open.
- S-03, S-04, and S-09 remain implemented but not accepted. S-09 reset-request throttling and single-active-token invalidation are implemented (commit c86d3c0); the `/reset-password` UI page (Request Reset Mode + `?token=...` Confirm New Password Mode) and `/login` "Forgot password?" link are implemented and verified end-to-end on a disposable SQLite DB; remaining unverified runtime items: Postgres runtime, real Resend delivery.
- Do not commit, revert, or "clean up" without owner authorization.

---

## 8. Do not

- Claim validation has passed, Phase 0 is complete, or that a validation GO exists
- Mark an audit finding accepted/resolved without a dated acceptance record and present implementation
- Demonstrate disputes with real users (S-01 history)
- Expose private reseller prices to unapproved participants
- Use real customer records or published demo credentials in demonstrations
- Print or commit secrets from `.env` / `.env.production`
- Delete or rewrite evidence reports to make the record look cleaner

---

## 9. Continuing the work

Good next moves, in priority order:

1. **Close S-09 verification gap** — reset-request throttling, single-active-token invalidation, and the `/reset-password` UI page are implemented and verified on a disposable SQLite DB; remaining runtime verification is Postgres execution and real Resend delivery. Produce evidence and ask the owner to accept or reject.
2. **Verification, not new features** — S-03, S-04, S-05, S-07, S-08, S-10, S-11, S-13, S-15 are implemented
   but unaccepted. Each needs a test that fails before the fix and passes after, then a dated acceptance record.
3. **Phase 0** — this is the real gate. Interviews, category selection, competitor check, concierge experiment.
   Implementation progress does not substitute for it.
4. **C-2** — migration checksum provenance remains open; do not paper over it.

When you finish a milestone, update `STATE.md` (status, decisions, changelog). Keep `VALIDATION_PLAN.md`,
`INTERVIEW_LOG.md` and `PILOT_TRACKER.md` current. Do not tick roadmap items without evidence.
