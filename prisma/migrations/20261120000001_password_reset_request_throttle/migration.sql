-- CreateTable
CREATE TABLE "PasswordResetThrottle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" DATETIME NOT NULL,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetThrottle_scope_key_key" ON "PasswordResetThrottle"("scope", "key");

-- CreateIndex
CREATE INDEX "PasswordResetThrottle_updatedAt_idx" ON "PasswordResetThrottle"("updatedAt");

-- CreateIndex
CREATE INDEX "PasswordResetThrottle_lockedUntil_idx" ON "PasswordResetThrottle"("lockedUntil");
