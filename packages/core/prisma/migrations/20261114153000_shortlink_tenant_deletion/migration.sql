-- AlterTable
ALTER TABLE "short_links" ADD COLUMN "tenant_id" TEXT;

-- CreateIndex
CREATE INDEX "short_links_tenant_id_created_at_idx" ON "short_links"("tenant_id", "created_at");

-- CreateTable
CREATE TABLE "data_deletion_requests" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "meta_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_deletion_requests_code_key" ON "data_deletion_requests"("code");
