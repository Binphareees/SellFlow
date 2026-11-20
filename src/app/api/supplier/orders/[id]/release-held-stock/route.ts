import { route, json } from "@/lib/api";
import { requireMediator } from "@/lib/auth/rbac";
import { releaseHeldSupplierStock } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireMediator();
  const { id } = await ctx.params;
  const order = await releaseHeldSupplierStock(id, auth.profile.id, true);
  return json({ order });
});
