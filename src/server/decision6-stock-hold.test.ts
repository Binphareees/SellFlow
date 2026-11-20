import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { updateOrderStatus, releaseHeldStock } from "./workspace";
import { releaseHeldSupplierStock } from "./supplier";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error("Refusing to run Decision 6 tests against prisma/dev.db.");
}

const prisma = new PrismaClient({ log: ["error"] });

let workspaceId = "";
let orderId = "";
let profileId = "";
let adminProfileId = "";

beforeAll(async () => {
  await prisma.$connect();
  const order = await prisma.customerOrder.findFirstOrThrow({ where: { orderNumber: "SF-2610-0001" } });
  orderId = order.id;
  workspaceId = order.workspaceId;
  const workspace = await prisma.businessWorkspace.findUniqueOrThrow({ where: { id: workspaceId } });
  profileId = workspace.ownerProfileId;
  const adminUser = await prisma.user.findFirstOrThrow({ where: { email: "admin@sellflow.test" } });
  adminProfileId = (await prisma.profile.findFirstOrThrow({ where: { userId: adminUser.id } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Owner Decision 6 — partial payment cancellation", () => {
  it("non-admin cannot cancel a partially paid order", async () => {
    await expect(
      updateOrderStatus(workspaceId, orderId, profileId, "CANCELLED", false),
    ).rejects.toThrow(/Only a platform owner or mediator/);
  });

  it("admin cancels partially paid order: stockHeldAt set and PaymentReversal created", async () => {
    const res: any = await updateOrderStatus(workspaceId, orderId, adminProfileId, "CANCELLED", true);
    const order = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("CANCELLED");
    expect(order.stockHeldAt).not.toBeNull();
    const reversal = await prisma.paymentReversal.findUnique({ where: { idempotencyKey: `customer-order:${orderId}:cancel` } });
    expect(reversal).not.toBeNull();
    expect(reversal!.amountKobo).toBeGreaterThan(0);
  });

  it("cancellation is idempotent", async () => {
    const res: any = await updateOrderStatus(workspaceId, orderId, adminProfileId, "CANCELLED", true);
    expect(res.status).toBe("CANCELLED");
  });

  it("releaseHeldStock: gate requires admin", async () => {
    await expect(releaseHeldStock(orderId, profileId, false)).rejects.toThrow(/Only a platform owner or mediator/);
  });

  it("releaseHeldStock: admin releases and clears stockHeldAt", async () => {
    const out = await releaseHeldStock(orderId, adminProfileId, true);
    expect(out.stockHeldAt).toBeNull();
    const again = await releaseHeldStock(orderId, adminProfileId, true);
    expect(again.stockHeldAt).toBeNull();
  });
});

describe("releaseHeldSupplierStock", () => {
  it("requires admin", async () => {
    const so = await prisma.supplierOrder.findFirstOrThrow();
    await expect(releaseHeldSupplierStock(so.id, profileId, false)).rejects.toThrow(/Only a platform owner or mediator/);
  });

  it("is idempotent when no stock held", async () => {
    const so = await prisma.supplierOrder.findFirstOrThrow();
    const out = await releaseHeldSupplierStock(so.id, adminProfileId, true);
    expect(out).toBeTruthy();
  });
});