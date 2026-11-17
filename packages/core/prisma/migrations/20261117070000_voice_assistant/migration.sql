-- CreateTable
CREATE TABLE "voice_assistant_configs" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "connect_phone_number" TEXT,
    "assistant_name" TEXT NOT NULL DEFAULT 'AI Asistan',
    "greeting_text" TEXT NOT NULL DEFAULT 'Merhaba, size nasıl yardımcı olabilirim? Görüşmemiz kalite ve KVKK kapsamında kayıt altına alınmaktadır.',
    "greeting_cache_key" TEXT,
    "tts_model_key" TEXT NOT NULL DEFAULT 'elevenlabs-v3',
    "tts_voice_id" TEXT NOT NULL DEFAULT 'tr-female-natural',
    "tone" TEXT NOT NULL DEFAULT 'samimi',
    "business_hours" JSONB,
    "routing_rules" JSONB,
    "blocked_topics" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_assistant_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_knowledge_docs" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "s3_key" TEXT NOT NULL,
    "metadata_s3_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "text_preview" TEXT,
    "ingestion_job_id" TEXT,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_knowledge_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_faq_items" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_faq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_call_logs" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "caller_phone" TEXT,
    "called_phone" TEXT,
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "outcome" TEXT NOT NULL DEFAULT 'resolved',
    "summary" TEXT,
    "transcript" JSONB,
    "sources_used" JSONB,
    "recording_s3_key" TEXT,
    "unanswered_questions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_call_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_callback_requests" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "call_log_id" TEXT,
    "caller_name" TEXT,
    "caller_phone" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'bekliyor',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_callback_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "voice_assistant_configs_brand_id_key" ON "voice_assistant_configs"("brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_assistant_configs_connect_phone_number_key" ON "voice_assistant_configs"("connect_phone_number");

-- CreateIndex
CREATE INDEX "voice_knowledge_docs_brand_id_created_at_idx" ON "voice_knowledge_docs"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_faq_items_brand_id_active_idx" ON "voice_faq_items"("brand_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "voice_call_logs_contact_id_key" ON "voice_call_logs"("contact_id");

-- CreateIndex
CREATE INDEX "voice_call_logs_brand_id_created_at_idx" ON "voice_call_logs"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_callback_requests_brand_id_status_created_at_idx" ON "voice_callback_requests"("brand_id", "status", "created_at");

