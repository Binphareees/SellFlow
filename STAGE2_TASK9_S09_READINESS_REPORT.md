# S-09 Implementation-Readiness Review — Stage 2 Task 9

**Finding:** S-09 — No password reset or change flow
**Stage:** 2 — Task 9
**Review type:** READ-ONLY implementation-readiness investigation
**Date:** 2026-11-09
**Status of S-09:** Open (not started)
**Related accepted findings preserved:** S-12 (accepted), S-14 (accepted)
**Purpose:** Establish what S-09 actually requires, what already exists, what is missing, and what a minimal implementation would look like — without implementing anything.

---

## 1. The original finding and its source

### 1.1 Finding as stated in the audit reports

**S-09 — MEDIUM: no password reset or change flow**
- Source 1 — `SELLFLOW_V02_AUDIT_REPORT.md` § “S-09 — MEDIUM: no password reset or change flow”:
  - Files: none (absent)
  - Problem: There is no reset-token model, no reset route, and no change-password endpoint.
  - Impact: Users who forget a password are permanently locked out; support must edit the database. This is a pilot blocker.
  - Correction: Add a single-use, expiring reset token (hashed at rest), a reset route, and an authenticated change-password route that revokes other sessions.
- Source 2 — `STAGE1_ARCHITECTURE_REPORT.md` § S-09:
  - Files: `src/app/api/auth/**`, `src/components/auth-forms.tsx`
  - Problem: No password reset, change or recovery route or UI
  - Classification: [C] (completeness, not a vulnerability — no handler exists, so there is nothing to exploit)
  - Impact: a user who forgets the password is locked out permanently
  - Severity: High (product-blocking)
  - Correction: token-based reset (single-use, hashed, short TTL), change-password for signed-in users, session revocation on change; requires an email transport decision
  - Acceptance criteria: reset token single-use + expiry; old sessions revoked; wrong token 400
- Source 3 — `PRD_V0.2.md` § AR-12:
  - Requirement: “Provide password reset/change and account recovery.”
  - Source status: **Source gap** — “Not specified in available text; not implemented”

### 1.2 What S-09 is, and what it is not

S-09 is **an account-recovery completeness finding**, not a vulnerability. There is no password-reset or password-change surface in the application at all, so there is no vulnerable handler to exploit. The risk is operational: a legitimate user who forgets their password has no self-service recovery path, and the only current recovery mechanism is a privileged operator editing the database directly.

This matters more in context because:
- The seeded demo accounts (admin, mediator, supplier, reseller) all share a documented password (`Password123!` in seed.ts).
- `S-06` (demo credentials published) remains open.
- `S-07` (email verification) remains open.
- `S-13` (mediator authorization) remains open.
- `S-15` (verification-tier authorization) remains open.

So S-09 is both a standalone recovery gap and a dependency for safe credential hygiene in a seeded/test environment.

### 1.3 PRD sourcing caveat

AR-12 is marked as a **source gap** in the requirements register (`PRD_V0.2.md`). That means:
- The implemented requirement is “password reset/change and account recovery” as summarized from the audit correction, not a verbatim approved PRD clause.
- Any implementation that adds more than the audit’s stated minimum (single-use expiring reset token, hashed at rest; authenticated change-password; session revocation on change) should be treated as a product decision, not as “satisfying AR-12 exactly,” unless the approved PRD text is supplied and says otherwise.
- The absence of an approved PRD text is itself an input to the readiness decision, not something this review can resolve.

---

## 2. Current implementation state

### 2.1 What exists today

| Concern | Current state |
|---|---|
| Password hashing | `src/lib/auth/password.ts`: bcrypt, cost 12; `hashPassword`, `verifyPassword`; `PASSWORD_RULES { min: 8, max: 100 }` |
| Registration | `POST /api/auth/register` creates `User → Profile → BUSINESS_OWNER role → BusinessWorkspace` in one transaction; password hashed at create time |
| Login | `POST /api/auth/login` verifies with `verifyPassword`; throttled via S-05; issues a session; rotates any prior session for the same account |
| Session lifecycle | S-14 implemented: absolute + idle expiry, rotation on login and privilege change, revocation primitives, inventory |
| Change-password | **Does not exist** |
| Reset-token model | **Does not exist** — no `PasswordResetToken` table, no reset route, no reset UI |
| Email transport | **Does not exist** — no mail sender, no email service wired up |
| Recovery/admin override | **Does not exist as a route** — only direct database editing (outside the app) |
| Frontend auth UI | `LoginForm`, `RegisterForm` in `src/components/auth-forms.tsx`; login page at `src/app/login/page.tsx`; register page at `src/app/register/page.tsx`; no “forgot password” link anywhere |

