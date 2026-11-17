import { route, json } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth/rbac";
import { getDashboard } from "@/server/workspace";

export const GET = route(async () => {
  const ctx = await requireWorkspace();
  const dashboard = await getDashboard(ctx.workspaceId);
  return json(dashboard);
});
