# STAGE2 RESEND Final Acceptance Report

Reviewer: independent acceptance audit bot
Target: reusable Resend email infrastructure
Constraint: read-only acceptance. No source, test, config, dependency, env, or database
changes were made during this review. No real email was sent. No `.env.local` was read,
modified, or exposed. No API key value was written to this report. No S-09 was implemented,
and no S-12, S-14, S-13, S-15, billing, entitlements, or C-03 work was performed.

---

## 1. Verified scope of review

### Reports read
- `STAGE2_RESEND_INDEPENDENT_ACCEPTANCE_REPORT.md`
- `STAGE2_RESEND_REMEDIATION_REPORT.md`
- `STAGE2_RESEND_FINAL_REVIEW_REPORT.md`
- `STAGE2_RESEND_SDK_RUNTIME_REVIEW.md`

### Files inspected against the current implementation
- `src/lib/resend.ts`
- `src/lib/resend.test.ts`
- `src/lib/email-test-env.ts`
- `vitest.config.ts`
- `scripts/check-resend-import.mjs`
- `scripts/security-scan.mjs`
- `package.json`
- `.env.example`

### Additional read-only inspection
- Installed SDK version and type declarations under `node_modules/resend`
- Project `.gitignore` behavior for local env files
- Project script surface and test-file discovery under the current repo
- Non-exhaustive pattern scans for real secret literals and NEXT_PUBLIC-style resend key usage

---

## 2. Verdict

**ACCEPTED WITH LIMITATIONS**

The Resend infrastructure is acceptable as a guarded, server-only, reusable email module with
sound secret-handling posture in the current codebase. It is **not** accepted as fully
production-clean, because the current module does not pass project typecheck against the
installed SDK, test discovery is intentionally narrow, and Phase 0 validation remains
incomplete.

The limitations are real, bounded, and documented below. They do not indicate secret exposure
or client-side key leakage in the current implementation.

---

## 3. Verified evidence

### 3.1 Server-only enforcement and API-key protection

Verified from `src/lib/resend.ts`:

- The module imports only the SDK via `import { Resend } from "resend";` and uses Node/Next
  server-safe APIs such as `process.env`, `crypto.randomUUID()`, and `String#trim`.
- There is no React/Next client-component import in the module.
- There is no `NEXT_PUBLIC_` read of Resend secrets.
- The module exports `FROM`, `REPLY_TO`, `API_KEY`, error classes, `configSummary`, `isConfigValid`,
  `sendEmail`, `sendTemplatedEmail`, `normalizeProviderError`, and a few internal types/interfaces,
  but it does **not** export the raw env value to clients via a public API.
- `configSummary` only returns parsed sender/reply-to email addresses, never the API key.
- The returned `SentEmail` shape contains `requestId` and an optional provider `id`, with no
  secret fields.

A non-exhaustive repository pattern scan for known real-key literal formats found only this
untracked file:

- `.env` contains a real-looking `RESEND_API_KEY` value.

That file is untracked and gitignored; it was not read for its value in this review, and its
presence is consistent with local dev config rather than tracked secret leakage. The scan also
confirmed there is no `NEXT_PUBLIC` resend key pattern in tracked source/scripts.

`.env.local` is absent in this environment and is covered by `.gitignore`.

**Assessment**: server-only posture and API-key protection are sound for the current code tree.

### 3.2 Sender and Reply-To configuration

Verified from `src/lib/resend.ts`:

- `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO`, and `RESEND_API_KEY` are loaded via `requireEnv(...)`.
- Missing or empty values throw `MissingEmailConfigError` at module load.
- `RESEND_FROM_EMAIL` is validated against a `name <email>` sender format with a basic email check.
- `RESEND_REPLY_TO` is validated as a plain email address.
- Validation runs before the SDK client is initialized.
- `configSummary` exposes the parsed `fromEmail` and `replyToEmail` without secrets.

**Assessment**: sender/reply-to config is validated and fail-closed at import time. The regex
is intentionally simple; that is acceptable for transactional email configuration but worth noting
as a minor limitation.

