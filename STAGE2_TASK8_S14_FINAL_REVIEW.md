# S-14 Final Security Review — Privilege Change Atomicity

**Date:** 2026-11-05
**Scope:** S-14 only. S-09, billing/entitlements/C-03 and every other finding untouched.
**Question reviewed:** the S-14 report claimed privilege changes commit and session
revocation happens afterwards. Does a failed revocation leave a security-sensitive
privilege change committed while old sessions stay valid?

**Verdict:** the concern was correct. All four flows had the defect described, and
none of them shared a transaction with its revocation. Atomic coordination **is**
possible here (one SQLite database, one Prisma client) and is now implemented: the
privilege write, its audit row, the revocation of the affected account's sessions
and — where the acting user is affected — the replacement session all commit or
roll back together. Fault-injection tests prove the property.

---

## 1. Findings as reviewed (before)

| Flow | Where the privilege change commits | Where revocation happened | Failure mode |
|---|---|---|---|
| `POST /api/profile/roles` | `grantRole()` — `profileRole.create` + `audit()` | `rotateSessionForUser()` afterwards — separate `updateMany` + `create` (a third and fourth commit) | 500 returned, **role granted**, **old token still valid** |
| `POST /api/supplier/profile` | `ensureSupplierProfile()` inner `$transaction` (profile + SUPPLIER role); audit after | `rotateSessionForUser()` in the route, after the service returned | 500 returned, **SUPPLIER active**, **old token still valid** |
| `PATCH /api/admin/profiles/{id}/verification` | `setVerificationTier()` `$transaction` — profile tier, `verificationEvent`, `auditCritical` | `revokeAllSessionsForUser()` after the transaction returned, plus a second `findUnique` for the owner | 500 returned, **tier elevated**, **every old session of the target still valid** |
| `decideApplication()` (APPROVED) | `$transaction` — application, agreement, agreement version | `revokeAllSessionsForUser()` after the transaction, after two further audit writes | 500 returned, **agreement live**, **applicant's old sessions still valid** |

### What the gap actually exposed

Two separate things, worth keeping apart:

1. **Credential survival (the real defect).** Revocation exists so a token that
   was issued under the old privilege set stops working. If the revocation call
   failed, that never happened — not for a millisecond, but **permanently**, while
   the request still returned an error that looked like "nothing happened". An
   operator retrying would see the privilege already applied. A stolen token kept
   working indefinitely.
2. **Concurrent requests during the window.** Between commit and revoke (one or
   two extra round trips, single-digit milliseconds) an old session still
   authenticated. It did **not** carry stale privileges: `getAuthContext()` reads
   roles, tier and profile live from the database on every request, so an old
   cookie sees the new tier the moment it commits. The exposure was that a
   superseded credential remained usable, not that it could do more than the
   account may now do.

Replacement-cookie issuance was already correct in the reviewed code: the cookie
was attached only after `rotateSessionForUser()` resolved, i.e. after commits. That
ordering is preserved — and is now stronger, because the replacement session is
created inside the same transaction as the change.

---

## 2. Change: one unit of work per privilege change

`Db` (client-or-transaction) is now threaded into the revocation and session
primitives, so callers decide the commit boundary:

```ts
// src/lib/auth/revocation.ts
export type Db = PrismaClient | Prisma.TransactionClient;
export async function revokeAllSessionsForUser(userId: string, client: Db = prisma)

// src/lib/auth/session.ts
export async function startSession(userId, meta = {}, client: Db = prisma)
export async function rotateSessionForUser(userId, meta = {}, client: Db = prisma)
```

### 2.1 `POST /api/profile/roles`

```ts
const rotated = await prisma.$transaction(async (tx) => {
  await grantRole(ctx.profile.id, input.role, ctx.profile.id, tx);
  return rotateSessionForUser(ctx.user.id, sessionMeta(request), tx);
});
const response = json({ ... });
applySessionCookie(response, rotated.token, rotated.expiresAt); // after commit
```

Grant, audit row, revocation of every session and the replacement session row are
one commit. A failure at any point leaves the account exactly as it was, with the
presented session still valid.

### 2.2 `POST /api/supplier/profile`

The route opens the transaction; `ensureSupplierProfile()` no longer opens a
nested one (`Prisma` has no nested interactive transactions) and writes through the
supplied client, returning `{ supplier, activated }`:

