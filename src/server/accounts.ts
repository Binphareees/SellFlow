import { prisma } from "@/lib/db";
import { conflict, notFound } from "@/lib/api";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { auditCritical, AUDIT } from "@/lib/audit";
import { ROLE } from "@/lib/enums";
import type { z } from "zod";
import type { registerSchema, verificationSchema } from "@/lib/validation";

/**
 * Registration intentionally creates the business workspace in the same
 * transaction: there is no account in SellFlow without one.
 */
export async function registerAccount(input: z.infer<typeof registerSchema>) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw conflict("An account with this email already exists");

  const passwordHash = await hashPassword(input.password);

  return (async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: { email: input.email, passwordHash },
        });

        const profile = await tx.profile.create({
          data: {
            userId: user.id,
            displayName: input.displayName,
            phone: input.phone ?? null,
            country: input.country,
            // Registration proves neither an email nor a phone. Tier 1 means
            // "contact verified", so a new account starts at 0 and only the
            // authorised verification workflow may elevate it.
            verificationTier: 0,
          },
        });

        await tx.profileRole.create({
          data: { profileId: profile.id, role: ROLE.BUSINESS_OWNER },
        });

        const workspace = await tx.businessWorkspace.create({
          data: {
            ownerProfileId: profile.id,
            name: input.businessName,
            whatsappNumber: input.phone ?? null,
          },
        });

        // The account does not exist without its trail: both commit, or neither.
        await auditCritical(
          {
            actorProfileId: profile.id,
            actorRole: ROLE.BUSINESS_OWNER,
            action: AUDIT.REGISTER,
            entityType: "User",
            entityId: user.id,
            metadata: { workspaceId: workspace.id },
          },
          { client: tx },
        );

        return { user, profile, workspace };
      });
    } catch (error: unknown) {
      // Two concurrent sign-ups can both pass the findUnique check; the
      // unique constraint on User.email then decides the winner.
      if (
        (error as { code?: unknown }).code === "P2002" ||
        /SQLITE_CONSTRAINT/i.test((error as { message?: string }).message ?? "")
      ) {
        throw conflict("An account with this email already exists");
      }
      throw error;
    }
  })();
}

/** Returns null for both "unknown email" and "wrong password" so nothing leaks. */
export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.disabledAt) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

export async function getProfileBundle(userId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    include: {
      roles: true,
      ownedWorkspace: true,
      supplierProfile: true,
    },
  });
  if (!profile) throw notFound("Profile missing for this account");
  return profile;
}

/**
 * Verification tier changes are audited and platform-admin only. Tier 1 means
 * "contact verified", but this build has no email or phone challenge, so no
 * registration or self-service path may grant it. Tier 2-3 additionally require
 * business/document review. All changes go through the admin API.
 */
export async function setVerificationTier(
  profileId: string,
  reviewerProfileId: string,
  input: z.infer<typeof verificationSchema>,
) {
  const profile = await prisma.profile.findUnique({ where: { id: profileId } });
  if (!profile) throw notFound("Profile not found");

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.profile.update({
      where: { id: profileId },
      data: { verificationTier: input.tier, tierUpdatedAt: new Date() },
    });
    await tx.verificationEvent.create({
      data: {
        profileId,
        fromTier: profile.verificationTier,
        toTier: input.tier,
        reason: input.reason,
        evidenceRef: input.evidenceRef ?? null,
        reviewedByProfileId: reviewerProfileId,
      },
    });

    // A tier elevation must be provable: the trail commits with the change.
    await auditCritical(
      {
        actorProfileId: reviewerProfileId,
        action: AUDIT.TIER_CHANGED,
        entityType: "Profile",
        entityId: profileId,
        metadata: { from: profile.verificationTier, to: input.tier, reason: input.reason },
      },
      { client: tx },
    );

    // A tier change alters what the account may do, so every existing session
    // is retired in the same transaction. A failure here aborts the elevation
    // instead of leaving an elevated account with a live old token (S-14 final
    // review). If the reviewer changed their own profile, the route replaces
    // their session after the commit.
    await tx.session.updateMany({
      where: { userId: profile.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return next;
  });

  return updated;
}
