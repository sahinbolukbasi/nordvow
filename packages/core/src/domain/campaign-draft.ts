import { audit } from "../audit";
import { toAuditActor, type Actor } from "../access/actor";
import { notifyAdmins } from "../agents/common";
import { ensureCampaignTrackers, runTracker } from "../agents/trackers";
import { prisma } from "../db";
import type { Platform } from "../enums";
import { audienceSchema, contentPlanSchema, draftChecks, OBJECTIVES, parseContentPlan, type Objective } from "./campaign-plan";
import { DomainError } from "./errors";
import { assertCampaignAmountKurus } from "./money";
import { utmSafe } from "./utm";
import { campaignCurrency, convertMinor, currencyOf } from "../i18n/regions";

/**
 * Kampanya taslağı (sihirbaz) — marka ve ajans ortak kullanır.
 * Kurallar:
 *  - Marka yalnız kendi markası adına ve yalnız TASLAK durumundaki kampanyayı düzenler.
 *  - Markanın girdiği bütçe "marka bedeli"dir; influencer bütçesi/komisyon ajansın işidir (0 açılır).
 *  - Marka influencer'ı doğrudan atamaz: önerdiği influencerlar shortlist'e yazılır, ajans tek seferde atar.
 *  - Gönder: zorunlu adımlar tamamsa submittedAt yazılır ve ajansa bildirim düşer.
 */
const OBJECTIVE_TARGETS: Record<Objective, { kpi: string; target: number; weight: number; windowDays: number }[]> = {
  bilinirlik: [
    { kpi: "reach", target: 500000, weight: 2, windowDays: 30 },
    { kpi: "impressions", target: 1200000, weight: 1, windowDays: 30 },
  ],
  etkilesim: [
    { kpi: "er", target: 0.05, weight: 2, windowDays: 14 },
    { kpi: "reach", target: 200000, weight: 1, windowDays: 30 },
  ],
  satis: [
    { kpi: "sales", target: 1000, weight: 3, windowDays: 30 },
    { kpi: "click", target: 20000, weight: 1, windowDays: 30 },
  ],
  video: [
    { kpi: "views", target: 1000000, weight: 2, windowDays: 30 },
    { kpi: "er", target: 0.04, weight: 1, windowDays: 30 },
  ],
  urun_gonderimi: [
    { kpi: "reach", target: 250000, weight: 2, windowDays: 30 },
    { kpi: "er", target: 0.04, weight: 1, windowDays: 30 },
  ],
  urun_tanitimi: [
    { kpi: "reach", target: 350000, weight: 2, windowDays: 30 },
    { kpi: "er", target: 0.045, weight: 2, windowDays: 14 },
    { kpi: "click", target: 12000, weight: 1, windowDays: 30 },
  ],
  etkinlik: [
    { kpi: "reach", target: 300000, weight: 2, windowDays: 14 },
    { kpi: "impressions", target: 600000, weight: 1, windowDays: 14 },
    { kpi: "er", target: 0.05, weight: 1, windowDays: 14 },
  ],
};

export function buildObjectiveTargets(primary: Objective, secondary?: Objective | null) {
  const base = OBJECTIVE_TARGETS[primary].map((t) => ({ ...t }));
  if (!secondary || secondary === primary) return base;
  const seen = new Set(base.map((t) => t.kpi));
  for (const extra of OBJECTIVE_TARGETS[secondary]) {
    if (!seen.has(extra.kpi)) {
      base.push({ ...extra, weight: Math.max(1, Math.round(extra.weight * 0.5)) });
      seen.add(extra.kpi);
    }
  }
  return base;
}

export type CampaignQuickMeta = {
  secondaryObjective?: Objective | null;
  productUrl?: string | null;
  productTitle?: string | null;
  productPrice?: string | null;
  productImageUrl?: string | null;
  templateKey?: string | null;
  sector?: string | null;
  moodBoardStyleSummary?: string | null;
  conceptImageUrls?: string[];
  weeklyReportEnabled?: boolean;
  briefTone?: string | null;
  titleAlternatives?: string[];
  lastAutosavedAt?: string | null;
};

const QUICK_META_PREFIX = "campaign.quick.";

