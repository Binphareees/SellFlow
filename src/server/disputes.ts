import { prisma } from "@/lib/db";
import { audit, auditCritical, AUDIT } from "@/lib/audit";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api";
import { ROLE, type DisputeStatus, type Role } from "@/lib/enums";
import { isMediator } from "@/lib/auth/rbac";
import type { AuthContext } from "@/lib/auth/session";
import type { z } from "zod";
import type {
  disputeCreateSchema,
  disputeResolveSchema,
  disputeStatusSchema,
} from "@/lib/validation";

/** Everything a dispute rule needs to know about the caller. */
export type DisputeViewer = Pick<AuthContext, "profile" | "roles" | "user">;

function reference(): string {
  return `DSP-${Date.now().toString(36).toUpperCase().slice(-5)}${Math.random()
    .toString(36)
    .toUpperCase()
    .slice(2, 5)}`;
}

function viewerRole(viewer: DisputeViewer, isSupplier: boolean): Role {
  return isSupplier ? ROLE.SUPPLIER : ROLE.RESELLER;
}

/**
 * A dispute is visible to the two parties on the supplier order, whoever raised
 * it, and to mediators. Everyone else gets a 403, not a 404-with-details.
 */
async function partyContext(disputeId: string, viewer: DisputeViewer) {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      claim: { select: { id: true, amountKobo: true, status: true, method: true, reference: true } },
      supplierOrder: {
        select: {
          id: true,
          orderNumber: true,
          resellerProfileId: true,
          supplierProfile: { select: { profileId: true, businessName: true } },
        },
      },
    },
  });
  if (!dispute) throw notFound("Dispute not found");

  const moderator = isMediator(viewer);
  const isReseller = dispute.supplierOrder?.resellerProfileId === viewer.profile.id;
  const isSupplier = dispute.supplierOrder?.supplierProfile.profileId === viewer.profile.id;
  const isRaiser = dispute.raisedByProfileId === viewer.profile.id;

  if (!moderator && !isReseller && !isSupplier && !isRaiser) throw forbidden();

  return { dispute, isModerator: moderator, isReseller, isSupplier };
}