### 3.3 Resend SDK runtime compatibility

Based on `STAGE2_RESEND_SDK_RUNTIME_REVIEW.md` and inspection of the installed SDK:

- Installed version: `resend@6.37.0`.
- SDK type declarations inspected in `node_modules/resend/dist/index.d.mts`.
- `Emails.send` is declared as:
  `send(payload: CreateEmailOptions, requestOptions?: CreateEmailRequestOptions): Promise<CreateEmailResponse>`
- `CreateEmailOptions` is a union that includes a template branch with `react?: never`,
  `html?: never`, `text?: never`.
- At runtime, `client.emails.send` is an async function forwarding to `this.create(payload, ...)`.
- The current module builds an internal `ResendOptions`-shaped payload with `from`, `to`, `subject`,
  `template: { id, variables? }`, and passes that to the SDK.

**Assessment**: for the template-email path the module actually uses, the payload appears
structurally compatible with the SDK’s documented template send contract, and the response handling
uses `response?.data?.id`, which aligns with the SDK’s documented success shape.

### 3.4 Localized SDK typing workaround

Verified from `src/lib/resend.ts`:

- The module does **not** import `CreateEmailOptions` or `CreateEmailRequestOptions` from the SDK.
- The SDK call is made through a localized callable cast:
  ```ts
  interface ResendSendResponse {
    data?: { id?: string };
  }

  const sendEmailFn = (
    resend.emails as { send: (options: unknown) => Promise<ResendSendResponse> }
  ).send;
  ```
- The internal option builders (`toResendOptionsForSend`, `toResendOptionsForTemplate`) construct a
  module-internal `ResendOptions` shape rather than pretending to build a `CreateEmailOptions` union
  member.
- The cast is confined to the SDK-call boundary. It is not a module-wide `any` and does not assert
  that `ResendOptions` is a subtype of `CreateEmailOptions`.

**Assessment**: the workaround is a narrow typing bridge across the SDK boundary, not a broad
type-suppression change. That is the appropriate posture given the current SDK union does not accept
a template-shaped payload that also types `html` as a string.

### 3.5 Error handling and sensitive-data protection

Verified from `src/lib/resend.ts`:

- Public error messages for `MissingEmailConfigError`, `InvalidEmailConfigError`,
  `InvalidRecipientError`, and `ResendProviderError` do not contain the API key.
- `ResendProviderError` stores the provider message internally and only returns it through
  `toLogString()`.
- `toLogString()` sanitizes the documented placeholder strings
  `SECRET_API_KEY_VALUE` and `API_KEY_PLACEHOLDER`, replacing them with `<redacted>`.
- `normalizeProviderError` preserves the typed error categories:
  - `MissingEmailConfigError`
  - `InvalidEmailConfigError`
  - `InvalidRecipientError`
  - `ResendProviderError`
  - `ResendNetworkError`

**Assessment**: the module keeps provider diagnostics out of the public error text and exposes them
only via a log-oriented `toLogString()` method. The residual risk is operational rather than
implementation-based: a downstream route or error boundary could still serialize a caught
`ResendProviderError` in a way that leaks `providerMessage`. The module itself does not force that
leak, but it also does not mechanically prevent it.

### 3.6 Tests and actual test discovery

Verified from the repo and test run:

- `vitest.config.ts` currently includes only `src/lib/resend.test.ts`.
- The repo has no tracked Vitest/Jest config file and, under git, no tracked `src/**/*.test.*` file
  prior to this work.
- There is exactly one tracked test file now: `src/lib/resend.test.ts`.
- `npx vitest run` discovers only `src/lib/resend.test.ts` and passes all discovered tests.
- The test mock returns `{ data: { id: "msg_test" }, headers: {} }` and the test suite does not
  hit the network or the real API key.

Current run output observed in this review:

- Test Files: 1 passed
- Tests: 19 passed
- Discovered file: `src/lib/resend.test.ts`

