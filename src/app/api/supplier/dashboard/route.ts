import { route, json } from "@/lib/api";
import { requireSupplier } from "@/lib/auth/rbac";
import { getSupplierDashboard } from "@/server/supplier";

export const GET = route(async () => {
  const auth = await requireSupplier();
  const dashboard = await getSupplierDashboard(auth.supplierProfileId);
  return json(dashboard);
});
