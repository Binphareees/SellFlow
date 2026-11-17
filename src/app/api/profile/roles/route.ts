import { route, readBody, json, forbidden } from "@/lib/api";
import { prisma } from "@/lib/db";
import { roleGrantSchema } from "@/lib/validation";
import {
  applySessionCookie,
  requireAuth,
  rotateSessionForUser,
  sessionMeta,
} from "@/lib/auth/session";
import { grantRole } from "@/server/supplier";
import { ROLE } from "@/lib/enums";

/**
 * Self-service role activation for the marketplace.
 * RESELLER can be enabled directly. SUPPLIER is earned by creating a supplier
 * profile. MEDIATOR is never self-granted.
 */
export const POST = route(async (request: Request) => {
  const ctx = await requireAuth();
  const input = await readBody(request, roleGrantSchema);

  if (input.role === ROLE.MEDIATOR) {
    throw forbidden("Moderator access is granted by the platform only");
  }
  if (input.role === ROLE.SUPPLIER) {
    throw forbidden("Create a supplier profile to activate the supplier role");
  }

  // Activating a role is a privilege change: the grant, its audit row and the
  // retirement of every existing session commit together, and the replacement
  // session is created in the same transaction. A failure anywhere leaves the
  // account exactly as it was — never a live grant with a live old token
  // (S-14 final review). The cookie is attached only after the commit.
  const rotated = await prisma.$transaction(async (tx) => {
    await grantRole(ctx.profile.id, input.role, ctx.profile.id, tx);
    return rotateSessionForUser(ctx.user.id, sessionMeta(request), tx);
  });

  const response = json({ ok: true, roles: [...new Set([...ctx.roles, input.role])] });
  applySessionCookie(response, rotated.token, rotated.expiresAt);
  return response;
});
