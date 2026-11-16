/**
 * Canlıya geçiş temizlik betiği:
 * Tüm sahte/demo kullanıcıları, markaları, influencerları, kampanyaları, finansal/operasyonel
 * kayıtları ve mesajlaşma/creative test verilerini siler; gerçek sistem/çekirdek verilerini
 * (`config_values`, `model_registry`, `agent_templates`, `Category`, `country_rates`,
 * `notification_rules`, `notification_templates`, `page_permissions`, `media_providers`,
 * `media_model_configs`) KORUR.
 *
 * Kullanım:
 *   CONFIRM_CLEAN=yes npm run db:clean-prod
 *   CONFIRM_CLEAN=yes ADMIN_EMAIL=admin@alaniniz.com ADMIN_PASSWORD=GucluSifre123! npm run db:clean-prod
 *   CONFIRM_CLEAN=yes KEEP_ADMIN_EMAIL=mevcut@admin.com npm run db:clean-prod
 */
import bcrypt from "bcryptjs";
import { prisma } from "../src/db";
import { seedConfig } from "../src/config/store";
import { seedAgentTemplates } from "../src/assistant/catalog";
import { seedModelRegistry } from "../src/creative/registry";

const CONFIRM = process.env.CONFIRM_CLEAN === "yes";
const KEEP_ADMIN_EMAIL = process.env.KEEP_ADMIN_EMAIL?.trim().toLowerCase() || "";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL?.trim().toLowerCase() || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_NAME = process.env.ADMIN_NAME?.trim() || "Sistem Yöneticisi";

// Sistem/çekirdek tabloları DIŞINDA kalan tüm kullanıcı ve operasyonel tablolar.
const USER_AND_OPERATIONAL_TABLES = [
  "Notification",
  "AgentRun",
  "AgentJobRun",
  "PayoutRequest",
  "PayoutBatch",
  "LedgerEntry",
  "MetricSnapshot",
  "Asset",
  "DeliverableReview",
  "DeliverableStatusChange",
  "Deliverable",
  "Assignment",
  "CampaignBrief",
  "Campaign",
  "SocialAccountSnapshot",
  "SocialAccount",
  "InfluencerCategory",
  "BrandCategory",
  "Invite",
  "SignupApplication",
  "tracker_agents",
  "rate_cards",
  "offers",
  "portfolio_items",
  "ad_drafts",
  "ad_object_mutations",
  "ad_budget_changes",
  "partnership_ad_codes",
  "events",
  "event_invites",
  "event_tickets",
  "coupons",
  "coupon_grants",
  "campaign_open_calls",
  "campaign_applications",
  "notification_logs",
  "short_links",
  "support_tickets",
  "credit_requests",
  "credit_ledger",
  "credit_holds",
  "credit_accounts",
  "creative_jobs",
  "creative_uploads",
  "video_edit_jobs",
  "generated_assets",
  "disclosure_checks",
  "media_jobs",
  "biometric_legal_consents",
  "organizations",
  "messages",
  "conversations",
  "contacts",
  "message_daily_stats",
  "message_templates",
  "message_cost_ledger",
  "knowledge_chunks",
  "knowledge_sources",
  "agent_config",
  "influencer_candidates",
  "whatsapp_numbers",
  "channel_connections",
  "webhook_dedupe",
  "raw_webhooks",
  "tenant_settings",
  "tenant_policy_flags",
  "consent_evidence_log",
  "consent_events",
  "consents",
  "iys_brands",
  "cross_border_filings",
  "influencer_tax_profile",
  "Influencer",
  "Brand",
];

async function main() {
  const [users, brands, influencers, campaigns, offers, credits] = await Promise.all([
    prisma.user.count(),
    prisma.brand.count(),
    prisma.influencer.count(),
    prisma.campaign.count(),
    prisma.offer.count(),
    prisma.creditAccount.count(),
  ]);

  console.log(`Mod: ${CONFIRM ? "GERÇEK TEMİZLİK (CANLIYA HAZIRLIK)" : "KURU ÇALIŞMA (silme yapılmaz)"}`);
  console.log("Mevcut kayıtlar:", { users, brands, influencers, campaigns, offers, creditAccounts: credits });

  if (!CONFIRM) {
    console.log("\nSilme işlemi için CONFIRM_CLEAN=yes ile çalıştırın.");
    console.log("Örnek: CONFIRM_CLEAN=yes ADMIN_EMAIL=admin@nordvow.com ADMIN_PASSWORD=... npm run db:clean-prod");
    return;
  }

  let preservedAdmin: {
    email: string;
    name: string;
    passwordHash: string;
    phone: string | null;
  } | null = null;

  if (KEEP_ADMIN_EMAIL) {
    const u = await prisma.user.findUnique({
      where: { email: KEEP_ADMIN_EMAIL },
      select: { email: true, name: true, passwordHash: true, phone: true, role: true },
    });
    if (!u || u.role !== "ADMIN") {
      throw new Error(`KEEP_ADMIN_EMAIL (${KEEP_ADMIN_EMAIL}) sistemde aktif bir ADMIN olarak bulunamadı.`);
    }
    preservedAdmin = { email: u.email, name: u.name, passwordHash: u.passwordHash, phone: u.phone };
  }

  const allToTruncate = [...USER_AND_OPERATIONAL_TABLES, "User"];
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${allToTruncate.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);

  if (preservedAdmin) {
    await prisma.user.create({
      data: {
        email: preservedAdmin.email,
        name: preservedAdmin.name,
        passwordHash: preservedAdmin.passwordHash,
        phone: preservedAdmin.phone,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    console.log(`Korunan admin: ${preservedAdmin.email}`);
  } else if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    if (ADMIN_PASSWORD.length < 10) throw new Error("ADMIN_PASSWORD en az 10 karakter olmalı.");
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        name: ADMIN_NAME,
        passwordHash,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    console.log(`Yeni canlı admin oluşturuldu: ${ADMIN_EMAIL}`);
  } else {
    console.log("Tüm kullanıcılar silindi (yeni admin oluşturmak için ADMIN_EMAIL ve ADMIN_PASSWORD verebilirsiniz).");
  }

  // Sistem/çekirdek verilerini güncel tut
  await seedConfig();
  await seedAgentTemplates();
  await seedModelRegistry();

  console.log("Temizlik tamamlandı: tüm sahte/kullanıcı verileri silindi, sistem çekirdek verileri korundu.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

