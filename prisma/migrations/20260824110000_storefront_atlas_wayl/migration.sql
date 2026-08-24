-- Storefront publication, checkout, Wayl webhook, and customer-session support.

CREATE TYPE "StorefrontPaymentMode" AS ENUM ('WAYL', 'COD');
CREATE TYPE "StorefrontCheckoutStatus" AS ENUM ('CREATED', 'PAYMENT_PENDING', 'PAID', 'COD_PENDING', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVIEW');
CREATE TYPE "WaylWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'IGNORED');

ALTER TABLE "Product"
  ADD COLUMN "storefrontSlug" TEXT,
  ADD COLUMN "storefrontPublished" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allowBackorder" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProductGroup"
  ADD COLUMN "storefrontSlug" TEXT,
  ADD COLUMN "storefrontPublished" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Product"
SET "storefrontSlug" = lower(regexp_replace("sku", '[^a-zA-Z0-9]+', '-', 'g')),
    "storefrontPublished" = "isActive";

UPDATE "ProductGroup"
SET "storefrontSlug" = lower(regexp_replace("code", '[^a-zA-Z0-9]+', '-', 'g')),
    "storefrontPublished" = "isActive";

CREATE UNIQUE INDEX "Product_storefrontSlug_key" ON "Product"("storefrontSlug");
CREATE INDEX "Product_storefrontPublished_isActive_idx" ON "Product"("storefrontPublished", "isActive");
CREATE UNIQUE INDEX "ProductGroup_storefrontSlug_key" ON "ProductGroup"("storefrontSlug");
CREATE INDEX "ProductGroup_storefrontPublished_isActive_idx" ON "ProductGroup"("storefrontPublished", "isActive");

CREATE TABLE "StorefrontDeliveryZone" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "governorate" TEXT,
  "deliveryFee" INTEGER NOT NULL,
  "minimumOrder" INTEGER NOT NULL DEFAULT 0,
  "freeDeliveryAt" INTEGER,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorefrontDeliveryZone_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorefrontDeliveryZone_nonnegative" CHECK (
    "deliveryFee" >= 0 AND "minimumOrder" >= 0 AND ("freeDeliveryAt" IS NULL OR "freeDeliveryAt" >= 0)
  )
);

CREATE UNIQUE INDEX "StorefrontDeliveryZone_code_key" ON "StorefrontDeliveryZone"("code");
CREATE INDEX "StorefrontDeliveryZone_isActive_sortOrder_idx" ON "StorefrontDeliveryZone"("isActive", "sortOrder");
CREATE INDEX "StorefrontDeliveryZone_governorate_idx" ON "StorefrontDeliveryZone"("governorate");

CREATE TABLE "StorefrontCheckout" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "deliveryZoneId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "publicTokenHash" TEXT NOT NULL,
  "paymentMode" "StorefrontPaymentMode" NOT NULL,
  "status" "StorefrontCheckoutStatus" NOT NULL DEFAULT 'CREATED',
  "subtotal" INTEGER NOT NULL,
  "discountAmount" INTEGER NOT NULL DEFAULT 0,
  "deliveryFee" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "currency" "Currency" NOT NULL DEFAULT 'IQD',
  "quoteHash" TEXT NOT NULL,
  "waylReferenceId" TEXT,
  "waylLinkId" TEXT,
  "waylCode" TEXT,
  "waylUrl" TEXT,
  "waylStatus" TEXT,
  "expiresAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "reviewReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorefrontCheckout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorefrontCheckout_amounts_nonnegative" CHECK (
    "subtotal" >= 0 AND "discountAmount" >= 0 AND "deliveryFee" >= 0 AND "total" >= 0
  )
);