export async function openDispute(viewer: DisputeViewer, input: z.infer<typeof disputeCreateSchema>) {
  let supplierOrderId = input.supplierOrderId ?? null;
  let claim: { id: string; supplierOrderId: string; amountKobo: number; reference: string | null } | null = null;

  if (input.claimId) {
    claim = await prisma.paymentStatusClaim.findUnique({
      where: { id: input.claimId },
      select: { id: true, supplierOrderId: true, amountKobo: true, reference: true },
    });
    if (!claim) throw notFound("Payment claim not found");
    if (supplierOrderId && supplierOrderId !== claim.supplierOrderId) {
      throw badRequest("That payment claim belongs to a different order");
    }
    supplierOrderId = claim.supplierOrderId;
  }

  if (!supplierOrderId) throw badRequest("A dispute must reference a supplier order");

  const order = await prisma.supplierOrder.findUnique({
    where: { id: supplierOrderId },
    include: { supplierProfile: { select: { profileId: true } } },
  });
  if (!order) throw notFound("Supplier order not found");

  const isSupplier = order.supplierProfile.profileId === viewer.profile.id;
  const isReseller = order.resellerProfileId === viewer.profile.id;
  if (!isSupplier && !isReseller) {
    throw forbidden("Only the reseller or supplier on this order can raise a dispute");
  }

  const actorRole = viewerRole(viewer, isSupplier);
  const againstProfileId =
    input.againstProfileId ?? (isSupplier ? order.resellerProfileId : order.supplierProfile.profileId);

  // One transaction so the dispute, its first event and the audit row commit or
  // roll back together. A failed audit write is fail-closed: it throws
  // AuditWriteError, poisons the transaction, and rolls back the business write.
  const created = await prisma.$transaction(async (tx) => {
    // Revalidate ownership/authorization against current DB state inside the
    // transaction, so a concurrent reassignment or deletion cannot invalidate the
    // checks between the outside lookup and the commit.
    const currentOrder = await tx.supplierOrder.findUnique({
      where: { id: supplierOrderId },
      include: { supplierProfile: { select: { profileId: true } } },
    });
    if (!currentOrder) throw notFound("Supplier order not found");
    if (currentOrder.supplierProfile.profileId !== order.supplierProfile.profileId) {
      throw notFound("Supplier order not found");
    }
    const currentIsSupplier = currentOrder.supplierProfile.profileId === viewer.profile.id;
    const currentIsReseller = currentOrder.resellerProfileId === viewer.profile.id;
    if (!currentIsSupplier && !currentIsReseller) {
      throw forbidden("Only the reseller or supplier on this order can raise a dispute");
    }

    // Best-effort guard against raising a second active dispute for the same
    // issue. This is a read-before-create inside the transaction, not a
    // concurrency-safe uniqueness guarantee: with no unique constraint on
    // (supplierOrderId/claimId, raisedByProfileId, againstProfileId, status in
    // OPEN/UNDER_REVIEW), two concurrent requests can still both pass this check
    // and create separate disputes. We accept that limitation here intentionally
    // and do not claim duplicate disputes are impossible. The S-12 acceptance
    // criterion for this action is narrower: each successfully created dispute has
    // exactly one canonical DISPUTE_OPENED audit write, because there is exactly one
    // canonical writer path and it is transaction-coupled.
    if (input.claimId) {
      const existing = await tx.dispute.findFirst({
        where: {
          claimId: input.claimId,
          status: { in: ["OPEN", "UNDER_REVIEW"] },
        },
        select: { id: true },
      });
      if (existing) throw conflict("An active dispute already exists for this payment claim");
    } else {
      const existing = await tx.dispute.findFirst({
        where: {
          supplierOrderId,
          raisedByProfileId: viewer.profile.id,
          againstProfileId,
          status: { in: ["OPEN", "UNDER_REVIEW"] },
        },
        select: { id: true },
      });
      if (existing) throw conflict("An active dispute already exists for this order");
    }

    const dispute = await tx.dispute.create({
      data: {
        reference: reference(),
        supplierOrderId,
        claimId: claim?.id ?? null,
        raisedByProfileId: viewer.profile.id,
        raisedByRole: actorRole,
        againstProfileId,
        reason: input.reason,
        description: input.description,
        status: "OPEN",
        events: {
          create: {
            actorProfileId: viewer.profile.id,
            actorRole,
            type: "STATUS_CHANGE",
            body: claim ? `Dispute opened on payment claim ${claim.reference ?? claim.id}` : "Dispute opened",
            metadataJson: JSON.stringify({ reason: input.reason, claimId: claim?.id ?? null }),
          },
        },
      },
    });

    await auditCritical(
      {
        actorProfileId: viewer.profile.id,
        actorRole,
        action: AUDIT.DISPUTE_OPENED,
        entityType: "Dispute",
        entityId: dispute.id,
        metadata: { supplierOrderId, claimId: claim?.id ?? null, reason: input.reason, reference: dispute.reference },
      },
      { client: tx },
    );

    return dispute;
  });

  return created;
}

