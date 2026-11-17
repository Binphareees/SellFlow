import { route, readBody, json } from "@/lib/api";
import { applicationDecisionSchema } from "@/lib/validation";
import { requireSupplier } from "@/lib/auth/rbac";
import { decideApplication } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Approving a reseller creates a PENDING_ACCEPTANCE agreement for one offer.
 * The reseller must accept that version before private prices unlock.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireSupplier();
  const { id } = await ctx.params;
  const input = await readBody(request, applicationDecisionSchema);
  const result = await decideApplication(auth.supplierProfileId, auth.profile.id, id, input);
  return json(result);
});
