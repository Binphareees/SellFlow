import { route, readBody, json, forbidden, notFound } from "@/lib/api";
import { supplierOrderStatusSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import { requireSupplier, isMediator } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
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
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const input = await readBody(request, supplierOrderStatusSchema);
  const isAdmin = auth.user.isPlatformAdmin || isMediator(auth);

  // Non-admin/non-mediator callers must be a supplier with a profile.
  let supplierProfileId = auth.supplierProfileId;
  if (!isAdmin) {
    const supplierAuth = await requireSupplier();
    supplierProfileId = supplierAuth.supplierProfileId;
    if (supplierAuth.profile.id !== auth.profile.id) {
      throw forbidden();
    }
  } else if (!supplierProfileId) {
    // Mediator/admin cancellation path (D5): resolve the supplier profile from
    // the order itself, since the caller may not own a supplier profile.
    const order = await prisma.supplierOrder.findUnique({
      where: { id },
      select: { supplierProfileId: true },
    });
    if (!order) throw notFound("Supplier order not found");
    supplierProfileId = order.supplierProfileId;
  }

  if (!supplierProfileId) {
    throw forbidden("Create your supplier profile before using supplier tools");
  }

  const order = await setSupplierOrderStatus(
    supplierProfileId,
    auth.profile.id,
    id,
    input.status,
    input.note ?? null,
    isAdmin,
  );
  return json({ order });
});