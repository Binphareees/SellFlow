import { route, readBody, json } from "@/lib/api";
import { paymentCreateSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { addPayment, getOrder } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  const input = await readBody(request, paymentCreateSchema);
  const payment = await addPayment(auth.workspaceId, id, auth.profile.id, input);
  return json({ payment, order: await getOrder(auth.workspaceId, id) }, 201);
});
