import { route, readBody, json, ApiError } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/auth/rbac";
import { subscriptionDecisionSchema } from "@/lib/validation";
import { decideSubscriptionPayment } from "@/lib/subscription";
import { subscriptionBillingEnabled } from "@/lib/plans";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Platform moderators only. This is the "manual payment verification" step:
 * a person checks the transfer reference, then confirms or rejects it.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  if (!subscriptionBillingEnabled()) throw new ApiError(404, "SUBSCRIPTION_BILLING_DISABLED", "Subscription billing is not enabled in V1");
  const auth = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await readBody(request, subscriptionDecisionSchema);

  const payment = await decideSubscriptionPayment(id, auth.profile.id, input);
  return json({ payment });
});
