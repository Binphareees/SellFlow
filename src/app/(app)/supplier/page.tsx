import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupplierDashboard } from "@/server/supplier";
import { formatMoney, formatMoneyShort } from "@/lib/money";
import { Badge, Empty, SectionCard, Stat } from "@/components/ui";
import { ApplicationDecision, ListingForm, OfferPriceForm, SupplierProfileForm } from "@/components/supplier-actions";

export const dynamic = "force-dynamic";

export default async function SupplierPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");

  if (!ctx.supplierProfileId) {
    return (
      <>
        <div className="page-head">
          <div>
            <h1>Sell to resellers</h1>
            <p>Turn on supplier tools to publish listings and approve resellers.</p>
          </div>
        </div>
        <SectionCard title="Supplier profile" sub="This is what resellers see in the marketplace">
          <SupplierProfileForm />
        </SectionCard>
      </>
    );
  }

  const data = await getSupplierDashboard(ctx.supplierProfileId);
  const pendingApplications = data.applications.filter((a) => a.status === "PENDING");
  const offerOptions = data.listings
    .filter((listing) => listing.offer)
    .map((listing) => ({ id: listing.offer!.id, label: `${listing.title} — v${listing.offer!.currentVersion?.version ?? 1}` }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Supplier</h1>
          <p>Offers, applications and incoming orders.</p>
        </div>
      </div>

      <div className="stats">
        <Stat label="Listings" value={String(data.stats.listingCount)} />
        <Stat label="Applications" value={String(data.stats.pendingApplications)} note="Waiting on you" />
        <Stat label="To confirm" value={String(data.stats.pendingStock)} note="Stock checks" />
        <Stat label="Order value" value={formatMoneyShort(data.stats.gmvKobo)} note="All time" />
      </div>

      <div className="mt-16">
        <SectionCard title="Reseller applications" sub="Approval unlocks one offer, not your whole catalogue">
          {pendingApplications.length === 0 ? (
            <Empty>No pending applications.</Empty>
          ) : (
            <div className="stack">
              {pendingApplications.map((application) => (
                <div key={application.id} className="card" style={{ boxShadow: "none" }}>
                  <div className="row-between">
                    <div>
                      <div className="list-title">{application.resellerProfile.displayName}</div>
                      <div className="list-meta">
                        Tier {application.resellerProfile.verificationTier} ·{" "}
                        {application.resellerProfile.phone ?? "no phone"}
                      </div>
                    </div>
                    <Badge status={application.status} />
                  </div>
                  {application.message ? <p className="tiny muted mt-12">“{application.message}”</p> : null}
                  <div className="mt-12">
                    <ApplicationDecision applicationId={application.id} offers={offerOptions} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Your listings" sub="Public price is visible to everyone; reseller price is not">
          {data.listings.length === 0 ? (
            <Empty>No listings yet. Publish your first below.</Empty>
          ) : (
            <div className="stack">
              {data.listings.map((listing) => (
                <div key={listing.id} className="card" style={{ boxShadow: "none" }}>
                  <div className="row-between">
                    <div className="grow">
                      <div className="list-title">{listing.title}</div>
                      <div className="list-meta">
                        Public {formatMoney(listing.publicPriceKobo, listing.currency)} · stock {listing.stockQty} · MOQ{" "}
                        {listing.moq}
                      </div>
                    </div>
                    <Badge status={listing.isPublished ? "ACTIVE" : "DRAFT"} />
                  </div>

                  {listing.offer ? (
                    <>
                      <div className="row-between mt-12">
                        <div className="tiny muted">
                          Reseller price v{listing.offer.currentVersion?.version ?? "—"} ·{" "}
                          {listing.offer.status.toLowerCase()}
                        </div>
                        <div className="money">
                          {listing.offer.currentVersion
                            ? formatMoney(listing.offer.currentVersion.resellerPriceKobo, listing.currency)
                            : "—"}
                        </div>
                      </div>
                      {listing.offer.currentVersion ? (
                        <div className="mt-12">
                          <OfferPriceForm
                            offerId={listing.offer.id}
                            current={{
                              resellerPriceKobo: listing.offer.currentVersion.resellerPriceKobo,
                              minResalePriceKobo: listing.offer.currentVersion.minResalePriceKobo,
                              moq: listing.offer.currentVersion.moq,
                              commissionType: listing.offer.currentVersion.commissionType,
                              commissionValue: listing.offer.currentVersion.commissionValue,
                              paymentTermsDays: listing.offer.currentVersion.paymentTermsDays,
                              deliveryResponsibility: listing.offer.currentVersion.deliveryResponsibility,
                              advertisingPermission: listing.offer.currentVersion.advertisingPermission,
                              customerDataVisibility: listing.offer.currentVersion.customerDataVisibility,
                            }}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <p className="tiny muted mt-12">No reseller offer on this listing.</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard
          title="Incoming orders"
          sub="Confirm stock, then dispatch"
          action={
            <Link className="btn btn-sm btn-ghost" href="/dashboard/orders">
              Customer orders
            </Link>
          }
        >
          {data.orders.length === 0 ? (
            <Empty>No reseller orders yet.</Empty>
          ) : (
            <div className="list">
              {data.orders.map((order) => (
                <Link className="list-item" href={`/supplier/orders/${order.id}`} key={order.id}>
                  <div className="grow">
                    <div className="list-title">{order.orderNumber}</div>
                    <div className="list-meta">
                      {order.resellerProfile.displayName} · {order._count.items} item
                      {order._count.items === 1 ? "" : "s"}
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
        <SectionCard title="Agreements" sub="Versioned; old orders keep their old price">
          {data.agreements.length === 0 ? (
            <Empty>No agreements yet.</Empty>
          ) : (
            <div className="list">
              {data.agreements.map((agreement) => (
                <div className="list-item" key={agreement.id}>
                  <div className="grow">
                    <div className="list-title">{agreement.resellerProfile.displayName}</div>
                    <div className="list-meta">
                      {agreement.offer.listing.title} · v{agreement.currentVersion?.version ?? "—"}
                    </div>
                  </div>
                  <div className="list-right">
                    <Badge status={agreement.status} />
                    <div className="tiny muted mt-12">
                      {agreement.currentVersion
                        ? formatMoney(agreement.currentVersion.resellerPriceKobo)
                        : "—"}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-16">
        <SectionCard title="Publish a listing">
          <ListingForm />
        </SectionCard>
      </div>
    </>
  );
}
