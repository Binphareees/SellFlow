import { route, readBody, json } from "@/lib/api";
import { proposalCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import { createProposal } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const input = await readBody(request, proposalCreateSchema);
  const proposal = await createProposal(auth.profile.id, id, input);
  return json({ proposal }, 201);
});
