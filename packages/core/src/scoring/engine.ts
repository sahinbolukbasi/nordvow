import type { Platform } from "../generated/prisma/enums";
import { prisma } from "../db";
import { computeInfluencerStats } from "../domain/influencer-stats";
import { buildBaselineBenchmarkGroup, loadPeerBenchmarkGroup } from "./benchmarks";
import {
  clamp,
  coefficientOfVariation,
  detectViralOutliers,
  gradeForScore,
  mean,
  median,
  percentileRank,
  resolveFollowerBand,
  weightedScoreWithRedistribution,
} from "./math";
import {
  AUTO_TAG_RULES,
  BRAND_MATCH_WEIGHTS,
  CATEGORY_CPM_BENCHMARK_TRY,
  CONFIDENCE_THRESHOLDS,
  DIMENSION_WEIGHTS,
  SCORE_VERSION,
  SIGNAL_WEIGHTS,
  WINDOW_LIMITS,
} from "./scoring.config";
import type {
  BrandMatchResult,
  ConfidenceLevel,
  DimensionKey,
  DimensionScoreResult,
  InfluencerNordvowScoreReport,
  InfluencerTaskItem,
  MediaSample,
  MetricStatus,
  PeerBenchmarkGroup,
  PlatformMeasurementInput,
  PlatformScoreResult,
  RawMetricsSummary,
  SignalDetail,
} from "./types";

const DAY_MS = 86_400_000;

function filterWindowPosts(posts: MediaSample[], now: Date): MediaSample[] {
  const cutoff = now.getTime() - WINDOW_LIMITS.maxDays * DAY_MS;
  return [...posts]
    .filter((p) => p.publishedAt.getTime() >= cutoff)
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, WINDOW_LIMITS.maxPosts);
}

function determineConfidence(
  hasOAuth: boolean,
  postsCount: number,
  snapshotDays: number,
  missingRatio: number,
): ConfidenceLevel {
  if (
    hasOAuth &&
    postsCount >= CONFIDENCE_THRESHOLDS.highMinPosts &&
    snapshotDays >= CONFIDENCE_THRESHOLDS.highMinSnapshotDays &&
    missingRatio <= 0.15
  ) {
    return "YUKSEK";
  }
  if (
    postsCount >= CONFIDENCE_THRESHOLDS.mediumMinPosts &&
    snapshotDays >= CONFIDENCE_THRESHOLDS.lowMaxSnapshotDays &&
    missingRatio <= 0.35
  ) {
    return "ORTA";
  }
  return "DUSUK";
}

function lowerConfidence(c: ConfidenceLevel): ConfidenceLevel {
  if (c === "YUKSEK") return "ORTA";
  return "DUSUK";
}

function evaluateReasonableEr(erPct: number, peerMedianErPct: number): number {
  if (peerMedianErPct <= 0) return 60;
  const ratio = erPct / peerMedianErPct;
  // Çok düşük (<0.3x = pasif/bot) veya aşırı yüksek (>4.5x = pod şüphesi) cezalandırılır.
  if (ratio >= 0.6 && ratio <= 2.5) return 92;
  if (ratio >= 0.35 && ratio <= 3.8) return 70;
  if (ratio < 0.25) return 28;
  if (ratio > 5.0) return 35;
  return 48;
}

function evaluateCommentLikeRatio(ratio: number): number {
  // Sağlıklı yorum/beğeni oranı genelde %1 – %12 arasındadır.
  if (ratio >= 0.01 && ratio <= 0.12) return 90;
  if (ratio >= 0.004 && ratio <= 0.2) return 68;
  return 35;
}

