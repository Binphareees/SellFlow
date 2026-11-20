-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN "stockHeldAt" DATETIME;

-- AlterTable
ALTER TABLE "SupplierOrder" ADD COLUMN "stockHeldAt" DATETIME;

-- CreateTable
CREATE TABLE "PaymentReversal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "reversedPaymentId" TEXT,
    "recordedByProfileId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentReversal_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentReversal_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "BusinessWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentReversal_reversedPaymentId_fkey" FOREIGN KEY ("reversedPaymentId") REFERENCES "ManualPayment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockHold" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "qty" INTEGER NOT NULL,
    "heldAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    "releasedByProfileId" TEXT,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockHold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StockHold_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_idempotencyKey_key" ON "PaymentReversal"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PaymentReversal_orderId_idx" ON "PaymentReversal"("orderId");

-- CreateIndex
CREATE INDEX "PaymentReversal_workspaceId_createdAt_idx" ON "PaymentReversal"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "StockHold_orderId_idx" ON "StockHold"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StockHold_orderId_productId_key" ON "StockHold"("orderId", "productId");

