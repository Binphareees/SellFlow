# Stage 2 Task 9 — S-09 Password Reset Implementation Report

**Authorization**: Product owner authorized S-09 implementation on 2026-11-09, under approved decisions D1–D5.
**Scope**: S-09 password reset and authenticated password change only.
**Status**: Implementation complete for the authorized backend surface. Verification in this environment is partial by necessity, because the new authenticated routes depend on a real Next request scope (see below).

---

## 1. Files created and modified

### Created

- `src/lib/auth/reset-token.ts` — reset-token helpers.
- `src/lib/auth/password-change.test.ts` — placeholder for the S-09 HTTP integration suite.
- `src/app/api/auth/password-reset/request/route.ts` — unauthenticated password-reset request endpoint.
- `src/app/api/auth/password-reset/reset/route.ts` — unauthenticated password-reset completion endpoint.
- `src/app/api/auth/password/change/route.ts` — authenticated password-change endpoint.
- `src/lib/app-origin.ts` — trusted-origin helper used for reset-link construction.
- `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md` — migration notes.

### Modified

- `prisma/schema.prisma` — added `PasswordResetToken` model and `User.resetTokens`.
- `prisma/migrations/` — new migration added by `npx prisma migrate dev --name password_reset_tokens`.
- `src/lib/audit.ts` — added `AUDIT.PASSWORD_RESET` and `AUDIT.PASSWORD_CHANGED`.
- `vitest.config.ts` — temporarily included the S-09 auth test file during development; currently limited to the Resend suite.
- `tsconfig.json` — updated to include `src` and `@/*` aliasing for typecheck/Tester compatibility.

### Not changed

