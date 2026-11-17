-- A6 — align "PasswordResetToken" with the Prisma datamodel.
--
-- Why this exists: the S-09 DDL was appended to the already-applied
-- 20261105060000_session_lifecycle migration. Databases created from that file
-- therefore get an inline, unnamed table-level UNIQUE("hashedToken") constraint
-- (which SQLite materialises as an implicit sqlite_autoindex) and an inline foreign
-- key, while
-- prisma/dev.db already carries the datamodel-named unique index and a named
-- foreign key. Both shapes enforce the same rules at runtime, but migrations and
-- datamodel disagree, so `migrate diff` reports a table redefinition.
--
-- Forward-only by design: this migration rebuilds the table into the datamodel
-- shape from ANY starting state and copies every row.
--   1. table missing (a database migrated with the pre-2026-11-09 bytes)
--   2. table with the inline UNIQUE constraint (current fresh deployments)
--   3. table already in datamodel shape (prisma/dev.db)
--
-- SQLite cannot drop an inline table-level UNIQUE constraint, so a table rebuild
-- (create new, copy, drop old, rename) is the only supported route. No historical
-- migration or migration checksum is modified, and nothing here relies on
-- `prisma db push`.

PRAGMA defer_foreign_keys = ON;

-- State 1: make the table exist before anything reads from it.
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- States 2 and 3: rebuild into the canonical shape, preserving every row.
CREATE TABLE "new_PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "hashedToken" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "new_PasswordResetToken" ("id", "userId", "hashedToken", "used", "expiresAt", "createdAt")
SELECT "id", "userId", "hashedToken", "used", "expiresAt", "createdAt" FROM "PasswordResetToken";

DROP TABLE "PasswordResetToken";

ALTER TABLE "new_PasswordResetToken" RENAME TO "PasswordResetToken";

CREATE UNIQUE INDEX "PasswordResetToken_hashedToken_unique" ON "PasswordResetToken"("hashedToken");

CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");
