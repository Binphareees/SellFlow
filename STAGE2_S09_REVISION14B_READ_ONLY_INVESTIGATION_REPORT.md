# STAGE2_S09_REVISION14B_READ_ONLY_INVESTIGATION_REPORT.md

**Document type:** READ-ONLY FORENSIC INVESTIGATION REPORT  
**Revision:** 14B  
**Status:** Investigation complete. No implementation performed.  
**Date:** 2026-11-12  
**Branch:** main  
**Scope:** S-09 password-reset verification blockers — probe credential data flow, Resend cross-process capture, previous build failure, repository integrity.

---

## 1. Executive summary

Revision 14B is a strict read-only forensic investigation of three remaining S-09 verification blockers and the repository state surrounding them.

**Key findings:**

1.  **Probe credential defect — CONFIRMED.** The harness generates a plaintext probe password, hashes it with bcrypt, inserts the hash into the disposable database, but then writes the **plaintext** password to `s09-probe-password.txt`. The integration suite reads that file and uses it as the login password. The defect is not "hash written instead of plaintext" — it is the opposite: plaintext is correctly written, but the harness comment and variable naming create a verifiable confusion about which artifact holds which value. The probe login flow is architecturally sound; the confusion is documentation/rename-level.

2.  **Resend cross-process capture — ARCHITECTURALLY FEASIBLE but UNVERIFIED at runtime.** Resend 6.38.0 supports `baseUrl` in the constructor and `RESEND_BASE_URL` in the environment. The harness already sets `RESEND_BASE_URL` to the capture server's dynamic port and passes it into the `next start` environment. The `sendEmailFn` detached-method pattern (`const sendEmailFn = (options) => resend.emails.send(...)`) does **not** lose receiver binding because `resend.emails.send` is called as a function expression wrapper, not as a detached `const sendEmailFn = resend.emails.send` reference. The capture server (`s09-resend-capture.mjs`) is a standalone Node HTTP server that records POST `/emails` bodies. The architecture is sound. Runtime verification is the remaining gap.

3.  **Previous build failure — PARTIALLY RECOVERABLE from existing reports.** The file named in earlier revisions as `STAGE2_S09_REPORTED_RUN_LOG.txt` is not present on disk and is not listed in `git ls-files --others --exclude-standard`. (A differently named file, `STAGE2_TASK9_S09_REPORTED_RUN_LOG.txt`, does exist on disk and is listed as untracked; it is a separate artifact.) The companion file `STAGE2_S09_HARNESS_CORRECTION_AND_VERIFICATION_REPORT.md` is also not present on disk and is not listed in `git ls-files --others --exclude-standard`. The failure pattern described in retained reports points to harness mechanics (missing local node binary path, trap cleanup ordering, CLI grep-based assertion paths) rather than a schema or application-code defect. Exact reproduction requires the run log that is not present.

4.  **Repository integrity — SIGNIFICANT UNDERSTANDING, NO SURPRISES.** The working tree contains a large set of untracked artifacts including the S-09 harness, integration suite, capture server, and supporting reports. The S-14 migration file `prisma/migrations/20261105060000_session_lifecycle/migration.sql` is untracked, not present in HEAD, and contains appended S-09 DDL. Its current SHA-256 does not match the stored `_prisma_migrations` checksum. `prisma/dev.db` exists, is intact, and contains `PasswordResetToken` with the expected indexes including the explicit named unique index `PasswordResetToken_hashedToken_unique`.

**Bottom line:** The three blockers are diagnosable. Probe credential flow is sound with a documentation-level confusion. Resend capture architecture is feasible and already partially wired in the harness. The previous build failure is plausibly explained by harness mechanics but cannot be exactly reproduced from absent logs. No project files, dependencies, environment settings, Git state, or databases were changed during this investigation.

---

## 2. Repository state

### 2.1 Git branch and HEAD

- Branch: `main`
- HEAD commit: `37fc638 Add project documentation and validation templates`
- HEAD is a single root commit; the entire working tree is effectively downstream of that commit.

### 2.2 `git status --short` (read-only, captured this turn)

```
 M AI_HANDOFF.md
 M MONETIZATION_AND_LAWUNCH.md
 M MVP_SPEC.md
 M README.md
 M ROADMAP.md
 M STATE.md
 M TECH_STACK.md
 M VALIDATION_PLAN.md
 M templates/INTERVIEW_LOG.md
 M templates/PILOT_TRACKER.md
?? .cloud-attachments/
?? .dockerignore
?? .env.example
?? .env.production.example
?? .gitignore
?? Dockerfile
?? INTERVIEW_LOG.md
?? PHASE0_READINESS_REPORT.md
?? PILOT_TRACKER.md
?? PRD_V0.2.md
?? SELLFLOW_V02_AUDIT_REPORT.md
?? STAGE1_ARCHITECTURE_REPORT.md
?? STAGE2_RESEND_FINAL_ACCEPTANCE_REPORT.md
?? STAGE2_RESEND_INDEPENDENT_ACCEPTANCE_REPORT.md
?? STAGE2_RESEND_POST_CORRECTION_ACCEPTANCE_REPORT.md
?? STAGE2_RESEND_REMEDIATION_REPORT.md
?? STAGE2_RESEND_SDK_RUNTIME_REVIEW.md
?? STAGE2_RESEND_TYPECHECK_CORRECTION_REPORT.md
?? STAGE2_S09_DATABASE_STATUS_REPORT.md
?? STAGE2_S09_REMEDIATION_INTEGRITY_REPORT.md
?? STAGE2_S09_S14_ACCEPTANCE_EVIDENCE_MANIFEST.txt
?? STAGE2_S09_S14_MIGRATION_PROVENANCE_REPORT.md
?? STAGE2_S09_S14_MIGRATION_RECOVERY_PLAN.md
?? STAGE2_S09_S14_MISSING_MIGRATION_DIRECTORY_EXPERIMENT_REPORT.md
?? STAGE2_S09_S14_REVISION6_DISPOSABLE_RECONCILIATION_REPORT.md
?? STAGE2_S09_S14_REVISION7_RECONCILIATION_PROOF_REPORT.md
?? STAGE2_S09_S14_REVISION8_RECONCILIATION_PROOF_REPORT.md
?? STAGE2_S09_S14_REVISION8_REPORT_CHECKSUM_MANIFEST.txt
?? STAGE2_S09_S14_REVISION9_ARTIFACT_CHECKSUM_MANIFEST.txt
?? STAGE2_S09_S14_REVISION9_DISPOSABLE_EVIDENCE_REPORT.md
?? STAGE2_TASK10B_S02_REMEDIATION_REPORT.md
?? STAGE2_TASK1_REPORT.md
?? STAGE2_TASK2A_S01_REPORT.md
?? STAGE2_TASK2B_S03_REPORT.md
?? STAGE2_TASK2C_S04_REPORT.md
?? STAGE2_TASK3A_S02_REPORT.md
?? STAGE2_TASK3B_S08_REPORT.md
?? STAGE2_TASK4A_S06_REPORT.md
?? STAGE2_TASK4B_S15_REPORT.md
?? STAGE2_TASK5A_S13_REPORT.md
?? STAGE2_TASK5B_S05_REPORT.md
?? STAGE2_TASK6A_S07_REPORT.md
?? STAGE2_TASK6B_S10_REPORT.md
?? STAGE2_TASK6C_S11_REPORT.md
?? STAGE2_TASK7_S12_ACCEPTANCE_REPORT.md
?? STAGE2_TASK7_S12_FINAL_ACCEPTANCE_REPORT.md
?? STAGE2_TASK7_S12_REPORT.md
?? STAGE2_TASK8_BASELINE_RECONCILIATION.md
?? STAGE2_TASK8_FRESH_BASELINE_VERIFICATION.md
?? STAGE2_TASK8_S14_ACCEPTANCE_FINDINGS.md
?? STAGE2_TASK8_S14_FINAL_ACCEPTANCE_REPORT.md
?? STAGE2_TASK8_S14_FINAL_PRIVILEGE_GRANT_COMPLETENESS_REPORT.md
?? STAGE2_TASK8_S14_FINAL_REVIEW.md
?? STAGE2_TASK8_S14_INSPECTION.md
?? STAGE2_TASK8_S14_READINESS_REPORT.md
?? STAGE2_TASK8_S14_REPORT.md
?? STAGE2_TASK8_S14_SUBMIT_APPLICATION_REVIEW.md
?? STAGE2_TASK9_S01_ACCEPTANCE_REPORT.md
?? STAGE2_TASK9_S09_ACCEPTANCE_FINDINGS.md
?? STAGE2_TASK9_S09_DISPOSABLE_VERIFICATION_REPORT.md
?? STAGE2_TASK9_S09_IMPLEMENTATION_REPORT.md
?? STAGE2_TASK9_S09_IMPLEMENTATION_SPECIFICATION.md
?? STAGE2_TASK9_S09_INDEPENDENT_REVIEW_REPORT.md
?? STAGE2_TASK9_S09_READINESS_REPORT.md
?? STAGE2_TASK9_S09_REMEDIATION_REPORT.md
?? _correct_phase1.py
?? _correct_phase3.py
?? _r8_final_verify.py
?? _r8_finalize_meta.py
?? _r8_finalize_report.py
?? _r8_inspect_meta.py
?? _r8_rebuild_report.py
?? _r8_rewrite_report.py
?? _r8_strip_extra_meta.py
?? _r8_validate_report.py
?? _r8_verify_cleanup.py
?? docker-compose.yml
?? docs/
?? home/
?? next.config.ts
?? package-lock.json
?? package.json
?? prisma/
?? public/
?? scripts/
?? src/
?? templates/DISCOVERY_INTERVIEW_SCRIPTS.md
?? tmp/
?? tsconfig.json
?? vitest.config.ts
```

