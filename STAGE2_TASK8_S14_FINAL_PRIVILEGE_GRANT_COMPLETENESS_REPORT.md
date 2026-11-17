# S-14 Final Privilege-Grant Completeness Review

**Finding:** S-14 — Session Lifecycle Security
**Review type:** Final READ-ONLY privilege-grant path completeness review
**Date:** 2026-11-09
**Status of S-14:** Already implemented and accepted (2026-11-06). This review does not reopen it.
**Purpose:** Verify that every privilege-grant path in the codebase performs the privilege change, its required audit write, session rotation/revocation, and transactional atomicity — and determine whether any path was missed by the prior S-14 review.

---

## 1. Scope of this review

I inventoried **every code path that creates, changes, or activates a privilege, role, or verification tier** across:

- API routes under `src/app/api/`
- Server functions under `src/server/`
- Session/auth primitives under `src/lib/auth/`

I excluded:
- Reads, listings, order operations, payment claims, disputes, stock/dispatch/delivery, proposals (unless they grant a privilege), billing/subscriptions/entitlements/C-03, and password change (S-09, does not exist yet).
- Anything that **records** an existing role but does not **grant** one.

---

## 2. Complete privilege-grant path inventory

### Path 1 — Registration

- **File / function:** `src/server/accounts.ts` — `registerAccount()`; consumed by `src/app/api/auth/register/route.ts`
- **Privilege granted:** `ROLE.BUSINESS_OWNER` via `profileRole.create`
- **Audit present:** Yes — `auditCritical(AUDIT.REGISTER, ...)` inside the same transaction
- **Session rotation:** N/A — registration creates a brand-new account and issues its first session; there is no prior session for that account to revoke. The register route calls `startSession()` and applies the cookie; it does not call `revokeCurrentSession()`, which is correct because nothing exists to revoke.
- **Atomic:** Yes — user, profile, `BUSINESS_OWNER` role, workspace, and the REGISTER audit row all commit in one `prisma.$transaction`. A failed audit write rolls the whole registration back (this is the S-12 guarantee, verified separately).
- **Existing test coverage:** S-12 registration assertions; S-15 registration/seed tests.
- **Gap:** None. Registration is a first-session creation path, not a privilege-escalation path, so rotation is not applicable.

### Path 2 — Login

- **File / function:** `src/app/api/auth/login/route.ts` — `POST` handler
- **Privilege granted:** None. Login verifies credentials and creates a session; it does not grant any role.
- **Audit present:** Yes — `audit(AUDIT.LOGIN, ...)` (non-critical) after the session is created.
- **Session rotation:** Yes — `revokeCurrentSession()` runs **before** `startSession()`, so a stale/planted cookie cannot survive the login. This is the S-14 login-rotation fix.
- **Atomic:** Not applicable as a privilege change; the relevant property is ordering (revoke old, create new, apply cookie after), which is correct.
- **Existing test coverage:** S-05 login/throttle tests; S-14 “signing in revokes the session token presented with the login” test.
- **Gap:** None.

### Path 3 — Self-service role activation

- **File / function:** `src/server/supplier.ts` — `grantRole()` (called via `ensureRole()`); consumed by `src/app/api/profile/roles/route.ts`
- **Privilege granted:** `ROLE.RESELLER` (the route rejects `ROLE.SUPPLIER` and `ROLE.MEDIATOR`)
- **Audit present:** Yes — `grantRole()` / `ensureRole()` write `auditCritical(AUDIT.ROLE_GRANTED, ...)` **only when the row is actually created**, through the caller-supplied client.
- **Session rotation:** Yes — `rotateSessionForUser(ctx.user.id, sessionMeta(request), tx)` inside the same `prisma.$transaction`, only when the grant actually happens. Cookie applied after commit.
- **Atomic:** Yes — the grant, its ROLE_GRANTED audit, and the session rotation share one transaction. A failed audit write or failed rotation rolls the grant back; the old session stays valid. This was the subject of the S-14 final review.
- **Existing test coverage:** S-14 atomicity tests (“a failed revocation rolls the role grant back”; “the role grant commits and rotates once revocation works”).
- **Gap:** None.

### Path 4 — Supplier profile creation (activates SUPPLIER)

