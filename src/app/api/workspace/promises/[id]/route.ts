import { route, readBody, json } from "@/lib/api";
import { promiseResolveSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { resolvePromise } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  const input = await readBody(request, promiseResolveSchema);
  const promise = await resolvePromise(auth.workspaceId, id, auth.profile.id, input.status);
  return json({ promise });
});
