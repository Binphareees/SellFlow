import { route, readBody, json, unauthorized, conflict } from "@/lib/api";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth/session";
import { verifyPassword, hashPassword, PASSWORD_RULES } from "@/lib/auth/password";
import { revokeOtherSessionsForUser } from "@/lib/auth/revocation";
import { audit } from "@/lib/audit";
import { AUDIT } from "@/lib/audit";

const CHANGE_FIELDS = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(PASSWORD_RULES.min, PASSWORD_RULES.hint)
    .max(PASSWORD_RULES.max, "Password is too long"),
});

export const POST = route(async (request: Request) => {
  const auth = await requireAuth();
  const body = await readBody(request, CHANGE_FIELDS);

  const user = await prisma.user.findUnique({
    where: { id: auth.user.id },
    select: { id: true, passwordHash: true, disabledAt: true },
  });

  if (!user || user.disabledAt) {
    throw unauthorized("Your account is not currently available.");
  }

  const currentOk = await verifyPassword(body.currentPassword, user.passwordHash);
  if (!currentOk) {
    throw unauthorized("Your current password is incorrect.");
  }

  if (await verifyPassword(body.newPassword, user.passwordHash)) {
    throw conflict("Your new password must be different from your current password.");
  }

  await prisma.$transaction(async (tx) => {
    const newHash = await hashPassword(body.newPassword);

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Revoke every other session so the old password is no longer usable
    // elsewhere. The current session is rotated separately so the caller keeps a
    // valid session cookie after the change.
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: auth.sessionId } },
      data: { revokedAt: new Date() },
    });

    await audit({
      actorProfileId: auth.profile.id,
      action: AUDIT.PASSWORD_CHANGED,
      entityType: "User",
      entityId: user.id,
      metadata: { newPasswordSet: true },
      ipHash: undefined,
    });
  });

  // Rotate the current session so a reused session cookie cannot survive the
  // password change.
  await revokeOtherSessionsForUser(auth.user.id, auth.sessionId);

  return json({ ok: true, message: "Your password was updated. This session was refreshed." });
});
