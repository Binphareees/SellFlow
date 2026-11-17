# SellFlow — Stage 2, Task 4B: S-15 (Privileged Demo Account Exposure) Report

**Date:** 2026-11-04
**Revision:** 2 — supersedes revision 1, which was reviewed and **not accepted**.
**Scope:** S-15 only. S-13 and S-05 were not started. No schema, migration, dependency, billing or entitlement change. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

> **Status:** The demo seed and `db:reset` now fail closed unless the environment is explicitly `development` or `test`, the operator explicitly opts in, and the database target is a disposable local file. Phase 0 validation has **not** passed and is not claimed here.

---

## Revision history

| Rev | Date | Status | Summary |
|---|---|---|---|
| 1 | 2026-11-04 | Superseded — not accepted | Added a seed guard, but treated an **unset `NODE_ENV` as development**, auto-set `SEED_DEMO_DATA=true` in the npm scripts, and left `db:reset` calling `prisma migrate reset --force` directly. |
| 2 | 2026-11-04 | Current | Unset/empty/malformed environments refuse. No automatic opt-in. Shared guard runs before Prisma connects. `db:reset` is a guarded wrapper that checks the environment and target **before** Prisma can drop the database. Added a fail-closed database-target heuristic and 21 regression assertions. |

### Why revision 1 was rejected

1. **Unset `NODE_ENV` was treated as development.** A production host with a missing variable would therefore be eligible for demo seeding.
2. **`npm run db:seed` set `SEED_DEMO_DATA=true` itself.** The “operator opt-in” was automatic, so the guard added little protection against a stray command.
3. **`db:reset` bypassed the guard.** `"db:reset": "prisma migrate reset --force"` dropped and recreated the database before the seed hook ran. Even when the seed refused, the database had already been destroyed.
4. **The target check was too narrow.** It only looked for `/app/data/` and production-like filenames. It did not reject remote schemes, unresolved interpolation, paths outside the project/temp directory, or other production roots.
5. **The tests did not prove the required properties.** Staging, unset, empty and malformed environments, byte-identical refusal, admin non-promotion, `db:reset` bypass and the production build path were not covered.

Revision 1's original implementation and test list are preserved in **Appendix A** for history.

---

## 1. Final root cause and affected files

| File | Role in the defect |
|---|---|
| `prisma/seed.ts` | Creates four accounts sharing a committed password, two of them privileged: `mediator@sellflow.test` with the `MEDIATOR` role and `admin@sellflow.test` with `isPlatformAdmin: true`. Originally it inspected no environment, so it ran against whatever database `DATABASE_URL` pointed at. |
| `prisma/seed.ts` (admin upsert) | The original `update: { isPlatformAdmin: true }` would **promote** any existing account that owned `admin@sellflow.test`. |
| `prisma/seed.ts` (final log) | The original closing log printed the shared password to stdout, which lands in CI logs and shell scrollback. |
| `package.json` | `"db:seed": "prisma db seed"` and `"db:reset": "prisma migrate reset --force"` (which auto-seeds) had no environment gate. Revision 1 then made the opt-in automatic, which was still unsafe. |
| `scripts/test-e2e-clean.mjs` | Seeds the isolated harness database with `NODE_ENV=test` and `SEED_DEMO_DATA=true`, which is a legitimate explicit opt-in. |
| `Dockerfile`, `docker-compose.yml`, `scripts/deploy.sh` | Production images and the deploy pipeline **never** invoke the demo seed. `.env.production.example` sets `NODE_ENV="production"`. The deployment half was already correct; the seed half had no check to honour it. |

**Root cause.** A development fixture was reachable through a production-capable command. `npm run db:seed` had no notion of environment, so the only thing between a production database and a known-password platform admin was operator discipline. Because the admin upsert also set `isPlatformAdmin` on update, the same command could silently elevate a real account that owned the seeded address. Revision 1 narrowed the window but still treated a missing environment as safe and automated the opt-in.