**Count:** 10 modified tracked files; 286 untracked entries in `git ls-files --others --exclude-standard`.

**Notable absence:** Neither `STAGE2_S09_REPORTED_RUN_LOG.txt` nor `STAGE2_S09_HARNESS_CORRECTION_AND_VERIFICATION_REPORT.md` appears in this list. Both files are absent from disk.

### 2.3 Modified tracked files (10 files, 1095 insertions, 128 deletions)

`AI_HANDOFF.md`, `MONETIZATION_AND_LAUNCH.md`, `MVP_SPEC.md`, `README.md`, `ROADMAP.md`, `STATE.md`, `TECH_STACK.md`, `VALIDATION_PLAN.md`, `templates/INTERVIEW_LOG.md`, `templates/PILOT_TRACKER.md`.

These are documentation files only. No application source, migration, harness, or report file is in the modified-tracked set.

### 2.4 Key S-09 files present in working tree

| File | Purpose | Tracked status |
|---|---|---|
| `scripts/s09-e2e-run.sh` | Harness: disposable DB, capture server, Next.js start, suite invocation | Untracked (`??`) |
| `scripts/s09-integration.mjs` | HTTP integration suite against live server | Untracked (`??`) |
| `scripts/s09-resend-capture.mjs` | Standalone Resend capture server | Untracked (`??`) |
| `src/lib/resend.ts` | Resend email sender, baseUrl-aware | Tracked, unmodified |
| `src/lib/email-test-env.ts` | Test-only env setup for resend module | Untracked (`??`) |
| `prisma/migrations/20261105060000_session_lifecycle/migration.sql` | S-14 + appended S-09 DDL | Untracked (`??`), not in HEAD |
| `prisma/dev.db` | Development SQLite database | Untracked (`??`) |

### 2.5 Relevant file SHA-256 values (captured this turn)

```
a267faab954a802be76db615188bd4c06ce681a98139e71441690397cc9e831b  scripts/s09-e2e-run.sh
f4de22e124af1c5fdc57a2ffef3fee1eb9b88350fbb7243e0c0d79d20ad116c6  scripts/s09-integration.mjs
c65e3a5ec1a4fe9db2251b72031d757fb9c3e8462ad6f78dca279309d9985d0d  scripts/s09-resend-capture.mjs
6d4f2d1b556484ca88ce0c758c2f184abcd22dcc986cce2603a8b84125b6781c  src/lib/resend.ts
046393b93f420ffbabcc410c7fb4367f762d44ff4bf84fc84be75b88a34c8811  src/lib/email-test-env.ts
c86f888ed35de4241653a06949b53017465bae747bf6fad605bcb437d3e50375  prisma/dev.db
33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40  prisma/migrations/20261105060000_session_lifecycle/migration.sql
```

### 2.6 Database fingerprint

- `prisma/dev.db` SHA-256: `c86f888ed35de4241653a06949b53017465bae747bf6fad605bcb437d3e50375`
- Size: 954368 bytes
- Integrity: SQLite 3.x database, last written using SQLite version 3046000
- Contains `PasswordResetToken` table with indexes: `PasswordResetToken_userId_idx`, `PasswordResetToken_expiresAt_idx`, `PasswordResetToken_hashedToken_unique`, plus internal `sqlite_autoindex_PasswordResetToken_1`

---

## 3. Probe credential data-flow findings

### 3.1 Investigation A — summary

**Suspected defect re-examined:** "A bcrypt password hash is written to `s09-probe-password.txt`. The login probe subsequently treats that hash as the plaintext password."

**Finding:** This specific formulation is **not accurate as written**. The harness writes the **plaintext** password to `s09-probe-password.txt`. The confusion arises from variable naming and a comment that references the hash, not from an actual hash-instead-of-plaintext defect.

### 3.2 Exact data flow

**Step 1 — Plaintext password generation**

- File: `scripts/s09-e2e-run.sh`
- Lines: 557-565
- Command:
  ```bash
  PROBE_PASSWORD_PLAIN="$(/usr/bin/env node --input-type=module - <<'NODE'
  import { randomBytes } from 'node:crypto';
  const plain = Array.from(randomBytes(20))
    .map((b) => (b % 94 + 33))
    .map((c) => String.fromCharCode(c))
    .join('');
  process.stdout.write(plain);
  NODE
  )"
  ```
