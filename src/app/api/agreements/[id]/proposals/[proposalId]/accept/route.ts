import { route, json } from "@/lib/api";
import { requireAuth } from "@/lib/auth/session";
import { acceptProposal } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string; proposalId: string }> };

export const POST = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id, proposalId } = await ctx.params;
  const version = await acceptProposal(auth.profile.id, id, proposalId);
  return json({ version }, 201);
});
