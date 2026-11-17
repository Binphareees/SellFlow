import { route, readBody, json } from "@/lib/api";
import { productCreateSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import { createProduct, listProducts } from "@/server/workspace";

export const GET = route(async () => {
  const ctx = await requireWorkspace();
  const products = await listProducts(ctx.workspaceId);
  return json({ products });
});

export const POST = route(async (request: Request) => {
  const ctx = await requireWorkspace();
  const input = await readBody(request, productCreateSchema);
  const product = await createProduct(ctx.workspaceId, input);
  return json({ product }, 201);
});
