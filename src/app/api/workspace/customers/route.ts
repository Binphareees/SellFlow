import { route, readBody, json } from "@/lib/api";
import { customerCreateSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { createCustomer, listCustomers } from "@/server/workspace";

export const GET = route(async (request: Request) => {
  const ctx = await requireWorkspace();
  const q = new URL(request.url).searchParams.get("q") ?? undefined;
  const customers = await listCustomers(ctx.workspaceId, q);
  return json({ customers });
});

export const POST = route(async (request: Request) => {
  const ctx = await requireWorkspace();
  const input = await readBody(request, customerCreateSchema);
  const customer = await createCustomer(ctx.workspaceId, ctx.profile.id, input);
  return json({ customer }, 201);
});
