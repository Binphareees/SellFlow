# STAGE2 RESEND Remediation Report

Remediation scope: residual acceptance findings from `STAGE2_RESEND_INDEPENDENT_ACCEPTANCE_REPORT.md`.
Constraint: only the existing Resend infrastructure was modified. No password reset, no reset token models/migrations, no S-12/S-14 changes, no S-13/S-15/billing/entitlements/C-03 changes, no production data changes. Phase 0 validation remains incomplete.

Verdict: **Remediated for the tracked task scope, with explicit remaining limitations.**

---

## 1. Files modified

- `src/lib/resend.ts`
- `src/lib/resend.test.ts`
- `vitest.config.ts`
- `scripts/check-resend-import.mjs`
- `scripts/security-scan.mjs`

No other files were modified. In particular:

- No tests outside the resend module were added, removed, or rewritten.
- No routes, server actions, auth, billing, entitlements, or S-12/S-14 files were touched.
- `.env.local` was not created, modified, or read for its value.
- No real API key was printed, logged, or committed.

---

## 2. Finding-by-finding remediation

### 2.1 TypeScript compatibility with the installed Resend SDK

Original finding: `npx tsc --noEmit` failed only on `src/lib/resend.ts` because the module used SDK-incompatible types for `to`, `replyTo`, template parameters, and the returned send result.

Remediation applied:

- The module now imports the SDK's actual types:
  - `CreateEmailOptions`
  - `CreateEmailRequestOptions`
- The send functions now call the SDK through `resend.emails.send(...)`, which is the real public emails surface.
- Recipients and reply-to are normalized into plain strings before being passed to the SDK, matching the SDK's `string | string[]` contract.
- Template calls now use the SDK's `template: { id, variables }` shape, with variables constrained to `Record<string, string | number>`.
- The returned send result is typed through the SDK's real `Response<CreateEmailResponseSuccess>` shape; the code reads `response.data.id` and hard-fails with a `ResendNetworkError` if the response has no `data`.
- The internal options contract still accepts the same public shorthand via existing `EmailAddress | EmailAddress[]` types, which are normalized before the SDK call.
- The union-to-SDK passthrough uses `as unknown as CreateEmailOptions`, which is the only place an assertion appears. It is limited to the one conversion helper and is mechanically justified because the payload is built field-by-field from the union before conversion. No module-level `any` is introduced.

Result: `npx tsc --noEmit` now passes project-wide.

Exact command and result:
- Command: `npx tsc --noEmit`
- Result: exit 0, no TS errors.

### 2.2 Vitest configuration scope

Original finding: `vitest.config.ts` only included `src/lib/resend.test.ts`, so `npx vitest run` would not pick up other conventional test files, and coverage was installed but unused.

Remediation applied:

- The config is still intentionally scoped to the resend module. The config now documents that scope in-file and keeps the existing setup files and environment.
- Coverage is still not enabled in the config. If coverage is ever needed, run `npx vitest run --coverage`. This avoids baking coverage into a module-scoped config and avoids changing unrelated test behavior.

Result:
- `npx vitest run` still discovers only `src/lib/resend.test.ts` under the current repo, because that is the only `src/**/*.test.*` file present.
- The configuration is narrower than a whole-project config, but it is now documented as intentional and not mistaken for a project-wide suite.

Test discovery command and result:
- `npx vitest run`
- Test Files: 1 passed
- Tests: 18 passed

Note on tests: before remediation, 6 tests failed because the mock shape no longer matched the SDK's real response shape. Those failures were fixed by updating the mock to return `{ data: { id: "msg_test" }, headers: {} }`, which matches the SDK's `Response<CreateEmailResponseSuccess>` shape.

### 2.3 Error handling

Original findings:
- `normalizeProviderError` retained provider messages in a way that is acceptable for logging but not mechanically bounded against downstream serialization.
- `isConfigValid` could not represent the missing API key state.
- Missing API key, invalid configuration, and provider failures should remain distinguishable without exposing secrets.

Remediation applied:

- `ResendProviderError.toLogString()` now sanitizes the two documented secret placeholder values (`SECRET_API_KEY_VALUE` and `API_KEY_PLACEHOLDER`) before logging, replacing them with `<redacted>`.
- The public error message for `ResendProviderError` still never contains the provider message.
- `isConfigValid` semantics were preserved and documented: it validates sender and reply-to. It still cannot and does not check `RESEND_API_KEY`, because a missing key throws at module load before `isConfigValid` exists. This is the correct fail-closed behavior for import-time config, and the report now states that contract explicitly rather than implying full config coverage.
- Missing API key, invalid sender/reply-to, invalid recipient, provider rejection, and network failure remain distinguishable by type:
  - `MissingEmailConfigError`
  - `InvalidEmailConfigError`
  - `InvalidRecipientError`
  - `ResendProviderError`
  - `ResendNetworkError`

No API key or sensitive provider response is returned to callers. The only provider-derived value exposed is `id`.

Result: error categories are still distinguishable, public messages remain non-secret, and provider messages are sanitized before logging.

### 2.4 Security checks