- **File / function:** `src/server/supplier.ts` — `ensureSupplierProfile()`; consumed by `src/app/api/supplier/profile/route.ts`
- **Privilege granted:** `ROLE.SUPPLIER`, only when the profile is newly created. Editing an existing profile does **not** rotate and does not re-grant.
- **Audit present:** Yes — on creation, `ensureSupplierProfile()` writes `auditCritical(AUDIT.ROLE_GRANTED, ...)` (with `entityType: "SupplierProfile"`) through the caller-supplied client. The concurrency-safe create-first pattern applies here too.
- **Session rotation:** Yes — `rotateSessionForUser(ctx.user.id, sessionMeta(request), tx)` inside the same transaction, but **only when `activated: true`**.
- **Atomic:** Yes — profile creation, SUPPLIER role creation, ROLE_GRANTED audit, and session rotation are all inside one `prisma.$transaction` in the route.
- **Existing test coverage:** S-14 atomicity tests (“a failed revocation rolls supplier activation back”; “supplier activation commits and rotates once revocation works”).
- **Gap:** None.

### Path 5 — Admin-driven verification tier change

- **File / function:** `src/server/accounts.ts` — `setVerificationTier()`; consumed by `src/app/api/admin/profiles/[id]/verification/route.ts`
- **Privilege granted:** Verification-tier elevation (0→1, 1→2, 2→3, etc.). This is an authorization-relevant change, so S-14 treats it as a privilege change.
- **Audit present:** Yes — `auditCritical(AUDIT.TIER_CHANGED, ...)` inside the same transaction.
- **Session rotation:** Yes — `setVerificationTier()` runs `tx.session.updateMany(...)` to revoke every live session of the affected account **inside the same transaction** as the tier update, verification event, and audit. If the admin elevated their own profile, the route then issues a replacement session after commit via `rotateSessionForUser()`.
- **Atomic:** Yes — tier update, verification event, TIER_CHANGED audit, and revocation of all target sessions commit or roll back together. This was the subject of the S-14 final review.
- **Existing test coverage:** S-14 atomicity tests (“a failed revocation rolls the tier change back”; “the tier change commits and revokes once revocation works”; “a tier change leaves the acting administrator signed in”).
- **Gap:** None.

### Path 6 — Supplier approves a reseller application

- **File / function:** `src/server/supplier.ts` — `decideApplication(..., decision: "APPROVED")`; consumed by `src/app/api/supplier/applications/[id]/route.ts`
- **Privilege granted:** None directly by the approval itself. The approval creates the agreement shell + version 1 (PENDING_ACCEPTANCE). The reseller already obtained RESELLER when they submitted the application (Path 7) or activated it via Path 3.
- **Audit present:** Yes — `audit(AUDIT.APPLICATION_DECIDED, ...)` and `audit(AUDIT.AGREEMENT_CREATED, ...)` after the transaction (non-critical).
- **Session rotation:** Yes — `decideApplication()` revokes the applicant’s sessions **inside its transaction** via `tx.session.updateMany(...)` when `applicant` is found.
- **Atomic:** Yes — application status update, agreement upsert, agreement version create, agreement current-version repoint, and applicant-session revocation all commit or roll back together. This was the subject of the S-14 final review.
- **Existing test coverage:** S-14 atomicity tests (“a failed revocation rolls the application approval back”; “approval commits and revokes the applicant once revocation works”).
- **Gap:** None. Approval is not itself a privilege grant; it revokes the applicant’s sessions as a precaution, which is the correct choice.

### Path 7 — Submit application (may grant RESELLER for the first time)

