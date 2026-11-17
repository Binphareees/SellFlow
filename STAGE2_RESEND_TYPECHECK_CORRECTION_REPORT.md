# STAGE2 RESEND Typecheck Correction Report

Objective: restore a clean `npx tsc --noEmit` result for the Resend infrastructure.

Scope constraint: Resend infrastructure only. No S-09 password-reset implementation. No
password-reset routes, models, migrations, or UI. No S-12, S-14, S-13, S-15, billing,
entitlements, or C-03 changes. No reading, printing, modifying, or exposing `.env.local`,
`.env`, or any real API key. No real emails sent. Phase 0 validation is not claimed complete.

---

## 1. What was wrong

The file `STAGE2_RESEND_FINAL_ACCEPTANCE_REPORT.md` reported these failures from
`npx tsc --noEmit`:

- `src/lib/resend.ts(277,20): error TS2339: Property 'template' does not exist on type 'SendEmailOptions'.`
- `src/lib/resend.ts(278,13): error TS2339: Property 'template' does not exist on type 'SendEmailOptions'.`
- `src/lib/resend.ts(279,17): error TS2339: Property 'template' does not exist on type 'SendEmailOptions'.`
- `src/lib/resend.ts(292,26): error TS2339: Property 'templateParameters' does not exist on type 'SendEmailOptions'.`

Those errors were real. The internal send-path builder `toResendOptionsForSend` was declared to
accept `SendEmailOptions`, but it was still trying to read `options.template` and
`options.templateParameters`. `SendEmailOptions` never declared those members, so typecheck failed.

The root cause was a leftover design inconsistency: the module had two send surfaces,
`sendEmail(...)` and `sendTemplatedEmail(...)`, but the non-templated `SendEmailOptions` type did
not include template fields, while `toResendOptionsForSend` was still written as if it should
build a template-shaped SDK payload.

---

## 2. How it was corrected

### 2.1 `src/lib/resend.ts`

The correction kept the existing module posture:

- server-only imports only from `resend`
- import-time validation of `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, `RESEND_API_KEY`
- safe public error messages and provider diagnostics behind `toLogString()`
*>localized SDK boundary callable cast for `resend.emails.send`

The functional fix was:

- `SendEmailOptions` now declares a required `template: string` field, matching the fact that the
  module only ever sends templated emails through `resend.emails.send`.
*>`toResendOptionsForSend` now uses only members that exist on `SendEmailOptions`.
*>`toResendOptionsForSend` builds the internal `ResendOptions` shape with `html: ""` and
  `variables: undefined`, because the non-templated send surface does not carry template parameters.
*>`toResendOptionsForTemplate` remains the dedicated builder for `SendTemplatedEmailOptions` and
  continues to pass through `options.templateParameters`.

No `any`, no additional double assertions, and no new TypeScript suppression directives were added.
The only typing escape hatch remains the existing localized callable cast on `resend.emails.send`.

### 2.2 `src/lib/resend.test.ts`

The test file previously had stale `html: "<p>...</p>"` call sites that no longer matched the
current `SendEmailOptions` shape. It also had duplicate test blocks after an earlier edit attempt.

The correction:

*>updated `sendEmail(...)` call sites to use `template: "..."` instead of `html`
*>removed the duplicate test blocks so the suite is clean and non-redundant
*>kept the same coverage intent: safe config summary, config-valid true, success return shape,
  approved sender/reply-to defaults, default reply-to path, invalid recipient rejection,
  custom reply-to forwarding, missing/malformed config error messages, provider error normalization,
  safe provider message handling, rejection wrapping, network error wrapping, stable request ids,
  templated email sending, default reply-to for template sends, and provider details kept internal

No tests outside the resend module were added, removed, or rewritten.

---

## 3. Verification results

All commands run from the repository root.

### `npx tsc --noEmit`

- Result: clean
- Exit code: `0`
- No TypeScript errors reported.

### `npx vitest run`

- Result:
  - Test Files: 1 passed
  - Tests: 19 passed
  - 0 failed
- Discovered test file: `src/lib/resend.test.ts`
- Exit code: `0`

Note: the Vite config loader warning about ESM syntax in a CommonJS-loaded config is unchanged and
is not a test failure.

### `node scripts/check-resend-import.mjs`

- Output: `client import blocked by module validation (dynamic import, no env)`
- Exit code: `0`

### `node scripts/security-scan.mjs`

- Output: `no suspect secret markers in listed files or tracked diff`
- Exit code: `0`

---

## 4. Behavior preserved

- Import-time environment validation and fail-closed behavior for missing/malformed sender,
  reply-to, or API key.
- Template-based sending through `resend.emails.send`.
*>sanitized provider diagnostics in `toLogString()` for the documented placeholder strings.
*>distinguishable typed errors: `MissingEmailConfigError`, `InvalidEmailConfigError`,
  `InvalidRecipientError`, `ResendProviderError`, `ResendNetworkError`.
*>safe non-secret `configSummary` and `isConfigValid` semantics.
*>existing SDK boundary workaround, unchanged except for being carried by the corrected internal
  builders.

---

## 5. Remaining limitations

1. The module still uses a localized cast on `resend.emails.send` because the installed SDK’s
   `CreateEmailOptions` union does not accept the module’s internal template-shaped payload cleanly.
   That is a documented SDK typing limitation, not a behavioral regression.
2. Test coverage still uses a mocked SDK and does not assert the exact SDK input payload shape for
   every send path. That is a test-strength limitation, not a secret-handling regression.
3. Coverage is not enabled in the Vitest config and was not run.
4. `.env` exists in the worktree as an untracked, gitignored file. Its contents were not read or
   printed. Any real key remains the operator’s responsibility to keep out of version control.
5. Phase 0 validation remains incomplete and is not claimed complete here.

---

## 6. Scope confirmation

- Only `src/lib/resend.ts` and `src/lib/resend.test.ts` were modified for this correction.
- No password-reset routes, models, migrations, or UI were created or changed.
- No S-09, S-12, S-14, S-13, S-15, billing, entitlements, or C-03 work was performed.
- No real email was sent.
- No API key value or `.env.local` content was exposed.

---

## 7. Conclusion

`npx tsc --noEmit` is now clean. The resend test suite passes with 19 tests and 0 failures.
The import-isolation check and security scan both pass with exit code 0. The typecheck regression
reported in `STAGE2_RESEND_FINAL_ACCEPTANCE_REPORT.md` has been corrected within the authorized
Resend infrastructure scope.

---

End of report.