export async function getCampaignQuickMeta(campaignId: string): Promise<CampaignQuickMeta> {
  const row = await prisma.configValue.findUnique({ where: { key: `${QUICK_META_PREFIX}${campaignId}` } });
  if (!row || typeof row.value !== "object" || row.value === null) return {};
  return row.value as CampaignQuickMeta;
}

export async function saveCampaignQuickMeta(campaignId: string, patch: Partial<CampaignQuickMeta>): Promise<CampaignQuickMeta> {
  const prev = await getCampaignQuickMeta(campaignId);
  const next: CampaignQuickMeta = {
    ...prev,
    ...patch,
    lastAutosavedAt: new Date().toISOString(),
  };
  await prisma.configValue.upsert({
    where: { key: `${QUICK_META_PREFIX}${campaignId}` },
    create: { key: `${QUICK_META_PREFIX}${campaignId}`, value: next as object, note: "Hızlı kampanya ve genişletilmiş meta" },
    update: { value: next as object },
  });
  return next;
}
const DAY = 86_400_000;

function slugify(v: string): string {
  return utmSafe(v).replace(/[._]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "kampanya";
}
async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; i < 200; i++) {
    if (!(await prisma.campaign.findFirst({ where: { slug }, select: { id: true } }))) return slug;
    slug = `${base}-${i}`;
  }
  throw new DomainError("DOGRULAMA", "Benzersiz kısa ad üretilemedi.");
}

/** Düzenleme yetkisi: admin (kapanmamış), marka (kendi + TASLAK). */
export async function assertCanEditDraft(actor: Actor, campaignId: string) {
  const c = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { id: true, brandId: true, status: true, submittedAt: true, name: true, executionMode: true } });
  if (!c) throw new DomainError("BULUNAMADI", "Kampanya bulunamadı.");
  if (actor.role === "ADMIN") {
    if (c.status === "KAPANDI" || c.status === "IPTAL") throw new DomainError("KURAL_IHLALI", "Kapanmış/iptal kampanya düzenlenemez.");
    return c;
  }
  if (actor.role !== "BRAND" || c.brandId !== actor.brandId) throw new DomainError("BULUNAMADI", "Kampanya bulunamadı.");
  if (c.executionMode === "SELF") {
    // Kendi yürüten marka AKTIF kampanyayı da düzenler; yalnız kapanmış/iptal engellidir.
    if (c.status === "KAPANDI" || c.status === "IPTAL") throw new DomainError("KURAL_IHLALI", "Kapanmış/iptal kampanya düzenlenemez.");
  } else if (c.status !== "TASLAK") {
    throw new DomainError("KURAL_IHLALI", "Ajansa devredilmiş ve yayına alınmış kampanyayı yalnız ajans değiştirebilir. Değişiklik için ajansa yazın.");
  }
  return c;
}

