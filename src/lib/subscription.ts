import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, AUDIT } from "@/lib/audit";
import {
  FEATURE_LABEL,
  PLANS,
  TIER,
  isPaidTier,
  limitFor,
  planFor,
  planUnlocks,
  priceKoboFor,
  subscriptionBillingEnabled,
  type Feature,
  type Tier,
  type TierLimits,
} from "@/lib/plans";

/**
 * Server-side subscription truth. Every cap and feature check runs here, never in
 * the browser: hiding an "Add customer" button proves nothing.
 */

export type Usage = {
  customers: number;
  activeOrders: number;
  products: number;
  suppliers: number;
};

export type Entitlements = {
  workspaceId: string;
  tier: Tier;
  status: string;
  plan: (typeof PLANS)[Tier];
  limits: TierLimits;
  usage: Usage;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/** Deliberately loud so it shows up in the API response and the client can react. */
export function upgradeRequired(resource: keyof TierLimits, tier: Tier, used: number, limit: number, upgradeTo: Tier) {
  return new ApiError(
    403,
    "SUBSCRIPTION_LIMIT_REACHED",
    `The ${PLANS[tier].name} plan allows ${limit} ${resource === "activeOrders" ? "open orders" : resource}. Upgrade to keep going.`,
    {
      resource,
      tier,
      used,
      limit,
      upgradeTo,
      upgradeUrl: "/settings/billing",
    },
  );
}

export function featureLocked(feature: Feature, tier: Tier, upgradeTo: Tier) {
  return new ApiError(
    403,
    "SUBSCRIPTION_FEATURE_LOCKED",
    `${FEATURE_LABEL[feature]} is part of ${PLANS[upgradeTo].name}. Upgrade to use it.`,
    { feature, tier, upgradeTo, upgradeUrl: "/settings/billing" },
  );
}

export async function ensureSubscription(workspaceId: string) {
  return prisma.subscription.upsert({
    where: { workspaceId },
    create: { workspaceId, tier: TIER.FREE, status: "ACTIVE" },
    update: {},
  });
}

/**
 * A paid period that has elapsed drops back to Free without deleting the record,
 * so the history of what was paid for stays visible.
 */
async function expireIfNeeded(subscription: {
  id: string;
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}) {
  const paid = isPaidTier(subscription.tier);
  const ended = subscription.currentPeriodEnd ? subscription.currentPeriodEnd.getTime() <= Date.now() : false;
  if (!paid || !ended || subscription.status === "CANCELED") return subscription;

  return prisma.subscription.update({
    where: { id: subscription.id },
    data: { tier: TIER.FREE, status: "CANCELED", cancelAtPeriodEnd: false },
  });
}

export async function countUsage(workspaceId: string): Promise<Usage> {
  const [customers, activeOrders, products, supplierRows] = await Promise.all([
    prisma.customer.count({ where: { workspaceId, deletedAt: null } }),
    prisma.customerOrder.count({
      where: { workspaceId, deletedAt: null, status: { notIn: ["DELIVERED", "CANCELLED"] } },
    }),
    prisma.product.count({ where: { workspaceId, isActive: true } }),
    prisma.resellerApplication.findMany({
      where: { status: "APPROVED", resellerProfile: { ownedWorkspace: { id: workspaceId } } },
      select: { supplierProfileId: true },
      distinct: ["supplierProfileId"],
    }),
  ]);

  return { customers, activeOrders, products, suppliers: supplierRows.length };
}

export async function getEntitlements(workspaceId: string): Promise<Entitlements> {
  const stored = await ensureSubscription(workspaceId);
  const subscription = await expireIfNeeded(stored);
  const tier = (isPaidTier(subscription.tier) ? subscription.tier : TIER.FREE) as Tier;
  const usage = await countUsage(workspaceId);

  return {
    workspaceId,
    tier,
    status: subscription.status,
    plan: planFor(tier),
    limits: planFor(tier).limits,
    usage,
    periodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}

/** Free plans are capped; paid plans return Infinity and never hit this. */
export async function assertCapacity(workspaceId: string, resource: keyof TierLimits, adding = 1) {
  const entitlements = await getEntitlements(workspaceId);
  if (!subscriptionBillingEnabled()) return entitlements;
  const limit = limitFor(entitlements.tier, resource);
  if (!Number.isFinite(limit)) return entitlements;

  if (entitlements.usage[resource] + adding > limit) {
    throw upgradeRequired(resource, entitlements.tier, entitlements.usage[resource], limit, TIER.PRO);
  }
  return entitlements;
}

export async function assertFeature(workspaceId: string, feature: Feature) {
  const entitlements = await getEntitlements(workspaceId);
  if (!subscriptionBillingEnabled()) return entitlements;
  if (planUnlocks(entitlements.tier, feature)) return entitlements;

  const needsSupplierPro =
    feature === "agreement_versioning" || feature === "negotiation";
  throw featureLocked(feature, entitlements.tier, needsSupplierPro ? TIER.SUPPLIER_PRO : TIER.PRO);
}

/** Multi-supplier is a countable cap, not a boolean: Free gets exactly one. */
export async function assertSupplierCapacity(workspaceId: string, nextSupplierProfileId: string) {
  const entitlements = await getEntitlements(workspaceId);
  if (!subscriptionBillingEnabled()) return entitlements;
  const limit = entitlements.limits.suppliers;
  if (!Number.isFinite(limit)) return entitlements;

  const alreadyWithThisSupplier = await prisma.resellerApplication.findFirst({
    where: {
      supplierProfileId: nextSupplierProfileId,
      status: "APPROVED",
      resellerProfile: { ownedWorkspace: { id: workspaceId } },
    },
    select: { id: true },
  });
  if (alreadyWithThisSupplier) return entitlements;

  if (entitlements.usage.suppliers >= limit) {
    throw upgradeRequired("suppliers", entitlements.tier, entitlements.usage.suppliers, limit, TIER.PRO);
  }
  return entitlements;
}

export async function workspaceIdForProfile(profileId: string): Promise<string | null> {
  const workspace = await prisma.businessWorkspace.findUnique({
    where: { ownerProfileId: profileId },
    select: { id: true },
  });
  return workspace?.id ?? null;
}

/**
 * Subscription state is created lazily, so an account that never opens billing
 * still has a Free row to read and (later) to upgrade.
 */
export async function ensureWorkspaceSubscription(workspaceId: string) {
  return ensureSubscription(workspaceId);
}

export async function changeTier(
  workspaceId: string,
  tier: Tier,
  options: { status?: string; periodDays?: number; note?: string; actorProfileId?: string } = {},
) {
  const days = options.periodDays ?? (PLANS[tier].billingDays ?? 0);
  const now = new Date();
  const periodEnd = days > 0 ? new Date(now.getTime() + days * 24 * 60 * 60 * 1000) : null;

  const subscription = await prisma.subscription.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      tier,
      status: options.status ?? "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      activatedAt: tier === TIER.FREE ? null : now,
    },
    update: {
      tier,
      status: options.status ?? "ACTIVE",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      ...(tier === TIER.FREE ? {} : { activatedAt: now }),
      ...(options.note ? { note: options.note } : {}),
    },
  });

  await audit({
    actorProfileId: options.actorProfileId ?? null,
    action: AUDIT.SUBSCRIPTION_CHANGED,
    entityType: "Subscription",
    entityId: subscription.id,
    metadata: { workspaceId, tier, status: subscription.status, periodEnd },
  });

  return subscription;
}

