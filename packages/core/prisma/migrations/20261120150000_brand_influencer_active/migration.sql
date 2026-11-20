ALTER TABLE "Brand" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Influencer" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Brand_isActive_idx" ON "Brand"("isActive");
CREATE INDEX IF NOT EXISTS "Influencer_isActive_idx" ON "Influencer"("isActive");