export function computePlatformScore(
  input: PlatformMeasurementInput,
  benchmark?: PeerBenchmarkGroup,
  now: Date = new Date(),
): PlatformScoreResult {
  const band = resolveFollowerBand(input.followers);
  const peers =
    benchmark ?? buildBaselineBenchmarkGroup(input.platform, input.followers, input.categoryLabel);
  const updatedAt = (input.lastSyncedAt ?? now).toISOString();

  if (input.syncError) {
    return buildEmptyPlatformResult(input, band, peers, "hata", updatedAt);
  }
  if (input.isPrivate) {
    return buildEmptyPlatformResult(input, band, peers, "gizli", updatedAt);
  }

  const windowPosts = filterWindowPosts(input.posts, now);
  const snapshots = [...input.snapshots].sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime());
  const snapshotDays =
    snapshots.length >= 2
      ? Math.max(1, Math.round((snapshots[snapshots.length - 1]!.takenAt.getTime() - snapshots[0]!.takenAt.getTime()) / DAY_MS))
      : snapshots.length;

  // Aykırı (viral) gönderi tespiti: etkileşim veya izlenme medyan × 5 üstü
  const { normal: normalPosts, viral: viralPosts } = detectViralOutliers(windowPosts, (p) => {
    if (p.views != null && p.views > 0) return p.views;
    const likes = p.likesHidden ? 0 : (p.likes ?? 0);
    return likes + (p.comments ?? 0) + (p.saves ?? 0) + (p.shares ?? 0);
  });

  // 1. Ham metrikler (medyan tabanlı; gizli beğeniler hariç)
  const erSamples: number[] = [];
  for (const p of normalPosts) {
    if (p.likesHidden || p.likes == null || input.followers <= 0) continue;
    const total = p.likes + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
    erSamples.push((total / input.followers) * 100);
  }
  const erPctVal = median(erSamples);
  const allLikesHidden = windowPosts.length > 0 && windowPosts.every((p) => p.likesHidden);

  const viewSamples = normalPosts.map((p) => p.views).filter((v): v is number => v != null && v > 0);
  const medianViewsVal = median(viewSamples);
  const vrPctVal =
    medianViewsVal != null && input.followers > 0
      ? (medianViewsVal / input.followers) * 100
      : null;

  const ervSamples: number[] = [];
  for (const p of normalPosts) {
    if (p.views == null || p.views <= 0) continue;
    const likes = p.likesHidden ? 0 : (p.likes ?? 0);
    const total = likes + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
    ervSamples.push((total / p.views) * 100);
  }
  const ervPctVal = median(ervSamples);

  const totalLikes = normalPosts.reduce((s, p) => s + (p.likesHidden ? 0 : (p.likes ?? 0)), 0);
  const totalComments = normalPosts.reduce((s, p) => s + (p.comments ?? 0), 0);
  const commentLikeRatioVal = totalLikes > 0 ? totalComments / totalLikes : null;

  const saveShareSamples: number[] = [];
  for (const p of normalPosts) {
    const denom = p.reach && p.reach > 0 ? p.reach : p.views && p.views > 0 ? p.views : null;
    if (!denom) continue;
    if (p.saves == null && p.shares == null) continue;
    saveShareSamples.push((((p.saves ?? 0) + (p.shares ?? 0)) / denom) * 100);
  }
  const saveShareRatePctVal = median(saveShareSamples);

  let weeklyFrequencyVal: number | null = null;
  if (windowPosts.length >= 2) {
    const oldest = windowPosts[windowPosts.length - 1]!.publishedAt.getTime();
    const newest = windowPosts[0]!.publishedAt.getTime();
    const spanWeeks = Math.max(1, (newest - oldest) / (7 * DAY_MS));
    weeklyFrequencyVal = Number((windowPosts.length / spanWeeks).toFixed(2));
  }

  const cvBase = viewSamples.length >= 4 ? viewSamples : erSamples;
  const cv = coefficientOfVariation(cvBase);
  const consistencyScoreVal = cv != null ? Math.round(clamp((1 - cv) * 100, 5, 98)) : null;

  // 30 günlük net takipçi değişimi %
  let growth30dPctVal: number | null = null;
  let growthSpikeSuspicious = false;
  if (snapshots.length >= 2) {
    const latest = snapshots[snapshots.length - 1]!;
    const targetTime = latest.takenAt.getTime() - 30 * DAY_MS;
    const baseSnap =
      snapshots.find((s) => s.takenAt.getTime() >= targetTime) ?? snapshots[0]!;
    if (baseSnap.followers > 0 && baseSnap !== latest) {
      growth30dPctVal = Number((((latest.followers - baseSnap.followers) / baseSnap.followers) * 100).toFixed(2));
    }
    // Ani sıçrama kontrolü (ardışık iki snapshot arasında tek günde >%15 sıçrama)
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1]!;
      const curr = snapshots[i]!;
      const days = Math.max(1, (curr.takenAt.getTime() - prev.takenAt.getTime()) / DAY_MS);
      const dailyJump = prev.followers > 0 ? (curr.followers - prev.followers) / prev.followers / days : 0;
      if (dailyJump > 0.15) growthSpikeSuspicious = true;
    }
  }

  // Sponsorlu / Organik ER
  const sponsoredErs: number[] = [];
  const organicErs: number[] = [];
  for (const p of normalPosts) {
    if (p.likesHidden || p.likes == null || input.followers <= 0) continue;
    const er = ((p.likes + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0)) / input.followers) * 100;
    if (p.isSponsored) sponsoredErs.push(er);
    else organicErs.push(er);
  }
  const medSponsored = median(sponsoredErs);
  const medOrganic = median(organicErs);
  const sponsoredOrganicRatioVal =
    medSponsored != null && medOrganic != null && medOrganic > 0
      ? Number((medSponsored / medOrganic).toFixed(2))
      : null;

  const rawMetrics: RawMetricsSummary = {
    erPct: {
      value: erPctVal != null ? Number(erPctVal.toFixed(2)) : null,
      status: erPctVal != null ? "tamam" : allLikesHidden ? "gizli" : "eksik",
    },
    vrPct: {
      value: vrPctVal != null ? Number(vrPctVal.toFixed(1)) : null,
      status: vrPctVal != null ? "tamam" : input.hasOAuth || input.platform !== "INSTAGRAM" ? "eksik" : "baglanti_gerekli",
    },
    ervPct: {
      value: ervPctVal != null ? Number(ervPctVal.toFixed(2)) : null,
      status: ervPctVal != null ? "tamam" : input.hasOAuth ? "eksik" : "baglanti_gerekli",
    },
    commentLikeRatio: {
      value: commentLikeRatioVal != null ? Number(commentLikeRatioVal.toFixed(4)) : null,
      status: commentLikeRatioVal != null ? "tamam" : "eksik",
    },
    saveShareRatePct: {
      value: saveShareRatePctVal != null ? Number(saveShareRatePctVal.toFixed(2)) : null,
      status: saveShareRatePctVal != null ? "tamam" : input.hasOAuth ? "eksik" : "baglanti_gerekli",
    },
    weeklyFrequency: {
      value: weeklyFrequencyVal,
      status: weeklyFrequencyVal != null ? "tamam" : "eksik",
    },
    consistencyScore: {
      value: consistencyScoreVal,
      status: consistencyScoreVal != null ? "tamam" : "eksik",
    },
    growth30dPct: {
      value: growth30dPctVal,
      status: growth30dPctVal != null ? "tamam" : "eksik",
    },
    sponsoredOrganicRatio: {
      value: sponsoredOrganicRatioVal,
      status: sponsoredOrganicRatioVal != null ? "tamam" : "eksik",
    },
    audienceMatchPct: {
      value: input.audienceMatchPct ?? null,
      status: input.audienceMatchPct != null ? "tamam" : input.hasOAuth ? "eksik" : "baglanti_gerekli",
    },
    medianViews: medianViewsVal != null ? Math.round(medianViewsVal) : null,
    viralCount: viralPosts.length,
    postsEvaluated: windowPosts.length,
    snapshotDays,
  };

  const baseConfidence = determineConfidence(
    input.hasOAuth,
    windowPosts.length,
    snapshotDays,
    0,
  );

  // 2. Altı Ana Skor
  // 4.1 Kitle Güvenilirliği
  const botRates = normalPosts.map((p) => p.botCommentRatio).filter((v): v is number => v != null);
  const avgBotRate = mean(botRates);
  const credSignals: SignalDetail[] = [
    {
      key: "growthStability",
      label: "Büyümede ani sıçrama olmaması",
      value: growth30dPctVal != null ? (growthSpikeSuspicious ? 30 : 92) : null,
      weight: SIGNAL_WEIGHTS.audienceCredibility.growthStability,
      status: growth30dPctVal != null ? "tamam" : "eksik",
    },
    {
      key: "erReasonable",
      label: "ER makul aralıkta",
      value: erPctVal != null ? evaluateReasonableEr(erPctVal, peers.medianEr) : null,
      weight: SIGNAL_WEIGHTS.audienceCredibility.erReasonable,
      status: rawMetrics.erPct.status,
    },
    {
      key: "commentLikeRatio",
      label: "Yorum/beğeni oranı",
      value: commentLikeRatioVal != null ? evaluateCommentLikeRatio(commentLikeRatioVal) : null,
      weight: SIGNAL_WEIGHTS.audienceCredibility.commentLikeRatio,
      status: rawMetrics.commentLikeRatio.status,
    },
    {
      key: "lowBotComments",
      label: "Bot benzeri yorum düşüklüğü",
      value: avgBotRate != null ? Math.round(clamp((1 - avgBotRate * 2) * 100, 10, 98)) : null,
      weight: SIGNAL_WEIGHTS.audienceCredibility.lowBotComments,
      status: avgBotRate != null ? "tamam" : input.hasOAuth ? "eksik" : "baglanti_gerekli",
    },
    {
      key: "viewFollowerRatio",
      label: "İzlenme/takipçi oranı",
      value: vrPctVal != null ? percentileRank(vrPctVal, peers.vrValues) : null,
      weight: SIGNAL_WEIGHTS.audienceCredibility.viewFollowerRatio,
      status: rawMetrics.vrPct.status,
    },
    {
      key: "demographicConsistency",
      label: "Demografi tutarlılığı",
      value: input.demographicConsistencyScore ?? null,
      weight: SIGNAL_WEIGHTS.audienceCredibility.demographicConsistency,
      status: input.demographicConsistencyScore != null ? "tamam" : input.hasOAuth ? "eksik" : "baglanti_gerekli",
    },
  ];
  const credRes = weightedScoreWithRedistribution(credSignals);

  // 4.2 Etkileşim Kalitesi
  const meaningfulRates = normalPosts.map((p) => p.meaningfulCommentRatio).filter((v): v is number => v != null);
  const avgMeaningful = mean(meaningfulRates);
  const erPctile = erPctVal != null ? percentileRank(erPctVal, peers.erValues) : null;
  const engSignals: SignalDetail[] = [
    {
      key: "erPercentile",
      label: "ER yüzdelik dilimi",
      value: erPctile,
      weight: SIGNAL_WEIGHTS.engagementQuality.erPercentile,
      status: rawMetrics.erPct.status,
    },
    {
      key: "ervPercentile",
      label: "İzlenme bazlı ER (ERv)",
      value: ervPctVal != null ? percentileRank(ervPctVal, peers.ervValues) : null,
      weight: SIGNAL_WEIGHTS.engagementQuality.ervPercentile,
      status: rawMetrics.ervPct.status,
    },
    {
      key: "saveShareRate",
      label: "Kaydetme + paylaşım oranı",
      value: saveShareRatePctVal != null ? percentileRank(saveShareRatePctVal, peers.saveShareValues) : null,
      weight: SIGNAL_WEIGHTS.engagementQuality.saveShareRate,
      status: rawMetrics.saveShareRatePct.status,
    },
    {
      key: "meaningfulComments",
      label: "Anlamlı yorum oranı",
      value: avgMeaningful != null ? Math.round(clamp(avgMeaningful * 100, 15, 98)) : null,
      weight: SIGNAL_WEIGHTS.engagementQuality.meaningfulComments,
      status: avgMeaningful != null ? "tamam" : input.hasOAuth ? "eksik" : "baglanti_gerekli",
    },
  ];
  const engRes = weightedScoreWithRedistribution(engSignals);

  // 4.3 Erişim Gücü
  const vrPctile = vrPctVal != null ? percentileRank(vrPctVal, peers.vrValues) : null;
  const reachSignals: SignalDetail[] = [
    {
      key: "viewRatePercentile",
      label: "İzlenme oranı yüzdelik dilimi",
      value: vrPctile,
      weight: SIGNAL_WEIGHTS.reachPower.viewRatePercentile,
      status: rawMetrics.vrPct.status,
    },
    {
      key: "medianViews",
      label: "Medyan izlenme",
      value: medianViewsVal != null ? percentileRank(medianViewsVal, peers.medianViewsValues) : null,
      weight: SIGNAL_WEIGHTS.reachPower.medianViews,
      status: medianViewsVal != null ? "tamam" : rawMetrics.vrPct.status,
    },
    {
      key: "followers",
      label: "Takipçi ölçeği",
      value: input.followers > 0 ? percentileRank(input.followers, peers.followerValues) : null,
      weight: SIGNAL_WEIGHTS.reachPower.followers,
      status: input.followers > 0 ? "tamam" : "eksik",
    },
  ];
  const reachRes = weightedScoreWithRedistribution(reachSignals);

  // 4.4 İçerik İstikrarı
  const uniqueFormats = new Set(windowPosts.map((p) => p.mediaType)).size;
  const formatDivScore = windowPosts.length > 0 ? clamp(uniqueFormats * 30 + 10, 25, 98) : null;
  const consSignals: SignalDetail[] = [
    {
      key: "postingFrequency",
      label: "Yayın sıklığı",
      value: weeklyFrequencyVal != null ? percentileRank(weeklyFrequencyVal, peers.weeklyFreqValues) : null,
      weight: SIGNAL_WEIGHTS.contentConsistency.postingFrequency,
      status: rawMetrics.weeklyFrequency.status,
    },
    {
      key: "consistency",
      label: "Performans tutarlılığı",
      value: consistencyScoreVal != null ? percentileRank(consistencyScoreVal, peers.consistencyValues) : null,
      weight: SIGNAL_WEIGHTS.contentConsistency.consistency,
      status: rawMetrics.consistencyScore.status,
    },
    {
      key: "formatDiversity",
      label: "Format çeşitliliği",
      value: formatDivScore,
      weight: SIGNAL_WEIGHTS.contentConsistency.formatDiversity,
      status: formatDivScore != null ? "tamam" : "eksik",
    },
  ];
  const consRes = weightedScoreWithRedistribution(consSignals);

  // 4.5 Ticari Performans
  const purchaseRates = normalPosts.map((p) => p.purchaseIntentRatio).filter((v): v is number => v != null);
  const avgPurchase = mean(purchaseRates);
  const commSignals: SignalDetail[] = [
    {
      key: "sponsoredRatio",
      label: "Sponsorlu / organik ER",
      value:
        sponsoredOrganicRatioVal != null
          ? Math.round(clamp(sponsoredOrganicRatioVal * 85, 20, 98))
          : null,
      weight: SIGNAL_WEIGHTS.commercialPerformance.sponsoredRatio,
      status: rawMetrics.sponsoredOrganicRatio.status,
    },
    {
      key: "purchaseIntentComments",
      label: "Satın alma niyeti yorumları",
      value: avgPurchase != null ? Math.round(clamp(avgPurchase * 400, 20, 98)) : null,
      weight: SIGNAL_WEIGHTS.commercialPerformance.purchaseIntentComments,
      status: avgPurchase != null ? "tamam" : "eksik",
    },
    {
      key: "campaignHistory",
      label: "Geçmiş kampanya teslim & puanı",
      value: input.campaignHistoryScore ?? null,
      weight: SIGNAL_WEIGHTS.commercialPerformance.campaignHistory,
      status: input.campaignHistoryScore != null ? "tamam" : "eksik",
    },
  ];
  const commRes = weightedScoreWithRedistribution(commSignals);

  // 4.6 Büyüme Momentumu
  let viewsTrendScore: number | null = null;
  if (viewSamples.length >= 6) {
    const half = Math.floor(viewSamples.length / 2);
    const recentHalf = median(viewSamples.slice(0, half)) ?? 0;
    const olderHalf = median(viewSamples.slice(half)) ?? 0;
    if (olderHalf > 0) {
      const deltaPct = ((recentHalf - olderHalf) / olderHalf) * 100;
      viewsTrendScore = Math.round(clamp(50 + deltaPct, 10, 98));
    }
  }
  let erTrendScore: number | null = null;
  let erDeltaPct = 0;
  if (snapshots.length >= 4) {
    const mid = Math.floor(snapshots.length / 2);
    const oldEr = mean(snapshots.slice(0, mid).map((s) => s.engagementRate)) ?? 0;
    const newEr = mean(snapshots.slice(mid).map((s) => s.engagementRate)) ?? 0;
    if (oldEr > 0) {
      erDeltaPct = ((newEr - oldEr) / oldEr) * 100;
      erTrendScore = Math.round(clamp(50 + erDeltaPct * 1.2, 10, 98));
    }
  }
  const growthSignals: SignalDetail[] = [
    {
      key: "followerGrowth30d",
      label: "30 günlük takipçi büyümesi",
      value: growth30dPctVal != null ? percentileRank(growth30dPctVal, peers.growth30dValues) : null,
      weight: SIGNAL_WEIGHTS.growthMomentum.followerGrowth30d,
      status: rawMetrics.growth30dPct.status,
    },
    {
      key: "viewsTrend",
      label: "İzlenme trendi",
      value: viewsTrendScore,
      weight: SIGNAL_WEIGHTS.growthMomentum.viewsTrend,
      status: viewsTrendScore != null ? "tamam" : "eksik",
    },
    {
      key: "erTrend",
      label: "ER trendi",
      value: erTrendScore,
      weight: SIGNAL_WEIGHTS.growthMomentum.erTrend,
      status: erTrendScore != null ? "tamam" : "eksik",
    },
  ];
  const growthRes = weightedScoreWithRedistribution(growthSignals);

  const dimensions: DimensionScoreResult[] = [
    {
      key: "audienceCredibility",
      title: "Kitle Güvenilirliği",
      score: credRes.score,
      status: credRes.score != null ? "tamam" : input.hasOAuth ? "eksik" : "baglanti_gerekli",
      confidence: credRes.missingWeightRatio > 0.25 ? lowerConfidence(baseConfidence) : baseConfidence,
      percentile: credRes.score,
      benchmarkLabel: `Kıyas: ${peers.label}`,
      why: [
        growthSpikeSuspicious
          ? "Takipçi grafiğinde ani sıçrama tespit edildi"
          : "Takipçi büyümesi organik seyrediyor",
        erPctVal != null
          ? `Medyan ER %${erPctVal.toFixed(2)} (grup medyanı %${peers.medianEr.toFixed(2)})`
          : "ER verisi sınırlı",
      ],
      howToImprove: [
        ...(!input.hasOAuth ? [{ text: "OAuth bağlantısını tamamla (bot & demografi doğrulaması)", estimatedGain: 8 }] : []),
        { text: "Yorumlarda aktif sohbet başlatarak gerçek etkileşimi artır", estimatedGain: 4 },
      ],
      source: input.sourceLabel,
      updatedAt,
      signals: credSignals,
    },
    {
      key: "engagementQuality",
      title: "Etkileşim Kalitesi",
      score: engRes.score,
      status: engRes.score != null ? "tamam" : allLikesHidden ? "gizli" : "eksik",
      confidence: engRes.missingWeightRatio > 0.25 ? lowerConfidence(baseConfidence) : baseConfidence,
      percentile: erPctile ?? engRes.score,
      benchmarkLabel: `Kıyas: ${peers.label}${erPctile ? ` · %${erPctile} dilim` : ""}`,
      why: [
        erPctVal != null
          ? `Medyan ER %${erPctVal.toFixed(2)} (grup medyanı %${peers.medianEr.toFixed(2)})`
          : "Beğeni/etkileşim verisi eksik",
        saveShareRatePctVal != null
          ? `Kaydetme+paylaşım oranı %${saveShareRatePctVal.toFixed(2)}`
          : "Kaydetme ve paylaşım verisi için OAuth önerilir",
      ],
      howToImprove: [
        { text: "Kaydedilebilir rehber/liste formatında içerik üret", estimatedGain: 7 },
        { text: "İlk 1 saatte gelen yorumlara yanıt ver", estimatedGain: 4 },
      ],
      source: input.sourceLabel,
      updatedAt,
      signals: engSignals,
    },
    {
      key: "reachPower",
      title: "Erişim Gücü",
      score: reachRes.score,
      status: reachRes.score != null ? "tamam" : input.hasOAuth ? "eksik" : "baglanti_gerekli",
      confidence: reachRes.missingWeightRatio > 0.25 ? lowerConfidence(baseConfidence) : baseConfidence,
      percentile: vrPctile ?? reachRes.score,
      benchmarkLabel: `Kıyas: ${peers.label}`,
      why: [
        vrPctVal != null
          ? `İzlenmeler takipçinin %${vrPctVal.toFixed(0)}'i (grup medyanı %${peers.medianVr.toFixed(0)})`
          : "Video/Reels izlenme verisi bekleniyor",
        medianViewsVal != null ? `Medyan izlenme: ${Math.round(medianViewsVal).toLocaleString("tr-TR")}` : "Takipçi ölçeği baz alındı",
      ],
      howToImprove: [
        { text: "Haftada +1 Reels / kısa video ekle", estimatedGain: 6 },
      ],
      source: input.sourceLabel,
      updatedAt,
      signals: reachSignals,
    },
    {
      key: "contentConsistency",
      title: "İçerik İstikrarı",
      score: consRes.score,
      status: consRes.score != null ? "tamam" : "eksik",
      confidence: consRes.missingWeightRatio > 0.25 ? lowerConfidence(baseConfidence) : baseConfidence,
      percentile: consRes.score,
      benchmarkLabel: `Kıyas: ${peers.label}`,
      why: [
        weeklyFrequencyVal != null ? `Haftalık ortalama ${weeklyFrequencyVal} gönderi` : "Yayın sıklığı ölçülemedi",
        consistencyScoreVal != null ? `Performans tutarlılığı %${consistencyScoreVal}` : "Tutarlılık için daha fazla gönderi gerekli",
      ],
      howToImprove: [
        { text: "Haftada en az 3 düzenli içerik paylaş", estimatedGain: 6 },
        { text: "Reels + Carousel + Story formatlarını birlikte kullan", estimatedGain: 4 },
      ],
      source: input.sourceLabel,
      updatedAt,
      signals: consSignals,
    },
    {
      key: "commercialPerformance",
      title: "Ticari Performans",
      score: commRes.score,
      status: commRes.score != null ? "tamam" : "eksik",
      confidence: commRes.score != null ? baseConfidence : "DUSUK",
      percentile: commRes.score,
      benchmarkLabel: commRes.score != null ? `Kıyas: ${peers.label}` : "Henüz ölçülemedi (iş birliği bekleniyor)",
      why: [
        sponsoredOrganicRatioVal != null
          ? `Sponsorlu içerik, organik performansın %${Math.round(sponsoredOrganicRatioVal * 100)}'ini yakaladı`
          : "Henüz sponsorlu iş birliği verisi bulunmuyor",
        input.campaignHistoryScore != null
          ? `Platform kampanya teslim & performans puanı: ${input.campaignHistoryScore}/100`
          : "Tamamlanmış kampanya verisi bekleniyor",
      ],
      howToImprove: [
        { text: "#reklam / ücretli ortaklık etiketiyle şeffaf iş birliği yayınla", estimatedGain: 8 },
      ],
      source: input.sourceLabel,
      updatedAt,
      signals: commSignals,
    },
    {
      key: "growthMomentum",
      title: "Büyüme Momentumu",
      score: growthRes.score,
      status: growthRes.score != null ? "tamam" : "eksik",
      confidence: growthRes.missingWeightRatio > 0.25 ? lowerConfidence(baseConfidence) : baseConfidence,
      percentile: growthRes.score,
      benchmarkLabel: `Kıyas: ${peers.label}`,
      why: [
        growth30dPctVal != null
          ? `30 günlük net takipçi değişimi ${growth30dPctVal >= 0 ? "+" : ""}%${growth30dPctVal}`
          : "30 günlük takipçi snapshot geçmişi birikiyor",
        viralPosts.length > 0 ? `Son 30 gönderide ${viralPosts.length} viral içerik` : "Düzenli büyüme ivmesi",
      ],
      howToImprove: [
        { text: "Viral potansiyelli kısa video kancalarını (ilk 3 sn) güçlendir", estimatedGain: 5 },
      ],
      source: input.sourceLabel,
      updatedAt,
      signals: growthSignals,
    },
  ];

  // Genel Skor (eksik boyut ağırlıkları mevcut boyutlara dağıtılır; >%50 eksikse null)
  const dimInputs = [
    { value: credRes.score, weight: DIMENSION_WEIGHTS.audienceCredibility },
    { value: engRes.score, weight: DIMENSION_WEIGHTS.engagementQuality },
    { value: reachRes.score, weight: DIMENSION_WEIGHTS.reachPower },
    { value: consRes.score, weight: DIMENSION_WEIGHTS.contentConsistency },
    { value: commRes.score, weight: DIMENSION_WEIGHTS.commercialPerformance },
    { value: growthRes.score, weight: DIMENSION_WEIGHTS.growthMomentum },
  ];
  const overallRes = weightedScoreWithRedistribution(dimInputs);
  const overallScore = overallRes.score;
  const grade = overallScore != null ? gradeForScore(overallScore).grade : null;

  // Otomatik etiketler (config kuralları)
  const tags: string[] = [];
  if ((engRes.score ?? 0) >= AUTO_TAG_RULES.highEngagementMinScore) tags.push("Yüksek Etkileşim");
  if ((vrPctVal ?? 0) >= AUTO_TAG_RULES.strongReelsMinVrPct) tags.push("Güçlü Reels");
  if ((growth30dPctVal ?? 0) >= AUTO_TAG_RULES.fastGrowingMinGrowth30dPct) tags.push("Hızlı Büyüyen");
  if ((saveShareRatePctVal ?? 0) >= AUTO_TAG_RULES.loyalAudienceMinSaveSharePct) tags.push("Sadık Kitle");
  if ((commRes.score ?? 0) >= AUTO_TAG_RULES.strongSponsoredMinScore) tags.push("Sponsorlu İçerikte Güçlü");
  if (input.hasOAuth) tags.push("Doğrulanmış Veri");
  if (credRes.score != null && credRes.score <= AUTO_TAG_RULES.botRiskMaxCredibilityScore) tags.push("Bot Riski");
  if (erDeltaPct <= AUTO_TAG_RULES.fallingErThresholdPct) tags.push("Düşen Etkileşim");
  if (weeklyFrequencyVal != null && weeklyFrequencyVal < AUTO_TAG_RULES.lowFrequencyMaxWeeklyPosts) tags.push("Az Paylaşım");

  return {
    platform: input.platform,
    handle: input.handle,
    band: band.key,
    bandLabel: band.label,
    followers: input.followers,
    hasOAuth: input.hasOAuth,
    overallScore,
    grade,
    isEstimated: baseConfidence === "DUSUK",
    confidence: baseConfidence,
    rawMetrics,
    dimensions,
    tags,
    source: input.sourceLabel,
    updatedAt,
  };
}