export async function submitUpgrade(input: {
  workspaceId: string;
  profileId: string;
  tier: Tier;
  method: string;
  reference?: string;
  proofNote?: string;
}) {
  if (!isPaidTier(input.tier)) throw new ApiError(400, "BAD_REQUEST", "Choose Pro or Supplier Pro");

  const subscription = await ensureSubscription(input.workspaceId);

  const pending = await prisma.subscriptionPayment.findFirst({
    where: { workspaceId: input.workspaceId, status: "SUBMITTED" },
    select: { id: true },
  });
  if (pending) {
    throw new ApiError(
      409,
      "SUBSCRIPTION_PAYMENT_PENDING",
      "A transfer is already waiting for confirmation. We will activate your plan as soon as it is checked.",
      { paymentId: pending.id },
    );
  }

  const payment = await prisma.subscriptionPayment.create({
    data: {
      workspaceId: input.workspaceId,
      subscriptionId: subscription.id,
      tier: input.tier,
      amountKobo: priceKoboFor(input.tier),
      method: input.method,
      reference: input.reference ?? null,
      proofNote: input.proofNote ?? null,
      status: "SUBMITTED",
      submittedByProfileId: input.profileId,
    },
  });

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: "PENDING_PAYMENT" },
  });

  await audit({
    actorProfileId: input.profileId,
    action: AUDIT.SUBSCRIPTION_PAYMENT_SUBMITTED,
    entityType: "SubscriptionPayment",
    entityId: payment.id,
    metadata: { workspaceId: input.workspaceId, tier: input.tier, amountKobo: payment.amountKobo },
  });

  return payment;
}

