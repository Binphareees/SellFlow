# SellFlow — Stage 2, Task 6A: S-07 (Registration Verification Tier) Report

**Date:** 2026-11-04
**Scope:** S-07 only. S-09, S-10, S-11, S-12 and S-14 were not started. No billing, entitlement, C-03, role-model, marketplace-pricing, email-delivery or password-recovery change. No schema or migration change. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

> **Status:** New accounts now start at verification tier 0 (`Unverified`). Registration no longer writes a false `0→1` verification event, no longer sets `tierUpdatedAt`, and no longer presents an unverified contact as “Contact verified.” Registration input cannot inject a tier or verification field, and ordinary self-service profile writes cannot elevate the identity tier. The existing platform-admin verification workflow still works, and reseller/supplier approval remains separate from identity verification. **No email or phone verification mechanism was implemented**; this report does not claim that email verification exists.

---

## 1. Original vulnerability and root cause

`registerAccount()` created every new profile with tier 1 and an accompanying verification event:

```ts
const profile = await tx.profile.create({
  data: {
    userId: user.id,
    displayName: input.displayName,
    phone: input.phone ?? null,
    country: input.country,
    verificationTier: 1, // email is verified by the account itself; business checks move this up
    tierUpdatedAt: new Date(),
  },
});

await tx.verificationEvent.create({
  data: {
    profileId: profile.id,
    fromTier: 0,
    toTier: 1,
    reason: "Account created",
  },
});
```

The comment asserted that “email is verified by the account itself,” but no email or phone challenge occurred. `User.emailVerifiedAt` was left `NULL`, and no verification token, delivery, callback or confirmation step existed anywhere in the codebase. The registration route also returned `verificationTier: 1` and `/api/auth/me` labelled it “Contact verified.”

The root cause is a **server-side trust assignment that was not backed by any completed check**. Tier 1 has a specific meaning (“contact verified”), but registration treated account creation as proof of contact ownership. The false state then propagated to:

- the registration response and `/api/auth/me`;
- reseller applications, which snapshot the tier at apply time;
- the supplier’s application view, which displays the reseller’s tier;
- any future feature that treats tier 1 as evidence of contact verification.

**What this was not:** no current authorization gate reads `Profile.verificationTier`. Role checks (`requireRole`, `requireSupplier`, `requireReseller`, `requireMediator`, `requirePlatformAdmin`) are role/admin based, and the only verification workflow is already platform-admin only. The vulnerability was a **false trust signal and false verification record**, not a direct privilege escalation. That distinction matters for the fix and for the remaining limitations.

---

## 2. Existing verification-tier meanings

The intended meanings come from `src/lib/enums.ts`, the Prisma comments, the Stage 1 report and the PRD:

| Tier | Label | Intended meaning | Who may grant it |
|---|---|---|---|
| 0 | `Unverified` | No contact or business check completed | Default / registration |
| 1 | `Contact verified` | Email or phone ownership has been verified | Authorised verification workflow |
| 2 | `Business reviewed` | Business details have been reviewed | Platform review |
| 3 | `Fully verified` | Documents have been verified | Platform review |

```ts
/** 0 = unverified, 1 = contact verified, 2 = business details reviewed, 3 = documents verified */
export const VERIFICATION_TIER = { TIER_0: 0, TIER_1: 1, TIER_2: 2, TIER_3: 3 } as const;
```

Related but **distinct** concepts:

- **`User.emailVerifiedAt`** — a timestamp on the account. It is `NULL` for every ordinary registration and is only set by the demo seed and the pilot onboarding CLI. It is not set by registration.
- **`SupplierProfile.verificationTier`** — a separate marketplace supplier display field used for the public supplier directory and storefront. It is not the account’s identity tier and is not updated by registration or self-service.
- **`ResellerApplication.verificationTierAtApply`** — an immutable snapshot of the reseller’s identity tier at application time. It is written once and never read for authorization.
- **`User.isPlatformAdmin`** — a separate platform-operations flag. It is not a verification tier.
- **`ProfileRole`** — marketplace roles (`BUSINESS_OWNER`, `RESELLER`, `SUPPLIER`, `MEDIATOR`). Roles are not verification.

Tier 2–3 require platform review. Tier 1 also requires a contact check in the intended model; because no email/phone challenge exists in this build, tier 1 must not be granted at registration or through self-service. It remains available only through the explicit admin workflow (and the operator-attested pilot seeder).

---

## 3. Every place verification status can be created, updated or influenced

### 3.1 Server-side writes