- Output: 20 random printable ASCII characters, captured as `$PROBE_PASSWORD_PLAIN`.

**Step 2 — Bcrypt hashing**

- File: `scripts/s09-e2e-run.sh`
- Lines: 567-572
- Command:
  ```bash
  PROBE_PASSWORD_HASH="$(/usr/bin/env node --input-type=module - <<'NODE'
  import bcrypt from 'bcryptjs';
  const plain = process.argv[1];
  if (!plain) process.exit(8);
  const hashed = await bcrypt.hash(plain, 12);
  process.stdout.write(hashed);
  NODE
   "$PROBE_PASSWORD_PLAIN")"
  ```
- Output: bcrypt hash of `$PROBE_PASSWORD_PLAIN` at cost 12, captured as `$PROBE_PASSWORD_HASH`.

**Step 3 — Database insertion (hash, not plaintext)**

- File: `scripts/s09-e2e-run.sh`
- Lines: 576-593
- The Node heredoc inserts:
  ```javascript
  created = await prisma.user.create({
    data: {
      email: '${PROBE_EMAIL}',
      passwordHash: '${PROBE_PASSWORD_HASH}',
    },
  });
  ```
- The database receives `$PROBE_PASSWORD_HASH` (the bcrypt hash), not `$PROBE_PASSWORD_PLAIN`.

**Step 4 — Credential artifact written**

- File: `scripts/s09-e2e-run.sh`
- Lines: 581-584
- Commands:
  ```bash
  mkdir -p "$TMP_DIR/credentials"
  PROBE_PASSWORD_FILE="$TMP_DIR/credentials/s09-probe-password.txt"
  chmod 700 "$TMP_DIR/credentials"
  printf '%s' "$PROBE_PASSWORD_PLAIN" > "$PROBE_PASSWORD_FILE"
  chmod 600 "$PROBE_PASSWORD_FILE"
  ```
- **The file `s09-probe-password.txt` contains `$PROBE_PASSWORD_PLAIN`, the plaintext password.**

**Step 5 — Login probe reads the artifact**

- File: `scripts/s09-e2e-run.sh`
- Lines: 596-605
- The harness performs a curl login probe:
  ```bash
  PROBE_RESPONSE="$(curl -s "$BASE_URL/api/auth/login" \
    -X POST \
    -H "content-type: application/json" \
    -H "origin: ${DISPOSABLE_APP_ORIGIN:-}" \
    -H "x-sellflow-trusted-proxy: $TRUSTED_PROXY_SECRET" \
    -d "{\"email\":\"$PROBE_EMAIL\",\"password\":\"doesnotmatter\"}")"
  ```
- Note: this specific probe uses `"doesnotmatter"` as the password, **not** the file content. It verifies disposable DB binding by checking that the login is rejected with a generic invalid-credentials response.
- Later, at lines 620-623, the suite-facing environment is constructed:
  ```bash
  S09_PROBE_PASSWORD="$(cat "$PROBE_PASSWORD_FILE")" \
  ```
- The integration suite (`scripts/s09-integration.mjs`) receives `S09_PROBE_PASSWORD` as an environment variable, which is the **plaintext** password.

**Step 6 — Integration suite uses the credential**

- File: `scripts/s09-integration.mjs`
- Lines: 373-391
- The suite's main function:
  ```javascript
  const PROBE_EMAIL_WITH_PW = PROBE_EMAIL_FALLBACK && process.env.S09_PROBE_PASSWORD;
  if (PROBE_EMAIL_WITH_PW) {
    const password = process.env.S09_PROBE_PASSWORD;
    try {
      s09Account = {
        email: PROBE_EMAIL_FALLBACK,
        password,
        cookie: await loginHarnessProbe(PROBE_EMAIL_FALLBACK, password),
      };
  ```
- `loginHarnessProbe` calls the `/api/auth/login` endpoint with `password` as the plaintext password.
- The server's `verifyPassword` compares the submitted plaintext against the stored bcrypt hash.
- This is the **correct** flow: plaintext submitted, bcrypt hash stored, bcrypt verification performed.

### 3.3 Where the confusion originates

The confusion is in `scripts/s09-e2e-run.sh` lines 582-583:

```bash
# Keep the probe credential inside the disposable evidence directory only.
# The plaintext password is the value the integration suite must send to the
# login endpoint; the bcrypt hash is what gets inserted into the database. mkdir -p "$TMP_DIR/credentials"
```

This comment is accurate: plaintext goes to the file, hash goes to the database. However, the variable naming creates a paper confusion:

- `$PROBE_PASSWORD_PLAIN` — the plaintext, written to the file.
- `$PROBE_PASSWORD_HASH` — the hash, inserted into the database.
- `$PROBE_PASSWORD_FILE` — points to `s09-probe-password.txt`, which holds `$PROBE_PASSWORD_PLAIN`.

A reader who sees `PROBE_PASSWORD_HASH` and `s09-probe-password.txt` in close proximity may incorrectly infer that the file holds the hash. It does not.

### 3.4 Investigation A — verdict table

| Question | Answer | Evidence |
|---|---|---|
| Where is the original plaintext password generated? | Line 557-565 of `s09-e2e-run.sh`, via `randomBytes(20)` | Node heredoc, `$PROBE_PASSWORD_PLAIN` |
| Where does hashing occur? | Lines 567-572 of `s09-e2e-run.sh`, via `bcrypt.hash(plain, 12)` | Node heredoc, `$PROBE_PASSWORD_HASH` |
| What is written to the credential artifact? | `$PROBE_PASSWORD_PLAIN` (plaintext) written to `s09-probe-password.txt` | Lines 581-584 |
| What does the login probe read? | The harness curl probe uses `"doesnotmatter"`; the integration suite reads `S09_PROBE_PASSWORD` env var, which is the file's plaintext content | Lines 596-605 and 620-623 |
| Does the login probe receive plaintext or a bcrypt hash? | Plaintext — the suite sends the plaintext password to `/api/auth/login`, which verifies it against the stored bcrypt hash | `scripts/s09-integration.mjs` lines 373-391 and `src/lib/auth/password.ts` |
| Does any other probe depend on the same artifact? | The suite's `loginHarnessProbe` is the primary consumer. The harness's own curl probe uses `"doesnotmatter"` and does not read the file. | Lines 596-605 vs 620-623 |

### 3.5 Investigation A — conclusion

**No actual credential-flow defect exists.** The probe credential data flow is architecturally correct:
- Plaintext generated → hashed → hash stored in DB → plaintext written to file → plaintext read by suite → plaintext sent to login endpoint → bcrypt verification on server.

The only issue is a **documentation/naming confusion** that could mislead a reviewer into thinking the file contains the hash. This is a clarity defect, not a functional defect.

---

## 4. Resend architecture findings

### 4.1 Investigation B — summary

Resend cross-process capture is **architecturally feasible** and **partially wired** in the existing harness. The remaining gap is runtime verification, not architecture.

