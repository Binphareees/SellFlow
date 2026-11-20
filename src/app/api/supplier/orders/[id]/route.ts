import { route, readBody, json } from "@/lib/api";
import { supplierOrderStatusSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import { requireSupplier, isMediator } from "@/lib/auth/rbac";
import { getSupplierOrder, setSupplierOrderStatus } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

/** Either party on the order (or a moderator) may read it; the service checks. */
export const GET = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const order = await getSupplierOrder(id, auth.profile.id, auth.roles);
  return json({ order });
});

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireSupplier();
  const { id } = await ctx.params;
  const input = await readBody(request, supplierOrderStatusSchema);
  const isAdmin = auth.user.isPlatformAdmin || isMediator(auth);
  const order = await setSupplierOrderStatus(
    auth.supplierProfileId,
    auth.profile.id,
    id,
    input.status,
    input.note ?? null,
    isAdmin,
  );
  return json({ order });
});
