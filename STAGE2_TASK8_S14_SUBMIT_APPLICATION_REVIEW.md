# SellFlow — Stage 2, Task 8: S-14 Final Remediation, Submit Application

**Date:** 2026-11-05
**Finding:** S-14 Final Security Review — Privilege Change Atomicity (submitApplication path)
**Status:** remediated and verified
**Scope:** S-14 only. No other finding started. No billing, entitlements, or C-03 touched.

## 1. Problem

`POST /api/marketplace/applications` (submitApplication) granted the RESELLER role
implicitly, without the session-lifecycle protection that the rest of S-14 requires:
the role was upserted, no ROLE_GRANTED audit event was written, and any existing
sessions survived the grant. A reseller could therefore obtain reseller pricing
privileges while a stale session token remained usable.

This was flagged as an out-of-scope observation in
`STAGE2_TASK8_S14_FINAL_REVIEW.md` and is now the last remaining S-14
privilege-change path after the four flows already remediated (self-service role
activation, supplier profile creation, admin verification tier change, and
application approval).

## 2. Why this path matters

RESELLER is a real privilege, not an ornament:

- `/api/supplier/orders` requires `requireRole(ROLE.RESELLER)`.
- `/api/marketplace/offers/{offerId}/price` resolves private pricing only for an
  ACTIVE reseller with an APPROVED application and an ACTIVE agreement whose
  current version exists (`resolveResellerPrice` in `src/server/price-access.ts`).
- `createSupplierOrder` enforces `minResalePriceKobo` from the agreement version the
  order uses, so the RESELLER grant plus an approved/accepted agreement materially
  changes what the account can do.

Granting RESELLER without rotating sessions is therefore a genuine S-14 gap, not a
cosmetic one.

## 3. When submission grants a privilege

`submitApplication(resellerProfileId, input, resellerTier, client?, resellerWorkspaceId?)`:

- Always writes/returns a `ResellerApplication` (create when none exists, update to
  PENDING when one already exists).
- Grants RESELLER only when the role row does not already exist. The grant is done by
  `ensureRole(profileId, ROLE.RESELLER, actorProfileId, client)`, which upserts the
  `ProfileRole` row and, when it is newly created, writes a `ROLE_GRANTED` audit event
  (`action: "profile.role_granted"`, `entityType: "Profile"`, `entityId: profileId`,
  `metadata: { role: "RESELLER" }`).
- `ensureRole` returns `{ row, created }` so the caller knows whether a privilege
  change actually happened.

So:

- A first application for an account with no RESELLER role → role granted → privilege
  change → rotate.
- A repeat application, or an application by an account that already activated RESELLER
  via self-service, finds the role already present → `created: false` → no privilege
  change → no rotation.

This matches the established S-14 pattern used by
`/api/profile/roles` (self-service role activation): only an actual new grant rotates.

## 4. Implementation

### 4.1 `src/server/supplier.ts`

**`ensureRole` (new signature)**

```ts
async function ensureRole(
  profileId: string,
  role: Role,
  actorProfileId: string,
  client: Db = prisma,
): Promise<{ row: ProfileRole; created: boolean }>
```

- Looks up `profileRole.findUnique` on the caller's client.
- If the row exists, returns `{ row: existing, created: false }`.
- If not, creates it via `client.profileRole.create`, writes
  `audit({ actorProfileId, actorRole: role, action: AUDIT.ROLE_GRANTED, ... },
  { client })`, and returns `{ row: created, created: true }`.

This mirrors the role-grant + audit pattern already used by `grantRole` and
`setSupplierProfile` in the same file, but now returns the `created` flag.

**`submitApplication` (extended signature)**

```ts
export async function submitApplication(
  resellerProfileId: string,
  input: { supplierProfileId: string; offerId?: string; message?: string; businessSummary?: string },
  resellerTier: number,
  client: Db = prisma,
  resellerWorkspaceId: string | null = null,
): Promise<{ application: ResellerApplication; roleGranted: boolean }>
```

- Validates the supplier exists and is active, rejects self-application.
- Capacity check: `workspaceIdForProfile` + `assertSupplierCapacity` run through the
  global prisma client. When `resellerWorkspaceId` is threaded in by the route (which
  runs these outside the transaction), they are skipped here. Otherwise they run
  ourselves for any non-transactional caller.
