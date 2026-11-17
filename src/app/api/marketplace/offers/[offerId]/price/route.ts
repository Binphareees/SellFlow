import { route, json, forbidden, notFound } from "@/lib/api";
import { getAuthContext } from "@/lib/auth/session";
import { clientIpHash } from "@/lib/auth/session";
import { priceDenyMessage, resolveResellerPrice } from "@/server/price-access";

type Ctx = { params: Promise<{ offerId: string }> };

/**
 * Dedicated private-price endpoint.
 *
 * The rule is enforced here and in resolveResellerPrice — not in the UI. An
 * unauthorised caller gets 403 with a reason code and an audited denial; the
 * price is never serialised into the response.
 */
export const GET = route(async (request: Request, ctx: Ctx) => {
  const { offerId } = await ctx.params;
  const auth = await getAuthContext();

  const access = await resolveResellerPrice({
    offerId,
    viewer: auth
      ? {
          profileId: auth.profile.id,
          roles: auth.roles,
          isPlatformAdmin: auth.user.isPlatformAdmin,
        }
      : null,
    ipHash: clientIpHash(request),
  });

  if (!access.allowed) {
    if (access.reason === "NOT_FOUND") throw notFound("Offer not found");
    throw forbidden(priceDenyMessage(access.reason));
  }

  return json({
    offerId: access.offerId,
    listingId: access.listingId,
    source: access.source,
    agreementVersion: access.agreementVersion,
    terms: access.terms,
  });
});
