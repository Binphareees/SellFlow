# S-09 Implementation Specification — Stage 2 Task 9

**Finding:** S-09 — No password reset or change flow
**Stage:** 2 — Task 9
**Document type:** READ-ONLY implementation specification
**Date:** 2026-11-09
**Status of S-09:** Open (not started)
**Related accepted findings preserved:** S-12 (accepted), S-14 (accepted)
**Scope of this document:** specification and decision record only. It is not an implementation, a schema change, a migration, a dependency change, a test addition, a configuration change, or a secret setup.

---

## 1. Purpose

This document records the implementation specification and product decisions for S-09, based on existing project evidence. It does not implement anything. Its only job is to make the intended scope, architecture, database shape, API shape, security properties, test targets, sequence, and remaining decisions explicit enough that implementation could proceed once it is authorized, and explicit enough that the remaining gates are visible.

This update records all five decisions as explicitly approved by the product owner.

---

## 2. Approved product decisions

The following are recorded as explicitly approved by the product owner for the purpose of this specification.

### D1 — Recovery delivery channel (APPROVED BY PRODUCT OWNER)

- **Approved approach:** email-based password-reset links, delivered through Resend.
- **What this does and does not mean:**
  - The delivery channel is now a product decision: reset links are emailed, not shown in-band, not SMS, not WhatsApp, not a logged dev token by default.
  - This approval does **not** mean Resend is configured, funded, verified, or operational for this project.
  - It does **not** create, store, or rotate any Resend API key, verified sender domain, or sender identity.
- **Remaining infrastructure prerequisites (unconfigured):**
  - a Resend account,
  - a verified sending domain,
  - an approved sender address,
  - an API key stored in environment configuration and kept out of the repository,
  - whatever development/production environment wiring the project uses,
  - and delivery/failure-path testing after the channel exists.

Until those preconditions are satisfied, S-09 cannot be delivered as a working end-to-end flow even with this approval.

### D2 — Account-recovery scope (APPROVED BY PRODUCT OWNER)

S-09 is limited to two behaviors:

1. **Unauthenticated password reset** — a user who has forgotten their password requests a reset and completes it through a token bound to their account.
2. **Authenticated password change** — a signed-in user changes their password after proving they know the current one.

S-09 explicitly does **not** include, in this task:

- recovery when the user has lost access to their email,
- broader account recovery,
- admin or support credential overrides.

Those are out of scope for S-09 as approved here. They are not declared unnecessary forever; they are excluded from this task so the scope stays minimal and the finding’s stated correction is implementable.

---

## 3. Product decisions — all five approved

### D3 — Admin/support override (APPROVED BY PRODUCT OWNER)

- **Approved stance for S-09:** no admin or support password override in S-09.
- **If a privileged recovery mechanism is wanted later:** it requires a separate security review and explicit authorization. It is not part of this task.
- **Reasoning from existing evidence:**
  - The platform already has a platform-admin gate (`requirePlatformAdmin`) and a mediator gate (`requireMediator`).
  - The `User` model already has `disabledAt`.
  - None of that currently constitutes an in-app “force password reset” or “emergency credential recovery” capability.
  - AR-12 is a source gap in `PRD_V0.2.md`, so the approved PRD is not available to say whether admin recovery is part of “account recovery.”
- **Consequence for this spec:** admin/support credential override remains out of S-09 scope.

### D4 — Session behavior (APPROVED BY PRODUCT OWNER)

The finding and the architecture report say “revoke other sessions on change,” and the product owner has now approved the full session behavior for both paths.

**Authenticated password change:**
- Verify the current password.
- Update the password securely.
- Rotate the session performing the change.
- Revoke all other active sessions.
- Perform the password update and session-security changes atomically where supported.

**Unauthenticated password reset:**
- Consume the reset token exactly once.
- Update the password securely.
- Revoke all existing sessions.
- Require the user to log in again.

**Implementation constraint:** use existing S-14 primitives. Do not modify S-14.

### D5 — Demo/pilot safety (APPROVED BY PRODUCT OWNER)

- Seeded demo-account recovery remains disabled until a separate demo-account policy is approved.
- Preserve S-06 shared-demo-credential safeguards.
- Preserve S-15 seed protections.
- Do not expose shared demo credentials through email or recovery flows.

---

## 4. Evidence reviewed

The conclusions above are based on the following existing project evidence, read in full where relevant and used as input only:

- `STAGE2_TASK9_S09_READINESS_REPORT.md`
- `STATE.md`
- `PRD_V0.2.md`, especially AR-12
- `SELLFLOW_V02_AUDIT_REPORT.md`
- `STAGE1_ARCHITECTURE_REPORT.md`
- existing auth implementation and existing S-14 session/revocation primitives, including:
  - `src/lib/auth/password.ts`
  - `src/lib/auth/session.ts`
  - `src/lib/auth/revocation.ts`
  - `src/lib/auth/identifiers.ts`
  - `src/lib/auth/throttle.ts`
