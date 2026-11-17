-- S-11: track stock reservations so a deduction can be restored exactly once.
--
-- Existing rows default to 0. That is deliberate: the pre-fix application never
-- deducted supplier listing stock, and its workspace reservation was capped and
-- not recorded per line. Back-filling would invent reservations that never
-- existed, so historical orders are left untouched (documented limitation).

-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN "stockRestoredAt" DATETIME;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN "stockDeductedQty" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SupplierOrder" ADD COLUMN "stockRestoredAt" DATETIME;

-- AlterTable
ALTER TABLE "SupplierOrderItem" ADD COLUMN "stockDeductedQty" INTEGER NOT NULL DEFAULT 0;
