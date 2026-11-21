-- CreateEnum
CREATE TYPE "ShippingProvider" AS ENUM ('NAVLUNGO', 'YURTICI', 'ARAS', 'MNG', 'UPS', 'HEPSIJET', 'KOLAY_GELSIN', 'CUSTOM_MANUAL');

-- CreateEnum
CREATE TYPE "ShippingMode" AS ENUM ('INTEGRATED_CARGO', 'MANUAL_TRACKING');

-- CreateEnum
CREATE TYPE "ContentTriggerRule" AS ENUM ('AFTER_DELIVERY', 'ANYTIME');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING_ADDRESS', 'READY_TO_SHIP', 'LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'RETURNED');

-- CreateTable
CREATE TABLE "brand_shipping_integrations" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "provider" "ShippingProvider" NOT NULL,
    "api_key" TEXT,
    "api_secret" TEXT,
    "customer_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "default_sender_address_id" TEXT,
    "sender_address" JSONB,
    "last_tested_at" TIMESTAMP(3),
    "last_test_ok" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_shipping_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_shipping_configs" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "requires_product_shipment" BOOLEAN NOT NULL DEFAULT false,
    "shipping_mode" "ShippingMode" NOT NULL DEFAULT 'MANUAL_TRACKING',
    "product_details" JSONB NOT NULL DEFAULT '{}',
    "content_trigger_rule" "ContentTriggerRule" NOT NULL DEFAULT 'AFTER_DELIVERY',
    "content_deadline_days" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_shipping_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "influencer_addresses" (
    "id" TEXT NOT NULL,
    "influencer_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Ev',
    "recipient_name" TEXT NOT NULL,
    "recipient_phone" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "postal_code" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "influencer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "collaboration_id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "assignment_id" TEXT,
    "offer_id" TEXT,
    "brand_id" TEXT NOT NULL,
    "influencer_id" TEXT NOT NULL,
    "recipient_name" TEXT,
    "recipient_phone" TEXT,
    "shipping_address" JSONB,
    "selected_variant" JSONB,
    "provider" "ShippingProvider",
    "carrier_name" TEXT,
    "tracking_number" TEXT,
    "tracking_url" TEXT,
    "barcode_label_url" TEXT,
    "external_shipment_id" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING_ADDRESS',
    "estimated_delivery_date" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brand_shipping_integrations_brand_id_idx" ON "brand_shipping_integrations"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "brand_shipping_integrations_brand_id_provider_key" ON "brand_shipping_integrations"("brand_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_shipping_configs_campaign_id_key" ON "campaign_shipping_configs"("campaign_id");

-- CreateIndex
CREATE INDEX "influencer_addresses_influencer_id_idx" ON "influencer_addresses"("influencer_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_collaboration_id_key" ON "shipments"("collaboration_id");

-- CreateIndex
CREATE INDEX "shipments_campaign_id_status_idx" ON "shipments"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "shipments_brand_id_status_idx" ON "shipments"("brand_id", "status");

-- CreateIndex
CREATE INDEX "shipments_influencer_id_status_idx" ON "shipments"("influencer_id", "status");

-- CreateIndex
CREATE INDEX "shipments_tracking_number_idx" ON "shipments"("tracking_number");

-- AddForeignKey
ALTER TABLE "brand_shipping_integrations" ADD CONSTRAINT "brand_shipping_integrations_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_shipping_configs" ADD CONSTRAINT "campaign_shipping_configs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influencer_addresses" ADD CONSTRAINT "influencer_addresses_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_influencer_id_fkey" FOREIGN KEY ("influencer_id") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

