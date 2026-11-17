import { route, readBody, json } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/auth/rbac";
import { subscriptionDecisionSchema } from "@/lib/validation";
import { decideSubscriptionPayment } from "@/lib/subscription";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Platform moderators only. This is the "manual payment verification" step:
 * a person checks the transfer reference, then confirms or rejects it.
 */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await readBody(request, subscriptionDecisionSchema);

  const payment = await decideSubscriptionPayment(id, auth.profile.id, input);
  return json({ payment });
});