```ts
const { supplier, rotated } = await prisma.$transaction(async (tx) => {
  const outcome = await ensureSupplierProfile(ctx.profile.id, ctx.workspaceId, input, tx);
  if (!outcome.activated) return { supplier: outcome.supplier, rotated: null };
  return { supplier: outcome.supplier, rotated: await rotateSessionForUser(ctx.user.id, sessionMeta(request), tx) };
});
if (rotated) applySessionCookie(response, rotated.token, rotated.expiresAt);
```

**Behaviour change (deliberate):** editing an *existing* supplier profile no longer
rotates. It changes no privilege, and the previous behaviour signed the user out of
every other device on a business-name edit. Creation still rotates.

### 2.3 `PATCH /api/admin/profiles/{id}/verification`

The revocation moved *inside* the existing transaction, next to the tier update,
the verification event and the critical audit row:

```ts
await tx.session.updateMany({
  where: { userId: profile.userId, revokedAt: null },
  data: { revokedAt: new Date() },
});
```

The post-commit `findUnique` + `revokeAllSessionsForUser` pair is gone. The route
still issues a replacement cookie for the self-elevation case, after the commit.

### 2.4 `decideApplication()` (APPROVED)

```ts
const applicant = await tx.profile.findUnique({ where: { id: application.resellerProfileId }, select: { userId: true } });
if (applicant) {
  await tx.session.updateMany({ where: { userId: applicant.userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
```

Approval, agreement, version and the applicant's revocation share one commit. The
REJECTED branch is unchanged — it grants no privilege, so there is nothing to
revoke.

### 2.5 Why this is safe rather than merely atomic

- **The replacement token is generated before the commit but stored inside it.** If
  the transaction rolls back, the token exists nowhere: no orphan credential, no
  cookie pointing at a session that was never written.
- **The cookie is still applied only after `$transaction()` resolves,** so a
  committed change whose response is lost signs the user out (fail-safe) rather
  than handing out a token that was never persisted.
- **Auditing now shares the commit.** `audit()` called with a transaction client
  makes a single attempt (no retry sleeps inside a transaction), and a failure
  poisons the transaction, so the privilege change rolls back instead of applying
  without a trail. This is a deliberate tightening of the earlier "audit is
  best-effort" stance for these four flows only; `decideApplication`'s two
  non-critical post-commit audit rows keep their existing behaviour (recorded via
  `auditHealth()`).
- **No client-supplied identity enters either write.** The revocation is scoped by
  the user id resolved server-side from the profile row being changed.

---

## 3. Fault-injection evidence

No test hook was added to the application. The harness installs a SQLite trigger in
the **isolated test database** that aborts every session revocation:

```sql
CREATE TRIGGER s14_block_revoke
BEFORE UPDATE OF "revokedAt" ON "Session"
WHEN NEW."revokedAt" IS NOT NULL
BEGIN SELECT RAISE(ABORT, 's14 injected revocation failure'); END;
```

The trigger is scoped to `revokedAt` writes, so ordinary `lastUsedAt` activity is
unaffected while it exists, and it is dropped in a `finally` block so no later suite
inherits it. Each scenario asserts both halves: the rollback (privilege absent, old
session still valid) **and** the retry after the fault is removed (privilege
present, old session dead, replacement usable).

```
PASS  a failed revocation rolls the role grant back (S-14 atomicity) — status 500, 0 RESELLER row(s), old cookie still valid
PASS  the role grant commits and rotates once revocation works (S-14 atomicity) — status 200, old cookie revoked
PASS  a failed revocation rolls supplier activation back (S-14 atomicity) — status 500, 0 profile row(s), 0 SUPPLIER row(s)
PASS  supplier activation commits and rotates once revocation works (S-14 atomicity) — status 201, old cookie revoked
PASS  a failed revocation rolls the tier change back (S-14 atomicity) — status 500, tier 0, 0 event(s)
PASS  the tier change commits and revokes once revocation works (S-14 atomicity) — status 200, target cookie revoked
PASS  a failed revocation rolls the application approval back (S-14 atomicity) — status 500, application PENDING, 0 agreement(s)
PASS  approval commits and revokes the applicant once revocation works (S-14 atomicity) — status 200, applicant cookie revoked
PASS  requests racing a privilege change never error mid-rotation (S-14 atomicity) — change 200, reads 200,200,200,200
```