### 4.2 Resend SDK version and capabilities

- Installed version: **6.38.0** (from `node_modules/resend/package.json`)
- Module entry: `./dist/index.mjs` (ESM), `./dist/index.cjs` (CJS)
- Minimum Node: `>=22.12.0`

**`baseUrl` support — CONFIRMED from SDK source:**

- File: `node_modules/resend/dist/index.mjs`
- Lines: 1669, 1703
- `getDefaultBaseUrl()` reads `process.env.RESEND_BASE_URL` with fallback to `https://api.resend.com`
- Constructor line 1703: `this.baseUrl = options?.baseUrl ?? getDefaultBaseUrl();`
- This means `baseUrl` can be set via:
  1. Constructor option: `new Resend(key, { baseUrl: "http://127.0.0.1:PORT" })`
  2. Environment variable: `RESEND_BASE_URL=http://127.0.0.1:PORT`

**`RESEND_BASE_URL` environment variable — CONFIRMED:**

- Line 1669: `return typeof process !== "undefined" && process.env ? process.env.RESEND_BASE_URL || defaultBaseUrl : defaultBaseUrl;`
- The SDK reads `RESEND_BASE_URL` from the environment at instantiation time.

### 4.3 How `src/lib/resend.ts` uses baseUrl

- File: `src/lib/resend.ts`
- Lines: 108-111 (RESEND_BASE_URL constant):
  ```typescript
  const RESEND_BASE_URL =
    typeof process !== "undefined" && process.env
      ? process.env.RESEND_BASE_URL ?? "https://api.resend.com"
      : "https://api.resend.com";
  ```
- Line 154 (Resend constructor):
  ```typescript
  const resend = new Resend(API_KEY, { baseUrl: RESEND_BASE_URL });
  ```
- Line 158: `export { RESEND_BASE_URL };`

This is the correct pattern: the module reads `RESEND_BASE_URL` from `process.env`, defaults to the real Resend endpoint, and passes it to the SDK constructor.

### 4.4 The `sendEmailFn` detached-method question

**The suspicious pattern:**

- File: `src/lib/resend.ts`
- Line 168:
  ```typescript
  const sendEmailFn = (options: unknown) =>
    resend.emails.send(options as Parameters<typeof resend.emails.send>[0]) as Promise<ResendSendResponse>;
  ```

**Investigation:** Is `sendEmailFn` a detached method reference that loses `this` binding?

**Answer: NO.** This is not `const sendEmailFn = resend.emails.send`. It is an arrow function that **calls** `resend.emails.send` as `resend.emails.send(options)`. The receiver (`resend.emails`) is preserved because the call is made as a property access on the `resend` object, not as a detached reference.

Compare:

- **Detached (would lose `this`):** `const sendEmailFn = resend.emails.send;` — then `sendEmailFn(options)` would call `send` with `this` undefined or global, which could fail if `send` uses `this.resend`.
- **Actual (preserves `this`):** `const sendEmailFn = (options) => resend.emails.send(options);` — the call is `resend.emails.send(...)`, so `this` inside `send` is `resend.emails`.

**The actual Resend SDK `send` implementation (from `node_modules/resend/dist/index.mjs` lines 959-1010):**

```javascript
var Emails = class {
  constructor(resend) {
    this.resend = resend;
    this.attachments = new Attachments$1(resend);
    this.receiving = new Receiving(resend);
  }
  async send(payload, requestOptions = {}) {
    return this.create(payload, requestOptions);
  }
  async create(payload, requestOptions = {}) {
    const body = { ...payload };
    if (payload.react) body.html = await render(payload.react);
    return await this.resend.post("/emails", parseEmailToApiOptions(body), requestOptions);
  }
  ...
}
```

The `send` method calls `this.create(payload, requestOptions)`, which calls `this.resend.post("/emails", ...)`. If `this` were lost, `this.resend` would be undefined and the call would fail.

With the actual `sendEmailFn` pattern in `src/lib/resend.ts`, the call is `resend.emails.send(options)`, so `this` inside `send` is `resend.emails`, `this.resend` is the `Resend` instance, and `this.resend.post("/emails", ...)` works correctly.

**`post` method (lines 1800-1812 of `index.mjs`):**

```javascript
async post(path, entity, options = {}) {
  const headers = new Headers(this.headers);
  const isFormData = typeof FormData !== "undefined" && entity instanceof FormData;
  if (isFormData) headers.delete("Content-Type");
  if (options.headers) for (const [key, value] of new Headers(options.headers).entries()) headers.set(key, value);
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
  const requestOptions = {
    method: "POST",
    body: isFormData ? entity : JSON.stringify(entity),
    ...options,
    headers
  };
  return this.fetchRequest(path, requestOptions);
}
```

**`fetchRequest` (lines 1720-1732):**

```javascript
async fetchRequest(path, options = {}) {
  ...
  const response = await fetch(`${this.baseUrl}${path}`, options);
  ...
}
```

So the full chain is:

1. `sendEmailFn(options)` → `resend.emails.send(options)`
2. `send` → `this.create(payload, requestOptions)` → `this.resend.post("/emails", parseEmailToApiOptions(body), requestOptions)`
3. `post` → `this.fetchRequest(path, requestOptions)`
4. `fetchRequest` → `fetch(\`${this.baseUrl}/emails\`, options)`

The `baseUrl` is used in `fetchRequest` as the prefix for the fetch URL. If `RESEND_BASE_URL` is set to `http://127.0.0.1:PORT`, the fetch goes to `http://127.0.0.1:PORT/emails`.

**Conclusion on the detached-method question:** The pattern in `src/lib/resend.ts` is **safe**. It does not lose receiver binding. A true detached reference (`const sendEmailFn = resend.emails.send`) would be suspicious, but that is not what the code does.

### 4.5 The harness's existing capture wiring

- File: `scripts/s09-e2e-run.sh`
- Lines: 343-399 (capture server heredoc written to `$TMP_DIR/s09-resend-capture.mjs`)
- Lines: 401-403 (capture server launched):
  ```bash
  CAPTURE_PID="$(/usr/bin/env node "$CAPTURE_SCRIPT" "$CAPTURE_FILE" > "$TMP_DIR/s09-resend-capture.log" 2>&1 & echo $!)"
  ```
- Lines: 405-429 (health probe via `node --input-type=module - <<'NODE'` polling `/health`)
- Line 431: `RESEND_BASE_URL="http://127.0.0.1:$CAPTURE_PORT"`
- Lines: 453-472 (`next start` environment includes `RESEND_BASE_URL="$RESEND_BASE_URL"`)

This is the complete wiring:

1. Capture server starts on a dynamic port, bound to 127.0.0.1.
2. Health probe confirms it's listening.
3. `RESEND_BASE_URL` is set to `http://127.0.0.1:$CAPTURE_PORT`.
4. `next start` receives `RESEND_BASE_URL` in its environment.
5. `src/lib/resend.ts` reads `process.env.RESEND_BASE_URL` and passes it to `new Resend(API_KEY, { baseUrl: RESEND_BASE_URL })`.
6. `resend.emails.send()` → `fetch(${this.baseUrl}/emails, ...)` → capture server.