| Location | What it does | Status after S-07 |
|---|---|---|
| `src/server/accounts.ts → registerAccount()` | Created `Profile.verificationTier: 1`, `tierUpdatedAt`, and a `VerificationEvent 0→1` | **Fixed:** creates tier 0, no event, no `tierUpdatedAt` |
| `src/server/accounts.ts → setVerificationTier()` | Updates `Profile.verificationTier`, sets `tierUpdatedAt`, writes a `VerificationEvent` and an audit row | **Unchanged and preserved**; reachable only through the platform-admin route |
| `src/app/api/admin/profiles/[id]/verification/route.ts` | `PATCH` endpoint guarded by `requirePlatformAdmin()` | **Unchanged**; the only runtime elevation path |
| `prisma/seed.ts` | Direct fixture creation: supplier profile tier 2, reseller tier 1, mediator tier 3, admin tier 3; `SupplierProfile.verificationTier: 2`; application snapshot 1 | **Unchanged**; explicitly seeded onboarding fixtures, not ordinary registration |
| `scripts/seed-pilot.mjs` | Operator CLI creates pilot profiles with an operator-chosen tier, sets `emailVerifiedAt`, and writes a verification event when tier > 0 | **Unchanged**; an operator-attested provisioning path, not public registration |

No other `Profile.verificationTier` write exists. A repository-wide search for `verificationTier:` and `verificationEvent.create` confirms the table above.

### 3.2 User-controlled input

| Input path | Can it influence the identity tier? | Why |
|---|---|---|
| `POST /api/auth/register` | **No** | `registerSchema` has no tier field. Zod strips unknown top-level and nested keys. The server always writes 0. |
| `POST /api/supplier/profile` | **No** | `supplierProfileSchema` has no tier field. It updates supplier business fields only, and `ensureSupplierProfile()` does not write `Profile.verificationTier` or `SupplierProfile.verificationTier`. |
| `POST /api/profile/roles` | **No** | `roleGrantSchema` has only `role`. It adds a role, never a tier. |
| `PATCH /api/admin/profiles/[id]/verification` | **Yes, but only as platform admin** | Guarded by `requirePlatformAdmin()`; validated by `verificationSchema` (0–3, reason, optional evidence). |
| Any generic profile update | **No such endpoint exists** | There is no `PATCH /api/profile` or `PUT /api/auth/me`; the only self-service profile writes are the supplier-profile and role routes above. |

### 3.3 Reads and displays

| Location | Use |
|---|---|
| `src/lib/auth/session.ts` / `getAuthContext()` | Returns the profile tier to authenticated callers |
| `POST /api/auth/login` | Returns the profile tier in the login response |
| `POST /api/auth/register` | Returns the newly created tier |
| `GET /api/auth/me` | Returns the tier and its `VERIFICATION_LABEL` |
| `src/app/api/marketplace/applications/route.ts` | Passes the tier into `submitApplication()` as a snapshot |
| `src/server/supplier.ts` supplier dashboard | Selects `resellerProfile.verificationTier` for display on applications |
| `src/server/price-access.ts` and marketplace pages | Read `SupplierProfile.verificationTier` (separate marketplace field), not `Profile.verificationTier` |

**Authorization dependency:** none. `Profile.verificationTier` is not compared with `>=` or `===` anywhere in authorization code. The only “reserved” verification action is the admin route, which is gated by `isPlatformAdmin`, not by tier. This is documented again in the limitations.

---

## 4. Failing baseline (recorded before implementation)

The 27 S-07 assertions were added to `scripts/verify-api.mjs` and run against the **unmodified application** through the isolated harness:

```text
npm run test:e2e:clean -- --skip-build
```

Result: **14 S-07 failures**, exit 1, 151.8 s. The API suite stopped before the PWA stage. The harness confirmed `prisma/dev.db` untouched (`sha256=522a35fcabbf`, size `589824`).

```text
FAIL  a newly registered account is unverified (S-07) — status 201, tier 1
FAIL  the stored profile is tier 0, not tier 1 (S-07) — tier 1
FAIL  registration writes no false 0→1 verification event (S-07) — 1 event(s)
FAIL  registration does not claim a tier-change timestamp (S-07) — tierUpdatedAt 2026-11-04T15:59:21.633Z
FAIL  the new session reports Unverified, not Contact verified (S-07) — tier 1, label Contact verified
FAIL  registration ignores an injected verification tier (S-07) — status 201, tier 1
FAIL  an injected tier cannot elevate the stored profile (S-07) — tier 1
FAIL  an ordinary profile write cannot elevate identity verification (S-07) — profile 1, supplier 0
FAIL  role activation leaves the stored tier at 0 (S-07) — tier 1
FAIL  a rejected verification attempt changes nothing (S-07) — tier 1
FAIL  the authorised workflow records a 0→2 event with its reviewer (S-07) — tier 2, event 1→2
FAIL  S-07 setup: a tier-0 reseller registers — status 201, tier 1
FAIL  the application records the honest tier 0 (S-07) — snapshot 1
FAIL  supplier approval does not elevate identity verification (S-07) — tier 1
```