- existing auth route tree under `src/app/api/auth/` and existing auth UI, including:
  - `src/app/api/auth/login/route.ts`
  - `src/app/api/auth/logout/route.ts`
  - `src/app/api/auth/me/route.ts`
  - `src/app/api/auth/register/route.ts`
  - the S-14 sessions routes
  - `src/components/auth-forms.tsx`
  - `src/app/login/page.tsx`
  - `src/app/register/page.tsx`
- existing patterns for atomic writes, session revocation, and audit in:
  - `src/server/accounts.ts`
  - `src/server/supplier.ts`
  - `src/lib/audit.ts`
- existing seed, seed-guard, and environment conventions, including:
  - `prisma/schema.prisma`
  - `prisma/migrations/*`
  - `prisma/seed.ts`
  - `scripts/seed-guard.ts`
  - `scripts/db-reset.ts`
  - `.env`
  - `.env.production.example`

No implementation, schema, migration, dependency, test, configuration, seed, or database changes were made in preparing this specification.

---

## 5. Technical architecture

### 5.1 What exists today

| Concern | Current state |
|---|---|
| Password hashing/verification | `hashPassword`, `verifyPassword`, `PASSWORD_RULES` in `src/lib/auth/password.ts` (bcrypt, cost 12, length min 8, max 100) |
| Session lifecycle | S-14 implemented: rotation on login/privilege change, expiry, revocation primitives, session inventory |
| Session revocation | `revokeAllSessionsForUser`, `revokeOtherSessionsForUser`, `rotateSessionForUser`, and related helpers exist |
| Atomicity pattern | Security-relevant writes run inside a transaction with session revocation and audit in the same transaction |
| Outbound notification | Only WhatsApp deep links exist today; there is no email sender and no transactional-mail infrastructure |
| Auth routes | `login`, `logout`, `me`, `register`, and S-14 `sessions` only |
| Reset/change surface | Absent; no reset-token model, no reset/change routes, no recovery UI, no “Forgot password?” link |
| Demo/seed posture | Seeded demo accounts share `Password123!`; seed guard requires `NODE_ENV=development|test` and `SEED_DEMO_DATA=true` and a disposable local `file:` database path; `disabledAt` exists on `User` and is checked at login/session resolution, but there is no admin workflow endpoint |

### 5.2 What this specification proposes to reuse

- Password hashing and verification from `src/lib/auth/password.ts`.
- The existing S-14 token-at-rest pattern as the design reference for reset tokens: random token value held only briefly in memory, salted SHA-256 hash stored, single-use semantics by “used” state, expiry by creation time plus TTL.
- The existing session-revocation primitives for the password-change and reset session behavior.
- The existing transactional atomicity pattern for the security-sensitive write + revocation + audit sequence.
- The existing enumeration-resistant posture already used at login, applied to the reset-request endpoint so it does not reveal whether an email exists.

### 5.3 What this specification proposes as new

- A reset-token storage model.
- A reset-request route.
- A reset-password route.
- An authenticated change-password route.
- the corresponding frontend recovery surface, including a “Forgot password?” entry point and reset/change forms.

These are described in the database and API sections below.

---

## 6. Database design

### 6.1 Reset-token model (proposed)

A new Prisma model is required because no reset-token store exists today. The intended semantics are:

- One token record per reset attempt.
- Linked to a `User`.
- Token secret held only briefly in memory; stored value is the salted hash, not the raw token.
- Created-at and expiry fields so the token can be rejected when expired.
- A consumed/used indicator so a token is single-use.

These are design intentions for the model, not schema edits. Exact field names, nullability, indexes, and TTL expressions are implementation decisions to be made when the schema is written, subject to the approved scope in D2.

### 6.2 Explicit exclusions

This specification does not propose:
- an admin-recovery override table,
- a “lost email access” recovery store,
- any separate support-recovery role or permission model,
- any change to `User.disabledAt` workflow endpoints.

Those are outside the approved S-09 scope.

---

## 7. API design

The current auth route tree is exactly: `login`, `logout`, `me`, `register`, and S-14 `sessions`. Anything reset/change related is new.

### 7.1 Proposed endpoints

1. **Reset request** — unauthenticated.
   - Accepts an identifier (typically an email).
   - Looks up whether that identifier exists.
   - Creates or replaces a single-use expiring reset token for the account, hashed at rest.
   - Delivers the reset link through the approved recovery channel (email via Resend, once that infrastructure exists).
   - Returns the same public response whether or not the identifier exists, to avoid account enumeration.

