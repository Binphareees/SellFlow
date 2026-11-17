import { z } from "zod";
import { TIER } from "@/lib/plans";
import {
  AGREEMENT_STATUS,
  APPLICATION_STATUS,
  CLAIM_STATE,
  COMMISSION_TYPE,
  CUSTOMER_DATA_VISIBILITY,
  DELIVERY_RESPONSIBILITY,
  DISPUTE_OUTCOME,
  DISPUTE_REASON,
  DISPUTE_STATUS,
  OFFER_STATUS,
  ORDER_CHANNEL,
  PAYMENT_METHOD,
  PLAN_FREQUENCY,
  ROLE,
  STOCK_STATUS,
  SUPPLIER_ORDER_STATUS,
} from "@/lib/enums";

/** Amounts arrive as integers in kobo. The API never accepts naira floats. */
const kobo = z
  .number()
  .int("Amount must be a whole number of kobo")
  .min(0, "Amount cannot be negative")
  .max(100_000_000_000, "Amount is too large");

const optionalText = (max = 2000) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().trim().max(max).optional(),
  );

const phone = z.preprocess(
  (value) => (typeof value === "string" ? value.replace(/[^\d+]/g, "").replace(/^\+/, "") : value),
  z
    .string()
    .min(7, "Enter a valid phone number")
    .max(15, "Enter a valid phone number")
    .regex(/^\d+$/, "Phone number should contain digits only")
    .optional(),
);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, "Enter your email")
  .max(254)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/, "Enter a valid email address");

const password = z.string().min(8, "Use at least 8 characters").max(100);

const money = z.enum(PAYMENT_METHOD);
const isoDate = z.coerce.date();

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(2, "Tell us your name").max(80),
  businessName: z.string().trim().min(2, "Name your business").max(120),
  phone,
  country: z.string().trim().length(2).default("NG"),
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password"),
});

export const customerCreateSchema = z.object({
  name: z.string().trim().min(1, "Customer name is required").max(120),
  phone,
  notes: optionalText(1000),
});

export const customerUpdateSchema = customerCreateSchema.partial();

export const productCreateSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(140),
  sku: optionalText(60),
  description: optionalText(2000),
  unit: z.string().trim().max(30).default("unit"),
  costPriceKobo: kobo.default(0),
  sellingPriceKobo: kobo,
  stockQty: z.number().int().min(0).max(1_000_000).default(0),
  lowStockAt: z.number().int().min(0).max(1_000_000).default(0),
});

export const orderItemSchema = z.object({
  productId: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(200),
  qty: z.number().int().min(1, "Quantity must be at least 1").max(10_000),
  unitPriceKobo: kobo,
  unitCostKobo: kobo.default(0),
});

export const orderCreateSchema = z.object({
  customerId: z.string().cuid(),
  channel: z.enum(ORDER_CHANNEL).default("WHATSAPP"),
  notes: optionalText(2000),
  items: z.array(orderItemSchema).min(1, "Add at least one item").max(50),
  /** Optional deposit recorded together with the order. */
  depositKobo: kobo.optional(),
  depositMethod: money.optional(),
  promise: z
    .object({
      amountKobo: kobo,
      promisedFor: isoDate,
      note: optionalText(500),
    })
    .optional(),
  paymentPlan: z
    .object({
      depositKobo: kobo.default(0),
      installmentCount: z.number().int().min(1).max(52),
      frequency: z.enum(PLAN_FREQUENCY),
      startDate: isoDate,
      note: optionalText(500),
    })
    .optional(),
});

export const orderUpdateSchema = z.object({
  status: z
    .enum(["PENDING", "CONFIRMED", "PROCESSING", "READY", "DISPATCHED", "DELIVERED", "CANCELLED"])
    .optional(),
  notes: optionalText(2000),
});

export const paymentCreateSchema = z.object({
  amountKobo: kobo,
  method: money.default("BANK_TRANSFER"),
  paidAt: isoDate.default(() => new Date()),
  reference: optionalText(120),
  note: optionalText(500),
});

export const promiseCreateSchema = z.object({
  amountKobo: kobo,
  promisedFor: isoDate,
  note: optionalText(500),
});

export const promiseResolveSchema = z.object({
  status: z.enum(["KEPT", "BROKEN", "CANCELLED"]),
});

// ── Marketplace ─────────────────────────────────────────────────────────────

export const offerTermsSchema = z.object({
  resellerPriceKobo: kobo,
  minResalePriceKobo: kobo.optional(),
  commissionType: z.enum(COMMISSION_TYPE).default("NONE"),
  commissionValue: z.number().int().min(0).max(100_000).default(0),
  moq: z.number().int().min(1).max(10_000).default(1),
  stockQty: z.number().int().min(0).max(1_000_000).default(0),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  deliveryResponsibility: z.enum(DELIVERY_RESPONSIBILITY).default("SUPPLIER"),
  advertisingPermission: z.boolean().default(false),
  customerDataVisibility: z.enum(CUSTOMER_DATA_VISIBILITY).default("ORDER_ONLY"),
  notes: optionalText(1000),
});

export const listingCreateSchema = z.object({
  productId: z.string().cuid().optional(),
  title: z.string().trim().min(3).max(160),
  description: optionalText(3000),
  category: optionalText(60),
  publicPriceKobo: kobo,
  moq: z.number().int().min(1).max(10_000).default(1),
  stockQty: z.number().int().min(0).max(1_000_000).default(0),
  images: z.array(z.string().url()).max(8).default([]),
  isPublished: z.boolean().default(false),
  offer: offerTermsSchema.optional(),
});

