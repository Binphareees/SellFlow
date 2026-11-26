import { prisma } from "@/lib/db";
import { audit, AUDIT } from "@/lib/audit";
import { ROLE, type Role } from "@/lib/enums";

/**
 * Private reseller pricing access control.
 *
 * This module is the ONLY place reseller prices may be read. The public listing
 * queries below deliberately never select price columns from ResellerOfferVersion,
 * so a public endpoint cannot leak them even if a caller asks for the whole object.
 */

export type PriceDenyReason =
  | "NO_SESSION"
  | "ROLE_REQUIRED"
  | "APPLICATION_NOT_APPROVED"
  | "NO_AGREEMENT"
  | "OFFER_NOT_ACTIVE"
  | "NOT_FOUND";

export type Viewer = {
  profileId: string;
  roles: Role[];
  isPlatformAdmin: boolean;
};

export type ResellerTerms = {
  priceKobo: number;
  minResaleKobo: number | null;
  commissionType: string;
  commissionValue: number;
  moq: number;
  stockQty: number;
  paymentTermsDays: number;
  deliveryResponsibility: string;
  advertisingPermission: boolean;
  customerDataVisibility: string;
};

export type PriceAccessResult =
  | {
      allowed: true;
      source: "AGREEMENT" | "SUPPLIER_OWNER" | "MODERATION";
      offerId: string;
      listingId: string;
      offerVersionId: string | null;
      agreementId: string | null;
      agreementVersionId: string | null;
      agreementVersion: number | null;
      terms: ResellerTerms;
    }
  | { allowed: false; reason: PriceDenyReason };

const DENY_MESSAGE: Record<PriceDenyReason, string> = {
  NO_SESSION: "Sign in to see reseller pricing",
  ROLE_REQUIRED: "Reseller pricing is only available to reseller accounts",
  APPLICATION_NOT_APPROVED: "Your reseller application for this supplier is not approved",
  NO_AGREEMENT: "You need an active agreement with this supplier",
  OFFER_NOT_ACTIVE: "This offer is paused by the supplier",
  NOT_FOUND: "Offer not found",
};

export const priceDenyMessage = (reason: PriceDenyReason) => DENY_MESSAGE[reason];

type OfferHeader = {
  id: string;
  status: string;
  listingId: string;
  listing: {
    id: string;
    slug: string;
    title: string;
    currency: string;
    publicPriceKobo: number;
    supplierProfileId: string;
    supplierProfile: { profileId: string; businessName: string };
  };
};

async function loadOfferHeader(offerId: string): Promise<OfferHeader | null> {
  return prisma.resellerOffer.findUnique({
    where: { id: offerId },
    select: {
      id: true,
      status: true,
      listingId: true,
      listing: {
        select: {
          id: true,
          slug: true,
          title: true,
          currency: true,
          publicPriceKobo: true,
          supplierProfileId: true,
          supplierProfile: { select: { profileId: true, businessName: true } },
        },
      },
    },
  });
}

/** Owner and moderator paths read the current offer version directly. */
async function offerVersionTerms(offerId: string): Promise<{
  offerVersionId: string | null;
  terms: ResellerTerms;
} | null> {
  const offer = await prisma.resellerOffer.findUnique({
    where: { id: offerId },
    select: {
      currentVersion: {
        select: {
          id: true,
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
        },
      },
    },
  });
  const v = offer?.currentVersion;
  if (!v) return null;
  return {
    offerVersionId: v.id,
    terms: {
      priceKobo: v.resellerPriceKobo,
      minResaleKobo: v.minResalePriceKobo,
      commissionType: v.commissionType,
      commissionValue: v.commissionValue,
      moq: v.moq,
      stockQty: v.stockQty,
      paymentTermsDays: v.paymentTermsDays,
      deliveryResponsibility: v.deliveryResponsibility,
      advertisingPermission: v.advertisingPermission,
      customerDataVisibility: v.customerDataVisibility,
    },
  };
}

