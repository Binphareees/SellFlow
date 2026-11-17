import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { isMediator } from "@/lib/auth/rbac";
import { getDispute } from "@/server/disputes";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import {
  DISPUTE_REASON_LABEL,
  PAYMENT_METHOD_LABEL,
  type DisputeReason,
  type PaymentMethod,
} from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import { BackLink, Badge, SectionCard } from "@/components/ui";
import { DisputeMediatorPanel, DisputeMessageForm } from "@/components/dispute-actions";

export const dynamic = "force-dynamic";

const OUTCOME_LABEL: Record<string, string> = {
  RESELLER_FAVOUR: "Decided in favour of the reseller",
  SUPPLIER_FAVOUR: "Decided in favour of the supplier",
  MUTUAL: "Settled between both sides",
  NO_ACTION: "No action needed",
};

const EVENT_LABEL: Record<string, string> = {
  MESSAGE: "message",
  EVIDENCE: "evidence",
  STATUS_CHANGE: "status",
  OUTCOME: "decision",
  ASSIGNMENT: "assigned",
};

export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const { id } = await params;

  let dispute;
  try {
    dispute = await getDispute(id, ctx);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) notFound();
    throw error;
  }

  const mediator = isMediator(ctx);
  const actorIds = [...new Set(dispute.events.map((event) => event.actorProfileId).filter(Boolean))] as string[];
  const actors = await prisma.profile.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, displayName: true },
  });
  const nameOf = new Map(actors.map((actor) => [actor.id, actor.displayName]));

  const closed = dispute.status === "CLOSED" || dispute.status === "RESOLVED";

  return (
    <>
      <BackLink href="/disputes">Disputes</BackLink>

      <div className="page-head">
        <div>
          <h1>{dispute.reference}</h1>
          <p>
            {DISPUTE_REASON_LABEL[dispute.reason as DisputeReason] ?? dispute.reason}
            {dispute.supplierOrder ? ` · ${dispute.supplierOrder.orderNumber}` : ""}
          </p>
        </div>
        <Badge status={dispute.status} />
      </div>

      <div className="card">
        <p>{dispute.description}</p>
        <div className="row-between mt-12">
          <span className="tiny muted">
            Raised by {nameOf.get(dispute.raisedByProfileId) ?? dispute.raisedByRole.toLowerCase()}
          </span>
          <span className="tiny muted">
            {dispute.createdAt.toLocaleString("en-NG", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>

      {dispute.supplierOrder ? (
        <div className="mt-12">
          <SectionCard title="Order in question" sub="Both orders stay connected">
            <Link className="list-item" href={`/supplier/orders/${dispute.supplierOrder.id}`}>
              <div className="grow">
                <div className="list-title">{dispute.supplierOrder.orderNumber}</div>
                <div className="list-meta">
                  {dispute.supplierOrder.resellerProfile.displayName} ↔{" "}
                  {dispute.supplierOrder.supplierProfile.businessName}
                </div>
              </div>
              <div className="list-right">
                <div className="money">{formatMoney(dispute.supplierOrder.totalKobo)}</div>
                <div className="mt-12">
                  <Badge status={dispute.supplierOrder.status} />
                </div>
              </div>
            </Link>

            {dispute.supplierOrder.disputes.length > 1 ? (
              <p className="tiny muted mt-12">
                Other disputes on this order:{" "}
                {dispute.supplierOrder.disputes
                  .filter((other) => other.id !== dispute.id)
                  .map((other) => (
                    <Link key={other.id} href={`/disputes/${other.id}`} style={{ marginRight: 8 }}>
                      {other.reference}
                    </Link>
                  ))}
              </p>
            ) : null}
          </SectionCard>
        </div>
      ) : null}

      {dispute.claim ? (
        <div className="mt-12">
          <SectionCard title="Payment claim in question" sub="Recorded by a party, never verified by SellFlow">
            <div className="row-between">
              <div>
                <div className="money">{formatMoney(dispute.claim.amountKobo)}</div>
                <div className="list-meta">
                  {PAYMENT_METHOD_LABEL[dispute.claim.method as PaymentMethod] ?? dispute.claim.method}
                  {dispute.claim.reference ? ` · ${dispute.claim.reference}` : ""}
                </div>
              </div>
              <Badge status={dispute.claim.status === "SENT" ? "PENDING" : dispute.claim.status} />
            </div>
            <p className="tiny muted mt-12">
              Marked {dispute.claim.status.toLowerCase()} by the {dispute.claim.claimedByRole.toLowerCase()}.
            </p>
          </SectionCard>
        </div>
      ) : null}

      {dispute.outcome ? (
        <div className="notice-info mt-12">
          <strong>{OUTCOME_LABEL[dispute.outcome] ?? dispute.outcome}</strong>
          {dispute.resolutionNote ? <div className="tiny mt-12">{dispute.resolutionNote}</div> : null}
        </div>
      ) : null}

      <div className="mt-16">
        <SectionCard title="Audit trail" sub="Append-only; nothing here can be edited">
          <div className="timeline">
            {dispute.events.map((event) => (
              <div className="timeline-item" key={event.id}>
                <span className={`timeline-dot ${event.type === "OUTCOME" ? "" : "is-muted"}`} />
                <div className="grow">
                  <div className="row-between">
                    <span className="tiny" style={{ fontWeight: 600 }}>
                      {nameOf.get(event.actorProfileId ?? "") ?? "SellFlow"} ·{" "}
                      {EVENT_LABEL[event.type] ?? event.type.toLowerCase()}
                    </span>
                    <span className="list-meta">
                      {event.createdAt.toLocaleString("en-NG", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  {event.body ? <p className="tiny muted">{event.body}</p> : null}
                </div>
              </div>
            ))}
          </div>

          {!closed ? (
            <div className="mt-16" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
              <DisputeMessageForm disputeId={dispute.id} />
            </div>
          ) : null}
        </SectionCard>
      </div>

      {mediator ? (
        <div className="mt-16">
          <SectionCard
            title="Mediator desk"
            sub={
              dispute.assignedMediatorProfileId
                ? "A mediator is assigned to this case"
                : "Platform mediators only — your name is attached to every action"
            }
          >
            <DisputeMediatorPanel
              disputeId={dispute.id}
              status={dispute.status}
              outcome={dispute.outcome}
            />
          </SectionCard>
        </div>
      ) : null}

      <div className="mt-16">
        <Link className="btn btn-sm" href="/disputes">
          ← Back to all disputes
        </Link>
      </div>
    </>
  );
}