export async function decideSubscriptionPayment(
  paymentId: string,
  actorProfileId: string,
  input: { action: "CONFIRM" | "REJECT"; note?: string },
) {
  const payment = await prisma.subscriptionPayment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new ApiError(404, "NOT_FOUND", "Upgrade request not found");
  if (payment.status !== "SUBMITTED") throw new ApiError(409, "CONFLICT", "This request was already decided");

  const now = new Date();

  if (input.action === "REJECT") {
    const updated = await prisma.subscriptionPayment.update({
      where: { id: paymentId },
      data: {
        status: "REJECTED",
        decidedByProfileId: actorProfileId,
        decidedAt: now,
        decisionNote: input.note ?? null,
      },
    });

    // Put the account back to what it was; the tier never changed on submit.
    const subscription = await prisma.subscription.findUnique({ where: { workspaceId: payment.workspaceId } });
    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: "ACTIVE" },
      });
    }

    await audit({
      actorProfileId,
      action: AUDIT.SUBSCRIPTION_PAYMENT_REJECTED,
      entityType: "SubscriptionPayment",
      entityId: paymentId,
      metadata: { workspaceId: payment.workspaceId, tier: payment.tier },
    });

    return updated;
  }

  const tier = payment.tier as Tier;
  const days = PLANS[tier].billingDays ?? 30;
  const periodEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const [updated] = await prisma.$transaction([
    prisma.subscriptionPayment.update({
      where: { id: paymentId },
      data: {
        status: "CONFIRMED",
        decidedByProfileId: actorProfileId,
        decidedAt: now,
        decisionNote: input.note ?? null,
        periodStart: now,
        periodEnd,
      },
    }),
    prisma.subscription.upsert({
      where: { workspaceId: payment.workspaceId },
      create: {
        workspaceId: payment.workspaceId,
        tier,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        activatedAt: now,
        lastPaymentAt: now,
      },
      update: {
        tier,
        status: "ACTIVE",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        activatedAt: now,
        lastPaymentAt: now,
        cancelAtPeriodEnd: false,
      },
    }),
  ]);

  await audit({
    actorProfileId,
    action: AUDIT.SUBSCRIPTION_ACTIVATED,
    entityType: "Subscription",
    entityId: payment.workspaceId,
    metadata: { workspaceId: payment.workspaceId, tier, periodEnd },
  });

  return updated;
}

export async function cancelSubscription(workspaceId: string, profileId: string) {
  const subscription = await ensureSubscription(workspaceId);
  if (!isPaidTier(subscription.tier)) {
    throw new ApiError(400, "BAD_REQUEST", "You are already on the Free plan");
  }
  const updated = await prisma.subscription.update({
    where: { id: subscription.id },
    data: { cancelAtPeriodEnd: true },
  });

  await audit({
    actorProfileId: profileId,
    action: AUDIT.SUBSCRIPTION_CANCEL_SCHEDULED,
    entityType: "Subscription",
    entityId: subscription.id,
    metadata: { workspaceId, periodEnd: subscription.currentPeriodEnd },
  });

  return updated;
}

export async function getBillingSummary(workspaceId: string) {
  const entitlements = await getEntitlements(workspaceId);
  const stored = await ensureSubscription(workspaceId);

  const [payments, pending] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        tier: true,
        amountKobo: true,
        method: true,
        reference: true,
        status: true,
        createdAt: true,
        decidedAt: true,
        decisionNote: true,
        periodEnd: true,
      },
    }),
    prisma.subscriptionPayment.findFirst({
      where: { workspaceId, status: "SUBMITTED" },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    ...entitlements,
    subscription: {
      status: stored.status,
      cancelAtPeriodEnd: stored.cancelAtPeriodEnd,
      currentPeriodEnd: stored.currentPeriodEnd,
      activatedAt: stored.activatedAt,
      lastPaymentAt: stored.lastPaymentAt,
    },
    payments,
    pendingPayment: pending,
    plans: Object.values(PLANS),
  };
}
