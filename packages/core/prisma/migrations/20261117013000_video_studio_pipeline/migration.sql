-- CreateTable
CREATE TABLE "video_pipeline_jobs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "aspect" TEXT NOT NULL DEFAULT '9:16',
    "model_key" TEXT NOT NULL DEFAULT 'hailuo',
    "source_upload_ids" JSONB NOT NULL,
    "storyboard" JSONB,
    "edit_plan" JSONB,
    "scene_jobs" JSONB,
    "voiceover_audio" TEXT,
    "music_audio" TEXT,
    "logo_upload_id" TEXT,
    "output_upload_id" TEXT,
    "root_job_id" TEXT,
    "version_number" INTEGER NOT NULL DEFAULT 1,
    "credit_hold_id" TEXT,
    "cost_usd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_pipeline_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_versions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pipeline_job_id" TEXT NOT NULL,
    "root_job_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "upload_id" TEXT NOT NULL,
    "edit_command" TEXT,
    "edit_plan" JSONB,
    "parent_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_pipeline_jobs_tenant_id_created_at_idx" ON "video_pipeline_jobs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "video_pipeline_jobs_status_created_at_idx" ON "video_pipeline_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "video_pipeline_jobs_root_job_id_version_number_idx" ON "video_pipeline_jobs"("root_job_id", "version_number");

-- CreateIndex
CREATE INDEX "video_versions_tenant_id_root_job_id_version_number_idx" ON "video_versions"("tenant_id", "root_job_id", "version_number");

-- AddForeignKey
ALTER TABLE "video_versions" ADD CONSTRAINT "video_versions_pipeline_job_id_fkey" FOREIGN KEY ("pipeline_job_id") REFERENCES "video_pipeline_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

