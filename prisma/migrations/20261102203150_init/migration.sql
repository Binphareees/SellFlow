-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" DATETIME,
    "lastLoginAt" DATETIME,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "disabledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "avatarUrl" TEXT,
    "verificationTier" INTEGER NOT NULL DEFAULT 0,
    "tierUpdatedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProfileRole" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "grantedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProfileRole_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "fromTier" INTEGER NOT NULL,
    "toTier" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceRef" TEXT,
    "reviewedByProfileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationEvent_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessWorkspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "whatsappNumber" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessWorkspace_ownerProfileId_fkey" FOREIGN KEY ("ownerProfileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME,
    CONSTRAINT "Customer_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "BusinessWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'unit',
    "costPriceKobo" INTEGER NOT NULL DEFAULT 0,
    "sellingPriceKobo" INTEGER NOT NULL DEFAULT 0,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "lowStockAt" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "BusinessWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "channel" TEXT NOT NULL DEFAULT 'WHATSAPP',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "totalKobo" INTEGER NOT NULL DEFAULT 0,
    "costKobo" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "cancelledAt" DATETIME,
    "deletedAt" DATETIME,
    CONSTRAINT "CustomerOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "BusinessWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceKobo" INTEGER NOT NULL,
    "unitCostKobo" INTEGER NOT NULL DEFAULT 0,
    "lineTotalKobo" INTEGER NOT NULL,
    "lineCostKobo" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ManualPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "paidAt" DATETIME NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "recordedByProfileId" TEXT,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ManualPayment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ManualPayment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "BusinessWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "depositKobo" INTEGER NOT NULL DEFAULT 0,
    "installmentCount" INTEGER NOT NULL DEFAULT 1,
    "frequency" TEXT NOT NULL DEFAULT 'MONTHLY',
    "startDate" DATETIME NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentPlan_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentPlan_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "BusinessWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentPromise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amountKobo" INTEGER NOT NULL,
    "promisedFor" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentPromise_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentPromise_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentPromise_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "BusinessWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "about" TEXT,
    "logoUrl" TEXT,
    "city" TEXT,
    "state" TEXT,
    "verificationTier" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "BusinessWorkspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierProfile_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductListing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierProfileId" TEXT NOT NULL,
    "productId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imagesJson" TEXT NOT NULL DEFAULT '[]',
    "category" TEXT,
    "publicPriceKobo" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "moq" INTEGER NOT NULL DEFAULT 1,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductListing_supplierProfileId_fkey" FOREIGN KEY ("supplierProfileId") REFERENCES "SupplierProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductListing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResellerOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listingId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResellerOffer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ProductListing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResellerOffer_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ResellerOfferVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResellerOfferVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "resellerPriceKobo" INTEGER NOT NULL,
    "minResalePriceKobo" INTEGER,
    "commissionType" TEXT NOT NULL DEFAULT 'NONE',
    "commissionValue" INTEGER NOT NULL DEFAULT 0,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "stockQty" INTEGER NOT NULL DEFAULT 0,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "deliveryResponsibility" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "advertisingPermission" BOOLEAN NOT NULL DEFAULT false,
    "customerDataVisibility" TEXT NOT NULL DEFAULT 'ORDER_ONLY',
    "notes" TEXT,
    "createdByProfileId" TEXT,
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResellerOfferVersion_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ResellerOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResellerApplication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierProfileId" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "offerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "businessSummary" TEXT,
    "verificationTierAtApply" INTEGER NOT NULL DEFAULT 0,
    "decidedAt" DATETIME,
    "decidedByProfileId" TEXT,
    "decisionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ResellerApplication_supplierProfileId_fkey" FOREIGN KEY ("supplierProfileId") REFERENCES "SupplierProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResellerApplication_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResellerApplication_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ResellerOffer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResellerAgreement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "offerId" TEXT NOT NULL,
    "supplierProfileId" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "terminatedAt" DATETIME,
    "terminationReason" TEXT,
    CONSTRAINT "ResellerAgreement_supplierProfileId_fkey" FOREIGN KEY ("supplierProfileId") REFERENCES "SupplierProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResellerAgreement_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResellerAgreement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "ResellerOffer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResellerAgreement_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "ResellerAgreementVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResellerAgreementVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agreementId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "resellerPriceKobo" INTEGER NOT NULL,
    "minResalePriceKobo" INTEGER,
    "commissionType" TEXT NOT NULL DEFAULT 'NONE',
    "commissionValue" INTEGER NOT NULL DEFAULT 0,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "deliveryResponsibility" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "advertisingPermission" BOOLEAN NOT NULL DEFAULT false,
    "customerDataVisibility" TEXT NOT NULL DEFAULT 'ORDER_ONLY',
    "effectiveFrom" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" DATETIME,
    "acceptedByResellerAt" DATETIME,
    "acceptedBySupplierAt" DATETIME,
    "createdByProfileId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResellerAgreementVersion_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "ResellerAgreement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NegotiationProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agreementId" TEXT NOT NULL,
    "offerVersionId" TEXT,
    "proposedByProfileId" TEXT NOT NULL,
    "proposedByRole" TEXT NOT NULL,
    "resellerPriceKobo" INTEGER NOT NULL,
    "minResalePriceKobo" INTEGER,
    "commissionType" TEXT NOT NULL DEFAULT 'NONE',
    "commissionValue" INTEGER NOT NULL DEFAULT 0,
    "moq" INTEGER NOT NULL DEFAULT 1,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "deliveryResponsibility" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "advertisingPermission" BOOLEAN NOT NULL DEFAULT false,
    "customerDataVisibility" TEXT NOT NULL DEFAULT 'ORDER_ONLY',
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "respondedAt" DATETIME,
    "respondedByProfileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NegotiationProposal_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "ResellerAgreement" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NegotiationProposal_offerVersionId_fkey" FOREIGN KEY ("offerVersionId") REFERENCES "ResellerOfferVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NegotiationProposal_proposedByProfileId_fkey" FOREIGN KEY ("proposedByProfileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "resellerProfileId" TEXT NOT NULL,
    "supplierProfileId" TEXT NOT NULL,
    "resellerWorkspaceId" TEXT,
    "customerOrderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "subtotalKobo" INTEGER NOT NULL DEFAULT 0,
    "totalKobo" INTEGER NOT NULL DEFAULT 0,
    "stockStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "stockConfirmedAt" DATETIME,
    "stockConfirmedByProfileId" TEXT,
    "stockNote" TEXT,
    "paymentClaimStatus" TEXT NOT NULL DEFAULT 'NONE',
    "dispatchedAt" DATETIME,
    "deliveredAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierOrder_resellerProfileId_fkey" FOREIGN KEY ("resellerProfileId") REFERENCES "Profile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierOrder_supplierProfileId_fkey" FOREIGN KEY ("supplierProfileId") REFERENCES "SupplierProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierOrder_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupplierOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierOrderId" TEXT NOT NULL,
    "listingId" TEXT,
    "offerVersionId" TEXT,
    "agreementVersionId" TEXT,
    "title" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceKobo" INTEGER NOT NULL,
    "lineTotalKobo" INTEGER NOT NULL,
    "resalePriceKobo" INTEGER,
    "stockConfirmedQty" INTEGER,
    "note" TEXT,
    CONSTRAINT "SupplierOrderItem_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierOrderItem_offerVersionId_fkey" FOREIGN KEY ("offerVersionId") REFERENCES "ResellerOfferVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SupplierOrderItem_agreementVersionId_fkey" FOREIGN KEY ("agreementVersionId") REFERENCES "ResellerAgreementVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentStatusClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierOrderId" TEXT NOT NULL,
    "claimedByProfileId" TEXT NOT NULL,
    "claimedByRole" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "amountKobo" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" TEXT,
    "note" TEXT,
    "claimedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" DATETIME,
    "confirmedByProfileId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentStatusClaim_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DispatchRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierOrderId" TEXT NOT NULL,
    "courierName" TEXT,
    "trackingRef" TEXT,
    "itemSummary" TEXT,
    "dispatchedByProfileId" TEXT,
    "dispatchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "DispatchRecord_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierOrderId" TEXT NOT NULL,
    "confirmedByProfileId" TEXT NOT NULL,
    "confirmedByRole" TEXT NOT NULL,
    "receivedQtyOk" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "confirmedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryConfirmation_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "supplierOrderId" TEXT,
    "raisedByProfileId" TEXT NOT NULL,
    "raisedByRole" TEXT NOT NULL,
    "againstProfileId" TEXT,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "assignedMediatorProfileId" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dispute_supplierOrderId_fkey" FOREIGN KEY ("supplierOrderId") REFERENCES "SupplierOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DisputeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "disputeId" TEXT NOT NULL,
    "actorProfileId" TEXT,
    "actorRole" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeEvent_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorProfileId" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadataJson" TEXT,
    "ipHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Profile_verificationTier_idx" ON "Profile"("verificationTier");

-- CreateIndex
CREATE INDEX "ProfileRole_role_idx" ON "ProfileRole"("role");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileRole_profileId_role_key" ON "ProfileRole"("profileId", "role");

-- CreateIndex
CREATE INDEX "VerificationEvent_profileId_createdAt_idx" ON "VerificationEvent"("profileId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessWorkspace_ownerProfileId_key" ON "BusinessWorkspace"("ownerProfileId");

-- CreateIndex
CREATE INDEX "Customer_workspaceId_name_idx" ON "Customer"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "Customer_workspaceId_phone_idx" ON "Customer"("workspaceId", "phone");

-- CreateIndex
CREATE INDEX "Product_workspaceId_isActive_idx" ON "Product"("workspaceId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Product_workspaceId_sku_key" ON "Product"("workspaceId", "sku");

-- CreateIndex
CREATE INDEX "CustomerOrder_workspaceId_status_idx" ON "CustomerOrder"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "CustomerOrder_customerId_idx" ON "CustomerOrder"("customerId");

-- CreateIndex
CREATE INDEX "CustomerOrder_workspaceId_deletedAt_idx" ON "CustomerOrder"("workspaceId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_workspaceId_orderNumber_key" ON "CustomerOrder"("workspaceId", "orderNumber");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "ManualPayment_orderId_idx" ON "ManualPayment"("orderId");

-- CreateIndex
CREATE INDEX "ManualPayment_workspaceId_paidAt_idx" ON "ManualPayment"("workspaceId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPlan_orderId_key" ON "PaymentPlan"("orderId");

-- CreateIndex
CREATE INDEX "PaymentPromise_workspaceId_status_promisedFor_idx" ON "PaymentPromise"("workspaceId", "status", "promisedFor");

-- CreateIndex
CREATE INDEX "PaymentPromise_customerId_idx" ON "PaymentPromise"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_workspaceId_key" ON "SupplierProfile"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierProfile_profileId_key" ON "SupplierProfile"("profileId");

-- CreateIndex
CREATE INDEX "SupplierProfile_verificationTier_idx" ON "SupplierProfile"("verificationTier");

-- CreateIndex
CREATE UNIQUE INDEX "ProductListing_slug_key" ON "ProductListing"("slug");

-- CreateIndex
CREATE INDEX "ProductListing_supplierProfileId_isPublished_idx" ON "ProductListing"("supplierProfileId", "isPublished");

-- CreateIndex
CREATE INDEX "ProductListing_category_idx" ON "ProductListing"("category");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerOffer_listingId_key" ON "ResellerOffer"("listingId");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerOffer_currentVersionId_key" ON "ResellerOffer"("currentVersionId");

-- CreateIndex
CREATE INDEX "ResellerOfferVersion_offerId_effectiveFrom_idx" ON "ResellerOfferVersion"("offerId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerOfferVersion_offerId_version_key" ON "ResellerOfferVersion"("offerId", "version");

-- CreateIndex
CREATE INDEX "ResellerApplication_status_supplierProfileId_idx" ON "ResellerApplication"("status", "supplierProfileId");

-- CreateIndex
CREATE INDEX "ResellerApplication_resellerProfileId_status_idx" ON "ResellerApplication"("resellerProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerApplication_supplierProfileId_resellerProfileId_key" ON "ResellerApplication"("supplierProfileId", "resellerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerAgreement_currentVersionId_key" ON "ResellerAgreement"("currentVersionId");

-- CreateIndex
CREATE INDEX "ResellerAgreement_supplierProfileId_status_idx" ON "ResellerAgreement"("supplierProfileId", "status");

-- CreateIndex
CREATE INDEX "ResellerAgreement_resellerProfileId_status_idx" ON "ResellerAgreement"("resellerProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerAgreement_offerId_resellerProfileId_key" ON "ResellerAgreement"("offerId", "resellerProfileId");

-- CreateIndex
CREATE INDEX "ResellerAgreementVersion_agreementId_effectiveFrom_idx" ON "ResellerAgreementVersion"("agreementId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ResellerAgreementVersion_agreementId_version_key" ON "ResellerAgreementVersion"("agreementId", "version");

-- CreateIndex
CREATE INDEX "NegotiationProposal_agreementId_status_idx" ON "NegotiationProposal"("agreementId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOrder_orderNumber_key" ON "SupplierOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOrder_customerOrderId_key" ON "SupplierOrder"("customerOrderId");

-- CreateIndex
CREATE INDEX "SupplierOrder_supplierProfileId_status_idx" ON "SupplierOrder"("supplierProfileId", "status");

-- CreateIndex
CREATE INDEX "SupplierOrder_resellerProfileId_status_idx" ON "SupplierOrder"("resellerProfileId", "status");

-- CreateIndex
CREATE INDEX "SupplierOrder_createdAt_idx" ON "SupplierOrder"("createdAt");

-- CreateIndex
CREATE INDEX "SupplierOrderItem_supplierOrderId_idx" ON "SupplierOrderItem"("supplierOrderId");

-- CreateIndex
CREATE INDEX "PaymentStatusClaim_supplierOrderId_claimedAt_idx" ON "PaymentStatusClaim"("supplierOrderId", "claimedAt");

-- CreateIndex
CREATE INDEX "DispatchRecord_supplierOrderId_idx" ON "DispatchRecord"("supplierOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryConfirmation_supplierOrderId_key" ON "DeliveryConfirmation"("supplierOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_reference_key" ON "Dispute"("reference");

-- CreateIndex
CREATE INDEX "Dispute_status_createdAt_idx" ON "Dispute"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_supplierOrderId_idx" ON "Dispute"("supplierOrderId");

-- CreateIndex
CREATE INDEX "DisputeEvent_disputeId_createdAt_idx" ON "DisputeEvent"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorProfileId_createdAt_idx" ON "AuditLog"("actorProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
