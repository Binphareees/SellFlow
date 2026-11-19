import { route, readBody, json, unauthorized, conflict } from "@/lib/api";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  applySessionCookie,
  requireAuth,
  rotateSessionForUser,
  sessionMeta,
} from "@/lib/auth/session";
import { verifyPassword, hashPassword, PASSWORD_RULES } from "@/lib/auth/password";
import { auditCritical, AUDIT } from "@/lib/audit";

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

  const rotated = await prisma.$transaction(async (tx) => {
    const newHash = await hashPassword(body.newPassword);

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // The audit row commits with the password update and the session change. It
    // must be written through `tx`: the shared client would open a second
    // connection and block on SQLite's write lock until this interactive
    // transaction expired (P2028). auditCritical fails closed, so a lost trail
    // aborts the change instead of reporting an unprovable success.
    await auditCritical(
      {
        actorProfileId: auth.profile.id,
        action: AUDIT.PASSWORD_CHANGED,
        entityType: "User",
        entityId: user.id,
        metadata: { newPasswordSet: true },
        ipHash: undefined,
      },
      { client: tx },
    );

    // Every live session — including the caller's — is retired and replaced in
    // this same transaction, so a replayed cookie cannot outlive the password
    // change. The new cookie is attached only after the commit succeeds.
    return rotateSessionForUser(user.id, sessionMeta(request), tx);
  });

  const response = json({
    ok: true,
    message: "Your password was updated. This session was refreshed.",
  });
  applySessionCookie(response, rotated.token, rotated.expiresAt);
  return response;
});
