import { route, json, ApiError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth/rbac";
import { getBillingSummary } from "@/lib/subscription";
import { subscriptionBillingEnabled } from "@/lib/plans";

/** Current plan, usage against its caps, and the manual upgrade history. */
export const GET = route(async () => {
  if (!subscriptionBillingEnabled()) throw new ApiError(404, "SUBSCRIPTION_BILLING_DISABLED", "Subscription billing is not enabled in V1");
  const auth = await requireWorkspace();
  const summary = await getBillingSummary(auth.workspaceId);
  return json(summary);
});