export async function createDraft(
  actor: Actor,
  input: { brandId?: string | null; name: string; objective: string; secondaryObjective?: string | null; description?: string | null },
) {
  if (actor.role !== "ADMIN" && actor.role !== "BRAND") throw new DomainError("YETKISIZ", "Kampanya oluşturma yetkiniz yok.");
  const brandId = actor.role === "BRAND" ? actor.brandId : input.brandId;
  if (!brandId) throw new DomainError("DOGRULAMA", "Marka seçin.");
  const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, country: true, defaultExecutionMode: true } });
  if (!brand) throw new DomainError("DOGRULAMA", "Marka bulunamadı.");
  const name = input.name.trim();
  if (name.length < 3 || name.length > 140) throw new DomainError("DOGRULAMA", "Kampanya adı 3–140 karakter olmalı.");
  const objective = OBJECTIVES.find((o) => o.id === input.objective)?.id;
  if (!objective) throw new DomainError("DOGRULAMA", "Kampanyanın amacını seçin.");
  const secondaryObjective = input.secondaryObjective
    ? (OBJECTIVES.find((o) => o.id === input.secondaryObjective && o.id !== objective)?.id ?? null)
    : null;
  const start = new Date(Math.ceil(Date.now() / DAY) * DAY + 7 * DAY);
  const c = await prisma.campaign.create({
    data: {
      brandId,
      name,
      slug: await uniqueSlug(slugify(name)),
      objective,
      description: input.description?.trim().slice(0, 4000) || null,
      budgetKurus: 0,
      brandTotalFeeKurus: 0,
      startsAt: start,
      endsAt: new Date(start.getTime() + 30 * DAY - 60_000),
      targets: buildObjectiveTargets(objective, secondaryObjective),
      status: "TASLAK",
      executionMode: actor.role === "BRAND" ? brand.defaultExecutionMode : "AJANS",
      createdById: actor.userId,
      // Varsayılan bölge markanın ülkesi; hedef kitle adımında değişir.
      targetCountries: [brand.country],
      currency: currencyOf(brand.country),
    },
  });
  if (secondaryObjective) {
    await saveCampaignQuickMeta(c.id, { secondaryObjective });
  }
  await audit.append({ actor: toAuditActor(actor), action: "CAMPAIGN_CREATED", entityType: "Campaign", entityId: c.id, data: { brandId, name, objective, secondaryObjective, via: "wizard" } });
  if (objective === "urun_gonderimi") {
    await prisma.campaignShippingConfig.upsert({
      where: { campaignId: c.id },
      create: { campaignId: c.id, requiresProductShipment: true },
      update: { requiresProductShipment: true },
    });
  }
  return c;
}

export async function updateBasics(
  actor: Actor,
  id: string,
  input: { name: string; objective: string; secondaryObjective?: string | null; description?: string | null },
) {
  await assertCanEditDraft(actor, id);
  const name = input.name.trim();
  if (name.length < 3 || name.length > 140) throw new DomainError("DOGRULAMA", "Kampanya adı 3–140 karakter olmalı.");
  const objective = OBJECTIVES.find((o) => o.id === input.objective)?.id;
  if (!objective) throw new DomainError("DOGRULAMA", "Kampanyanın amacını seçin.");
  const secondaryObjective = input.secondaryObjective
    ? (OBJECTIVES.find((o) => o.id === input.secondaryObjective && o.id !== objective)?.id ?? null)
    : null;
  const [prev, prevMeta] = await Promise.all([
    prisma.campaign.findUniqueOrThrow({ where: { id }, select: { objective: true } }),
    getCampaignQuickMeta(id),
  ]);
  const objectiveChanged = prev.objective !== objective || (prevMeta.secondaryObjective ?? null) !== secondaryObjective;
  await prisma.campaign.update({
    where: { id },
    data: {
      name,
      objective,
      description: input.description?.trim().slice(0, 4000) || null,
      ...(objectiveChanged ? { targets: buildObjectiveTargets(objective, secondaryObjective) } : {}),
    },
  });
  await saveCampaignQuickMeta(id, { secondaryObjective });
  if (objective === "urun_gonderimi") {
    await prisma.campaignShippingConfig.upsert({
      where: { campaignId: id },
      create: { campaignId: id, requiresProductShipment: true },
      update: { requiresProductShipment: true },
    });
  }
  await audit.append({ actor: toAuditActor(actor), action: "CAMPAIGN_UPDATED", entityType: "Campaign", entityId: id, data: { step: "temel", name, objective, secondaryObjective } });
}

export async function updateAudience(actor: Actor, id: string, raw: unknown) {
  await assertCanEditDraft(actor, id);
  const r = audienceSchema.safeParse(raw);
  if (!r.success) throw new DomainError("DOGRULAMA", r.error.issues[0]?.message ?? "Hedef kitle geçersiz.");
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id }, select: { brand: { select: { country: true } } } });
  const { currency, mixed } = campaignCurrency(r.data.targetCountries, c.brand.country);
  // Çoklu para birimi motoru: Farklı ülkeler seçildiğinde markanın yerel para birimini baz al,
  // yabancı influencer teklif/hakedişlerinde otomatik kur dönüşümü uygula.
  const effectiveCurrency = mixed ? currencyOf(c.brand.country) : currency;
  await prisma.campaign.update({ where: { id }, data: { ...r.data, platforms: r.data.platforms as Platform[], currency: effectiveCurrency } });
  await audit.append({ actor: toAuditActor(actor), action: "CAMPAIGN_UPDATED", entityType: "Campaign", entityId: id, data: { step: "kitle", ...r.data, currency: effectiveCurrency } });
}