### 2.2 Verified absence

I confirmed the absence by inspection, not by assumption:
- `src/app/api/auth/` contains exactly four route trees: `login`, `logout`, `me`, `register`, plus the S-14 `sessions` tree. There is no `forgot-password`, `reset-password`, `change-password`, or `recover` route tree.
- `src/lib/auth/password.ts` has hashing/verification and length rules only. There is no reset-token generation, storage, hashing, validation, or invalidation helper.
- `src/lib/auth/session.ts` and `src/lib/auth/revocation.ts` contain session primitives including `revokeAllSessionsForUser`, but there is no caller using them for a password-change flow, because that flow does not exist.
- `src/components/auth-forms.tsx` contains `LoginForm` and `RegisterForm` only. The login form’s footer links only to `/register`; there is no “Forgot password?” link.
- `src/app/login/page.tsx` renders `LoginForm` with no recovery link.
- `src/app/register/page.tsx` renders `RegisterForm` with no recovery link.
- `grep -rln` across `src/` for `forgot`, `reset password`, `changePassword`, `change.password`, and `Recovery` returns only unrelated matches (marketplace-discovery/dispute/supplier/workspace action components, throttle, audit, login route, disputes page). None of those is a password-recovery path.

So the finding’s “Files: none (absent)” is accurate and current.

---

## 3. Confirmed vulnerabilities vs. unverified assumptions

### 3.1 Confirmed facts (not assumptions)

1. **No password reset/change exists.** This is the finding. It is a completeness gap, not an exploitable vulnerability.
2. **Permanent lockout is the realistic operational consequence for a legitimate user.** With no recovery path, a forgotten password can only be recovered by someone with direct database access who can overwrite `User.passwordHash`.
3. **The current auth primitives are capable of supporting a reset/change flow.**
   - `verifyPassword` and `hashPassword` exist.
   - Session revocation primitives exist and are already used by S-14.
   - The app already has a pattern for single-use tokens and expiry in other domains (e.g., S-07’s verification-tier reasoning; S-14’s session expiry), though no password-reset token model exists yet.
4. **No email transport exists.** This is why both the architecture report and the audit correction say the flow “requires an email transport decision.” It is not implementable end-to-end without either a mail sender or an agreed substitute.

### 3.2 Unverified assumptions (must not be treated as confirmed)

1. **“Reset token should be emailed”** — this is the expected pattern, but the project has no email channel and no approved decision on how recovery links are delivered. I have not confirmed any email provider, SMTP, or transactional-mail decision. I have not chosen one.
2. **“Recovery should also cover account recovery without email”** — AR-12 says “password reset/change and account recovery,” but the approved text for that clause is a source gap, so the exact scope of “account recovery” is unverified.
3. **“Support/admin override should exist in the app”** — the finding says support currently must edit the database. Whether that should become an in-app admin action, and under what authorization, is a product/authorization decision, not something I can assert from the current code.
4. **“This is High severity”** — the architecture report marked it High (product-blocking). That is a reasonable assessment given pilot usability, but severity is a decision, and I have not independently re-rated it here; I report the prior classification and the reasoning behind it.

### 3.3 What is a vulnerability and what is not

- **Not a vulnerability:** the mere absence of reset/change. There is no attack surface here, only a missing recovery surface.
- **Real risk worth weighting:** because the seeded environment uses a known shared password (S-06), any recovery mechanism that lands must not weaken the demo-guard posture or accidentally expose a reset path against production-style targets. That is a sequencing/scope concern, not a current exploit.

---

## 4. Affected components and flow trace

### 4.1 Components that any S-09 implementation would touch