2. **Reset password** — unauthenticated, token-bound.
   - Accepts the token and a new password.
   - Validates the token: exists, unexpired, unused, and hash match.
   - Validates the new password against existing password rules.
   - On success: hashes the new password, writes it, consumes the token, and revokes other sessions for the account.
   - On failure: generic error; no information that would reveal which condition failed.

3. **Change password** — authenticated.
   - Accepts current password and new password.
   - Verifies the current password using existing verification.
   - Validates the new password against existing rules.
   - On success: hashes the new password, writes it, and revokes other sessions for the account.
   - On failure: generic error.

### 7.2 Resend dependency for the reset-request endpoint

The reset-request endpoint is designed around email delivery, per the approved D1 decision. Until Resend is configured, the endpoint can be specified but cannot be delivered as a real working flow. A temporary local/dev substitute for pilot is a separate product decision, not an automatic fallback, and is outside the approved demonstration posture unless explicitly chosen.

### 7.3 Response discipline

- Reset-request responses should not distinguish “email found” from “email not found.”
- Reset-password and change-password failures should not reveal which validation failed, beyond a safe generic message.
- This is consistent with the existing login posture and the throttle/abuse-resistance pattern already in the codebase.

---

## 8. Security threat analysis

### 8.1 Nature of S-09

S-09 is a completeness gap, not an exploitable vulnerability. There is no reset/change surface today, so there is nothing to attack through the application. The risk is operational: a legitimate user who forgets a password is permanently locked out, and the only current recovery mechanism is a privileged operator editing the database directly.

### 8.2 Properties the flow must have

- Reset tokens are single-use and expiring.
- Reset tokens are hashed at rest.
- Reset-request does not reveal whether an email or account exists.
- Reset-password validates the token strictly and refuses expired, used, malformed, or mismatched tokens.
- Change-password requires the current password and refuses a wrong current password.
- After any password change or reset, previous credentials no longer authenticate, and other sessions are revoked as specified in D4.
- New passwords are validated against the existing rules.
- The reset/change paths do not create a new account-enumeration or token-guessing vector.

### 8.3 Risks to manage

- **Delivery channel risk.** If email is not actually wired up, the approved flow is incomplete. This is the main infrastructure risk and the reason the readiness verdict remains blocked.
- **Demo/pilot risk.** Any recovery path must not weaken the S-06 shared-demo-credential posture or the S-15 seed guard, and must not imply an email channel the project cannot support.
- **Scope creep risk.** AR-12’s “account recovery” wording is a source gap. Without an explicit decision, implementation could drift beyond D2 into out-of-scope recovery behavior.
- **Privileged-recovery risk.** If an admin/support override is later added, it must not be invented ad hoc; it needs an explicit auth/audit decision first.

---

## 9. Test and acceptance specification

### 9.1 Test environment

All S-09 security tests should run in the same isolated harness pattern used elsewhere:
- an isolated temporary database,
- not `prisma/dev.db`,
- with typecheck and production build green,
- and `prisma/dev.db` fingerprint unchanged before and after.

### 9.2 Acceptance criteria

1. There is a reset-request endpoint, a reset-password endpoint, and a change-password endpoint for authenticated users.
2. Reset tokens are single-use, expiring, and hashed at rest.
3. Reset request does not reveal whether the identifier exists.
4. A successful password reset consumes the token and revokes other sessions for the account.
5. A successful authenticated password change revokes other sessions for the account.
6. After any password change or reset, the previous password no longer authenticates.
7. New passwords obey the existing password rules.
8. No reset/change path bypasses authentication or token validation.
9. S-12 and S-14 remain intact and accepted; no billing/entitlements/C-03 changes.
10. The demo/seed guard and the shared-demo-password concern from S-06 are not made worse by the new flow.

### 9.3 What is not verified yet

There is nothing to run yet because the routes and model do not exist. The acceptance criteria above are the target state for when implementation is authorized.

---

## 10. Implementation sequence

### 10.1 Prerequisites first

1. Configure the Resend delivery prerequisites listed in D1, including secrets in environment configuration.
2. Decide whether any temporary local/dev delivery substitute is acceptable for pilot before email is wired, and if so, what it is.

### 10.2 Implementation order

1. Reset-token model and migration.
2. Reset-token library helpers.
3. Reset-request route and its response discipline.
4. Reset-password route.
5. Authenticated change-password route.
6. Frontend recovery surface: “Forgot password?” entry point and reset/change forms.
7. Isolated security tests and the acceptance checks in §9.2.

### 10.3 What is intentionally not part of S-09

- “Lost email access” recovery.
- Broader account recovery.
- Admin/support credential override.
- Any change to accepted S-12 or S-14 behavior.
- Any change to S-13, S-15, billing, entitlements, or C-03.
- Any change to the seeded demo password itself, which is part of S-06.

---

## 11. Dependencies and blockers

### 11.1 Blockers