**Why this is more than the landing page (S-06).** S-06 stopped *publishing* the password. This finding is that the accounts themselves — a mediator who can read every dispute and a platform admin who confirms manual upgrade transfers — exist as soon as the seed runs, and could be created in production by a single command.

---

## 2. Exact implementation

### 2.1 Shared fail-closed guard — `scripts/seed-guard.ts`

Both the seed and the reset wrapper import the same guard, so the two paths cannot drift apart.

```ts
const ALLOWED_ENVIRONMENTS = new Set(["development", "test"]);
const PRODUCTION_ROOTS = ["/app", "/var", "/srv", "/opt", "/mnt", "/data"];

export function demoSeedRefusalReason(env = process.env): string | null {
  const environment = normalise(env.NODE_ENV);
  if (!environment) {
    return "NODE_ENV is not set. Classify the environment explicitly: NODE_ENV=development or NODE_ENV=test.";
  }
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    return `NODE_ENV=${environment} is not a demo environment; only development and test are accepted.`;
  }
  if (normalise(env.SEED_DEMO_DATA) !== "true") {
    return "SEED_DEMO_DATA=true is required. Set it for this one command; it is never applied automatically.";
  }
  const target = classifyDemoSeedTarget(env.DATABASE_URL);
  return target.allowed ? null : target.reason;
}

export function assertDemoSeedAllowed(env = process.env): void {
  const reason = demoSeedRefusalReason(env);
  if (reason) refuseDemoSeed(reason);
}
```

`normalise` strips quotes, trims and lowercases, so `NODE_ENV='"production"'` and `NODE_ENV=" production "` still refuse. Unset, empty, quoted-empty, `develop`, `staging`, `production`, `ci` and `preview` all refuse.

### 2.2 Database-target safeguard (fail-closed heuristic)

`classifyDemoSeedTarget` inspects `DATABASE_URL` **without connecting**:

- An unset URL refuses.
- An unresolved `${…}` interpolation refuses, because the real target cannot be classified.
- Any scheme other than `file:` refuses. A remote production database therefore cannot become eligible merely because someone sets `NODE_ENV=development`.
- Relative SQLite paths are resolved the way Prisma resolves them: from the `prisma/` schema directory.
- A resolved path under `/app`, `/var`, `/srv`, `/opt`, `/mnt` or `/data`, or a filename beginning `prod`/`production`/`live`, refuses.
- A resolved path outside the project root and outside the OS temporary directory refuses.

This is a **heuristic, not proof**. See §7 for the remaining limitation.

### 2.3 Seed entry — `prisma/seed.ts`

```ts
import { assertDemoSeedAllowed } from "../scripts/seed-guard";

assertDemoSeedAllowed();

const prisma = new PrismaClient();
```

The guard is a module-level call **before** `new PrismaClient()`, so a refused run never opens a connection, let alone writes. The admin upsert remains:

```ts
const adminUser = await prisma.user.upsert({
  where: { email: "admin@sellflow.test" },
  update: {}, // never promote or overwrite an existing account
  create: { email: "admin@sellflow.test", passwordHash, emailVerifiedAt: new Date(), isPlatformAdmin: true },
});
```

The closing log is `Done. Four demo accounts created for local development.` No password is printed. The dataset itself is unchanged.

### 2.4 Guarded `db:reset` — `scripts/db-reset.ts`

`prisma migrate reset` drops and recreates the database **before** its seed hook runs. Relying on the seed guard alone would let a production database be destroyed and then left empty. The new wrapper checks the same guard first:

```ts
const reason = demoSeedRefusalReason();
if (reason) {
  refuseDemoSeed(`${reason} Reset is refused before Prisma can drop or recreate the database.`);
}

const reset = spawnSync("npx", ["prisma", "migrate", "reset", "--force", "--skip-seed"], {
  stdio: "inherit",
  env: process.env,
});
if (reset.status !== 0) process.exit(reset.status ?? 1);

const seed = spawnSync("npx", ["tsx", "prisma/seed.ts"], { stdio: "inherit", env: process.env });
process.exit(seed.status ?? 1);
```

