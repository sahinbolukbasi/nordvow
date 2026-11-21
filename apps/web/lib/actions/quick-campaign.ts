"use server";

import { prisma } from "@infulancer/core/db";
import { extractProductFromUrl, type ExtractedProductInfo } from "@infulancer/core/campaigns/product-extractor";
import {
  generateAiCampaignBrief,
  summarizeMoodBoardStyle,
  type BriefTone,
  type GeneratedCampaignBrief,
} from "@infulancer/core/campaigns/ai-brief";
import {
  rankInfluencersForCampaign,
  type MatchCandidateInput,
  type MatchedInfluencerResult,
} from "@infulancer/core/campaigns/ai-matching";
import {
  createDraft,
  getCampaignQuickMeta,
  previewCampaignOffers,
  saveCampaignQuickMeta,
  saveDraftBrief,
  saveDraftOnly,
  sendConfirmedCampaignOffers,
  submitDraft,
  updateAudience,
  updateBasics,
  updateContentPlan,
  updateSchedule,
  updateShortlist,
} from "@infulancer/core/domain/campaign-draft";
import type { ContentPlanItem, Objective } from "@infulancer/core/domain/campaign-plan";
import { checkLeadingDisclosure } from "@infulancer/core/compliance/disclosure";
import { submitGeneration } from "@infulancer/core/creative/generate";
import type { Platform } from "@infulancer/core/enums";
import { currencyOf } from "@infulancer/core/i18n/regions";
import { DomainError } from "@infulancer/core/domain/errors";
import { requireActor } from "@/lib/auth-guard";
import { revalidateAll } from "@/lib/action-utils";
import { AGENCY_TZ, zonedToUtc } from "@/lib/time";
import { pickAvatar } from "@/components/ui/avatar";

export async function extractProductAction(url: string): Promise<ExtractedProductInfo> {
  await requireActor("ADMIN", "BRAND");
  return extractProductFromUrl(url);
}

export async function generateQuickBriefAction(input: {
  brandId?: string | null;
  campaignName?: string | null;
  objective: Objective;
  secondaryObjective?: Objective | null;
  sector?: "kozmetik" | "moda" | "yeme_icme" | "teknoloji" | "anne_bebek" | "spor" | null;
  productTitle?: string | null;
  productDescription?: string | null;
  productPrice?: string | null;
  platforms: Platform[];
  audienceSummary?: string | null;
  tone?: BriefTone;
}): Promise<GeneratedCampaignBrief> {
  const actor = await requireActor("ADMIN", "BRAND");
  const brandId = actor.role === "BRAND" ? actor.brandId! : input.brandId;
  const brand = brandId
    ? await prisma.brand.findUnique({ where: { id: brandId }, select: { name: true } })
    : null;
  const brandName = brand?.name ?? "Markanız";
  const brandHandle = brandName
    .toLocaleLowerCase("tr")
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 24);

  return generateAiCampaignBrief({
    brandName,
    brandHandle: brandHandle || null,
    campaignName: input.campaignName,
    objective: input.objective,
    secondaryObjective: input.secondaryObjective,
    sector: input.sector,
    productTitle: input.productTitle,
    productDescription: input.productDescription,
    productPrice: input.productPrice,
    platforms: input.platforms,
    audienceSummary: input.audienceSummary,
    tone: input.tone ?? "samimi",
  });
}

export async function summarizeMoodBoardAction(input: {
  brandName: string;
  fileNames: string[];
  notes?: string;
}): Promise<{ styleSummary: string }> {
  await requireActor("ADMIN", "BRAND");
  const styleSummary = await summarizeMoodBoardStyle(input);
  return { styleSummary };
}

/**
 * Creative Studio (fal.ai + kredi sistemi) üzerinden kampanya konsept görselleri üretir.
 * Kredi yetersizse veya servis kapalıysa kontrollü hata döner, formu bozmaz.
 */
