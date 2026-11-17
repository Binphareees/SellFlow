import { route, json, notFound } from "@/lib/api";
import { getPublicSupplier, listPublicListings } from "@/server/price-access";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const supplier = await getPublicSupplier(id);
  if (!supplier) throw notFound("Supplier not found");

  const listings = await listPublicListings({ supplierId: id, limit: 24 });

  return json({
    supplier,
    listings: listings.map((listing) => ({
      ...listing,
      imagesJson: undefined,
      hasPrivateOffer: Boolean(listing.offer),
    })),
  });
});
