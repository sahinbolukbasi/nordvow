-- AlterTable
ALTER TABLE "User" ADD COLUMN "instagram_handle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_instagram_handle_key" ON "User"("instagram_handle");

-- Eski düz metin kodlar kullanılamaz; yenisi profilde üretilir.
DELETE FROM "bot_link_codes";

-- AlterTable
DROP INDEX IF EXISTS "bot_link_codes_code_idx";
ALTER TABLE "bot_link_codes" DROP COLUMN "code";
ALTER TABLE "bot_link_codes" ADD COLUMN "code_hash" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "bot_link_codes_user_id_expires_at_idx" ON "bot_link_codes"("user_id", "expires_at");

-- CreateTable
CREATE TABLE "bot_link_attempts" (
    "id" TEXT NOT NULL,
    "channel" "ChannelProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_link_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_link_events" (
    "id" TEXT NOT NULL,
    "channel" "ChannelProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bot_link_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_guest_drafts" (
    "id" TEXT NOT NULL,
    "channel" "ChannelProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "name" TEXT,
    "intent" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "org" TEXT,
    "note" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bot_guest_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_leads" (
    "id" TEXT NOT NULL,
    "channel" "ChannelProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "org" TEXT,
    "note" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'YENI',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "bot_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_link_attempts_channel_external_id_created_at_idx" ON "bot_link_attempts"("channel", "external_id", "created_at");
CREATE INDEX "bot_link_events_created_at_idx" ON "bot_link_events"("created_at");
CREATE UNIQUE INDEX "bot_guest_drafts_channel_external_id_key" ON "bot_guest_drafts"("channel", "external_id");
CREATE INDEX "bot_leads_channel_external_id_created_at_idx" ON "bot_leads"("channel", "external_id", "created_at");
CREATE INDEX "bot_leads_status_created_at_idx" ON "bot_leads"("status", "created_at");
