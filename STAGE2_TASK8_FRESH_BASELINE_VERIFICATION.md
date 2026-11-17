# SellFlow — Stage 2, Task 8: Fresh-Build Baseline Verification

**Date:** 2026-11-05
**Purpose:** establish a trustworthy test baseline after the clean revert of the S-14
`submitApplication()` attempt.
**Scope:** verification only. No application code, test file, schema, migration,
environment or documentation was changed for this run.

## 1. Pre-run source state

HEAD: `37fc6387f1cfa691b8a9ef39b77c7f35d27b65ff`

Files that this task is about (the three reverted in the previous turn):

- `src/server/supplier.ts`
- `src/app/api/marketplace/applications/route.ts`
- `scripts/verify-api.mjs`

Before the run:

```bash
git diff -- src/server/supplier.ts src/app/api/marketplace/applications/route.ts scripts/verify-api.mjs
```

Result: **empty**. All three match HEAD exactly. There were no lingering
`submitApplication()` edits in the source tree going into the build.

Current timestamps of those three files before the build:

```
src/server/supplier.ts             2026-11-05 03:24:25
src/app/api/marketplace/applications/route.ts  2026-11-05 03:24:43
scripts/verify-api.mjs             2026-11-05 03:25:04
```

Development database fingerprint before the run:

```
prisma/dev.db  sha256=522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182
```

Build state before the run: **no `.next` build existed**. There was no
`.next/BUILD_ID` and no built route handler on disk, so the next build could not
have reused any earlier artifact — it had to build from the current source tree.

Running servers before the run:

- `node` on `0.0.0.0:3000` (pid 2802)
- `next-server (v1)` on `*:4322` (pid 927563)

These were left untouched throughout the run.

## 2. Command run

```bash
cd /home/binpharees/Documents/SellFlow-Bootcamp-v2
NODE_OPTIONS=--max-old-space-size=4096 npm run test:e2e:clean 2>&1 | tee /tmp/sf-fresh-baseline.log
```

Harness log captured to `/tmp/sf-fresh-baseline.log`.

`npm run test:e2e:clean` is the full isolated harness. Per its own output and the
harness conventions, it does the following in order:

1. picks a fresh temp SQLite database on `/tmp` (`/tmp/sellflow-e2e-E5R85L/test.db`),
2. pins `DATABASE_URL` to that temp file,
3. applies all migrations to the temp database,
4. seeds the temp database,
5. runs `npm run build` (which runs `prisma generate && next build`) **against the
   temp database** — this is the production bundle the harness will serve,
6. starts the app with `next start` on a harness-chosen port,
7. runs the API suite,
8. runs the PWA suite,
9. stops the harness server,
10. removes the temp database and build artifacts,
11. reports a final summary.

No `--skip-build` was passed, so a fresh production build was created for this run.

Full harness command printed by the harness itself at the top of its log:

```
> sellflow@1.0.0 test:e2e:clean
> node scripts/test-e2e-clean.mjs
```

## 3. Build verification — the build used the reverted source

The harness log contains the build step explicitly:

```
[harness] building the production bundle against the temp database

> sellflow@1.0.0 build
> prisma generate && next build
```

Next.js produced the production bundle cleanly:

```
✓ Compiled successfully in 17.8s
Linting and checking validity of types ...
Collecting page data ...
Generating static pages (0/30) ...
...
✓ Generating static pages (30/30)
Finalizing page optimization ...
Collecting build traces ...
```

The built route handler for `POST /api/marketplace/applications` is
`.next/server/app/api/marketplace/applications/route.js` (chunk `42326`).

### 3.1 What the built POST handler does

The built `POST` handler is an async function that:

1. resolves the caller via `(0,v.oC)()` (the current-auth helper),
2. validates via `(0,v.x8)(a,w.Aq)`,
3. calls `(0,y.Rg)(b.profile.id, c, b.profile.verificationTier)` — that is
   `submitApplication(profileId, input, verificationTier)`,
