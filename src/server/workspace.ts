import { prisma } from "@/lib/db";
import { audit, AUDIT } from "@/lib/audit";
import { badRequest, conflict, notFound } from "@/lib/api";
import { balanceOf, paymentState } from "@/lib/money";
import { assertCapacity, assertFeature } from "@/lib/subscription";
import { FEATURE } from "@/lib/plans";
import type { z } from "zod";
import type {
  customerCreateSchema,
  orderCreateSchema,
  paymentCreateSchema,
  productCreateSchema,
  promiseCreateSchema,
} from "@/lib/validation";

/**
 * Business workspace services. Every function takes the resolved workspaceId from
 * the session (never from the request body) so one account can never read or write
 * another account's bookkeeping.
 */

const paymentSelect = { id: true, amountKobo: true, method: true, paidAt: true, reference: true, note: true, voidedAt: true } as const;

export type OrderWithMoney = {
  id: string;
  orderNumber: string;
  status: string;
  currency: string;
  totalKobo: number;
  costKobo: number;
  channel: string;
  createdAt: Date;
  customer: { id: string; name: string; phone: string | null };
  payments: { amountKobo: number; voidedAt: Date | null }[];
};

export function paidKoboOf(payments: { amountKobo: number; voidedAt: Date | null }[]): number {
  return payments.reduce((sum, p) => (p.voidedAt ? sum : sum + p.amountKobo), 0);
}

const STOCK_RETRY_ATTEMPTS = 3;

function isTransientStockError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : "";
  return (
    code === "P2034" ||
    code === "SQLITE_BUSY" ||
    /database is locked|SQLITE_BUSY/i.test(message)
  );
}

/**
 * SQLite serialises writers, so concurrent stock operations can lose the write
 * lock. The failed attempt rolled back, so retrying the transaction is safe.
 * Business conflicts are rethrown immediately.
 */
async function withStockTransaction<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < STOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientStockError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function summariseOrder<T extends OrderWithMoney>(order: T) {
  const paid = paidKoboOf(order.payments);
  return {
    ...order,
    paidKobo: paid,
    balanceKobo: balanceOf(order.totalKobo, paid),
    paymentState: paymentState(order.totalKobo, paid),
    profitKobo: order.totalKobo - order.costKobo,
  };
}

// ── Customers ───────────────────────────────────────────────────────────────

export async function listCustomers(workspaceId: string, query?: string) {
  const customers = await prisma.customer.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(query ? { OR: [{ name: { contains: query } }, { phone: { contains: query } }] } : {}),
    },
    include: {
      orders: {
        where: { deletedAt: null, status: { not: "CANCELLED" } },
        select: { totalKobo: true, payments: { select: { amountKobo: true, voidedAt: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return customers.map((c) => {
    const owed = c.orders.reduce(
      (sum, o) => sum + balanceOf(o.totalKobo, paidKoboOf(o.payments)),
      0,
    );
    return { ...c, orders: undefined, orderCount: c.orders.length, owedKobo: owed };
  });
}

export async function createCustomer(
  workspaceId: string,
  profileId: string,
  input: z.infer<typeof customerCreateSchema>,
) {
  // Free plans cap the address book; paid plans are unlimited.
  await assertCapacity(workspaceId, "customers");

  const customer = await prisma.customer.create({
    data: { workspaceId, name: input.name, phone: input.phone ?? null, notes: input.notes ?? null },
  });
  await audit({
    actorProfileId: profileId,
    action: "customer.created",
    entityType: "Customer",
    entityId: customer.id,
    metadata: { workspaceId },
  });
  return customer;
}

export async function updateCustomer(
  workspaceId: string,
  customerId: string,
  input: Partial<z.infer<typeof customerCreateSchema>>,
) {
  const existing = await prisma.customer.findFirst({ where: { id: customerId, workspaceId, deletedAt: null } });
  if (!existing) throw notFound("Customer not found");
  return prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone ?? null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
    },
  });
}

export async function softDeleteCustomer(workspaceId: string, customerId: string) {
  const existing = await prisma.customer.findFirst({ where: { id: customerId, workspaceId, deletedAt: null } });
  if (!existing) throw notFound("Customer not found");
  return prisma.customer.update({ where: { id: customerId }, data: { deletedAt: new Date() } });
}

// ── Products ────────────────────────────────────────────────────────────────

export async function listProducts(workspaceId: string) {
  return prisma.product.findMany({
    where: { workspaceId, isActive: true },
    orderBy: { name: "asc" },
    take: 200,
  });
}

export async function createProduct(
  workspaceId: string,
  input: z.infer<typeof productCreateSchema>,
) {
  await assertCapacity(workspaceId, "products");

  return prisma.product.create({
    data: {
      workspaceId,
      name: input.name,
      sku: input.sku ?? null,
      description: input.description ?? null,
      unit: input.unit,
      costPriceKobo: input.costPriceKobo,
      sellingPriceKobo: input.sellingPriceKobo,
      stockQty: input.stockQty,
      lowStockAt: input.lowStockAt,
    },
  });
}

export async function updateProduct(
  workspaceId: string,
  productId: string,
  input: Partial<z.infer<typeof productCreateSchema>>,
) {
  const existing = await prisma.product.findFirst({ where: { id: productId, workspaceId } });
  if (!existing) throw notFound("Product not found");
  return prisma.product.update({
    where: { id: productId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.costPriceKobo !== undefined ? { costPriceKobo: input.costPriceKobo } : {}),
      ...(input.sellingPriceKobo !== undefined ? { sellingPriceKobo: input.sellingPriceKobo } : {}),
      ...(input.stockQty !== undefined ? { stockQty: input.stockQty } : {}),
      ...(input.lowStockAt !== undefined ? { lowStockAt: input.lowStockAt } : {}),
    },
  });
}

