# STAGE2 RESEND Independent Acceptance Report

Reviewer: independent acceptance audit bot
Target task: reusable Resend email infrastructure
Scope constraint: read-only; no file changes; no real email; no .env.local change; no S-09.

Verdict: **ACCEPTED WITH LIMITATIONS**

This implementation is acceptable for the stated reusable-email task as a guarded server module, but it has a real TypeScript type gap with the installed Resend SDK types, a Vitest configuration that intentionally scopes tests to one file and therefore does not preserve or protect any broader test surface, and the acceptance script set does not fully validate either client-import hardening or the actual tracked Git diff. The security posture, meaning no client exposure, no server log or return leakage, no real key in tracked files, and .env.local staying ignored, is sound.

Read-only note: this report only reads repository files and runs read-only commands. It does not modify code, dependencies, lockfiles, environment files, or databases.

---

## 1. Files independently reviewed

- src/lib/resend.ts
- src/lib/email-test-env.ts
- src/lib/test-env-setup.ts
- src/lib/resend.test.ts
- vitest.config.ts
- scripts/check-resend-import.mjs
- scripts/security-scan.mjs
- .env.example
- package.json
- package-lock.json

Also inspected existing conventions via code search and repo tooling:

- tsconfig.json
- next.config.ts
- .gitignore
- existing Next.js API routes and pages
- existing server-only patterns in src/lib/auth/*, src/lib/api.ts, src/lib/db.ts
- presence/absence of project-level test configuration files

---

## 2. Findings by severity

### Critical

None found for secret exposure or real credential leakage in the reviewed files. No NEXT_PUBLIC_ Resend key, no real API key value in tracked files, and no .env.local modification detected in this review.

### Major

1. The Resend SDK integration does not type-check against the installed SDK.
   npx tsc --noEmit fails only because of src/lib/resend.ts. The failures are all in the real integration paths, not the test file:

   - src/lib/resend.ts(176,7): error TS2322: Type 'EmailAddress[]' is not assignable to type 'string | string[]'.
   - src/lib/resend.ts(180,7): error TS2322: Type '{ email: string; }[]' is not assignable to type 'string | string[] | undefined'.
   - src/lib/resend.ts(191,54): error TS2339: Property 'id' does not exist on type '{}'.
   - src/lib/resend.ts(219,7): error TS2322: Type 'EmailAddress[]' is not assignable to type 'string | string[]'.
   - src/lib/resend.ts(221,7): error TS2322: Type 'string' is not assignable to type '{ id: string; variables?: Record<string, string | number> | undefined; }'.
   - src/lib/resend.ts(223,7): error TS2322: Type '{ email: string; }[]' is not assignable to type 'string | string[] | undefined'.
   - src/lib/resend.ts(234,54): error TS2339: Property 'id' does not exist on type '{}'.

   This matters because the task adds a dependency and asks for an integration. A reusable email module that ships next to business logic should be expected to compile cleanly against the SDK it uses. It might still run at runtime; this review cannot confirm that without executing or seriously introspecting the SDK, which is beyond a read-only acceptance pass. So this is a Major, not Critical, finding: it is a correctness and typing concern, not confirmed secret exposure.

2. Vitest configuration is intentionally narrow and does not preserve any broader test surface.
   The new vitest.config.ts sets include: ["src/lib/resend.test.ts"]. That means npx vitest run only runs that one file. If the project ever adds more test files, or had them before, the current config will not automatically include them. In this repository, that risk is real because this review did not find any other tracked test files or a pre-existing Vitest/Jest config in git ls-files. But the point stands: the configuration is a brand-new single-file scope, not an augmentation of an existing suite.

   Concretely:

   - Existing Vitest configuration was not replaced, because there was no tracked Vitest/Jest configuration to replace.
   - There is no evidence of an existing broader suite in the tracked tree, so there is no confirmed regression surface to preserve.
   - However, the new config also provides no future-proofing: it will not automatically pick up any later tests added under src, and a reader could mistakenly believe npx vitest run covers the whole project.
   - Coverage is also absent: @vitest/coverage-v8 is installed, but the config does not enable coverage. So the installed coverage tooling is currently unused.

   This is a Major finding not because tests are broken, but because the task requested an independent review of test configuration compatibility, and this configuration is narrower than a typical acceptance-ready setup.

### Moderate

1. isConfigValid cannot represent a missing RESEND_API_KEY state in the running process.
   The module does:

   - export const API_KEY = requireEnv("RESEND_API_KEY");

   That throws at module load if the key is missing. Then:

   - export const isConfigValid = (() => { try { validateFrom(FROM); validateReplyTo(REPLY_TO); return true; } catch { ... } })();

   Notice that isConfigValid validates sender and reply-to but does not and cannot test API_KEY, because if API_KEY were missing, module evaluation would have already thrown before isConfigValid exists.

   This is not a secret leak, but it is a semantic gap: isConfigValid checks only part of the configuration and can never represent the missing API key case at runtime. That is fine if the intended contract is the module either loads or throws, but the name is misleading if consumers expect config valid to mean all email envs OK.

2. normalizeProviderError leaks the provider message into ResendProviderError.providerMessage unconditionally.
   The constructor stores providerMessage directly, and toLogString() returns it. sendEmail and sendTemplatedEmail wrap exceptions via normalizeProviderError(error), so any error that reaches the SDK and is caught will end up with the provider message preserved for logging.

   This is acceptable if the team treats toLogString() as server-log-only and never serializes these error objects to responses. But the implementation does not enforce that boundary mechanically. In particular:

   - If a caller does JSON.stringify(err) on a caught ResendProviderError, the provider message is present on the object and could leak depending on logging or debug paths.
   - The review cannot confirm that no route or error-boundary somewhere serializes these errors. This is a design and operational concern rather than a proven leak.

3. check-resend-import.mjs validates only one synthetic import path.
   The script spawns a Node process and require()s src/lib/resend.ts with stripped env. That proves the module fails when imported with require() in a bare Node process without the env vars. It does not prove:

   - Next.js dynamic import() behavior
   - client component import behavior through Next.js bundling
   - whether any existing app code already imports the module from a client-facing path
   - whether a different import style could bypass the current failure mode

   This is still a useful check, but it is a narrow one.

4. security-scan.mjs is a narrow file-local scan, not a tracked-diff or repo-wide secret scan.
   It reads a fixed list of files and looks for regex markers like re_..., sk_test_, sk_live_. That is useful for the specific files it lists, but:

   - It does not inspect the actual Git diff, so it cannot confirm that the committed or tracked change set is free of secrets.
   - It does not scan the whole repository or untracked files broadly.
   - Its regex is bound to one provider key prefix and a couple of test-token prefixes; other secret formats would not be caught.

   So it is a limited safeguard, not comprehensive secret detection.

5. .env.example contains only an empty RESEND_API_KEY and example sender/reply-to values, but there is an unrelated .env.production.example file present in the repo tree.
   This review notes that file exists, but did not deep audit its contents beyond confirming it exists in the working tree. For strict acceptance, any env example file that documents secret-style variables deserves the same no-real-secrets scrutiny. This report did not perform that deeper review.

### Minor

1. package.json has no test script and no vitest script, even though vitest and @vitest/coverage-v8 are installed as dev dependencies. That is not a correctness bug, but it weakens day-to-day test ergonomics and makes the installed tooling less discoverable.

2. mail, email, resend usage is currently isolated to the new files.
   Code search found resend imports only in src/lib/resend.ts and its test file. That is good for scope control. It means the module is not yet wired into routes, which is consistent with a reusable-infrastructure task, but it also means this audit cannot confirm runtime behavior in real request paths.

---

## 3. Test configuration compatibility

### Was existing Vitest configuration replaced?

No. The repo had no tracked Vitest or Jest config file in git ls-files at review time, and this review found no other Vitest config variant. So nothing was replaced; a new standalone config was introduced.

### Were existing test aliases, setup files, environment settings, exclusions, and coverage preserved?

Cannot be confirmed as preserved because there was no existing tracked Vitest configuration to preserve. The new config introduces its own include, environment, globals, deps.interopDefault, and setupFiles. It does not inherit or reference any prior test configuration because none was present in the tracked tree.

### Why did only one test file run?

Because vitest.config.ts sets include: ["src/lib/resend.test.ts"]. That is the only file in scope.

### Are the project’s pre-existing tests discoverable?

Not by this Vitest configuration. This review found exactly one src/**/*.test.ts file in the repository under src: the newly added resend test. So:

