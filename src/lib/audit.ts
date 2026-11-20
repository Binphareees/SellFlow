import { prisma } from "@/lib/db";
import type { Role } from "@/lib/enums";
import type { Prisma, PrismaClient } from "@prisma/client";

type AuditInput = {
  actorProfileId?: string | null;
  actorRole?: Role | string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
};

/** A Prisma client or transaction client, so critical rows can share a commit. */
export type AuditWriter = PrismaClient | Prisma.TransactionClient;

/** Thrown by `auditCritical` so a security-critical action fails closed. */
export class AuditWriteError extends Error {
  readonly action: string;

  constructor(action: string, cause: unknown) {
    super(`Audit write failed for ${action}`);
    this.name = "AuditWriteError";
    this.action = action;
    this.cause = cause;
  }
}

// Total audit-write failures in this process. The health probe publishes them,
// so a lost trail is observable instead of only living in a log line (S-12).
let failures = 0;
let lastFailureAt: string | null = null;

export function auditHealth(): {
  status: "ok" | "degraded";
  failures: number;
  lastFailureAt: string | null;
} {
  return {
    status: failures === 0 ? "ok" : "degraded",
    failures,
    lastFailureAt,
  };
}

export function resetAuditHealth(): void {
  failures = 0;
  lastFailureAt = null;
}

const RETRY_DELAYS_MS = [20, 60];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function noteFailure(action: string, error: unknown): void {
  failures += 1;
  lastFailureAt = new Date().toISOString();
  console.error("[audit] failed to write", action, error);
}

function rowFor(input: AuditInput): Prisma.AuditLogUncheckedCreateInput {
  return {
    actorProfileId: input.actorProfileId ?? null,
    actorRole: typeof input.actorRole === "string" ? input.actorRole : null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    ipHash: input.ipHash ?? null,
  };
}

/**
 * Append-only audit trail for events whose loss is survivable.
 *
 * The write is retried briefly (SQLite can transiently lock) and then recorded
 * as a failure: auditing must never break the request it describes, but it must
 * not vanish silently either. `auditHealth()` and `/api/health` expose the loss.
 *
 * Pass `client` only for reads/writes that are already inside a transaction and
 * tolerate abort; security-critical events belong in `auditCritical`, because a
 * failed statement poisons an interactive transaction and its commit will fail.
 */
export async function audit(
  input: AuditInput,
  options: { client?: AuditWriter } = {},
): Promise<boolean> {
  const writer: AuditWriter = options.client ?? prisma;
  const attempts = options.client ? 1 : RETRY_DELAYS_MS.length + 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await writer.auditLog.create({ data: rowFor(input) });
      return true;
    } catch (error) {
      if (attempt === attempts - 1) {
        noteFailure(input.action, error);
        return false;
      }
      await sleep(RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }

  return false;
}

/**
 * Security-critical events (account creation, verification elevation, …).
 *
 * With a transaction client the row commits or rolls back with the change it
 * describes: a failed insert throws, the transaction aborts, and the caller
 * reports an error instead of a success nobody can prove. Standalone, a failure
 * throws `AuditWriteError` after recording it. Never swallowed.
 */
export async function auditCritical(
  input: AuditInput,
  options: { client?: AuditWriter } = {},
): Promise<void> {
  const writer: AuditWriter = options.client ?? prisma;
  try {
    await writer.auditLog.create({ data: rowFor(input) });
  } catch (error) {
    noteFailure(input.action, error);
    throw new AuditWriteError(input.action, error);
  }
}

export const AUDIT = {
  REGISTER: "auth.register",
  LOGIN: "auth.login",
  LOGOUT: "auth.logout",
  ROLE_GRANTED: "profile.role_granted",
  TIER_CHANGED: "profile.tier_changed",
  ORDER_CREATED: "customer_order.created",
  ORDER_STATUS: "customer_order.status_changed",
  PAYMENT_REVERSED: "customer_order.payment_reversed",
  HELD_STOCK_RELEASED: "customer_order.held_stock_released",
  PAYMENT_RECORDED: "customer_order.payment_recorded",
  PAYMENT_VOIDED: "customer_order.payment_voided",
  PROMISE_CREATED: "customer_order.promise_created",
  PROMISE_RESOLVED: "customer_order.promise_resolved",
  PRICE_ACCESS_GRANTED: "marketplace.price_access_granted",
  PRICE_ACCESS_DENIED: "marketplace.price_access_denied",
  APPLICATION_SUBMITTED: "reseller_network.application_submitted",
  APPLICATION_DECIDED: "reseller_network.application_decided",
  AGREEMENT_CREATED: "reseller_network.agreement_created",
  AGREEMENT_VERSION: "reseller_network.agreement_versioned",
  PROPOSAL_CREATED: "reseller_network.proposal_created",
  SUPPLIER_ORDER_CREATED: "supplier_order.created",
  STOCK_CONFIRMED: "supplier_order.stock_confirmed",
  CLAIM_RECORDED: "supplier_order.payment_claim_recorded",
  CLAIM_CONFIRMED: "supplier_order.payment_claim_confirmed",
  CLAIM_DISPUTED: "supplier_order.payment_claim_disputed",
  DISPATCHED: "supplier_order.dispatched",
  DELIVERED: "supplier_order.delivery_confirmed",
  SUPPLIER_ORDER_STATUS: "supplier_order.status_changed",
  SUPPLIER_HELD_STOCK_RELEASED: "supplier_order.held_stock_released",
  DISPUTE_OPENED: "dispute.opened",
  DISPUTE_EVENT: "dispute.event",
  DISPUTE_STATUS: "dispute.status_changed",
  SUBSCRIPTION_CHANGED: "subscription.changed",
  SUBSCRIPTION_PAYMENT_SUBMITTED: "subscription.payment_submitted",
  SUBSCRIPTION_PAYMENT_REJECTED: "subscription.payment_rejected",
  SUBSCRIPTION_ACTIVATED: "subscription.activated",
  SUBSCRIPTION_CANCEL_SCHEDULED: "subscription.cancel_scheduled",
  DISPUTE_RESOLVED: "dispute.resolved",
  PASSWORD_RESET: "auth.password_reset",
  PASSWORD_CHANGED: "auth.password_changed",
} as const;