function buildEmptyPlatformResult(
  input: PlatformMeasurementInput,
  band: { key: PlatformScoreResult["band"]; label: string },
  peers: PeerBenchmarkGroup,
  status: MetricStatus,
  updatedAt: string,
): PlatformScoreResult {
  const emptyMetric = { value: null, status };
  const keys: { key: DimensionKey; title: string }[] = [
    { key: "audienceCredibility", title: "Kitle Güvenilirliği" },
    { key: "engagementQuality", title: "Etkileşim Kalitesi" },
    { key: "reachPower", title: "Erişim Gücü" },
    { key: "contentConsistency", title: "İçerik İstikrarı" },
    { key: "commercialPerformance", title: "Ticari Performans" },
    { key: "growthMomentum", title: "Büyüme Momentumu" },
  ];
  return {
    platform: input.platform,
    handle: input.handle,
    band: band.key,
    bandLabel: band.label,
    followers: input.followers,
    hasOAuth: input.hasOAuth,
    overallScore: null,
    grade: null,
    isEstimated: true,
    confidence: "DUSUK",
    rawMetrics: {
      erPct: emptyMetric,
      vrPct: emptyMetric,
      ervPct: emptyMetric,
      commentLikeRatio: emptyMetric,
      saveShareRatePct: emptyMetric,
      weeklyFrequency: emptyMetric,
      consistencyScore: emptyMetric,
      growth30dPct: emptyMetric,
      sponsoredOrganicRatio: emptyMetric,
      audienceMatchPct: emptyMetric,
      medianViews: null,
      viralCount: 0,
      postsEvaluated: 0,
      snapshotDays: 0,
    },
    dimensions: keys.map((k) => ({
      key: k.key,
      title: k.title,
      score: null,
      status,
      confidence: "DUSUK",
      percentile: null,
      benchmarkLabel: `Kıyas: ${peers.label}`,
      why: [status === "gizli" ? "Hesap gizli olduğu için veri alınamadı" : "Senkronizasyon hatası nedeniyle veri eksik"],
      howToImprove: [{ text: "Hesabı herkese açık yap ve OAuth bağlantısını yenile", estimatedGain: 10 }],
      source: input.sourceLabel,
      updatedAt,
      signals: [],
    })),
    tags: [],
    source: input.sourceLabel,
    updatedAt,
  };
}

