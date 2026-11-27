import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import {
  getPublicListingBySlug,
  priceDenyMessage,
  resolveResellerPrice,
} from "@/server/price-access";
import { listOrders } from "@/server/workspace";
import { BackLink, Badge, SectionCard } from "@/components/ui";
import { ApplyToSupplier, PlaceSupplierOrderForm } from "@/components/marketplace-actions";

export const dynamic = "force-dynamic";

export default async function ListingDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await getPublicListingBySlug(slug);
  if (!listing) notFound();

  const ctx = await getAuthContext();
  const images = parseImages(listing.imagesJson);

  // The private price decision is made here, on the server, per request.
  const access = listing.offer
    ? await resolveResellerPrice({
        offerId: listing.offer.id,
        viewer: ctx
          ? {
              profileId: ctx.profile.id,
              roles: ctx.roles,
              isPlatformAdmin: ctx.user.isPlatformAdmin,
            }
          : null,
        auditDenials: false,
      })
    : null;

  const application = ctx
    ? await prisma.resellerApplication.findUnique({
        where: {
          supplierProfileId_resellerProfileId: {
            supplierProfileId: listing.supplierProfile.id,
            resellerProfileId: ctx.profile.id,
          },
        },
        select: { status: true },
      })
    : null;

  const openOrders =
    ctx?.workspaceId && access?.allowed
      ? (await listOrders(ctx.workspaceId, { limit: 10 })).map((order) => ({
          id: order.id,
          label: `${order.orderNumber} — ${order.customer.name} (${formatMoney(order.balanceKobo, order.currency)} owing)`,
        }))
      : [];

  return (
    <>
      <BackLink href="/marketplace">Marketplace</BackLink>

      <div className="page-head">
        <div>
          <h1>{listing.title}</h1>
          <p>
            <Link href={`/marketplace/suppliers/${listing.supplierProfile.id}`}>
              {listing.supplierProfile.businessName}
            </Link>
            {listing.supplierProfile.verificationTier > 0
              ? ` · verification tier ${listing.supplierProfile.verificationTier}`
              : ""}
          </p>
        </div>
      </div>

      <div className="listing-thumb" style={{ marginBottom: 14, maxHeight: 260 }}>
        {images[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={images[0]} alt="" />
        ) : (
          <span>{listing.category ?? "Product"}</span>
        )}
      </div>

      <Link className="btn btn-sm" href={`/marketplace/suppliers/${listing.supplierProfile.id}`}>
        View supplier storefront
      </Link>

      <div className="card mt-12">
        <div className="row-between">
          <div>
            <div className="card-sub">Retail price (public)</div>
            <div className="money-lg">{formatMoney(listing.publicPriceKobo, listing.currency)}</div>
            <div className="tiny muted">
              Minimum order {listing.moq} · {listing.stockQty} in stock
            </div>
          </div>
        </div>
        {listing.description ? <p className="tiny muted mt-12">{listing.description}</p> : null}
      </div>

      <div className="mt-16">
        {!listing.offer ? (
          <SectionCard title="Reseller pricing">
            <p className="tiny muted">This supplier has not opened a reseller offer on this listing.</p>
          </SectionCard>
        ) : access?.allowed ? (
          <SectionCard
            title="Your reseller price"
            sub={
              access.source === "AGREEMENT"
                ? `Locked by agreement version ${access.agreementVersion}`
                : access.source === "SUPPLIER_OWNER"
                  ? "You own this listing"
                  : "Moderator view — this read was logged"
            }
          >
            <div className="money-lg paid">{formatMoney(access.terms.priceKobo, listing.currency)}</div>
            <div className="tiny muted">
              per unit · MOQ {access.terms.moq}
              {access.terms.minResaleKobo
                ? ` · minimum resale ${formatMoney(access.terms.minResaleKobo, listing.currency)}`
                : ""}
            </div>

            <div className="stack-sm mt-16">
              <div className="row wrap" style={{ gap: 6 }}>
                <Badge status="ACTIVE" />
                <span className="tiny muted">
                  {access.terms.deliveryResponsibility === "SUPPLIER" ? "Supplier delivers" : "You deliver"}
                  {access.terms.advertisingPermission ? " · ads allowed" : " · ads not permitted"}
                </span>
              </div>
              <p className="tiny muted">
                Customer data visible to supplier: {access.terms.customerDataVisibility.toLowerCase().replace("_", " ")}
              </p>
            </div>

            {access.source === "AGREEMENT" ? (
              <div className="mt-16" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
                <PlaceSupplierOrderForm
                  listingId={listing.id}
                  supplierProfileId={listing.supplierProfile.id}
                  moq={access.terms.moq}
                  resellerPriceKobo={access.terms.priceKobo}
                  minResaleKobo={access.terms.minResaleKobo}
                  customerOrders={openOrders}
                />
              </div>
            ) : null}
          </SectionCard>
        ) : (
          <SectionCard title="Reseller price is private">
            <div className="price-locked">
              <span aria-hidden>🔒</span>
              <span>{priceDenyMessage(access && !access.allowed ? access.reason : "NO_SESSION")}</span>
            </div>

            <div className="mt-16">
              {!ctx ? (
                <Link className="btn btn-primary" href={`/login?next=/marketplace/${listing.slug}`}>
                  Sign in to apply
                </Link>
              ) : application?.status === "APPROVED" ? (
                <p className="tiny muted">
                  You are approved for this supplier, but there is no active agreement on this offer yet.
                  Check <Link href="/reseller">your reseller page</Link>.
                </p>
              ) : application?.status === "PENDING" ? (
                <p className="tiny muted">Your application is pending with this supplier.</p>
              ) : (
                <ApplyToSupplier
                  supplierProfileId={listing.supplierProfile.id}
                  offerId={listing.offer.id}
                />
              )}
            </div>
          </SectionCard>
        )}
      </div>
    </>
  );
}

function parseImages(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}
