import { route, readBody, json, unauthorized, conflict } from "@/lib/api";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { findResetToken, consumeResetToken } from "@/lib/auth/reset-token";
import { hashPassword, verifyPassword, PASSWORD_RULES } from "@/lib/auth/password";
import { auditCritical, AUDIT } from "@/lib/audit";

const RESET_FIELDS = z.object({
  token: z.string().min(1, "Reset token is required"),
  password: z
    .string()
    .min(PASSWORD_RULES.min, PASSWORD_RULES.hint)
    .max(PASSWORD_RULES.max, "Password is too long"),
});

export const POST = route(async (request: Request) => {
  const body = await readBody(request, RESET_FIELDS);

  const token = await findResetToken(body.token);
  if (!token) {
    throw unauthorized("That reset link is invalid or has expired.");
  }

  const user = await prisma.user.findUnique({
    where: { id: token.userId },
    select: { id: true, passwordHash: true, disabledAt: true },
  });

  if (!user || user.disabledAt) {
    // A deleted or disabled account cannot complete a reset.
    throw unauthorized("That reset link is invalid or has expired.");
  }

  const passwordOk = await verifyPassword(body.password, user.passwordHash);
  if (passwordOk) {
    throw conflict("Your new password must be different from your current password.");
  }

  await prisma.$transaction(async (tx) => {
    const newHash = await hashPassword(body.password);

    // Consume the token inside this transaction so a password change cannot commit
    // without also invalidating the token.
    const consumed = await consumeResetToken(token.hashedToken, tx);
    if (!consumed) {
      throw unauthorized("That reset link has already been used.");
    }

    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Revoke every other session for this account so the old credentials are no
    // longer usable anywhere. The current session does not exist here (there is no
    // session to rotate), so we revoke all and force a fresh sign-in.
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // The audit row commits with the password update, the token consumption and
    // the session revocation. It must be written through `tx`: the shared client
    // would open a second connection and block on SQLite's write lock until this
    // interactive transaction expired (P2028). auditCritical fails closed, so a
    // lost trail aborts the reset instead of reporting an unprovable success.
    await auditCritical(
      {
        actorProfileId: undefined,
        action: AUDIT.PASSWORD_RESET,
        entityType: "User",
        entityId: user.id,
        metadata: {
          resetTokenUsed: true,
          // Never include the raw token or hashed token in audit metadata.
        },
        ipHash: undefined,
      },
      { client: tx },
    );
  });

  return json({ ok: true, message: "Your password was updated. Sign in to continue." });
});
