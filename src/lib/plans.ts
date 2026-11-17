/**
 * Plan catalogue. Client-safe: no Prisma or server imports live here so the
 * pricing page, banners and server guards all read the same numbers.
 *
 * Billing is manual on purpose (see README): no gateway, no card, no wallet and
 * no automatic bank verification. `priceKobo` is what a person is quoted when
 * they submit a transfer reference.
 */

export const TIER = {
  FREE: "FREE",
  PRO: "PRO",
  SUPPLIER_PRO: "SUPPLIER_PRO",
} as const;
export type Tier = (typeof TIER)[keyof typeof TIER];
export const TIERS = Object.values(TIER);

export const SUBSCRIPTION_STATUS = [
  "ACTIVE",
  "PENDING_PAYMENT",
  "PAST_DUE",
  "CANCELED",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[number];

export const SUBSCRIPTION_PAYMENT_STATUS = ["SUBMITTED", "CONFIRMED", "REJECTED"] as const;
export type SubscriptionPaymentStatus = (typeof SUBSCRIPTION_PAYMENT_STATUS)[number];

/** Feature flags a plan unlocks. Limits are separate and countable. */
export const FEATURE = {
  /** Unlimited customers, orders and products. */
  UNLIMITED_RECORDS: "unlimited_records",
  /** More than one supplier relationship on the reseller side. */
  MULTI_SUPPLIER: "multi_supplier",
  /** Installment plans attached to an order. */
  PAYMENT_PLANS: "payment_plans",
  /** Reminder copy for a promise or installment, not just the balance. */
  PROMISE_REMINDERS: "promise_reminders",
  /** Re-pricing an approved reseller by publishing a new agreement version. */
  AGREEMENT_VERSIONING: "agreement_versioning",
  /** Structured counter-offers on an agreement. */
  NEGOTIATION: "negotiation",
} as const;
export type Feature = (typeof FEATURE)[keyof typeof FEATURE];

export const FEATURE_LABEL: Record<Feature, string> = {
  unlimited_records: "Unlimited customers, orders and products",
  multi_supplier: "Work with more than one supplier",
  payment_plans: "Installment payment plans",
  promise_reminders: "Reminders for promises and installments",
  agreement_versioning: "Change agreed terms with a new version",
  negotiation: "Structured counter-offers",
};

export type TierLimits = {
  customers: number;
  activeOrders: number;
  products: number;
  suppliers: number;
};

export type Plan = {
  tier: Tier;
  name: string;
  tagline: string;
  priceKobo: number;
  /** null = no recurring charge on this plan. */
  billingDays: number | null;
  limits: TierLimits;
  features: Feature[];
  highlights: string[];
  bestFor: string;
};

export const UNLIMITED = Number.POSITIVE_INFINITY;

const FREE_LIMITS: TierLimits = {
  customers: 20,
  activeOrders: 10,
  products: 30,
  suppliers: 1,
};

const PAID_LIMITS: TierLimits = {
  customers: UNLIMITED,
  activeOrders: UNLIMITED,
  products: UNLIMITED,
  suppliers: UNLIMITED,
};

export const PLANS: Record<Tier, Plan> = {
  FREE: {
    tier: TIER.FREE,
    name: "Free",
    tagline: "Run the basics on one phone",
    priceKobo: 0,
    billingDays: null,
    limits: FREE_LIMITS,
    features: [],
    bestFor: "A shop testing SellFlow with real orders.",
    highlights: [
      "Up to 20 customers",
      "10 open orders at a time",
      "30 products in your catalogue",
      "Manual payments, balances and profit",
      "One supplier relationship",
      "WhatsApp balance reminder",
    ],
  },
  PRO: {
    tier: TIER.PRO,
    name: "Pro",
    tagline: "For a shop that is already busy",
    priceKobo: 250_000, // ₦2,500 per month
    billingDays: 30,
    limits: PAID_LIMITS,
    features: [
      FEATURE.UNLIMITED_RECORDS,
      FEATURE.MULTI_SUPPLIER,
      FEATURE.PAYMENT_PLANS,
      FEATURE.PROMISE_REMINDERS,
    ],
    bestFor: "Resellers juggling several suppliers and repeat customers.",
    highlights: [
      "Unlimited customers, orders and products",
      "Unlimited supplier relationships",
      "Installment payment plans",
      "Promise reminders with the date already written",
      "Everything in Free",
    ],
  },
  SUPPLIER_PRO: {
    tier: TIER.SUPPLIER_PRO,
    name: "Supplier Pro",
    tagline: "Wholesale terms you can defend",
    priceKobo: 750_000, // ₦7,500 per month
    billingDays: 30,
    limits: PAID_LIMITS,
    features: [
      FEATURE.UNLIMITED_RECORDS,
      FEATURE.MULTI_SUPPLIER,
      FEATURE.PAYMENT_PLANS,
      FEATURE.PROMISE_REMINDERS,
      FEATURE.AGREEMENT_VERSIONING,
      FEATURE.NEGOTIATION,
    ],
    bestFor: "Suppliers running a network of approved resellers.",
    highlights: [
      "Everything in Pro",
      "Publish new agreement terms with a versioned lock",
      "Structured counter-offers instead of chat screenshots",
      "Reseller price history stays auditable",
      "Priority help on disputes",
    ],
  },
};

export const PAID_TIERS: Tier[] = [TIER.PRO, TIER.SUPPLIER_PRO];

export function planFor(tier: string | null | undefined): Plan {
  if (tier === TIER.PRO) return PLANS.PRO;
  if (tier === TIER.SUPPLIER_PRO) return PLANS.SUPPLIER_PRO;
  return PLANS.FREE;
}

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as string[]).includes(value);
}

export function isPaidTier(tier: string | null | undefined): boolean {
  return tier === TIER.PRO || tier === TIER.SUPPLIER_PRO;
}

export function planUnlocks(tier: string | null | undefined, feature: Feature): boolean {
  return planFor(tier).features.includes(feature);
}

export function isUnlimited(limit: number): boolean {
  return !Number.isFinite(limit);
}

/** null when under the cap, the cap when at or over it. */
export function limitFor(tier: string | null | undefined, resource: keyof TierLimits): number {
  return planFor(tier).limits[resource];
}

export function usagePercent(used: number, limit: number): number {
  if (isUnlimited(limit) || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function formatLimit(limit: number): string {
  return isUnlimited(limit) ? "Unlimited" : String(limit);
}

/** What a seller is asked to pay, in kobo, for a tier. Server-side truth. */
export function priceKoboFor(tier: Tier): number {
  return PLANS[tier].priceKobo;
}

export const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PENDING_PAYMENT: "Awaiting confirmation",
  PAST_DUE: "Payment overdue",
  CANCELED: "Canceled",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  SUBMITTED: "Submitted",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
};