export async function addDisputeEvent(
  disputeId: string,
  viewer: DisputeViewer,
  input: { type: "MESSAGE" | "EVIDENCE"; body: string },
) {
  // Use the existing party-context read for the response path, but do not rely on
  // it to serialize the event append against a concurrent dispute closure. The
  // authoritative serialization happens inside the write transaction below.
  const { dispute, isModerator, isReseller, isSupplier } = await partyContext(disputeId, viewer);

  const actorRole = isModerator
    ? ROLE.MEDIATOR
    : isSupplier
      ? ROLE.SUPPLIER
      : isReseller
        ? ROLE.RESELLER
        : "SYSTEM";

  // Serialize the event append and the audit write against dispute closure using a
  // conditional write on the dispute's current status. The disputeEvent table has no
  // unique constraint that would by itself prevent a concurrent closed-state append,
  // so we predicate the dispute touch on the expected previous status and abort if it
  // does not match. This does not eliminate every scheduling race at the application
  // layer, but it means a concurrent closure wins: if the dispute was closed between
  // the outside party-context read and this transaction, the conditional update does
  // not match and the event and audit row are not written.
  const event = await prisma.$transaction(async (tx) => {
    // Revalidate mutable authorization and open-state against current DB values
    // inside the transaction. partyContext is a read-only snapshot; this re-read is
    // the source of truth for the write.
    const current = await tx.dispute.findUnique({
      where: { id: disputeId },
      include: {
        supplierOrder: {
          select: {
            resellerProfileId: true,
            supplierProfile: { select: { profileId: true } },
          },
        },
      },
    });
    if (!current) throw notFound("Dispute not found");

    const moderator = isMediator(viewer);
    const currentIsReseller =
      current.supplierOrder?.resellerProfileId === viewer.profile.id;
    const currentIsSupplier =
      current.supplierOrder?.supplierProfile.profileId === viewer.profile.id;
    const currentIsRaiser = current.raisedByProfileId === viewer.profile.id;

    if (!moderator && !currentIsReseller && !currentIsSupplier && !currentIsRaiser) {
      throw forbidden();
    }
    if (current.status === "CLOSED") throw conflict("This dispute is closed");

    // Retain partyContext's decision about the caller's role for audit metadata,
    // but base the closed-state check on the inside-transaction read above.
    const eventRole = actorRole;

    // Conditional dispute update: touching the dispute row only when it is still in
    // the expected previous status makes the event append serialized against a
    // concurrent close. The affected-row check is the gate that aborts the whole
    // transaction on conflict.
    const touched = await tx.dispute.updateMany({
      where: { id: disputeId, status: current.status },
      data: { updatedAt: new Date() },
    });
    if (touched.count !== 1) {
      throw conflict("This dispute changed while the event was being recorded");
    }

    const event = await tx.disputeEvent.create({
      data: {
        disputeId,
        actorProfileId: viewer.profile.id,
        actorRole: eventRole,
        type: input.type,
        body: input.body,
      },
    });

    await auditCritical(
      {
        actorProfileId: viewer.profile.id,
        actorRole: eventRole,
        action: AUDIT.DISPUTE_EVENT,
        entityType: "Dispute",
        entityId: disputeId,
        metadata: { type: input.type },
      },
      { client: tx },
    );

    return event;
  });

  return event;
}

/** Mediators move a dispute between OPEN, UNDER_REVIEW and CLOSED. */
export async function changeDisputeStatus(
  viewer: DisputeViewer,
  disputeId: string,
  input: z.infer<typeof disputeStatusSchema>,
) {
  if (!isMediator(viewer)) throw forbidden("Only a platform mediator can do this");

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw notFound("Dispute not found");
  if (dispute.status === input.status) throw conflict(`This dispute is already ${input.status.toLowerCase()}`);

  const nextStatus = input.status as DisputeStatus;

  const updated = await prisma.$transaction(async (tx) => {
    // Re-read the dispute inside the transaction and serialize the transition
    // against the expected previous status. If another mediator already moved this
    // dispute, the conditional update matches zero rows.
    const current = await tx.dispute.findUnique({ where: { id: disputeId } });
    if (!current) throw notFound("Dispute not found");
    if (current.status === nextStatus) throw conflict(`This dispute is already ${nextStatus.toLowerCase()}`);

    const touched = await tx.dispute.updateMany({
      where: { id: disputeId, status: current.status },
      data: {
        status: nextStatus,
        assignedMediatorProfileId: current.assignedMediatorProfileId ?? viewer.profile.id,
        ...(nextStatus === "CLOSED" ? { resolvedAt: new Date() } : {}),
      },
    });
    if (touched.count !== 1) {
      throw conflict("This dispute changed status while it was being updated");
    }

    await tx.disputeEvent.create({
      data: {
        disputeId,
        actorProfileId: viewer.profile.id,
        actorRole: ROLE.MEDIATOR,
        type: "STATUS_CHANGE",
        body: input.note ?? `Status changed to ${nextStatus.toLowerCase().replace("_", " ")}`,
        metadataJson: JSON.stringify({ from: current.status, to: nextStatus }),
      },
    });

    await auditCritical(
      {
        actorProfileId: viewer.profile.id,
        actorRole: ROLE.MEDIATOR,
        action: AUDIT.DISPUTE_STATUS,
        entityType: "Dispute",
        entityId: disputeId,
        metadata: { from: current.status, to: nextStatus },
      },
      { client: tx },
    );

    return { id: disputeId, status: nextStatus };
  });

  return updated;
}

