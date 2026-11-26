import { route, json, notFound } from "@/lib/api";
import { getAuthContext } from "@/lib/auth/session";
import {
  getPublicListingBySlug,
  priceDenyMessage,
  resolveResellerPrice,
} from "@/server/price-access";
import { clientIpHash } from "@/lib/auth/session";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Listing detail. The public payload is fetched with an explicit public-only
 * select. Reseller pricing is a SEPARATE server-side decision per request, and
 * the key is omitted entirely when the caller is not entitled to it.
 */
export const GET = route(async (request: Request, ctx: Ctx) => {
  const { slug } = await ctx.params;
  const listing = await getPublicListingBySlug(slug);
  if (!listing) throw notFound("Listing not found");

  const auth = await getAuthContext();
  let resellerPrice:
    | { allowed: false; reason: string; message: string }
    | { allowed: true; terms: unknown; source: string } = {
    allowed: false,
    reason: "NO_SESSION",
    message: priceDenyMessage("NO_SESSION"),
  };

  if (listing.offer) {
    const access = await resolveResellerPrice({
      offerId: listing.offer.id,
      viewer: auth
        ? {
            profileId: auth.profile.id,
            roles: auth.roles,
            isPlatformAdmin: auth.user.isPlatformAdmin,
          }
        : null,
      ipHash: clientIpHash(request),
      auditDenials: false,
    });

    resellerPrice = access.allowed
      ? { allowed: true, terms: access.terms, source: access.source }
      : { allowed: false, reason: access.reason, message: priceDenyMessage(access.reason) };
  }

  return json({
    listing: {
      ...listing,
      images: parseImages(listing.imagesJson),
      imagesJson: undefined,
      hasPrivateOffer: Boolean(listing.offer),
    },
    resellerPrice,
  });
});

function parseImages(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}
