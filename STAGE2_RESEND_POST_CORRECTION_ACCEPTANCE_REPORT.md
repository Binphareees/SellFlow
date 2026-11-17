# STAGE2 RESEND Final Post-Correction Acceptance Report

Reviewer: independent acceptance audit bot
Target: reusable Resend email infrastructure, after TypeScript correction
Constraint: read-only review. No source, test, config, dependency, env, or database changes
were made during this review. No real email was sent. No `.env` or `.env.local` was read,
modified, or exposed. No API key value was written to this report. No S-09 was implemented,
and no S-12, S-14, S-13, S-15, billing, entitlements, or C-03 work was performed.
Phase 0 validation remains incomplete.

---

## 1. Files reviewed

### Source and test files
- `src/lib/resend.ts`
- `src/lib/resend.test.ts`

### Review reports read
- `STAGE2_RESEND_FINAL_ACCEPTANCE_REPORT.md`
- `STAGE2_RESEND_SDK_RUNTIME_REVIEW.md`
- `STAGE2_RESEND_TYPECHECK_CORRECTION_REPORT.md`

### Verification commands run
- `npx tsc --noEmit`
- `npx vitest run`
- `node scripts/check-resend-import.mjs`
- `node scripts/security-scan.mjs`

---

## 2. Verdict

**ACCEPTED WITH LIMITATIONS**

The post-correction Resend infrastructure now passes project typecheck, passes its scoped test
suite, and preserves the intended send-api contracts and security posture. It is still not
accepted as fully production-clean because the SDK typing workaround remains, test discovery is
intentionally narrow, test strength is unit-test-level rather than full integration-proof, and
Phase 0 validation is still incomplete.

The remaining limitations are bounded and documented. They do not indicate secret exposure,
client-side key leakage, or unauthorized SellFlow functionality changes.

---

## 3. Verification results

### `npx tsc --noEmit`
- Result: clean
- Exit code: `0`
- No TypeScript errors reported.

This directly resolves the typecheck failures cited in `STAGE2_RESEND_FINAL_ACCEPTANCE_REPORT.md`.

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

## 4. API contract verification

### `sendEmail()`
Verified from `src/lib/resend.ts`:

- Exported async function.
- Accepts `SendEmailOptions`.
- `SendEmailOptions` requires:
  - `to: RecipientList`
  - `subject: string`
  - `template: string`
  - optional `text?: string`
  - optional `replyTo?: RecipientList`
  - optional `headers?: Record<string, string>`
- Returns `Promise<SentEmail>`.
- `SentEmail` contains `requestId: string` and optional `id?: string`.
- Wraps provider/SDK errors through `normalizeProviderError(...)`.

So the function still has a usable call contract, but it is now explicitly a **templated send**
surface: a caller must supply `template`.

### `sendTemplatedEmail()`
Verified from `src/lib/resend.ts`:

- Exported async function.
- Accepts `SendTemplatedEmailOptions`.
- `SendTemplatedEmailOptions` requires:
  - `to: RecipientList`
  - `subject: string`
  - `template: string`
  - optional `templateParameters?: Record<string, string | number>`
  - optional `replyTo?: RecipientList`
  - optional `headers?: Record<string, string>`
- Returns `Promise<SentEmail>`.
- Wraps provider/SDK errors through `normalizeProviderError(...)`.

So this function preserves the intended richer template-parameter contract.

---

## 5. Required review point: “making `template` required has not removed HTML/text email functionality”

This point is **true, but with an important semantic change** that the reviewer must accept
explicitly.

### What is preserved
- The module still supports sending emails that contain a plain-text body through `sendEmail(...)`.
- `sendEmail(...)` still accepts optional `text`.
- `toResendOptionsForSend(...)` still passes `text` through for the SDK payload when present.
- The module is still “HTML/text email” in the practical sense that the SDK ultimately delivers
  rendered email content.

### What changed
- The public `SendEmailOptions` contract for `sendEmail(...)` no longer has an `html` field.
- `sendEmail(...)` now requires a `template` id.
- `toResendOptionsForSend(...)` now sets `html: ""` for the SDK payload, because the module’s
  `sendEmail(...)` surface no longer carries HTML body content itself.

### Assessment
If the intended SellFlow API for `sendEmail(...)` was “call with an HTML body and no template,”
then making `template` required is a **breaking API clarification**, not a silent removal of HTML
sending at the SDK level. The module currently expresses `sendEmail(...)` as a templated send that
may additionally carry plain text.

That is acceptable only if:
- the codebase does not currently call `sendEmail(...)` with raw `html` and no `template`, and
- the intended contract going forward is genuinely template-based sending.

A non-exhaustive search found no non-resend-module production code importing or calling
`sendEmail(...)` or `sendTemplatedEmail(...)` in the current tree. So in the current codebase,
the contract change is not yet exposed to external callers. It is still a real API-design point,
not a silent behavior regression.

---

## 6. Test accuracy verification

The corrected test suite covers:

- safe non-secret `configSummary`
*>`isConfigValid` reported as `true` when env present
*>successful `sendEmail(...)` return shape: UUID `requestId`, mocked `id`, no `apiKey`/`secret`
*>approved sender/reply-to defaults read from `FROM`/`REPLY_TO`
*>default reply-to path exercise for `sendEmail(...)`
*>`InvalidRecipientError` for invalid single recipient
*>`InvalidRecipientError` for invalid recipient array entry
*>custom reply-to forwarding for `sendEmail(...)`
*>missing env error message discipline
*>malformed sender config error message discipline
*>`normalizeProviderError(...)` producing `ResendProviderError` with safe public message
*>provider message/key not leaking into public error text
*>provider rejection wrapping for `sendEmail(...)`
*>network failure wrapping for `sendEmail(...)`
*>sensitive request details not included in network error
*>stable distinct `requestId` values across calls
*>templated email sending via `sendTemplatedEmail(...)`
*>default reply-to for template sends
*>provider error details kept internal only

That is accurate coverage for the **current supported public behavior**, not merely for the
implementation shape. The tests match the corrected API, and they do not assert on stale `html:`
call sites anymore.

Limitations on test strength remain:

- SDK is mocked, so the real `resend.emails.send(...)` path is not exercised against the installed
  SDK.
- Success tests assert return shape and secrecy, not the exact SDK input payload for every path.
*>Discovery is scoped to one file by `vitest.config.ts`.

Those are test-strength limitations, not evidence of a regression.

---

## 7. Localized SDK cast verification

Verified from `src/lib/resend.ts`:

- The module imports only `Resend` from `"resend"`.
- It does **not** import `CreateEmailOptions` or `CreateEmailRequestOptions`.
- The SDK call is routed through:
  ```ts
  interface ResendSendResponse {
    data?: { id?: string };
  }

  const sendEmailFn = (
    resend.emails as { send: (options: unknown) => Promise<ResendSendResponse> }
  ).send;
  ```
- The internal builders `toResendOptionsForSend(...)` and `toResendOptionsForTemplate(...)` build a
  module-internal `ResendOptions` shape and pass that to `sendEmailFn(...)`.
- No module-wide `any` is introduced.
- No new double assertion is added.

So the SDK-boundary workaround remains isolated and documented, and the typecheck correction did not
widen it into a broader suppression.

---

## 8. Security posture verification

### Server-only enforcement
- Module uses only `import { Resend } from "resend"` plus server-safe Node/Next APIs.
- No React/Next client component import.
- No `NEXT_PUBLIC_` read of Resend secrets.

### API-key protection
- `API_KEY` is loaded via `requireEnv("RESEND_API_KEY")` and used only to initialize the SDK client.
- No public API returns the key.
- `configSummary` returns only parsed sender/reply-to emails.
- `SentEmail` contains only `requestId` and optional `id`.

### Error sanitization
- `ResendProviderError.toLogString()` sanitizes the documented placeholder strings
  `SECRET_API_KEY_VALUE` and `API_KEY_PLACEHOLDER` to `<redacted>`.
- Public error messages do not contain the API key.

### Import isolation
- `check-resend-import.mjs` still reports that client import is blocked by module validation when
  env vars are absent.

### Secret scanning
- `security-scan.mjs` still reports no suspect secret markers in listed files or tracked diff.

### Environment file posture
- `.env.local` is absent/unmodified in this environment.
- `.env` exists locally and is untracked/gitignored; its contents were not read or exposed in this
  review.

---

## 9. Unauthorized-functionality verification

Verified against the current repo tree and the corrected files:

- No password-reset routes, models, migrations, or UI were added or changed.
- No S-09, S-12, S-14, S-13, S-15, billing, entitlements, or C-03 work was performed.
- Only `src/lib/resend.ts` and `src/lib/resend.test.ts` were touched after the previous
  typecheck correction.
- No real email was sent.
- No API key or `.env.local` content was exposed.

---

## 10. Outstanding risks and limitations

1. **SDK typing workaround remains.** The installed SDK’s `CreateEmailOptions` union does not cleanly
   accept the module’s internal template-shaped payload, so a localized callable cast is still in use.
   This is documented and contained, but it is not a purely SDK-conformant type pathway.
2. **Test strength is unit-level.** No real SDK call path is exercised; success path coverage is
   return-shape-centric and does not assert the exact SDK input payload for every path.
3. **Test discovery is intentionally narrow.** Only `src/lib/resend.test.ts` is in scope.
4. **`sendEmail(...)` is now explicitly template-based.** That was a deliberate API clarification; if
   any future caller expected a raw-HTML `sendEmail(...)` without template, it would need a contract
   update. No such caller was found in the current codebase.
5. **Provider-diagnostic leakage is downstream-guarded, not mechanically enforced.** `ResendProviderError`
   retains `providerMessage` on the object; the module does not serialize it publicly, but it also does
   not mechanically prevent a future route or error boundary from doing so.
6. **Acceptance scripts are still limited.** They are helpful but not exhaustive for client-import paths
   or comprehensive secret detection.
7. **Phase 0 validation remains incomplete.**

---

## 11. Conclusion

After the TypeScript correction:

- `npx tsc --noEmit` passes.
- `npx vitest run` passes with 19 tests and 0 failures.
- `check-resend-import.mjs` and `security-scan.mjs` both pass.
- `sendEmail(...)` and `sendTemplatedEmail(...)` preserve intended send-api contracts, with the
  explicit clarification that `sendEmail(...)` is now template-based and requires `template`.
- Security, server-only enforcement, error sanitization, and import isolation remain intact.
- No unauthorized SellFlow functionality was modified.

The implementation is safe to accept **within the documented limitations**.

---

## 12. Final verdict

**ACCEPTED WITH LIMITATIONS**

---

End of report.