- **File / function:** `src/server/supplier.ts` — `submitApplication()` → `ensureRole(resellerProfileId, ROLE.RESELLER, ...)`; consumed by `src/app/api/marketplace/applications/route.ts`
- **Privilege granted:** `ROLE.RESELLER`, only when the role does not already exist. If the reseller already has RESELLER, `roleGranted` is false and nothing rotates.
- **Audit present:** Yes — two audits: `auditCritical(AUDIT.ROLE_GRANTED, ...)` from `ensureRole()` (transactional, inside the route’s client) and `audit(AUDIT.APPLICATION_SUBMITTED, ...)` (non-critical). The ROLE_GRANTED audit is the security-critical one.
- **Session rotation:** Yes — `rotateSessionForUser(ctx.user.id, sessionMeta(request), tx)` inside the same transaction, but **only when `roleGranted` is true**. Cookie applied after commit.
- **Atomic:** Yes — application create/update, RESELLER role creation (if needed), ROLE_GRANTED audit, and session rotation all share one transaction. A failed audit write or failed rotation rolls the submission back; the old session stays valid. This was the subject of the S-14 submit-application review.
- **Existing test coverage:** S-14 audit-durability test (“a failed ROLE_GRANTED audit write rolls the role grant back”; “the ROLE_GRANTED grant commits and rotates once the audit store is healthy”); S-14 submit-application tests (“a failed revocation rolls the application grant back”; “a first application grants RESELLER, audits it and rotates once”; “an application that grants no new role rotates nothing”).
- **Gap:** None.

### Path 8 — Accept agreement

- **File / function:** `src/server/supplier.ts` — `acceptAgreement()`; consumed by `src/app/api/reseller/agreements/[id]/accept/route.ts`
- **Privilege granted:** None. Accepting makes the agreement ACTIVE and records `acceptedByResellerAt`, but the reseller must already have RESELLER (from Path 3 or Path 7) and must already be a party to the agreement.
- **Audit present:** Yes — `audit(AUDIT.AGREEMENT_ACCEPTED, ...)` (non-critical).
- **Session rotation:** No — and this is correct, because no privilege changes.
- **Atomic:** Yes — version update + agreement status update in one transaction.
- **Existing test coverage:** S-10 agreement-acceptance tests.
- **Gap:** None. This is not a privilege-grant path.

### Path 9 — Add agreement version (supplier re-prices)

- **File / function:** `src/server/supplier.ts` — `addAgreementVersion()`; consumed by `src/app/api/supplier/agreements/[id]/versions/route.ts`
- **Privilege granted:** None. This is a Supplier Pro re-pricing control; it creates a new agreement version and sets status back to PENDING_ACCEPTANCE.
- **Audit present:** Yes — `audit(AUDIT.AGREEMENT_VERSION, ...)` (non-critical).
- **Session rotation:** No — correct, no privilege change.
- **Atomic:** Yes — version create + agreement update in one transaction.
- **Existing test coverage:** S-10 agreement-versioning tests.
- **Gap:** None. Not a privilege-grant path.

### Path 10 — Negotiation proposals (create / accept)

- **File / function:** `src/server/supplier.ts` — `createProposal()` and `acceptProposal()`; consumed by `src/app/api/agreements/[id]/proposals/route.ts` (and the accept route)
- **Privilege granted:** None. `createProposal()` records `proposedByRole` (ROLE.SUPPLIER or ROLE.RESELLER) but this is a **record of an existing role**, not a grant — the proposer must already be a party to the agreement (i.e., already have the relevant profile/role). `acceptProposal()` creates a new agreement version from a proposal; the reseller already has RESELLER.
- **Audit present:** Yes — `audit(AUDIT.PROPOSAL_CREATED, ...)` and the proposal-acceptance audit (non-critical).
- **Session rotation:** No — correct, no privilege change.
- **Atomic:** Yes — each function’s writes commit in one transaction.
- **Existing test coverage:** S-10 negotiation/proposal tests.
- **Gap:** None. These are not privilege-grant paths; they require existing privileges.

---

## 3. Privilege-grant paths — summary matrix

