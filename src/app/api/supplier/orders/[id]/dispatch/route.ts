import { route, readBody, json } from "@/lib/api";
import { dispatchCreateSchema } from "@/lib/validation";
import { requireSupplier } from "@/lib/auth/rbac";
import { dispatchOrder } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireSupplier();
  const { id } = await ctx.params;
  const input = await readBody(request, dispatchCreateSchema);
  const dispatch = await dispatchOrder(auth.supplierProfileId, auth.profile.id, id, input);
  return json({ dispatch }, 201);
});
