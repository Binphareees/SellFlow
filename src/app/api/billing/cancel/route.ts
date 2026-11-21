import { route, json, ApiError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth/rbac";
import { cancelSubscription } from "@/lib/subscription";
import { subscriptionBillingEnabled } from "@/lib/plans";

/** Cancels at the end of the paid period; data is never deleted on downgrade. */
export const POST = route(async () => {
  if (!subscriptionBillingEnabled()) throw new ApiError(404, "SUBSCRIPTION_BILLING_DISABLED", "Subscription billing is not enabled in V1");
  const auth = await requireWorkspace();
  const subscription = await cancelSubscription(auth.workspaceId, auth.profile.id);
  return json({ subscription });
});
