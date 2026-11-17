import { route, readBody, json } from "@/lib/api";
import { disputeCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import { DISPUTE_STATUS, isOneOf } from "@/lib/enums";
import { listDisputes, openDispute } from "@/server/disputes";

export const GET = route(async (request: Request) => {
  const auth = await requireAuth();
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const scope = url.searchParams.get("scope");

  const disputes = await listDisputes(auth, {
    status: isOneOf(DISPUTE_STATUS, status) ? status : undefined,
    scope: scope === "all" || scope === "mine" ? scope : undefined,
  });
  return json({ disputes });
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const input = await readBody(request, disputeCreateSchema);
  const dispute = await openDispute(auth, input);
  return json({ dispute }, 201);
});