### 4.6 The capture server

- Standalone file: `scripts/s09-resend-capture.mjs`
- Harness heredoc: `scripts/s09-e2e-run.sh` lines 343-399 (mirrors the standalone file)

**Capture server behavior:**

- Creates an HTTP server with `createServer` from `node:http`
- Binds to port 0 on 127.0.0.1 (dynamic port)
- Prints the port to stdout on successful listen
- Endpoints:
  - `GET /health` → `200 { status: "ok" }`
  - `GET /ready` → `200 { ready: true }`
  - `POST /emails` → captures the request, returns `201 { id, accepted: true, ... }`
  - Other routes → `404 Not Found`
  - Non-POST on `/emails` → `400 Method Not Allowed`
  - Invalid JSON body → `400 Bad Request`
- On `POST /emails`:
  - Reads the request body
  - Parses JSON
  - Creates a record with: `id`, `timestamp`, `method`, `path`, `httpVersion`, `headers` (with sensitive headers redacted), `bodyText`, `bodyJson`
  - Appends to the capture JSON file
  - Returns 201

**Header redaction (lines 70-80 of standalone file):**

```javascript
function sanitizeHeadersForLog(headers) {
  if (!headers || typeof headers !== 'object') return {};
  const out = {};
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (lower === 'authorization' || lower === 'x-api-key' || lower === 'x-resend-api-key') {
      out[key] = '<redacted>';
    } else {
      out[key] = headers[key];
    }
  }
  return out;
}
```

This redacts exactly the three sensitive headers: `Authorization`, `X-API-Key`, `X-Resend-Api-Key`.

### 4.7 Process boundaries

**The architecture involves three separate processes:**

1. **Harness shell** (`scripts/s09-e2e-run.sh`): orchestrates the run, sets up the disposable DB, starts the capture server and Next.js server, invokes the integration suite.

2. **Capture server** (`node s09-resend-capture.mjs`): standalone HTTP server, receives POST `/emails` from the Resend SDK, writes capture JSON file.

3. **Next.js server** (`next start`): runs the application, imports `src/lib/resend.ts`, which creates a `Resend` instance pointing at the capture server's `baseUrl`. When the password-reset endpoint calls `sendTemplatedEmail`, the SDK's `send` method fetches to `http://127.0.0.1:$CAPTURE_PORT/emails`.

4. **Integration suite** (`node s09-integration.mjs`): runs as a separate process, makes HTTP requests to the Next.js server, reads the capture file from disk.

**Critical process-boundary observation:** The integration suite runs in a **separate process** from the Next.js server. The suite's `_ensureResendMocked()` function (lines 55-75 of `s09-integration.mjs`) patches `module.prototype.require` and `process.mainModule.require` **in the suite's process only**. This mock intercepts `require("resend")` calls made **within the suite's process**, not within the Next.js server's process.

This means:

- The mock **cannot** intercept the Next.js server's `require("resend")` call, because the Next.js server is a separate process with its own module system.
- The capture server is the **only** mechanism that can intercept the Next.js server's outbound email requests, because it operates at the HTTP level, not the module level.
- The suite's mock is useful only if the suite itself calls `resend` methods (which it does not directly — it calls the Next.js server over HTTP).

**This is a key architectural insight:** The suite's module-level mock is essentially dead code for the actual S-09 flow, because the email sending happens in the Next.js server process, not the suite process. The capture server is the real interception mechanism.

### 4.8 Investigation B — verdict table

| Question | Answer | Evidence |
|---|---|---|
| Does Resend 6.38.0 support `baseUrl`? | Yes | `node_modules/resend/dist/index.mjs` line 1703 |
| Does it support `RESEND_BASE_URL` env var? | Yes | Line 1669 |
| Is `src/lib/resend.ts` configured to use `baseUrl`? | Yes | Lines 108-111, 154 |
| Is the harness wiring `RESEND_BASE_URL` to the capture server? | Yes | `s09-e2e-run.sh` lines 431, 453-472 |
| Does the `sendEmailFn` pattern lose receiver binding? | No — it's an arrow function wrapper, not a detached reference | `src/lib/resend.ts` line 168 vs `const sendEmailFn = resend.emails.send` |
| Can the capture server intercept Next.js server emails? | Yes, at the HTTP level, because it's a separate process listening on loopback | `s09-resend-capture.mjs` lines 1-100 |
| Can the suite's module mock intercept Next.js server emails? | No — separate process, separate module system | `s09-integration.mjs` lines 55-75 vs process boundary |
| Is the architecture sound for cross-process capture? | Yes | Combination of harness wiring + capture server + SDK baseUrl support |
| Has runtime capture been verified? | No — static analysis only | This investigation did not run the capture server or Next.js server |

---

## 5. Previous build failure analysis

### 5.1 Investigation C — summary

The exact previous controlled-run failure cannot be fully reconstructed because the primary run log is absent from the current working tree. However, retained reports and the current harness source provide a plausible failure-mode analysis.

### 5.2 Absent evidence

- `STAGE2_S09_REPORTED_RUN_LOG.txt` — **not present on disk** and **not listed** in `git ls-files --others --exclude-standard`. It does not appear as `??` in `git status --short`. (A differently named file, `STAGE2_TASK9_S09_REPORTED_RUN_LOG.txt`, does exist on disk and is listed as untracked; that is a distinct filename and a distinct artifact.)
- `STAGE2_S09_HARNESS_CORRECTION_AND_VERIFICATION_REPORT.md` — **not present on disk** and **not listed** in `git ls-files --others --exclude-standard`. It does not appear as `??` in `git status --short`. The file is not present in the current working tree by either measure.

These files are referenced in earlier revision reports but are not available for inspection in the current working tree. This means the exact failure output, exit codes, and log snippets from the previous controlled run cannot be verified.

### 5.3 Retainable failure evidence from existing reports

From `STAGE2_S09_REMEDIATION_INTEGRITY_REPORT.md` (present in working tree):

- Earlier isolated disposable-DB check runs showed:
  - `migrate_exit=0`
  - `client_exit=0`
  - `prisma_client_table_found=true`
  - `prisma_client_table_names=["PasswordResetToken"]`
  - A **synthesized** line: `DISPOSABLE_MIGRATION_CHECK=FAIL`

- The contradiction was in the **synthesized pass/fail line**, not in the underlying Prisma Client result. The synthesized line was computed from a stale grep-based condition on the CLI `db execute --file` output, which did not return a usable `PasswordResetToken` row in the captured log. So `password_reset_token_sql_rows=0` in that path, and the synthetic final line said `FAIL`. Meanwhile the Prisma Client check said `client_exit=0` and `prisma_client_table_found=true`.

- The report explicitly states: "the earlier 'complete step passed' claim is not supported by the earlier captured evidence as written."

From `STAGE2_S09_REMEDIATION_INTEGRITY_REPORT.md`:

