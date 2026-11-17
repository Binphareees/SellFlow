import { route, readBody, json } from "@/lib/api";
import { supplierOrderCreateSchema } from "@/lib/validation";
import { requireSupplier, requireRole } from "@/lib/auth/rbac";
import { createSupplierOrder, getSupplierDashboard } from "@/server/supplier";
import { prisma } from "@/lib/db";
import { ROLE } from "@/lib/enums";

export const GET = route(async () => {
  const auth = await requireSupplier();
  const orders = await prisma.supplierOrder.findMany({
    where: { supplierProfileId: auth.supplierProfileId },
    include: {
      resellerProfile: { select: { displayName: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return json({ orders });
});

/**
 * Reseller-facing order creation. The supplier is resolved from the offer, and
 * unit prices come from the agreement — never from this request body.
 */
export const POST = route(async (request: Request) => {
  const auth = await requireRole(ROLE.RESELLER);
  const input = await readBody(request, supplierOrderCreateSchema);
  const order = await createSupplierOrder(auth.profile.id, auth.roles, input);
  return json({ order }, 201);
});

export const dynamic = "force-dynamic";
