import { route, readBody, json } from "@/lib/api";
import { orderCreateSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { createOrder, listOrders } from "@/server/workspace";

export const GET = route(async (request: Request) => {
  const ctx = await requireWorkspace();
  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? undefined;
  const payment = params.get("payment") as "UNPAID" | "PART_PAID" | "PAID" | null;

  const orders = await listOrders(ctx.workspaceId, {
    ...(status ? { status } : {}),
    ...(payment ? { payment } : {}),
  });
  return json({ orders });
});

export const POST = route(async (request: Request) => {
  const ctx = await requireWorkspace();
  const input = await readBody(request, orderCreateSchema);
  const order = await createOrder(ctx.workspaceId, ctx.profile.id, input);
  return json({ order }, 201);
});
