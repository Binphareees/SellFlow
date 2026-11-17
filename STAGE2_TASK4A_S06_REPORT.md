# SellFlow — Stage 2, Task 4A: S-06 (Public Demo Credentials) Report

**Date:** 2026-11-04
**Scope:** S-06 only. S-15 and S-13 were not started. No schema, migration, dependency, billing or entitlement change. Phase 0 remains incomplete; nothing here means SellFlow is pilot-safe.

---

## 1. Root cause and affected files

| File | Role in the defect |
|---|---|
| `src/app/page.tsx` (lines 73–82) | The signed-out landing page carried a "Try the demo" card printing `reseller@sellflow.test`, `supplier@sellflow.test` and the password `Password123!` in plain HTML. It was server-rendered and shipped verbatim to every visitor, including production. |
| `prisma/seed.ts` | Creates four accounts — supplier, reseller, mediator, platform admin — all sharing `Password123!`, and prints the password to the console when the seed finishes. |
| `scripts/verify-api.mjs`, `scripts/test-e2e-clean.mjs` | Authenticate against the seeded accounts with that password. These are the isolated automated fixtures, not a public surface. |
| `STAGE1_ARCHITECTURE_REPORT.md` | Documents the finding and recommends "generate a per-seed random password printed once to the console; force change on first login". That recommendation is a behavioural change to seeding and authentication; it is **not** implemented here (see §6). |

**Root cause.** Demo credentials were treated as onboarding copy. The landing page is a public, unauthenticated page whose HTML is served to anyone, so a shared password for four accounts — one of them a platform admin and another a mediator — was published to every visitor. The page had no build-time or environment gate, so the same string would ship to production as long as the local dataset was the deployed one.

**Exposure surface as verified:** `GET /` returned `200` with both the email address and `Password123!` in the HTML body. The accounts exist whenever the seed has run against the database the app is using.

---

## 2. Tests first — 5 assertions

Added to `scripts/verify-api.mjs` in two places:

**Guest block** (before any login, so the request is genuinely unauthenticated):

| # | Assertion | Expected |
|---|---|---|
| 1 | The landing page renders for signed-out visitors | `200` and the hero headline present |
| 2 | The landing page publishes no demo credentials | `200` and no `Password123!`, no `reseller@sellflow.test`, no `supplier@sellflow.test` |
| 3 | Public API responses carry no seeded credentials | `/api/health`, `/api/marketplace/suppliers`, `/api/marketplace/listings` all `200`; no password, no seeded address (`reseller@`, `supplier@`, `mediator@`, `admin@`), no `passwordHash` field |

**Fixture block** (next to the existing logins):

| # | Assertion | Expected |
|---|---|---|
| 4 | Isolated test fixtures can still sign in | both cookies obtained |
| 5 | A wrong password is still rejected | `401`, no session cookie |

Assertion 1 covers "removing the credentials does not break landing-page rendering"; assertion 4 covers "automated tests can still authenticate"; assertion 5 covers "existing legitimate authentication continues working" on the negative path, while the whole pre-existing suite (price gate, order lifecycle, admin flows) exercises the positive path under the same fixtures.

---

## 3. Evidence of failures before the fix

`npm run test:e2e:clean -- --skip-build` against the **unmodified** application:

```
harness_exit=1
pass=199 fail=1

PASS  the landing page renders for signed-out visitors — status 200
FAIL  the landing page publishes no demo credentials (S-06) — status 200
PASS  public API responses carry no seeded credentials (S-06) — 200, 200, 200
PASS  isolated test fixtures can still sign in (S-06)
PASS  a wrong password is still rejected — status 401
```

All 200 API checks ran; the single failure is the disclosure. The other four passing first time are the guard rails: the page renders, no API leaks the fixtures, fixtures still authenticate, and bad passwords are still refused.

---

## 4. Exact implementation

**Only change in application code:** the "Try the demo" section was removed from `src/app/page.tsx`.

```diff
-        <section className="card mt-16">
-          <div className="card-title">Try the demo</div>
-          <p className="tiny muted mt-12">
-            Seeded accounts for local development: <span className="mono">reseller@sellflow.test</span> and{" "}
-            <span className="mono">supplier@sellflow.test</span>, both with password{" "}
-            <span className="mono">Password123!</span>
-          </p>
-        </section>
```

Decisions behind that minimal edit:

- **Nothing public replaces it.** The credentials are not swapped for a "demo" account, a banner, or another shared password. The remaining copy describes the product, not logins.
- **Demo functionality is preserved.** `prisma/seed.ts` still creates the same four accounts with the same password, so `npm run db:seed`, manual local walkthroughs and every automated fixture keep working unchanged. No random password generation and no forced reset was added: the app has no password-change or reset flow (S-09), so "print once and force change" would strand the demo accounts and every test fixture — the Stage 1 recommendation is recorded as a follow-up, not silently half-built.
- **No UI-side masking.** The string is absent from the server-rendered HTML, not hidden with CSS or a client conditional.
- **Public API responses were already clean.** Nothing was added there; the new test locks that in.

