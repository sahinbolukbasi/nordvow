import { prisma } from "../db";
import { syncInfluencer, syncSourceLabels, type IgMediaItem, type SocialDataSource } from "./sync";

/**
 * Instagram Gezgini raporu yalnız resmî kayıtlardan kurulur.
 * Hash/sinüs ile üretilmiş takipçi, izlenme, kaydetme veya marka listesi yok.
 * Sayfa açılışı Graph çağırmaz; forceRefresh elle tetiklenen senkrondur.
 */

export type VerificationStatus = SocialDataSource;

export type DailyGrowthPoint = {
  date: string;
  label: string;
  followers: number;
  followersDelta: number;
  growthRatePct: number;
  engagementRatePct: number;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  avgSaves: number | null;
  avgShares: number | null;
  postsPublished: number;
  reelsPublished: number;
  storiesPublished: number;
};

export type FormatBreakdownItem = {
  format: "REELS" | "POST" | "CAROUSEL" | "STORY";
  label: string;
  sharePct: number;
  avgViews: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  avgSaves: number | null;
  avgShares: number | null;
  erPct: number | null;
  weeklyFrequency: number;
};

export type RecentMediaItem = {
  id: string;
  mediaType: "REELS" | "POST" | "CAROUSEL";
  caption: string;
  permalink: string | null;
  publishedAt: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  erPct: number | null;
  isSponsored: boolean;
  detectedBrand: string | null;
  disclosureTag: string | null;
};

export type DetectedBrandCollab = {
  id: string;
  brandName: string;
  brandHandle: string;
  category: string;
  lastWorkedAt: string;
  contentType: "REELS" | "POST" | "STORY" | "CAROUSEL";
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  erPct: number | null;
  disclosureTag: string;
  source: "meta_api" | "instagram_oauth" | "platform_campaign";
  postUrl?: string | null;
};

export type OrganicVsSponsoredStats = {
  organicCount: number;
  sponsoredCount: number;
  organicAvgViews: number | null;
  sponsoredAvgViews: number | null;
  organicAvgLikes: number | null;
  sponsoredAvgLikes: number | null;
  organicAvgSaves: number | null;
  sponsoredAvgSaves: number | null;
  organicErPct: number | null;
  sponsoredErPct: number | null;
  performanceRetentionPct: number | null;
};

export type AudienceSentimentAnalysis = {
  available: boolean;
  positivePct: number | null;
  neutralPct: number | null;
  negativePct: number | null;
  purchaseIntentPct: number | null;
  authenticityScore: number | null;
  botFollowerEstimatePct: number | null;
  engagementPodRisk: "DÜŞÜK" | "ORTA" | "YÜKSEK" | null;
  saveToLikeRatioPct: number | null;
  commentQualityScore: number | null;
  topKeywords: string[];
  sampleInsights: string[];
};

export type BrandFitScores = {
  known: boolean;
  overallScore: number | null;
  reliabilityScore: number | null;
  consistencyScore: number | null;
  conversionPotentialScore: number | null;
  sponsoredRetentionScore: number | null;
  priorityTier: "A+ ÖNCELİKLİ" | "A UYGUN" | "B DENGELİ" | "C İZLENMELİ" | null;
};

export type RawScanLogEntry = {
  timestamp: string;
  source: "META_GRAPH_API" | "INSTAGRAM_OAUTH" | "INSTAGRAM_PUBLIC" | "NONE";
  endpoint: string;
  status: "OK" | "SKIPPED" | "WARN";
  itemsScanned: number;
  durationMs: number;
  detail: string;
};

export type InfluencerExplorerReport = {
  influencerId: string;
  handle: string;
  generatedAt: string;
  verificationStatus: VerificationStatus;
  followers: number;
  followersGrowth30d: number | null;
  followersGrowth30dPct: number | null;
  avgErPct: number | null;
  avgReelsViews: number | null;
  avgViewsGrowth30dPct: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  avgSaves: number | null;
  avgShares: number | null;
  weeklyPosts: number | null;
  weeklyReels: number | null;
  weeklyStories: number | null;
  viewsKnown: boolean;
  savesKnown: boolean;
  aiExecutiveSummary: string;
  aiHighlights: string[];
  aiRecommendation: string;
  scores: BrandFitScores;
  dailySeries: DailyGrowthPoint[];
  formatBreakdown: FormatBreakdownItem[];
  recentMedia: RecentMediaItem[];
  brandCollaborations: DetectedBrandCollab[];
  organicVsSponsored: OrganicVsSponsoredStats;
  sentiment: AudienceSentimentAnalysis;
  rawLogs: RawScanLogEntry[];
};

