import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getResellerOverview } from "@/server/supplier";
import { formatMoney } from "@/lib/money";
import { Badge, Empty, SectionCard, Stat } from "@/components/ui";
import { AcceptAgreementButton, ActivateResellerButton } from "@/components/marketplace-actions";

export const dynamic = "force-dynamic";

export default async function ResellerPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  if (!ctx.roles.includes("RESELLER")) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Resell</h1>
            <p>Buy from suppliers at private prices and sell at your own.</p>
          </div>
        </div>
        <SectionCard title="Enable reseller tools" sub="Your business workspace stays exactly as it is">
          <p className="tiny muted" style={{ marginBottom: 12 }}>
            Reselling is an extra role on the same account. You apply to individual suppliers; they approve you
            per offer, and you accept their terms before any private price appears.
          </p>
          <ActivateResellerButton />
        </SectionCard>
      </>
    );
  }

  const overview = await getResellerOverview(ctx.profile.id);
  const activeAgreements = overview.agreements.filter((a) => a.status === "ACTIVE");
  const pendingAgreements = overview.agreements.filter((a) => a.status === "PENDING_ACCEPTANCE");

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Resell</h1>
          <p>Your supplier agreements and orders.</p>
        </div>
        <Link className="btn btn-sm" href="/marketplace">
          Browse
        </Link>
      </div>

      <div className="stats">
        <Stat label="Agreements" value={String(activeAgreements.length)} note="Active" />
        <Stat label="To accept" value={String(pendingAgreements.length)} note="Needs you" />
        <Stat label="Applications" value={String(overview.applications.length)} />
        <Stat label="Orders" value={String(overview.orders.length)} />
      </div>

      {pendingAgreements.length > 0 ? (
        <div className="mt-16">
          <SectionCard title="Agreements awaiting your acceptance" sub="No price is visible until you accept">
            <div className="stack">
              {pendingAgreements.map((agreement) => (
                <div key={agreement.id} className="card" style={{ boxShadow: "none" }}>
                  <div className="row-between">
                    <div>
                      <div className="list-title">{agreement.offer.listing.title}</div>
                      <div className="list-meta">
                        {agreement.supplierProfile.businessName} · v{agreement.currentVersion?.version ?? "—"}
                      </div>
                    </div>
                    {agreement.currentVersion ? (
                      <div className="money">{formatMoney(agreement.currentVersion.resellerPriceKobo)}</div>
                    ) : null}
                  </div>
                  <div className="mt-12">
                    <AcceptAgreementButton agreementId={agreement.id} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      ) : null}

      <div className="mt-16">
        <SectionCard title="Active agreements" sub="Your locked prices">
          {activeAgreements.length === 0 ? (
            <Empty>
              No active agreements yet. Apply to a supplier from the <Link href="/marketplace">marketplace</Link>.
            </Empty>
          ) : (
            <div className="list">
              {activeAgreements.map((agreement) => (
                <div className="list-item" key={agreement.id}>
                  <div className="grow">
                    <div className="list-title">{agreement.offer.listing.title}</div>
                    <div className="list-meta">
                      {agreement.supplierProfile.businessName} · v{agreement.currentVersion?.version ?? "—"} · MOQ{" "}
                      {agreement.currentVersion?.moq ?? "—"}
                    </div>
                  </div>
                  <div className="list-right">
                    <div className="money">
                      {agreement.currentVersion
                        ? formatMoney(agreement.currentVersion.resellerPriceKobo)
                        : "—"}
                    </div>
                    <div className="tiny muted mt-12">
                      {agreement.currentVersion?.minResalePriceKobo
                        ? `min resale ${formatMoney(agreement.currentVersion.minResalePriceKobo)}`
                        : "no min resale"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Supplier orders">
          {overview.orders.length === 0 ? (
            <Empty>No supplier orders yet.</Empty>
          ) : (
            <div className="list">
              {overview.orders.map((order) => (
                <Link className="list-item" href={`/supplier/orders/${order.id}`} key={order.id}>
                  <div className="grow">
                    <div className="list-title">{order.orderNumber}</div>
                    <div className="list-meta">
                      {order.supplierProfile.businessName} ·{" "}
                      {order.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                    </div>
                  </div>
                  <div className="list-right">
                    <div className="money">{formatMoney(order.totalKobo, order.currency)}</div>
                    <div className="mt-12">
                      <Badge status={order.status} />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Applications">
          {overview.applications.length === 0 ? (
            <Empty>No applications sent.</Empty>
          ) : (
            <div className="list">
              {overview.applications.map((application) => (
                <div className="list-item" key={application.id}>
                  <div className="grow">
                    <div className="list-title">{application.supplierProfile.businessName}</div>
                    <div className="list-meta">
                      {application.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })}
                      {application.decisionNote ? ` · ${application.decisionNote}` : ""}
                    </div>
                  </div>
                  <Badge status={application.status} />
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </>
  );
}