The baseline proves the defect directly: a fresh account returned tier 1, stored tier 1, and wrote a `0→1` event even though `emailVerifiedAt` was `NULL`; `/api/auth/me` said “Contact verified”; an injected `verificationTier: 3` was ignored but the account was still falsely tier 1; and a reseller application snapshotted tier 1.

Assertions that passed at baseline are deliberate preservation checks: `emailVerifiedAt` stayed null, platform-admin injection was ignored, ordinary workspace access worked, non-admins were refused the verification workflow, the admin workflow itself worked, seeded tiers were intact, and supplier approval worked. They guard against over-fixing.

---

## 5. Exact implementation

### 5.1 Registration starts at tier 0

`src/server/accounts.ts → registerAccount()` now creates the profile with:

```ts
const profile = await tx.profile.create({
  data: {
    userId: user.id,
    displayName: input.displayName,
    phone: input.phone ?? null,
    country: input.country,
    // Registration proves neither an email nor a phone. Tier 1 means
    // "contact verified", so a new account starts at 0 and only the
    // authorised verification workflow may elevate it.
    verificationTier: 0,
  },
});
```

`tierUpdatedAt` is left `NULL` because no tier change has occurred. The `VerificationEvent 0→1` block was removed entirely: a non-change should not create a verification event. This matches the audit recommendation “add a verification event when the tier changes.”

### 5.2 Registration input is not trusted

`registerSchema` contains only `email`, `password`, `displayName`, `businessName`, `phone` and `country`. Zod’s default object behaviour strips unknown keys, so `verificationTier`, `tier`, nested `verification`/`profile` objects, `emailVerifiedAt` and `isPlatformAdmin` in the request body have no effect. The server writes the tier explicitly; it never copies it from input.

No `.strict()` change was made. Rejecting unknown keys would change the API contract for clients that send extra fields; stripping is safe for S-07 and keeps the change minimal.

### 5.3 The admin workflow remains the only elevation path

`setVerificationTier()` is unchanged in behaviour:

- `PATCH /api/admin/profiles/[id]/verification` calls `requirePlatformAdmin()`;
- `verificationSchema` validates `tier` as an integer 0–3, a reason of 3–300 characters, and optional evidence;
- the profile update, `VerificationEvent` and audit row are written in one transaction;
- the event records `fromTier`, `toTier`, `reason`, `evidenceRef` and `reviewedByProfileId`.

The service comment was corrected because the old text implied tier 1 was self-service:

```ts
/**
 * Verification tier changes are audited and platform-admin only. Tier 1 means
 * "contact verified", but this build has no email or phone challenge, so no
 * registration or self-service path may grant it. Tier 2-3 additionally require
 * business/document review. All changes go through the admin API.
 */
```

### 5.4 No email verification was implemented

The fix does **not** add email delivery, tokens, callbacks or a phone challenge. Tier 1 remains a state that only an authorised operator can set. A new account is correctly `Unverified`; it does not become `Contact verified` automatically. `emailVerifiedAt` remains `NULL` for ordinary registrations.

### 5.5 No schema or migration change

`Profile.verificationTier` already existed with `@default(0)`, and `VerificationEvent` already existed. The fix is a server-side assignment change only. No migration was created and `prisma/dev.db` was not modified.

---

## 6. Regression tests — 27 S-07 assertions

Added to `scripts/verify-api.mjs` after the S-05 block. They use dedicated probe accounts and a dedicated admin login; they do not alter seeded users or the shared database.

