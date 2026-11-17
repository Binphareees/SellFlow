/**
 * Demo data for local development and automated tests. Every name, price and
 * order here is invented.
 *
 * Four accounts are created (development password documented below):
 *   supplier@sellflow.test  supplier, comped Supplier Pro
 *   reseller@sellflow.test  reseller, Free plan (so the caps can be felt)
 *   mediator@sellflow.test  mediator who can see every dispute
 *   admin@sellflow.test     platform admin who confirms manual upgrade transfers
 *
 * The reseller application is APPROVED and the agreement is ACTIVE, so the
 * private-price path can be exercised end to end. Delete the agreement or set it
 * back to PENDING_ACCEPTANCE to watch the price gate close.
 *
 * This dataset is a DEMO: two of the four accounts are privileged and the
 * password is committed to the repository. It must never run against a
 * production database (audit finding S-15). `assertDemoSeedAllowed` from
 * `scripts/seed-guard.ts` refuses anything but an explicitly confirmed
 * development/test run against a disposable local target, before Prisma
 * connects to the database.
 *
 * Production initialization is `prisma migrate deploy` plus the pilot
 * onboarding tool (`npm run pilot:seed`), which takes its credentials from the
 * operator and creates no privileged demo account.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { assertDemoSeedAllowed } from "../scripts/seed-guard";

assertDemoSeedAllowed();

const prisma = new PrismaClient();
const PASSWORD = "Password123!";
const naira = (value: number) => value * 100;

async function main() {
  console.log("Seeding SellFlow demo data…");

  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // ── Supplier account ──────────────────────────────────────────────────────
  const supplierUser = await prisma.user.upsert({
    where: { email: "supplier@sellflow.test" },
    update: {},
    create: { email: "supplier@sellflow.test", passwordHash, emailVerifiedAt: new Date() },
  });

  const supplierProfile = await prisma.profile.upsert({
    where: { userId: supplierUser.id },
    update: {},
    create: {
      userId: supplierUser.id,
      displayName: "Chidi Okonkwo",
      phone: "2348031234567",
      city: "Lagos",
      state: "Lagos",
      verificationTier: 2,
      tierUpdatedAt: new Date(),
    },
  });

  for (const role of ["BUSINESS_OWNER", "SUPPLIER"]) {
    await prisma.profileRole.upsert({
      where: { profileId_role: { profileId: supplierProfile.id, role } },
      update: {},
      create: { profileId: supplierProfile.id, role },
    });
  }

  const supplierWorkspace = await prisma.businessWorkspace.upsert({
    where: { ownerProfileId: supplierProfile.id },
    update: {},
    create: {
      ownerProfileId: supplierProfile.id,
      name: "Chidi Wholesale",
      city: "Lagos",
      whatsappNumber: "2348031234567",
    },
  });

  const supplier = await prisma.supplierProfile.upsert({
    where: { workspaceId: supplierWorkspace.id },
    update: {},
    create: {
      workspaceId: supplierWorkspace.id,
      profileId: supplierProfile.id,
      businessName: "Chidi Wholesale",
      about: "Bulk hair accessories and beauty tools, Lagos Island. Minimum 6 pieces per style.",
      city: "Lagos",
      state: "Lagos",
      verificationTier: 2,
    },
  });

  // ── Reseller account ──────────────────────────────────────────────────────
  const resellerUser = await prisma.user.upsert({
    where: { email: "reseller@sellflow.test" },
    update: {},
    create: { email: "reseller@sellflow.test", passwordHash, emailVerifiedAt: new Date() },
  });

  const resellerProfile = await prisma.profile.upsert({
    where: { userId: resellerUser.id },
    update: {},
    create: {
      userId: resellerUser.id,
      displayName: "Amaka Eze",
      phone: "2348069876543",
      city: "Enugu",
      state: "Enugu",
      verificationTier: 1,
      tierUpdatedAt: new Date(),
    },
  });

  for (const role of ["BUSINESS_OWNER", "RESELLER"]) {
    await prisma.profileRole.upsert({
      where: { profileId_role: { profileId: resellerProfile.id, role } },
      update: {},
      create: { profileId: resellerProfile.id, role },
    });
  }

  const resellerWorkspace = await prisma.businessWorkspace.upsert({
    where: { ownerProfileId: resellerProfile.id },
    update: {},
    create: {
      ownerProfileId: resellerProfile.id,
      name: "Amaka Beauty Store",
      city: "Enugu",
      whatsappNumber: "2348069876543",
    },
  });

  // ── Workspace catalogue + orders ─────────────────────────────────────────
  const existingProducts = await prisma.product.count({ where: { workspaceId: resellerWorkspace.id } });
  if (existingProducts === 0) {
    const wig = await prisma.product.create({
      data: {
        workspaceId: resellerWorkspace.id,
        name: "Body Wave Wig 18in",
        sku: "WIG-BW-18",
        costPriceKobo: naira(28000),
        sellingPriceKobo: naira(42000),
        stockQty: 4,
        lowStockAt: 2,
      },
    });
    const clip = await prisma.product.create({
      data: {
        workspaceId: resellerWorkspace.id,
        name: "Clip-in Extensions (set)",
        sku: "CLIP-01",
        costPriceKobo: naira(6500),
        sellingPriceKobo: naira(11000),
        stockQty: 12,
        lowStockAt: 3,
      },
    });

    const customerA = await prisma.customer.create({
      data: { workspaceId: resellerWorkspace.id, name: "Blessing Nwosu", phone: "2348021112233" },
    });
    await prisma.customer.create({
      data: { workspaceId: resellerWorkspace.id, name: "Ify Okafor", phone: "2348095556677" },
    });

    const orderA = await prisma.customerOrder.create({
      data: {
        workspaceId: resellerWorkspace.id,
        customerId: customerA.id,
        orderNumber: "SF-2610-0001",
        channel: "WHATSAPP",
        status: "PROCESSING",
        totalKobo: naira(42000),
        costKobo: naira(28000),
        items: {
          create: [
            {
              productId: wig.id,
              name: wig.name,
              qty: 1,
              unitPriceKobo: wig.sellingPriceKobo,
              unitCostKobo: wig.costPriceKobo,
              lineTotalKobo: wig.sellingPriceKobo,
              lineCostKobo: wig.costPriceKobo,
            },
          ],
        },
      },
    });

    await prisma.manualPayment.create({
      data: {
        orderId: orderA.id,
        workspaceId: resellerWorkspace.id,
        amountKobo: naira(20000),
        method: "BANK_TRANSFER",
        paidAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5),
        reference: "GTB transfer 8821",
        recordedByProfileId: resellerProfile.id,
      },
    });

    await prisma.paymentPromise.create({
      data: {
        workspaceId: resellerWorkspace.id,
        orderId: orderA.id,
        customerId: customerA.id,
        amountKobo: naira(22000),
        promisedFor: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2),
        note: "Said she will balance after salary",
      },
    });

    await prisma.customerOrder.create({
      data: {
        workspaceId: resellerWorkspace.id,
        customerId: customerA.id,
        orderNumber: "SF-2610-0002",
        channel: "INSTAGRAM",
        status: "DELIVERED",
        totalKobo: naira(11000),
        costKobo: naira(6500),
        items: {
          create: [
            {
              productId: clip.id,
              name: clip.name,
              qty: 1,
              unitPriceKobo: clip.sellingPriceKobo,
              unitCostKobo: clip.costPriceKobo,
              lineTotalKobo: clip.sellingPriceKobo,
              lineCostKobo: clip.costPriceKobo,
            },
          ],
        },
        payments: {
          create: {
            workspaceId: resellerWorkspace.id,
            amountKobo: naira(11000),
            method: "CASH",
            paidAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12),
            recordedByProfileId: resellerProfile.id,
          },
        },
      },
    });
  }

  // ── Marketplace listings, offers, agreement ───────────────────────────────
  const listingSeeds = [
    {
      slug: "body-wave-wig-18in",
      title: "Body Wave Wig 18in",
      publicPrice: naira(48000),
      resellerPrice: naira(38000),
      minResale: naira(45000),
      stock: 24,
      category: "Wigs",
    },
    {
      slug: "clip-in-extensions-set",
      title: "Clip-in Extensions (set)",
      publicPrice: naira(14500),
      resellerPrice: naira(9500),
      minResale: naira(12000),
      stock: 60,
      category: "Extensions",
    },
  ];

  for (const seed of listingSeeds) {
    const existing = await prisma.productListing.findUnique({ where: { slug: seed.slug } });
    if (existing) continue;

    const listing = await prisma.productListing.create({
      data: {
        supplierProfileId: supplier.id,
        slug: seed.slug,
        title: seed.title,
        description: `${seed.title} — bulk stock from Chidi Wholesale. Confirm stock before paying.`,
        category: seed.category,
        publicPriceKobo: seed.publicPrice,
        moq: 6,
        stockQty: seed.stock,
        isPublished: true,
      },
    });

    const offer = await prisma.resellerOffer.create({ data: { listingId: listing.id } });
    const version = await prisma.resellerOfferVersion.create({
      data: {
        offerId: offer.id,
        version: 1,
        resellerPriceKobo: seed.resellerPrice,
        minResalePriceKobo: seed.minResale,
        commissionType: "NONE",
        moq: 6,
        stockQty: seed.stock,
        paymentTermsDays: 0,
        deliveryResponsibility: "SUPPLIER",
        advertisingPermission: true,
        customerDataVisibility: "ORDER_ONLY",
        createdByProfileId: supplierProfile.id,
        notes: "Reseller price valid for approved partners only.",
      },
    });
    await prisma.resellerOffer.update({
      where: { id: offer.id },
      data: { currentVersionId: version.id },
    });

    const application = await prisma.resellerApplication.upsert({
      where: {
        supplierProfileId_resellerProfileId: {
          supplierProfileId: supplier.id,
          resellerProfileId: resellerProfile.id,
        },
      },
      update: {},
      create: {
        supplierProfileId: supplier.id,
        resellerProfileId: resellerProfile.id,
        offerId: offer.id,
        status: "APPROVED",
        message: "I sell hair products on Instagram in Enugu.",
        businessSummary: "Amaka Beauty Store, ~30 orders/month",
        verificationTierAtApply: 1,
        decidedAt: new Date(),
        decidedByProfileId: supplierProfile.id,
      },
    });

    const agreement = await prisma.resellerAgreement.upsert({
      where: {
        offerId_resellerProfileId: { offerId: offer.id, resellerProfileId: resellerProfile.id },
      },
      update: {},
      create: {
        offerId: offer.id,
        supplierProfileId: supplier.id,
        resellerProfileId: resellerProfile.id,
        status: "ACTIVE",
      },
    });

    const agreementVersion = await prisma.resellerAgreementVersion.create({
      data: {
        agreementId: agreement.id,
        version: 1,
        resellerPriceKobo: seed.resellerPrice,
        minResalePriceKobo: seed.minResale,
        commissionType: "NONE",
        moq: 6,
        paymentTermsDays: 0,
        deliveryResponsibility: "SUPPLIER",
        advertisingPermission: true,
        customerDataVisibility: "ORDER_ONLY",
        createdByProfileId: supplierProfile.id,
        acceptedBySupplierAt: new Date(),
        acceptedByResellerAt: new Date(),
      },
    });

    await prisma.resellerAgreement.update({
      where: { id: agreement.id },
      data: { currentVersionId: agreementVersion.id },
    });

    console.log(`  application ${application.id.slice(0, 6)}… approved for ${seed.title}`);
  }

  // ── Mediator account ──────────────────────────────────────────────────────
  const mediatorUser = await prisma.user.upsert({
    where: { email: "mediator@sellflow.test" },
    update: {},
    create: { email: "mediator@sellflow.test", passwordHash, emailVerifiedAt: new Date() },
  });

  const mediatorProfile = await prisma.profile.upsert({
    where: { userId: mediatorUser.id },
    update: {},
    create: {
      userId: mediatorUser.id,
      displayName: "Tunde Balogun",
      phone: "2348053334455",
      city: "Abuja",
      state: "FCT",
      verificationTier: 3,
      tierUpdatedAt: new Date(),
    },
  });

  for (const role of ["BUSINESS_OWNER", "MEDIATOR"]) {
    await prisma.profileRole.upsert({
      where: { profileId_role: { profileId: mediatorProfile.id, role } },
      update: {},
      create: { profileId: mediatorProfile.id, role },
    });
  }

  await prisma.businessWorkspace.upsert({
    where: { ownerProfileId: mediatorProfile.id },
    update: {},
    create: {
      ownerProfileId: mediatorProfile.id,
      name: "SellFlow Mediation Desk",
      city: "Abuja",
      whatsappNumber: "2348053334455",
    },
  });

  // ── One live dispute so the mediator queue is not empty ───────────────────
  const demoOrderNumber = "SO-2610-0001";
  const existingDemoOrder = await prisma.supplierOrder.findUnique({ where: { orderNumber: demoOrderNumber } });

  if (!existingDemoOrder) {
    const wigListing = await prisma.productListing.findUnique({
      where: { slug: "body-wave-wig-18in" },
      include: { offer: { include: { currentVersion: true } } },
    });

    if (wigListing?.offer?.currentVersion) {
      const price = wigListing.offer.currentVersion.resellerPriceKobo;
      const qty = 6;

      const agreement = await prisma.resellerAgreement.findUnique({
        where: { offerId_resellerProfileId: { offerId: wigListing.offer.id, resellerProfileId: resellerProfile.id } },
        include: { currentVersion: true },
      });

      const order = await prisma.supplierOrder.create({
        data: {
          orderNumber: demoOrderNumber,
          resellerProfileId: resellerProfile.id,
          supplierProfileId: supplier.id,
          resellerWorkspaceId: resellerWorkspace.id,
          status: "AWAITING_PAYMENT",
          subtotalKobo: price * qty,
          totalKobo: price * qty,
          stockStatus: "CONFIRMED",
          stockConfirmedAt: new Date(Date.now() - 1000 * 60 * 60 * 30),
          stockConfirmedByProfileId: supplierProfile.id,
          paymentClaimStatus: "DISPUTED",
          notes: "Reseller asked for 6 pieces after the price went up.",
          items: {
            create: [
              {
                listingId: wigListing.id,
                offerVersionId: wigListing.offer.currentVersionId,
                agreementVersionId: agreement?.currentVersionId ?? null,
                title: wigListing.title,
                qty,
                unitPriceKobo: price,
                lineTotalKobo: price * qty,
                resalePriceKobo: naira(42000),
                stockConfirmedQty: qty,
              },
            ],
          },
        },
      });

      const claim = await prisma.paymentStatusClaim.create({
        data: {
          supplierOrderId: order.id,
          claimedByProfileId: resellerProfile.id,
          claimedByRole: "RESELLER",
          status: "DISPUTED",
          amountKobo: price * qty,
          method: "BANK_TRANSFER",
          reference: "GTB 4417",
          note: "Sent on Monday morning.",
          claimedAt: new Date(Date.now() - 1000 * 60 * 60 * 20),
        },
      });

      const dispute = await prisma.dispute.create({
        data: {
          reference: "DSP-DEMO-01",
          supplierOrderId: order.id,
          claimId: claim.id,
          raisedByProfileId: supplierProfile.id,
          raisedByRole: "SUPPLIER",
          againstProfileId: resellerProfile.id,
          reason: "PAYMENT_NOT_RECEIVED",
          description:
            "Reseller says the transfer was sent on Monday, but no credit reached the GTB account and the reference does not match any alert. Asking for a bank statement or a fresh transfer before dispatch.",
          status: "OPEN",
          events: {
            create: [
              {
                actorProfileId: supplierProfile.id,
                actorRole: "SUPPLIER",
                type: "STATUS_CHANGE",
                body: `Dispute opened on payment claim ${claim.reference}`,
                metadataJson: JSON.stringify({ reason: "PAYMENT_NOT_RECEIVED", claimId: claim.id }),
              },
              {
                actorProfileId: resellerProfile.id,
                actorRole: "RESELLER",
                type: "EVIDENCE",
                body: "I have the debit alert screenshot; will upload it when I get to the shop.",
              },
            ],
          },
        },
      });

      console.log(`  dispute ${dispute.reference} opened on ${order.orderNumber}`);
    }
  }

  // ── Billing: comped supplier plan, Free everywhere else ───────────────────
  const supplierWorkspaceId = supplierWorkspace.id;
  const supplierPeriodEnd = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);

  await prisma.subscription.upsert({
    where: { workspaceId: supplierWorkspaceId },
    update: {},
    create: {
      workspaceId: supplierWorkspaceId,
      tier: "SUPPLIER_PRO",
      status: "ACTIVE",
      currentPeriodStart: new Date(),
      currentPeriodEnd: supplierPeriodEnd,
      activatedAt: new Date(),
      note: "Comped for the demo: Supplier Pro is required to publish new agreement versions.",
    },
  });

  for (const workspaceId of [resellerWorkspace.id]) {
    await prisma.subscription.upsert({
      where: { workspaceId },
      update: {},
      create: { workspaceId, tier: "FREE", status: "ACTIVE" },
    });
  }

  // ── Platform admin (confirms manual upgrade transfers) ────────────────────
  // Never elevate an account that already exists: the seed creates the demo
  // admin, it does not promote whatever happens to own that address.
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@sellflow.test" },
    update: {},
    create: {
      email: "admin@sellflow.test",
      passwordHash,
      emailVerifiedAt: new Date(),
      isPlatformAdmin: true,
    },
  });

  const adminProfile = await prisma.profile.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      userId: adminUser.id,
      displayName: "SellFlow Ops",
      phone: "2348000000000",
      city: "Lagos",
      state: "Lagos",
      verificationTier: 3,
      tierUpdatedAt: new Date(),
    },
  });

  await prisma.profileRole.upsert({
    where: { profileId_role: { profileId: adminProfile.id, role: "BUSINESS_OWNER" } },
    update: {},
    create: { profileId: adminProfile.id, role: "BUSINESS_OWNER" },
  });

  const adminWorkspace = await prisma.businessWorkspace.upsert({
    where: { ownerProfileId: adminProfile.id },
    update: {},
    create: {
      ownerProfileId: adminProfile.id,
      name: "SellFlow Operations",
      city: "Lagos",
      whatsappNumber: "2348000000000",
    },
  });

  await prisma.subscription.upsert({
    where: { workspaceId: adminWorkspace.id },
    update: {},
    create: { workspaceId: adminWorkspace.id, tier: "FREE", status: "ACTIVE" },
  });

  // ── Audit trail ──────────────────────────────────────────────────────────
  // The audited database shipped with an empty AuditLog while seeded activity
  // existed, which made working auditing look broken (S-12). Seed a short,
  // representative trail. Fixed ids keep re-running the seed idempotent.
  const seededAuditRows = [
    {
      id: "seed-audit-login-reseller",
      actorProfileId: resellerProfile.id,
      actorRole: "BUSINESS_OWNER",
      action: "auth.login",
      entityType: "Session",
      entityId: resellerUser.id,
      metadataJson: JSON.stringify({ seeded: true }),
    },
    {
      id: "seed-audit-login-supplier",
      actorProfileId: supplierProfile.id,
      actorRole: "SUPPLIER",
      action: "auth.login",
      entityType: "Session",
      entityId: supplierUser.id,
      metadataJson: JSON.stringify({ seeded: true }),
    },
    {
      id: "seed-audit-role-supplier",
      actorProfileId: supplierProfile.id,
      actorRole: "BUSINESS_OWNER",
      action: "profile.role_granted",
      entityType: "Profile",
      entityId: supplierProfile.id,
      metadataJson: JSON.stringify({ role: "SUPPLIER", seeded: true }),
    },
    {
      id: "seed-audit-order-reseller",
      actorProfileId: resellerProfile.id,
      actorRole: "BUSINESS_OWNER",
      action: "supplier_order.created",
      entityType: "SupplierOrder",
      entityId: existingDemoOrder?.id ?? "seed-demo-order",
      metadataJson: JSON.stringify({ seeded: true }),
    },
  ];

  // Upsert per row: the audit trail is append-only, so re-seeding never rewrites
  // or deletes an existing entry, it only fills in what is missing.
  for (const row of seededAuditRows) {
    await prisma.auditLog.upsert({ where: { id: row.id }, update: {}, create: row });
  }

  // Credentials are intentionally not printed: this output ends up in CI logs
  // and shell scrollback. They are documented in this file for local use only.
  console.log("Done. Four demo accounts and a demo audit trail created for local development.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