// ── Orders ──────────────────────────────────────────────────────────────────

export type OrderFilters = {
  status?: string;
  payment?: "UNPAID" | "PART_PAID" | "PAID";
  limit?: number;
};

export async function listOrders(workspaceId: string, filters: OrderFilters = {}) {
  const orders = await prisma.customerOrder.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      payments: { select: { amountKobo: true, voidedAt: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(filters.limit ?? 50, 200),
  });

  const summarised = orders.map((o) => ({ ...summariseOrder(o), itemCount: o._count.items }));
  return filters.payment ? summarised.filter((o) => o.paymentState === filters.payment) : summarised;
}

export async function getOrder(workspaceId: string, orderId: string) {
  const order = await prisma.customerOrder.findFirst({
    where: { id: orderId, workspaceId, deletedAt: null },
    include: {
      customer: true,
      items: { orderBy: { id: "asc" } },
      payments: { orderBy: { paidAt: "desc" } },
      promises: { orderBy: { promisedFor: "asc" } },
      paymentPlan: true,
      supplierOrder: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          stockStatus: true,
          paymentClaimStatus: true,
          totalKobo: true,
          supplierProfile: { select: { businessName: true, id: true } },
        },
      },
    },
  });
  if (!order) throw notFound("Order not found");
  return { ...summariseOrder(order), promisesOpen: order.promises.filter((p) => p.status === "OPEN") };
}

async function nextOrderNumber(workspaceId: string, attempt: number): Promise<string> {
  const count = await prisma.customerOrder.count({ where: { workspaceId } });
  const now = new Date();
  const stamp = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const seq = String(count + 1 + attempt).padStart(4, "0");
  return `SF-${stamp}-${seq}`;
}