export async function resolveResellerPrice(input: {
  offerId: string;
  viewer: Viewer | null;
  ipHash?: string | null;
  /**
   * Browse surfaces (public listing page and listing API) resolve the price for
   * every visitor; auditing each anonymous denial would write a row per page
   * view. They pass false. The dedicated price endpoint keeps the default.
   */
  auditDenials?: boolean;
}): Promise<PriceAccessResult> {
  const { offerId, viewer, ipHash, auditDenials = true } = input;

  const offer = await loadOfferHeader(offerId);
  if (!offer) return { allowed: false, reason: "NOT_FOUND" };

  const deny = async (reason: PriceDenyReason): Promise<PriceAccessResult> => {
    if (auditDenials) {
      await audit({
        actorProfileId: viewer?.profileId ?? null,
        action: AUDIT.PRICE_ACCESS_DENIED,
        entityType: "ResellerOffer",
        entityId: offerId,
        metadata: { reason, listingId: offer.listingId },
        ipHash: ipHash ?? null,
      });
    }
    return { allowed: false, reason };
  };

  if (!viewer) return deny("NO_SESSION");

  // The supplier who owns the listing can always read its own price.
  if (viewer.profileId === offer.listing.supplierProfile.profileId) {
    const version = await offerVersionTerms(offerId);
    if (!version) return { allowed: false, reason: "NOT_FOUND" };
    return {
      allowed: true,
      source: "SUPPLIER_OWNER",
      offerId,
      listingId: offer.listingId,
      offerVersionId: version.offerVersionId,
      agreementId: null,
      agreementVersionId: null,
      agreementVersion: null,
      terms: version.terms,
    };
  }

  // Platform moderators may inspect pricing during a dispute, but the read is logged.
  if (viewer.isPlatformAdmin) {
    const version = await offerVersionTerms(offerId);
    if (!version) return { allowed: false, reason: "NOT_FOUND" };
    await audit({
      actorProfileId: viewer.profileId,
      action: AUDIT.PRICE_ACCESS_GRANTED,
      entityType: "ResellerOffer",
      entityId: offerId,
      metadata: { source: "MODERATION", listingId: offer.listingId },
      ipHash: ipHash ?? null,
    });
    return {
      allowed: true,
      source: "MODERATION",
      offerId,
      listingId: offer.listingId,
      offerVersionId: version.offerVersionId,
      agreementId: null,
      agreementVersionId: null,
      agreementVersion: null,
      terms: version.terms,
    };
  }

  if (!viewer.roles.includes(ROLE.RESELLER)) return deny("ROLE_REQUIRED");

  // Approval must exist at the supplier level, not just "some" supplier.
  const application = await prisma.resellerApplication.findUnique({
    where: {
      supplierProfileId_resellerProfileId: {
        supplierProfileId: offer.listing.supplierProfileId,
        resellerProfileId: viewer.profileId,
      },
    },
    select: { status: true },
  });
  if (application?.status !== "APPROVED") return deny("APPLICATION_NOT_APPROVED");

  if (offer.status !== "ACTIVE") return deny("OFFER_NOT_ACTIVE");

  const agreement = await prisma.resellerAgreement.findFirst({
    where: {
      offerId,
      resellerProfileId: viewer.profileId,
      status: "ACTIVE",
      currentVersionId: { not: null },
    },
    select: {
      id: true,
      currentVersion: {
        select: {
          id: true,
          version: true,
          resellerPriceKobo: true,
          minResalePriceKobo: true,
          commissionType: true,
          commissionValue: true,
          moq: true,
          paymentTermsDays: true,
          deliveryResponsibility: true,
          advertisingPermission: true,
          customerDataVisibility: true,
        },
      },
    },
  });

  if (!agreement?.currentVersion) return deny("NO_AGREEMENT");
  const v = agreement.currentVersion;

  await audit({
    actorProfileId: viewer.profileId,
    actorRole: ROLE.RESELLER,
    action: AUDIT.PRICE_ACCESS_GRANTED,
    entityType: "ResellerOffer",
    entityId: offerId,
    metadata: {
      source: "AGREEMENT",
      agreementId: agreement.id,
      agreementVersion: v.version,
      listingId: offer.listingId,
    },
    ipHash: ipHash ?? null,
  });

  return {
    allowed: true,
    source: "AGREEMENT",
    offerId,
    listingId: offer.listingId,
    offerVersionId: null,
    agreementId: agreement.id,
    agreementVersionId: v.id,
    agreementVersion: v.version,
    terms: {
      priceKobo: v.resellerPriceKobo,
      minResaleKobo: v.minResalePriceKobo,
      commissionType: v.commissionType,
      commissionValue: v.commissionValue,
      moq: v.moq,
      stockQty: 0,
      paymentTermsDays: v.paymentTermsDays,
      deliveryResponsibility: v.deliveryResponsibility,
      advertisingPermission: v.advertisingPermission,
      customerDataVisibility: v.customerDataVisibility,
    },
  };
}