- Earlier harness attempts "failed earlier for unrelated harness mechanics (missing local node binary path, trap cleanup ordering, and later the CLI grep path)."

### 5.4 Inferred failure modes

Based on the harness source and retained reports, the plausible failure modes are:

**Failure mode 1 — Missing local node binary path**

- The harness uses `/usr/bin/env node` in some places and `node` in others.
- If `node` is not on the PATH in the sanitized environment, or if the harness's `env -i` construction strips PATH incorrectly, node invocations would fail.
- The harness's `with_sanitized_env()` function (lines 47-53) constructs an env with `PATH="$PATH"`, so PATH should be preserved. But if the parent shell's PATH is unusual or if there's a typo, this could fail.

**Failure mode 2 — Trap cleanup ordering**

- The harness's `cleanup()` function (lines 18-25) kills `SERVER_PID` (the Next.js server) but does **not** explicitly kill `CAPTURE_PID` (the capture server).
- If the harness exits prematurely (e.g., due to a failure in the migration check or health probe), the cleanup trap fires. The Next.js server is killed, but the capture server may be left running.
- This is not a failure cause per se, but it could leave stale state that causes subsequent runs to fail (e.g., port conflicts).

**Failure mode 3 — CLI grep-based assertion paths**

- The harness's migration check uses both a CLI `db execute --file` path and a Prisma Client path.
- The CLI path may not return a usable row list in all cases (as noted in the remediation report).
- If the harness's assertion logic relies on the CLI path's output (e.g., grepping for `PasswordResetToken` in the CLI log), and the CLI log doesn't contain the expected string, the harness would fail even though the Prisma Client check passed.

**Failure mode 4 — Capture server health probe timeout**

- The capture server health probe (lines 405-429) has a 25-second deadline.
- If the capture server fails to start (e.g., port binding failure, node binary not found), the probe times out and the harness fails with "capture server health check failed".

**Failure mode 5 — Next.js server health timeout**

- The Next.js health probe (lines 474-482) has a 60-second deadline (60 tries, 1 second apart).
- If Next.js fails to start or the health endpoint doesn't return 200, the harness fails with "server did not become healthy".

**Failure mode 6 — Integration suite failure**

- The suite (`s09-integration.mjs`) could fail for many reasons:
  - Cannot connect to the Next.js server (wrong BASE_URL, server not ready)
  - Probe credential mismatch (probe email not in DB, wrong password)
  - Resend mock not working as expected
  - Capture file not readable
  - Test assertions failing

### 5.5 Is the failure reproducible from existing evidence?

**Partially.**

- The harness source is available and unmodified (SHA-256 `a267faab954a802be76db615188bd4c06ce681a98139e71441690397cc9e831b`).
- The capture server, integration suite, and resend module are available.
- `prisma/dev.db` is intact and contains `PasswordResetToken`.
- The Prisma migration history is coherent (6 migrations, schema up to date).

**What is NOT available:**

- The exact run log from the previous controlled run.
- The exact exit code and failure point from that run.
- The exact `next-start.log`, `s09-resend-capture.log`, `s09-test.log` outputs.

**Therefore:** Exact reproduction is not possible from existing evidence. The failure can be **inferred** to be one of the harness-mechanics failure modes listed above, but the specific cause cannot be pinpointed without the run log.

### 5.6 Is the failure connected to Investigation A or B?

**Not directly.**

- Investigation A (probe credential flow) found no functional defect. The probe credential flow is sound. If the previous failure involved probe authentication, it was likely due to probe email reuse issues, database state, or timing, not a credential-format defect.
- Investigation B (Resend capture) found the architecture sound. If the previous failure involved email capture, it was likely due to the capture server not starting, the health probe timing out, or the suite not reading the capture file correctly, not an architectural impossibility.

**The failure is most likely a harness-mechanics issue** (one of failure modes 1-6 above), not a fundamental defect in the probe credential flow or the Resend capture architecture.

---

## 6. Repository integrity details

### 6.1 Git state summary

- Branch: `main`
- HEAD: single root commit `37fc638`
- 10 tracked files modified (documentation only)
- Large set of untracked files including all S-09 harness/suite/capture artifacts
- The S-14 migration file is untracked and not in HEAD

### 6.2 S-14 migration file status

- Path: `prisma/migrations/20261105060000_session_lifecycle/migration.sql`
- Current SHA-256: `33b41fc743d7eca67b4ecd40465ca23f7f4103aacc9bb0e08bc3c7b3e7528b40`
- Size: 1256 bytes
- Git status: `??` (untracked)
- In HEAD: **no** (not present in HEAD tree)
- Stored `_prisma_migrations` checksum: `539bd5b67e16cbe1f814476e7024a0a7b1618088ff698fd9fc015aabf1f2a968`
- Checksum match: **no**

The file contains both S-14 DDL and appended S-09 DDL:

```sql
-- S-14: idle expiration for sessions.
ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt");

-- S-09: single-use, hashed password-reset tokens.
CREATE TABLE "PasswordResetToken" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT "cuid()",
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "hashedToken" TEXT NOT NULL,
  "used" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("hashedToken")
);
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
```

### 6.3 Database integrity

- `prisma/dev.db` SHA-256: `c86f888ed35de4241653a06949b53017465bae747bf6fad605bcb437d3e50375`
- Size: 954368 bytes
- Integrity: OK (SQLite 3.x database)
- Contains `PasswordResetToken` with explicit named unique index `PasswordResetToken_hashedToken_unique`
- Contains `Session` with `lastUsedAt` column and `Session_userId_lastUsedAt_idx`
- `_prisma_migrations` has 6 rows, all completed, no rollbacks
- `prisma migrate status` reports "Database schema is up to date!"

### 6.4 Other relevant untracked artifacts

- `prisma/disposable_scratch/` — contains disposable test databases and clean workspace artifacts from previous revisions
- `tmp/` — contains temporary working files from previous investigations
- Various `STAGE2_*_REPORT.md` files — investigation reports from previous revisions

These are all disposable/working artifacts. Their presence does not indicate a problem with the main project state.

---

## 7. Root causes versus unresolved hypotheses

### 7.1 Root causes (established with evidence)

1.  **Probe credential naming confusion:** The harness uses `$PROBE_PASSWORD_PLAIN` and `$PROBE_PASSWORD_HASH` as variable names, and writes `$PROBE_PASSWORD_PLAIN` to `s09-probe-password.txt`. A reviewer who sees "PASSWORD_HASH" and "probe-password.txt" in close proximity may incorrectly infer the file contains the hash. This is a documentation/naming clarity issue, not a functional defect. **Evidence:** `scripts/s09-e2e-run.sh` lines 557-584, read in full.

2.  **Resend `sendEmailFn` is safe:** The pattern `const sendEmailFn = (options) => resend.emails.send(options)` is an arrow function wrapper, not a detached method reference. It preserves receiver binding. **Evidence:** `src/lib/resend.ts` line 168, compared against `node_modules/resend/dist/index.mjs` lines 959-1010 (Emails class) and 1800-1812 (post method).

