import { route, readBody, json } from "@/lib/api";
import { productCreateSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { updateProduct } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  const input = await readBody(request, productCreateSchema.partial());
  const product = await updateProduct(auth.workspaceId, id, input);
  return json({ product });
});
