import { route, json } from "@/lib/api";
import { requireMediator } from "@/lib/auth/rbac";
import { getOrder, releaseHeldStock } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireMediator();
  const { id } = await ctx.params;
  const released = await releaseHeldStock(id, auth.profile.id, true);
  const order = await getOrder(released.workspaceId, id);
  return json({ order });
});
