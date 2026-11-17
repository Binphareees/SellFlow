import { route, readBody, json } from "@/lib/api";
import { promiseCreateSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { addPromise } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  const input = await readBody(request, promiseCreateSchema);
  const promise = await addPromise(auth.workspaceId, id, auth.profile.id, input);
  return json({ promise }, 201);
});