`--skip-seed` prevents Prisma from invoking the seed hook implicitly; the explicit seed run then applies the same guard again.

### 2.5 npm scripts

```json
"db:seed":  "prisma db seed",
"db:reset": "tsx scripts/db-reset.ts"
```

`db:seed` no longer sets `SEED_DEMO_DATA`. An operator must type the opt-in deliberately, for example:

```bash
NODE_ENV=development SEED_DEMO_DATA=true DATABASE_URL=file:/tmp/sellflow-demo.db npm run db:seed
NODE_ENV=test        SEED_DEMO_DATA=true DATABASE_URL=file:/tmp/sellflow-demo.db npm run db:reset
```

### 2.6 Isolated harness

`scripts/test-e2e-clean.mjs` seeds its temporary database with an explicit `NODE_ENV: "test"` and `SEED_DEMO_DATA: "true"`. It continues to use its own throwaway file and fingerprints `prisma/dev.db` before and after the run.

### 2.7 Production path unchanged

- `Dockerfile` and `docker-compose.yml` never invoke the demo seed. The `pilot` image is a separate, opt-in onboarding tool (`scripts/seed-pilot.mjs`) that takes credentials from the operator and creates no privileged demo account.
- `scripts/deploy.sh` runs `prisma migrate deploy` only.
- `.env.production.example` sets `NODE_ENV="production"` and contains no `SEED_DEMO_DATA`.
- The production image sets `NODE_ENV=production`, so even an accidental `db:seed` refuses before connecting.

---

## 3. Exact regression tests — 21 assertions

Added to `scripts/verify-api.mjs` in the section “S-15: demo seeding is a development/test tool, never a production one”. The block runs only when the harness `DATABASE_URL` contains `sellflow-e2e-`, and it uses a **fresh migrated SQLite file under `/tmp`** plus a separate reset database. It never touches `prisma/dev.db`.

| # | Assertion | Expected | Result |
|---|---|---|---|
| 1 | `NODE_ENV=production` refuses seeding | non-zero exit, 0 users | PASS |
| 2 | `NODE_ENV=staging` refuses seeding | non-zero exit, 0 users | PASS |
| 3 | Unset `NODE_ENV` refuses seeding | non-zero exit, 0 users | PASS |
| 4 | Empty `NODE_ENV` refuses seeding | non-zero exit, 0 users | PASS |
| 5 | Malformed `NODE_ENV=develop` refuses seeding | non-zero exit, 0 users | PASS |
| 6 | Quoted-empty `NODE_ENV='""'` refuses seeding | non-zero exit, 0 users | PASS |
| 7 | Development without `SEED_DEMO_DATA` refuses | non-zero exit, 0 users | PASS |
| 8 | Test without `SEED_DEMO_DATA` refuses | non-zero exit, 0 users | PASS |
| 9 | Non-true opt-in (`SEED_DEMO_DATA=yes`) refuses | non-zero exit, 0 users | PASS |
| 10 | `npm run db:seed` no longer opts in automatically | non-zero exit, 0 users | PASS |
| 11 | Guard runs before Prisma connects | refusal, no `P1003`/connection error | PASS |
| 12 | Production-shaped target (`file:/app/data/prod.db`) refuses even with `NODE_ENV=development` | refusal | PASS |
| 13 | Non-file target refuses and does not echo credentials | refusal, secret absent from output | PASS |
| 14 | Every refused run leaves the database byte-identical | SHA-256 unchanged | PASS |
| 15 | Opted-in development seed creates the four demo accounts | exit 0, 4 users, admin privileged, mediator present | PASS |
| 16 | Opted-in test seed succeeds | exit 0, 4 users | PASS |
| 17 | Opted-in reseed does not overwrite or promote an existing admin | exit 0, sentinel hash and `isPlatformAdmin: false` preserved | PASS |
| 18 | `npm run db:reset` refuses in production and leaves the database untouched | refusal, sentinel row survives, SHA-256 unchanged | PASS |
| 19 | `npm run db:reset` requires explicit opt-in and leaves the database untouched | refusal, sentinel row survives, SHA-256 unchanged | PASS |
| 20 | Opted-in `npm run db:reset` drops and reseeds a disposable database | exit 0, 4 users, sentinel gone | PASS |
| 21 | Production deployment path never invokes demo seeding | no seed reference in `scripts/deploy.sh`, `docker-compose.yml`, `Dockerfile`, `.env.production.example` | PASS |