export async function generateQuickConceptImagesAction(input: {
  campaignId?: string | null;
  brandId?: string | null;
  prompt: string;
  count?: number;
}): Promise<{ ok: boolean; jobIds: string[]; message: string }> {
  const actor = await requireActor("ADMIN", "BRAND");
  const brandId = actor.role === "BRAND" ? actor.brandId! : input.brandId;
  if (!brandId) return { ok: false, jobIds: [], message: "Önce marka seçin." };
  const tenantId = `brand:${brandId}`;
  const count = Math.min(3, Math.max(1, input.count ?? 3));
  const variants = [
    `${input.prompt}, editorial ürün odaklı yakın çekim, doğal gün ışığı, 9:16 dikey`,
    `${input.prompt}, yaşam tarzı rutin sahnesi, sıcak pastel tonlar, 9:16 dikey`,
    `${input.prompt}, minimalist stüdyo kompozisyonu, yüksek kontrast, 9:16 dikey`,
  ].slice(0, count);

  const jobIds: string[] = [];
  for (const prompt of variants) {
    try {
      const job = await submitGeneration({
        tenantId,
        modelKey: "flux-schnell",
        prompt,
        aspect: "9:16",
      });
      if (job?.id) jobIds.push(job.id);
    } catch (err) {
      return {
        ok: jobIds.length > 0,
        jobIds,
        message:
          jobIds.length > 0
            ? `${jobIds.length} konsept görsel sıraya alındı; kalanı için kredi veya ayar kontrolü gerekiyor.`
            : err instanceof Error
              ? err.message
              : "Konsept görsel üretimi başlatılamadı (Creative Studio kredinizi kontrol edin).",
      };
    }
  }
  return {
    ok: true,
    jobIds,
    message: `${jobIds.length} konsept görsel Creative Studio (fal.ai) ile üretilmeye başlandı.`,
  };
}

export async function saveQuickCampaignStep1Action(input: {
  campaignId?: string | null;
  brandId?: string | null;
  name: string;
  objective: Objective;
  secondaryObjective?: Objective | null;
  description?: string | null;
  targetCountries: string[];
  platforms: Platform[];
  audienceAgeMin: number | null;
  audienceAgeMax: number | null;
  audienceGender: "hepsi" | "kadin" | "erkek";
  audienceInterests: string[];
  startsAt: string;
  endsAt: string;
  budgetMajor: number;
  productUrl?: string | null;
  productTitle?: string | null;
  productPrice?: string | null;
  productImageUrl?: string | null;
  templateKey?: string | null;
  sector?: string | null;
}): Promise<{ ok: boolean; campaignId?: string; savedAt?: string; error?: string }> {
  try {
    const actor = await requireActor("ADMIN", "BRAND");
    let id = input.campaignId ?? null;
    if (!id) {
      const created = await createDraft(actor, {
        brandId: input.brandId,
        name: input.name,
        objective: input.objective,
        secondaryObjective: input.secondaryObjective,
        description: input.description,
      });
      id = created.id;
    } else {
      await updateBasics(actor, id, {
        name: input.name,
        objective: input.objective,
        secondaryObjective: input.secondaryObjective,
        description: input.description,
      });
    }

    await updateAudience(actor, id, {
      targetCountries: input.targetCountries.length ? input.targetCountries : ["TR"],
      platforms: input.platforms.length ? input.platforms : ["INSTAGRAM"],
      audienceAgeMin: input.audienceAgeMin,
      audienceAgeMax: input.audienceAgeMax,
      audienceGender: input.audienceGender,
      audienceInterests: input.audienceInterests.slice(0, 15),
    });

    const budgetKurus = Math.round(Math.max(1, input.budgetMajor) * 100);
    await updateSchedule(actor, id, {
      startsAt: zonedToUtc(input.startsAt, "00:00", AGENCY_TZ),
      endsAt: zonedToUtc(input.endsAt, "23:59", AGENCY_TZ),
      brandTotalFeeKurus: budgetKurus,
      budgetKurus,
    });

    const meta = await saveCampaignQuickMeta(id, {
      secondaryObjective: input.secondaryObjective ?? null,
      productUrl: input.productUrl ?? null,
      productTitle: input.productTitle ?? null,
      productPrice: input.productPrice ?? null,
      productImageUrl: input.productImageUrl ?? null,
      templateKey: input.templateKey ?? null,
      sector: input.sector ?? null,
    });

    revalidateAll();
    return { ok: true, campaignId: id, savedAt: meta.lastAutosavedAt ?? new Date().toISOString() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof DomainError || err instanceof Error ? err.message : "Taslak kaydedilemedi.",
    };
  }
}

