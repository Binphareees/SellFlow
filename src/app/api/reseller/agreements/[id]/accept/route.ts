import { route, json } from "@/lib/api";
import { requireReseller } from "@/lib/auth/rbac";
import { acceptAgreement } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

/** Accepting the current version is what makes private pricing visible. */
export const POST = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireReseller();
  const { id } = await ctx.params;
  const agreement = await acceptAgreement(auth.profile.id, id);
  return json({ agreement });
});