| Area | Likely-affected files/functions | Role in a reset/change flow |
|---|---|---|
| Password primitives | `src/lib/auth/password.ts` (`hashPassword`, `verifyPassword`, `PASSWORD_RULES`) | Hash new password; verify current password for change flow |
| Session primitives | `src/lib/auth/session.ts`, `src/lib/auth/revocation.ts` (`revokeAllSessionsForUser`, `revokeOwnedSession`, `rotateSessionForUser`, etc.) | Revoke other sessions on password change (explicitly called out by the finding and by S-14’s design) |
| Auth routes (new) | New handlers under `src/app/api/auth/` (e.g. `forgot-password`, `reset-password`, `change-password`) — none exist today | Receive requests, validate tokens/ passwords, orchestrate reset-token lifecycle, issue new session/revoke old |
| DB model (new) | New Prisma model for reset token — none exists today | Persist single-use expiring reset token, hashed at rest |
| Migration (new) | New migration adding the reset-token model — none exists today | Schema change for the token store |
| Frontend auth pages | `src/app/login/page.tsx`, `src/components/auth-forms.tsx`, possibly a new reset/change page | “Forgot password?” link; reset-form page; change-password form for signed-in users |
| Demo/seed guard interaction | `prisma/seed.ts`, `scripts/seed-guard.ts`, `scripts/db-reset.ts` | Any reset/change feature must coexist with the S-15 demo-seed guard and the shared-demo-password concern from S-06; in particular, a seeded dev environment must not expose production-style recovery behavior that implies an email channel that does not exist |

### 4.2 How the pieces fit together (logical flow, not yet implemented)

**Forgot-password / reset-request flow (unauthenticated):**
1. User submits email to a reset-request endpoint.
2. Server looks up whether that email exists.
3. Server creates/resets a single-use, short-TTL reset token for that account; token is hashed at rest.
4. Server delivers the reset link/token to the user through whatever recovery channel is chosen (email, or a placeholder/dev path). This step is the open transport decision.
5. Reset-request endpoint returns the same message regardless of whether the email existed, to avoid account enumeration (this is the standard non-enumeration property and matches the existing login-throttle posture from S-05).

**Reset-password flow (unauthenticated, token-bound):**
1. User submits the token plus a new password.
2. Server validates the token: exists, unexpired, unused, and matches the hashed token on record.
3. On success, server hashes the new password, writes it, and invalidates the token (single-use).
4. Server revokes other sessions for that account (this is the explicit S-14-aligned requirement from the finding), and possibly leaves the requesting session’s handling as a product decision.
5. On failure (malformed, expired, already used, wrong user, bad password), server returns a generic error and does not reveal which.

**Change-password flow (authenticated):**
1. Signed-in user submits current password + new password.
2. Server verifies current password with `verifyPassword`.
3. On success, server hashes new password, writes it, invalidates the used reset/token if any, and revokes other sessions for that account (S-14-aligned).
4. On failure, generic error, no enumeration.

This is the shape implied by the audit correction and the architecture report. It is not yet implemented anywhere.

---

## 5. Interactions with S-14 session lifecycle primitives

S-14 is directly relevant to S-09 in one specific, already-agreed way: **a password change should revoke other sessions for the affected account.** That is called out both in the audit correction and in the S-14 design.

### 5.1 What S-14 gives S-09 for free

- `revokeAllSessionsForUser(userId, client?)` exists in `src/lib/auth/revocation.ts`.
- `revokeOwnedSession`, `revokeOtherSessionsForUser`, `revokeSessionByToken`, `listSessionsForUser`, and `pruneSessions` exist.
- `rotateSessionForUser` exists for the case where the change should also issue a fresh session to the actor.
- The S-14 atomicity pattern (do the privilege-affecting write and the revocation in the same transaction where possible) is established and tested.

### 5.2 The S-14 interaction that matters for S-09

When a password is changed:
- The old password is no longer valid for future logins (that is the point).
- Any session that was issued before the change remains valid only until its own expiry/idle/revocation. The finding explicitly wants **other sessions revoked on change**, so the post-change state is not “old sessions keep working until they expire.”
- The right primitive is `revokeAllSessionsForUser` for the affected account, with the actor’s session handled according to the product decision (issue a fresh one, or sign the actor out and force re-login with the new password).

### 5.3 What is not automatic

- S-14 does not create a password-change flow. It only provides the session-revocation building blocks.
- S-14 does not decide whether a password-change request should also rotate the actor’s session or force re-login. That is a flow decision for S-09.
- S-14 does not provide reset tokens. That is new storage and new lifecycle logic.

So the S-14 dependency is real but small: S-09 will call existing S-14 primitives rather than introducing a competing session-revocation mechanism. That is good for consistency and is exactly what the finding asked for.

---

## 6. Previous remediation status