/** Tarih (UTC, çağıran saat dilimine çevirmiş olmalı) ve bütçe. Girilen toplam bütçe her iki alanda da tutarlı saklanır. */
export async function updateSchedule(actor: Actor, id: string, input: { startsAt: Date; endsAt: Date; brandTotalFeeKurus: number; budgetKurus?: number | null }) {
  await assertCanEditDraft(actor, id);
  if (!(input.endsAt > input.startsAt)) throw new DomainError("DOGRULAMA", "Bitiş tarihi başlangıçtan sonra olmalı.");
  if (!Number.isInteger(input.brandTotalFeeKurus) || input.brandTotalFeeKurus <= 0) throw new DomainError("DOGRULAMA", "Toplam bütçeyi girin.");
  assertCampaignAmountKurus(input.brandTotalFeeKurus, "Toplam bütçe");
  const effectiveBudget =
    actor.role === "ADMIN" && input.budgetKurus != null
      ? input.budgetKurus
      : input.brandTotalFeeKurus;
  if (!Number.isInteger(effectiveBudget) || effectiveBudget < 0) throw new DomainError("DOGRULAMA", "Influencer bütçesi geçersiz.");
  if (actor.role === "ADMIN" && input.budgetKurus != null) assertCampaignAmountKurus(input.budgetKurus, "Influencer bütçesi");
  const data: { startsAt: Date; endsAt: Date; brandTotalFeeKurus: bigint; budgetKurus: bigint } = {
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    brandTotalFeeKurus: BigInt(input.brandTotalFeeKurus),
    budgetKurus: BigInt(effectiveBudget),
  };
  await prisma.campaign.update({ where: { id }, data });
  await audit.append({
    actor: toAuditActor(actor),
    action: "CAMPAIGN_UPDATED",
    entityType: "Campaign",
    entityId: id,
    data: { step: "butce", startsAt: input.startsAt.toISOString(), endsAt: input.endsAt.toISOString(), brandTotalFeeKurus: input.brandTotalFeeKurus, budgetKurus: effectiveBudget },
  });
}

export async function updateContentPlan(actor: Actor, id: string, raw: unknown) {
  await assertCanEditDraft(actor, id);
  const r = contentPlanSchema.safeParse(raw);
  if (!r.success) throw new DomainError("DOGRULAMA", r.error.issues[0]?.message ?? "İçerik planı geçersiz.");
  if (r.data.length === 0) throw new DomainError("DOGRULAMA", "En az bir içerik satırı ekleyin.");
  await prisma.campaign.update({ where: { id }, data: { contentPlan: r.data } });
  await audit.append({ actor: toAuditActor(actor), action: "CAMPAIGN_UPDATED", entityType: "Campaign", entityId: id, data: { step: "icerik", items: r.data.length } });
}

