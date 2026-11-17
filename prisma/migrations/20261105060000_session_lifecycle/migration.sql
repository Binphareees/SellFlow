-- S-14: idle expiration for sessions.
--
-- Additive only. `DEFAULT CURRENT_TIMESTAMP` backfills every existing row with
-- the moment of the migration, so nobody is signed out by deploying this: the
-- idle clock starts at deploy rather than at each session's creation.
ALTER TABLE "Session" ADD COLUMN "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Supports idle-expiry sweeps and the per-user session inventory.
CREATE INDEX "Session_userId_lastUsedAt_idx" ON "Session"("userId", "lastUsedAt");

-- S-09: single-use, hashed password-reset tokens. The raw token exists only
-- briefly in memory; the database stores only the salted SHA-256 hash, plus a
-- used flag and expiry so reset requests are not reusable and can be swept.
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
