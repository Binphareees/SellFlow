import { route, json } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth/rbac";
import { getBillingSummary } from "@/lib/subscription";

/** Current plan, usage against its caps, and the manual upgrade history. */
export const GET = route(async () => {
  const auth = await requireWorkspace();
  const summary = await getBillingSummary(auth.workspaceId);
  return json(summary);
});