export async function createOrder(
  workspaceId: string,
  profileId: string,
  input: z.infer<typeof orderCreateSchema>,
) {
  await assertCapacity(workspaceId, "activeOrders");
  if (input.paymentPlan) await assertFeature(workspaceId, FEATURE.PAYMENT_PLANS);

  const customer = await prisma.customer.findFirst({
    where: { id: input.customerId, workspaceId, deletedAt: null },
  });
  if (!customer) throw notFound("Customer not found in this workspace");

  // Money and cost are recomputed from server-side product records where possible;
  // client-supplied cost is only trusted for ad-hoc items with no product link.
  const productIds = input.items.map((i) => i.productId).filter((v): v is string => Boolean(v));
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds }, workspaceId } })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  for (const item of input.items) {
    if (item.productId && !productById.has(item.productId)) {
      throw badRequest("One of the items does not belong to this workspace");
    }
  }

  const lines = input.items.map((item) => {
    const product = item.productId ? productById.get(item.productId) : undefined;
    const unitPriceKobo = product ? product.sellingPriceKobo : item.unitPriceKobo;
    const unitCostKobo = product ? product.costPriceKobo : item.unitCostKobo;
    return {
      productId: item.productId ?? null,
      name: product ? product.name : item.name,
      qty: item.qty,
      unitPriceKobo,
      unitCostKobo,
      lineTotalKobo: unitPriceKobo * item.qty,
      lineCostKobo: unitCostKobo * item.qty,
      // Catalogue lines reserve their full quantity; ad-hoc lines have no stock.
      stockDeductedQty: item.productId ? item.qty : 0,
    };
  });

  // One pool per product, even when the same product appears on several lines.
  const requiredByProduct = new Map<string, number>();
  for (const line of lines) {
    if (!line.productId) continue;
    requiredByProduct.set(
      line.productId,
      (requiredByProduct.get(line.productId) ?? 0) + line.qty,
    );
  }

  const totalKobo = lines.reduce((s, l) => s + l.lineTotalKobo, 0);
  const costKobo = lines.reduce((s, l) => s + l.lineCostKobo, 0);

  if (input.depositKobo && input.depositKobo > totalKobo) {
    throw badRequest("Deposit cannot be more than the order total");
  }

  let created: { id: string } | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
    const orderNumber = await nextOrderNumber(workspaceId, attempt);
    try {
      created = await withStockTransaction(() =>
        prisma.$transaction(async (tx) => {
          // Reserve stock before writing the order. The conditional update is
          // the concurrency guard: if another order already took the units,
          // this transaction fails and no order row is written.
          for (const [productId, required] of requiredByProduct) {
            const reserved = await tx.product.updateMany({
              where: { id: productId, workspaceId, stockQty: { gte: required } },
              data: { stockQty: { decrement: required } },
            });
            if (reserved.count !== 1) {
              const product = productById.get(productId);
              throw conflict(`Not enough stock for ${product?.name ?? "a product"}`);
            }
          }

          const order = await tx.customerOrder.create({
            data: {
              workspaceId,
              customerId: customer.id,
              orderNumber,
              channel: input.channel,
              notes: input.notes ?? null,
              totalKobo,
              costKobo,
              items: { create: lines },
            },
            select: { id: true },
          });

          if (input.depositKobo && input.depositKobo > 0) {
            await tx.manualPayment.create({
              data: {
                orderId: order.id,
                workspaceId,
                amountKobo: input.depositKobo,
                method: input.depositMethod ?? "BANK_TRANSFER",
                paidAt: new Date(),
                note: "Deposit recorded with order",
                recordedByProfileId: profileId,
              },
            });
          }

          if (input.paymentPlan) {
            await tx.paymentPlan.create({
              data: {
                orderId: order.id,
                workspaceId,
                depositKobo: input.paymentPlan.depositKobo,
                installmentCount: input.paymentPlan.installmentCount,
                frequency: input.paymentPlan.frequency,
                startDate: input.paymentPlan.startDate,
                note: input.paymentPlan.note ?? null,
              },
            });
          }

          if (input.promise) {
            await tx.paymentPromise.create({
              data: {
                workspaceId,
                orderId: order.id,
                customerId: customer.id,
                amountKobo: input.promise.amountKobo,
                promisedFor: input.promise.promisedFor,
                note: input.promise.note ?? null,
              },
            });
          }

          return order;
        }),
      );
    } catch (error) {
      lastError = error;
      // P2002 = unique constraint on orderNumber; retry with the next sequence.
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }

  if (!created) {
    console.error("[orders] could not allocate an order number", lastError);
    throw conflict("Could not allocate an order number, please try again");
  }

  await audit({
    actorProfileId: profileId,
    action: AUDIT.ORDER_CREATED,
    entityType: "CustomerOrder",
    entityId: created.id,
    metadata: { totalKobo, itemCount: lines.length, workspaceId },
  });

  return prisma.customerOrder.findUniqueOrThrow({
    where: { id: created.id },
    include: { items: true, payments: true, promises: true, paymentPlan: true },
  });
}

