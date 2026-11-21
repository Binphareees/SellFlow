import { route, readBody, json, ApiError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth/rbac";
import { upgradeSchema } from "@/lib/validation";
import { submitUpgrade } from "@/lib/subscription";
import { subscriptionBillingEnabled } from "@/lib/plans";

/**
 * Records a manual transfer claim. The tier does NOT change here — a platform
 * moderator confirms the money, and only that confirmation activates the plan.
 */
export const POST = route(async (request: Request) => {
  if (!subscriptionBillingEnabled()) throw new ApiError(404, "SUBSCRIPTION_BILLING_DISABLED", "Subscription billing is not enabled in V1");
  const auth = await requireWorkspace();
  const input = await readBody(request, upgradeSchema);

  const payment = await submitUpgrade({
    workspaceId: auth.workspaceId,
    profileId: auth.profile.id,
    tier: input.tier,
    method: input.method,
    reference: input.reference,
    proofNote: input.proofNote,
  });

  return json({ payment }, 201);
});
