-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BlogStatus" AS ENUM ('DRAFT', 'PUBLISHED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BlogAudience" AS ENUM ('ALL', 'INFLUENCER', 'BRAND');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "blog_posts" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "cover_image_url" TEXT,
    "category" TEXT NOT NULL DEFAULT 'Influencer Pazarlama',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_audience" "BlogAudience" NOT NULL DEFAULT 'ALL',
    "status" "BlogStatus" NOT NULL DEFAULT 'DRAFT',
    "seo_title" TEXT,
    "seo_description" TEXT,
    "seo_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "author_name" TEXT NOT NULL DEFAULT 'Nordvow Editör',
    "reading_time_min" INTEGER NOT NULL DEFAULT 3,
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "read_count" INTEGER NOT NULL DEFAULT 0,
    "total_read_seconds" INTEGER NOT NULL DEFAULT 0,
    "last_read_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "blog_posts_slug_key" ON "blog_posts"("slug");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "blog_posts_status_published_at_idx" ON "blog_posts"("status", "published_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "blog_posts_category_idx" ON "blog_posts"("category");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "blog_posts_target_audience_idx" ON "blog_posts"("target_audience");
