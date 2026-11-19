/**
 * Demo data for local development and automated tests. Every name, price and
 * order here is invented.
 *
 * Ordinary demo accounts (non-privileged):
 *   supplier@sellflow.test  supplier, comped Supplier Pro
 *   reseller@sellflow.test  reseller, Free plan (so the caps can be felt)
 *
 * Privileged demo accounts (created ONLY when explicitly authorized):
 *   mediator@sellflow.test  mediator who can see every dispute
 *   admin@sellflow.test     platform admin who confirms manual upgrade transfers
 *
 * Ordinary and privileged accounts no longer share a single committed password.
 * Each group uses its own password, taken from an environment variable when
 * provided, or generated as a per-seed random value printed once to the console.
 * No password is committed to the repository.
 *
 * The reseller application is APPROVED and the agreement is ACTIVE, so the
 * private-price path can be exercised end to end. Delete the agreement or set it
 * back to PENDING_ACCEPTANCE to watch the price gate close.
 *
 * This dataset is a DEMO. `assertDemoSeedAllowed` from `scripts/seed-guard.ts`
 * refuses anything but an explicitly confirmed development/test run against a
 * disposable local target, before Prisma connects to the database. Creating the
 * privileged accounts additionally requires SEED_PRIVILEGED_DEMO_ACCOUNTS=true
 * (or ALLOW_PRIVILEGED_DEMO_SEED=true); ordinary seeding never creates them.
 *
 * Production initialization is `prisma migrate deploy` plus the pilot
 * onboarding tool (`npm run pilot:seed`), which takes its credentials from the
 * operator and creates no privileged demo account.
 *
 * ---------------------------------------------------------------------------
 * Reversible procedure for already-seeded development databases
 * ---------------------------------------------------------------------------
 * This seed NEVER overwrites or promotes an account that already exists
 * (every upsert uses `update: {}`). It also NEVER deletes or mutates existing
 * rows automatically. If an earlier seed created privileged demo accounts in a
 * development database, remove them manually before any pilot use:
 *
 *   1. Confirm the rows exist:
 *        SELECT id, email, isPlatformAdmin FROM "User"
 *        WHERE email IN ('mediator@sellflow.test','admin@sellflow.test');
 *
 *   2. Delete dependent rows first, then the accounts, in a single transaction:
 *        BEGIN;
 *        DELETE FROM "AuditLog"        WHERE "actorProfileId" IN (SELECT id FROM "Profile" WHERE "userId" IN (SELECT id FROM "User" WHERE email IN ('mediator@sellflow.test','admin@sellflow.test')));
 *        DELETE FROM "ProfileRole"     WHERE "profileId"     IN (SELECT id FROM "Profile" WHERE "userId" IN (SELECT id FROM "User" WHERE email IN ('mediator@sellflow.test','admin@sellflow.test')));
 *        DELETE FROM "Subscription"   WHERE "workspaceId"    IN (SELECT id FROM "BusinessWorkspace" WHERE "ownerProfileId" IN (SELECT id FROM "Profile" WHERE "userId" IN (SELECT id FROM "User" WHERE email IN ('mediator@sellflow.test','admin@sellflow.test'))));
 *        DELETE FROM "BusinessWorkspace" WHERE "ownerProfileId" IN (SELECT id FROM "Profile" WHERE "userId" IN (SELECT id FROM "User" WHERE email IN ('mediator@sellflow.test','admin@sellflow.test')));
 *        DELETE FROM "Profile"        WHERE "userId"         IN (SELECT id FROM "User" WHERE email IN ('mediator@sellflow.test','admin@sellflow.test'));
 *        DELETE FROM "User"           WHERE email            IN ('mediator@sellflow.test','admin@sellflow.test');
 *        COMMIT;
 *
 *   3. Alternatively, rotate their passwords through the password-reset flow
 *      and disable the accounts; this seed will not recreate or promote them.
 *
 *   4. Verify removal with the query in step 1 (expect 0 rows).
 *
 *   5. For a fully clean state, prefer a fresh disposable database:
 *        NODE_ENV=development SEED_DEMO_DATA=true DATABASE_URL=file:/tmp/... npm run db:reset
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import {
  assertDemoSeedAllowed,
  assertPrivilegedDemoSeedAllowed,
  isPrivilegedDemoSeedAuthorized,
} from "../scripts/seed-guard";

assertDemoSeedAllowed();

const privilegedBootstrapRequested = isPrivilegedDemoSeedAuthorized();
if (privilegedBootstrapRequested) {
  assertPrivilegedDemoSeedAllowed();
}

const prisma = new PrismaClient();

const ORDINARY_PASSWORD_ENV_NAMES = [
  "DEMO_SEED_PASSWORD",
  "DEMO_ACCOUNT_PASSWORD",
  "DEMO_PASSWORD",
];

const PRIVILEGED_PASSWORD_ENV_NAMES = [
  "PRIVILEGED_DEMO_PASSWORD",
  "DEMO_PRIVILEGED_PASSWORD",
  "ADMIN_DEMO_PASSWORD",
  "MEDIATOR_DEMO_PASSWORD",
];

function resolveSeedPassword(envNames: string[], label: string): string {
  for (const name of envNames) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  const generated = randomBytes(18).toString("base64url");
  console.log(
    `Generated ${label} password (shown once, not committed): ${generated}`,
  );
  console.log("Store it securely; this value will not be printed again.");
  return generated;
}

const naira = (value: number) => value * 100;

async function main() {
  console.log("Seeding SellFlow demo data…");

  const ordinaryPasswordHash = await bcrypt.hash(
    resolveSeedPassword(ORDINARY_PASSWORD_ENV_NAMES, "ordinary demo account"),
    10,
  );

  let privilegedPasswordHash: string | null = null;
  if (privilegedBootstrapRequested) {
    privilegedPasswordHash = await bcrypt.hash(
      resolveSeedPassword(PRIVILEGED_PASSWORD_ENV_NAMES, "privileged demo account"),
      10,
    );
  }

  // ── Supplier account ──────────────────────────────────────────────────────
  const supplierUser = await prisma.user.upsert({
    where: { email: "supplier@sellflow.test" },
    update: {},
    create: { email: "supplier@sellflow.test", passwordHash: ordinaryPasswordHash, emailVerifiedAt: new Date() },
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
    create: { email: "reseller@sellflow.test", passwordHash: ordinaryPasswordHash, emailVerifiedAt: new Date() },
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

  // ── Mediator account (privileged bootstrap only) ─────────────────────────
  let mediatorProfile: any = null;
  if (privilegedBootstrapRequested && privilegedPasswordHash) {
    const mediatorUser = await prisma.user.upsert({
      where: { email: "mediator@sellflow.test" },
      update: {},
      create: { email: "mediator@sellflow.test", passwordHash: privilegedPasswordHash, emailVerifiedAt: new Date() },
    });

    mediatorProfile = await prisma.profile.upsert({
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
  }

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

  // ── Platform admin (confirms manual upgrade transfers) — privileged only ─
  if (privilegedBootstrapRequested && privilegedPasswordHash) {
    // Never elevate an account that already exists: the seed creates the demo
    // admin, it does not promote whatever happens to own that address.
    const adminUser = await prisma.user.upsert({
      where: { email: "admin@sellflow.test" },
      update: {},
      create: {
        email: "admin@sellflow.test",
        passwordHash: privilegedPasswordHash,
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
  }

  // ── Audit trail ──────────────────────────────────────────────────────────
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

  for (const row of seededAuditRows) {
    await prisma.auditLog.upsert({ where: { id: row.id }, update: {}, create: row });
  }

  if (privilegedBootstrapRequested) {
    console.log("Done. Four demo accounts (ordinary + privileged bootstrap) and a demo audit trail created for local development.");
  } else {
    console.log("Done. Ordinary demo accounts (supplier, reseller) and demo data created. Privileged bootstrap SKIPPED: set SEED_PRIVILEGED_DEMO_ACCOUNTS=true to create mediator/admin.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