// ── Public reads (no private columns in the select) ─────────────────────────

export const publicListingSelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  imagesJson: true,
  category: true,
  publicPriceKobo: true,
  currency: true,
  moq: true,
  stockQty: true,
  isPublished: true,
  createdAt: true,
  supplierProfile: {
    select: {
      id: true,
      businessName: true,
      city: true,
      state: true,
      verificationTier: true,
    },
  },
  offer: { select: { id: true, status: true } },
} as const;

export type PublicListing = Awaited<ReturnType<typeof listPublicListings>>[number];

/** Public discovery sort options. Nothing here can reorder a private price. */
export type ListingSort = "newest" | "popular" | "price_asc" | "price_desc";
export const LISTING_SORTS: ListingSort[] = ["newest", "popular", "price_asc", "price_desc"];

export type StockFilter = "all" | "in" | "out";

export type ListingFilters = {
  q?: string;
  category?: string;
  supplierId?: string;
  minPriceKobo?: number;
  maxPriceKobo?: number;
  stock?: StockFilter;
  sort?: ListingSort;
  limit?: number;
  offset?: number;
};

/**
 * Public listing search.
 *
 * Filters only ever touch public columns (title, category, retail price, stock).
 * "Popular" is real demand: how many supplier order lines reference the listing.
 * The private reseller price cannot influence ordering because it is never read.
 */
