import { route, readBody, json } from "@/lib/api";
import { claimCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import { recordPaymentClaim } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Party-recorded payment status. "Marked as sent by reseller" lands here.
 * SellFlow does not verify money — the other party confirms or disputes it.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const input = await readBody(request, claimCreateSchema);
  const claim = await recordPaymentClaim(id, auth.profile.id, auth.roles, input);
  return json({ claim }, 201);
});
