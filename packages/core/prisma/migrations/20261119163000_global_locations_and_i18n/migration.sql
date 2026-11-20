-- Global konum hiyerarşisi (Country -> City -> PublicHoliday), çeviri geçersiz kılmaları (TranslationOverride)
-- ve Event planlama konum/saat dilimi/fiyat alanları.

CREATE TABLE IF NOT EXISTS "countries" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "names" JSONB NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "default_locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "working_hours" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "countries_code_key" ON "countries"("code");
CREATE INDEX IF NOT EXISTS "countries_is_active_sort_order_idx" ON "countries"("is_active", "sort_order");

CREATE TABLE IF NOT EXISTS "cities" (
    "id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "names" JSONB NOT NULL,
    "region_name" TEXT,
    "timezone" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "cities_country_id_slug_key" ON "cities"("country_id", "slug");
CREATE INDEX IF NOT EXISTS "cities_country_id_is_active_sort_order_idx" ON "cities"("country_id", "is_active", "sort_order");

CREATE TABLE IF NOT EXISTS "public_holidays" (
    "id" TEXT NOT NULL,
    "country_id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "names" JSONB NOT NULL,
    "is_recurring" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "public_holidays_country_id_date_key" ON "public_holidays"("country_id", "date");
CREATE INDEX IF NOT EXISTS "public_holidays_country_id_is_active_idx" ON "public_holidays"("country_id", "is_active");

CREATE TABLE IF NOT EXISTS "translation_overrides" (
    "id" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "translation_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "translation_overrides_locale_key_key" ON "translation_overrides"("locale", "key");
CREATE INDEX IF NOT EXISTS "translation_overrides_locale_idx" ON "translation_overrides"("locale");

ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "country_id" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "city_id" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "timezone" TEXT;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "price_minor" INTEGER;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "currency" TEXT;

CREATE INDEX IF NOT EXISTS "events_country_id_city_id_idx" ON "events"("country_id", "city_id");

DO $$ BEGIN
  ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_fkey"
    FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_country_id_fkey"
    FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_country_id_fkey"
    FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_city_id_fkey"
    FOREIGN KEY ("city_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
