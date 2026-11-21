ALTER TABLE "Brand"
  ADD COLUMN "taxpayer_type" TEXT,
  ADD COLUMN "mersis_number" TEXT,
  ADD COLUMN "trade_registry_number" TEXT,
  ADD COLUMN "e_invoice_type" TEXT,
  ADD COLUMN "billing_email" TEXT,
  ADD COLUMN "billing_phone" TEXT;

ALTER TABLE "wallet_topup_requests"
  ADD COLUMN "receipt_storage_key" TEXT,
  ADD COLUMN "rejection_reason" TEXT;

ALTER TABLE "influencer_addresses"
  ADD COLUMN "neighborhood" TEXT,
  ADD COLUMN "address_description" TEXT;

CREATE TABLE "invoice_sequences" (
  "year" INTEGER NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("year")
);

CREATE UNIQUE INDEX "invoices_source_type_source_id_key"
  ON "invoices" ("source_type", "source_id");

CREATE OR REPLACE FUNCTION prevent_invoice_mutation()
RETURNS trigger AS $$
BEGIN
  IF NEW.brand_id IS DISTINCT FROM OLD.brand_id
    OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number
    OR NEW.ettn IS DISTINCT FROM OLD.ettn
    OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
    OR NEW.seller_snapshot IS DISTINCT FROM OLD.seller_snapshot
    OR NEW.buyer_snapshot IS DISTINCT FROM OLD.buyer_snapshot
    OR NEW.totals_snapshot IS DISTINCT FROM OLD.totals_snapshot
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.source_id IS DISTINCT FROM OLD.source_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Invoice kayıtları değiştirilemez; yalnızca durum güncellenebilir';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_immutable_fields
BEFORE UPDATE ON "invoices"
FOR EACH ROW EXECUTE FUNCTION prevent_invoice_mutation();
