import { route, readBody, json } from "@/lib/api";
import { stockDecisionSchema } from "@/lib/validation";
import { requireSupplier } from "@/lib/auth/rbac";
import { confirmStock } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

/** Per-order stock confirmation: the supplier answers line by line. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireSupplier();
  const { id } = await ctx.params;
  const input = await readBody(request, stockDecisionSchema);
  const order = await confirmStock(auth.supplierProfileId, auth.profile.id, id, input);
  return json({ order });
});
