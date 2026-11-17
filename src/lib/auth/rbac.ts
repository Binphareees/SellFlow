import { forbidden, unauthorized } from "@/lib/api";
import { ROLE, type Role } from "@/lib/enums";
import { requireAuth, type AuthContext } from "@/lib/auth/session";

export function hasRole(ctx: AuthContext, ...roles: Role[]): boolean {
  return roles.some((role) => ctx.roles.includes(role));
}

/**
 * Role gate for marketplace endpoints. Business-workspace endpoints use
 * requireWorkspace instead — every account has one, so role is not the gate there.
 */
export async function requireRole(...roles: Role[]): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!hasRole(ctx, ...roles)) {
    throw forbidden(`This action needs the ${roles.join(" or ")} role`);
  }
  return ctx;
}

export async function requireWorkspace(): Promise<AuthContext & { workspaceId: string }> {
  const ctx = await requireAuth();
  if (!ctx.workspaceId) {
    throw forbidden("No business workspace found for this account");
  }
  return ctx as AuthContext & { workspaceId: string };
}

export async function requireSupplier(): Promise<AuthContext & { supplierProfileId: string }> {
  const ctx = await requireRole(ROLE.SUPPLIER);
  if (!ctx.supplierProfileId) {
    throw forbidden("Create your supplier profile before using supplier tools");
  }
  return ctx as AuthContext & { supplierProfileId: string };
}

export async function requireReseller(): Promise<AuthContext> {
  return requireRole(ROLE.RESELLER);
}

export async function requirePlatformAdmin(): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!ctx.user.isPlatformAdmin) {
    throw forbidden("Platform moderators only");
  }
  return ctx;
}

/**
 * Mediators see every dispute and record outcomes. Platform admins inherit the
 * role; appointed mediators get it from a MEDIATOR ProfileRole without gaining
 * any other admin power.
 */
export function isMediator(viewer: Pick<AuthContext, "user" | "roles">): boolean {
  return viewer.user.isPlatformAdmin || viewer.roles.includes(ROLE.MEDIATOR);
}

export async function requireMediator(): Promise<AuthContext> {
  const ctx = await requireAuth();
  if (!isMediator(ctx)) throw forbidden("Only a platform mediator can do this");
  return ctx;
}

export function assertSameProfile(ctx: AuthContext, profileId: string): void {
  if (ctx.profile.id !== profileId) throw unauthorized("Account mismatch");
}