export async function saveQuickCampaignStep2Action(input: {
  campaignId: string;
  briefText: string;
  dos: string[];
  donts: string[];
  hashtags: string[];
  mentions: string[];
  disclosureRequired: boolean;
  contentPlan: ContentPlanItem[];
  moodBoardStyleSummary?: string | null;
  titleAlternatives?: string[];
  briefTone?: string | null;
}): Promise<{ ok: boolean; savedAt?: string; error?: string }> {
  try {
    const actor = await requireActor("ADMIN", "BRAND");
    await updateContentPlan(actor, input.campaignId, input.contentPlan);
    await saveDraftBrief(actor, input.campaignId, {
      text: input.briefText,
      dos: input.dos.filter(Boolean),
      donts: input.donts.filter(Boolean),
      hashtags: input.hashtags.filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h.replace(/\s+/g, "")}`)),
      mentions: input.mentions.filter(Boolean).map((m) => (m.startsWith("@") ? m : `@${m.replace(/^@+/, "")}`)),
      disclosureRequired: input.disclosureRequired,
    });
    const meta = await saveCampaignQuickMeta(input.campaignId, {
      moodBoardStyleSummary: input.moodBoardStyleSummary ?? null,
      titleAlternatives: input.titleAlternatives ?? [],
      briefTone: input.briefTone ?? null,
    });
    revalidateAll();
    return { ok: true, savedAt: meta.lastAutosavedAt ?? new Date().toISOString() };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof DomainError || err instanceof Error ? err.message : "Brief kaydedilemedi.",
    };
  }
}

export async function loadQuickMatchesAction(campaignId: string): Promise<{
  ok: boolean;
  matches: MatchedInfluencerResult[];
  shortlist: string[];
  budgetKurus: number;
  currency: string;
  error?: string;
}> {
  try {
    const actor = await requireActor("ADMIN", "BRAND");
    const c = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { brand: { select: { competitorBrandIds: true } } },
    });
    if (!c) throw new DomainError("BULUNAMADI", "Kampanya bulunamadı.");
    if (actor.role === "BRAND" && c.brandId !== actor.brandId) {
      throw new DomainError("YETKISIZ", "Bu kampanyaya erişim yetkiniz yok.");
    }

    const competitorIds = c.brand.competitorBrandIds ?? [];
    const infs = await prisma.influencer.findMany({
      where: { isActive: true, ...(actor.role === "BRAND" ? { showcaseVisible: true } : {}) },
      take: 150,
      select: {
        id: true,
        name: true,
        category: true,
        city: true,
        country: true,
        avatarKey: true,
        socialAccounts: {
          select: {
            platform: true,
            handle: true,
            followers: true,
            engagementRate: true,
            avatarUrl: true,
            verified: true,
            tokenRef: true,
            syncSource: true,
            demographics: true,
          },
        },
        assignments: {
          take: 20,
          orderBy: { createdAt: "desc" },
          select: {
            campaign: { select: { brandId: true, brand: { select: { name: true } } } },
            deliverables: { select: { contractViolation: true } },
          },
        },
      },
    });

    const infIds = infs.map((x) => x.id);
    const rateCardRows = infIds.length
      ? await prisma.rateCard.findMany({
        where: { influencerId: { in: infIds }, active: true },
        select: { influencerId: true, priceKurus: true },
      })
      : [];
    const feesByInf = new Map<string, number[]>();
    for (const rc of rateCardRows) {
      const arr = feesByInf.get(rc.influencerId) ?? [];
      arr.push(rc.priceKurus);
      feesByInf.set(rc.influencerId, arr);
    }

    const candidates: MatchCandidateInput[] = infs.map((i) => {
      const ig = i.socialAccounts.find((s) => s.platform === "INSTAGRAM") ?? i.socialAccounts[0];
      const followers = i.socialAccounts.reduce((s, a) => s + a.followers, 0);
      const rawEr = ig?.engagementRate != null ? Number(ig.engagementRate) : null;
      const hasVerifiedApiAccount = i.socialAccounts.some(
        (s) => Boolean(s.verified || s.tokenRef || (s.syncSource && s.syncSource !== "manual")),
      );
      const allDelivs = i.assignments.flatMap((a) => a.deliverables);
      const violations = allDelivs.filter((d) => d.contractViolation).length;
      const compliance23aRate = allDelivs.length > 0 ? (allDelivs.length - violations) / allDelivs.length : null;
      const competitorHit = i.assignments.find((a) => competitorIds.includes(a.campaign.brandId));
      const fees = feesByInf.get(i.id) ?? [];
      const estimatedFeeKurus =
        fees.length > 0
          ? Math.round(fees.reduce((s, f) => s + f, 0) / fees.length)
          : null;

      return {
        id: i.id,
        name: i.name,
        handle: ig?.handle ? ig.handle.replace(/^@+/, "") : null,
        category: i.category,
        country: i.country,
        city: i.city,
        avatarUrl: pickAvatar(i.socialAccounts, i.avatarKey),
        platforms: [...new Set(i.socialAccounts.map((s) => s.platform))],
        followers,
        er: rawEr != null && rawEr > 0 ? rawEr : null,
        hasVerifiedApiAccount,
        demographics: (ig?.demographics ?? null) as Record<string, unknown> | null,
        estimatedFeeKurus,
        compliance23aRate,
        past23aViolations: violations,
        competitorConflictBrand: competitorHit?.campaign.brand.name ?? null,
      };
    });

    const budgetKurus = Number(c.brandTotalFeeKurus || c.budgetKurus);
    const matches = rankInfluencersForCampaign(
      {
        brandId: c.brandId,
        targetCountries: c.targetCountries,
        platforms: c.platforms,
        audienceInterests: c.audienceInterests,
        audienceGender: c.audienceGender,
        audienceAgeMin: c.audienceAgeMin,
        audienceAgeMax: c.audienceAgeMax,
        budgetKurus,
        currency: c.currency || currencyOf(c.targetCountries[0] ?? "TR"),
      },
      candidates,
    );

    return {
      ok: true,
      matches,
      shortlist: c.shortlistInfluencerIds,
      budgetKurus,
      currency: c.currency,
    };
  } catch (err) {
    return {
      ok: false,
      matches: [],
      shortlist: [],
      budgetKurus: 0,
      currency: "TRY",
      error: err instanceof Error ? err.message : "Eşleştirmeler yüklenemedi.",
    };
  }
}

export async function saveQuickShortlistAction(campaignId: string, influencerIds: string[]) {
  try {
    const actor = await requireActor("ADMIN", "BRAND");
    const count = await updateShortlist(actor, campaignId, influencerIds);
    const preview = await previewCampaignOffers(actor, campaignId, influencerIds);
    revalidateAll();
    return { ok: true, count, preview };
  } catch (err) {
    return { ok: false, count: 0, error: err instanceof Error ? err.message : "Kısa liste kaydedilemedi." };
  }
}

export async function finalizeQuickCampaignAction(input: {
  campaignId: string;
  intent: "save_draft" | "publish_only" | "publish_and_send_offers";
  influencerIds: string[];
  confirmed?: boolean;
  offerMessage?: string;
}): Promise<{ ok: boolean; redirectUrl?: string; message?: string; error?: string; offersSent?: number }> {
  try {
    const actor = await requireActor("ADMIN", "BRAND");
    await updateShortlist(actor, input.campaignId, input.influencerIds);

    if (input.intent === "save_draft") {
      await saveDraftOnly(actor, input.campaignId);
      revalidateAll();
      return {
        ok: true,
        offersSent: 0,
        message: "Kampanya taslak olarak kaydedildi. Hiçbir influencer'a teklif gönderilmedi.",
        redirectUrl: actor.role === "BRAND" ? `/marka/kampanyalar/${input.campaignId}` : `/admin/kampanyalar/${input.campaignId}`,
      };
    }

    await submitDraft(actor, input.campaignId);
    let sentCount = 0;
    if (input.intent === "publish_and_send_offers") {
      if (input.confirmed !== true) {
        throw new DomainError("DOGRULAMA", "Teklif göndermek için açık onay gereklidir.");
      }
      const offerRes = await sendConfirmedCampaignOffers(actor, input.campaignId, {
        confirmed: true,
        influencerIds: input.influencerIds,
        customMessage: input.offerMessage,
      });
      sentCount = offerRes.sentCount;
    }

    revalidateAll();
    return {
      ok: true,
      offersSent: sentCount,
      message:
        sentCount > 0
          ? `Kampanya yayınlandı ve ${sentCount} influencer'a teklif gönderildi.`
          : "Kampanya yayınlandı (henüz teklif gönderilmedi).",
      redirectUrl: actor.role === "BRAND" ? `/marka/kampanyalar/${input.campaignId}` : `/admin/kampanyalar/${input.campaignId}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof DomainError || err instanceof Error ? err.message : "İşlem tamamlanamadı.",
    };
  }
}

export interface TimestampReviewComment {
  id: string;
  version: number;
  timestampSec: number;
  timestampLabel: string;
  comment: string;
  authorName: string;
  createdAt: string;
}

const REVIEW_COMMENT_PREFIX = "deliverable.comments.";

export async function addDeliverableTimestampCommentAction(input: {
  deliverableId: string;
  timestampSec: number;
  comment: string;
  version?: number;
  captionToCheck?: string | null;
  brandName?: string | null;
}): Promise<{
  ok: boolean;
  comments?: TimestampReviewComment[];
  disclosureIssues?: string[];
  error?: string;
}> {
  try {
    const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
    const clean = input.comment.trim();
    if (clean.length < 2) throw new DomainError("DOGRULAMA", "Yorum metni en az 2 karakter olmalıdır.");
    const sec = Math.max(0, Math.round(input.timestampSec));
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    const timestampLabel = `${mins}:${String(rem).padStart(2, "0")}`;

    const key = `${REVIEW_COMMENT_PREFIX}${input.deliverableId}`;
    const existing = await prisma.configValue.findUnique({ where: { key } });
    const list = Array.isArray(existing?.value) ? (existing.value as unknown as TimestampReviewComment[]) : [];
    const nextEntry: TimestampReviewComment = {
      id: `cmt_${Date.now()}`,
      version: Math.max(1, input.version ?? 1),
      timestampSec: sec,
      timestampLabel,
      comment: clean.slice(0, 600),
      authorName: actor.role === "ADMIN" ? "Ajans" : actor.role === "BRAND" ? "Marka" : "Creator",
      createdAt: new Date().toISOString(),
    };
    const next = [...list, nextEntry].slice(-50);
    await prisma.configValue.upsert({
      where: { key },
      create: { key, value: next as unknown as object, note: "Saniye damgalı taslak video yorumları" },
      update: { value: next as unknown as object },
    });

    let disclosureIssues: string[] = [];
    if (input.captionToCheck?.trim() && input.brandName) {
      const issues = checkLeadingDisclosure(input.captionToCheck, input.brandName, "TR");
      disclosureIssues = issues.map((item) => item.message);
    }

    revalidateAll();
    return { ok: true, comments: next, disclosureIssues };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Yorum kaydedilemedi." };
  }
}

export async function getDeliverableTimestampCommentsAction(deliverableId: string): Promise<TimestampReviewComment[]> {
  await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const row = await prisma.configValue.findUnique({ where: { key: `${REVIEW_COMMENT_PREFIX}${deliverableId}` } });
  return Array.isArray(row?.value) ? (row.value as unknown as TimestampReviewComment[]) : [];
}

export async function toggleWeeklyDigestAction(campaignId: string, enabled: boolean) {
  await requireActor("ADMIN", "BRAND");
  const meta = await getCampaignQuickMeta(campaignId);
  await saveCampaignQuickMeta(campaignId, { ...meta, weeklyReportEnabled: enabled });
  revalidateAll();
  return { ok: true, enabled };
}