/**
 * Veritabanındaki gerçek verilerden (SocialAccount, Snapshot, TikTokVideo,
 * Campaign teslim & metrikleri) Influencer'ın birleşik Nordvow Skor Raporunu üretir.
 */
export async function computeInfluencerNordvowScore(
  influencerId: string,
  options?: {
    brandCategory?: string | null;
    brandBudgetKurus?: number | null;
  },
): Promise<InfluencerNordvowScoreReport | null> {
  const [inf, statsMap, rateCount, portfolioCount] = await Promise.all([
    prisma.influencer.findUnique({
      where: { id: influencerId },
      select: {
        id: true,
        category: true,
        socialAccounts: {
          orderBy: { followers: "desc" },
          include: {
            snapshots: { orderBy: { takenAt: "asc" }, take: 90 },
          },
        },
        tiktokAccounts: {
          where: { status: "active" },
          include: {
            videos: { orderBy: { createTime: "desc" }, take: 30 },
          },
        },
      },
    }),
    computeInfluencerStats([influencerId]),
    prisma.rateCard.count({ where: { influencerId, active: true } }),
    prisma.portfolioItem.count({ where: { influencerId } }),
  ]);

  if (!inf) return null;

  const stats = statsMap.get(influencerId);
  const campaignHistoryScore =
    stats && stats.publishedCount > 0
      ? Math.round(clamp((stats.onTimeRate ?? 0.8) * 100, 30, 100))
      : null;

  const catKey = inf.category ?? "yasam_tarzi";
  const catLabel = inf.category || "Yaşam Tarzı";

  const platformResults: PlatformScoreResult[] = [];
  for (const acc of inf.socialAccounts) {
    const hasOAuth = acc.syncSource === "tiktok_oauth" || acc.syncSource === "instagram_oauth" || !!acc.tokenRef;
    const posts: MediaSample[] = [];

    if (acc.platform === "TIKTOK") {
      const ttAcc = inf.tiktokAccounts[0];
      if (ttAcc) {
        for (const v of ttAcc.videos) {
          posts.push({
            id: v.id,
            mediaType: "VIDEO",
            publishedAt: v.createTime,
            likes: v.likeCount,
            comments: v.commentCount,
            shares: v.shareCount,
            views: v.viewCount,
          });
        }
      }
    }

    // Eğer gönderi detayı henüz yoksa, senkronize edilmiş ortalama metriklerden tekil özet örnek oluşturma;
    // eksik olarak işaretlenir ve mevcut snapshot'lar kullanılır.
    const snapshots = acc.snapshots.map((s) => ({
      takenAt: s.takenAt,
      followers: s.followers,
      engagementRate: Number(s.engagementRate),
    }));

    const benchmark = await loadPeerBenchmarkGroup({
      platform: acc.platform,
      followers: acc.followers,
      categoryKey: catKey,
      categoryLabel: catLabel,
    });

    platformResults.push(
      computePlatformScore(
        {
          platform: acc.platform,
          handle: acc.handle,
          categoryKey: catKey,
          categoryLabel: catLabel,
          followers: acc.followers,
          hasOAuth,
          syncError: acc.syncError,
          lastSyncedAt: acc.lastSyncedAt,
          sourceLabel:
            acc.syncSource === "tiktok_oauth"
              ? "TikTok OAuth API"
              : acc.syncSource === "youtube_data"
                ? "YouTube Data API"
                : acc.syncSource === "instagram_business_discovery"
                  ? "Meta Graph API"
                  : "Açık Profil Verisi",
          posts,
          snapshots,
          campaignHistoryScore,
        },
        benchmark,
      ),
    );
  }

  // Çoklu platform takipçi ağırlıklı birleştirme
  const totalFollowers = platformResults.reduce((s, p) => s + p.followers, 0);
  const scoredPlatforms = platformResults.filter((p) => p.overallScore != null && p.followers > 0);
  const overallScore =
    scoredPlatforms.length > 0
      ? Math.round(
          scoredPlatforms.reduce((s, p) => s + (p.overallScore ?? 0) * p.followers, 0) /
            scoredPlatforms.reduce((s, p) => s + p.followers, 0),
        )
      : null;

  const gradeInfo = overallScore != null ? gradeForScore(overallScore) : { grade: null, label: "Yetersiz veri" };
  const primary = platformResults[0];
  const anyOAuth = platformResults.some((p) => p.hasOAuth);
  const confidence: ConfidenceLevel = primary?.confidence ?? "DUSUK";

  const totalEstimatedReach = platformResults.reduce(
    (s, p) => s + (p.rawMetrics.medianViews ?? Math.round(p.followers * 0.2)),
    0,
  );

  // Profil tamamlanma & oyunlaştırma görevleri
  const tasks: InfluencerTaskItem[] = [
    {
      id: "oauth",
      goal: "Hesabını bağla",
      task: "Instagram / TikTok / YouTube OAuth bağlantısını yap",
      affectedScore: "Güven seviyesi → Yüksek & Doğrulanmış rozeti",
      completed: anyOAuth,
      estimatedGainLabel: "+%25 güven",
    },
    {
      id: "freq",
      goal: "Düzenli paylaş",
      task: "Haftada en az 3 içerik paylaş",
      affectedScore: "İçerik İstikrarı",
      completed: (primary?.rawMetrics.weeklyFrequency.value ?? 0) >= 3,
      estimatedGainLabel: "+6 puan",
    },
    {
      id: "reels",
      goal: "Reels / kısa video",
      task: "Haftada 2+ Reels veya TikTok yayınla",
      affectedScore: "Erişim Gücü",
      completed: (primary?.rawMetrics.vrPct.value ?? 0) >= 25,
      estimatedGainLabel: "+6 puan",
    },
    {
      id: "profile",
      goal: "Profilini tamamla",
      task: "Fiyat kartı ve öne çıkan portfolyo işlerini ekle",
      affectedScore: "Marka görünürlüğü",
      completed: rateCount > 0 && portfolioCount > 0,
      estimatedGainLabel: "+%15 görünürlük",
    },
  ];

  const completedTasks = tasks.filter((t) => t.completed).length;
  const completionPct = Math.round((completedTasks / tasks.length) * 100);
  const nextTask = tasks.find((t) => !t.completed);

  // Markaya özel uyum skoru (opsiyonel)
  let brandMatch: BrandMatchResult | undefined;
  if (options?.brandCategory || options?.brandBudgetKurus) {
    const gScore = overallScore ?? 50;
    const audScore = primary?.rawMetrics.audienceMatchPct.value ?? 65;
    const catMatch = options.brandCategory && options.brandCategory === catKey ? 95 : 55;
    const budgetMatch = 80;
    const score = Math.round(
      gScore * BRAND_MATCH_WEIGHTS.generalScore +
        audScore * BRAND_MATCH_WEIGHTS.audienceMatch +
        catMatch * BRAND_MATCH_WEIGHTS.categoryMatch +
        budgetMatch * BRAND_MATCH_WEIGHTS.budgetMatch,
    );
    brandMatch = {
      score,
      generalComponent: gScore,
      audienceComponent: Math.round(audScore),
      categoryComponent: catMatch,
      budgetComponent: budgetMatch,
    };
  }

  return {
    scoreVersion: SCORE_VERSION,
    influencerId,
    overallScore,
    grade: gradeInfo.grade,
    gradeLabel: gradeInfo.label,
    isEstimated: confidence === "DUSUK",
    confidence,
    totalFollowers,
    totalEstimatedReach,
    platforms: platformResults,
    dimensions: primary?.dimensions ?? [],
    tags: Array.from(new Set(platformResults.flatMap((p) => p.tags))),
    tasks,
    profileCompletion: {
      percent: completionPct,
      nextHint: nextTask ? `${nextTask.goal}: ${nextTask.estimatedGainLabel}` : "Tüm profil adımları tamamlandı!",
    },
    brandMatch,
    computedAt: new Date().toISOString(),
  };
}

/** Kampanya ROI & EMV metriklerini hesaplar (Bölüm 10). */
export function computeCampaignRoiMetrics(input: {
  costTry: number;
  views: number;
  interactions: number;
  categoryKey?: string;
  predictedViews?: number;
}) {
  const cpmTry = input.views > 0 ? Number(((input.costTry / input.views) * 1000).toFixed(2)) : null;
  const cpeTry = input.interactions > 0 ? Number((input.costTry / input.interactions).toFixed(2)) : null;
  const benchmarkCpm = CATEGORY_CPM_BENCHMARK_TRY[input.categoryKey ?? "default"] ?? CATEGORY_CPM_BENCHMARK_TRY.default!;
  const emvTry = Math.round((input.views / 1000) * benchmarkCpm);
  const performanceIndex =
    input.predictedViews && input.predictedViews > 0
      ? Number((input.views / input.predictedViews).toFixed(2))
      : null;

  return { cpmTry, cpeTry, emvTry, performanceIndex };
}