const KNOWN_BRAND_MAP: Record<string, { name: string; category: string }> = {
  lumikozmetik: { name: "Lumi Kozmetik", category: "Kozmetik & Cilt Bakımı" },
  velvetmoda: { name: "Velvet Moda", category: "Moda & Giyim" },
  novatech: { name: "NovaTech", category: "Teknoloji & Elektronik" },
  aromaartisan: { name: "Aroma Artisan Kahve", category: "Gastronomi & Kafe" },
  fitpulsestudio: { name: "FitPulse Studio", category: "Spor & Yaşam" },
  nordvow: { name: "Nordvow", category: "Dijital & Kreatif" },
};

export function extractBrandFromCaption(caption: string): {
  isSponsored: boolean;
  brandName: string | null;
  brandHandle: string | null;
  disclosureTag: string | null;
} {
  const lower = caption.toLocaleLowerCase("tr");
  const disclosureMatch = lower.match(/(#reklam|#işbirliği|#isbirligi|#sponsored|#ad|#ortaklık|ücretli ortaklık|paid partnership)/i);
  const mentions = [...caption.matchAll(/@([a-zA-Z0-9._]{3,30})/g)].map((m) => m[1]!.toLowerCase());
  for (const m of mentions) {
    const known = KNOWN_BRAND_MAP[m];
    if (known) return { isSponsored: true, brandName: known.name, brandHandle: `@${m}`, disclosureTag: disclosureMatch?.[1] ?? "#işbirliği" };
  }
  if (disclosureMatch && mentions[0]) {
    const h = mentions[0];
    const pretty = h.charAt(0).toUpperCase() + h.slice(1).replace(/[._]/g, " ");
    return { isSponsored: true, brandName: pretty, brandHandle: `@${h}`, disclosureTag: disclosureMatch[1]! };
  }
  return { isSponsored: Boolean(disclosureMatch), brandName: null, brandHandle: null, disclosureTag: disclosureMatch?.[1] ?? null };
}

function explorerConfigKey(influencerId: string): string {
  return `influencer.explorer.${influencerId}`;
}

const LEGACY_STATUS: Record<string, SocialDataSource> = {
  META_API_VERIFIED: "META_API",
  HYBRID_API_BOT: "INSTAGRAM_PUBLIC",
  EXPLORER_BOT: "NONE",
};

function asSource(syncSource: string | null | undefined): SocialDataSource {
  if (syncSource === "META_API" || syncSource === "instagram_business_discovery") return "META_API";
  if (syncSource === "INSTAGRAM_OAUTH") return "INSTAGRAM_OAUTH";
  if (syncSource === "INSTAGRAM_PUBLIC" || syncSource === "manual" || syncSource === "mock") return "INSTAGRAM_PUBLIC";
  return "NONE";
}

function mediaTypeOf(product?: string | null): RecentMediaItem["mediaType"] {
  if (product === "REELS") return "REELS";
  if (product === "CAROUSEL_ALBUM" || product === "CAROUSEL") return "CAROUSEL";
  return "POST";
}

const shortDayFmt = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", timeZone: "Europe/Istanbul" });

const emptySentiment = (): AudienceSentimentAnalysis => ({
  available: false,
  positivePct: null,
  neutralPct: null,
  negativePct: null,
  purchaseIntentPct: null,
  authenticityScore: null,
  botFollowerEstimatePct: null,
  engagementPodRisk: null,
  saveToLikeRatioPct: null,
  commentQualityScore: null,
  topKeywords: [],
  sampleInsights: ["Yorum metni Business Discovery ve herkese açık yedekte yok. Duygu analizi üretilmedi."],
});

const unknownScores = (): BrandFitScores => ({
  known: false,
  overallScore: null,
  reliabilityScore: null,
  consistencyScore: null,
  conversionPotentialScore: null,
  sponsoredRetentionScore: null,
  priorityTier: null,
});

export async function runInstagramExplorerForInfluencer(
  influencerId: string,
  opts: { forceRefresh?: boolean; triggeredBy?: "admin" | "brand" | "auto" } = {},
): Promise<InfluencerExplorerReport | null> {
  const existingRow = await prisma.configValue.findUnique({
    where: { key: explorerConfigKey(influencerId) },
    select: { value: true, updatedAt: true },
  });
  const cached = existingRow?.value as InfluencerExplorerReport | undefined;
  const legacy = cached ? Boolean(LEGACY_STATUS[cached.verificationStatus as string]) : false;
  if (!opts.forceRefresh && cached && !legacy && Date.now() - existingRow!.updatedAt.getTime() < 30 * 60 * 1000) {
    return cached;
  }

  let freshMedia: IgMediaItem[] = [];
  let syncDetail = "Sayfa açılışında Graph çağrılmadı. Kayıtlı profil kullanıldı.";
  const started = Date.now();
  if (opts.forceRefresh) {
    const results = await syncInfluencer(influencerId, "INSTAGRAM", { force: true }).catch(() => []);
    const ig = results.find((r) => r.media) ?? results[0];
    freshMedia = ig?.media ?? [];
    syncDetail = ig?.ok ? `Senkron tamam (${ig.source ?? "kaynak yok"}).` : ig?.message ?? "Senkron yapılamadı.";
  }

  const inf = await prisma.influencer.findUnique({
    where: { id: influencerId },
    include: {
      categories: { orderBy: { primary: "desc" }, include: { category: true } },
      socialAccounts: { orderBy: { followers: "desc" }, include: { snapshots: { orderBy: { takenAt: "asc" }, take: 120 } } },
      assignments: {
        where: { contractStatus: "KABUL" },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          campaign: { include: { brand: { select: { name: true, category: true } } } },
          deliverables: { include: { metricSnapshots: { orderBy: { measuredAt: "desc" }, take: 1 } } },
        },
      },
    },
  });
  if (!inf) return null;

  const igAcc = inf.socialAccounts.find((a) => a.platform === "INSTAGRAM") ?? inf.socialAccounts[0];
  const handle = (igAcc?.handle ?? inf.name).replace(/^@/, "").toLowerCase();
  const source = asSource(igAcc?.syncSource);
  const followers = igAcc?.followers ?? 0;
  const er = igAcc ? Number(igAcc.engagementRate) : null;
  const avgLikes = igAcc?.avgLikes ?? null;
  const avgComments = igAcc?.avgComments ?? null;
  const avgViews = igAcc?.avgViews ?? null;

  const dailySeries: DailyGrowthPoint[] = (igAcc?.snapshots ?? []).map((s, i, arr) => {
    const prev = i > 0 ? arr[i - 1]!.followers : s.followers;
    const delta = s.followers - prev;
    return {
      date: s.takenAt.toISOString().slice(0, 10),
      label: shortDayFmt.format(s.takenAt),
      followers: s.followers,
      followersDelta: delta,
      growthRatePct: prev > 0 ? Number(((delta / prev) * 100).toFixed(2)) : 0,
      engagementRatePct: Number((Number(s.engagementRate) * 100).toFixed(2)),
      avgViews: null,
      avgLikes: null,
      avgComments: null,
      avgSaves: null,
      avgShares: null,
      postsPublished: 0,
      reelsPublished: 0,
      storiesPublished: 0,
    };
  });

  const snap30 = (igAcc?.snapshots ?? []).filter((s) => Date.now() - s.takenAt.getTime() >= 28 * 86_400_000).at(-1);
  const followersGrowth30d = snap30 ? followers - snap30.followers : null;
  const followersGrowth30dPct = snap30 && snap30.followers > 0 && followersGrowth30d != null ? Number(((followersGrowth30d / snap30.followers) * 100).toFixed(1)) : null;

  const recentMedia: RecentMediaItem[] = freshMedia.slice(0, 12).map((m) => {
    const cap = m.caption ?? "";
    const ext = cap ? extractBrandFromCaption(cap) : { isSponsored: false, brandName: null, brandHandle: null, disclosureTag: null };
    const erPct = followers > 0 && m.likeCount != null ? Number((((m.likeCount + (m.commentsCount ?? 0)) / followers) * 100).toFixed(2)) : null;
    return {
      id: m.id,
      mediaType: mediaTypeOf(m.mediaProductType),
      caption: cap.slice(0, 180) || `@${handle} paylaşımı`,
      permalink: m.permalink ?? null,
      publishedAt: m.timestamp ?? new Date().toISOString(),
      views: null,
      likes: m.likeCount ?? null,
      comments: m.commentsCount ?? null,
      saves: null,
      shares: null,
      erPct,
      isSponsored: ext.isSponsored,
      detectedBrand: ext.brandName,
      disclosureTag: ext.disclosureTag,
    };
  });

  const byType = new Map<RecentMediaItem["mediaType"], RecentMediaItem[]>();
  for (const m of recentMedia) {
    const list = byType.get(m.mediaType) ?? [];
    list.push(m);
    byType.set(m.mediaType, list);
  }
  const formatLabel: Record<RecentMediaItem["mediaType"], string> = {
    REELS: "Instagram Reels",
    CAROUSEL: "Kaydırmalı gönderi",
    POST: "Gönderi",
  };
  const formatBreakdown: FormatBreakdownItem[] = [...byType.entries()].map(([format, items]) => {
    const likes = items.map((i) => i.likes).filter((n): n is number => n != null);
    const comments = items.map((i) => i.comments).filter((n): n is number => n != null);
    const avgL = likes.length ? Math.round(likes.reduce((s, n) => s + n, 0) / likes.length) : null;
    const avgC = comments.length ? Math.round(comments.reduce((s, n) => s + n, 0) / comments.length) : null;
    return {
      format,
      label: formatLabel[format],
      sharePct: recentMedia.length ? Math.round((items.length / recentMedia.length) * 100) : 0,
      avgViews: null,
      avgLikes: avgL,
      avgComments: avgC,
      avgSaves: null,
      avgShares: null,
      erPct: followers > 0 && avgL != null ? Number((((avgL + (avgC ?? 0)) / followers) * 100).toFixed(2)) : null,
      weeklyFrequency: items.length,
    };
  });

  const brandCollaborations: DetectedBrandCollab[] = [];
  const seen = new Set<string>();
  for (const a of inf.assignments) {
    const snap = a.deliverables[0]?.metricSnapshots[0];
    const name = a.campaign.brand.name;
    seen.add(name.toLocaleLowerCase("tr"));
    brandCollaborations.push({
      id: `collab-camp-${a.id}`,
      brandName: name,
      brandHandle: `@${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      category: a.campaign.brand.category,
      lastWorkedAt: (a.deliverables[0]?.publishedAt ?? a.createdAt).toISOString(),
      contentType: a.deliverables[0]?.contentType === "STORY" ? "STORY" : a.deliverables[0]?.contentType === "CAROUSEL" ? "CAROUSEL" : a.deliverables[0]?.contentType === "FEED" ? "POST" : "REELS",
      views: snap?.reach ?? null,
      likes: snap?.likes ?? null,
      comments: snap?.comments ?? null,
      saves: snap?.saves ?? null,
      shares: snap?.shares ?? null,
      erPct: followers > 0 && snap?.likes != null ? Number((((snap.likes + (snap.comments ?? 0)) / followers) * 100).toFixed(2)) : null,
      disclosureTag: "#işbirliği",
      source: "platform_campaign",
      postUrl: a.deliverables[0]?.postUrl ?? null,
    });
  }
  for (const m of recentMedia) {
    if (!m.isSponsored || !m.detectedBrand || seen.has(m.detectedBrand.toLocaleLowerCase("tr"))) continue;
    seen.add(m.detectedBrand.toLocaleLowerCase("tr"));
    brandCollaborations.push({
      id: `collab-media-${m.id}`,
      brandName: m.detectedBrand,
      brandHandle: `@${m.detectedBrand.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
      category: inf.categories[0]?.category.name ?? inf.category,
      lastWorkedAt: m.publishedAt,
      contentType: m.mediaType,
      views: null,
      likes: m.likes,
      comments: m.comments,
      saves: null,
      shares: null,
      erPct: m.erPct,
      disclosureTag: m.disclosureTag ?? "#reklam",
      source: source === "INSTAGRAM_OAUTH" ? "instagram_oauth" : "meta_api",
      postUrl: m.permalink,
    });
  }

  const sponsored = recentMedia.filter((m) => m.isSponsored);
  const organic = recentMedia.filter((m) => !m.isSponsored);
  const avgOf = (rows: RecentMediaItem[], pick: (m: RecentMediaItem) => number | null) => {
    const nums = rows.map(pick).filter((n): n is number => n != null);
    return nums.length ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length) : null;
  };
  const organicVsSponsored: OrganicVsSponsoredStats = {
    organicCount: organic.length,
    sponsoredCount: brandCollaborations.length,
    organicAvgViews: null,
    sponsoredAvgViews: null,
    organicAvgLikes: avgOf(organic, (m) => m.likes),
    sponsoredAvgLikes: avgOf(sponsored, (m) => m.likes),
    organicAvgSaves: null,
    sponsoredAvgSaves: null,
    organicErPct: er != null ? Number((er * 100).toFixed(2)) : null,
    sponsoredErPct: null,
    performanceRetentionPct: null,
  };

  const label = syncSourceLabels[source] ?? "Veri yok";
  const reasonNote = igAcc && "syncReason" in igAcc && igAcc.syncReason ? ` Yol nedeni: ${igAcc.syncReason}.` : "";
  const summary =
    (source === "NONE"
      ? `@${handle} için doğrulanmış Instagram verisi yok. Business Discovery kişisel veya gizli hesapları okumaz; kazıma yapılmaz. İçerik üreticisi Instagram ile bağlayabilir.`
      : `@${handle} kaynağı: ${label}. Takipçi ${followers.toLocaleString("tr-TR")}${avgLikes != null ? `, ortalama beğeni ${avgLikes.toLocaleString("tr-TR")}` : ""}. İzlenme, kaydetme ve yorum duygu analizi bu kaynaktan gelmez; uydurulmadı.`) + reasonNote;

  const report: InfluencerExplorerReport = {
    influencerId: inf.id,
    handle,
    generatedAt: new Date().toISOString(),
    verificationStatus: source,
    followers,
    followersGrowth30d,
    followersGrowth30dPct,
    avgErPct: er != null ? Number((er * 100).toFixed(2)) : null,
    avgReelsViews: avgViews,
    avgViewsGrowth30dPct: null,
    avgLikes,
    avgComments,
    avgSaves: null,
    avgShares: null,
    weeklyPosts: null,
    weeklyReels: null,
    weeklyStories: null,
    viewsKnown: avgViews != null,
    savesKnown: false,
    aiExecutiveSummary: summary,
    aiHighlights: [
      source === "META_API" ? "Takipçi ve beğeni Meta Business Discovery ile doğrulandı." : `Kaynak: ${label}.`,
      freshMedia.length ? `${freshMedia.length} gönderinin beğeni ve yorumu okundu.` : "Gönderi listesi bu turda yok.",
      "Kaydetme, paylaşım ve duygu yüzdesi üretilmedi.",
    ],
    aiRecommendation: source === "NONE" ? "Önce Instagram bağlantısı veya herkese açık işletme hesabı gerekir." : "Karar için yalnız doğrulanmış takipçi ve beğeni kullanın.",
    scores: unknownScores(),
    dailySeries,
    formatBreakdown,
    recentMedia,
    brandCollaborations,
    organicVsSponsored,
    sentiment: emptySentiment(),
    rawLogs: [
      {
        timestamp: new Date().toISOString(),
        source: source === "META_API" ? "META_GRAPH_API" : source === "INSTAGRAM_OAUTH" ? "INSTAGRAM_OAUTH" : source === "INSTAGRAM_PUBLIC" ? "INSTAGRAM_PUBLIC" : "NONE",
        endpoint: opts.forceRefresh ? "syncInfluencer" : "stored-profile",
        status: source === "NONE" ? "WARN" : "OK",
        itemsScanned: freshMedia.length,
        durationMs: Date.now() - started,
        detail: syncDetail,
      },
    ],
  };

  await prisma.configValue.upsert({
    where: { key: explorerConfigKey(inf.id) },
    create: { key: explorerConfigKey(inf.id), value: report as never, verified: source === "META_API", note: `Instagram raporu (@${handle})` },
    update: { value: report as never, verified: source === "META_API" },
  });
  return report;
}

export async function runInstagramExplorerForAll(limit = 30): Promise<{ scanned: number; verified: number }> {
  const list = await prisma.influencer.findMany({ take: limit, orderBy: { updatedAt: "desc" }, select: { id: true } });
  let scanned = 0;
  let verified = 0;
  for (const inf of list) {
    const r = await runInstagramExplorerForInfluencer(inf.id, { forceRefresh: true, triggeredBy: "admin" });
    if (r) {
      scanned++;
      if (r.verificationStatus === "META_API") verified++;
    }
  }
  return { scanned, verified };
}