**Coverage of the required proofs:**

| Required proof | Assertions |
|---|---|
| Production refuses | 1 |
| Staging refuses | 2 |
| Missing or empty `NODE_ENV` refuses | 3, 4 (plus malformed 5, quoted-empty 6) |
| Development without opt-in refuses | 7, 10 |
| Test without opt-in refuses | 8 |
| Opted-in development succeeds | 15 |
| Opted-in test succeeds | 16 |
| Refused runs create no accounts and make no database changes | 1–14 (user count plus byte-identical hash) |
| Existing admin accounts are not promoted or overwritten | 17 |
| `db:reset` cannot bypass the guard | 18, 19, 20 |
| Production deployment does not invoke demo seeding | 21 |

**Test mechanics.** Child processes are asynchronous (`promisify(execFile)`) so the event loop stays free for the later PWA checks. Each case receives a controlled `NODE_ENV`, `SEED_DEMO_DATA` and `DATABASE_URL`. The guard database is migrated with `prisma migrate deploy`, hashed with SHA-256 before the refusal cases, and hashed again afterwards. The reset database gets a sentinel user before the refused `db:reset` cases and is checked for the sentinel plus an unchanged hash. Both temporary directories are removed in a `finally`.

---

## 4. Evidence

### 4.1 Refusal behaviour

The suite output includes:

```text
PASS  NODE_ENV=production refuses demo seeding (S-15) — exit 1, users 0
PASS  NODE_ENV=staging refuses demo seeding (S-15) — exit 1
PASS  an unset NODE_ENV refuses demo seeding (S-15) — exit 1
PASS  an empty NODE_ENV refuses demo seeding (S-15) — exit 1
PASS  a malformed NODE_ENV refuses demo seeding (S-15) — exit 1
PASS  a quoted-empty NODE_ENV refuses demo seeding (S-15) — exit 1
PASS  development without the operator opt-in refuses demo seeding (S-15) — exit 1
PASS  test without the operator opt-in refuses demo seeding (S-15) — exit 1
PASS  a non-true opt-in value refuses demo seeding (S-15) — exit 1
PASS  npm run db:seed no longer opts in on its own (S-15) — exit 1
PASS  the guard refuses before Prisma tries to connect (S-15) — exit 1
PASS  a production-shaped database target is refused even in development (S-15) — exit 1
PASS  a non-file database target is refused and its credentials are not echoed (S-15) — exit 1
PASS  every refused run left the database byte-identical (S-15) — sha256 beb1b4ee887a
```

The byte-identical hash is the guard database's own SHA-256 after migration, not the project database. It proves the refusal cases did not write.

### 4.2 Success and reset behaviour

```text
PASS  an opted-in development seed still creates the demo accounts (S-15) — exit 0, accounts 4
PASS  an opted-in test seed still succeeds (S-15) — exit 0
PASS  an opted-in reseed neither overwrites nor promotes an existing admin (S-15) — exit 0, admin {"passwordHash":"sentinel-hash","isPlatformAdmin":false}
PASS  db:reset refuses in production and leaves the database untouched (S-15) — exit 1
PASS  db:reset requires an explicit opt-in and leaves the database untouched (S-15) — exit 1
PASS  an opted-in db:reset drops and reseeds a disposable database (S-15) — exit 0, users 4
PASS  the production deployment path never invokes demo seeding (S-15)
```