export async function listPublicListings(params: ListingFilters = {}) {
  const limit = Math.min(params.limit ?? 24, 60);
  const offset = Math.max(params.offset ?? 0, 0);
  const sort = params.sort ?? "newest";

  const where = {
    isPublished: true,
    supplierProfile: { isActive: true },
    ...(params.supplierId ? { supplierProfileId: params.supplierId } : {}),
    ...(params.category ? { category: params.category } : {}),
    ...(params.stock === "in" ? { stockQty: { gt: 0 } } : {}),
    ...(params.stock === "out" ? { stockQty: { lte: 0 } } : {}),
    ...(params.minPriceKobo !== undefined || params.maxPriceKobo !== undefined
      ? {
          publicPriceKobo: {
            ...(params.minPriceKobo !== undefined ? { gte: params.minPriceKobo } : {}),
            ...(params.maxPriceKobo !== undefined ? { lte: params.maxPriceKobo } : {}),
          },
        }
      : {}),
    ...(params.q
      ? {
          OR: [
            { title: { contains: params.q } },
            { description: { contains: params.q } },
            { category: { contains: params.q } },
            { supplierProfile: { businessName: { contains: params.q } } },
          ],
        }
      : {}),
  };

  if (sort === "popular") {
    // Bounded candidate set, then order by measured demand.
    const candidates = await prisma.productListing.findMany({
      where,
      select: publicListingSelect,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit * 4, 120),
    });

    const ids = candidates.map((listing) => listing.id);
    const counts = ids.length
      ? await prisma.supplierOrderItem.groupBy({
          by: ["listingId"],
          where: { listingId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const demand = new Map(counts.map((row) => [row.listingId ?? "", row._count._all]));

    return candidates
      .sort((a, b) => (demand.get(b.id) ?? 0) - (demand.get(a.id) ?? 0) || b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);
  }

  return prisma.productListing.findMany({
    where,
    select: publicListingSelect,
    orderBy:
      sort === "price_asc"
        ? { publicPriceKobo: "asc" }
        : sort === "price_desc"
          ? { publicPriceKobo: "desc" }
          : { createdAt: "desc" },
    skip: offset,
    take: limit,
  });
}

/** Count for the result line and to know when "load more" runs out. */
export async function countPublicListings(params: ListingFilters = {}) {
  return prisma.productListing.count({
    where: {
      isPublished: true,
      supplierProfile: { isActive: true },
      ...(params.supplierId ? { supplierProfileId: params.supplierId } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(params.stock === "in" ? { stockQty: { gt: 0 } } : {}),
      ...(params.stock === "out" ? { stockQty: { lte: 0 } } : {}),
      ...(params.minPriceKobo !== undefined || params.maxPriceKobo !== undefined
        ? {
            publicPriceKobo: {
              ...(params.minPriceKobo !== undefined ? { gte: params.minPriceKobo } : {}),
              ...(params.maxPriceKobo !== undefined ? { lte: params.maxPriceKobo } : {}),
            },
          }
        : {}),
      ...(params.q
        ? {
            OR: [
              { title: { contains: params.q } },
              { description: { contains: params.q } },
              { category: { contains: params.q } },
              { supplierProfile: { businessName: { contains: params.q } } },
            ],
          }
        : {}),
    },
  });
}

/** Public supplier profile — no prices, no agreements, no reseller data. */
export async function getPublicSupplier(supplierId: string) {
  const supplier = await prisma.supplierProfile.findFirst({
    where: { id: supplierId, isActive: true },
    select: {
      id: true,
      businessName: true,
      about: true,
      city: true,
      state: true,
      logoUrl: true,
      verificationTier: true,
      createdAt: true,
      _count: { select: { listings: { where: { isPublished: true } } } },
    },
  });
  if (!supplier) return null;

  const categories = await prisma.productListing.findMany({
    where: { supplierProfileId: supplierId, isPublished: true, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
  });

  return {
    ...supplier,
    publishedListings: supplier._count.listings,
    categories: categories.map((row) => row.category!).filter(Boolean).sort(),
  };
}

/** Supplier directory: public contact facts and catalogue size only. */
export async function listPublicSuppliers(params: { q?: string; state?: string; limit?: number } = {}) {
  const suppliers = await prisma.supplierProfile.findMany({
    where: {
      isActive: true,
      listings: { some: { isPublished: true } },
      ...(params.state ? { state: params.state } : {}),
      ...(params.q
        ? {
            OR: [
              { businessName: { contains: params.q } },
              { about: { contains: params.q } },
              { city: { contains: params.q } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      businessName: true,
      about: true,
      city: true,
      state: true,
      logoUrl: true,
      verificationTier: true,
      createdAt: true,
      _count: { select: { listings: { where: { isPublished: true } } } },
    },
    orderBy: [{ verificationTier: "desc" }, { businessName: "asc" }],
    take: Math.min(params.limit ?? 40, 80),
  });

  return suppliers.map((supplier) => ({
    ...supplier,
    publishedListings: supplier._count.listings,
  }));
}

export async function getPublicListingBySlug(slug: string) {
  return prisma.productListing.findFirst({
    where: { slug, isPublished: true },
    select: publicListingSelect,
  });
}

export async function getListingCategories(): Promise<string[]> {
  const rows = await prisma.productListing.findMany({
    where: { isPublished: true, category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    take: 40,
  });
  return rows.map((r) => r.category!).filter(Boolean).sort();
}

/** Cheap headline for listing cards: is a private offer available at all? */
export async function getOfferHeadline(offerId: string) {
  return prisma.resellerOffer.findUnique({
    where: { id: offerId },
    select: { id: true, status: true, currentVersion: { select: { minResalePriceKobo: true, moq: true } } },
  });
}