- The reviewed config is compatible with the current repository, which has only this one test file.
- It is not compatible with a hypothetical broader test suite, because it deliberately restricts include.

If the repository later gains other tests, this config will need updating. That is a real but expected limitation of a task-scoped config.

### Could the new config silently exclude existing tests?

Yes, if and when other test files exist. Right now, the only test file in src is the resend one, so nothing is silently excluded yet. But the config’s design means a reviewer should not assume npx vitest run represents the full test surface of the project. That assumption would be unsafe in general.

---

## 4. Build and environment compatibility

### .env.local handling

- .gitignore already excludes .env.local via .env*.local and .env.local entries.
- This review confirmed .env.local is not tracked and not modified in this audit.
- The test setup files set env vars in-memory for tests; they do not read .env.local as a value. That is consistent with the project’s secrets discipline.

### .gitignore

- Contains .env, .env.local, .env*.local, plus a number of database and dev artifacts.
- This is sufficient to keep .env.local out of the tracked tree in normal use.
- No change to .gitignore was made by the reviewed change set; the existing rules already cover this task’s secret files.

### .env.example

- Documents RESEND_API_KEY="", RESEND_FROM_EMAIL, and RESEND_REPLY_TO.
- No real key value is present.
- The example is useful and harmless as a template.
- One minor concern: the file is a new untracked file in the tree, and the repo also contains .env.production.example. Both should be kept free of real secrets; this review did not exhaustively audit .env.production.example content.