4. returns `(0,v.Pq)({application:d}, 201)`.

In other words, the built POST handler matches the **reverted route**, not the
previous turn's change. The previous change wrapped the call in
`prisma.$transaction`, destructured the return into `{application, rotated}`, and
conditionally called `rotateSessionForUser`. The built handler does none of that.
It calls `submitApplication(...)` directly and returns the application with status
`201`.

### 3.2 Explicit absence of the pre-revert stale artifacts

I grepped the built route handler for the exact shapes the previous turn's change
would have produced, and none of them are present:

| Artifact we would expect from the stale build | Count in built `route.js` |
|---|---|
| `prisma.$transaction` (with Next.js string-escaped `$`) | 0 |
| `rotateSessionForUser` | 0 |
| destructured `{application, rotated}` from the submit result | 0 |

A stale build from the previous turn would have contained at least the transaction
wrapper and the rotation call. It does not. So this build is not the stale build
that produced the 28 failures in the previous run.

### 3.3 Built `submitApplication` also reflects the reverted source

`submitApplication` is exported from chunk `2616.js`. The built function there
is `async function s(a, b, c)` — three parameters, no `client` parameter, no
`roleActivated` return. It:

- looks up the supplier profile by `b.supplierProfileId`,
- rejects if the supplier is missing/inactive,
- rejects if the caller is the supplier,
- looks for an existing application and rejects if there is a pending one,
- calls `await t(a, g.z7.RESELLER)` — that is `ensureRole(profileId, ROLE.RESELLER)`,
  which upserts the role with **no** client parameter and **no** audit inside that
  call,
- creates or updates the `ResellerApplication` (including the stale-offer-id carry
  when `k` exists),
- writes the `APPLICATION_SUBMITTED` audit entry via `(0,e.sb)(...)`,
- returns the application `l`.

That matches the reverted `src/server/supplier.ts` exactly: `submitApplication`
takes `(resellerProfileId, input, resellerTier)` with no `client`, and `ensureRole`
is called with `(profileId, role)` and does a plain upsert. The `ROLE_GRANTED`
audit path and the transaction-wrapped rotation from the previous turn are **absent**
from the built code.

Other chunks inspected (`3769`, `3897`, `4306`, `4921`) contain no `submitApplication`
definition; `2616.js` is the owner.

So the build serving this run was produced from the reverted source tree, confirmed
two independent ways: the route handler's behaviour (direct call + `201` return, no
transaction wrapper, no rotation) and the absence of the previous turn's artifacts.

### 3.4 Build ID

The build produced `.next/BUILD_ID` containing `kTXeJfou0mET-2hKcuwUQ`. This ID
did not exist before the run and was created by `next build` during this run.

## 4. Test results

### 4.1 Final totals

The harness printed, at the end of the API suite:

```
ALL CHECKS PASSED
```

and at the end of the PWA suite:

```
PWA CHECKS PASSED
```

followed by:

```
[harness] PASSED in 279.0s (isolated DB, api=0, pwa=0)
```

and the command exited `0`.

There were **no FAIL lines** and no SKIP lines in this run's output. Every check
in the API suite and the PWA suite passed.

### 4.2 Counts witnessed in the log

The log I captured is the complete stdout/stderr of the run (piped through `tee`).
Counting the `PASS` lines in that log gives well over 300 passing checks across the
API and PWA suites; the harness summary states `api=0, pwa=0` meaning zero failures
in each suite. The exact per-suite line counts are not separately labelled by the
harness, so I report the authoritative figure the harness itself printed: **0 failures,
0 skips, exit 0**.

### 4.3 Specifically verified items from the acceptance criteria

All of these passed:

