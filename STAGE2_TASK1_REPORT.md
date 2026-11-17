# SellFlow — Stage 2, Task 1: Isolated Test Harness Report

**Date:** 2026-11-04
**Authorization:** Implementation GO, D-019 (2026-11-04). Phase 0 validation remains incomplete.
**Scope:** Testing infrastructure only. No security finding was fixed, no product feature was added, no schema, migration, dependency or application behaviour was changed.
**Deliverable:** `npm run test:e2e:clean` — a one-command run of the API and PWA suites against a throwaway database.

---

## 1. Files changed

| File | Change |
|---|---|
| `scripts/test-e2e-clean.mjs` | **New.** The isolated harness: temp DB lifecycle, migrations, seed, build, free-port selection, app start, isolation proofs, both suites, teardown. |
| `package.json` | Added `"test:e2e:clean": "node scripts/test-e2e-clean.mjs"`. No dependency changes. |
| `STAGE2_TASK1_REPORT.md` | **New.** This report. |

Not touched: `src/**`, `public/**`, `prisma/schema.prisma`, `prisma/migrations/**`, `prisma/seed.ts`, `prisma/dev.db`, `scripts/verify-api.mjs`, `scripts/verify-pwa.mjs`, `scripts/pwa-checks.mjs`, lockfiles, Docker/deploy files, documentation decisions.

---

## 2. Testing architecture

### 2.1 Problem this solves

