import { route, json } from "@/lib/api";
import { getAuthContext } from "@/lib/auth/session";
import { VERIFICATION_LABEL } from "@/lib/enums";

export const GET = route(async () => {
  const ctx = await getAuthContext();
  if (!ctx) return json({ authenticated: false, user: null }, 200);

  return json({
    authenticated: true,
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      isPlatformAdmin: ctx.user.isPlatformAdmin,
    },
    profile: {
      id: ctx.profile.id,
      displayName: ctx.profile.displayName,
      phone: ctx.profile.phone,
      verificationTier: ctx.profile.verificationTier,
      verificationLabel: VERIFICATION_LABEL[ctx.profile.verificationTier] ?? "Unverified",
    },
    roles: ctx.roles,
    workspaceId: ctx.workspaceId,
    supplierProfileId: ctx.supplierProfileId,
  });
});