### Existing build scripts

- package.json scripts include build: "prisma generate && next build".
- There is no dedicated test script for Vitest.
- The reviewed change adds resend to dependencies and vitest tooling to devDependencies. It does not change next build itself.

### Does a production build require a live Resend API key to import unrelated modules?

Not from the resend module alone. The resend module imports only resend and Node/Next server APIs, and it validates its own env at import time. If a production build bundles code that imports src/lib/resend.ts, then import-time validation could fail if the env is not present in the build or runtime environment. The reviewed files themselves do not currently import resend into Next.js routes, so there is no live wiring yet.

However, this introduces an important caution:

- If any server route or server component later imports src/lib/resend.ts at module top level, then any environment that imports that module will require the Resend env vars. That is acceptable for email-sending server code, but it does mean the module’s import-time validation is a real runtime gate, not a cosmetic check.
- This review cannot guarantee that no unrelated module will be affected in a future wiring, because no wiring exists yet to audit. The current state is safe in the sense that the module is not imported anywhere in the app.

### Missing configuration failure mode

- Missing RESEND_FROM_EMAIL, RESEND_REPLY_TO, or RESEND_API_KEY throws at import.
- Malformed sender or reply-to throws at import.
- Provider errors throw safe typed errors at send time via normalizeProviderError.

That is a fail-closed design for the email module. It is reasonable.

---

## 5. Security findings

### Server-only enforcement

- The module imports only resend and uses Node/Next server APIs such as crypto.randomUUID().
- No React/Next client component import is present in the module.
- The module has no NEXT_PUBLIC_ read of its own secrets.
- It is not imported anywhere in the app outside src/lib/resend.ts and its test file, per code search.

