-- CreateEnum
CREATE TYPE "TikTokAccountStatus" AS ENUM ('active', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "TikTokPostSource" AS ENUM ('FILE_UPLOAD', 'PULL_FROM_URL');

-- CreateEnum
CREATE TYPE "TikTokPostStatus" AS ENUM ('PROCESSING_UPLOAD', 'PROCESSING_DOWNLOAD', 'SEND_TO_USER_INBOX', 'PUBLISH_COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "tiktok_accounts" (
    "id" TEXT NOT NULL,
    "nordvow_user_id" TEXT NOT NULL,
    "open_id" TEXT NOT NULL,
    "union_id" TEXT,
    "display_name" TEXT,
    "username" TEXT,
    "avatar_url" TEXT,
    "bio" TEXT,
    "profile_deep_link" TEXT,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "following_count" INTEGER NOT NULL DEFAULT 0,
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "video_count" INTEGER NOT NULL DEFAULT 0,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "access_expires_at" TIMESTAMP(3) NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3),
    "status" "TikTokAccountStatus" NOT NULL DEFAULT 'active',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tiktok_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiktok_videos" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "title" TEXT,
    "video_description" TEXT,
    "create_time" TIMESTAMP(3) NOT NULL,
    "cover_image_url" TEXT,
    "share_url" TEXT,
    "embed_link" TEXT,
    "duration" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "share_count" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiktok_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiktok_video_stats_daily" (
    "id" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "comment_count" INTEGER NOT NULL DEFAULT 0,
    "share_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tiktok_video_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiktok_account_stats_daily" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "video_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tiktok_account_stats_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tiktok_posts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "campaign_id" TEXT,
    "deliverable_id" TEXT,
    "publish_id" TEXT NOT NULL,
    "source" "TikTokPostSource" NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'DIRECT',
    "privacy_level" TEXT NOT NULL,
    "caption" TEXT,
    "brand_content_toggle" BOOLEAN NOT NULL DEFAULT false,
    "brand_organic_toggle" BOOLEAN NOT NULL DEFAULT false,
    "disable_duet" BOOLEAN NOT NULL DEFAULT false,
    "disable_comment" BOOLEAN NOT NULL DEFAULT false,
    "disable_stitch" BOOLEAN NOT NULL DEFAULT false,
    "status" "TikTokPostStatus" NOT NULL DEFAULT 'PROCESSING_UPLOAD',
    "fail_reason" TEXT,
    "published_video_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tiktok_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_accounts_open_id_key" ON "tiktok_accounts"("open_id");
CREATE INDEX "tiktok_accounts_nordvow_user_id_status_idx" ON "tiktok_accounts"("nordvow_user_id", "status");
CREATE INDEX "tiktok_accounts_access_expires_at_status_idx" ON "tiktok_accounts"("access_expires_at", "status");

-- CreateIndex
CREATE INDEX "tiktok_videos_account_id_create_time_idx" ON "tiktok_videos"("account_id", "create_time");

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_video_stats_daily_video_id_date_key" ON "tiktok_video_stats_daily"("video_id", "date");
CREATE INDEX "tiktok_video_stats_daily_date_idx" ON "tiktok_video_stats_daily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_account_stats_daily_account_id_date_key" ON "tiktok_account_stats_daily"("account_id", "date");
CREATE INDEX "tiktok_account_stats_daily_date_idx" ON "tiktok_account_stats_daily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "tiktok_posts_publish_id_key" ON "tiktok_posts"("publish_id");
CREATE INDEX "tiktok_posts_account_id_created_at_idx" ON "tiktok_posts"("account_id", "created_at");
CREATE INDEX "tiktok_posts_campaign_id_idx" ON "tiktok_posts"("campaign_id");
CREATE INDEX "tiktok_posts_status_idx" ON "tiktok_posts"("status");

-- AddForeignKey
ALTER TABLE "tiktok_accounts" ADD CONSTRAINT "tiktok_accounts_nordvow_user_id_fkey" FOREIGN KEY ("nordvow_user_id") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiktok_videos" ADD CONSTRAINT "tiktok_videos_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiktok_video_stats_daily" ADD CONSTRAINT "tiktok_video_stats_daily_video_id_fkey" FOREIGN KEY ("video_id") REFERENCES "tiktok_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiktok_account_stats_daily" ADD CONSTRAINT "tiktok_account_stats_daily_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiktok_posts" ADD CONSTRAINT "tiktok_posts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tiktok_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tiktok_posts" ADD CONSTRAINT "tiktok_posts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
