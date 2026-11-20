import { prisma } from "@/lib/db";
import { audit, auditCritical, AUDIT } from "@/lib/audit";
import { badRequest, conflict, forbidden, notFound } from "@/lib/api";
import { ROLE, type Role } from "@/lib/enums";
import { formatMoney } from "@/lib/money";
import { resolveResellerPrice, priceDenyMessage, type Viewer } from "@/server/price-access";
import { assertFeature, assertSupplierCapacity, workspaceIdForProfile } from "@/lib/subscription";
import { projectCustomerOrderForSupplier } from "@/lib/customer-visibility";
import type { Db } from "@/lib/auth/revocation";
import { FEATURE } from "@/lib/plans";
import type { SupplierProfile } from "@prisma/client";
import type { z } from "zod";
import type {
  claimCreateSchema,
  dispatchCreateSchema,
  listingCreateSchema,
  offerTermsSchema,
  stockDecisionSchema,
  supplierOrderCreateSchema,
} from "@/lib/validation";

const termSelect = {
  id: true,
  version: true,
  resellerPriceKobo: true,
  minResalePriceKobo: true,
  commissionType: true,
  commissionValue: true,
  moq: true,
  stockQty: true,
  paymentTermsDays: true,
  deliveryResponsibility: true,
  advertisingPermission: true,
  customerDataVisibility: true,
  notes: true,
  effectiveFrom: true,
} as const;

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base || "item"}-${suffix}`;
}

// ── Supplier profile ────────────────────────────────────────────────────────

/**
 * Creates or updates a supplier profile. When the profile is newly created, the
 * SUPPLIER role is activated and its ROLE_GRANTED audit is written through the
 * caller's client so the profile, the role grant and the audit share one commit
 * (S-14 final review). `activated` is false when an existing profile is only
 * being edited — that is not a privilege change.
 *
 * Supplier-role activation is concurrency-safe: we create the role row first and
 * let the unique (profileId, role) constraint serialise concurrent writers, so two
 * simultaneous activations produce exactly one row and exactly one audit event.
 */
export async function ensureSupplierProfile(
  profileId: string,
  workspaceId: string,
  input: { businessName: string; about?: string | null; city?: string | null; state?: string | null; logoUrl?: string | null },
  client: Db = prisma,
): Promise<{ supplier: SupplierProfile; activated: boolean }> {
  const existing = await client.supplierProfile.findUnique({ where: { profileId } });
  if (existing) {
    const supplier = await client.supplierProfile.update({
      where: { id: existing.id },
      data: {
        businessName: input.businessName,
        about: input.about ?? existing.about,
        city: input.city ?? existing.city,
        state: input.state ?? existing.state,
        logoUrl: input.logoUrl ?? existing.logoUrl,
      },
    });
    return { supplier, activated: false };
  }

  const supplier = await client.supplierProfile.create({
    data: {
      workspaceId,
      profileId,
      businessName: input.businessName,
      about: input.about ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      logoUrl: input.logoUrl ?? null,
    },
  });

  // Activate the SUPPLIER role. Concurrency-safe (create first, unique
  // constraint serialises concurrent writers) and security-critical
  // (auditCritical so a failed audit write rolls back the profile creation too).
  // Unlike ensureRole/grantRole, this is only reached when the profile row was
  // just created by this request (the `existing` branch returns earlier), so the
  // SUPPLIER role cannot already exist for this profile — but we still create
  // first and treat SQLITE_CONSTRAINT as "already existed" so the implementation
  // stays correct under concurrent profile creation for the same profileId.
  try {
    await client.profileRole.create({ data: { profileId, role: ROLE.SUPPLIER } });
  } catch (error: unknown) {
    if (
      (error as { code?: unknown }).code === "P2002" ||
      /SQLITE_CONSTRAINT/i.test((error as { message?: string }).message ?? "")
    ) {
      // Another request created the role first; read and continue — the role
      // exists, so we still audit it as granted.
      await client.profileRole.findUnique({
        where: { profileId_role: { profileId, role: ROLE.SUPPLIER } },
      });
    } else {
      throw error;
    }
  }
  await auditCritical(
    {
      actorProfileId: profileId,
      action: AUDIT.ROLE_GRANTED,
      entityType: "SupplierProfile",
      entityId: supplier.id,
      metadata: { role: ROLE.SUPPLIER },
    },
    { client },
  );

  return { supplier, activated: true };
}

/**
 * Grants a self-service role. Takes the caller's client so the grant, its audit
 * row and the session rotation share one commit (S-14 final review).
 *
 * The grant is concurrency-safe (create first, then treat SQLITE_CONSTRAINT as
 * "already existed") and its ROLE_GRANTED audit is security-critical
 * (auditCritical, so a failed audit write rolls back the grant).
 */
export async function grantRole(
  profileId: string,
  role: Role,
  actorProfileId: string,
  client: Db = prisma,
) {
  // Same concurrency strategy as ensureRole: create first, let the unique
  // constraint serialise concurrent writers, and only write ROLE_GRANTED when we
  // actually created the row. Prisma `upsert` does not return a `created`
  // boolean, so an upsert-based implementation would audit-and-rotate on every
  // call, including no-op re-grants.
  try {
    const created = await client.profileRole.create({ data: { profileId, role } });
    await auditCritical(
      {
        actorProfileId,
        actorRole: role,
        action: AUDIT.ROLE_GRANTED,
        entityType: "Profile",
        entityId: profileId,
        metadata: { role },
      },
      { client },
    );
    return created;
  } catch (error: unknown) {
    if (
      (error as { code?: unknown }).code === "P2002" ||
      /SQLITE_CONSTRAINT/i.test((error as { message?: string }).message ?? "")
    ) {
      // The role already exists. Return the existing row.
      const existing = await client.profileRole.findUnique({
        where: { profileId_role: { profileId, role } },
      });
      return existing;
    }
    throw error;
  }
}

// ── Listings & offers ───────────────────────────────────────────────────────

export async function createListing(
  supplierProfileId: string,
  profileId: string,
  input: z.infer<typeof listingCreateSchema>,
) {
  const listing = await prisma.$transaction(async (tx) => {
    const created = await tx.productListing.create({
      data: {
        supplierProfileId,
        productId: input.productId ?? null,
        slug: slugify(input.title),
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        imagesJson: JSON.stringify(input.images ?? []),
        publicPriceKobo: input.publicPriceKobo,
        moq: input.moq,
        stockQty: input.stockQty,
        isPublished: input.isPublished,
      },
    });

    if (input.offer) {
      const offer = await tx.resellerOffer.create({
        data: { listingId: created.id, status: "ACTIVE" },
      });
      const version = await tx.resellerOfferVersion.create({
        data: { offerId: offer.id, version: 1, createdByProfileId: profileId, ...offerTermsData(input.offer) },
      });
      await tx.resellerOffer.update({
        where: { id: offer.id },
        data: { currentVersionId: version.id },
      });
    }

    return created;
  });

  await audit({
    actorProfileId: profileId,
    actorRole: ROLE.SUPPLIER,
    action: "marketplace.listing_created",
    entityType: "ProductListing",
    entityId: listing.id,
    metadata: { hasOffer: Boolean(input.offer), publicPriceKobo: input.publicPriceKobo },
  });

  return listing;
}

/** Offer versions carry their own stock figure (the supplier's live availability). */
function offerTermsData(terms: z.infer<typeof offerTermsSchema>) {
  return {
    resellerPriceKobo: terms.resellerPriceKobo,
    minResalePriceKobo: terms.minResalePriceKobo ?? null,
    commissionType: terms.commissionType,
    commissionValue: terms.commissionValue,
    moq: terms.moq,
    stockQty: terms.stockQty,
    paymentTermsDays: terms.paymentTermsDays,
    deliveryResponsibility: terms.deliveryResponsibility,
    advertisingPermission: terms.advertisingPermission,
    customerDataVisibility: terms.customerDataVisibility,
    notes: terms.notes ?? null,
  };
}

/**
 * Agreement versions and negotiation proposals share the commercial terms but
 * have no stock figure of their own — stock belongs to the offer and the order.
 */
function agreementTermsData(terms: z.infer<typeof offerTermsSchema>) {
  const { stockQty: _stockQty, ...rest } = offerTermsData(terms);
  return rest;
}

/** Terms are append-only: an edit creates the next version and repoints current. */
export async function addOfferVersion(
  supplierProfileId: string,
  profileId: string,
  offerId: string,
  terms: z.infer<typeof offerTermsSchema>,
) {
  const offer = await prisma.resellerOffer.findFirst({
    where: { id: offerId, listing: { supplierProfileId } },
    include: { currentVersion: { select: { version: true } } },
  });
  if (!offer) throw notFound("Offer not found");

  const nextVersion = (offer.currentVersion?.version ?? 0) + 1;

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.resellerOfferVersion.create({
      data: {
        offerId,
        version: nextVersion,
        createdByProfileId: profileId,
        ...offerTermsData(terms),
      },
    });
    await tx.resellerOffer.update({
      where: { id: offerId },
      data: { currentVersionId: created.id, status: "ACTIVE" },
    });
    return created;
  });

  await audit({
    actorProfileId: profileId,
    actorRole: ROLE.SUPPLIER,
    action: AUDIT.AGREEMENT_VERSION,
    entityType: "ResellerOfferVersion",
    entityId: version.id,
    metadata: { offerId, version: nextVersion, resellerPriceKobo: terms.resellerPriceKobo },
  });

  return version;
}

export async function setOfferStatus(
  supplierProfileId: string,
  profileId: string,
  offerId: string,
  status: "ACTIVE" | "PAUSED" | "ARCHIVED",
) {
  const offer = await prisma.resellerOffer.findFirst({
    where: { id: offerId, listing: { supplierProfileId } },
  });
  if (!offer) throw notFound("Offer not found");
  const updated = await prisma.resellerOffer.update({ where: { id: offerId }, data: { status } });
  await audit({
    actorProfileId: profileId,
    action: "marketplace.offer_status_changed",
    entityType: "ResellerOffer",
    entityId: offerId,
    metadata: { from: offer.status, to: status },
  });
  return updated;
}

// ── Applications & agreements ───────────────────────────────────────────────

export async function submitApplication(
  resellerProfileId: string,
  input: { supplierProfileId: string; offerId?: string; message?: string; businessSummary?: string },
  resellerTier: number,
  client: Db = prisma,
  resellerWorkspaceId: string | null = null,
) {
  const supplier = await client.supplierProfile.findUnique({ where: { id: input.supplierProfileId } });
  if (!supplier || !supplier.isActive) throw notFound("Supplier not found");
  if (supplier.profileId === resellerProfileId) {
    throw badRequest("You cannot apply to your own supplier profile");
  }

  // `workspaceIdForProfile` and `assertSupplierCapacity` read through the global
  // prisma client. When the caller threads in a workspace id (the route, which runs
  // them outside its interactive transaction), skip them here. Otherwise run them
  // ourselves for any non-transactional caller.
  if (resellerWorkspaceId) {
    // Route already computed the workspace id and checked capacity before the
    // transaction; nothing to do.
  } else {
    const workspaceId = await workspaceIdForProfile(resellerProfileId);
    if (workspaceId) {
      await assertSupplierCapacity(workspaceId, input.supplierProfileId);
    }
  }

  const existing = await client.resellerApplication.findUnique({
    where: {
      supplierProfileId_resellerProfileId: {
        supplierProfileId: input.supplierProfileId,
        resellerProfileId,
      },
    },
  });
  if (existing && existing.status === "PENDING") {
    throw conflict("You already have a pending application with this supplier");
  }

  // Activating the RESELLER role is a privilege change. When we are inside the
  // route's transaction we thread the client through so the role row, its
  // ROLE_GRANTED audit event and the session rotation share one commit.
  const { created: roleGranted } = await ensureRole(
    resellerProfileId,
    ROLE.RESELLER,
    resellerProfileId,
    client,
  );

  const application = existing
    ? await client.resellerApplication.update({
        where: { id: existing.id },
        data: {
          status: "PENDING",
          message: input.message ?? null,
          businessSummary: input.businessSummary ?? null,
          offerId: input.offerId ?? existing.offerId,
          verificationTierAtApply: resellerTier,
          decidedAt: null,
          decisionNote: null,
        },
      })
    : await client.resellerApplication.create({
        data: {
          supplierProfileId: input.supplierProfileId,
          resellerProfileId,
          offerId: input.offerId ?? null,
          message: input.message ?? null,
          businessSummary: input.businessSummary ?? null,
          verificationTierAtApply: resellerTier,
        },
      });

  await audit(
    {
      actorProfileId: resellerProfileId,
      actorRole: ROLE.RESELLER,
      action: AUDIT.APPLICATION_SUBMITTED,
      entityType: "ResellerApplication",
      entityId: application.id,
      metadata: { supplierProfileId: input.supplierProfileId, offerId: input.offerId ?? null },
    },
    { client },
  );

  return { application, roleGranted };
}

/**
 * Ensures a self-service role exists for the profile. When a `client` is
 * supplied, the row, its audit event and any downstream rotation share the
 * caller's transaction.
 *
 * The implementation is concurrency-safe: we create the role row first and treat
 * SQLITE_CONSTRAINT / P2002 as "already existed", so two simultaneous first-time
 * grants result in exactly one row and exactly one audit event — the database
 * serialises the write, not our application logic. We only audit when the row was
 * actually created, so the loser does not write a stale "re-grant" audit.
 *
 * The ROLE_GRANTED audit is security-critical: when this runs inside a
 * transaction, a failed audit write throws `AuditWriteError`, poisons the
 * transaction, and rolls back the role row, the application, and any session
 * rotation the caller did.
 *
 * Returns the role row, and whether it was newly created (a true privilege
 * change) or already existed.
 */
async function ensureRole(
  profileId: string,
  role: Role,
  actorProfileId: string,
  client: Db = prisma,
) {
  // Create first and let the unique constraint serialise concurrent writers.
  // Prisma `upsert` returns the resulting record, NOT a `created` boolean, so
  // it cannot tell us whether this request actually created the row. We create
  // first and treat a successful create as the privilege change; a
  // SQLITE_CONSTRAINT/P2002 means another writer already created the role, so we
  // read it back and report "already existed".
  try {
    const created = await client.profileRole.create({ data: { profileId, role } });
    // We created the row — this request is the privilege change.
    await auditCritical(
      {
        actorProfileId,
        actorRole: role,
        action: AUDIT.ROLE_GRANTED,
        entityType: "Profile",
        entityId: profileId,
        metadata: { role },
      },
      { client },
    );
    return { row: created, created: true };
  } catch (error: unknown) {
    // Unique-violation means another request (or a prior self-service
    // activation) already created the role. Read the winner's row and report
    // "already existed" — no rotation and no second audit write.
    if (
      (error as { code?: unknown }).code === "P2002" ||
      /SQLITE_CONSTRAINT/i.test((error as { message?: string }).message ?? "")
    ) {
      const existing = await client.profileRole.findUnique({
        where: { profileId_role: { profileId, role } },
      });
      if (existing) return { row: existing, created: false };
      // Constraint said no row, but findUnique found none — state is inconsistent,
      // so surface the original error.
      throw error;
    }
    throw error;
  }
}

/**
 * Approving an application creates the agreement shell plus version 1 from the
 * offer's current terms. Nothing is priced until both sides accept the version.
 */
export async function decideApplication(
  supplierProfileId: string,
  profileId: string,
  applicationId: string,
  input: { decision: "APPROVED" | "REJECTED"; note?: string; offerId?: string },
) {
  const application = await prisma.resellerApplication.findFirst({
    where: { id: applicationId, supplierProfileId },
  });
  if (!application) throw notFound("Application not found");
  if (application.status !== "PENDING") throw conflict("This application has already been decided");

  if (input.decision === "REJECTED") {
    const rejected = await prisma.resellerApplication.update({
      where: { id: applicationId },
      data: {
        status: "REJECTED",
        decidedAt: new Date(),
        decidedByProfileId: profileId,
        decisionNote: input.note ?? null,
      },
    });
    await audit({
      actorProfileId: profileId,
      actorRole: ROLE.SUPPLIER,
      action: AUDIT.APPLICATION_DECIDED,
      entityType: "ResellerApplication",
      entityId: applicationId,
      metadata: { decision: "REJECTED" },
    });
    return { application: rejected, agreementId: null as string | null };
  }

  const offerId = input.offerId ?? application.offerId ?? null;
  if (!offerId) {
    throw badRequest("Choose which offer to approve this reseller for");
  }

  const offer = await prisma.resellerOffer.findFirst({
    where: { id: offerId, listing: { supplierProfileId } },
    include: { currentVersion: true },
  });
  if (!offer?.currentVersion) throw notFound("That offer has no published terms yet");

  const result = await prisma.$transaction(async (tx) => {
    const updatedApplication = await tx.resellerApplication.update({
      where: { id: applicationId },
      data: {
        status: "APPROVED",
        offerId,
        decidedAt: new Date(),
        decidedByProfileId: profileId,
        decisionNote: input.note ?? null,
      },
    });

    const agreement = await tx.resellerAgreement.upsert({
      where: {
        offerId_resellerProfileId: { offerId, resellerProfileId: application.resellerProfileId },
      },
      create: {
        offerId,
        supplierProfileId,
        resellerProfileId: application.resellerProfileId,
        status: "PENDING_ACCEPTANCE",
      },
      update: { status: "PENDING_ACCEPTANCE", terminatedAt: null, terminationReason: null },
      include: { currentVersion: { select: { version: true } } },
    });

    const nextVersion = (agreement.currentVersion?.version ?? 0) + 1;
    const version = await tx.resellerAgreementVersion.create({
      data: {
        agreementId: agreement.id,
        version: nextVersion,
        resellerPriceKobo: offer.currentVersion!.resellerPriceKobo,
        minResalePriceKobo: offer.currentVersion!.minResalePriceKobo,
        commissionType: offer.currentVersion!.commissionType,
        commissionValue: offer.currentVersion!.commissionValue,
        moq: offer.currentVersion!.moq,
        paymentTermsDays: offer.currentVersion!.paymentTermsDays,
        deliveryResponsibility: offer.currentVersion!.deliveryResponsibility,
        advertisingPermission: offer.currentVersion!.advertisingPermission,
        customerDataVisibility: offer.currentVersion!.customerDataVisibility,
        createdByProfileId: profileId,
        acceptedBySupplierAt: new Date(),
      },
    });

    await tx.resellerAgreement.update({
      where: { id: agreement.id },
      data: { currentVersionId: version.id },
    });

    // Approval grants the applicant the RESELLER role, so their existing
    // sessions must not outlive it. Revoking inside this transaction makes a
    // "decision committed, old sessions still live" state impossible: a failed
    // revocation rolls the whole approval back (S-14 final review).
    const applicant = await tx.profile.findUnique({
      where: { id: application.resellerProfileId },
      select: { userId: true },
    });
    if (applicant) {
      await tx.session.updateMany({
        where: { userId: applicant.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return { application: updatedApplication, agreementId: agreement.id, versionId: version.id };
  });

  await audit({
    actorProfileId: profileId,
    actorRole: ROLE.SUPPLIER,
    action: AUDIT.APPLICATION_DECIDED,
    entityType: "ResellerApplication",
    entityId: applicationId,
    metadata: { decision: "APPROVED", offerId, agreementId: result.agreementId },
  });
  await audit({
    actorProfileId: profileId,
    actorRole: ROLE.SUPPLIER,
    action: AUDIT.AGREEMENT_CREATED,
    entityType: "ResellerAgreement",
    entityId: result.agreementId,
    metadata: { offerId, versionId: result.versionId },
  });

  return result;
}

export async function acceptAgreement(resellerProfileId: string, agreementId: string) {
  const agreement = await prisma.resellerAgreement.findFirst({
    where: { id: agreementId, resellerProfileId },
    include: { currentVersion: true },
  });
  if (!agreement) throw notFound("Agreement not found");
  if (!agreement.currentVersion) throw conflict("This agreement has no terms to accept");
  if (agreement.status === "ACTIVE") return agreement;

  const updated = await prisma.$transaction(async (tx) => {
    await tx.resellerAgreementVersion.update({
      where: { id: agreement.currentVersionId! },
      data: { acceptedByResellerAt: new Date() },
    });
    return tx.resellerAgreement.update({
      where: { id: agreementId },
      data: { status: "ACTIVE" },
    });
  });

  await audit({
    actorProfileId: resellerProfileId,
    actorRole: ROLE.RESELLER,
    action: "reseller_network.agreement_accepted",
    entityType: "ResellerAgreement",
    entityId: agreementId,
    metadata: { version: agreement.currentVersion.version },
  });

  return updated;
}

/** A supplier changing terms creates a new agreement version, not an edit. */
export async function addAgreementVersion(
  supplierProfileId: string,
  profileId: string,
  agreementId: string,
  terms: z.infer<typeof offerTermsSchema>,
) {
  const agreement = await prisma.resellerAgreement.findFirst({
    where: { id: agreementId, supplierProfileId },
    include: {
      currentVersion: { select: { version: true } },
      supplierProfile: { select: { workspaceId: true } },
    },
  });
  if (!agreement) throw notFound("Agreement not found");

  // Re-pricing an approved reseller is a Supplier Pro control.
  await assertFeature(agreement.supplierProfile.workspaceId, FEATURE.AGREEMENT_VERSIONING);

  const nextVersion = (agreement.currentVersion?.version ?? 0) + 1;

  const version = await prisma.$transaction(async (tx) => {
    const created = await tx.resellerAgreementVersion.create({
      data: {
        agreementId,
        version: nextVersion,
        ...agreementTermsData(terms),
        createdByProfileId: profileId,
        acceptedBySupplierAt: new Date(),
      },
    });
    await tx.resellerAgreement.update({
      where: { id: agreementId },
      data: { currentVersionId: created.id, status: "PENDING_ACCEPTANCE" },
    });
    return created;
  });

  await audit({
    actorProfileId: profileId,
    actorRole: ROLE.SUPPLIER,
    action: AUDIT.AGREEMENT_VERSION,
    entityType: "ResellerAgreement",
    entityId: agreementId,
    metadata: { version: nextVersion, resellerPriceKobo: terms.resellerPriceKobo },
  });

  return version;
}

// ── Supplier orders ─────────────────────────────────────────────────────────

function viewerOf(profileId: string, roles: Role[], isPlatformAdmin = false): Viewer {
  return { profileId, roles, isPlatformAdmin };
}

const STOCK_RETRY_ATTEMPTS = 3;

function isTransientStockError(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  const message = error instanceof Error ? error.message : "";
  return (
    code === "P2034" ||
    code === "SQLITE_BUSY" ||
    /database is locked|SQLITE_BUSY/i.test(message)
  );
}

/**
 * SQLite serialises writers, so two simultaneous stock operations can lose the
 * write lock. Retrying the whole transaction is safe because the failed attempt
 * rolled back. A business conflict (insufficient stock, wrong order state) is
 * never retried: it must surface to the caller as a 4xx.
 */
async function withStockTransaction<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < STOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientStockError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * The supplier's minimum resale price is a floor on the price the reseller
 * charges its own customer — not on the wholesale price it pays. The applicable
 * floor is the one recorded on the agreement version this order uses, so a
 * request body can never supply or lower it. Both sides are integer kobo, and a
 * supplied value must be a positive safe integer so no fractional, negative or
 * unsafe amount can slip through.
 */
function assertResalePriceAtOrAboveMinimum(
  title: string,
  resalePriceKobo: number | undefined,
  minResaleKobo: number | null,
) {
  if (resalePriceKobo === undefined) return;
  if (!Number.isSafeInteger(resalePriceKobo) || resalePriceKobo <= 0) {
    throw badRequest("Resale price must be a positive whole number of kobo");
  }
  if (minResaleKobo === null) return;
  if (!Number.isSafeInteger(minResaleKobo) || minResaleKobo < 0) {
    throw badRequest("The agreement has an invalid minimum resale price");
  }
  if (resalePriceKobo < minResaleKobo) {
    throw badRequest(
      `${title}: resale price cannot be below the supplier's minimum of ${formatMoney(minResaleKobo)}`,
    );
  }
}

