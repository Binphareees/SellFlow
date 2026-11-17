import { route, readBody, json } from "@/lib/api";
import { offerTermsSchema } from "@/lib/validation";
import { requireSupplier } from "@/lib/auth/rbac";
import { addOfferVersion } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

/** Editing offer terms appends a version; orders keep the version they used. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireSupplier();
  const { id } = await ctx.params;
  const input = await readBody(request, offerTermsSchema);
  const version = await addOfferVersion(auth.supplierProfileId, auth.profile.id, id, input);
  return json({ version }, 201);
});