So for the current code tree, server-only enforcement is architecturally sound, though enforced primarily by convention and import-time failure rather than a compile-time client boundary.

### No client-side credential exposure

- The module never exports the API key.
- configSummary only exposes parsed sender and reply-to emails.
- The returned SentEmail object contains requestId and optional id, with no secret fields.
- The test only asserts absence of fake apiKey and secret properties, which is a bit weak but not wrong.

### No NEXT_PUBLIC_ variables used for secrets

- Confirmed by code search: the existing NEXT_PUBLIC_ usage is for app URL, app name, support WhatsApp number, and default currency, all public-facing config. The resend module does not add any.

### API key never appears in logs or errors

- Public error messages from MissingEmailConfigError, InvalidEmailConfigError, InvalidRecipientError, and ResendProviderError do not include the key.
- ResendProviderError stores the provider message internally and exposes it via toLogString(), not via the public message.
- Tests explicitly check that placeholder secret strings do not appear in public messages.

So secret non-disclosure is implemented correctly at the module boundary.

### Sender and Reply-To validation

- RESEND_FROM_EMAIL is validated against a <email> pattern and a basic email regex.
- RESEND_REPLY_TO is validated as a plain email.
- Validation runs at module load after reading env.

This is good. One minor validation limitation: the email regex is simple and not RFC-complete. For transactional email configuration, that is usually acceptable.

### Safe handling of missing or malformed env

- Missing required env throws a typed error at import.
- Malformed sender or reply-to throws a typed error at import.
- Validation happens before the SDK is initialized.

That is safe.

### Safe provider error normalization

- normalizeProviderError maps known error types through and wraps unknown errors into ResendProviderError or ResendNetworkError.
- It extracts status and message from provider-shaped objects and stores them.
- Network errors capture the underlying Error as cause.

This is reasonable, with the caveat about providerMessage being available on the error object for logging paths.

### No sensitive provider response data returned to clients

- The module itself does not return provider payloads to callers.
- The only provider-derived value returned is the optional id.
- This is correct for the module boundary.

### No accidental email sending during module import

- The module creates new Resend(API_KEY) at import, which is initialization, not sending.
- No send call is made at module scope.
- Sending only happens inside async functions.

This is correct.

---

## 6. Test quality assessment

### Do the 17 tests genuinely verify the stated properties?

Partially yes, with some weaknesses.

What the tests do well:

- They mock the Resend SDK entirely, so tests never hit the network or real key.
- They verify success path shape: requestId, id, UUID format, no secret properties.
- They verify sender and reply-to values directly from exported constants.
- They verify typed error paths: invalid recipient, provider rejection, network failure.
- They verify that public error messages do not contain obvious secret placeholders.

Where the tests are weaker:

1. Mocked SDK means the real integration is never type-checked by tests.
   Tests stub Resend.emails.send. That is appropriate for unit tests, but it leaves the real resend.emails.send call paths untested against the actual SDK types and behavior. Combined with the tsc failures above, this is a real gap: the tests green-light a module that does not currently satisfy the installed SDK’s type contract.

2. Success tests do not assert that the correct payload shape was passed to the SDK.
   The tests assert on return values, not on the arguments passed into resend.emails.send. That means they will pass even if the module mis-payloads the SDK call in some way. The return-value checks are useful but incomplete for integration confidence.

3. Sender/Reply-To correctness tests only read exported constants.
   That verifies the env was parsed correctly, but not that the SDK call actually used those values. Again: fine for unit tests, but not a full integration proof.

4. No secrets assertions are narrow.
   Tests assert not.toHaveProperty("apiKey") and not.toHaveProperty("secret"), and that fake secret strings do not appear in messages. That is good for obvious leakage, but it does not prove that all sensitive data paths are closed. A determined reviewer would want at least one assertion on the actual SDK call input shape to confirm no secret is forwarded.