export async function createSupplierOrder(
  resellerProfileId: string,
  roles: Role[],
  input: z.infer<typeof supplierOrderCreateSchema>,
) {
  const supplier = await prisma.supplierProfile.findUnique({ where: { id: input.supplierProfileId } });
  if (!supplier) throw notFound("Supplier not found");
  if (supplier.profileId === resellerProfileId) {
    throw badRequest("You cannot place a supplier order on your own profile");
  }

  // The customer order must already belong to the caller's workspace (audit
  // S-02 (remediated): a customer order may only be linked when the reseller
  // belongs to the same workspace the order belongs to. This check is
  // unconditional: a reseller with no business workspace cannot validate an
  // intra-workspace link, so the request is rejected the same way as a
  // foreign or deleted order — without saying whether the order exists.
  if (input.customerOrderId) {
    const resellerWorkspaceId = await workspaceIdForProfile(resellerProfileId);
    if (!resellerWorkspaceId) {
      throw badRequest("That customer order is not available in your workspace");
    }
    const owned = await prisma.customerOrder.findFirst({
      where: { id: input.customerOrderId, workspaceId: resellerWorkspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) {
      throw badRequest("That customer order is not available in your workspace");
    }
  }

  const viewer = viewerOf(resellerProfileId, roles);
  const lines: {
    listingId: string;
    offerVersionId: string | null;
    agreementVersionId: string | null;
    title: string;
    qty: number;
    unitPriceKobo: number;
    lineTotalKobo: number;
    resalePriceKobo: number | null;
  }[] = [];

  for (const item of input.items) {
    const listing = await prisma.productListing.findFirst({
      where: { id: item.listingId, supplierProfileId: input.supplierProfileId, isPublished: true },
      select: { id: true, title: true, moq: true, offer: { select: { id: true, currentVersionId: true } } },
    });
    if (!listing?.offer) throw notFound("Listing not found or not open to resellers");

    // The price is resolved here, server-side. Any price sent by the client is ignored.
    const access = await resolveResellerPrice({ offerId: listing.offer.id, viewer });
    if (!access.allowed) throw forbidden(priceDenyMessage(access.reason));
    if (access.source !== "AGREEMENT") {
      throw forbidden("You need an active reseller agreement to place this order");
    }
    if (item.qty < access.terms.moq) {
      throw badRequest(`${listing.title} has a minimum order of ${access.terms.moq}`);
    }

    // S-10: the resale price is the reseller's planned selling price, so it is
    // checked against the minimum resale price on the agreement version that
    // authorises this order. The check runs before any order row is created.
    assertResalePriceAtOrAboveMinimum(
      listing.title,
      item.resalePriceKobo,
      access.terms.minResaleKobo,
    );

    lines.push({
      listingId: listing.id,
      offerVersionId: listing.offer.currentVersionId,
      agreementVersionId: access.agreementVersionId,
      title: listing.title,
      qty: item.qty,
      unitPriceKobo: access.terms.priceKobo,
      lineTotalKobo: access.terms.priceKobo * item.qty,
      resalePriceKobo: item.resalePriceKobo ?? null,
    });
  }

  const totalKobo = lines.reduce((s, l) => s + l.lineTotalKobo, 0);

  let created: { id: string } | null = null;
  let lastError: unknown = null;
  const stamp = new Date();
  const prefix = `SUP-${String(stamp.getFullYear()).slice(2)}${String(stamp.getMonth() + 1).padStart(2, "0")}`;

  for (let attempt = 0; attempt < 4 && !created; attempt += 1) {
    const count = await prisma.supplierOrder.count();
    const orderNumber = `${prefix}-${String(count + 1 + attempt).padStart(4, "0")}`;
    try {
      created = await prisma.supplierOrder.create({
        data: {
          orderNumber,
          resellerProfileId,
          supplierProfileId: input.supplierProfileId,
          customerOrderId: input.customerOrderId ?? null,
          notes: input.notes ?? null,
          totalKobo,
          subtotalKobo: totalKobo,
          status: "SUBMITTED",
          items: { create: lines },
        },
        select: { id: true },
      });
    } catch (error) {
      lastError = error;
      if ((error as { code?: string }).code !== "P2002") throw error;
    }
  }

  if (!created) {
    console.error("[supplier-orders] numbering failed", lastError);
    throw conflict("Could not allocate an order number, please try again");
  }

  await audit({
    actorProfileId: resellerProfileId,
    actorRole: ROLE.RESELLER,
    action: AUDIT.SUPPLIER_ORDER_CREATED,
    entityType: "SupplierOrder",
    entityId: created.id,
    metadata: { supplierProfileId: input.supplierProfileId, totalKobo, itemCount: lines.length },
  });

  return getSupplierOrder(created.id, resellerProfileId, roles);
}

export async function getSupplierOrder(orderId: string, profileId: string, roles: Role[]) {
  const order = await prisma.supplierOrder.findUnique({
    where: { id: orderId },
    include: {
      supplierProfile: { select: { id: true, profileId: true, businessName: true } },
      resellerProfile: { select: { id: true, displayName: true, phone: true } },
      items: true,
      claims: { orderBy: { claimedAt: "desc" } },
      dispatches: { orderBy: { dispatchedAt: "desc" } },
      delivery: true,
      customerOrder: {
        select: {
          id: true,
          workspaceId: true,
          orderNumber: true,
          customer: { select: { name: true, phone: true } },
        },
      },
      disputes: { select: { id: true, reference: true, status: true, reason: true } },
    },
  });
  if (!order) throw notFound("Supplier order not found");

  const isSupplier = order.supplierProfile.profileId === profileId;
  const isReseller = order.resellerProfileId === profileId;
  const isModerator = roles.includes(ROLE.MEDIATOR);
  if (!isSupplier && !isReseller && !isModerator) throw forbidden();

  // Customer identity is shared only as far as the agreement allows. The
  // projection itself lives in one place (src/lib/customer-visibility.ts) so no
  // route can widen it (audit finding S-08).
  const terms = await prisma.resellerAgreementVersion.findFirst({
    where: { id: order.items.find((i) => i.agreementVersionId)?.agreementVersionId ?? "__none__" },
    select: { customerDataVisibility: true },
  });

  // Defence in depth for rows written before the creation check existed: a link
  // that does not point into the reseller's own workspace is never projected.
  // After S-02 remediation this should never happen for new rows (the write-time
  // check rejects a missing-workspace or foreign link), but we still guard the
  // projection unconditionally so a directly-inserted legacy row cannot leak.
  const resellerWorkspaceId = await workspaceIdForProfile(order.resellerProfileId);
  const linkBelongsToWorkspace =
    !order.customerOrder ||
    (resellerWorkspaceId !== null && order.customerOrder.workspaceId === resellerWorkspaceId);

  // A reseller with no workspace cannot have a valid intra-workspace link, so any
  // customer order attached to one of their orders is treated as foreign and hidden.
  const customerOrder =
    !linkBelongsToWorkspace || resellerWorkspaceId === null
      ? null
      : isSupplier
        ? projectCustomerOrderForSupplier(order.customerOrder, terms?.customerDataVisibility)
        : order.customerOrder;

  return {
    ...order,
    customerOrder,
    viewer: { isSupplier, isReseller, isModerator },
    canSeePrivatePrice: isSupplier || isReseller || isModerator,
  };
}

async function requireSupplierOrder(supplierProfileId: string, orderId: string) {
  const order = await prisma.supplierOrder.findFirst({
    where: { id: orderId, supplierProfileId },
    include: { items: true },
  });
  if (!order) throw notFound("Supplier order not found");
  return order;
}

export async function confirmStock(
  supplierProfileId: string,
  profileId: string,
  orderId: string,
  input: z.infer<typeof stockDecisionSchema>,
) {
  await withStockTransaction(() =>
    prisma.$transaction(async (tx) => {
      const order = await tx.supplierOrder.findFirst({
        where: { id: orderId, supplierProfileId },
        include: { items: true },
      });
      if (!order) throw notFound("Supplier order not found");
      if (!["SUBMITTED", "STOCK_CONFIRMED"].includes(order.status)) {
        throw conflict(`Stock cannot be changed while the order is ${order.status}`);
      }

      // The request may only name lines that belong to this order, once each.
      const requested = new Map<string, number>();
      for (const item of input.items) {
        if (!order.items.some((line) => line.id === item.itemId)) {
          throw badRequest("One of the items is not part of this order");
        }
        if (requested.has(item.itemId)) {
          throw badRequest("Each order item may only be confirmed once");
        }
        requested.set(item.itemId, item.confirmedQty);
      }

      const declining = input.decision === "DECLINED";
      if (!declining) {
        // Every line must be answered. An omitted line is not an implicit zero:
        // the supplier has to state the quantity explicitly.
        if (requested.size !== order.items.length) {
          throw badRequest("Confirm a quantity for every item on the order");
        }
        for (const item of order.items) {
          const confirmedQty = requested.get(item.id);
          if (confirmedQty === undefined) {
            throw badRequest("Confirm a quantity for every item on the order");
          }
          if (!Number.isSafeInteger(confirmedQty) || confirmedQty <= 0) {
            throw badRequest(
              `${item.title}: confirmed quantity must be a positive whole number`,
            );
          }
          if (confirmedQty > item.qty) {
            throw badRequest(
              `${item.title}: confirmed quantity cannot exceed the ordered quantity of ${item.qty}`,
            );
          }
        }
      }

      // Net movement per listing. Aggregating first means two lines for the same
      // listing are checked against one pool, not each against the full pool.
      const nextByItem = new Map(
        order.items.map((item) => [item.id, declining ? 0 : requested.get(item.id)!]),
      );
      const deltaByListing = new Map<string, number>();
      for (const item of order.items) {
        if (!item.listingId) continue;
        const delta = nextByItem.get(item.id)! - item.stockDeductedQty;
        if (delta !== 0) {
          deltaByListing.set(item.listingId, (deltaByListing.get(item.listingId) ?? 0) + delta);
        }
      }

      // Claim the stock decision first. If two requests read the same order,
      // only one can move stockConfirmedAt; the other gets a conflict instead of
      // deducting the same units twice.
      const stockStatus = declining
        ? "DECLINED"
        : order.items.some((item) => nextByItem.get(item.id)! < item.qty)
          ? "PARTIAL"
          : "CONFIRMED";
      const claimed = await tx.supplierOrder.updateMany({
        where: {
          id: orderId,
          supplierProfileId,
          status: order.status,
          stockConfirmedAt: order.stockConfirmedAt,
        },
        data: {
          stockStatus,
          stockConfirmedAt: new Date(),
          stockConfirmedByProfileId: profileId,
          stockNote: input.note ?? null,
          status: declining ? "STOCK_DECLINED" : "STOCK_CONFIRMED",
          ...(declining ? { stockRestoredAt: new Date() } : {}),
        },
      });
      if (claimed.count !== 1) {
        throw conflict("The stock decision changed while it was being saved");
      }

      // Deduct or release the listing stock atomically. The `stockQty >= delta`
      // predicate is what makes concurrent confirmation safe: a request that
      // cannot take its whole delta fails instead of driving stock negative.
      for (const [listingId, delta] of deltaByListing) {
        if (delta > 0) {
          const updated = await tx.productListing.updateMany({
            where: { id: listingId, stockQty: { gte: delta } },
            data: { stockQty: { decrement: delta } },
          });
          if (updated.count !== 1) {
            const exists = await tx.productListing.findUnique({
              where: { id: listingId },
              select: { id: true },
            });
            if (!exists) throw conflict("The listing for this order no longer exists");
            throw conflict("Not enough available stock to confirm this order");
          }
        } else {
          const updated = await tx.productListing.updateMany({
            where: { id: listingId },
            data: { stockQty: { increment: -delta } },
          });
          if (updated.count !== 1) {
            throw conflict("The listing for this order no longer exists");
          }
        }
      }

      for (const item of order.items) {
        await tx.supplierOrderItem.update({
          where: { id: item.id },
          data: {
            stockConfirmedQty: nextByItem.get(item.id)!,
            stockDeductedQty: item.listingId ? nextByItem.get(item.id)! : 0,
            note: input.note ?? null,
          },
        });
      }
    }),
  );

  await audit({
    actorProfileId: profileId,
    actorRole: ROLE.SUPPLIER,
    action: AUDIT.STOCK_CONFIRMED,
    entityType: "SupplierOrder",
    entityId: orderId,
    metadata: {
      decision: input.decision,
      items: input.items,
    },
  });

  return getSupplierOrderForSupplier(orderId, supplierProfileId);
}

async function getSupplierOrderForSupplier(orderId: string, supplierProfileId: string) {
  const order = await prisma.supplierOrder.findFirst({
    where: { id: orderId, supplierProfileId },
    include: { items: true, claims: true, dispatches: true, delivery: true },
  });
  if (!order) throw notFound("Supplier order not found");
  return order;
}

export async function recordPaymentClaim(
  orderId: string,
  profileId: string,
  roles: Role[],
  input: z.infer<typeof claimCreateSchema>,
) {
  const order = await prisma.supplierOrder.findUnique({
    where: { id: orderId },
    include: { supplierProfile: { select: { profileId: true } } },
  });
  if (!order) throw notFound("Supplier order not found");
  const isSupplier = order.supplierProfile.profileId === profileId;
  const isReseller = order.resellerProfileId === profileId;
  if (!isSupplier && !isReseller) throw forbidden();

  // The initial state belongs to the authenticated actor, not to the request
  // body (audit finding S-03). A reseller can only declare "sent"; a supplier
  // can only record "received". CONFIRMED / DISPUTED / PARTIAL are decisions
  // and may only be written by decidePaymentClaim, by the counterparty.
  const initialStatus = isSupplier ? "RECEIVED" : "SENT";
  if (input.status !== undefined && input.status !== initialStatus) {
    throw badRequest(
      isSupplier
        ? "A supplier records a claim as RECEIVED; the counterparty confirms it afterwards"
        : "A reseller records a claim as SENT; only the supplier can confirm or dispute it",
    );
  }

  const claim = await prisma.paymentStatusClaim.create({
    data: {
      supplierOrderId: orderId,
      claimedByProfileId: profileId,
      claimedByRole: isSupplier ? ROLE.SUPPLIER : ROLE.RESELLER,
      status: initialStatus,
      amountKobo: input.amountKobo,
      method: input.method,
      reference: input.reference ?? null,
      note: input.note ?? null,
    },
  });

  await prisma.supplierOrder.update({
    where: { id: orderId },
    data: { paymentClaimStatus: "CLAIMED" },
  });

  await audit({
    actorProfileId: profileId,
    actorRole: isSupplier ? ROLE.SUPPLIER : ROLE.RESELLER,
    action: AUDIT.CLAIM_RECORDED,
    entityType: "PaymentStatusClaim",
    entityId: claim.id,
    metadata: { orderId, amountKobo: input.amountKobo, claimStatus: input.status },
  });

  return claim;
}

export async function decidePaymentClaim(
  orderId: string,
  claimId: string,
  profileId: string,
  roles: Role[],
  input: { action: "CONFIRM" | "DISPUTE"; note?: string },
) {
  const order = await prisma.supplierOrder.findUnique({
    where: { id: orderId },
    include: { supplierProfile: { select: { profileId: true } }, claims: true },
  });
  if (!order) throw notFound("Supplier order not found");

  const claim = order.claims.find((c) => c.id === claimId);
  if (!claim) throw notFound("Payment claim not found");

  const isSupplier = order.supplierProfile.profileId === profileId;
  const isReseller = order.resellerProfileId === profileId;
  if (!isSupplier && !isReseller) throw forbidden();

  // Only the counterparty may confirm: a reseller's claim is confirmed by the supplier.
  const claimantIsSupplier = claim.claimedByRole === ROLE.SUPPLIER;
  if ((claimantIsSupplier && !isReseller) || (!claimantIsSupplier && !isSupplier)) {
    throw forbidden("Only the other party can confirm this payment claim");
  }
  if (claim.status === "CONFIRMED" || claim.status === "DISPUTED") {
    throw conflict("This claim has already been decided");
  }

  if (input.action === "DISPUTE") {
    // Dispute the claim and the owning supplier order in one transaction, and write
    // the CLAIM_DISPUTED audit record through the same transaction client so a
    // failed audit write rolls back the claim/order changes (fail-closed).
    const disputeResult = await prisma.$transaction(async (tx) => {
      // Re-read the claim inside the transaction and serialize the dispute against
      // the expected previous claim state. If another party already disputed or
      // confirmed this claim, the conditional update matches zero rows.
      const current = await tx.paymentStatusClaim.findUnique({
        where: { id: claimId },
        select: { id: true, status: true, note: true, supplierOrderId: true },
      });
      if (!current) throw notFound("Payment claim not found");
      if (current.status === "CONFIRMED" || current.status === "DISPUTED") {
        throw conflict("This claim has already been decided");
      }

      const note = input.note ?? current.note;
      const claimUpdated = await tx.paymentStatusClaim.updateMany({
        where: { id: claimId, status: current.status },
        data: { status: "DISPUTED", note },
      });
      if (claimUpdated.count !== 1) {
        throw conflict("The payment claim changed while it was being disputed");
      }

      // Update the owning supplier order only when it is still in the expected
      // previous claim state. We do not require the order status to be unchanged
      // here, because the authoritative effect of this dispute is the claim status;
      // the order update is a best-effort downstream reflection that stays
      // transactionally coupled and rolls back with the dispute if it does not
      // match the expected previous state.
      if (current.supplierOrderId) {
        const orderUpdated = await tx.supplierOrder.updateMany({
          where: {
            id: current.supplierOrderId,
            paymentClaimStatus: current.status,
          },
          data: { paymentClaimStatus: "DISPUTED", status: "DISPUTED" },
        });
        if (orderUpdated.count === 0) {
          // The order already moved away from the expected previous claim state;
          // the claim dispute above is still authoritative, so continue. Silently
          // skip the order write rather than failing the request.
        }
      }

      await auditCritical(
        {
          actorProfileId: profileId,
          action: AUDIT.CLAIM_DISPUTED,
          entityType: "PaymentStatusClaim",
          entityId: claimId,
          metadata: { orderId, amountKobo: claim.amountKobo },
        },
        { client: tx },
      );

      return { disputed: true };
    });

    return disputeResult;
  }

  const confirmedTotal = order.claims
    .filter((c) => c.status === "CONFIRMED")
    .reduce((s, c) => s + c.amountKobo, 0) + claim.amountKobo;

  const newClaimStatus = confirmedTotal >= order.totalKobo ? "CONFIRMED" : "PARTIALLY_CONFIRMED";

  await prisma.$transaction(async (tx) => {
    await tx.paymentStatusClaim.update({
      where: { id: claimId },
      data: {
        status: newClaimStatus === "CONFIRMED" ? "CONFIRMED" : "PARTIAL",
        confirmedAt: new Date(),
        confirmedByProfileId: profileId,
        note: input.note ?? claim.note,
      },
    });
    await tx.supplierOrder.update({
      where: { id: orderId },
      data: {
        paymentClaimStatus: newClaimStatus,
        status:
          newClaimStatus === "CONFIRMED" && order.status === "AWAITING_PAYMENT"
            ? "PAID"
            : order.status,
      },
    });
  });

  await audit({
    actorProfileId: profileId,
    action: AUDIT.CLAIM_CONFIRMED,
    entityType: "PaymentStatusClaim",
    entityId: claimId,
    metadata: { orderId, confirmedTotal, newClaimStatus },
  });

  return { disputed: false, paymentClaimStatus: newClaimStatus };
}

export async function dispatchOrder(
  supplierProfileId: string,
  profileId: string,
  orderId: string,
  input: z.infer<typeof dispatchCreateSchema>,
) {
  const order = await requireSupplierOrder(supplierProfileId, orderId);
  if (!["STOCK_CONFIRMED", "AWAITING_PAYMENT", "PAID"].includes(order.status)) {
    throw conflict("Confirm stock (and payment, if required) before dispatch");
  }

  const dispatch = await prisma.$transaction(async (tx) => {
    const record = await tx.dispatchRecord.create({
      data: {
        supplierOrderId: orderId,
        courierName: input.courierName ?? null,
        trackingRef: input.trackingRef ?? null,
        itemSummary: input.itemSummary ?? null,
        note: input.note ?? null,
        dispatchedByProfileId: profileId,
      },
    });
    await tx.supplierOrder.update({
      where: { id: orderId },
      data: { status: "DISPATCHED", dispatchedAt: new Date() },
    });
    return record;
  });

  await audit({
    actorProfileId: profileId,
    actorRole: ROLE.SUPPLIER,
    action: AUDIT.DISPATCHED,
    entityType: "SupplierOrder",
    entityId: orderId,
    metadata: { courierName: input.courierName ?? null, trackingRef: input.trackingRef ?? null },
  });

  return dispatch;
}

export async function confirmDelivery(
  profileId: string,
  orderId: string,
  input: { receivedQtyOk: boolean; note?: string },
) {
  const order = await prisma.supplierOrder.findUnique({
    where: { id: orderId },
    include: { supplierProfile: { select: { profileId: true } } },
  });
  if (!order) throw notFound("Supplier order not found");

  // Delivery is the receiving party's statement. A supplier cannot make it for them.
  if (order.resellerProfileId !== profileId) {
    if (order.supplierProfile.profileId === profileId) {
      throw forbidden("Only the reseller can confirm delivery received");
    }
    throw forbidden("You are not a party to this order");
  }
  if (order.status !== "DISPATCHED") throw conflict("This order has not been dispatched yet");

  const confirmation = await prisma.$transaction(async (tx) => {
    const record = await tx.deliveryConfirmation.create({
      data: {
        supplierOrderId: orderId,
        confirmedByProfileId: profileId,
        confirmedByRole: ROLE.RESELLER,
        receivedQtyOk: input.receivedQtyOk,
        note: input.note ?? null,
      },
    });
    await tx.supplierOrder.update({
      where: { id: orderId },
      data: { status: input.receivedQtyOk ? "DELIVERED" : "DISPUTED", deliveredAt: new Date() },
    });
    return record;
  });

  await audit({
    actorProfileId: profileId,
    actorRole: ROLE.RESELLER,
    action: AUDIT.DELIVERED,
    entityType: "SupplierOrder",
    entityId: orderId,
    metadata: { receivedQtyOk: input.receivedQtyOk },
  });

  return confirmation;
}

/**
 * The only changes the generic status PATCH may make (audit finding S-04).
 * Every other step has a dedicated, party-owned service that records evidence:
 * `confirmStock`, payment claims, `dispatchOrder`, `confirmDelivery`. Keeping
 * this map here means no route can skip those steps by writing a status.
 */
const SUPPLIER_STATUS_EDGES: Record<string, readonly string[]> = {
  SUBMITTED: ["CANCELLED"],
  STOCK_DECLINED: ["CANCELLED"],
  STOCK_CONFIRMED: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["CANCELLED"],
  DELIVERED: ["COMPLETED"],
};

export async function setSupplierOrderStatus(
  supplierProfileId: string,
  profileId: string,
  orderId: string,
  status: string,
  note?: string | null,
  isAdmin: boolean = false,
) {
  const result = await withStockTransaction(() =>
    prisma.$transaction(async (tx) => {
      const order = await tx.supplierOrder.findFirst({
        where: { id: orderId, supplierProfileId },
        include: { items: true, claims: true },
      });
      if (!order) throw notFound("Supplier order not found");

      // One owned step at a time. Dispatch, delivery, payment and stock changes
      // are rejected here because they must go through the service that records
      // their evidence; this check runs before any write, so a rejected request
      // leaves the order and every related record untouched.
      const allowed = SUPPLIER_STATUS_EDGES[order.status] ?? [];
      if (!allowed.includes(status)) {
        throw conflict(
          `An order cannot move from ${order.status} to ${status}; use the stock, payment claim, dispatch or delivery step`,
        );
      }

      const hasPaymentClaims =
        (order.claims?.length ?? 0) > 0 || order.paymentClaimStatus !== "NONE";

      // Decision 6: cancellation of an order with payment claims is restricted
      // to platform owner/admin (or inherited mediator) and holds stock.
      if (status === "CANCELLED" && hasPaymentClaims && !isAdmin) {
        throw forbidden("Only a platform owner or mediator can cancel an order with payment claims");
      }

      const now = new Date();
      // Claim the transition atomically. Two concurrent cancellations both read
      // the same predecessor, but only one can perform the status change (and
      // therefore the restoration) that follows.
      const claimed = await tx.supplierOrder.updateMany({
        where: { id: orderId, supplierProfileId, status: order.status },
        data: {
          status,
          ...(status === "COMPLETED" ? { completedAt: now } : {}),
          ...(status === "CANCELLED"
            ? {
                cancelledAt: now,
                cancellationReason: note ?? null,
                ...(hasPaymentClaims ? { stockHeldAt: now } : { stockRestoredAt: now }),
              }
            : {}),
        },
      });
      if (claimed.count !== 1) {
        throw conflict("The order changed while its status was being updated");
      }

      // Restore only what this order actually deducted, then clear the marker.
      // A declined order never deducted anything, so this is a no-op for it.
      // Decision 6: when payment claims exist, hold/quarantine stock instead.
      if (status === "CANCELLED") {
        if (hasPaymentClaims) {
          // Hold: leave stockDeductedQty > 0 (units stay out of available listing stock).
          // auditCritical inside the transaction.
          await auditCritical(
            {
              actorProfileId: profileId,
              actorRole: "SUPPLIER",
              action: AUDIT.SUPPLIER_ORDER_STATUS,
              entityType: "SupplierOrder",
              entityId: orderId,
              metadata: { from: order.status, to: "CANCELLED", held: true, paymentClaims: true },
            },
            { client: tx },
          );
        } else {
          for (const item of order.items) {
            if (item.stockDeductedQty === 0) continue;
            if (item.listingId) {
              const restored = await tx.productListing.updateMany({
                where: { id: item.listingId },
                data: { stockQty: { increment: item.stockDeductedQty } },
              });
              if (restored.count !== 1) {
                throw conflict("The listing for this order no longer exists");
              }
            }
            await tx.supplierOrderItem.update({
              where: { id: item.id },
              data: { stockDeductedQty: 0 },
            });
          }
        }
      }

      const updated = await tx.supplierOrder.findUniqueOrThrow({ where: { id: orderId } });
      return { order: updated, from: order.status, held: hasPaymentClaims && status === "CANCELLED" };
    }),
  );

  if (!result.held) {
    await audit({
      actorProfileId: profileId,
      actorRole: ROLE.SUPPLIER,
      action: AUDIT.SUPPLIER_ORDER_STATUS,
      entityType: "SupplierOrder",
      entityId: orderId,
      metadata: { from: result.from, to: status, note: note ?? null },
    });
  }
  return result.order;
}

export async function releaseHeldSupplierStock(
  orderId: string,
  profileId: string,
  isAdmin: boolean = false,
) {
  if (!isAdmin) {
    throw forbidden("Only a platform owner or mediator can release held stock");
  }

  return withStockTransaction(() =>
    prisma.$transaction(async (tx) => {
      const order = await tx.supplierOrder.findUnique({
        where: { id: orderId },
        include: { items: true },
      });
      if (!order) throw notFound("Supplier order not found");

      // Idempotent: nothing to do when this order is not currently holding stock.
      if (!order.stockHeldAt) {
        return order;
      }

      const now = new Date();
      const claimed = await tx.supplierOrder.updateMany({
        where: { id: orderId, stockHeldAt: { not: null } },
        data: { stockHeldAt: null, stockRestoredAt: now },
      });
      if (claimed.count !== 1) {
        return tx.supplierOrder.findUniqueOrThrow({
          where: { id: orderId },
          include: { items: true },
        });
      }

      for (const item of order.items) {
        if (item.stockDeductedQty === 0 || !item.listingId) continue;
        const restored = await tx.productListing.updateMany({
          where: { id: item.listingId },
          data: { stockQty: { increment: item.stockDeductedQty } },
        });
        if (restored.count !== 1) {
          throw conflict("The listing for this held order no longer exists");
        }
        await tx.supplierOrderItem.update({
          where: { id: item.id },
          data: { stockDeductedQty: 0 },
        });
      }

      await auditCritical(
        {
          actorProfileId: profileId,
          action: AUDIT.SUPPLIER_HELD_STOCK_RELEASED,
          entityType: "SupplierOrder",
          entityId: orderId,
          metadata: { released: true },
        },
        { client: tx },
      );

      return tx.supplierOrder.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true },
      });
    }),
  );
}