- Finds or creates the `ResellerApplication`, writing `APPLICATION_SUBMITTED` audit
  through the client.
- Calls `ensureRole(resellerProfileId, ROLE.RESELLER, resellerProfileId, client)` and
  returns `{ application, roleGranted }`.

All database writes inside the function go through `client`, so when the route passes
the transaction client, the role grant, the ROLE_GRANTED audit, the application write,
and the APPLICATION_SUBMITTED audit all share one transaction.

### 4.2 `src/app/api/marketplace/applications/route.ts`

The POST handler:

1. Reads the body.
2. Computes `resellerWorkspaceId = await workspaceIdForProfile(ctx.profile.id)` and
   runs `assertSupplierCapacity` **outside** the transaction (these use the global
   prisma client and cannot run inside an interactive transaction).
3. Opens `prisma.$transaction(async (tx) => {...})`:
   - calls `submitApplication(ctx.profile.id, input, ctx.profile.verificationTier, tx, resellerWorkspaceId)`,
   - if `roleGranted` is true, runs `rotateSessionForUser(ctx.user.id, sessionMeta(request), tx)` inside the same transaction,
   - returns the result.
4. Builds the `201` JSON response.
5. If `roleGranted`, applies the session cookie from the rotated session. The cookie
   is attached only after the commit succeeds.

When `roleGranted` is false, no rotation happens and no cookie is set — the existing
session continues to work. This is the "no unnecessary rotation" behaviour.

### 4.3 `scripts/verify-api.mjs`

Three new isolated-database checks added to the S-14 atomicity block (after the
existing application-approval case, before the concurrency case), reusing the existing
`s14_block_revoke` SQLite trigger for fault injection:

- **Blocked grant rolls back.** Register a fresh account, block revocations, submit an
  application. Expect `status >= 500`, 0 RESELLER rows, no application row, 0
  ROLE_GRANTED audit rows, old cookie still valid. Then unblock and re-run: the role
  grant, ROLE_GRANTED audit, application, and rotation all commit together.

- **First application grants + audits + rotates.** Same setup, blocked then unblocked.
  After unblock: `status 201`, application PENDING, 1 RESELLER row, 1 ROLE_GRANTED
  audit row, old cookie revoked, new cookie valid.

- **No-new-role rotates nothing.** Register a fresh account, activate RESELLER via
  `/api/profile/roles` first (a separate privilege change that does rotate), then
  submit an application. The submission finds the role already present, so it is not a
  privilege change: `status 201`, application PENDING, still only 1 ROLE_GRANTED audit
  row (the one from the prior activation), no new cookie set, session used for the
  submission still valid afterward.

## 5. Test evidence

Full isolated harness: **`npm run test:e2e:clean`**, fresh build, exit 0,
`PASSED in 244.4s (isolated DB, api=0, pwa=0)`.

Harness log: `/tmp/sf-s14-submit-final.log`.

### 5.1 New S-14 submit-application checks (all PASS)

- `a failed revocation rolls the application grant back (S-14 atomicity)` —
  status 500, 0 RESELLER row(s), application none, 0 ROLE_GRANTED audit row(s), old
  cookie still valid
- `a first application grants RESELLER, audits it and rotates once (S-14 atomicity)` —
  status 201, application PENDING, 1 RESELLER row(s), 1 ROLE_GRANTED audit row(s), old
  cookie revoked, new cookie valid
- `an application that grants no new role rotates nothing (S-14 atomicity)` —
  status 201, application PENDING, 1 ROLE_GRANTED audit row(s), rotated cookie no, session
  still valid

### 5.2 Existing S-14 atomicity checks (all PASS)

- `a failed revocation rolls the role grant back (S-14 atomicity)` — 500, 0 RESELLER rows, old cookie valid
- `the role grant commits and rotates once revocation works (S-14 atomicity)` — 200, old revoked
- `a failed revocation rolls supplier activation back (S-14 atomicity)` — 500, 0 profile rows, 0 SUPPLIER rows
- `supplier activation commits and rotates once revocation works (S-14 atomicity)` — 201, old revoked
- `a failed revocation rolls the tier change back (S-14 atomicity)` — 500, tier 0, 0 events
- `the tier change commits and revokes once revocation works (S-14 atomicity)` — 200, target revoked
- `a failed revocation rolls the application approval back (S-14 atomicity)` — 500, application PENDING, 0 agreements
- `approval commits and revokes the applicant once revocation works (S-14 atomicity)` — 200, applicant revoked
- `requests racing a privilege change never error mid-rotation (S-14 atomicity)` — change 200, reads 200,200,200,200