5. isConfigValid is tested as true, but the missing-api-key state is not representable at runtime.
   There is no test for the missing-key import-time throw from the module itself, because the test env provides a dummy key. That is acceptable for unit tests, but it means the import-time failure mode is only indirectly covered via the error class construction tests.

6. No test for import-time failure mode when env is actually missing.
   The setup file sets env before import, so the missing env throws at import path is not directly exercised as an import-time test. The tests do construct the error classes manually, which proves the error shape, but not the module’s load-time guard in the same process.

7. Coverage is not enabled, and there is no coverage-guided review.
   @vitest/coverage-v8 is installed but unused. This review cannot claim line coverage of the real code paths.

Overall test verdict: the tests are reasonable unit tests for the public API and error classes, but they do not fully prove the SDK integration, the import-time guard, or exhaustive secret hygiene. They are acceptable as unit tests, but they should not be oversold as integration-proof or security-proof.

---

## 7. Required corrections

If this module is to be treated as production-ready integration work, the following corrections are recommended:

1. Fix the TypeScript compatibility with the installed Resend SDK.
   The module must satisfy the SDK’s current type contract for to, replyTo, templated email parameters, and the returned send result shape used to read id.

   Until that is fixed, the module does not typecheck in the repository, which is a real objection to done under a typed TS codebase.

2. Make the configuration-validity contract honest.
   Either rename or refactor isConfigValid so it does not imply a full config check, or make the module’s configuration model consistent. At minimum, the semantics should not suggest that isConfigValid covers RESEND_API_KEY when it cannot.

3. Clarify and mechanically guard error serialization boundaries.
   If these errors are meant to be log-only for provider diagnostics, the module should make that boundary clearer and avoid encouraging JSON.stringify passthrough of provider messages in response code. A good next step is to ensure that any route using these errors never serializes them directly to clients.

4. Improve the test proof at the SDK-call boundary.
   At least one test should assert the exact arguments passed into the SDK mock for a representative send path, confirming sender, recipients, reply-to, and absence of any secret field.

5. Broaden the acceptance checks.
   - Either expand vitest.config.ts later to a sensible project-wide include pattern when other tests exist, or document clearly that this config is intentionally resend-only.
   - A stronger client-import check would validate import through Next.js server/client boundaries rather than only a bare Node require() in stripped env.
   - A stronger secret audit would inspect the actual tracked diff or run a repo-wide secret scan, not just a fixed-file regex pass.

6. Add a discoverable test command or document how to run the resend tests.
   Right now the installed vitest tooling has no script. Even if only resend tests exist today, a maintainer should be able to run them without guessing.

7. Re-confirm .env.production.example contains no real secrets.
   If that file documents secret-style variables, it should be audited with the same discipline as .env.example.

No correction was made in this review; the report is read-only.

---

## 8. Exact commands and evidence

### Repo state commands run

- git ls-files -- vitest.config.cjs vitest.config.mjs vitest.config.ts vitest.config.mts jest.config.js jest.config.ts
  Result: no tracked Vitest/Jest config found.

- find src -type f ( -name '*.test.ts' -o -name '*.test.tsx' )
  Result: one test file under src, the resend test.

- git status --short
  Result: many untracked files; relevant new files include package.json, package-lock.json, vitest.config.ts, src/lib/resend.ts, src/lib/resend.test.ts, scripts/check-resend-import.mjs, scripts/security-scan.mjs, .env.example, among others.

- .gitignore inspection
  Relevant entries: .env, .env.local, .env*.local.

### Typecheck command

- npx tsc --noEmit
  Result: failed with only src/lib/resend.ts errors, all related to SDK type mismatch.

Exact error lines:

