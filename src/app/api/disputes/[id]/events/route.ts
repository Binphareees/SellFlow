import { route, readBody, json } from "@/lib/api";
import { disputeEventSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import { addDisputeEvent } from "@/server/disputes";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const input = await readBody(request, disputeEventSchema);
  const event = await addDisputeEvent(id, auth, input);
  return json({ event }, 201);
});