The refused `db:reset` cases preserve both the sentinel user and the database hash, proving the wrapper stops before Prisma can drop anything.

### 4.3 Revision 1 evidence (historical)

Revision 1 recorded `pass=202 fail=5` against the unmodified application: a production seed exited 0 and created four accounts. That evidence is preserved in Appendix A. It is **not** evidence for revision 2; revision 2's evidence is the 21 assertions above.

---

## 5. Verification results

| Check | Command | Result |
|---|---|---|
| New S-15 assertions | inside `npm run test:e2e:clean` | **21 / 21 pass** |
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | inside `npm run test:e2e:clean` (`npm run build` against the temp DB) | **exit 0** |
| API suite | `scripts/verify-api.mjs` | **221 / 221 pass** (includes its embedded PWA pass) |
| PWA suite | `scripts/verify-pwa.mjs` | **31 / 31 pass** |
| Combined | `npm run test:e2e:clean` | **252 PASS, 0 FAIL**, exit 0, 128.4 s |
| Isolation | canary workspace + `/proc` `DATABASE_URL` check | both passed |
| Prior findings | S-02, S-06, S-08 assertions | all still pass |
| Existing servers | harness used its own port and stopped only its own process group | no existing server signalled |

```text
harness_exit=0
API suite PASS: 221
standalone PWA PASS: 31
total PASS: 252
FAIL: 0
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 128.4s (isolated DB, api=0, pwa=0)
```

The combined count is 252 PASS lines: 221 from the API suite (which ends with its own PWA checks) plus 31 from the standalone PWA suite. The 21 S-15 assertions are inside the 221. The increase from revision 1's 238 total is 14 new S-15 assertions (revision 1 had 7).

---

## 6. Database fingerprint

