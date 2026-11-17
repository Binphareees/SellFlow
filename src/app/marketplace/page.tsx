import Link from "next/link";
import { getAuthContext } from "@/lib/auth/session";
import { countPublicListings, getListingCategories, listPublicListings } from "@/server/price-access";
import { MarketplaceDiscovery, type DiscoveryFilters, type DiscoveryListing } from "@/components/marketplace-discovery";

export const dynamic = "force-dynamic";

type SearchParams = {
  q?: string;
  category?: string;
  minPriceKobo?: string;
  maxPriceKobo?: string;
  stock?: string;
  sort?: string;
};

function toNumber(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

export default async function MarketplacePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const ctx = await getAuthContext();

  const filters: DiscoveryFilters = {
    q: params.q?.slice(0, 80) ?? "",
    category: params.category ?? "",
    minPriceKobo: toNumber(params.minPriceKobo),
    maxPriceKobo: toNumber(params.maxPriceKobo),
    stock: params.stock === "in" || params.stock === "out" ? params.stock : "all",
    sort:
      params.sort === "popular" || params.sort === "price_asc" || params.sort === "price_desc"
        ? params.sort
        : "newest",
  };

  const [listings, total, categories] = await Promise.all([
    listPublicListings({ ...filters, limit: 36 }),
    countPublicListings(filters),
    getListingCategories(),
  ]);

  const discovery: DiscoveryListing[] = listings.map((listing) => ({
    id: listing.id,
    slug: listing.slug,
    title: listing.title,
    category: listing.category,
    publicPriceKobo: listing.publicPriceKobo,
    currency: listing.currency,
    moq: listing.moq,
    stockQty: listing.stockQty,
    images: parseImages(listing.imagesJson),
    supplier: {
      id: listing.supplierProfile.id,
      businessName: listing.supplierProfile.businessName,
      city: listing.supplierProfile.city,
      tier: listing.supplierProfile.verificationTier,
    },
    offerId: listing.offer?.id ?? null,
  }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Marketplace</h1>
          <p>Supplier listings at retail price. Reseller prices need approval.</p>
        </div>
        <Link className="btn btn-sm" href="/marketplace/suppliers">
          Suppliers
        </Link>
      </div>

      <MarketplaceDiscovery
        listings={discovery}
        total={total}
        categories={categories}
        filters={filters}
        signedIn={Boolean(ctx)}
      />

      <p className="tiny muted mt-16">
        Public listings never show reseller pricing. That price is resolved per request on the server, and
        only for resellers with an approved application and an active agreement.
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
