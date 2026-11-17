import { route, readBody, json } from "@/lib/api";
import { customerUpdateSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { softDeleteCustomer, updateCustomer } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  const input = await readBody(request, customerUpdateSchema);
  const customer = await updateCustomer(auth.workspaceId, id, input);
  return json({ customer });
});

export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  await softDeleteCustomer(auth.workspaceId, id);
  return json({ ok: true });
});