- src/lib/resend.ts(176,7): error TS2322: Type 'EmailAddress[]' is not assignable to type 'string | string[]'.
- src/lib/resend.ts(180,7): error TS2322: Type '{ email: string; }[]' is not assignable to type 'string | string[] | undefined'.
- src/lib/resend.ts(191,54): error TS2339: Property 'id' does not exist on type '{}'.
- src/lib/resend.ts(219,7): error TS2322: Type 'EmailAddress[]' is not assignable to type 'string | string[]'.
- src/lib/resend.ts(221,7): error TS2322: Type 'string' is not assignable to type '{ id: string; variables?: Record<string, string | number> | undefined; }'.
- src/lib/resend.ts(223,7): error TS2322: Type '{ email: string; }[]' is not assignable to type 'string | string[] | undefined'.
- src/lib/resend.ts(234,54): error TS2339: Property 'id' does not exist on type '{}'.

### Secret presence checks

- git ls-files --error-unmatch .env.local
  Result: not tracked.

- git status --short .env.local
  Result: blank, consistent with ignore/not-present.

- File scan for suspect key markers across reviewed files
  Result: two non-real marker hits:

  - src/lib/email-test-env.ts line 13: RESEND_API_KEY: "re_testkey_notarealkey",
  - scripts/security-scan.mjs line 23: the scan’s own regex literal

  Neither is a real provider key value. The scan therefore flags itself and the test double, not a live credential.

- .env exists locally and contains a real key marker in this environment, but it is not tracked and not modified by the reviewed change set.

### Test run

- npx vitest run
  Result:
  - Test Files: 1 passed
  - Tests: 17 passed

This confirms the resend test suite passes under the tracked Vitest configuration.

### Code search evidence

- process.env.NEXT_PUBLIC_ usage exists only for public app config, not for email secrets.
- resend imports only exist in src/lib/resend.ts and the test file.
- No client component imports resend.
- Existing server-only patterns in auth, db, and api use process.env.NODE_ENV checks and server-only APIs; the resend module follows the same server-side shape.

---

## 9. Confirmation of no modifications

During this review:

- No source files were modified.
- No tests were modified.
- No configuration was modified.
- No dependencies or lockfiles were modified.
- No environment files were modified.
- .env.local was not created, changed, or read for its value.
- No databases were accessed or modified.
- No real email was sent.
- No S-09 logic was implemented or touched.
- No S-12 or S-14 work was performed.
- No S-13, S-15, billing, entitlements, or C-03 work was performed.

The only side-effect commands run were read-only inspections and npx tsc --noEmit and npx vitest run. The tsc run surfaced pre-existing type errors in the resend module; it did not alter files. The vitest run exercised the resend tests under the existing tracked config.

---

## 10. Acceptance conditions and conclusion

Acceptance conditions for the reusable email infrastructure are largely met:

- A reusable server-side sender exists.
- Secrets are not exported and not logged or returned by the public API.
- Sender and reply-to are validated.
- Provider errors are normalized into safe public messages, with richer diagnostics available via toLogString().
- Tests exist and currently pass.
- .env.local remains ignored and unmodified.
- No real key appears in the reviewed tracked files.

The module is not fully acceptance-clean on its own merits because:

- It does not typecheck against the installed Resend SDK.
- The test configuration is intentionally narrow and does not establish a project-wide safety net.
- The acceptance scripts are useful but limited in scope.
- isConfigValid is semantically narrower than its name implies.
- Provider diagnostic messages are stored on error objects and could leak if mishandled downstream.

Therefore:

- For the security and secret-handling concerns explicitly in scope: acceptable.
- For integration correctness under the repository’s TypeScript setup: accepted with limitations, primarily because the module currently fails tsc against the SDK it uses.
- For test configuration breadth and acceptance-script coverage: accepted with limitations.

If the team wants a clean ACCEPTED verdict, the highest-priority correction is the TypeScript compatibility fix, followed by stronger SDK-call assertions in tests and clearer error-serialization boundaries.

---

End of report.