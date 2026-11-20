CREATE TYPE "BrandWalletEntryType" AS ENUM ('TOPUP', 'CREATIVE_USAGE', 'INFLUENCER_PAYMENT', 'SHIPPING', 'REFUND', 'ADJUSTMENT');
CREATE TYPE "WalletTopupStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'GENERATED', 'DOWNLOADED', 'CANCELLED');
CREATE TYPE "InvoiceScenario" AS ENUM ('EARSIVFATURA', 'TEMELFATURA');

CREATE TABLE "brand_addresses" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Merkez',
    "company_name" TEXT,
    "recipient_name" TEXT,
    "phone" TEXT NOT NULL,
    "address_line" TEXT NOT NULL,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "postal_code" TEXT,
    "tax_office" TEXT,
    "tax_number" TEXT,
    "is_billing" BOOLEAN NOT NULL DEFAULT false,
    "is_shipping" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "brand_addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "brand_wallet_entries" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "type" "BrandWalletEntryType" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount_kurus" INTEGER NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT,
    CONSTRAINT "brand_wallet_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_topup_requests" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "amount_kurus" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" "WalletTopupStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_id" TEXT,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "wallet_topup_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "scenario" "InvoiceScenario" NOT NULL DEFAULT 'EARSIVFATURA',
    "invoice_type" TEXT NOT NULL DEFAULT 'SATIS',
    "invoice_number" TEXT NOT NULL,
    "ettn" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL,
    "seller_snapshot" JSONB NOT NULL,
    "buyer_snapshot" JSONB NOT NULL,
    "totals_snapshot" JSONB NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "pdf_storage_key" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "line_number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price_kurus" INTEGER NOT NULL,
    "vat_rate" DECIMAL(5,2) NOT NULL,
    "vat_amount_kurus" INTEGER NOT NULL,
    "line_total_kurus" INTEGER NOT NULL,
    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LedgerEntry" ADD COLUMN "invoiceId" TEXT;
ALTER TABLE "shipments" ADD COLUMN "carrier_id" TEXT;
ALTER TABLE "shipments" ADD COLUMN "shipping_cost_kurus" INTEGER;
ALTER TABLE "shipments" ADD COLUMN "shipping_rate_snapshot" JSONB;
ALTER TABLE "brand_wallet_entries" ADD CONSTRAINT "brand_wallet_entries_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "brand_addresses" ADD CONSTRAINT "brand_addresses_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_wallet_entries" ADD CONSTRAINT "brand_wallet_entries_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_topup_requests" ADD CONSTRAINT "wallet_topup_requests_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "brand_wallet_entries_idempotency_key_key" ON "brand_wallet_entries"("idempotency_key");
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE UNIQUE INDEX "invoices_ettn_key" ON "invoices"("ettn");
CREATE UNIQUE INDEX "invoice_items_invoice_id_line_number_key" ON "invoice_items"("invoice_id", "line_number");
CREATE INDEX "brand_addresses_brand_id_is_billing_idx" ON "brand_addresses"("brand_id", "is_billing");
CREATE INDEX "brand_addresses_brand_id_is_shipping_idx" ON "brand_addresses"("brand_id", "is_shipping");
CREATE INDEX "brand_wallet_entries_brand_id_created_at_idx" ON "brand_wallet_entries"("brand_id", "created_at");
CREATE INDEX "brand_wallet_entries_brand_id_type_idx" ON "brand_wallet_entries"("brand_id", "type");
CREATE INDEX "wallet_topup_requests_brand_id_status_created_at_idx" ON "wallet_topup_requests"("brand_id", "status", "created_at");
CREATE INDEX "invoices_brand_id_created_at_idx" ON "invoices"("brand_id", "created_at");
CREATE INDEX "invoices_source_type_source_id_idx" ON "invoices"("source_type", "source_id");
CREATE INDEX "LedgerEntry_invoiceId_idx" ON "LedgerEntry"("invoiceId");
