import { route, json } from "@/lib/api";
import { requireAuth } from "@/lib/auth/session";
import { getDispute } from "@/server/disputes";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const dispute = await getDispute(id, auth);
  return json({ dispute });
});