const VISIBLE_TO_PARTY = (profileId: string) => ({
  OR: [
    { raisedByProfileId: profileId },
    { supplierOrder: { resellerProfileId: profileId } },
    { supplierOrder: { supplierProfile: { profileId } } },
  ],
});

export async function listDisputes(
  viewer: DisputeViewer,
  options: { status?: string; scope?: "mine" | "all" } = {},
) {
  const moderator = isMediator(viewer);

  // `scope` is a request, not an authorization. Only mediators and platform
  // admins may read across disputes; everyone else is confined to their own
  // cases (audit finding S-01). This is checked before any query runs, so a
  // denied caller receives no records, counts or other metadata.
  if (options.scope === "all" && !moderator) {
    throw forbidden("Only a platform mediator can view every dispute");
  }

  const scope = options.scope ?? (moderator ? "all" : "mine");

  const where = {
    ...(scope === "mine" ? VISIBLE_TO_PARTY(viewer.profile.id) : {}),
    ...(options.status ? { status: options.status } : {}),
  };

  return prisma.dispute.findMany({
    where,
    include: {
      supplierOrder: {
        select: { orderNumber: true, supplierProfile: { select: { businessName: true } } },
      },
      claim: { select: { id: true, amountKobo: true } },
      _count: { select: { events: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
  });
}

export async function disputeCounts(viewer: DisputeViewer) {
  const moderator = isMediator(viewer);
  const where = moderator ? {} : VISIBLE_TO_PARTY(viewer.profile.id);

  const grouped = await prisma.dispute.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });

  const counts: Record<string, number> = { OPEN: 0, UNDER_REVIEW: 0, RESOLVED: 0, CLOSED: 0, ALL: 0 };
  for (const row of grouped) {
    counts[row.status] = row._count._all;
    counts.ALL += row._count._all;
  }
  return counts;
}

export async function getDispute(disputeId: string, viewer: DisputeViewer) {
  const { dispute } = await partyContext(disputeId, viewer);

  const full = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      claim: {
        select: {
          id: true,
          amountKobo: true,
          status: true,
          method: true,
          reference: true,
          claimedByRole: true,
          claimedAt: true,
        },
      },
      supplierOrder: {
        select: {
          id: true,
          orderNumber: true,
          totalKobo: true,
          status: true,
          resellerProfile: { select: { id: true, displayName: true } },
          supplierProfile: { select: { businessName: true } },
          disputes: { select: { id: true, reference: true, status: true } },
        },
      },
    },
  });
  if (!full) throw notFound("Dispute not found");
  void dispute;
  return full;
}