CREATE UNIQUE INDEX "StorefrontCheckout_orderId_key" ON "StorefrontCheckout"("orderId");
CREATE UNIQUE INDEX "StorefrontCheckout_idempotencyKey_key" ON "StorefrontCheckout"("idempotencyKey");
CREATE UNIQUE INDEX "StorefrontCheckout_publicTokenHash_key" ON "StorefrontCheckout"("publicTokenHash");
CREATE UNIQUE INDEX "StorefrontCheckout_waylReferenceId_key" ON "StorefrontCheckout"("waylReferenceId");
CREATE UNIQUE INDEX "StorefrontCheckout_waylLinkId_key" ON "StorefrontCheckout"("waylLinkId");
CREATE INDEX "StorefrontCheckout_status_createdAt_idx" ON "StorefrontCheckout"("status", "createdAt");
CREATE INDEX "StorefrontCheckout_paymentMode_status_idx" ON "StorefrontCheckout"("paymentMode", "status");

CREATE TABLE "WaylWebhookEvent" (
  "id" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "checkoutId" TEXT,
  "referenceId" TEXT NOT NULL,
  "eventType" TEXT,
  "signatureHash" TEXT,
  "payload" JSONB NOT NULL,
  "status" "WaylWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
  "errorCode" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "WaylWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WaylWebhookEvent_eventKey_key" ON "WaylWebhookEvent"("eventKey");
CREATE INDEX "WaylWebhookEvent_referenceId_receivedAt_idx" ON "WaylWebhookEvent"("referenceId", "receivedAt");
CREATE INDEX "WaylWebhookEvent_status_receivedAt_idx" ON "WaylWebhookEvent"("status", "receivedAt");

CREATE TABLE "StorefrontPasskeyCredential" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "publicKey" BYTEA NOT NULL,
  "counter" BIGINT NOT NULL DEFAULT 0,
  "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "deviceType" TEXT,
  "backedUp" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "StorefrontPasskeyCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorefrontPasskeyCredential_credentialId_key" ON "StorefrontPasskeyCredential"("credentialId");
CREATE INDEX "StorefrontPasskeyCredential_customerId_idx" ON "StorefrontPasskeyCredential"("customerId");

CREATE TABLE "StorefrontPasskeyChallenge" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "challenge" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorefrontPasskeyChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "StorefrontPasskeyChallenge_purpose_check" CHECK ("purpose" IN ('REGISTRATION', 'AUTHENTICATION'))
);

CREATE UNIQUE INDEX "StorefrontPasskeyChallenge_challenge_key" ON "StorefrontPasskeyChallenge"("challenge");
CREATE INDEX "StorefrontPasskeyChallenge_customerId_purpose_expiresAt_idx" ON "StorefrontPasskeyChallenge"("customerId", "purpose", "expiresAt");
CREATE INDEX "StorefrontPasskeyChallenge_expiresAt_usedAt_idx" ON "StorefrontPasskeyChallenge"("expiresAt", "usedAt");

CREATE TABLE "StorefrontCustomerSession" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StorefrontCustomerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorefrontCustomerSession_tokenHash_key" ON "StorefrontCustomerSession"("tokenHash");
CREATE INDEX "StorefrontCustomerSession_customerId_expiresAt_idx" ON "StorefrontCustomerSession"("customerId", "expiresAt");
CREATE INDEX "StorefrontCustomerSession_expiresAt_revokedAt_idx" ON "StorefrontCustomerSession"("expiresAt", "revokedAt");

ALTER TABLE "StorefrontCheckout" ADD CONSTRAINT "StorefrontCheckout_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontCheckout" ADD CONSTRAINT "StorefrontCheckout_deliveryZoneId_fkey"
  FOREIGN KEY ("deliveryZoneId") REFERENCES "StorefrontDeliveryZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WaylWebhookEvent" ADD CONSTRAINT "WaylWebhookEvent_checkoutId_fkey"
  FOREIGN KEY ("checkoutId") REFERENCES "StorefrontCheckout"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StorefrontPasskeyCredential" ADD CONSTRAINT "StorefrontPasskeyCredential_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontPasskeyChallenge" ADD CONSTRAINT "StorefrontPasskeyChallenge_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StorefrontCustomerSession" ADD CONSTRAINT "StorefrontCustomerSession_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
