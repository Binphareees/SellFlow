import { route, readBody, json } from "@/lib/api";
import { verificationSchema } from "@/lib/validation";
import { requirePlatformAdmin } from "@/lib/auth/rbac";
import {
  applySessionCookie,
  rotateSessionForUser,
  sessionMeta,
} from "@/lib/auth/session";
import { setVerificationTier } from "@/server/accounts";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route(async (request: Request, ctx: Ctx) => {
  const auth = await requirePlatformAdmin();
  const { id } = await ctx.params;
  const input = await readBody(request, verificationSchema);
  // The service revokes the affected account's sessions inside the same
  // transaction as the tier change (S-14 final review).
  const profile = await setVerificationTier(id, auth.profile.id, input);

  const response = json({ profile });
  // An administrator elevating their own profile is the only case where the
  // caller's own session was revoked; replace it after the commit (S-14).
  if (id === auth.profile.id) {
    const rotated = await rotateSessionForUser(auth.user.id, sessionMeta(request));
    applySessionCookie(response, rotated.token, rotated.expiresAt);
  }
  return response;
});