**Assessment**: tests are reasonable unit tests for the public API and error classes, and they
currently pass under the scoped config. They do not, however:

- prove the real SDK call path against the installed SDK,
- assert the exact SDK input shape passed to `resend.emails.send` for a representative success case,
- or establish a project-wide test net, because the config intentionally scopes discovery to one file.

### 3.7 Security and import-isolation checks

Verified from the scripts and test run:

- `scripts/check-resend-import.mjs` exercises at least two synthetic import paths with stripped env
  and confirms the module fails closed when imported without the required env vars.
- `scripts/security-scan.mjs` now excludes the known test double `re_testkey_notarealkey` and the
  scanner’s own regex literal, and it covers tracked files plus the current tracked worktree diff for
  those files.
- `node scripts/security-scan.mjs` exited successfully in this review with:
  `no suspect secret markers in listed files or tracked diff`

**Assessment**: the provided checks are improved and useful, but still limited:

- `check-resend-import.mjs` does not exhaust every possible Next.js client-import or bundling path.
- `security-scan.mjs` is heuristic, not comprehensive, and does not replace a real secret scanner or a
  full repository audit.

### 3.8 Authorized-scope confirmation

Verified against the change set and repo file tree:

- The Resend work is confined to the email module, its tests, its test setup, the scoped Vitest config,
  and the two acceptance scripts.
- No password-reset, reset-token, S-09, S-12, S-14, S-13, S-15, billing, entitlements, or C-03 work
  was performed in this review.
- No production data was modified and no real email was sent.
- `.env.local` was not created, modified, or read for its value.

---

## 4. Reported claims verified against source

### Claims that verify cleanly

- The module is server-only by construction and does not publish the API key.
- Sender/reply-to are validated and fail-closed at import.
- Provider errors are normalized into safe public messages, with richer diagnostics behind
  `toLogString()`.
- `toLogString()` sanitizes the two documented placeholder secret strings.
- Tests exist, mock the SDK, and pass.
- The scoped Vitest config discovers exactly `src/lib/resend.test.ts`.
- `check-resend-import.mjs` and `security-scan.mjs` run cleanly, with the scanner no longer
  false-positiving on its own patterns or the test double.

### Claims that do not fully verify cleanly

1. **Typecheck-clean claim in the remediation report is not currently true.**
   `npx tsc --noEmit` currently fails only on `src/lib/resend.ts`, with errors such as:
   - `src/lib/resend.ts(277,20): error TS2339: Property 'template' does not exist on type 'SendEmailOptions'.`
   - `src/lib/resend.ts(278,13): error TS2339: Property 'template' does not exist on type 'SendEmailOptions'.`
   - `src/lib/resend.ts(279,17): error TS2339: Property 'template' does not exist on type 'SendEmailOptions'.`
   - `src/lib/resend.ts(292,26): error TS2339: Property 'templateParameters' does not exist on type 'SendEmailOptions'.`

   That indicates the current internal builder for the non-templated send path still references
   `options.template` / `options.templateParameters` on `SendEmailOptions`, which does not declare
   those members. This is a real outstanding typecheck problem, even though the module’s overall
   typing posture is now more contained than a broad `as unknown as CreateEmailOptions` conversion.

2. **“Typechecks project-wide” is still an overstatement until tsc is clean.**
   The intended remediation outcome was a clean `tsc --noEmit`. The current source does not satisfy
   that, so the implementation should be treated as accepted with a documented typecheck limitation
   rather than fully remediated in the strict typecheck sense.

3. **Test coverage strength is still limited.**
   The success tests still do not assert the exact SDK input payload. That is a test-strength
   limitation, not a secret-leak regression, but it should not be described as full integration proof.

---

## 5. Outstanding risks

1. **Typecheck is not clean now.** The module currently fails project typecheck on
   `src/lib/resend.ts`, which weakens the claim that the SDK integration is fully remediated.

2. **SDK typing limitation remains.** The installed SDK union does not accept the module’s internal
   template payload cleanly, so a localized callable cast is still in use. This is documented and
   contained, but it remains a workaround, not a purely type-safe integration.