Before this task the only automated checks were `verify-api.mjs` (run against whatever server is on `BASE_URL`, mutating that server's data) and `verify-pwa.mjs` (builds/boots its own server but uses the default `DATABASE_URL`). Both therefore depended on `prisma/dev.db` being in a clean seeded state. Stage 1 hit exactly that failure: a run against previously mutated data reported 13 false failures, and one accidental run against a pre-existing server mutated `dev.db`.

### 2.2 Harness lifecycle

```
npm run test:e2e:clean
  ├─ 1. fingerprint prisma/dev.db (sha256 + size + mtime)          ← baseline, never written
  ├─ 2. mkdtemp(os.tmpdir()/sellflow-e2e-*)  → <tmp>/test.db       ← unique per run
  ├─ 3. DATABASE_URL = file:<tmp>/test.db (absolute)
  ├─ 4. npx prisma migrate deploy                                  ← temp DB only
  ├─ 5. npx tsx prisma/seed.ts                                     ← temp DB only
  ├─ 6. canary write: reseller workspace renamed HARNESS-<token>   ← temp DB only
  ├─ 7. npm run build  (skippable)  → .next                        ← app bundle
  ├─ 8. free port chosen via bind(0) + ss check
  ├─ 9. npx next start -p <port>, env DATABASE_URL=<tmp>, NODE_ENV=production, detached
  ├─ 10. GET /api/health until 200 (≤90 s)
  ├─ 11. isolation proof 1: POST /api/auth/login → workspace.name === canary
  ├─ 12. isolation proof 2: listener PID from ss → /proc/<pid>/environ DATABASE_URL === temp URL
  ├─ 13. node scripts/verify-api.mjs  (BASE_URL=<port>, DATABASE_URL=<tmp>)
  ├─ 14. node scripts/verify-pwa.mjs  (DATABASE_URL=<tmp>, PWA_PORT=<second free port>)
  ├─ 15. stop the harness process group (TERM → KILL), wait for the port to close
  ├─ 16. fingerprint prisma/dev.db again; any change fails the run
  └─ 17. rm -rf <tmp> (unless --keep)
```

### 2.3 Why the isolation proofs matter

A green suite proves nothing if the app is talking to the wrong file. Two independent checks are enforced and **fail closed**:

1. **Canary through the application.** The harness renames the seeded reseller's workspace to `HARNESS-<random>` directly in the temp database, then logs in through the running app. The login response must return that exact name. If the app were reading `dev.db`, the name would be `Amaka Beauty Store` and the run aborts.
2. **Operating-system truth.** The PID that owns the listening port is resolved from `ss -ltnp`, and its `DATABASE_URL` is read from `/proc/<pid>/environ`. It must equal `file:<temp path>`. If `/proc` is unreadable (non-Linux), the check is reported as skipped rather than silently passing.

The project database is additionally fingerprinted by SHA-256 before and after; any byte change marks the run failed.

### 2.4 Safety properties

| Requirement | How it is enforced |
|---|---|
| Never touch `prisma/dev.db` | All Prisma commands run with `DATABASE_URL=file:<tmp>`; the harness asserts the resolved temp path is not the project path; the SHA-256 before/after must match |
| No reset/seed of project data | The harness never calls `db:reset` or `db:seed`; it calls `migrate deploy` and `tsx prisma/seed.ts` with the temp URL only |
| Never kill existing servers | Only the process group created by `spawn(..., {detached: true})` is signalled (`process.kill(-pid)`); no name/pattern kills, no port-based kills |
| Never assume a port is free | `listen(0)` reserves a kernel-assigned port, then `ss -ltn` confirms it is free; a second port is chosen the same way for the PWA suite |
| Fail closed | Missing health, missing canary match, unreadable expected state, non-zero suite exit, or a changed project DB all exit non-zero |
| Clean up | Temp directory removed unless `--keep`; the harness verifies the port is released |

---

## 3. Commands introduced

| Command | Behaviour |
|---|---|
| `npm run test:e2e:clean` | Full run: create temp DB → migrate → seed → build → start app → isolation proofs → API suite → PWA suite → teardown |
| `npm run test:e2e:clean -- --skip-build` | Same, reusing the existing `.next` build (fails if no build exists) — for fast iteration |
| `npm run test:e2e:clean -- --keep` | Keeps the temp directory (database + server output) for debugging; prints the path |

Existing commands are unchanged: `npm run test:e2e` still targets an externally supplied `BASE_URL`, and `npm run test:pwa` still verifies a build it boots itself.

---

## 4. Database isolation evidence

### Run A — full run with build

```
[harness] project database: prisma/dev.db sha256=522a35fcabbf
[harness] temp database: /tmp/sellflow-e2e-XGIqoR/test.db
[harness] DATABASE_URL pinned to: file:/tmp/sellflow-e2e-XGIqoR/test.db
[harness] applying migrations to the temp database
[harness] seeding the temp database
[harness] building the production bundle against the temp database
[harness] starting the app on 127.0.0.1:40425
[harness] app healthy: 1.0.0 (production) db=724ms
[harness] isolation check 1 passed: canary workspace "HARNESS-MW1AIV3L" served from the temp database
[harness] isolation check 2 passed: pid 1067302 DATABASE_URL matches the temp file
[harness] running the API suite against the temp database
ALL CHECKS PASSED
[harness] running the PWA suite against the temp database
PWA CHECKS PASSED
[harness] stopping the harness server (process group only)
[harness] port 40425 released
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] temp database and artifacts removed
[harness] PASSED in 120.1s (isolated DB, api=0, pwa=0)
```

### Run B — skip-build + keep (fast path)

```
[harness] temp database: /tmp/sellflow-e2e-XnFANq/test.db
[harness] reusing the existing .next build (--skip-build)
[harness] starting the app on 127.0.0.1:40795
[harness] app healthy: 1.0.0 (production) db=731ms
[harness] isolation check 1 passed: canary workspace "HARNESS-MW1ALPNP" served from the temp database
[harness] isolation check 2 passed: pid 1068366 DATABASE_URL matches the temp file
[harness] running the API suite against the temp database
[harness] running the PWA suite against the temp database
[harness] port 40795 released
[harness] project database untouched: sha256=522a35fcabbf size=589824
[harness] keeping artifacts: /tmp/sellflow-e2e-XnFANq
[harness] PASSED in 20.1s (isolated DB, api=0, pwa=0)
```

### Independent confirmation

| Check | Before | After Run A | After Run B |
|---|---|---|---|
| `md5sum prisma/dev.db` | `2ee44e7855bc5442c6e9c0d535eb8f0d` | same | same |
| size / mtime | `589824` / `1793746202` | same | same |
| Temp DB path | — | `/tmp/sellflow-e2e-XGIqoR/test.db` (removed) | `/tmp/sellflow-e2e-XnFANq/test.db` (removed by hand after inspecting) |
| Distinct ports used | — | app `40425`, PWA auto-selected | app `40795`, PWA auto-selected |

Pre-existing servers were verified alive after both runs and were never signalled:

```
0.0.0.0:3000   node            pid 2802      (unrelated project)
*:4318         next-server     pid 1057494   (this project's preview)
*:4322         next-server     pid 927563    (pre-existing, Stage 1 finding)
```

No `sellflow-e2e-*` directory remained after cleanup. Note: `find -newermt` flags `prisma/dev.db` because that file's mtime is later than the container clock; the authoritative evidence is the identical SHA-256/md5, size and mtime value (`1793746202`) before and after both runs.

---

## 5. Test results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **exit 0**, no diagnostics |
| Production build | `npm run build` (inside Run A, against temp DB) | **exit 0** |
| API suite | `scripts/verify-api.mjs` on temp DB | **135 / 135 passed**, exit 0 |
| PWA suite | `scripts/verify-pwa.mjs` on temp DB | **31 / 31 passed**, exit 0 |
| Harness | `npm run test:e2e:clean` | **PASSED**, 120.1 s |
| Harness (fast) | `npm run test:e2e:clean -- --skip-build --keep` | **PASSED**, 20.1 s |
| Project DB integrity | SHA-256 before/after | identical (`522a35fcabbf…`) |
| Existing servers | `ss -ltnp` before/after | all three still listening |

Total assertions exercised per full run: **166** (135 API + 31 PWA), all passing.

---

## 6. Limitations and unresolved issues

1. **The build rewrites `.next` while other servers may be running from it.** `npm run build` inside the harness (and `--build` in `test:pwa`) replaces the bundle that the preview on `:4318` and the pre-existing server on `:4322` are serving. Those processes stayed up in both runs, but a long-lived server can serve a mixed old/new chunk set mid-build. Use `--skip-build` while a preview matters, or stop such servers first. The harness cannot detect foreign servers safely enough to refuse, because it must not inspect or kill them.
2. **Port selection has a small race.** A port is reserved with `listen(0)`, released, then re-checked with `ss`; another process could claim it in between. The harness fails loudly (health never becomes OK, server exits) rather than silently testing the wrong app.
3. **Isolation proof 2 is Linux-only.** Without `/proc/<pid>/environ` the check is reported as skipped, leaving proof 1 (canary) as the enforced gate. Both are Linux-verified here.
4. **`--keep` requires manual cleanup.** It intentionally preserves the temp database and server output; the report records the path. Both kept directories from this task were removed.
5. **Seeding uses the demo seed as-is**, including the shared demo password and privileged demo accounts (S-06/S-15). This is deliberate for Task 1: changing seed credentials is a security fix, not test infrastructure, and must be done in its own task with its own verification.
6. **No new assertions were added.** The harness runs the existing suites unchanged, so the security gaps documented in Stage 1 (`scope=all`, claim self-confirmation, status jumps, stock, min-resale, Origin, lockout) are still **not covered by tests** and remain open. This was required: Task 1 must not implement fixes.
7. **SQLite concurrency.** The suite is sequential; parallel test files against one SQLite file would contend for the single writer. Not needed today, noted for future CI sharding.
8. **CI is not wired.** The command is CI-ready (no interactive prompts, non-zero exit on failure) but no pipeline file was added; that belongs to a later infrastructure task.

---

## 7. Statement of scope

- No application code, schema, migration, dependency, seed or project database was modified.
- No security finding (S-01 … S-15) was fixed, downgraded, marked resolved, or altered in any documentation.
- No product feature was implemented.
- The harness is additive: existing `test:e2e`, `test:pwa`, `verify`, `deploy` behaviour is unchanged.

**Task 1 complete. Stage 2 Task 2 (S-01) has not been started.**
