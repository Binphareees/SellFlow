import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { isMediator } from "@/lib/auth/rbac";
import { disputeCounts, listDisputes } from "@/server/disputes";
import { DISPUTE_REASON_LABEL, DISPUTE_STATUS, isOneOf, type DisputeReason } from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import { Badge, Empty, SectionCard } from "@/components/ui";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "OPEN", label: "Open" },
  { key: "UNDER_REVIEW", label: "Under review" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
  { key: "ALL", label: "All" },
] as const;

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; scope?: string }>;
}) {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  const params = await searchParams;
  const active = isOneOf(DISPUTE_STATUS, params.status) ? params.status : "ALL";
  const moderator = isMediator(ctx);

  const [counts, disputes] = await Promise.all([
    disputeCounts(ctx),
    listDisputes(ctx, { status: active === "ALL" ? undefined : active }),
  ]);

  const openWork = counts.OPEN + counts.UNDER_REVIEW;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Disputes</h1>
          <p>
            {moderator
              ? openWork === 0
                ? "Nothing waiting on a decision right now."
                : `${openWork} case${openWork === 1 ? "" : "s"} still ${openWork === 1 ? "needs" : "need"} a decision.`
              : "Order problems, with a written trail both sides can see."}
          </p>
        </div>
        <Link className="btn btn-sm btn-primary" href="/disputes/new">
          + Raise
        </Link>
      </div>

      {moderator ? (
        <div className="notice-info">
          Mediator view: you can see every dispute on the platform, take one up for review and record an
          outcome. Your notes are permanent.
        </div>
      ) : null}

      <div className="chips mt-12" role="tablist" aria-label="Filter disputes">
        {FILTERS.map((filter) => {
          const count = filter.key === "ALL" ? counts.ALL : counts[filter.key] ?? 0;
          const href = filter.key === "ALL" ? "/disputes" : `/disputes?status=${filter.key}`;
          return (
            <Link
              className="chip"
              key={filter.key}
              href={href}
              data-active={active === filter.key}
              role="tab"
              aria-selected={active === filter.key}
            >
              {filter.label}
              {count > 0 ? ` · ${count}` : ""}
            </Link>
          );
        })}
      </div>

      <div className="mt-16">
        <SectionCard
          title={active === "ALL" ? "Every dispute" : `${FILTERS.find((f) => f.key === active)?.label} disputes`}
          sub="Newest first · the trail cannot be edited"
        >
          {disputes.length === 0 ? (
            <Empty>
              Nothing here.{" "}
              {active === "ALL" ? (
                <Link href="/disputes/new">Raise a dispute</Link>
              ) : (
                <Link href="/disputes">See all disputes</Link>
              )}
              .
            </Empty>
          ) : (
            <div className="list">
              {disputes.map((dispute) => (
                <Link className="list-item" href={`/disputes/${dispute.id}`} key={dispute.id}>
                  <div className="grow">
                    <div className="list-title">
                      {DISPUTE_REASON_LABEL[dispute.reason as DisputeReason] ?? dispute.reason}
                    </div>
                    <div className="list-meta">
                      {dispute.reference}
                      {dispute.supplierOrder ? ` · ${dispute.supplierOrder.orderNumber}` : ""}
                      {dispute.claim ? ` · claim ${formatMoney(dispute.claim.amountKobo)}` : ""}
                    </div>
                    <div className="list-meta">
                      {dispute._count.events} update{dispute._count.events === 1 ? "" : "s"} ·{" "}
                      {dispute.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                    </div>
                  </div>
                  <Badge status={dispute.status} />
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