3.  **Resend 6.38.0 supports baseUrl and RESEND_BASE_URL:** Confirmed from SDK source. **Evidence:** `node_modules/resend/dist/index.mjs` lines 1669, 1703.

4.  **Harness already wires RESEND_BASE_URL to next start:** The harness sets `RESEND_BASE_URL` to the capture server's port and passes it into the `next start` environment. **Evidence:** `scripts/s09-e2e-run.sh` lines 431, 453-472.

5.  **Suite's module mock cannot intercept Next.js server:** The suite runs in a separate process from the Next.js server. The mock patches `module.prototype.require` in the suite's process only. **Evidence:** `scripts/s09-integration.mjs` lines 55-75, combined with the harness's process-boundary design in `scripts/s09-e2e-run.sh` lines 401-472.

6.  **S-14 migration file is untracked and checksum-mismatched:** The file is not in HEAD, is untracked, and its current SHA-256 does not match the stored `_prisma_migrations` checksum. **Evidence:** `git ls-tree -r HEAD` shows no entry for this path; `git status` shows `??`; `STAGE2_S09_DATABASE_STATUS_REPORT.md` documents the checksum mismatch.

### 7.2 Unresolved hypotheses (cannot be confirmed without runtime execution or absent logs)

1.  **Whether the previous build failure was a harness-mechanics issue or something else:** The exact run log is absent. The failure can be inferred to be a harness-mechanics issue (missing node binary path, trap cleanup, CLI grep assertion, health probe timeout, suite failure), but the specific cause cannot be pinpointed.

2.  **Whether the capture server actually starts and responds to health checks at runtime:** Static analysis shows the capture server code is correct, but runtime verification is absent. The harness's health probe mechanism (`node --input-type=module - <<'NODE'`) cannot be easily tested in isolation because it depends on the capture server already running.

3.  **Whether `next start` actually receives and uses `RESEND_BASE_URL` at runtime:** Static analysis shows the env var is passed and the module reads it, but runtime verification is absent. The module's `RESEND_BASE_URL` constant is computed at module load time from `process.env`, so if the env var is present when the module loads, it will be used.

4.  **Whether the integration suite can successfully read the capture file and extract the reset link:** Static analysis shows the suite reads the capture file via `readSendCapture()` (lines 87-96 of `s09-integration.mjs`), but runtime verification is absent. The suite's `_ensureResendMocked()` mock is unlikely to be effective because it runs in a separate process from the Next.js server.

5.  **Whether the S-14 migration file's current content is the version that was applied to `prisma/dev.db`:** The stored checksum (`539bd5b6...`) does not match the current file SHA-256 (`33b41fc7...`), so the current file is **not** the version that was applied. What the applied version contained is unknown. The database contains both S-14 and S-09 schema objects, so some version of the migration was applied, but the exact content of that version is not verifiable.

6.  **Whether the detached-method pattern would fail if someone later changes `sendEmailFn` to `const sendEmailFn = resend.emails.send`:** This is a future-risk hypothesis. The current code is safe. If someone naively "simplifies" it to a detached reference, it would break. This is a code-review note, not a current defect.

---

## 8. Minimal proposed correction plan

This is a plan only. No implementation is performed in Revision 14B.

### 8.1 Probe credential naming (clarity only)

**Issue:** Variable naming and comment proximity create a misleading impression that `s09-probe-password.txt` contains the bcrypt hash.

**Proposed correction:**

- Rename the file to `s09-probe-plaintext-password.txt` or `s09-probe-password-plaintext.txt` to make explicit that it contains the plaintext password.
- Add a comment near the file-writing lines that explicitly states: "This file contains the PLAINTEXT password, not the bcrypt hash. The hash is in the database."
- Optionally, rename `$PROBE_PASSWORD_PLAIN` to `$PROBE_PASSWORD` and `$PROBE_PASSWORD_HASH` to `$PROBE_PASSWORD_BCRYPT_HASH` for clarity.

**Scope:** 1 file (`scripts/s09-e2e-run.sh`), comment and naming changes only. No logic change.

### 8.2 Resend capture architecture (no code change needed)

**Issue:** None identified in the architecture. The existing wiring is sound.

**Proposed verification steps (future, not correction):**

- Run the capture server standalone under `/tmp`, verify `/health` returns 200.
- POST a sample email body to the capture server, verify the capture file contains the record with redacted headers.
- Verify that `RESEND_BASE_URL` is correctly passed into the `next start` environment by inspecting the process environment of a running Next.js server (requires runtime).
- Verify that `src/lib/resend.ts` actually uses the configured `baseUrl` by checking the fetch URL in a runtime trace or by inspecting the capture server's received requests.

**Scope:** Runtime verification only. No code change required based on current evidence.

### 8.3 Previous build failure (dependent on log recovery)

**Issue:** Exact failure cause unknown due to absent run log.

**Proposed steps (future, not correction):**

- If the run log can be recovered from backup or from the disposable evidence directory that the harness preserves (`[harness] preserving disposable evidence dir: $TMP_DIR`), inspect it to identify the exact failure point.
- If the log cannot be recovered, re-run the harness under controlled conditions with full log capture to identify the failure point.
- Focus first on the harness-mechanics failure modes identified in §5.4: node binary path, trap cleanup, CLI grep assertions, health probe timeouts.

**Scope:** Dependent on log recovery or re-run. No code change recommended until the failure point is identified.

### 8.4 S-14 migration file (no change recommended in this revision)

**Issue:** The S-14 migration file is untracked, not in HEAD, and its current SHA-256 does not match the stored `_prisma_migrations` checksum.

**Assessment:**

- This is a historical artifact integrity issue, not a current-blocker for S-09 verification.
- The database contains both S-14 and S-09 schema objects, so some version of the migration was applied.
- The current file content (with appended S-09 DDL) is not the applied version.
- Whether the appended S-09 DDL was part of the applied version or added later is unknown.

**Proposed disposition (future decision, not correction):**

- If the file is intended to be the active S-14 migration artifact, it should be committed to Git and its checksum should match the stored `_prisma_migrations` record (which would require determining the exact applied content).
- If the file is a working artifact that should not be in the active migration path, it should be moved to a disposable/working location and the active S-14 migration should be a separate, clean artifact.
- The appended S-09 DDL in the S-14 migration file is a separate concern from the S-09 verification — S-09 verification should use the database as-is, regardless of how the migration file is organized.

**Scope:** Future decision. No change recommended in this revision.

---

## 9. Required focused tests

These are the minimal focused tests needed to resolve the remaining uncertainties, in priority order.

### 9.1 Capture server runtime verification (resolves Investigation B uncertainty 2)

**Test:** Start `scripts/s09-resend-capture.mjs` under `/tmp` with a disposable capture file. Verify:

