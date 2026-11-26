import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

// Route handlers normally read the request-scoped Next cookie store. These
// tests exercise the anonymous path, so replace the auth lookup with null.
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, getAuthContext: async () => null };
});
import { resolveResellerPrice } from "./price-access";
import { GET as priceEndpoint } from "@/app/api/marketplace/offers/[offerId]/price/route";
import { GET as listingEndpoint } from "@/app/api/marketplace/listings/[slug]/route";

const databaseUrl = process.env.DATABASE_URL ?? "";
if (!databaseUrl || databaseUrl.includes("dev.db")) {
  throw new Error(
    "Refusing to run price-access audit tests against prisma/dev.db. Point DATABASE_URL at a disposable database.",
  );
}

const prisma = new PrismaClient({ log: ["error"] });

let offerId = "";
let listingSlug = "";

async function deniedAuditCount(): Promise<number> {
  return prisma.auditLog.count({
    where: { entityId: offerId, action: "marketplace.price_access_denied" },
  });
}

beforeAll(async () => {
  await prisma.$connect();
  const offer = await prisma.resellerOffer.findFirstOrThrow({
    where: { status: "ACTIVE", currentVersionId: { not: null } },
    select: { id: true, listing: { select: { slug: true } } },
  });
  offerId = offer.id;
  listingSlug = offer.listing.slug;
  await prisma.auditLog.deleteMany({
    where: { entityId: offerId, action: "marketplace.price_access_denied" },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { entityId: offerId, action: "marketplace.price_access_denied" },
  });
  await prisma.$disconnect();
});

describe("price-access denial auditing", () => {
  it("writes no denial row when a browse surface disables denial auditing", async () => {
    const before = await deniedAuditCount();
    const result = await resolveResellerPrice({
      offerId,
      viewer: null,
      auditDenials: false,
    });
    expect(result.allowed).toBe(false);
    expect(await deniedAuditCount()).toBe(before);
  });

  it("still writes one denial row by default", async () => {
    const before = await deniedAuditCount();
    const result = await resolveResellerPrice({ offerId, viewer: null });
    expect(result.allowed).toBe(false);
    expect(await deniedAuditCount()).toBe(before + 1);
  });

  it("keeps denial auditing on the dedicated price endpoint", async () => {
    const before = await deniedAuditCount();
    const request = new Request(
      `http://localhost/api/marketplace/offers/${offerId}/price`,
    );
    const response = await priceEndpoint(request, {
      params: Promise.resolve({ offerId }),
    });
    expect(response.status).toBe(403);
    expect(await deniedAuditCount()).toBe(before + 1);
  });

  it("never returns private prices to an anonymous listing viewer", async () => {
    const request = new Request(
      `http://localhost/api/marketplace/listings/${listingSlug}`,
    );
    const response = await listingEndpoint(request, {
      params: Promise.resolve({ slug: listingSlug }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.resellerPrice.allowed).toBe(false);
    expect(body.resellerPrice.terms).toBeUndefined();
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("resellerPriceKobo");
    expect(serialised).not.toContain("minResalePriceKobo");
  });
});