There is **no partial S-09 remediation** anywhere in the codebase.

- I found no reset-token model, no reset/change routes, no reset UI, and no password-change logic.
- I found no earlier attempt that was abandoned halfway.
- The auth-related route tree is exactly what I listed in §2.1.
- The only “admin profile” route that exists is `PATCH /api/admin/profiles/{id}/verification`, which is about verification tier, not password.

So S-09 is entirely open. The readiness question is not “is the existing partial fix complete?” but “what is the smallest correct implementation, and what decisions must be made first?”

---

## 7. Minimal implementation plan

This is a plan, not an implementation. It stays minimal and tied to the finding.

### 7.1 Decisions required before implementation

1. **Recovery delivery channel.** How does a user receive a reset token/link? Options include:
   - Email (requires an email sender / transactional-mail decision and an account for it).
   - A temporary dev-only substitute for local/pilot use (for example, a logged reset token or a CLI-visible token) until email is wired.
   - Some other out-of-band channel.
   This is not a technical trivia choice; it determines whether S-09 can even be completed, and whether the completed flow is pilot-safe.
2. **Account-recovery scope.** AR-12 says “password reset/change and account recovery.” The exact meaning of “account recovery” is a source gap. Before implementing, decide whether “recovery” means only password reset/change, or also account recovery without email access, or admin-initiated recovery.
3. **Admin override.** Should there be an in-app support/admin path to force a password reset or recovery? If so, under what authorization, and with what audit trail? This interacts with S-13 (mediator/admin authorization) and S-15 (verification-tier authorization) and should not be invented ad hoc.
4. **Enumeration posture.** The reset-request endpoint should not reveal whether an email exists. That is the standard safe choice and matches the existing login posture, but it should be an explicit decision, not an accident.
5. **Token model and TTL.** Single-use, expiring, hashed at rest, with a specific TTL — values for TTL and reuse behavior should be chosen explicitly.
6. **Post-change session behavior.** On password change, should the actor’s current session stay valid, be replaced, or be revoked with a forced re-login? The finding says “other sessions revoked”; it does not fully specify the actor’s own session.
7. **Demo/pilot safety.** Any implementation must remain compatible with the S-15 seed guard and must not make the shared demo password easier to attack or easier to recover in a way that undermines the demo-guard intent. This is especially relevant because S-06 is still open.

### 7.2 Implementation pieces, in dependency order

1. **Reset-token model + migration.**
   - A new model for a single-use expiring reset token, hashed at rest, tied to a user, with created-at/expiry/used-at semantics.
   - An additive migration only if this is the first version; schema change is required because no token store exists today.
2. **Reset-token library helpers.**
   - Generate, store (hashed), look up, validate (exists + unexpired + unused + hash match), consume (single-use), and invalidate.
3. **Reset-request route (unauthenticated).**
   - Accept email, find or create a reset token, invalidate any existing unused token for that account, and deliver the token through the chosen channel.
   - Return the same response whether or not the email exists.
4. **Reset-password route (unauthenticated, token-bound).**
   - Validate token, validate new password against rules, write new hash, consume token, revoke other sessions, and choose actor-session behavior.
5. **Change-password route (authenticated).**
   - Verify current password, validate new password, write new hash, revoke other sessions, choose actor-session behavior.
6. **Frontend.**
   - Add “Forgot password?” to the login flow.
   - Add a reset-form page and a change-password page (for signed-in users).
7. **Tests (isolated, security-oriented).**
   - See §8.

### 7.3 What is intentionally not in the minimal plan

- Email delivery implementation details (that is a separate integration decision).
- Full “account recovery” beyond password reset/change, unless and until AR-12’s scope is clarified.
- Any billing/entitlement/C-03 interaction.
- Any modification to S-12 or S-14.
- Any change to the demo seed password itself (that is part of S-06, not S-09, though the two should be resolved together before pilot).

---

## 8. Isolated security tests and acceptance criteria

### 8.1 Test environment

All S-09 security tests should run in the existing isolated harness pattern used by S-01, S-12, and S-14:
- Isolated temporary database, not `prisma/dev.db`.
- Production build, typecheck, and full suite green.
- `prisma/dev.db` fingerprint unchanged before and after.
- No production database touched.

### 8.2 Core security assertions

**Reset-request enumeration resistance:**
- Requesting a reset for a known existing email and for a nonexistent email returns the same public responseshape / status, so an attacker cannot enumerate registered emails from the reset endpoint alone.