export async function resolveDispute(
  viewer: DisputeViewer,
  disputeId: string,
  input: z.infer<typeof disputeResolveSchema>,
) {
  if (!isMediator(viewer)) throw forbidden("Only a platform mediator can do this");

  const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
  if (!dispute) throw notFound("Dispute not found");

  // The outcome record is the authoritative part of resolution. We serialize the
  // outcome write against the expected previous dispute state, including the
  // current outcome value, so only one mediator can record the first outcome and
  // a second outcome attempt is rejected rather than silently overwriting the
  // first. The rules are:
  //   - a dispute with no outcome yet may receive its first outcome, and the
  //     write is conditional on outcome currently being null (and on the expected
  //     previous status) so two concurrent first-outcome attempts cannot both
  //     succeed;
  //   - a dispute that already has an outcome refuses another outcome write,
  //     because the product does not support silently overwriting a recorded
  //     outcome;
  //   - if the expected previous state does not match, the affected-row check
  //     aborts the whole transaction before the outcome event, claim/order
  //     updates, or audit record can commit.
  const updated = await prisma.$transaction(async (tx) => {
    // Re-read the dispute inside the transaction. If it disappeared or changed
    // under us since the outside read, the conditional update below will not
    // match and the transaction aborts.
    const current = await tx.dispute.findUnique({ where: { id: disputeId } });
    if (!current) throw notFound("Dispute not found");

    // A dispute that already has an outcome must not silently accept another one.
    if (current.outcome != null) {
      throw conflict("This dispute already has an outcome");
    }

    const disputeUpdated = await tx.dispute.updateMany({
      where: {
        id: disputeId,
        status: current.status,
        outcome: null,
      },
      data: {
        status: input.status,
        outcome: input.outcome,
        resolutionNote: input.note,
        resolvedAt: new Date(),
        assignedMediatorProfileId: current.assignedMediatorProfileId ?? viewer.profile.id,
      },
    });
    if (disputeUpdated.count !== 1) {
      throw conflict("This dispute changed while it was being resolved");
    }

    await tx.disputeEvent.create({
      data: {
        disputeId,
        actorProfileId: viewer.profile.id,
        actorRole: ROLE.MEDIATOR,
        type: "OUTCOME",
        body: input.note,
        metadataJson: JSON.stringify({ outcome: input.outcome, status: input.status }),
      },
    });

    // A dispute on a claim settles that claim's record too. Use a conditional
    // update against the expected previous claim state, and abort if a concurrent
    // decision already changed the claim.
    if (current.claimId) {
      const claim = await tx.paymentStatusClaim.findUnique({
        where: { id: current.claimId },
        select: { id: true, status: true, supplierOrderId: true },
      });
      if (!claim) throw notFound("Payment claim not found");

      const previousClaimStatus = claim.status;
      const nextClaimStatus =
        input.outcome === "SUPPLIER_FAVOUR" ? "CONFIRMED" : "DISPUTED";

      const claimUpdated = await tx.paymentStatusClaim.updateMany({
        where: { id: claim.id, status: previousClaimStatus },
        data: { status: nextClaimStatus },
      });
      if (claimUpdated.count !== 1) {
        throw conflict("The payment claim changed while the dispute was being resolved");
      }

      // Reflect the claim resolution on the owning supplier order only when the
      // order is still in the expected previous state.
      if (claim.supplierOrderId) {
        const orderUpdated = await tx.supplierOrder.updateMany({
          where: {
            id: claim.supplierOrderId,
            paymentClaimStatus: previousClaimStatus,
          },
          data: { paymentClaimStatus: nextClaimStatus },
        });
        if (orderUpdated.count === 0) {
          // The order already moved away from the expected previous claim state;
          // that is acceptable (for example a prior related change), but we still
          // ensure the claim write above is the authoritative one for this
          // dispute-resolution attempt.
        }
      }
    }

    await auditCritical(
      {
        actorProfileId: viewer.profile.id,
        actorRole: ROLE.MEDIATOR,
        action: AUDIT.DISPUTE_RESOLVED,
        entityType: "Dispute",
        entityId: disputeId,
        metadata: { outcome: input.outcome, status: input.status },
      },
      { client: tx },
    );

    return { id: disputeId, status: input.status };
  });

  return updated;
}