- **Resend is not configured and has not been verified operational for this project.** Email delivery is approved as the channel, but the account, verified sender domain, approved sender address, API key, environment wiring, and delivery/failure testing are all still required.
- **AR-12 is a source gap in `PRD_V0.2.md`.** The approved PRD text is not in the repository, so “account recovery” is not fully specified beyond the approved D2 scope.

### 11.2 Dependencies

- Existing password, session, revocation, and atomicity primitives.
- Existing enumeration-resistant posture and throttle pattern.
- A separate demo-account policy decision before seeded-demo recovery is enabled, if that is ever desired.

---

## 12. Readiness verdict

**BLOCKED BY INFRASTRUCTURE**

Reasons:
- The product-design decisions are now fully approved: D1, D2, D3, D4, and D5 are all marked **APPROVED BY PRODUCT OWNER**.
- The approved delivery channel is email via Resend.
- Resend is **not** configured, verified, or wired in this project, and this report does **not** claim otherwise.
- Product approval does **not** mean Resend is operational, and it does **not** mean S-09 is implemented or authorized for implementation.

S-09 remains **BLOCKED BY INFRASTRUCTURE**. It becomes implementable only after:
- the Resend account is configured,
- the sending domain is verified,
- the sender address is approved,
- the API key is securely configured in the appropriate environment,
- the development and production configuration is verified,
- and email delivery and failure-path tests can be performed.

Phase 0 validation remains incomplete and is not satisfied by this specification.

---

## 13. Document status and boundaries

This document is a READ-ONLY specification and decision record. It does not:
- modify source code,
- modify the Prisma schema,
- modify migrations,
- add or remove dependencies,
- add or modify tests,
- modify configuration,
- modify seed scripts,
- modify databases,
- configure Resend,
- create or store secrets,
- implement S-09,
- modify accepted S-12 or S-14 work,
- or touch S-13, S-15, billing, entitlements, or C-03.

The only artifact updated by this task is this specification file: `STAGE2_TASK9_S09_IMPLEMENTATION_SPECIFICATION.md`.

---

## 14. Summary of decision status

| Decision | Status |
|---|---|
| D1 — Recovery delivery channel | **APPROVED BY PRODUCT OWNER**: email-based password-reset links via Resend; Resend account, domain verification, sender identity, and API configuration remain infrastructure prerequisites; do not claim Resend is configured or operational |
| D2 — Account-recovery scope | **APPROVED BY PRODUCT OWNER**: unauthenticated password reset and authenticated password change only; lost-email recovery, broader account recovery, and admin/support credential overrides excluded |
| D3 — Admin/support override | **APPROVED BY PRODUCT OWNER**: no admin/support password override in S-09; any future privileged recovery mechanism requires a separate security review and explicit authorization |
| D4 — Session behavior | **APPROVED BY PRODUCT OWNER**: authenticated change verifies current password, updates securely, rotates the actor session, and revokes other sessions atomically where supported; unauthenticated reset consumes the token once, updates securely, revokes all sessions, and requires a fresh login; use existing S-14 primitives; do not modify S-14 |
| D5 — Demo/pilot safety | **APPROVED BY PRODUCT OWNER**: seeded demo-account recovery remains disabled until a separate demo-account policy is approved; preserve S-06 safeguards and S-15 protections; do not expose shared demo credentials through email or recovery flows |

---

*End of S-09 implementation specification. No implementation has been performed.*

---

## 15. Product Owner Approval — 2026-11-09

On 2026-11-09, the product owner explicitly approved all five S-09 design decisions.

Approved decisions:
- **D1 — Recovery delivery channel:** email-based password-reset links using Resend. Resend account, domain verification, sender identity, and API configuration are still infrastructure prerequisites. This does **not** mean Resend is configured or operational.
- **D2 — Account-recovery scope:** S-09 includes only unauthenticated password reset and authenticated password change. Lost-email recovery, broader account recovery, and admin/support credential overrides are explicitly excluded.
- **D3 — Admin/support override:** no admin/support password override in S-09. Any future privileged recovery mechanism requires a separate security review and explicit authorization.
- **D4 — Session behavior:** authenticated password change verifies the current password, updates the password securely, rotates the session performing the change, and revokes all other active sessions, atomically where supported; unauthenticated password reset consumes the reset token exactly once, updates the password securely, revokes all existing sessions, and requires the user to log in again; use existing S-14 primitives; do not modify S-14.
- **D5 — Demo/pilot safety:** seeded demo-account recovery remains disabled until a separate demo-account policy is approved; S-06 and S-15 safeguards are preserved; shared demo credentials must not be exposed through email or recovery flows.

Distinction recorded:
- All five product-design decisions are approved.
- Infrastructure readiness is **not** approved and is **not** complete.
- S-09 remains **BLOCKED BY INFRASTRUCTURE**.
- This approval is a product decision record. It is **not** implementation authorization.

---
