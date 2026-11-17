import { route, json } from "@/lib/api";
import { clearSessionCookie, getAuthContext, revokeCurrentSession } from "@/lib/auth/session";
import { audit, AUDIT } from "@/lib/audit";

export const POST = route(async () => {
  const ctx = await getAuthContext();
  await revokeCurrentSession();

  if (ctx) {
    await audit({
      actorProfileId: ctx.profile.id,
      action: AUDIT.LOGOUT,
      entityType: "Session",
      entityId: ctx.user.id,
    });
  }

  const response = json({ ok: true });
  clearSessionCookie(response);
  return response;
});
