import { route, json } from "@/lib/api";
import { requireAuth } from "@/lib/auth/session";
import { revokeOtherSessionsForUser } from "@/lib/auth/revocation";

/**
 * Sign out everywhere (S-14): every session of the account except the one making
 * this request is revoked, and the caller stays signed in. Use
 * `DELETE /api/auth/sessions/{id}` for the current session to sign out.
 */
export const POST = route(async () => {
  const ctx = await requireAuth();
  const revoked = await revokeOtherSessionsForUser(ctx.user.id, ctx.sessionId);
  return json({ ok: true, revoked });
});