export async function updateOrderStatus(
  workspaceId: string,
  orderId: string,
  profileId: string,
  status: string,
) {
  const result = await withStockTransaction(() =>
    prisma.$transaction(async (tx) => {
      const order = await tx.customerOrder.findFirst({
        where: { id: orderId, workspaceId, deletedAt: null },
        include: { items: true },
      });
      if (!order) throw notFound("Order not found");
      if (order.status === "DELIVERED" && status !== "CANCELLED") {
        throw conflict("A delivered order can only be cancelled");
      }

      // Cancellation is idempotent: a second request finds the order already
      // cancelled and returns it without touching stock again.
      if (status === "CANCELLED" && order.status === "CANCELLED") {
        return { order, from: order.status };
      }

      const now = new Date();
      if (status === "CANCELLED") {
        // Claim the cancellation first. If two requests race, only one moves
        // the order out of its predecessor state and therefore restores stock.
        const claimed = await tx.customerOrder.updateMany({
          where: { id: orderId, workspaceId, status: order.status, deletedAt: null },
          data: { status: "CANCELLED", cancelledAt: now, stockRestoredAt: now },
        });
        if (claimed.count !== 1) {
          throw conflict("The order changed while it was being cancelled");
        }

        // Restore only the quantity this order actually reserved, then clear
        // the marker so the reservation can never be released twice.
        for (const item of order.items) {
          if (item.stockDeductedQty === 0) continue;
          if (item.productId) {
            const restored = await tx.product.updateMany({
              where: { id: item.productId, workspaceId },
              data: { stockQty: { increment: item.stockDeductedQty } },
            });
            if (restored.count !== 1) {
              throw conflict("The product for this order no longer exists");
            }
          }
          await tx.orderItem.update({
            where: { id: item.id },
            data: { stockDeductedQty: 0 },
          });
        }
      } else {
        const updated = await tx.customerOrder.update({
          where: { id: orderId },
          data: { status },
        });
        return { order: updated, from: order.status };
      }

      const updated = await tx.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
      return { order: updated, from: order.status };
    }),
  );

  await audit({
    actorProfileId: profileId,
    action: AUDIT.ORDER_STATUS,
    entityType: "CustomerOrder",
    entityId: orderId,
    metadata: { from: result.from, to: status },
  });
  return result.order;
}

export async function addPayment(
  workspaceId: string,
  orderId: string,
  profileId: string,
  input: z.infer<typeof paymentCreateSchema>,
) {
  const order = await prisma.customerOrder.findFirst({
    where: { id: orderId, workspaceId, deletedAt: null },
    include: { payments: { select: { amountKobo: true, voidedAt: true } } },
  });
  if (!order) throw notFound("Order not found");
  if (order.status === "CANCELLED") throw conflict("Cannot record payment on a cancelled order");

  const paid = paidKoboOf(order.payments);
  const remaining = balanceOf(order.totalKobo, paid);
  if (input.amountKobo <= 0) throw badRequest("Amount must be greater than zero");
  if (input.amountKobo > remaining) {
    throw conflict(`That is more than the remaining balance of ${remaining} kobo`);
  }

  const payment = await prisma.$transaction(async (tx) => {
    const record = await tx.manualPayment.create({
      data: {
        orderId,
        workspaceId,
        amountKobo: input.amountKobo,
        method: input.method,
        paidAt: input.paidAt,
        reference: input.reference ?? null,
        note: input.note ?? null,
        recordedByProfileId: profileId,
      },
    });

    const newPaid = paid + input.amountKobo;
    if (newPaid >= order.totalKobo) {
      // Balance cleared: any open promise on this order has been kept.
      await tx.paymentPromise.updateMany({
        where: { orderId, status: "OPEN" },
        data: { status: "KEPT", resolvedAt: new Date() },
      });
    }
    return record;
  });

  await audit({
    actorProfileId: profileId,
    action: AUDIT.PAYMENT_RECORDED,
    entityType: "ManualPayment",
    entityId: payment.id,
    metadata: { orderId, amountKobo: input.amountKobo, method: input.method },
  });

  return payment;
}