---

## 5. Verification

| Check | Command | Result |
|---|---|---|
| New S-06 assertions | inside `test:e2e:clean` | **5 / 5 pass** |
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | inside `test:e2e:clean` (shared `.next`) | **exit 0** |
| API suite | `scripts/verify-api.mjs` | **200 / 200** |
| PWA suite | `scripts/verify-pwa.mjs` | **31 / 31** |
| Combined | `npm run test:e2e:clean` | **PASSED**, 214.1 s, exit 0 |
| Isolation | canary workspace + `/proc` `DATABASE_URL` | both passed |
| Credential string in built output | `grep -rl "Password123!" .next/server .next/static` | **no matches** |
| Credential string in `src/` | `grep -rn "Password123!" src/` | **no matches** |
| Pre-existing servers | `ss -ltnp` after the run | `:3000` pid 2802, `:4318` pid 1057494, `:4322` pid 927563 — all still listening, none signalled |

```
harness_exit=0
pass=231 fail=0
ALL CHECKS PASSED
PWA CHECKS PASSED
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] PASSED in 214.1s (isolated DB, api=0, pwa=0)

PASS  the landing page renders for signed-out visitors — status 200
PASS  the landing page publishes no demo credentials (S-06) — status 200
PASS  public API responses carry no seeded credentials (S-06) — 200, 200, 200
PASS  isolated test fixtures can still sign in (S-06)
PASS  a wrong password is still rejected — status 401
```

Totals: **231 assertions** (200 API + 31 PWA), 0 failures — the 226 from S-08 plus the 5 new ones.

**Stale in-memory page (important).** The pre-existing preview server on `:4318` (pid 1057494) still returns the old HTML: `next start` holds the previous build's modules in memory after a rebuild, so `curl http://127.0.0.1:4318/` still shows `Password123!`. The freshly built output on disk (`.next/server`, `.next/static`) contains neither the password nor the seeded addresses. That process is a pre-existing service this task must not stop, so it was left running; **the credential text disappears from that URL the next time it is restarted**. Do not read this as the app still leaking from a current build.

---

## 6. Database fingerprint

| Evidence | Value |
|---|---|
| `md5sum prisma/dev.db` before and after | `2ee44e7855bc5442c6e9c0d535eb8f0d` (identical) |
| Size / mtime | `589824` / `1793746202` (identical) |
| Harness SHA-256 before/after | `522a35fcabbf…` (identical) |
| `npm run db:reset` | **not run** |
| Test-run data | only in `/tmp/sellflow-e2e-*/test.db`, deleted by the harness |

---

## 7. Limitations and remaining concerns

1. **The accounts still exist with a shared password.** Removing the landing copy stops publication, not the risk: if a production deployment is ever seeded with `prisma/seed.ts`, four accounts — including a platform admin — exist with a password that is written in the repository (`prisma/seed.ts`), printed by the seed (`Done. Sign in with … password Password123!`), and present in git history. A pilot must not run this seed against production data; the durable fix is a non-demo seed/account path and a credential that is not committed.
2. **Seeding still logs the password.** That output is a local console line, not a public response or a client bundle, so it was left alone — changing seed behaviour is outside S-06.
3. **Repository and report references remain.** `STAGE1_ARCHITECTURE_REPORT.md`, `scripts/verify-api.mjs` and `scripts/test-e2e-clean.mjs` still name the fixtures. They are test documentation, not application surface, and the tests need them.
4. **Git history still contains the published string.** Any clone of the repository before this commit can recover it. Rotating the fixture password is only meaningful together with a non-public seed workflow.
5. **No password reset or change flow exists (S-09).** Until it does, "force a change on first login" cannot be implemented without stranding the demo accounts.
6. **Client and CDN caches.** Visitors or crawlers that fetched the old landing page may hold a cached copy; the fix applies to new responses and the next build.
7. **No automated check on the client bundle.** The tests assert the rendered HTML and public JSON; a future component that inlines credentials into a client chunk would pass today's test only if it also renders in HTML. `.next/static` was checked manually here.
8. **Connected preview servers keep their old build** until restarted, as described in §5.

---

## 8. Exact list of changed files

| File | Change |
|---|---|
| `src/app/page.tsx` | Removed the "Try the demo" card that published `reseller@sellflow.test`, `supplier@sellflow.test` and `Password123!`. No other copy, layout or redirect behaviour changed. |
| `scripts/verify-api.mjs` | 5 S-06 assertions: landing page renders; landing page contains no demo credentials; public API responses contain no seeded credentials or password hashes; seeded test fixtures still sign in; wrong passwords still return `401`. |
| `STAGE2_TASK4A_S06_REPORT.md` | This report. |

Not changed: `prisma/seed.ts`, `prisma/schema.prisma`, migrations, dependencies, billing/entitlements, auth routes, other pages, other findings, `prisma/dev.db`.

**S-06 fix complete. Stopping for review; S-15 and S-13 have not been started.**