// ── Dashboards ──────────────────────────────────────────────────────────────

export async function getSupplierDashboard(supplierProfileId: string) {
  const [listings, applications, orders, agreements] = await Promise.all([
    prisma.productListing.findMany({
      where: { supplierProfileId },
      select: {
        id: true,
        title: true,
        slug: true,
        publicPriceKobo: true,
        currency: true,
        stockQty: true,
        moq: true,
        isPublished: true,
        createdAt: true,
        offer: {
          select: {
            id: true,
            status: true,
            currentVersion: {
              select: {
                version: true,
                resellerPriceKobo: true,
                minResalePriceKobo: true,
                moq: true,
                commissionType: true,
                commissionValue: true,
                paymentTermsDays: true,
                deliveryResponsibility: true,
                advertisingPermission: true,
                customerDataVisibility: true,
              },
            },
            _count: { select: { applications: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.resellerApplication.findMany({
      where: { supplierProfileId },
      include: {
        resellerProfile: { select: { id: true, displayName: true, phone: true, verificationTier: true } },
        offer: { select: { id: true, listing: { select: { title: true } } } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 30,
    }),
    prisma.supplierOrder.findMany({
      where: { supplierProfileId },
      include: {
        resellerProfile: { select: { displayName: true } },
        _count: { select: { items: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.resellerAgreement.findMany({
      where: { supplierProfileId },
      include: {
        resellerProfile: { select: { displayName: true } },
        currentVersion: { select: { version: true, resellerPriceKobo: true } },
        offer: { select: { listing: { select: { title: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      take: 20,
    }),
  ]);

  const pending = orders.filter((o) => o.status === "SUBMITTED").length;
  const awaitingPayment = orders.filter(
    (o) => o.status === "STOCK_CONFIRMED" || o.status === "AWAITING_PAYMENT",
  ).length;
  const gmv = orders
    .filter((o) => !["CANCELLED", "STOCK_DECLINED"].includes(o.status))
    .reduce((s, o) => s + o.totalKobo, 0);

  return {
    listings,
    applications,
    orders,
    agreements,
    stats: {
      listingCount: listings.length,
      pendingApplications: applications.filter((a) => a.status === "PENDING").length,
      pendingStock: pending,
      awaitingPayment,
      gmvKobo: gmv,
    },
  };
}

export async function getResellerOverview(profileId: string) {
  const [agreements, applications, orders] = await Promise.all([
    prisma.resellerAgreement.findMany({
      where: { resellerProfileId: profileId },
      include: {
        supplierProfile: { select: { businessName: true } },
        offer: { select: { listing: { select: { title: true, slug: true } } } },
        currentVersion: {
          select: {
            version: true,
            resellerPriceKobo: true,
            minResalePriceKobo: true,
            moq: true,
            commissionType: true,
            commissionValue: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.resellerApplication.findMany({
      where: { resellerProfileId: profileId },
      include: { supplierProfile: { select: { businessName: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.supplierOrder.findMany({
      where: { resellerProfileId: profileId },
      include: { supplierProfile: { select: { businessName: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return { agreements, applications, orders };
}

// ── Structured negotiation ──────────────────────────────────────────────────

async function agreementParties(agreementId: string, profileId: string) {
  const agreement = await prisma.resellerAgreement.findUnique({
    where: { id: agreementId },
    include: {
      supplierProfile: { select: { profileId: true } },
      currentVersion: { select: { version: true } },
    },
  });
  if (!agreement) throw notFound("Agreement not found");

  const isSupplier = agreement.supplierProfile.profileId === profileId;
  const isReseller = agreement.resellerProfileId === profileId;
  if (!isSupplier && !isReseller) throw forbidden("You are not a party to this agreement");

  return { agreement, isSupplier, isReseller };
}

/**
 * Negotiation is structured rather than free text: a proposal carries the same
 * term fields as an agreement version, so accepting it can create a version
 * without re-typing or trusting a chat message.
 */
export async function createProposal(
  profileId: string,
  agreementId: string,
  input: Partial<z.infer<typeof offerTermsSchema>> & {
    resellerPriceKobo: number;
    message?: string | null;
  },
) {
  const { agreement, isSupplier } = await agreementParties(agreementId, profileId);
  if (agreement.status === "TERMINATED") throw conflict("This agreement has been terminated");

  // Counter-offers keep a clean paper trail, which is a Supplier Pro control.
  const proposerWorkspaceId = await workspaceIdForProfile(profileId);
  if (proposerWorkspaceId) await assertFeature(proposerWorkspaceId, FEATURE.NEGOTIATION);

  const proposal = await prisma.negotiationProposal.create({
    data: {
      agreementId,
      offerVersionId: null,
      proposedByProfileId: profileId,
      proposedByRole: isSupplier ? ROLE.SUPPLIER : ROLE.RESELLER,
      ...agreementTermsData({
        ...input,
        minResalePriceKobo: input.minResalePriceKobo,
        commissionType: input.commissionType ?? "NONE",
        commissionValue: input.commissionValue ?? 0,
        moq: input.moq ?? 1,
        stockQty: input.stockQty ?? 0,
        paymentTermsDays: input.paymentTermsDays ?? 0,
        deliveryResponsibility: input.deliveryResponsibility ?? "SUPPLIER",
        advertisingPermission: input.advertisingPermission ?? false,
        customerDataVisibility: input.customerDataVisibility ?? "ORDER_ONLY",
      }),
      message: input.message ?? null,
    },
  });

  await audit({
    actorProfileId: profileId,
    actorRole: isSupplier ? ROLE.SUPPLIER : ROLE.RESELLER,
    action: AUDIT.PROPOSAL_CREATED,
    entityType: "NegotiationProposal",
    entityId: proposal.id,
    metadata: { agreementId, resellerPriceKobo: input.resellerPriceKobo },
  });

  return proposal;
}

export async function acceptProposal(profileId: string, agreementId: string, proposalId: string) {
  const { agreement } = await agreementParties(agreementId, profileId);
  const proposal = await prisma.negotiationProposal.findFirst({
    where: { id: proposalId, agreementId },
  });
  if (!proposal) throw notFound("Proposal not found");
  if (proposal.status !== "PROPOSED") throw conflict("This proposal is no longer open");
  if (proposal.proposedByProfileId === profileId) {
    throw badRequest("You cannot accept your own proposal");
  }

  const nextVersion = (agreement.currentVersion?.version ?? 0) + 1;

  const version = await prisma.$transaction(async (tx) => {
    await tx.negotiationProposal.update({
      where: { id: proposalId },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
        respondedByProfileId: profileId,
      },
    });

    const created = await tx.resellerAgreementVersion.create({
      data: {
        agreementId,
        version: nextVersion,
        resellerPriceKobo: proposal.resellerPriceKobo,
        minResalePriceKobo: proposal.minResalePriceKobo,
        commissionType: proposal.commissionType,
        commissionValue: proposal.commissionValue,
        moq: proposal.moq,
        paymentTermsDays: proposal.paymentTermsDays,
        deliveryResponsibility: proposal.deliveryResponsibility,
        advertisingPermission: proposal.advertisingPermission,
        customerDataVisibility: proposal.customerDataVisibility,
        createdByProfileId: proposal.proposedByProfileId,
        acceptedByResellerAt: new Date(),
        acceptedBySupplierAt: new Date(),
        notes: "Created by accepting a negotiation proposal",
      },
    });

    await tx.resellerAgreement.update({
      where: { id: agreementId },
      data: { currentVersionId: created.id, status: "ACTIVE" },
    });

    // Supersede older accepted proposals so the trail stays readable.
    await tx.negotiationProposal.updateMany({
      where: { agreementId, status: "PROPOSED", id: { not: proposalId } },
      data: { status: "WITHDRAWN", respondedAt: new Date() },
    });

    return created;
  });

  await audit({
    actorProfileId: profileId,
    action: AUDIT.AGREEMENT_VERSION,
    entityType: "ResellerAgreement",
    entityId: agreementId,
    metadata: { version: nextVersion, fromProposalId: proposalId },
  });

  return version;
}
