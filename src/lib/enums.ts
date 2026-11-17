/**
 * Enum-like columns are stored as Strings (SQLite has no native enums), so the
 * allowed values live here in one place and are reused by zod validation, RBAC
 * checks and UI labels. Moving to Postgres later means swapping these for real
 * Prisma enums without changing call sites.
 */

export const ROLE = {
  BUSINESS_OWNER: "BUSINESS_OWNER",
  RESELLER: "RESELLER",
  SUPPLIER: "SUPPLIER",
  MEDIATOR: "MEDIATOR",
} as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];
export const ROLES = Object.values(ROLE);

/** 0 = unverified, 1 = contact verified, 2 = business details reviewed, 3 = documents verified */
export const VERIFICATION_TIER = {
  TIER_0: 0,
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
} as const;
export type VerificationTier = (typeof VERIFICATION_TIER)[keyof typeof VERIFICATION_TIER];

export const VERIFICATION_LABEL: Record<number, string> = {
  0: "Unverified",
  1: "Contact verified",
  2: "Business reviewed",
  3: "Fully verified",
};

export const CUSTOMER_ORDER_STATUS = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "READY",
  "DISPATCHED",
  "DELIVERED",
  "CANCELLED",
] as const;
export type CustomerOrderStatus = (typeof CUSTOMER_ORDER_STATUS)[number];

export const ORDER_CHANNEL = [
  "WHATSAPP",
  "INSTAGRAM",
  "WALK_IN",
  "PHONE",
  "REFERRAL",
  "OTHER",
] as const;
export type OrderChannel = (typeof ORDER_CHANNEL)[number];

export const PAYMENT_METHOD = ["CASH", "BANK_TRANSFER", "POS", "MOBILE_MONEY", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHOD)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  POS: "POS",
  MOBILE_MONEY: "Mobile money",
  OTHER: "Other",
};

export const PROMISE_STATUS = ["OPEN", "KEPT", "BROKEN", "CANCELLED"] as const;
export type PromiseStatus = (typeof PROMISE_STATUS)[number];

export const PLAN_FREQUENCY = ["WEEKLY", "BIWEEKLY", "MONTHLY", "CUSTOM"] as const;
export type PlanFrequency = (typeof PLAN_FREQUENCY)[number];

export const OFFER_STATUS = ["ACTIVE", "PAUSED", "ARCHIVED"] as const;
export type OfferStatus = (typeof OFFER_STATUS)[number];

export const COMMISSION_TYPE = ["NONE", "PERCENT", "FIXED"] as const;
export type CommissionType = (typeof COMMISSION_TYPE)[number];

export const DELIVERY_RESPONSIBILITY = ["SUPPLIER", "RESELLER", "SPLIT"] as const;
export type DeliveryResponsibility = (typeof DELIVERY_RESPONSIBILITY)[number];

/** Who may see the reseller's end customer details. */
export const CUSTOMER_DATA_VISIBILITY = ["NONE", "ORDER_ONLY", "FULL"] as const;
export type CustomerDataVisibility = (typeof CUSTOMER_DATA_VISIBILITY)[number];

export const APPLICATION_STATUS = ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUS)[number];

export const AGREEMENT_STATUS = [
  "DRAFT",
  "PENDING_ACCEPTANCE",
  "ACTIVE",
  "SUPERSEDED",
  "TERMINATED",
] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUS)[number];

export const PROPOSAL_STATUS = ["PROPOSED", "ACCEPTED", "DECLINED", "WITHDRAWN"] as const;

export const SUPPLIER_ORDER_STATUS = [
  "SUBMITTED",
  "STOCK_CONFIRMED",
  "STOCK_DECLINED",
  "AWAITING_PAYMENT",
  "PAID",
  "DISPATCHED",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
] as const;
export type SupplierOrderStatus = (typeof SUPPLIER_ORDER_STATUS)[number];

export const STOCK_STATUS = ["PENDING", "CONFIRMED", "PARTIAL", "DECLINED"] as const;
export type StockStatus = (typeof STOCK_STATUS)[number];

export const PAYMENT_CLAIM_STATUS = [
  "NONE",
  "CLAIMED",
  "PARTIALLY_CONFIRMED",
  "CONFIRMED",
  "DISPUTED",
] as const;
export type PaymentClaimStatus = (typeof PAYMENT_CLAIM_STATUS)[number];

export const CLAIM_STATE = ["SENT", "RECEIVED", "PARTIAL", "CONFIRMED", "DISPUTED"] as const;

export const DISPUTE_REASON = [
  "NON_DELIVERY",
  "WRONG_ITEM",
  "QUANTITY_MISMATCH",
  "PAYMENT_NOT_RECEIVED",
  "PRICE_MISMATCH",
  "QUALITY",
  "OTHER",
] as const;
export type DisputeReason = (typeof DISPUTE_REASON)[number];

export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  NON_DELIVERY: "Goods not delivered",
  WRONG_ITEM: "Wrong item sent",
  QUANTITY_MISMATCH: "Quantity does not match",
  PAYMENT_NOT_RECEIVED: "Payment claimed but not received",
  PRICE_MISMATCH: "Price differs from agreement",
  QUALITY: "Quality problem",
  OTHER: "Other",
};

export const DISPUTE_STATUS = ["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"] as const;
export type DisputeStatus = (typeof DISPUTE_STATUS)[number];

export const DISPUTE_OUTCOME = ["RESELLER_FAVOUR", "SUPPLIER_FAVOUR", "MUTUAL", "NO_ACTION"] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOME)[number];

export const DISPUTE_EVENT_TYPE = ["MESSAGE", "STATUS_CHANGE", "OUTCOME", "EVIDENCE", "ASSIGNMENT"] as const;

/** Human labels for status chips across the UI. */
export const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  READY: "Ready",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  SUBMITTED: "Submitted",
  STOCK_CONFIRMED: "Stock confirmed",
  STOCK_DECLINED: "Stock declined",
  AWAITING_PAYMENT: "Awaiting payment",
  PAID: "Marked paid",
  COMPLETED: "Completed",
  DISPUTED: "Disputed",
  OPEN: "Open",
  UNDER_REVIEW: "Under review",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  DRAFT: "Draft",
  PENDING_ACCEPTANCE: "Awaiting acceptance",
  ACTIVE: "Active",
  SUPERSEDED: "Superseded",
  TERMINATED: "Terminated",
  KEPT: "Kept",
  BROKEN: "Broken",
};

export function isOneOf<T extends readonly string[]>(list: T, value: unknown): value is T[number] {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}
