import { route, readBody, json } from "@/lib/api";
import { disputeStatusSchema } from "@/lib/validation";
import { requireMediator } from "@/lib/auth/rbac";
import { changeDisputeStatus } from "@/server/disputes";

type Ctx = { params: Promise<{ id: string }> };

/** Mediator-only: take a dispute up for review, or close it without an outcome. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireMediator();
  const { id } = await ctx.params;
  const input = await readBody(request, disputeStatusSchema);
  const dispute = await changeDisputeStatus(auth, id, input);
  return json({ dispute });
});
