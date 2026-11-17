import { route, json } from "@/lib/api";
import { listPublicSuppliers } from "@/server/price-access";

/** Public supplier directory. Business facts and catalogue size only. */
export const GET = route(async (request: Request) => {
  const params = new URL(request.url).searchParams;
  const suppliers = await listPublicSuppliers({
    q: params.get("q")?.trim().slice(0, 80) || undefined,
    state: params.get("state")?.trim() || undefined,
  });

  return json({ suppliers });
});
