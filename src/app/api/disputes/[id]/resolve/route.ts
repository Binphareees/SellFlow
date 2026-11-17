import { route, readBody, json } from "@/lib/api";
import { disputeResolveSchema } from "@/lib/validation";
import { requireMediator } from "@/lib/auth/rbac";
import { resolveDispute } from "@/server/disputes";

type Ctx = { params: Promise<{ id: string }> };

/** Mediator-only. The outcome and note are written to the dispute audit trail. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireMediator();
  const { id } = await ctx.params;
  const input = await readBody(request, disputeResolveSchema);
    const dispute = await resolveDispute(auth, id, input);
  return json({ dispute });
});