export const listingUpdateSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  description: optionalText(3000),
  category: optionalText(60),
  publicPriceKobo: kobo.optional(),
  moq: z.number().int().min(1).max(10_000).optional(),
  stockQty: z.number().int().min(0).max(1_000_000).optional(),
  images: z.array(z.string().url()).max(8).optional(),
  isPublished: z.boolean().optional(),
});

export const offerUpdateSchema = offerTermsSchema.partial().extend({
  status: z.enum(OFFER_STATUS).optional(),
});

export const supplierProfileSchema = z.object({
  businessName: z.string().trim().min(2).max(140),
  about: optionalText(2000),
  city: optionalText(60),
  state: optionalText(60),
  logoUrl: optionalText(500),
});

export const applicationCreateSchema = z.object({
  supplierProfileId: z.string().cuid(),
  offerId: z.string().cuid().optional(),
  message: optionalText(1000),
  businessSummary: optionalText(1000),
});

export const applicationDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  note: optionalText(1000),
  /** When approving, the offer whose current terms become the first agreement version. */
  offerId: z.string().cuid().optional(),
});

export const proposalCreateSchema = offerTermsSchema.partial().extend({
  resellerPriceKobo: kobo,
  message: optionalText(1000),
});

export const agreementAcceptSchema = z.object({
  versionId: z.string().cuid().optional(),
});

export const supplierOrderCreateSchema = z.object({
  supplierProfileId: z.string().cuid(),
  customerOrderId: z.string().cuid().optional(),
  notes: optionalText(1000),
  items: z
    .array(
      z.object({
        listingId: z.string().cuid(),
        qty: z.number().int().min(1).max(10_000),
        // The reseller's planned selling price. It is optional, but a supplied
        // value must be a positive whole number of kobo; the server then checks
        // it against the agreement's minimum resale price.
        resalePriceKobo: kobo.positive("Resale price must be greater than zero").optional(),
      }),
    )
    .min(1)
    .max(30),
});

export const stockDecisionSchema = z.object({
  decision: z.enum(["CONFIRMED", "PARTIAL", "DECLINED"]),
  note: optionalText(1000),
  items: z
    .array(
      z.object({
        itemId: z.string().cuid(),
        confirmedQty: z.number().int().min(0).max(10_000),
      }),
    )
    .default([]),
});

export const supplierOrderStatusSchema = z.object({
  status: z.enum(SUPPLIER_ORDER_STATUS),
  note: optionalText(1000),
});

export const claimCreateSchema = z.object({
  amountKobo: kobo,
  method: money.default("BANK_TRANSFER"),
  reference: optionalText(120),
  note: optionalText(500),
  /**
   * Optional and only a hint. The server derives the initial state from the
   * actor's role ("SENT" for a reseller, "RECEIVED" for a supplier) and
   * rejects anything else: CONFIRMED / DISPUTED / PARTIAL are decisions, not
   * claims (audit finding S-03).
   */
  status: z.enum(CLAIM_STATE).optional(),
});

export const claimDecisionSchema = z.object({
  action: z.enum(["CONFIRM", "DISPUTE"]),
  note: optionalText(500),
});

export const dispatchCreateSchema = z.object({
  courierName: optionalText(120),
  trackingRef: optionalText(120),
  itemSummary: optionalText(500),
  note: optionalText(500),
});

export const deliveryCreateSchema = z.object({
  receivedQtyOk: z.boolean().default(true),
  note: optionalText(500),
});

// ── Disputes ────────────────────────────────────────────────────────────────

export const disputeCreateSchema = z.object({
  supplierOrderId: z.string().cuid().optional(),
  /** Optional payment claim the dispute is about; the order is derived from it. */
  claimId: z.string().cuid().optional(),
  againstProfileId: z.string().cuid().optional(),
  reason: z.enum(DISPUTE_REASON),
  description: z.string().trim().min(10, "Describe what happened").max(4000),
});

export const disputeStatusSchema = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "CLOSED"]),
  note: optionalText(500),
});

export const disputeEventSchema = z.object({
  type: z.enum(["MESSAGE", "EVIDENCE"]).default("MESSAGE"),
  body: z.string().trim().min(1).max(4000),
});

export const disputeResolveSchema = z.object({
  outcome: z.enum(DISPUTE_OUTCOME),
  note: z.string().trim().min(3).max(2000),
  status: z.enum(DISPUTE_STATUS).default("RESOLVED"),
});

// ── Billing ─────────────────────────────────────────────────────────────────

export const upgradeSchema = z.object({
  tier: z.enum([TIER.PRO, TIER.SUPPLIER_PRO]),
  method: money.default("BANK_TRANSFER"),
  reference: optionalText(120),
  proofNote: optionalText(600),
});

export const subscriptionDecisionSchema = z.object({
  action: z.enum(["CONFIRM", "REJECT"]),
  note: optionalText(500),
});

export const roleGrantSchema = z.object({
  role: z.enum([ROLE.RESELLER, ROLE.SUPPLIER, ROLE.MEDIATOR]),
});

export const verificationSchema = z.object({
  tier: z.number().int().min(0).max(3),
  reason: z.string().trim().min(3).max(300),
  evidenceRef: optionalText(300),
});

export const stockStatusValues = STOCK_STATUS;
export const agreementStatusValues = AGREEMENT_STATUS;
export const applicationStatusValues = APPLICATION_STATUS;