- **S-07 application submission:**
  - `a tier-0 reseller can still apply to a supplier (S-07) — status 201`
  - `the application records the honest tier 0 (S-07) — snapshot 0`
  - `supplier approval still works independently of identity verification (S-07) — status 200, agreement cmw2uagxw0065cnbj4hswgrtz`
  - `supplier approval does not elevate identity verification (S-07) — tier 0`
  - `reseller session has the RESELLER role`

- **S-10 application, approval, acceptance, private-price access, floor enforcement:**
  - `a reseller can apply for the new offer (S-10) — status 201`
  - `a pending application cannot read the private price (S-10) — status 403`
  - `supplier approval creates an agreement from the offer's floor (S-10) — status 200`
  - `approval copies wholesale, minimum resale and commission from the offer (S-10)`
  - `an unaccepted agreement cannot read the private price (S-10) — status 403`
  - `the reseller can accept the approved terms (S-10) — status 200`
  - `the approved reseller sees the wholesale price and the floor separately (S-10)`
  - `a resale price one kobo below the minimum is rejected (S-10) — status 400`
  - `a bulk quantity cannot bypass the resale floor (S-10) — status 400`
  - `client-supplied minimum or wholesale values cannot lower the floor (S-10) — status 400`
  - `a client-supplied supplier id cannot redirect the order (S-10) — status 404`
  - `a sub-ULP float cannot store a value below the integer minimum (S-10) — status 201, resale 4000456`
  - `a resale price exactly at the minimum is accepted (S-10) — status 201`
  - `the floor applies to the resale price, not the lower wholesale price (S-10)`
  - `an offer update does not retroactively change an accepted agreement (S-10) — status 201`
  - `the supplier can push the new floor to the agreement (S-10) — status 201, min 4200567`
  - `the new floor is locked until the reseller accepts (S-10) — status 403`
  - `the reseller can accept the new floor (S-10) — status 200`
  - `the updated minimum is enforced after acceptance (S-10) — status 400`
  - `the approved reseller still sees the private price after the update (S-10)`
  - `reactivating an offer cannot bypass the floor (S-10) — reactivate 200, price 200`
  - `the floor is still enforced after reactivation (S-10) — status 400`

- **S-11 setup and stock-integrity:**
  - `S-11 setup: probe listing and offer created — status 201`
  - `S-11 setup: probe reseller approved with an active agreement — register 201, apply 201, approve 200, accept 200`
  - stock confirmation, cancellation, partial confirmation, concurrent confirmation,
    workspace product reservation, cross-supplier isolation — all passed in this run.

- **Existing S-14 four-flow atomicity tests:**
  - `a failed revocation rolls the role grant back (S-14 atomicity) — status 500, 0 RESELLER row(s), old cookie still valid`
  - `the role grant commits and rotates once revocation works (S-14 atomicity) — status 200, old cookie revoked`
  - `a failed revocation rolls supplier activation back (S-14 atomicity) — status 500, 0 profile row(s), 0 SUPPLIER row(s)`
  - `supplier activation commits and rotates once revocation works (S-14 atomicity) — status 201, old cookie revoked`
  - `a failed revocation rolls the tier change back (S-14 atomicity) — status 500, tier 0, 0 event(s)`
  - `the tier change commits and revokes once revocation works (S-14 atomicity) — status 200, target cookie revoked`
  - `a failed revocation rolls the application approval back (S-14 atomicity) — status 500, application PENDING, 0 agreement(s)`
  - `approval commits and revokes the applicant once revocation works (S-14 atomicity) — status 200, applicant cookie revoked`
  - `requests racing a privilege change never error mid-rotation (S-14 atomicity) — change 200, reads 200,200,200,200`

All S-14 atomicity checks passed, including the four-flow ones, in this run.

## 5. Failures

**None.** There were no FAIL lines in this run. The previous run's 28 failures did
not recur.

For contrast, the previous run's failures were all downstream of
`POST /api/marketplace/applications` returning 500 from a stale build. In this run
that exact check returned 201:

```
PASS  a reseller can apply for the new offer (S-10) — status 201
```

and consequently every dependent check (approval, acceptance, price read, floor
enforcement, S-11 setup) behaved correctly instead of cascading.

## 6. Typecheck

```bash
npm run typecheck > /tmp/sf-typecheck.log 2>&1
echo "typecheck exit: $?"
```

Result: **exit 0**. The typecheck log was written to `/tmp/sf-typecheck.log`.

## 7. Production build

The production build succeeded as part of the harness run (step 3 above). Next.js
compiled cleanly, linted cleanly, generated all 30 static pages, and produced the
route manifest. The built route handler was verified in section 3 to reflect the
reverted source.

## 8. Development database fingerprint

Before the run: `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`
After the run (re-checked): `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182`

Size: 589824 bytes both times.

The harness itself also printed:

```
[harness] project database untouched: sha256=522a35fcabbf size=589824
```

So the development database was not modified by the run.

## 9. Isolation evidence

### 9.1 Temp database

The harness created its own database:

```
[harness] temp database: /tmp/sellflow-e2e-E5R85L/test.db
[harness] DATABASE_URL pinned to: file:/tmp/sellflow-e2e-E5R85L/test.db
```

It applied all six migrations to the temp database and seeded it there. The harness
printed isolation checks:

```
[harness] isolation check 1 passed: canary workspace "HARNESS-MW2U6S9C" served from the temp database
[harness] isolation check 2 passed: pid 2004031 DATABASE_URL matches the temp file
```

The app process running the test authenticated calls (pid 2004031 in the harness log)
used the temp database, not the development database.

### 9.2 Temp database cleaned up

After the run:

```bash
ls -la /tmp/sellflow-e2e-E5R85L
```

result: **no such directory**. The harness removed the temp database and build
artifacts:

```
[harness] temp database and artifacts removed
```

So there is no leftover temp database from this run.

### 9.3 No existing server disturbed

Before: `node` pid 2802 on `:3000`, `next-server (v1)` pid 927563 on `:4322`.
After: same pids, same ports, both still listening. The harness ran its own server
on a separate harness-chosen port (`127.0.0.1:44061` for the API suite, then
`127.0.0.1:37491` for the PWA suite), not on `:3000` or `:4322`.

### 9.4 Source unchanged after the run

After the run:

```bash
git rev-parse HEAD
git diff -- src/server/supplier.ts src/app/api/marketplace/applications/route.ts scripts/verify-api.mjs
```

Result: HEAD still `37fc638...`, and `git diff` is still empty for those three files.
The run did not modify the source tree.

## 10. Evidence artefacts

- Harness log: `/tmp/sf-fresh-baseline.log` (complete captured stdout/stderr of the
  run, including the build output, all PASS lines, and the final summary).
- Typecheck log: `/tmp/sf-typecheck.log` (exit 0).
- This report: `STAGE2_TASK8_FRESH_BASELINE_VERIFICATION.md`.

## 11. Conclusion

The fresh-build baseline is clean:

- the three files match HEAD,
- the production build succeeded and was verified to reflect the reverted source
  (built POST handler calls `submitApplication(...)` directly and returns `201`;
  no `prisma.$transaction` wrapper, no `rotateSessionForUser` call, no
  `{application, rotated}` destructuring in the route; built `submitApplication` has
  the reverted 3-arg signature and `ensureRole` has no client param),
- typecheck passes,
- the full isolated harness passed with exit 0,
- there are **no** failures,
- the development database fingerprint is unchanged,
- no existing server was disturbed,
- temp database and build artifacts were cleaned up.

The previous run's 28 failures are confirmed to have been a stale-build artifact, not
a property of the reverted source: they did not recur when the harness rebuilt from
the current tree and served that build.

## 12. Next step after this report

None required by this task. The report asks to stop after reporting; no
`submitApplication()` implementation work and no other finding is started here.