| # | Path | Privilege | Audit | Rotation | Atomic | Covered by |
|---|---|---|---|---|---|---|
| 1 | Registration | BUSINESS_OWNER | Yes (REGISTER, critical) | N/A (first session) | Yes | S-12 / S-15 |
| 2 | Login | None | Yes (LOGIN) | Yes (login rotation) | N/A | S-05 / S-14 |
| 3 | Self-service RESELLER activation | RESELLER | Yes (ROLE_GRANTED, critical) | Yes | Yes | S-14 |
| 4 | Supplier profile creation | SUPPLIER (on create only) | Yes (ROLE_GRANTED, critical) | Yes (on activation only) | Yes | S-14 |
| 5 | Admin tier change | Verification tier | Yes (TIER_CHANGED, critical) | Yes (target sessions revoked) | Yes | S-14 |
| 6 | Application approval | None (revokes applicant sessions) | Yes (APPLICATION_DECIDED, AGREEMENT_CREATED) | Yes (applicant sessions) | Yes | S-14 |
| 7 | Submit application | RESELLER (if not already held) | Yes (ROLE_GRANTED critical + APPLICATION_SUBMITTED) | Yes (if role granted) | Yes | S-14 submit-app review |
| 8 | Accept agreement | None | Yes (AGREEMENT_ACCEPTED) | No (correct) | Yes | S-10 |
| 9 | Add agreement version | None | Yes (AGREEMENT_VERSION) | No (correct) | Yes | S-10 |
| 10 | Create/accept proposal | None | Yes (PROPOSAL_CREATED / accept audit) | No (correct) | Yes | S-10 |

**Every privilege-grant path (1, 3, 4, 5, 7) is already covered by S-14.** Paths 6, 8, 9, 10 are not privilege grants and correctly do not rotate; Path 2 is a session-creation path that already rotates the old session.

---

## 4. Were any privilege-grant paths missed by the prior S-14 review?

**No.**

The prior S-14 review corpus covered:
- Self-service role activation (Path 3)
- Supplier profile creation (Path 4)
- Admin tier change (Path 5)
- Application approval (Path 6)
- Submit-application RESELLER grant (Path 7)

The only remaining path that grants a privilege is **registration (Path 1)**, which grants `BUSINESS_OWNER`. Registration was always out of scope for “session rotation on privilege escalation” because it issues the account’s first session — there is no pre-existing session to revoke. It is still fully atomic and fully audited (S-12), so it satisfies the same safety properties by construction.

The prior S-14 corpus also documented, as explicitly **not** privilege grants, the agreement and negotiation flows that I re-confirmed here (Paths 8, 9, 10). They record roles or require existing roles; they do not grant them.

---

## 5. Edge case examined: registration not rotating

A reader might ask whether `POST /api/auth/register` should revoke any existing session the way login does. It should not, and here is why:

- Registration creates a **new** user with a **new** email that does not yet exist. The new account has no sessions at all before this request.
- If the requestor is already signed in as a **different** account, that is a different user id and a different set of sessions; registration does not and should not touch another account’s sessions.
- There is therefore no “stale session for the same account” that could survive registration. The new `startSession()` session is the only session for that account.

This is the correct behavior. The S-14 login-rotation fix (Path 2) exists precisely because login can be called when an old session for the **same** account already exists.

---

## 6. The one conceptual nuance worth recording

`decideApplication()` (Path 6) revokes the **applicant’s** sessions even though approval itself does not grant a new privilege — the RESELLER grant already happened at submit time (Path 7) or self-activation time (Path 3). That design choice is sound: it prevents any existing applicant session from outliving the moment the applicant becomes an approved (though not yet ACTIVE) reseller with a live agreement shell. It is not missing coverage; it is a conservative, correct revocation. The same applies to supplier-profile creation (Path 4), which revokes on activation even though the account already had BUSINESS_OWNER.

---

## 7. Conclusion

**No privilege-grant path was missed.**

- All privilege-grant paths (registration, self-service RESELLER activation, supplier-profile SUPPLIER activation, admin verification-tier change, submit-application RESELLER grant) perform the change, the required audit write, and session rotation/revocation, and they do so atomically inside a transaction.
- The non-privilege-grant flows (accept agreement, add agreement version, create/accept negotiation proposal, application approval’s direct effect) correctly do not rotate, and they are still atomic and audited.
- Registration correctly does not rotate because it issues the first session; login correctly rotates because it may supersede an existing session.

**No gap exists.** No reproduction evidence is provided because nothing is broken. No correction is proposed.

---

## 8. Scope compliance

- READ-ONLY. No source, schema, migration, dependency, test, or configuration was changed.
- No S-09 work; no password-change flow touched.
- No billing, entitlements, or C-03 touched.
- Accepted S-12 and S-14 implementations preserved.
- Production data not modified; `prisma/dev.db` not opened for writing in this review.
- Phase 0 remains incomplete; this review is not validation approval.

---

*Stopping. No implementation changes made. Awaiting explicit authorization before any implementation.*
