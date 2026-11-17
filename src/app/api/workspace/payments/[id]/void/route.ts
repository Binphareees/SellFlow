import { z } from "zod";
import { route, readBody, json } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth/rbac";
import { voidPayment } from "@/server/workspace";

type Ctx = { params: Promise<{ id: string }> };

const voidSchema = z.object({ reason: z.string().trim().max(300).optional() });

export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireWorkspace();
  const { id } = await ctx.params;
  const input = await readBody(request, voidSchema);
  const payment = await voidPayment(auth.workspaceId, id, auth.profile.id, input.reason ?? "");
  return json({ payment });
});
