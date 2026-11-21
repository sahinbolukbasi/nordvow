-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN "display_name" TEXT;
ALTER TABLE "SocialAccount" ADD COLUMN "bio_snippet" TEXT;

-- CreateTable
CREATE TABLE "bot_link_flags" (
    "id" TEXT NOT NULL,
    "channel" "ChannelProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "user_ids" TEXT[] NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_link_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bot_link_flags_channel_external_id_idx" ON "bot_link_flags"("channel", "external_id");