### 5.3 Other suites (all PASS)

- S-07 (identity verification + supplier application path): including
  `a tier-0 reseller can still apply to a supplier (S-07) — status 201` and
  `supplier approval still works independently of identity verification (S-07) — status 200`
- S-10 (minimum resale price enforcement, offer lifecycle, agreement acceptance): full
  suite passed
- S-11 (stock integrity): full suite passed, including setup
  `probe reseller approved with an active agreement — register 201, apply 201, approve 200, accept 200`
- S-12, S-13, S-15, PWA: all passed

No existing assertion was weakened. No expected value changed.

## 6. Migration status

**No new migration.**

The change is behavioural only. It does not add columns, tables, indexes, or triggers.
The existing `Session` lifecycle migration
(`20261105060000_session_lifecycle`) already provides the `lastUsedAt` column, the
indexes, and the trigger infrastructure that the S-14 rotation/revocation code relies
on. The fault-injection trigger `s14_block_revoke` is created and dropped at runtime by
the test harness, not by a migration.

`prisma/schema.prisma` is unchanged. `prisma/dev.db` fingerprint is unchanged
(`522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`).

## 7. Isolation evidence

- The harness created a fresh temp database
  (`/tmp/sellflow-e2e-yLwLCe/test.db`), applied all 6 migrations, seeded it, built the
  production bundle against it, ran the API and PWA suites, then removed the temp
  database and build artifacts.
- Isolation check 1: canary workspace served from the temp database.
- Isolation check 2: the listening process's `DATABASE_URL` matched the temp file.
- After the run: `project database untouched: sha256=522a35fcabbf size=589824`.
- Running servers on `:3000` (pid 2802) and `:4322` (pid 927563) were not disturbed;
  the harness used its own ports (`127.0.0.1:41623` for the API suite, `127.0.0.1:45809`
  for the PWA suite).
- Typecheck: `npm run typecheck` exit 0.
- Source: the three edited files are the only application/test changes; no schema,
  migration, or documentation change.

## 8. Files changed

- `src/server/supplier.ts` — `ensureRole` rewritten to return `created` and audit
  `ROLE_GRANTED` through a caller-supplied client; `submitApplication` extended with
  optional `client` and `resellerWorkspaceId` params, returns `{ application, roleGranted }`.
- `src/app/api/marketplace/applications/route.ts` — POST handler opens a transaction,
  threads the workspace id and transaction client into `submitApplication`, rotates only
  on a genuine new grant, applies the cookie after commit.
- `scripts/verify-api.mjs` — three new S-14 atomicity checks for the submit-application
  privilege-grant path.

## 9. Limitations

- The `ROLE_GRANTED` audit event written by `ensureRole` uses the standard
  `metadata: { role }` shape, consistent with the other role-grant paths in the codebase.
  It does not carry a separate `via` field; the event is distinguishable from other
  `ROLE_GRANTED` events by its `entityType: "Profile"`, `entityId` (the profile), and
  `metadata.role`. The test verifies it by counting `profile.role_granted` audit rows
  for the profile with `RESELLER` in the metadata.
- `submitApplication` still audits `APPLICATION_SUBMITTED` via the non-critical `audit()`
  (swallow-on-failure) rather than `auditCritical()`. That was pre-existing and is
  outside this task's scope; the S-14 concern here is the privilege grant + rotation
  atomicity, which is now handled by the transaction + `ensureRole`'s audit through the
  client.
- The route's capacity check (`workspaceIdForProfile` + `assertSupplierCapacity`) runs
  outside the transaction. This is necessary because those functions use the global prisma
  client. The capacity check is not part of the privilege-change atomicity guarantee; a
  capacity rejection after a successful grant is not a scenario this design targets. In
  practice the capacity check runs first and fails fast, so the transaction is never opened
  when capacity is exceeded.
- Repeat submissions to the same supplier while a PENDING application already exists still
  return 409 conflict, as before. The "no rotation on no-new-role" check exercises the
  case where the role already exists but there is no existing PENDING application (a fresh
  application to the offer after RESELLER was gained via self-service activation).

## 10. Stop

Done. S-14 is complete. No other finding was started.