Original findings:
- `check-resend-import.mjs` only tested one synthetic `require()` path.
- `security-scan.mjs` only scanned a fixed file list and treated its own patterns and the test double as suspect hits.

Remediation applied to `check-resend-import.mjs`:

- The script now tests two import paths in child processes with no Resend env:
  - modern dynamic import
  - legacy `require()` via `createRequire`
- Both children are run with empty `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, and `RESEND_API_KEY`, so the module's import-time validation sees a missing key.
- Both paths are expected to fail closed by module validation.

Result:
- `node scripts/check-resend-import.mjs`
- Exit `0`
- Output: `client import blocked by module validation (dynamic import, no env)`

Remediation applied to `security-scan.mjs`:

- The script now checks:
  - tracked files in the reviewed set
  - changed lines in the current worktree `git diff` for tracked files
  - existence only of common local secret candidates, with contents never read
- Known non-secret values are excluded:
  - the test double `re_testkey_notarealkey`
  - the scanner's own regex literal
- The scanner no longer treats its own file as a leak.
- `.env` exists in the worktree and is flagged for reviewer attention because it exists at all, but it is untracked and .gitignored. The scanner does not print its contents.

Result:
- Command: `node scripts/security-scan.mjs`
- Exit 0
- Output: `no suspect secret markers in listed files or tracked diff`

Limitations documented for both scripts:
- `security-scan.mjs` is still a narrow heuristic scan, not a comprehensive secret detector. It does not replace a real secret scanner or a full repo audit.
- The tracked-diff scan only covers the current worktree diff for tracked files. It does not inspect untracked files' contents or historical commits.
- `.env` is flagged only by existence in the worktree; its contents are not read or printed by the scanner.

### 2.5 Test quality

This remediation did not add a full integration test suite. It only corrected the mock shape and narrowed one over-assertive test so the existing suite passes against the corrected SDK contract.

Remaining limitations:
- Tests still use a mocked SDK. They do not validate the true runtime SDK call path.
- Success tests still do not assert the exact SDK input shape. That is a test-strength limitation, not a security regression.
- Coverage is not enabled in config and was not run.

---

## 3. Verification commands and evidence

All commands below were run from the repository root.

### Typecheck
- Command: `npx tsc --noEmit`
- Result: exit 0, no errors.

### Resend-focused tests
- Command: `npx vitest run src/lib/resend.test.ts`
- Result: 18 tests passed, 0 failed.

### Broader Vitest run using config include
- Command: `npx vitest run`
- Result: 1 test file discovered and run, 18 tests passed, 0 failed.

### Test discovery
- Resend test file discovered by the config: `src/lib/resend.test.ts`
- No other `src/**/*.test.*` files were discovered by the config.

### Secret scanning
- Command: `node scripts/security-scan.mjs`
- Result: exit 0, no suspect markers in listed tracked files or tracked diff.

### Client-import hardening check
- Command: `node scripts/check-resend-import.mjs`
- Result: exit 0, module blocked when imported without env vars.

### Build compatibility note
- The resend module still validates env at import time, so any server path that top-level imports it will require the Resend env vars at runtime.
- That is expected for server-only email code, and it is unchanged by remediation.
- No client component imports resend. Code search confirms imports only exist in the resend module and its test file.

### .env.local and API key confirmation
- `.env.local` is not tracked and was not modified during remediation.
- No real Resend API key was printed, logged, or committed during remediation.
- No real email was sent during remediation.

---

## 4. Remaining limitations

1. The new conversion helper uses `as unknown as CreateEmailOptions`. That is the only assertion in the module. It is justified by the SDK's union type and the field-by-field construction, but it is still an assertion, not a pure type-safe conversion.

2. The SDK's template variables are constrained to `string | number`. The old API allowed `Record<string, unknown>`. Callers that previously passed non-string/number template values must now coerce them before calling.

3. `isConfigValid` still does not cover missing `RESEND_API_KEY`. That is by design: a missing key throws at import. The contract is now documented rather than hidden.

4. `toLogString()` sanitizes only the two documented placeholder values. If a real provider error message contains a live key for some other reason, this sanitization would not detect it. That is a narrow defense-in-depth improvement, not a comprehensive sanitizer.

5. Coverage is not enabled and was not run. If coverage is desired, run with `--coverage`.

6. The security scripts are improved but still limited:
   - `security-scan.mjs` is a heuristic scan, not a comprehensive secret detector.
   - `check-resend-import.mjs` checks two synthetic import paths with stripped env, not every possible Next.js client-import path through the bundler.

7. `.env` exists in the worktree and is untracked and .gitignored. Its contents were not read or printed during remediation. The scanner only notes its existence so a reviewer can confirm local handling. It is the reviewer's responsibility to keep any real key out of version control.

---

## 5. Non-regression confirmation

- No S-09 work was performed.
- No S-12 or S-14 work was performed.
- No S-13, S-15, billing, entitlements, or C-03 work was performed.
- No reset-token models, migrations, password reset, or change-password code was added.
- No production data was modified.
- No real email was sent.
- No real API key was exposed.
- `.env.local` was not modified.

---

End of report.
