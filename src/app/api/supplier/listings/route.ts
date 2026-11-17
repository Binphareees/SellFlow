import { route, readBody, json } from "@/lib/api";
import { listingCreateSchema } from "@/lib/validation";
import { requireSupplier } from "@/lib/auth/rbac";
import { createListing } from "@/server/supplier";
import { prisma } from "@/lib/db";

export const GET = route(async () => {
  const ctx = await requireSupplier();
  const listings = await prisma.productListing.findMany({
    where: { supplierProfileId: ctx.supplierProfileId },
    include: {
      offer: {
        select: {
          id: true,
          status: true,
          currentVersion: { select: { version: true, resellerPriceKobo: true, moq: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  return json({ listings });
});

export const POST = route(async (request: Request) => {
  const ctx = await requireSupplier();
  const input = await readBody(request, listingCreateSchema);
  const listing = await createListing(ctx.supplierProfileId, ctx.profile.id, input);
  return json({ listing }, 201);
});