| # | Assertion | Expected | Result |
|---|---|---|---|
| 1 | A newly registered account is unverified | 201 + response tier 0 | PASS |
| 2 | The stored profile is tier 0, not tier 1 | DB tier 0 | PASS |
| 3 | Registration writes no false `0→1` verification event | 0 events | PASS |
| 4 | Registration does not claim a tier-change timestamp | `tierUpdatedAt` null | PASS |
| 5 | Registration does not set `emailVerifiedAt` | null | PASS |
| 6 | The new session reports `Unverified`, not `Contact verified` | tier 0 + label | PASS |
| 7 | Existing login still works for an unverified account | 200 + cookie | PASS |
| 8 | Registration ignores an injected verification tier | 201 + response tier 0 | PASS |
| 9 | An injected tier cannot elevate the stored profile | DB tier 0 | PASS |
| 10 | Registration cannot inject email verification or platform admin | `emailVerifiedAt` null, admin false | PASS |
| 11 | Creating a supplier profile still works | 201 | PASS |
| 12 | An ordinary profile write cannot elevate identity verification | profile 0, supplier 0 | PASS |
| 13 | Role activation does not elevate identity verification | 200 | PASS |
| 14 | Role activation leaves the stored tier at 0 | DB tier 0 | PASS |
| 15 | A tier-0 account keeps ordinary workspace access | customer 201 | PASS |
| 16 | An ordinary account cannot use the verification workflow | 403 | PASS |
| 17 | A rejected verification attempt changes nothing | DB tier 0 | PASS |
| 18 | The platform-admin verification workflow still works | 200 + tier 2 | PASS |
| 19 | The authorised workflow records a `0→2` event with its reviewer | event fields match | PASS |
| 20 | An authorised tier change is reflected in the existing session | tier 2 + label | PASS |
| 21 | Seeded verified fixtures keep their legitimate tiers | supplier 2, reseller 1, mediator 3, admin 3 | PASS |
| 22 | A tier-0 reseller registers (setup) | 201 + tier 0 | PASS |
| 23 | A tier-0 account can still activate the reseller role | 200 | PASS |
| 24 | A tier-0 reseller can still apply to a supplier | 201 | PASS |
| 25 | The application records the honest tier 0 | snapshot 0 | PASS |
| 26 | Supplier approval still works independently of identity verification | 200 + agreement id | PASS |
| 27 | Supplier approval does not elevate identity verification | DB tier 0 | PASS |

### 6.1 Coverage of the 10 required S-07 scenarios

| Required scenario | Assertions |
|---|---|
| New account receives the correct unverified tier | 1–6 |
| Registration cannot submit a higher tier | 8–9 |
| Registration cannot manipulate verification fields via unexpected payload properties | 8–10 |
| Ordinary profile updates cannot elevate verification | 11–14 |
| Existing authorised verification/approval workflows continue working | 18–20, 26 |
| Existing verified users retain legitimate status | 21 |
| Unverified users do not receive permissions reserved for verified users | 15–17, 25 |
| Supplier and reseller approval remain distinct from account verification | 12, 22–27 |
| Seeded fixtures continue to work without falsely representing ordinary registrations as verified | 1, 21 |
| Existing authentication and session behaviour remains unchanged | 6–7, 19–20, plus the full existing suite |

### 6.2 Test mechanics

- Database assertions import `@prisma/client` dynamically and run only when `DATABASE_URL` names a `sellflow-e2e-` temp file.
- The test registers dedicated `s07-*` accounts, logs in as the seeded platform admin for the authorised workflow, and uses the existing supplier session for approval.
- The supplier-profile and role routes are tested with extra `verificationTier`/`tier` properties to prove those properties are stripped.
- The reseller approval probe creates a real application and agreement in the temp database, then asserts the identity tier did not move.
- The block disconnects its Prisma client before the rest of the suite continues.
- No seeded account's verification state, no seed file and no shared database is modified.

---

## 7. Full verification results

| Check | Command | Result |
|---|---|---|
| S-07 assertions | inside `npm run test:e2e:clean` | **27 / 27 pass** |
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | `npm run build` (standalone) | **exit 0** |
| Prisma schema | `npx prisma validate` | **valid** |
| API suite | `scripts/verify-api.mjs` | **311 / 311 pass** (includes its embedded PWA pass) |
| Standalone PWA suite | `scripts/verify-pwa.mjs` | **31 / 31 pass** |
| Combined | `npm run test:e2e:clean` | **342 PASS, 0 FAIL**, exit 0, 355.9 s |
| Existing S-01, S-02, S-03, S-04, S-05, S-06, S-08, S-13, S-15 | same run | **all green** (127 tagged PASS lines) |
| S-05 checks | same run | **46 / 46 pass** |
| S-13 checks | same run | **18 / 18 pass** |
| S-15 checks | same run | **21 / 21 pass** |
| Isolation | canary workspace + `/proc` `DATABASE_URL` check | both passed |
| Harness port | own free port `35039` | released |
| Existing servers | ports `3000`, `4317`, `4322` | not stopped or restarted |

```text
harness_exit=0
API suite PASS: 311
standalone PWA PASS: 31
combined PASS: 342
FAIL: 0
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 355.9s (isolated DB, api=0, pwa=0)
```

The API-suite total includes the PWA checks that `verify-api.mjs` runs at its end; the standalone PWA suite adds the remaining 31. The 27 S-07 assertions are inside the 311.