**Reset-token lifecycle:**
- A valid reset token allows one password reset and is single-use afterward.
- An expired token is rejected.
- A used token is rejected.
- A malformed/tampered token is rejected.
- A token for one account cannot be used against another account.
- The stored token is hashed at rest, so a database read of the token table does not reveal usable tokens.

**Password-change (authenticated):**
- A signed-in user can change their password with the correct current password.
- A signed-in user cannot change the password with a wrong current password.
- After a password change, the old password no longer authenticates.
- After a password change, other sessions for that account are revoked (S-14-aligned).
- New-password rules are enforced (length, etc., matching `PASSWORD_RULES`).

**Forgot-password → reset → login chain:**
- The full chain works end to end in the isolated harness: request reset, use token, set new password, log in with new password.
- The old password fails after reset.

**Enumeration and abuse resistance:**
- Repeated reset requests do not leak account existence.
- Reset-token creation/consumption does not create a timing or response-difference vector that reveals whether an account exists.

### 8.3 Acceptance criteria

1. There is a reset-request endpoint and a reset-password endpoint, plus a change-password endpoint for authenticated users.
2. Reset tokens are single-use, expiring, and hashed at rest.
3. Reset request does not reveal whether the email exists.
4. A successful password reset invalidates the token and revokes other sessions for the account.
5. A successful authenticated password change revokes other sessions for the account.
6. After any password change, the previous password no longer authenticates.
7. New passwords obey the existing password rules.
8. No reset/change path exists that bypasses authentication or token validation.
9. The demo/seed guard and the shared-password concern from S-06 are not made worse by the new flow.
10. S-12 and S-14 remain intact and accepted; no billing/entitlements/C-03 changes.

### 8.4 What I did not verify by running

I did not run the harness for S-09 in this review, because there is nothing to run yet — the routes and model do not exist. The test plan above is the target state for when implementation is authorized.

---

## 9. Risk classification and readiness verdict

### 9.1 Classification

- **Type:** Completeness / account-recovery gap.
- **Exploitability today:** None — there is no reset/change surface to exploit.
- **Operational impact:** High for a real user who forgets a password; product-blocking for a pilot where participants need a recovery path.
- **Severity memory:** architecture report says High (product-blocking); V02 audit says Medium with pilot-blocker impact. The difference is severity framing, not a disagreement about the underlying gap.

### 9.2 Readiness verdict

S-09 is **not implementable yet as a complete end-to-end flow**, because the recovery delivery channel and the recovery-scope decision are unresolved, and there is no email transport. The backend primitives and patterns needed are mostly present (password hashing, session revocation, atomicity patterns), and the shape of the flow is clear, but the gating decisions in §7.1 must come first.

So:
- **Implementation-ready pieces:** reset-token model design, token lifecycle helpers, reset-request/reset-password/change-password route shapes, session-revocation integration with S-14, test assertions.
- **Not yet decided:** delivery channel, recovery scope, admin override, actor-session behavior on change, exact token TTL, demo/pilot safety treatment relative to S-06.

### 9.3 No implementation this turn

I made no source, schema, migration, dependency, test, or configuration changes. I did not touch S-12 or S-14. I did not modify the production database. Phase 0 remains incomplete.

---

## 10. Deliverable files

- This report: `STAGE2_TASK9_S09_READINESS_REPORT.md`
- No other files were created or modified in this review.

---

## Appendix A. Sources inspected

- `SELLFLOW_V02_AUDIT_REPORT.md` — S-09 finding and impact.
- `STAGE1_ARCHITECTURE_REPORT.md` — S-09 classification, files, correction, acceptance criteria.
- `PRD_V0.2.md` — AR-12 source-gap record and surrounding auth/account-model context.
- `STATE.md` — S-09 listed as Open; context among other findings and decisions.
- `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/revocation.ts`, `src/lib/auth/throttle.ts` — existing auth/session primitives.
- `src/app/api/auth/**` — current auth route tree.
- `src/components/auth-forms.tsx`, `src/app/login/page.tsx`, `src/app/register/page.tsx` — current auth UI.
- `src/server/accounts.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/register/route.ts` — registration/login flow context.
- `scripts/verify-api.mjs` — existing test structure and helper patterns.

---

*End of S-09 implementation-readiness review. Awaiting explicit authorization before any implementation.*
