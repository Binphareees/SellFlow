import { route, readBody, json } from "@/lib/api";
import { orderUpdateSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { getOrder, updateOrderStatus } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  const order = await getOrder(auth.workspaceId, id);
  return json({ order });
});

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  const input = await readBody(request, orderUpdateSchema);
  if (!input.status) return json({ order: await getOrder(auth.workspaceId, id) });
  await updateOrderStatus(auth.workspaceId, id, auth.profile.id, input.status);
  return json({ order: await getOrder(auth.workspaceId, id) });
});
