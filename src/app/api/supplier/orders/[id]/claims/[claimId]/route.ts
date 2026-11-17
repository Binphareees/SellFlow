import { route, readBody, json } from "@/lib/api";
import { claimDecisionSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import { decidePaymentClaim } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string; claimId: string }> };

export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id, claimId } = await ctx.params;
  const input = await readBody(request, claimDecisionSchema);
  const result = await decidePaymentClaim(id, claimId, auth.profile.id, auth.roles, input);
  return json(result);
});