The tier case additionally asserts `0` verification events survive the rollback, and
the approval case asserts the agreement count stays `0`, so the checks cover the
whole unit rather than only the row the caller read.

The last check fires a role activation concurrently with four authenticated reads of
the same cookie: every read returned `200` (before the rotation) and the change
returned `200`. Under the old ordering the same reads could have observed the new
role on a session that was about to be revoked; now they see one consistent state.

**Observation, not fixed (out of scope):** `submitApplication()` calls
`ensureRole()` and so grants RESELLER implicitly when a reseller applies. That is a
role grant outside the four reviewed flows, it is not audited as `ROLE_GRANTED`, and
it does not rotate. Worth a follow-up decision, but S-14 as accepted does not cover
it and this review did not change it.

---

## 4. Remaining limitations

1. **HTTP response loss after commit** signs the acting user out for the self-service
   flows (their sessions were revoked and the replacement cookie never arrived). Fail
   safe, but a retry will not restore the cookie; the user signs in again.
2. **Self-elevation instant.** Between the commit and the browser receiving the
   replacement cookie, the administrator's old cookie is dead; a concurrent request
   from that tab gets 401. This is inherent to rotating on a privilege change.
3. **SQLite serialises writers.** These transactions are short (3–6 statements), but
   heavy concurrent admin verification traffic can contend; Prisma's interactive
   transaction timeout (5 s default) is the containment. Not measured under load.
4. **Login rotation is still two commits** (revoke presented token, then insert the
   new session). It is not a privilege change, and the order is fail-safe: if the
   insert fails the user is signed out. Left as is.
5. **Logout** remains a single write; no atomicity question applies.
6. **`pruneSessions`** is unchanged and still opportunistic on sign-in.
7. **No device UI, no reuse detection, no password-change flow** — unchanged from
   the S-14 report; S-09 still owns the password-change caller.
8. **Phase 0 remains incomplete.** This review closes the atomicity question only.

---

## 5. Verification

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| Production build | succeeded in the full harness run with the new source (the final `--skip-build` pass reuses it) |
| API assertions | **463 / 463** (9 new atomicity checks) |
| PWA assertions | **31 / 31** |
| Total | **494 PASS / 0 FAIL**, harness `PASSED in 226.9s`, `api=0, pwa=0` |
| Before this review | 485 PASS / 0 FAIL |

**Database and servers:** `sha256(prisma/dev.db) =
522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`, 589,824 bytes,
mtime `1793746202` — unchanged. No `db:reset`; the injected trigger existed only
inside the temp database, which the harness removed (`temps cleaned`). `:3000`
(pid 2802) and `:4322` (pid 927563) untouched.

**Caveat on the fault injection:** it proves the ordering/rollback contract of the
application code against SQLite. It does not simulate a process kill between
`COMMIT` and the HTTP response, a database crash mid-transaction, or a network
partition — those are covered only by the fail-safe ordering argument in §2.5.

---

## 6. Changed files

| File | Change |
|---|---|
| `src/lib/auth/revocation.ts` | `Db` type; `revokeAllSessionsForUser(userId, client)` |
| `src/lib/auth/session.ts` | `startSession` / `rotateSessionForUser` accept a client |
| `src/app/api/profile/roles/route.ts` | Grant + audit + revoke + replacement session in one transaction; cookie after commit |
| `src/app/api/supplier/profile/route.ts` | Same, only on activation; edits no longer rotate |
| `src/server/supplier.ts` | `ensureSupplierProfile` / `grantRole` take a client, no nested transaction, audit shares the commit; `decideApplication` revokes inside its transaction |
| `src/server/accounts.ts` | `setVerificationTier` revokes inside its transaction; post-commit revocation removed |
| `src/app/api/admin/profiles/[id]/verification/route.ts` | Comment corrected to match the new ordering |
| `scripts/verify-api.mjs` | 9 fault-injection atomicity assertions |
| `STAGE2_TASK8_S14_FINAL_REVIEW.md` | This review |

Unchanged by design: `prisma/schema.prisma`, the migration, session policy values,
inventory endpoints, login/logout, revocation-on-reuse deferral, billing,
entitlements, C-03.

**Review complete. Stopping here.**