/** Brief: her kayıt yeni sürüm (ajans formuyla aynı kural). */
export async function saveDraftBrief(
  actor: Actor,
  id: string,
  input: { text: string; dos: string[]; donts: string[]; hashtags: string[]; mentions: string[]; disclosureRequired: boolean },
) {
  await assertCanEditDraft(actor, id);
  if (input.text.trim().length < 10) throw new DomainError("DOGRULAMA", "Brief metni en az 10 karakter olmalı.");
  if (input.hashtags.some((h) => !/^#[\p{L}\p{N}_]+$/u.test(h))) throw new DomainError("DOGRULAMA", "Etiketler # ile başlamalı (boşluksuz).");
  if (input.mentions.some((m) => !/^@[\w.]+$/u.test(m))) throw new DomainError("DOGRULAMA", "Bahsetmeler @ ile başlamalı.");
  const last = await prisma.campaignBrief.findFirst({ where: { campaignId: id }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  const b = await prisma.campaignBrief.create({
    data: {
      campaignId: id,
      version,
      text: input.text.trim().slice(0, 20_000),
      dos: input.dos.slice(0, 50),
      donts: input.donts.slice(0, 50),
      hashtags: input.hashtags.slice(0, 30),
      mentions: input.mentions.slice(0, 30),
      requiredPhrases: [],
      bannedPhrases: [],
      disclosureRequired: input.disclosureRequired,
      createdById: actor.userId,
    },
  });
  await audit.append({ actor: toAuditActor(actor), action: "BRIEF_VERSION_CREATED", entityType: "CampaignBrief", entityId: b.id, data: { campaignId: id, version } });
  return version;
}

/** Markanın önerdiği influencerlar (toplu). Yalnız var olan ve vitrinde görünen influencerlar kabul edilir. */
export async function updateShortlist(actor: Actor, id: string, influencerIds: string[]) {
  await assertCanEditDraft(actor, id);
  const unique = [...new Set(influencerIds)].slice(0, 200);
  const found = await prisma.influencer.findMany({
    where: { isActive: true, id: { in: unique }, ...(actor.role === "BRAND" ? { showcaseVisible: true } : {}) },
    select: { id: true },
  });
  const ok = new Set(found.map((f) => f.id));
  const ids = unique.filter((i) => ok.has(i));
  await prisma.campaign.update({ where: { id }, data: { shortlistInfluencerIds: ids } });
  await audit.append({ actor: toAuditActor(actor), action: "CAMPAIGN_UPDATED", entityType: "Campaign", entityId: id, data: { step: "influencer", count: ids.length } });
  return ids.length;
}

export async function draftStatus(id: string) {
  const c = await prisma.campaign.findUniqueOrThrow({
    where: { id },
    include: {
      _count: { select: { briefs: true, assets: { where: { uploadStatus: "TAMAM" } } } },
      assignments: { where: { contractStatus: { not: "RED" } }, select: { id: true } },
      shippingConfig: { select: { requiresProductShipment: true } },
    },
  });
  const includeShipping = c.objective === "urun_gonderimi" || Boolean(c.shippingConfig?.requiresProductShipment);
  const checks = draftChecks({
    name: c.name,
    objective: c.objective,
    targetCountries: c.targetCountries,
    platforms: c.platforms,
    brandTotalFeeKurus: c.brandTotalFeeKurus,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    contentPlan: c.contentPlan,
    briefCount: c._count.briefs,
    mediaCount: c._count.assets,
    influencerCount: new Set([...c.shortlistInfluencerIds, ...c.assignments.map((a) => a.id)]).size,
    includeShipping,
  });
  return { campaign: c, checks, ready: checks.every((x) => x.ok), plan: parseContentPlan(c.contentPlan) };
}

/**
 * Kampanyayı taslak olarak saklar — durumu TASLAK bırakır ve HİÇBİR influencer'a teklif göndermez.
 */
export async function saveDraftOnly(actor: Actor, id: string) {
  const c = await assertCanEditDraft(actor, id);
  await saveCampaignQuickMeta(id, { lastAutosavedAt: new Date().toISOString() });
  await audit.append({
    actor: toAuditActor(actor),
    action: "CAMPAIGN_DRAFT_SAVED",
    entityType: "Campaign",
    entityId: id,
    data: { by: actor.role, status: c.status },
  });
  return { ok: true as const, status: c.status, offersSent: 0 };
}

export type OfferPreviewRecipient = {
  influencerId: string;
  name: string;
  handle: string | null;
  estimatedTotalKurus: number;
  alreadyOffered: boolean;
  items: { platform: Platform; contentType: string; qty: number; priceKurus: number }[];
};

/**
 * Teklif gönderme onay penceresi için kişi listesi, kişi başı ücret, toplam tutar ve mesaj önizlemesi hesaplar.
 * Veritabanında hiçbir değişiklik yapmaz.
 */
export async function previewCampaignOffers(
  actor: Actor,
  id: string,
  influencerIds?: string[],
): Promise<{
  campaignId: string;
  campaignName: string;
  currency: string;
  defaultMessage: string;
  recipients: OfferPreviewRecipient[];
  totalKurus: number;
  pendingCount: number;
}> {
  await assertCanEditDraft(actor, id);
  const { campaign: full, plan } = await draftStatus(id);
  const targetIds = [...new Set(influencerIds && influencerIds.length > 0 ? influencerIds : full.shortlistInfluencerIds)].slice(0, 200);
  const defaultMessage = full.description?.trim() || `${full.name} kampanyası için iş birliği teklifi.`;

  if (targetIds.length === 0) {
    return {
      campaignId: id,
      campaignName: full.name,
      currency: full.currency,
      defaultMessage,
      recipients: [],
      totalKurus: 0,
      pendingCount: 0,
    };
  }

  const [existingOffers, rateCards, infs] = await Promise.all([
    prisma.offer.findMany({
      where: { brandId: full.brandId, campaignId: id, influencerId: { in: targetIds } },
      select: { influencerId: true },
    }),
    prisma.rateCard.findMany({ where: { influencerId: { in: targetIds }, active: true } }),
    prisma.influencer.findMany({
      where: { isActive: true, id: { in: targetIds } },
      select: {
        id: true,
        name: true,
        country: true,
        socialAccounts: { select: { platform: true, handle: true } },
      },
    }),
  ]);

  const alreadyOffered = new Set(existingOffers.map((o) => o.influencerId));
  const infMap = new Map(infs.map((i) => [i.id, i]));
  const effectiveBudgetKurus = Number(full.brandTotalFeeKurus || full.budgetKurus);
  const fallbackPerInf = Math.max(100_00, Math.round(effectiveBudgetKurus / Math.max(1, targetIds.length)));
  const effectivePlan = plan.length ? plan : [{ platform: "INSTAGRAM" as const, contentType: "STORY" as const, count: 1, notes: "" }];

  const recipients: OfferPreviewRecipient[] = [];
  for (const infId of targetIds) {
    const inf = infMap.get(infId);
    if (!inf) continue;
    const infCur = currencyOf(inf.country);
    const items = effectivePlan.map((row) => {
      const rc = rateCards.find((r) => r.influencerId === infId && r.platform === row.platform && r.contentType === row.contentType);
      const unitKurus = rc
        ? convertMinor(rc.priceKurus, infCur, full.currency)
        : Math.round(fallbackPerInf / Math.max(1, effectivePlan.length));
      return {
        platform: row.platform,
        contentType: row.contentType,
        qty: row.count,
        priceKurus: unitKurus,
      };
    });
    const estimatedTotalKurus = items.reduce((s, it) => s + it.priceKurus * it.qty, 0);
    const primaryAcc = inf.socialAccounts.find((s) => s.platform === "INSTAGRAM") ?? inf.socialAccounts[0];
    recipients.push({
      influencerId: infId,
      name: inf.name,
      handle: primaryAcc?.handle ? primaryAcc.handle.replace(/^@+/, "") : null,
      estimatedTotalKurus: Math.max(0, estimatedTotalKurus),
      alreadyOffered: alreadyOffered.has(infId),
      items,
    });
  }

  const pending = recipients.filter((r) => !r.alreadyOffered);
  return {
    campaignId: id,
    campaignName: full.name,
    currency: full.currency,
    defaultMessage,
    recipients,
    totalKurus: pending.reduce((s, r) => s + r.estimatedTotalKurus, 0),
    pendingCount: pending.length,
  };
}

/**
 * YALNIZCA kullanıcının onay penceresinde açıkça onayladığı ("confirmed: true") teklif gönderimini yapar.
 * Sunucu tarafında açık onay olmadan teklif oluşturulmasını engeller.
 */
export async function sendConfirmedCampaignOffers(
  actor: Actor,
  id: string,
  input: {
    confirmed: boolean;
    influencerIds?: string[];
    customMessage?: string | null;
  },
): Promise<{ sentCount: number; skippedCount: number; totalKurus: number }> {
  if (input.confirmed !== true) {
    throw new DomainError("DOGRULAMA", "Teklif göndermek için açık onay gereklidir.");
  }
  await assertCanEditDraft(actor, id);
  const { campaign: full } = await draftStatus(id);
  const preview = await previewCampaignOffers(actor, id, input.influencerIds);
  const toSend = preview.recipients.filter((r) => !r.alreadyOffered);
  if (toSend.length === 0) {
    return { sentCount: 0, skippedCount: preview.recipients.length, totalKurus: 0 };
  }

  const infUsers = await prisma.user.findMany({
    where: { influencerId: { in: toSend.map((r) => r.influencerId) } },
    select: { id: true, influencerId: true },
  });
  const userByInf = new Map(infUsers.map((u) => [u.influencerId!, u.id]));
  const expiresAt = new Date(Date.now() + 7 * DAY);
  const message = input.customMessage?.trim() || preview.defaultMessage;

  let totalKurus = 0;
  for (const recipient of toSend) {
    await prisma.offer.create({
      data: {
        brandId: full.brandId,
        influencerId: recipient.influencerId,
        createdById: actor.userId,
        campaignId: id,
        title: full.name,
        message,
        items: recipient.items,
        totalKurus: recipient.estimatedTotalKurus,
        publishBy: full.endsAt,
        status: "GONDERILDI",
        expiresAt,
      },
    });
    totalKurus += recipient.estimatedTotalKurus;

    const uId = userByInf.get(recipient.influencerId);
    if (uId) {
      await prisma.notification.create({
        data: {
          userId: uId,
          title: `Yeni Kampanya Teklifi: ${full.name}`,
          body: `${full.name} kampanyası için davet ve içerik teklifi aldınız. Teklifler sayfasından inceleyip yanıtlayabilirsiniz.`,
          href: "/influencer/teklifler",
        },
      });
    }
  }

  await audit.append({
    actor: toAuditActor(actor),
    action: "CAMPAIGN_OFFERS_SENT",
    entityType: "Campaign",
    entityId: id,
    data: {
      by: actor.role,
      sentCount: toSend.length,
      skippedCount: preview.recipients.length - toSend.length,
      totalKurus,
      confirmed: true,
    },
  });

  return {
    sentCount: toSend.length,
    skippedCount: preview.recipients.length - toSend.length,
    totalKurus,
  };
}

/**
 * Kampanyayı yayınlar (TASLAK → AKTIF) ve takip botlarını kurar.
 * ÖNEMLİ: Teklifleri OTOMATİK GÖNDERMEZ; teklif gönderimi yalnızca `sendConfirmedCampaignOffers` ile açık onay sonrası yapılır.
 */
export async function submitDraft(actor: Actor, id: string) {
  const c = await assertCanEditDraft(actor, id);
  const { campaign: full, ready, checks } = await draftStatus(id);
  if (!ready) {
    const missing = checks.filter((x) => !x.ok).map((x) => x.note);
    throw new DomainError("DOGRULAMA", `Yayınlamadan önce tamamlayın: ${missing.join(", ")}.`);
  }

  const first = !c.submittedAt;
  const nextStatus = full.status === "TASLAK" ? "AKTIF" : full.status;
  const effectiveBudget = full.budgetKurus > 0n ? full.budgetKurus : full.brandTotalFeeKurus;

  await prisma.campaign.update({
    where: { id },
    data: {
      submittedAt: c.submittedAt ?? new Date(),
      status: nextStatus,
      budgetKurus: effectiveBudget,
    },
  });

  // Kampanyanın özelliklerine göre takip botlarını otomatik kur ve ilk çalışmayı başlat
  await ensureCampaignTrackers(id, full.name, actor.userId);
  const createdTrackers = await prisma.trackerAgent.findMany({
    where: { scope: "CAMPAIGN", targetId: id, enabled: true },
    select: { id: true },
  });
  for (const t of createdTrackers) {
    await runTracker(t.id).catch(() => undefined);
  }

  await audit.append({
    actor: toAuditActor(actor),
    action: "CAMPAIGN_SUBMITTED",
    entityType: "Campaign",
    entityId: id,
    data: { by: actor.role, first, mode: c.executionMode, status: nextStatus, autoOffersSent: 0 },
  });

  if (actor.role === "BRAND") {
    await notifyAdmins(
      first ? "Yeni kampanya aktif edildi" : "Kampanya güncellendi",
      `"${c.name}" kampanyası yayınlandı ve takip botları başlatıldı.`,
      `/admin/kampanyalar/${id}`,
    );
  }
  return { first, mode: c.executionMode };
}
