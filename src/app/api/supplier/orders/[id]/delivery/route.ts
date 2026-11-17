import { route, readBody, json } from "@/lib/api";
import { deliveryCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import { confirmDelivery } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

/** Delivery is confirmed by the reseller (the receiving party), not the supplier. */
export const POST = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;
  const input = await readBody(request, deliveryCreateSchema);
  const confirmation = await confirmDelivery(auth.profile.id, id, input);
  return json({ confirmation }, 201);
});