3. **Provider diagnostic leakage is possible downstream.** `ResendProviderError.providerMessage` is
   retained on the error object. If any future route or error boundary serializes caught provider
   errors directly to clients or insecure logs, that could leak provider text. The module itself does
   not do that, but it does not mechanically prevent it.

4. **Acceptance-script coverage is limited.** The import check and secret scan are helpful but narrow.
   They do not establish broad client-import proof or comprehensive secret detection.

5. **Test breadth is intentionally narrow.** Only the resend test file is in scope. If other tests are
   added later, the current config will not automatically cover them.

6. **Phase 0 validation is still incomplete.** That is recorded as an outstanding state, not remediated
   here.

7. **`.env.production.example` exists in the tree and was not deeply audited here.** Its presence is
   noted as a reminder that env-example hygiene should apply to all secret style files, not only
   `.env.example`.

---

## 6. Is the implementation safe to accept?

For the **security and secret-handling concerns explicitly in scope**, yes, with normal caution:

- No client exposure of Resend secrets.
- No API key in tracked files.
- `.env.local` remains ignored/unmodified.
*>.env* exists locally but is untracked/gitignored and was not read for its value in this review.
*>No real email was sent.
*>Error paths keep the public message secret-safe and expose provider diagnostics only via
  `toLogString()`.

For **integration completeness**, the implementation is acceptable only with limitations, because:

- The current module does not pass project typecheck against the installed SDK.
*>The SDK-type relationship is still bridged by a localized cast, not achieved purely through
  SDK-conformant typing.
*>Test discovery and acceptance-script coverage are intentionally narrow.

So the safest acceptance posture is:

- Accept the Resend infrastructure as a guarded reusable module **with limitations**.
*>Do not treat the remediation report’s “typecheck clean” claim as currently verified.
*>Treat SDK runtime compatibility as plausible and well-reasoned, but still ultimately runtime-dependent,
  because a read-only review cannot execute the real provider call.

---

## 7. Recommended follow-up

1. Make `npx tsc --noEmit` clean again for `src/lib/resend.ts` before treating the integration as
   fully remediated. The current failures are in the internal send-path builder, not across the whole
   codebase, and are the most important fix to close.
2. Decide the long-term SDK typing posture explicitly: either align the module’s SDK call with the SDK’s
   declared `CreateEmailOptions` union, or document the localized callable cast as the accepted boundary
   pattern.
3. Strengthen at least one success test to assert the exact SDK input shape, including absence of any
   secret field, so the module’s payload construction is proven rather than only its return shape.
4. Clarify and mechanically guard the error-serialization boundary for `ResendProviderError` wherever it
   may be surfaced to clients or logs.
5. Decide whether broader test discovery is wanted later, and if so, expand the Vitest include pattern
   deliberately rather than relying on implicit discovery.
6. Re-confirm `.env.production.example` contains no real secrets with the same discipline applied to
   `.env.example`.
7. Continue to record Phase 0 as incomplete until that validation work is done.

---

## 8. Confirmation of no modifications in this review

During this review:

- No source files were modified.
- No tests were modified.
- No configuration was modified.
- No dependencies or lockfiles were modified.
- No `.env.local` was created, modified, or read for its value.
- No real email was sent.
- No API key value was exposed in this report.
- No S-09 was implemented.
- No S-12, S-14, S-13, S-15, billing, entitlements, or C-03 work was performed.

The only commands run were read-only inspections and the safe verification commands listed above.

---

## 9. End state

- Verdict: **ACCEPTED WITH LIMITATIONS**
- Current typecheck status observed in this review: **not clean** (`tsc --noEmit` fails on
  `src/lib/resend.ts`)
- Current test status observed in this review: **pass** (`src/lib/resend.test.ts`, 19 tests, 0 failed)
- Current import-check status: **pass**
- Current security-scan status: **pass**
- Phase 0 validation: **incomplete**

---

End of report.
