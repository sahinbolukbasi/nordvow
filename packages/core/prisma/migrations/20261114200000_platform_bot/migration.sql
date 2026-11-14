-- AlterTable
ALTER TABLE "events" ADD COLUMN "price_kurus" INTEGER;

-- CreateTable
CREATE TABLE "channel_account_links" (
    "id" TEXT NOT NULL,
    "channel" "ChannelProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "channel_account_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_link_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_pending_actions" (
    "id" TEXT NOT NULL,
    "channel" "ChannelProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_tool_calls" (
    "id" TEXT NOT NULL,
    "channel" "ChannelProvider" NOT NULL,
    "external_id" TEXT NOT NULL,
    "user_id" TEXT,
    "tool" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_tool_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_settings" (
    "id" TEXT NOT NULL,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "instagram_enabled" BOOLEAN NOT NULL DEFAULT false,
    "messenger_enabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp_phone_number_id" TEXT,
    "ig_user_id" TEXT,
    "page_id" TEXT,
    "welcome_tr" TEXT NOT NULL DEFAULT 'Merhaba, ben Nordvow asistanıyım. Hesabınızı bağladıktan sonra kampanya, bakiye, kupon ve etkinliklerinizi sorabilirsiniz. Ayrıntı: /gizlilik',
    "welcome_en" TEXT NOT NULL DEFAULT 'Hi, I am the Nordvow assistant. Link your account to ask about campaigns, balance, coupons and events. Details: /gizlilik',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_account_links_channel_external_id_key" ON "channel_account_links"("channel", "external_id");
CREATE INDEX "channel_account_links_user_id_idx" ON "channel_account_links"("user_id");
CREATE INDEX "bot_link_codes_code_idx" ON "bot_link_codes"("code");
CREATE INDEX "bot_link_codes_user_id_idx" ON "bot_link_codes"("user_id");
CREATE UNIQUE INDEX "bot_pending_actions_channel_external_id_key" ON "bot_pending_actions"("channel", "external_id");
CREATE INDEX "bot_tool_calls_user_id_tool_created_at_idx" ON "bot_tool_calls"("user_id", "tool", "created_at");

-- AddForeignKey
ALTER TABLE "channel_account_links" ADD CONSTRAINT "channel_account_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bot_link_codes" ADD CONSTRAINT "bot_link_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
