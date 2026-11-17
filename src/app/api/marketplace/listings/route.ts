import { route, json } from "@/lib/api";
import { getAuthContext } from "@/lib/auth/session";
import { ROLE } from "@/lib/enums";
import {
  LISTING_SORTS,
  countPublicListings,
  listPublicListings,
  type ListingSort,
  type StockFilter,
} from "@/server/price-access";

function intParam(value: string | null): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stockParam(value: string | null): StockFilter {
  return value === "in" || value === "out" ? value : "all";
}

function sortParam(value: string | null): ListingSort {
  return value && (LISTING_SORTS as string[]).includes(value) ? (value as ListingSort) : "newest";
}

/**
 * Public marketplace discovery.
 *
 * Filters are public-only: category, retail price band, stock and search text.
 * No query parameter here can reach a reseller price — listPublicListings selects
 * no such column, and the price endpoint is the only reader (price-access.ts).
 */
export const GET = route(async (request: Request) => {
  const params = new URL(request.url).searchParams;

  const filters = {
    q: params.get("q")?.trim().slice(0, 80) || undefined,
    category: params.get("category")?.trim() || undefined,
    supplierId: params.get("supplierId")?.trim() || undefined,
    minPriceKobo: intParam(params.get("minPriceKobo")),
    maxPriceKobo: intParam(params.get("maxPriceKobo")),
    stock: stockParam(params.get("stock")),
    sort: sortParam(params.get("sort")),
    limit: intParam(params.get("limit")),
    offset: intParam(params.get("offset")),
  };

  const [listings, total] = await Promise.all([
    listPublicListings(filters),
    countPublicListings(filters),
  ]);

  const ctx = await getAuthContext();

  return json({
    filters,
    total,
    listings: listings.map((listing) => ({
      ...listing,
      images: safeImages(listing.imagesJson),
      imagesJson: undefined,
      hasPrivateOffer: Boolean(listing.offer),
      viewer: {
        signedIn: Boolean(ctx),
        isReseller: Boolean(ctx?.roles.includes(ROLE.RESELLER)),
      },
    })),
  });
});

function safeImages(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}