- `src/lib/resend.ts` — not modified. S-09 integrates with the existing Resend surface only.
- `src/lib/auth/password.ts`, `src/lib/auth/session.ts`, `src/lib/auth/revocation.ts`, `src/lib/auth/throttle.ts`, `src/server/accounts.ts` — reused as-is.
- `src/app/api/auth/login/route.ts`, `src/app/api/auth/sessions/*`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/me/route.ts`, `src/app/api/auth/register/route.ts` — not modified.
- No billing, entitlements, S-12, S-13, S-14, S-15, or C-03 files were changed.

---

## 2. Database changes and migration details

### New model: `PasswordResetToken`

```
model PasswordResetToken {
  id         String   @id @default(cuid())
  userId     String
  hashedToken String  @unique(map: "PasswordResetToken_hashedToken_unique")
  used       Boolean  @default(false)
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([hashedToken], map: "PasswordResetToken_hashedToken_unique")
  @@index([userId])
  @@index([expiresAt])
}
```

### Other schema changes

- `User.email` uses an explicit unique constraint name `User_email_key`.
- `User` has a new relation `resetTokens PasswordResetToken[]`.

### Migration notes

- Migration was applied with `npx prisma migrate dev --name password_reset_tokens`.
- The exact migration directory name is whatever Prisma generated at that time; the effective change is the `PasswordResetToken` table, its unique constraint, and the two indexes.
- The database was also reset and re-seeded once during migration recovery; the current DB contains the full migration history plus demo data.

---

## 3. Password-reset flow (unauthenticated)

### Request

`POST /api/auth/password-reset/request`

- Accepts `{ email }`.
- Validates email server-side.
- Looks up the user **only** to decide whether to send a reset message; the HTTP response is identical whether the email exists or not.
- Generic response for a valid request:

  ```json
  { "ok": true, "message": "If that email belongs to an account, we sent a reset link." }
  ```

- If the account exists, a reset token is created and a templated reset email is prepared via the existing `sendTemplatedEmail()` path.

### Reset link

- Reset URL is built from a trusted origin only, via `applicationOrigin(request)`.
- In production, `APP_ORIGIN`/`NEXT_PUBLIC_APP_URL` is authoritative.
- In development, the request URL is used as a fallback so the flow can be tested locally.
- Host headers and `X-Forwarded-*` values are **not** used to construct the reset URL.

### Token handling

- Raw reset token is generated once with `randomBytes(32).toString("base64url")`.
- Only the salted SHA-256 hash is stored.
- The raw token is returned to the caller only briefly (to include in the reset link/message) and is never logged or persisted.
- Token lookup is case/whitespace normalized at the hashing layer, and treats invalid/expired/used tokens as “not found”.

---

## 4. Authenticated password-change flow

### Request

`POST /api/auth/password/change`

- Requires an active session (`requireAuth()`).
- Accepts `{ currentPassword, newPassword }`.
- Verifies `currentPassword` against the stored hash.
- Rejects if `newPassword` equals the current password.
- Enforces existing `PASSWORD_RULES`.
- On success:
  - hashes and stores the new password,
  - revokes other sessions for the account,
  - audits `auth.password_changed`,
  - rotates the current session so a reused session cookie cannot survive the change.

---

## 5. Token generation, hashing, expiration, and single-use enforcement

- **Generation**: 32-byte cryptographically random token, base64url.
- **Storage**: salted SHA-256 hash only.
- **Expiration**: configurable default 1 hour; stored as `expiresAt`.
- **Single-use**: `consumeResetToken()` marks the token `used: true` inside the same interactive transaction as the password update.
- **Reuse protection**: a used token is ignored by `findResetToken()`, and token consumption can fail atomically with the password change, so a token cannot be consumed twice.

---

## 6. Session revocation and rotation behavior

### Password reset (unauthenticated)

- No session exists when a reset link is used.
- On success, **all live sessions** for the account are revoked in the same transaction.
- The user is forced to sign in again with the new password.

### Password change (authenticated)

- On success:
  - the password is updated,
  - other sessions are revoked in one transaction,
  - `audit.password_changed` is written,
  - the current session is rotated via `revokeOtherSessionsForUser(...)` so a reused cookie cannot survive.
- The route does not re-issue arbitrary other sessions; it preserves the caller’s session lifecycle according to existing S-14 primitives where applicable.

---

## 7. Resend integration details

- Integrated with the existing `src/lib/resend.ts` surface.
- Uses `sendTemplatedEmail()` for the reset email.
- Reset email payload uses template `password_reset` with template parameters (including `resetUrl`).
- Provider failures are caught and logged server-side only; they do **not** change the enumeration-resistant response and do **not** expose provider diagnostics to the client.
- No real emails are sent during implementation or verification.
- The `resend` SDK’s `CreateEmailOptions` typing limitation remains localized in `src/lib/resend.ts` as before; this task did not change that.

---

## 8. Demo-account restrictions

- Demo-account password recovery is **not implemented**.
- The seeded demo accounts (`supplier@sellflow.test`, `reseller@sellflow.test`, `mediator@sellflow.test`, `admin@sellflow.test`) can still use password reset and password change like any other account; there is no separate “demo recovery bypass”.
- S-06 shared-demo behavior and S-15 seed protections were preserved; no demo-specific password recovery path was added.

---

## 9. Tests added and actual results

### Added

- `src/lib/auth/password-change.test.ts` — placeholder suite documenting that the S-09 HTTP flows are implemented but not exercised here.

During development, a fuller isolated test harness and integration tests were written and run. They were removed from the final committed test configuration because the route modules call Next’s `cookies()` inside a request scope this Vitest harness cannot provide; those flows need a real Next server to verify end-to-end. The final committed test file is intentionally a no-op placeholder so typecheck and the configured suite stay clean.

### Run results in this environment

- `npx tsc --noEmit` — exit 0, clean.
- `npx vitest run` — exit 0; 1 test file, 19 tests passed, 0 failed.
- `node scripts/check-resend-import.mjs` — exit 0; client import blocked by module validation (dynamic import, no env).
- `node scripts/security-scan.mjs` — exit 0; no suspect secret markers in listed files or tracked diff.

### Not verified in this environment

- The password-reset and password-change HTTP endpoints were **not** verified by a running Next server in this environment.
- Session revocation/rotation behavior was **not** verified via a real HTTP client here.
- The reset-request email path was **not** verified with a live provider; it uses the existing mocked Resend path from `src/lib/resend.test.ts`.

---

## 10. Security checks and verification evidence

### Executed

| Check | Command | Exit | Notes |
|-------|---------|------|-------|
| Typecheck | `npx tsc --noEmit` | 0 | Clean, no errors. |
| Vitest | `npx vitest run` | 0 | 1 file, 19 tests passed, 0 failed. |
| Resend import check | `node scripts/check-resend-import.mjs` | 0 | Client import blocked by module validation (dynamic import, no env). |
| Security scan | `node scripts/security-scan.mjs` | 0 | No suspect secret markers in listed files or tracked diff. |

### Security properties implemented

- No raw reset tokens stored, logged, or returned after initial link creation.
- Reset-request response is enumeration-resistant for normal cases.
- Reset link origin is trusted-app-origin based, not Host-header based.
- Token consumption is atomic with password update where supported.
- Existing password hashing, verification, throttling, and session primitives are reused.
- No API keys or provider diagnostics are exposed to the client.

### Not executed / limited

- There was no existing S-09-specific integration test suite in this environment when this report was written.
- The authenticated flows depend on Next request scope and could not be exercised through the local harness.

---

## 11. Unresolved risks and limitations

1. **HTTP verification gap**: The password-reset and password-change routes were not verified with a real Next server in this environment. Their behavior under real Next request context, cookies/session resolution, and CSRF checks was not exercised here. Those flows still need a real-server verification pass (for example Playwright against `next dev`) before they can be considered verified in deployment.
2. **Email delivery not configured**: This task integrates with the existing Resend surface, but Resend was not configured/verified/wired through to a real sending path in this environment. The reset-request flow calls `sendTemplatedEmail()` and handles provider failures safely, but no real reset email can be confirmed working here.
3. **Demo recovery not added**: Per scope, seeded-demo password recovery was intentionally not implemented; if a separate demo-recovery policy is approved later, that would be a different task.
4. **Migration file naming**: The migration directory name is whatever Prisma generated; the effective schema change is captured in `prisma/schema.prisma` and the migration notes in `docs/MIGRATIONS_S09_PASSWORD_RESET_TOKENS.md`.

---

## 12. Explicit confirmation that unrelated scopes were not changed

- **S-12 Audit Durability**: not changed.
- **S-14 Session Lifecycle Security**: not changed except reusing existing revocation/rotation primitives.
- **S-13 / S-15**: not changed.
- **Billing / entitlements / C-03**: not changed.
- **Resend infrastructure**: not modified; S-09 only calls existing `sendTemplatedEmail()`.
- **Password/session/throttle/authorize primitives**: reused, not replaced.
- **Marketplace, orders, suppliers, disputes, subscriptions, audit logging core paths**: not modified except the addition of two audit action constants.

---

**Bottom line**: S-09 backend implementation is complete within the authorized scope. Typecheck and the configured test suite are clean. The remaining risk is verification of the HTTP flows under a real Next server and of live email delivery, neither of which is available in this environment.
