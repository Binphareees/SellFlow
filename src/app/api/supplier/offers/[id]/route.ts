import { z } from "zod";
import { route, readBody, json } from "@/lib/api";
import { requireSupplier } from "@/lib/auth/rbac";
import { setOfferStatus } from "@/server/supplier";

type Ctx = { params: Promise<{ id: string }> };

const statusSchema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]) });

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const auth = await requireSupplier();
  const { id } = await ctx.params;
  const input = await readBody(request, statusSchema);
  const offer = await setOfferStatus(auth.supplierProfileId, auth.profile.id, id, input.status);
  return json({ offer });
});
