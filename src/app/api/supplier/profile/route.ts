import { route, readBody, json } from "@/lib/api";
import { prisma } from "@/lib/db";
import { supplierProfileSchema } from "@/lib/validation";
import { requireWorkspace } from "@/lib/auth/rbac";
import {
  applySessionCookie,
  rotateSessionForUser,
  sessionMeta,
} from "@/lib/auth/session";
import { ensureSupplierProfile } from "@/server/supplier";

/**
 * Creating (or updating) a supplier profile is what activates the SUPPLIER role,
 * so it is a privilege change: the session is rotated after the write commits
 * and the replacement cookie rides on the same response (S-14).
 */
export const POST = route(async (request: Request) => {
  const ctx = await requireWorkspace();
  const input = await readBody(request, supplierProfileSchema);
  // Creating the profile activates SUPPLIER, so the profile, the role, the audit
  // row and the retirement of every existing session commit as one unit; the
  // replacement session is created inside the same transaction (S-14 final
  // review). Editing an existing profile changes no privilege, so it does not
  // rotate — a plain business-name edit must not sign the user out.
  const { supplier, rotated } = await prisma.$transaction(async (tx) => {
    const outcome = await ensureSupplierProfile(
      ctx.profile.id,
      ctx.workspaceId,
      input,
      tx,
    );
    if (!outcome.activated) return { supplier: outcome.supplier, rotated: null };
    return {
      supplier: outcome.supplier,
      rotated: await rotateSessionForUser(ctx.user.id, sessionMeta(request), tx),
    };
  });

  const response = json({ supplier }, 201);
  if (rotated) applySessionCookie(response, rotated.token, rotated.expiresAt);
  return response;
});
