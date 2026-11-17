import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { VERIFICATION_LABEL } from "@/lib/enums";
import { getPublicSupplier, listPublicListings } from "@/server/price-access";
import { ApplyToSupplier } from "@/components/marketplace-actions";
import { BackLink, SectionCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SupplierStorefrontPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [supplier, listings] = await Promise.all([
    getPublicSupplier(id),
    listPublicListings({ supplierId: id, limit: 36 }),
  ]);
  if (!supplier) notFound();

  const ctx = await getAuthContext();
  const application = ctx
    ? await prisma.resellerApplication.findUnique({
        where: {
          supplierProfileId_resellerProfileId: {
            supplierProfileId: supplier.id,
            resellerProfileId: ctx.profile.id,
          },
        },
        select: { status: true, createdAt: true },
      })
    : null;

  return (
    <>
      <BackLink href="/marketplace/suppliers">Suppliers</BackLink>

      <div className="supplier-head card">
        <div className="supplier-badge is-large" aria-hidden>
          {supplier.businessName.slice(0, 1).toUpperCase()}
        </div>
        <div className="grow">
          <h1 style={{ fontSize: "1.3rem" }}>{supplier.businessName}</h1>
          <p className="tiny muted">
            {[supplier.city, supplier.state].filter(Boolean).join(", ") || "Location not set"}
            {supplier.verificationTier > 0
              ? ` · ${VERIFICATION_LABEL[supplier.verificationTier]}`
              : " · Not yet verified"}
          </p>
          <p className="tiny muted">
            {supplier.publishedListings} published listing{supplier.publishedListings === 1 ? "" : "s"} · on
            SellFlow since{" "}
            {supplier.createdAt.toLocaleDateString("en-NG", { month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      {supplier.about ? <p className="tiny muted mt-12">{supplier.about}</p> : null}

      {supplier.categories.length > 0 ? (
        <div className="chips mt-12" aria-label="Categories">
          {supplier.categories.map((category) => (
            <Link
              className="chip"
              key={category}
              href={`/marketplace?category=${encodeURIComponent(category)}`}
            >
              {category}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-16" id="apply">
        <SectionCard
          title="Reseller agreement"
          sub="Approval is per supplier, and your price only appears once both sides accept terms"
        >
          {!ctx ? (
            <Link className="btn btn-primary" href={`/login?next=/marketplace/suppliers/${supplier.id}`}>
              Sign in to apply
            </Link>
          ) : application?.status === "APPROVED" ? (
            <div className="form-ok">
              You are approved with this supplier. Prices appear on each listing you have an active
              agreement for — check <Link href="/reseller">your reseller page</Link>.
            </div>
          ) : application?.status === "PENDING" ? (
            <p className="tiny muted">
              Your application was sent{" "}
              {application.createdAt.toLocaleDateString("en-NG", { day: "numeric", month: "short" })} and is
              waiting for the supplier.
            </p>
          ) : (
            <>
              {application?.status === "REJECTED" ? (
                <p className="notice mb-12">
                  Your last application was not approved. You can send an updated one.
                </p>
              ) : null}
              <ApplyToSupplier supplierProfileId={supplier.id} />
            </>
          )}
        </SectionCard>
      </div>

      <h2 className="mt-16" style={{ fontSize: "1rem" }}>
        Catalogue
      </h2>

      {listings.length === 0 ? (
        <p className="tiny muted mt-12">This supplier has no published listings right now.</p>
      ) : (
        <div className="listing-grid mt-12">
          {listings.map((listing) => {
            const images = parseImages(listing.imagesJson);
            return (
              <Link className="card listing-card" href={`/marketplace/${listing.slug}`} key={listing.id}>
                <div className="listing-thumb">
                  {images[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={images[0]} alt="" />
                  ) : (
                    <span>{listing.category ?? "Product"}</span>
                  )}
                </div>
                <div>
                  <div className="list-title">{listing.title}</div>
                  <div className="list-meta">
                    {listing.category ?? "Uncategorised"} · MOQ {listing.moq}
                  </div>
                </div>
                <div className="row-between">
                  <div className="money">{formatMoney(listing.publicPriceKobo, listing.currency)}</div>
                  <span className={`badge ${listing.stockQty > 0 ? "badge-good" : "badge-warn"}`}>
                    {listing.stockQty > 0 ? `${listing.stockQty} in stock` : "Sold out"}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <p className="tiny muted mt-16">
        Retail prices are public. A reseller price is never included on this page — it is resolved per
        request, only for approved resellers with an active agreement.
      </p>
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
