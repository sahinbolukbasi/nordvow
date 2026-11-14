-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('AGENCY', 'BRAND', 'INFLUENCER_STUDIO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "MediaCapability" AS ENUM ('IMAGE_GENERATION', 'IMAGE_EDIT', 'VIDEO_GENERATION', 'VIDEO_EDIT', 'TTS', 'LIP_SYNC', 'AVATAR', 'UPSCALE', 'REMOVE_BACKGROUND');

-- CreateEnum
CREATE TYPE "MediaJobStatus" AS ENUM ('PENDING_RESERVATION', 'QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BiometricConsentType" AS ENUM ('VOICE_CLONING', 'AVATAR_LIPSYNC', 'DIGITAL_TWIN', 'IMAGE_RIGHTS');

-- CreateEnum
CREATE TYPE "LegalConsentStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "OrgType" NOT NULL DEFAULT 'BRAND',
    "tier" TEXT NOT NULL DEFAULT 'standard',
    "white_label_enabled" BOOLEAN NOT NULL DEFAULT false,
    "white_label_config" JSONB,
    "credit_margin_multiplier" DECIMAL(5,3) NOT NULL DEFAULT 1.0,
    "max_concurrent_jobs" INTEGER NOT NULL DEFAULT 5,
    "monthly_budget_cap_usd" DECIMAL(12,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_legal_consents" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "consent_type" "BiometricConsentType" NOT NULL,
    "legal_text_version" TEXT NOT NULL,
    "legal_text_hash" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "signature_evidence" TEXT,
    "status" "LegalConsentStatus" NOT NULL DEFAULT 'ACTIVE',
    "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "biometric_legal_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "health_score" DECIMAL(5,2) NOT NULL DEFAULT 100.0,
    "error_rate" DECIMAL(5,4) NOT NULL DEFAULT 0.0,
    "avg_latency_ms" INTEGER NOT NULL DEFAULT 500,
    "rate_limit_per_min" INTEGER,
    "last_checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_model_configs" (
    "alias" TEXT NOT NULL,
    "capability" "MediaCapability" NOT NULL,
    "display_name" TEXT NOT NULL,
    "primary_provider_id" TEXT NOT NULL,
    "primary_model_id" TEXT NOT NULL,
    "fallback_provider_id" TEXT,
    "fallback_model_id" TEXT,
    "official_cost_usd" DECIMAL(10,6) NOT NULL,
    "loaded_multiplier" DECIMAL(4,2) NOT NULL DEFAULT 1.15,
    "retail_multiplier" DECIMAL(4,2) NOT NULL DEFAULT 3.00,
    "credit_price" DECIMAL(10,3) NOT NULL,
    "unit_type" TEXT NOT NULL,
    "min_role" "Role" NOT NULL DEFAULT 'INFLUENCER',
    "is_draft_first_required" BOOLEAN NOT NULL DEFAULT false,
    "is_batch_supported" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "feature_flag" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_model_configs_pkey" PRIMARY KEY ("alias")
);

-- CreateTable
CREATE TABLE "media_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "user_id" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "capability" "MediaCapability" NOT NULL,
    "prompt" TEXT NOT NULL,
    "negative_prompt" TEXT,
    "prompt_hash" TEXT NOT NULL,
    "parameters" JSONB NOT NULL,
    "status" "MediaJobStatus" NOT NULL DEFAULT 'PENDING_RESERVATION',
    "provider_used" TEXT,
    "model_used" TEXT,
    "fallback_triggered" BOOLEAN NOT NULL DEFAULT false,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "credits_reserved" DECIMAL(14,3) NOT NULL,
    "credits_charged" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "official_cost_usd" DECIMAL(10,6),
    "loaded_cost_usd" DECIMAL(10,6),
    "margin_percentage" DECIMAL(5,2),
    "input_media_urls" TEXT[],
    "output_media_urls" TEXT[],
    "c2pa_manifest_id" TEXT,
    "moderation_passed" BOOLEAN NOT NULL DEFAULT false,
    "moderation_flag" TEXT,
    "consent_record_id" TEXT,
    "queue_job_id" TEXT,
    "inference_ms" INTEGER,
    "total_latency_ms" INTEGER,
    "error_message" TEXT,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "media_jobs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "organization_id" TEXT;

-- CreateIndex
CREATE INDEX "biometric_legal_consents_user_id_consent_type_status_idx" ON "biometric_legal_consents"("user_id", "consent_type", "status");

-- CreateIndex
CREATE INDEX "media_jobs_organization_id_created_at_idx" ON "media_jobs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "media_jobs_user_id_created_at_idx" ON "media_jobs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "media_jobs_prompt_hash_status_idx" ON "media_jobs"("prompt_hash", "status");

-- CreateIndex
CREATE INDEX "media_jobs_alias_status_idx" ON "media_jobs"("alias", "status");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_legal_consents" ADD CONSTRAINT "biometric_legal_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_legal_consents" ADD CONSTRAINT "biometric_legal_consents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_model_configs" ADD CONSTRAINT "media_model_configs_primary_provider_id_fkey" FOREIGN KEY ("primary_provider_id") REFERENCES "media_providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_model_configs" ADD CONSTRAINT "media_model_configs_fallback_provider_id_fkey" FOREIGN KEY ("fallback_provider_id") REFERENCES "media_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_alias_fkey" FOREIGN KEY ("alias") REFERENCES "media_model_configs"("alias") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_jobs" ADD CONSTRAINT "media_jobs_consent_record_id_fkey" FOREIGN KEY ("consent_record_id") REFERENCES "biometric_legal_consents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