export async function voidPayment(
  workspaceId: string,
  paymentId: string,
  profileId: string,
  reason: string,
) {
  const payment = await prisma.manualPayment.findFirst({ where: { id: paymentId, workspaceId } });
  if (!payment) throw notFound("Payment not found");
  if (payment.voidedAt) throw conflict("This payment was already voided");
  const updated = await prisma.manualPayment.update({
    where: { id: paymentId },
    data: { voidedAt: new Date(), voidReason: reason || "Voided by owner" },
  });
  await audit({
    actorProfileId: profileId,
    action: AUDIT.PAYMENT_VOIDED,
    entityType: "ManualPayment",
    entityId: paymentId,
    metadata: { orderId: payment.orderId, amountKobo: payment.amountKobo, reason },
  });
  return updated;
}

// ── Promises ────────────────────────────────────────────────────────────────

export async function addPromise(
  workspaceId: string,
  orderId: string,
  profileId: string,
  input: z.infer<typeof promiseCreateSchema>,
) {
  const order = await prisma.customerOrder.findFirst({
    where: { id: orderId, workspaceId, deletedAt: null },
    include: { customer: true },
  });
  if (!order) throw notFound("Order not found");
  const promise = await prisma.paymentPromise.create({
    data: {
      workspaceId,
      orderId,
      customerId: order.customerId,
      amountKobo: input.amountKobo,
      promisedFor: input.promisedFor,
      note: input.note ?? null,
    },
  });
  await audit({
    actorProfileId: profileId,
    action: AUDIT.PROMISE_CREATED,
    entityType: "PaymentPromise",
    entityId: promise.id,
    metadata: { orderId, amountKobo: input.amountKobo },
  });
  return promise;
}

export async function resolvePromise(
  workspaceId: string,
  promiseId: string,
  profileId: string,
  status: "KEPT" | "BROKEN" | "CANCELLED",
) {
  const promise = await prisma.paymentPromise.findFirst({ where: { id: promiseId, workspaceId } });
  if (!promise) throw notFound("Promise not found");
  const updated = await prisma.paymentPromise.update({
    where: { id: promiseId },
    data: { status, resolvedAt: new Date() },
  });
  await audit({
    actorProfileId: profileId,
    action: AUDIT.PROMISE_RESOLVED,
    entityType: "PaymentPromise",
    entityId: promiseId,
    metadata: { status },
  });
  return updated;
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export async function getDashboard(workspaceId: string) {
  const [orders, openPromises, productCount, customerCount] = await Promise.all([
    prisma.customerOrder.findMany({
      where: { workspaceId, deletedAt: null, status: { not: "CANCELLED" } },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        payments: { select: { amountKobo: true, voidedAt: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.paymentPromise.findMany({
      where: { workspaceId, status: "OPEN" },
      include: {
        customer: { select: { name: true } },
        order: { select: { orderNumber: true, id: true } },
      },
      orderBy: { promisedFor: "asc" },
      take: 8,
    }),
    prisma.product.count({ where: { workspaceId, isActive: true } }),
    prisma.customer.count({ where: { workspaceId, deletedAt: null } }),
  ]);

  const summarised = orders.map(summariseOrder);
  const outstandingKobo = summarised.reduce((s, o) => s + o.balanceKobo, 0);
  const revenueKobo = summarised.reduce((s, o) => s + o.totalKobo, 0);
  const collectedKobo = summarised.reduce((s, o) => s + o.paidKobo, 0);
  const profitKobo = summarised.reduce((s, o) => s + o.profitKobo, 0);

  const debtors = new Map<string, { name: string; phone: string | null; owedKobo: number; orderId: string }>();
  for (const order of summarised) {
    if (order.balanceKobo <= 0) continue;
    const key = order.customer.id;
    const existing = debtors.get(key);
    if (existing) existing.owedKobo += order.balanceKobo;
    else
      debtors.set(key, {
        name: order.customer.name,
        phone: order.customer.phone,
        owedKobo: order.balanceKobo,
        orderId: order.id,
      });
  }

  const dueNow = openPromises.filter((p) => p.promisedFor.getTime() <= Date.now());

  return {
    totals: {
      outstandingKobo,
      revenueKobo,
      collectedKobo,
      profitKobo,
      orderCount: summarised.length,
      debtorCount: debtors.size,
      productCount,
      customerCount,
      promiseCount: openPromises.length,
      overduePromiseCount: dueNow.length,
    },
    recentOrders: summarised.slice(0, 6),
    topDebtors: [...debtors.values()].sort((a, b) => b.owedKobo - a.owedKobo).slice(0, 6),
    promises: openPromises,
  };
}
