import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  recordPaymentClaim,
  decidePaymentClaim,
  confirmStock,
  setSupplierOrderStatus,
} from "./supplier";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error(
    "Refusing to run S-03/S-04 tests against prisma/dev.db. Point DATABASE_URL at a disposable database.",
  );
}

const prisma = new PrismaClient({ log: ["error"] });

let supplierProfileId = "";
let supplierOwnerId = "";
let resellerProfileId = "";
let adminProfileId = "";
let mediatorProfileId = "";

beforeAll(async () => {
  await prisma.$connect();
  const supplier = await prisma.supplierProfile.findFirstOrThrow();
  supplierProfileId = supplier.id;
  supplierOwnerId = supplier.profileId;
  const agreement = await prisma.resellerAgreement.findFirstOrThrow({
    include: { resellerProfile: true },
  });
  resellerProfileId = agreement.resellerProfile.id;
  const adminUser = await prisma.user.findFirstOrThrow({ where: { email: "admin@sellflow.test" } });
  const mediatorUser = await prisma.user.findFirstOrThrow({ where: { email: "mediator@sellflow.test" } });
  adminProfileId = (await prisma.profile.findFirstOrThrow({ where: { userId: adminUser.id } })).id;
  mediatorProfileId = (await prisma.profile.findFirstOrThrow({ where: { userId: mediatorUser.id } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function makeOrder(status: string, extra: any = {}) {
  return prisma.supplierOrder.create({
    data: {
      orderNumber: `S03-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      resellerProfileId,
      supplierProfileId,
      status,
      subtotalKobo: 1000,
      totalKobo: 1000,
      items: { create: [{ title: "x", qty: 1, unitPriceKobo: 1000, lineTotalKobo: 1000 }] },
      ...extra,
    },
  });
}

describe("S-03 payment claims", () => {
  it("D2 rejects recordPaymentClaim on terminal orders", async () => {
    for (const st of ["COMPLETED", "CANCELLED", "DISPUTED"]) {
      const o = await makeOrder(st);
      await expect(
        recordPaymentClaim(o.id, resellerProfileId, ["RESELLER"], { amountKobo: 500, method: "BANK_TRANSFER" } as any),
      ).rejects.toThrow(/cannot be recorded while the order is/);
    }
  });

  it("D1 blocks dual-role self-dealing on recordPaymentClaim", async () => {
    const o = await makeOrder("AWAITING_PAYMENT", { resellerProfileId: supplierOwnerId });
    await expect(
      recordPaymentClaim(o.id, supplierOwnerId, ["SUPPLIER", "RESELLER"], { amountKobo: 500, method: "BANK_TRANSFER" } as any),
    ).rejects.toThrow(/both parties/);
  });

  it("D1 blocks dual-role self-dealing on decidePaymentClaim", async () => {
    const o = await makeOrder("AWAITING_PAYMENT", { resellerProfileId: supplierOwnerId });
    const c = await prisma.paymentStatusClaim.create({
      data: { supplierOrderId: o.id, claimedByProfileId: resellerProfileId, claimedByRole: "RESELLER", status: "SENT", amountKobo: 500, method: "BANK_TRANSFER" },
    });
    await expect(
      decidePaymentClaim(o.id, c.id, supplierOwnerId, ["SUPPLIER", "RESELLER"], { action: "CONFIRM" }),
    ).rejects.toThrow(/both parties/);
  });

  it("D7 caps confirmed total at totalKobo", async () => {
    const o = await makeOrder("AWAITING_PAYMENT");
    const c = await prisma.paymentStatusClaim.create({
      data: { supplierOrderId: o.id, claimedByProfileId: resellerProfileId, claimedByRole: "RESELLER", status: "SENT", amountKobo: 1500, method: "BANK_TRANSFER" },
    });
    await expect(
      decidePaymentClaim(o.id, c.id, supplierOwnerId, ["SUPPLIER"], { action: "CONFIRM" }),
    ).rejects.toThrow(/exceeds the order total/);
  });

  it("D3 preserves DISPATCHED status on claim dispute", async () => {
    const o = await makeOrder("DISPATCHED", { paymentClaimStatus: "SENT" });
    const c = await prisma.paymentStatusClaim.create({
      data: { supplierOrderId: o.id, claimedByProfileId: resellerProfileId, claimedByRole: "RESELLER", status: "SENT", amountKobo: 1000, method: "BANK_TRANSFER" },
    });
    const res = await decidePaymentClaim(o.id, c.id, supplierOwnerId, ["SUPPLIER"], { action: "DISPUTE", note: "t" });
    expect(res.disputed).toBe(true);
    const after = await prisma.supplierOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe("DISPATCHED");
    expect(after.paymentClaimStatus).toBe("DISPUTED");
  });

  it("D4 confirms atomically with auditCritical", async () => {
    const o = await makeOrder("AWAITING_PAYMENT", { paymentClaimStatus: "SENT" });
    const c = await prisma.paymentStatusClaim.create({
      data: { supplierOrderId: o.id, claimedByProfileId: resellerProfileId, claimedByRole: "RESELLER", status: "SENT", amountKobo: 1000, method: "BANK_TRANSFER" },
    });
    const res: any = await decidePaymentClaim(o.id, c.id, supplierOwnerId, ["SUPPLIER"], { action: "CONFIRM" });
    expect(res.paymentClaimStatus).toBe("CONFIRMED");
    const claim = await prisma.paymentStatusClaim.findUniqueOrThrow({ where: { id: c.id } });
    expect(claim.status).toBe("CONFIRMED");
    const audit = await prisma.auditLog.findFirst({ where: { entityId: c.id, action: "supplier_order.payment_claim_confirmed" } });
    expect(audit).not.toBeNull();
    expect(claim.confirmedByProfileId).toBe(supplierOwnerId);
  });
});

describe("S-04 order lifecycle", () => {
  it("D6 restricts confirmStock to SUBMITTED only", async () => {
    const o = await makeOrder("AWAITING_PAYMENT");
    await expect(
      confirmStock(supplierProfileId, supplierOwnerId, o.id, { decision: "CONFIRMED", items: [{ itemId: "x", confirmedQty: 1 }] } as any),
    ).rejects.toThrow(/cannot be changed while the order is/);
  });

  it("D8 keeps DISPUTED terminal on generic PATCH", async () => {
    const o = await makeOrder("DISPUTED");
    await expect(
      setSupplierOrderStatus(supplierProfileId, supplierOwnerId, o.id, "CANCELLED", null, false),
    ).rejects.toThrow();
  });

  it("PAID -> CANCELLED without claims (supplier allowed)", async () => {
    const o = await makeOrder("PAID");
    const out = await setSupplierOrderStatus(supplierProfileId, supplierOwnerId, o.id, "CANCELLED", null, false);
    expect(out.status).toBe("CANCELLED");
  });

  it("PAID -> CANCELLED with claims requires admin/mediator", async () => {
    const o = await makeOrder("PAID", {
      paymentClaimStatus: "CLAIMED",
      claims: { create: [{ claimedByProfileId: resellerProfileId, claimedByRole: "RESELLER", status: "SENT", amountKobo: 1000, method: "BANK_TRANSFER" }] },
    });
    await expect(
      setSupplierOrderStatus(supplierProfileId, supplierOwnerId, o.id, "CANCELLED", null, false),
    ).rejects.toThrow(/Only a platform owner or mediator/);
    const held = await setSupplierOrderStatus(supplierProfileId, supplierOwnerId, o.id, "CANCELLED", null, true);
    expect(held.status).toBe("CANCELLED");
    expect(held.stockHeldAt).not.toBeNull();
  });

  it("D5 mediator cancellation path uses isAdmin flag", async () => {
    const o = await makeOrder("PAID", {
      paymentClaimStatus: "CLAIMED",
      claims: { create: [{ claimedByProfileId: resellerProfileId, claimedByRole: "RESELLER", status: "SENT", amountKobo: 1000, method: "BANK_TRANSFER" }] },
    });
    // Simulate mediator (isAdmin=true) even though actor is not supplier owner
    const held = await setSupplierOrderStatus(supplierProfileId, mediatorProfileId, o.id, "CANCELLED", null, true);
    expect(held.status).toBe("CANCELLED");
  });
});