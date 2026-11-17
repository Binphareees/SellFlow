import { route, readBody, json } from "@/lib/api";
import { applicationCreateSchema } from "@/lib/validation";
import { requireAuth } from "@/lib/auth/session";
import {
  applySessionCookie,
  rotateSessionForUser,
  sessionMeta,
} from "@/lib/auth/session";
import { submitApplication } from "@/server/supplier";
import { workspaceIdForProfile, assertSupplierCapacity } from "@/lib/subscription";
import { prisma } from "@/lib/db";

export const GET = route(async () => {
  const ctx = await requireAuth();
  const applications = await prisma.resellerApplication.findMany({
    where: { resellerProfileId: ctx.profile.id },
    include: { supplierProfile: { select: { businessName: true, id: true } } },
    orderBy: { createdAt: "desc" },
  });
  return json({ applications });
});

export const POST = route(async (request: Request) => {
  const ctx = await requireAuth();
  const input = await readBody(request, applicationCreateSchema);

  // `submitApplication` calls `workspaceIdForProfile` + `assertSupplierCapacity`
  // through the global prisma client. Those must run outside the interactive
  // transaction, so we compute the workspace id and check capacity first, then
  // thread the workspace id into the transaction.
  const resellerWorkspaceId = await workspaceIdForProfile(ctx.profile.id);
  if (resellerWorkspaceId) {
    await assertSupplierCapacity(resellerWorkspaceId, input.supplierProfileId);
  }

  // Submitting an application can grant the RESELLER role. When it does, the
  // grant, the ROLE_GRANTED audit event and the session rotation commit
  // together: a failed rotation rolls back the whole submission so an
  // application is never live alongside a stale token (S-14 final review).
  // An application that finds the role already present is not a privilege
  // change, so it does not rotate.
  let rotated: { token: string; expiresAt: Date } | undefined;
  const { application, roleGranted } = await prisma.$transaction(async (tx) => {
    const result = await submitApplication(
      ctx.profile.id,
      input,
      ctx.profile.verificationTier,
      tx,
      resellerWorkspaceId,
    );
    if (!result.roleGranted) return result;
    rotated = await rotateSessionForUser(ctx.user.id, sessionMeta(request), tx);
    return result;
  });

  const response = json({ application }, 201);
  if (roleGranted) applySessionCookie(response, rotated!.token, rotated!.expiresAt);
  return response;
});