**Baseline vs final:**

| Metric | Baseline (unmodified app) | Final |
|---|---|---|
| S-07 failures | 14 | 0 |
| New account response tier | 1 (`Contact verified`) | 0 (`Unverified`) |
| New account stored tier | 1 | 0 |
| Registration verification event | `0→1`, reason “Account created” | none |
| `tierUpdatedAt` on registration | set | null |
| Injected `verificationTier: 3` | ignored, but account still tier 1 | ignored, account tier 0 |
| Admin workflow event | `1→2` | `0→2` |
| New reseller application snapshot | 1 | 0 |
| Supplier approval | works, leaves tier 1 | works, leaves tier 0 |

---

## 8. Database fingerprint comparison

| Evidence | Value |
|---|---|
| `sha256sum prisma/dev.db` before and after | `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` against `prisma/dev.db` | **not run** |
| Test target | a fresh `mkdtemp` SQLite file under `/tmp`, removed by the harness |
| Shared development database writes | none |
| Schema/migration change | none |

---

## 9. Files changed

| File | Change |
|---|---|
| `src/server/accounts.ts` | Registration now creates `verificationTier: 0`; removed `tierUpdatedAt` and the false `0→1` `VerificationEvent`; corrected the `setVerificationTier` comment. No other service behaviour changed. |
| `scripts/verify-api.mjs` | Added 27 S-07 assertions covering the 10 required scenarios, including DB checks, payload injection, ordinary profile writes, the admin workflow, seeded tiers and supplier approval. |
| `STAGE2_TASK6A_S07_REPORT.md` | This report. |

**Not changed:** `prisma/schema.prisma`, migrations, `prisma/dev.db`, `prisma/seed.ts`, `scripts/seed-pilot.mjs`, billing/entitlements/C-03, role and permission checks, marketplace pricing, supplier/reseller approval logic, password reset, email verification, `scripts/deploy.sh`, `Dockerfile`, `docker-compose.yml`, `scripts/test-e2e-clean.mjs`, and the S-05 throttle.

---

## 10. Remaining limitations

1. **No email or phone verification exists.** Tier 1 (`Contact verified`) still cannot be earned by a normal user. The fix removes the false claim; it does not create a verification channel. Implementing email delivery or a phone challenge is a separate product decision and was explicitly out of scope.
2. **Tier 1 is now admin-only in practice.** A platform admin can set tier 1, 2 or 3 through the existing verification endpoint. The endpoint records a reason and optional evidence, but it does not independently prove contact ownership. It is an authorised operator workflow, not an automated verification mechanism.
3. **The pilot seeder still attests verification.** `scripts/seed-pilot.mjs` sets `emailVerifiedAt` and the operator-chosen tier with the comment that the pilot operator reached the person directly. That is an operator-attested provisioning path, not evidence of an email challenge, and it is not available through public registration.
4. **Seeded demo fixtures still carry elevated tiers.** The demo supplier is tier 2, the reseller tier 1, the mediator and admin tier 3, and the demo supplier profile has its own marketplace tier 2. These are intentional fixtures representing onboarded accounts; they are not ordinary registrations. The tests assert they remain intact.
5. **No authorization currently depends on `Profile.verificationTier`.** The original impact was a false trust signal, not a direct privilege escalation. If a future feature adds a tier-based gate, it must be tested explicitly; this fix does not retrofit tier checks onto roles or marketplace access.
6. **`SupplierProfile.verificationTier` is a separate field.** It is used for public supplier display and is seed-controlled. It is not the account identity tier, and no self-service route updates it. Do not conflate the two in future work.
7. **`ResellerApplication.verificationTierAtApply` is a snapshot, not an authorization input.** It now records 0 for new accounts, which is honest, but no code reads it to grant or deny anything.
8. **Registration ignores unknown properties rather than rejecting them.** This is safe for tier manipulation because the server never copies the value, but a client sending typos receives a normal 201 rather than a validation error. Making the schema strict would be a separate API-contract decision.
9. **Existing verified users are not re-reviewed.** The fix does not downgrade seeded or previously elevated profiles. It only changes what future registrations receive. Any remediation of accounts that were created before the fix and still carry the false tier 1 would require an explicit data decision and was not performed here.
10. **Phase 0 remains incomplete.** S-09, S-10, S-11, S-12 and S-14 remain open. S-01, S-02, S-03, S-04, S-05, S-06, S-08, S-13 and S-15 remain green but are not re-opened here. This report does not claim validation passed or that SellFlow is pilot-safe.

---

**S-07 complete. Stopping for review; no other security task was started.**
