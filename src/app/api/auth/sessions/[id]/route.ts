import { route, json, notFound } from "@/lib/api";
import { clearSessionCookie, requireAuth } from "@/lib/auth/session";
import { revokeOwnedSession } from "@/lib/auth/revocation";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Revokes one of the caller's own sessions (S-14). Another account's session id
 * is reported as missing, so the endpoint cannot be used to probe or disturb it.
 * Revoking the current session also clears the cookie, i.e. it signs out.
 */
export const DELETE = route(async (_request: Request, ctx: Ctx) => {
  const auth = await requireAuth();
  const { id } = await ctx.params;

  const revoked = await revokeOwnedSession(auth.user.id, id);
  if (!revoked) throw notFound("Session not found");

  const response = json({ ok: true, current: id === auth.sessionId });
  if (id === auth.sessionId) clearSessionCookie(response);
  return response;
});