| Evidence | Value |
|---|---|
| `sha256sum prisma/dev.db` before and after | `522a35fcabbf71627fe22baf4716b9e9b18dca01af42924b7a41a941d3aff182` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` against `prisma/dev.db` | **not run** |
| Seed-guard databases | `mkdtemp` under `/tmp`, removed by the test block |
| `prisma/dev.db` writes during verification | none |

---

## 7. Remaining limitations

1. **The target check is a heuristic, not proof.** A production SQLite file placed inside the project or `/tmp` with an innocuous filename cannot be distinguished from a disposable database by URL inspection alone. Remote schemes and production-shaped paths are refused, but a local file that is actually production cannot be proven disposable. The guard fails closed for every target it cannot classify; operators must still keep production databases outside the project and temporary directories.
2. **Direct `npx prisma migrate reset --force` is outside the wrapper.** The seed hook still refuses to create demo accounts, but Prisma would already have dropped the database. Only `npm run db:reset` is guarded *before* the reset. Treat raw Prisma reset as a destructive operator command and never point it at production.
3. **Already-seeded databases are not cleaned up.** A database that already contains `admin@sellflow.test` and `mediator@sellflow.test` with `Password123!` stays compromised. The task forbids automatic deletion of existing users. Before any real pilot, an operator must confirm those rows are absent (or delete/rotate them deliberately) on the target database.
4. **The password is still in the repository and its history**, in `prisma/seed.ts`, the scripts and the Stage 1 report. The guard prevents *creating* the accounts in production; it does not make the string unusable if an account already exists.
5. **The guard is a code check, not a database constraint.** Someone with commit access can delete it, and a database restored from a seeded backup has no marker saying “demo data”. A production-side boot check (refuse to start when a known demo admin exists) would be stronger, but it is a behaviour change outside S-15.
6. **`scripts/deploy.sh` runs `npm run test:e2e` against the live deployment** (step 3, skipped with `SKIP_E2E=1`). That suite expects the demo fixtures, so a real production deployment with the gate enabled will fail once the seed is absent. This mismatch pre-dates S-15 and is not changed here; it should be resolved by separating production smoke tests from the demo-fixture suite. The production path still does not *invoke* demo seeding.
7. **The pilot seeder is the intended production path** and takes credentials from the operator, but it is an interactive/compose-profile tool; there is no automated first-admin bootstrap, so an operator still creates the first privileged account manually.
8. **Phase 0 is still incomplete.** S-05, S-09, S-10, S-11, S-12, S-13, S-14 and the rest remain open. S-15 being revised does not resolve any other finding or validate the product.

---

## 8. Exact list of changed files

| File | Change |
|---|---|
| `scripts/seed-guard.ts` | **New.** Shared fail-closed environment, opt-in and database-target guard used by both the seed and the reset wrapper. |
| `scripts/db-reset.ts` | **New.** Guarded `db:reset` wrapper: pre-reset environment/target check, `prisma migrate reset --force --skip-seed`, then an explicit guarded seed. |
| `prisma/seed.ts` | Imports `assertDemoSeedAllowed` from the shared guard and calls it before `new PrismaClient()`. Removed the local guard. Admin upsert remains `update: {}`; no credential output; dataset unchanged. |
| `package.json` | `"db:seed": "prisma db seed"` (no automatic opt-in); `"db:reset": "tsx scripts/db-reset.ts"`. No dependency changes. |
| `scripts/verify-api.mjs` | Replaced the 7 revision-1 assertions with 21 S-15 regression assertions covering environment classification, opt-in, target classification, byte-identical refusal, admin non-promotion, the guarded reset wrapper and the production deployment path. |
| `scripts/test-e2e-clean.mjs` | Unchanged in this revision; already seeds the temp database with `NODE_ENV=test` and `SEED_DEMO_DATA=true`. |
| `STAGE2_TASK4B_S15_REPORT.md` | This revision 2 report. |

**Not changed:** `prisma/schema.prisma`, migrations, dependencies, billing/entitlements/C-03, auth routes, `scripts/deploy.sh`, `docker-compose.yml`, `Dockerfile`, `scripts/seed-pilot.mjs`, other findings, `prisma/dev.db`.

---

## Appendix A — Revision 1 history (preserved)

Revision 1 (2026-11-04) added a local `assertDemoSeedAllowed()` to `prisma/seed.ts`:

```ts
const environment =
  (process.env.NODE_ENV ?? "").replace(/["']/g, "").trim().toLowerCase() || "development";

if (environment === "production" || environment === "staging") {
  refuseDemoSeed(`NODE_ENV=${environment} looks like a deployed environment.`);
}
if (environment !== "development" && environment !== "test") {
  refuseDemoSeed(`NODE_ENV=${environment} is not a known development or test environment.`);
}
if ((process.env.SEED_DEMO_DATA ?? "").trim().toLowerCase() !== "true") {
  refuseDemoSeed("SEED_DEMO_DATA=true is required to confirm a disposable demo database.");
}
```

It also set the npm scripts to opt in automatically:

```json
"db:seed":  "SEED_DEMO_DATA=true prisma db seed",
"db:reset": "SEED_DEMO_DATA=true prisma migrate reset --force"
```

Revision 1's 7 assertions were:

1. A production seed run is refused.
2. A refused production seed creates no accounts.
3. A production-classified database has no known privileged account.
4. Seeding without explicit confirmation is refused.
5. Development/test seeding still creates the demo accounts.
6. A refused seed leaves existing privileged accounts untouched.
7. The deploy pipeline never invokes the demo seed.

Its recorded evidence against the unmodified application was `pass=202 fail=5`, with `NODE_ENV=production` exiting 0 and creating four accounts. That evidence remains historically accurate for the pre-fix code.

**Why it was superseded.** The `|| "development"` fallback made an unset `NODE_ENV` safe, the npm scripts automated the opt-in, and `db:reset` still called Prisma directly. Revision 2 removes all three weaknesses and adds the database-target and reset-path coverage above.

---

**S-15 revision 2 complete. Stopping for review; S-13 and S-05 have not been started. Phase 0 remains incomplete and no validation GO is claimed.**
