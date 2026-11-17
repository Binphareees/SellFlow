import { route, json } from "@/lib/api";
import { requireReseller } from "@/lib/auth/rbac";
import { getResellerOverview } from "@/server/supplier";

export const GET = route(async () => {
  const auth = await requireReseller();
  const overview = await getResellerOverview(auth.profile.id);
  return json(overview);
});