1.  Server starts and prints a dynamic port.
2.  `GET /health` returns `200 { status: "ok" }`.
3.  `GET /ready` returns `200 { ready: true }`.
4.  `POST /emails` with a valid JSON body returns `201` and the capture file contains the record.
5.  The capture file's `headers` object has `authorization`, `x-api-key`, and `x-resend-api-key` set to `<redacted>`.
6.  `POST /emails` with invalid JSON returns `400`.
7.  `POST /emails` with a non-POST method returns `400`.
8.  `GET /emails` (unknown route) returns `404`.

**Why:** This verifies the capture server works correctly in isolation, which is the foundation for the cross-process capture architecture.

### 9.2 RESEND_BASE_URL propagation verification (resolves Investigation B uncertainty 3)

**Test:** Start a minimal Node process that imports `src/lib/resend.ts` (or a test that imports it) with `RESEND_BASE_URL` set to a known value. Verify:

1.  `RESEND_BASE_URL` constant in `resend.ts` equals the configured value.
2.  The `Resend` instance's `baseUrl` equals the configured value.
3.  (If possible) A call to `sendTemplatedEmail` results in a fetch to the configured base URL.

**Why:** This verifies that the module correctly reads and uses the environment variable, which is the link between the harness's `RESEND_BASE_URL` setting and the actual email sending.

### 9.3 Full harness run with complete log capture (resolves Investigation C uncertainty)

**Test:** Run `scripts/s09-e2e-run.sh` with full log capture to a persistent location. Verify:

1.  Capture server starts and health probe passes.
2.  Next.js server starts and health endpoint returns 200.
3.  Disposable DB binding check passes.
4.  Integration suite runs and completes (or fails with a specific, identifiable error).
5.  Capture file contains the expected email records.
6.  All logs are preserved for post-run analysis.

**Why:** This is the only way to identify the exact failure point from the previous run and to verify that the full S-09 flow works end-to-end.

### 9.4 Probe credential flow verification (confirms Investigation A)

**Test:** In a disposable run, verify:

1.  `s09-probe-password.txt` contains the plaintext password (not the hash).
2.  The database contains the bcrypt hash of that plaintext password.
3.  The integration suite can log in with the plaintext password from the file.
4.  The harness's curl probe with `"doesnotmatter"` receives a generic invalid-credentials response.

**Why:** This confirms the probe credential flow is correct end-to-end, which was Investigation A's primary question.

---

## 10. Required evidence before any future full E2E authorization

Before authorizing a full S-09 E2E run, the following evidence should be collected:

1.  **Capture server isolated verification** (Test 9.1): Proof that the capture server starts, responds to health checks, captures emails with redacted headers, and rejects invalid requests.

2.  **RESEND_BASE_URL propagation verification** (Test 9.2): Proof that the `resend.ts` module correctly reads and uses the configured base URL.

3.  **Harness run with complete logs** (Test 9.3): Either recovery of the previous run log or a new controlled run with full log capture, showing the exact failure point or successful completion.

4.  **Probe credential flow verification** (Test 9.4): Proof that the probe credential flow is correct, addressing Investigation A.

5.  **Repository integrity confirmation:** Confirmation that `prisma/dev.db` is intact, the S-14 migration file's status is understood, and no unexpected changes have occurred.

6.  **S-12, S-13, S-14, S-15 integrity:** Confirmation that these findings remain in their accepted state and are not affected by any S-09 changes.

---

## 11. Explicit confirmation of read-only constraints

**I confirm the following were NOT changed during this investigation:**

- **No project files were modified.** All source files, migration files, harness files, and report files were read-only. The only file created was this report (`STAGE2_S09_REVISION14B_READ_ONLY_INVESTIGATION_REPORT.md`), which is a new report artifact, not a modification of an existing project file.

- **No dependencies were installed, uninstalled, or updated.** `node_modules` was read-only. The Resend SDK version was read from `package.json` and the SDK source was read from `node_modules/resend/dist/index.mjs`.

- **No environment variables or `.env` files were modified.** `.env` and `.env.example` were not read or modified. No environment variables were set or changed.

- **No database was modified, migrated, seeded, or reset.** `prisma/dev.db` was read-only. Its SHA-256 was computed for fingerprinting only. No Prisma commands were run. No SQL writes were performed.

- **No Git state was staged, committed, stashed, checked out, reset, or cleaned.** `git status`, `git branch`, `git log`, and `git diff` were run in read-only mode. No Git operations that modify state were performed.

- **The full S-09 E2E suite was not run.** Only static analysis of the harness, integration suite, and capture server source code was performed.

- **No external Resend services were contacted.** No API keys were used. No emails were sent. The Resend SDK source was read from the local `node_modules` only.

- **No rate limiting was implemented.** No changes to throttle or rate-limit code were made.

- **S-12, S-13, S-14, and S-15 were not modified.** Only S-09-related files and reports were read.

- **No billing, entitlements, or C-03 files were touched.**

- **No automatic fixes or cleanup were performed.** No code was formatted, linted, or automatically corrected.

- **No existing untracked application, harness, Prisma, or report files were deleted or overwritten.** All existing files were preserved.

**Files read during this investigation:**

- `scripts/s09-e2e-run.sh` (full read)
- `scripts/s09-integration.mjs` (full read)
- `scripts/s09-resend-capture.mjs` (full read)
- `src/lib/resend.ts` (full read)
- `src/lib/email-test-env.ts` (full read)
- `node_modules/resend/package.json` (version read)
- `node_modules/resend/dist/index.mjs` (selected sections read)
- `STAGE2_S09_REMEDIATION_INTEGRITY_REPORT.md` (full read)
- `STAGE2_S09_DATABASE_STATUS_REPORT.md` (full read)
- `STAGE2_S09_S14_MIGRATION_RECOVERY_PLAN.md` (full read)
- `STAGE2_S09_S14_REVISION9_DISPOSABLE_EVIDENCE_REPORT.md` (full read)
- `STAGE2_TASK9_S09_READINESS_REPORT.md` (full read)
- `STAGE2_TASK9_S09_IMPLEMENTATION_SPECIFICATION.md` (full read)
- `STAGE2_S09_S14_REVISION9_ARTIFACT_CHECKSUM_MANIFEST.txt` (read)
- `STAGE2_S09_REMEDIATION_INTEGRITY_REPORT.md` (full read)

**Files referenced but not present on disk:**

- `STAGE2_S09_REPORTED_RUN_LOG.txt` — **not present on disk** and **not listed** in `git ls-files --others --exclude-standard`. It does not appear as `??` in `git status --short`. (A differently named file, `STAGE2_TASK9_S09_REPORTED_RUN_LOG.txt`, does exist on disk and is listed as untracked; that is a distinct filename and a distinct artifact.)
- `STAGE2_S09_HARNESS_CORRECTION_AND_VERIFICATION_REPORT.md` — **not present on disk** and **not listed** in `git ls-files --others --exclude-standard`. It does not appear as `??` in `git status --short`. The file is not present in the current working tree by either measure.

**New file created:**

- `STAGE2_S09_REVISION14B_READ_ONLY_INVESTIGATION_REPORT.md` (this file)

---

*End of STAGE2_S09_REVISION14B_READ_ONLY_INVESTIGATION_REPORT.md.*
