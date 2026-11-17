-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Dispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "supplierOrderId" TEXT,
    "claimId" TEXT,
    "raisedByProfileId" TEXT NOT NULL,
    "raisedByRole" TEXT NOT NULL,
    "againstProfileId" TEXT,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "assignedMediatorProfileId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dispute_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Dispute_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "PaymentStatusClaim" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Dispute" ("againstProfileId", "assignedMediatorProfileId", "createdAt", "description", "evidenceJson", "id", "outcome", "raisedByProfileId", "raisedByRole", "reason", "reference", "resolutionNote", "resolvedAt", "status", "supplierOrderId", "updatedAt") SELECT "againstProfileId", "assignedMediatorProfileId", "createdAt", "description", "evidenceJson", "id", "outcome", "raisedByProfileId", "raisedByRole", "reason", "reference", "resolutionNote", "resolvedAt", "status", "supplierOrderId", "updatedAt" FROM "Dispute";
DROP TABLE "Dispute";
ALTER TABLE "new_Dispute" RENAME TO "Dispute";
CREATE UNIQUE INDEX "Dispute_reference_key" ON "Dispute"("reference");
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");
CREATE INDEX "Dispute_supplierOrderId_idx" ON "Dispute"("supplierOrderId");
CREATE INDEX "Dispute_claimId_idx" ON "Dispute"("claimId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
