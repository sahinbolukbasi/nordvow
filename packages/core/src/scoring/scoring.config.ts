export const SCORE_VERSION = "2026.11.1";

export type FollowerBandKey = "NANO" | "MIKRO" | "ORTA" | "MAKRO" | "MEGA";

export const FOLLOWER_BANDS: {
  key: FollowerBandKey;
  label: string;
  min: number;
  max: number | null;
}[] = [
  { key: "NANO", label: "Nano (1B – 10B)", min: 1_000, max: 10_000 },
  { key: "MIKRO", label: "Mikro (10B – 50B)", min: 10_000, max: 50_000 },
  { key: "ORTA", label: "Orta (50B – 250B)", min: 50_000, max: 250_000 },
  { key: "MAKRO", label: "Makro (250B – 1M)", min: 250_000, max: 1_000_000 },
  { key: "MEGA", label: "Mega (1M+)", min: 1_000_000, max: null },
];

export const BENCHMARK_MIN_ACCOUNTS = 30;

export const WINDOW_LIMITS = {
  maxPosts: 30,
  maxDays: 90,
  viralMultiplier: 5,
} as const;

export const CONFIDENCE_THRESHOLDS = {
  highMinPosts: 30,
  highMinSnapshotDays: 30,
  mediumMinPosts: 15,
  lowMaxSnapshotDays: 7,
} as const;

export const MISSING_SIGNAL_MAX_WEIGHT_RATIO = 0.5;

export const DIMENSION_WEIGHTS = {
  audienceCredibility: 0.25,
  engagementQuality: 0.25,
  reachPower: 0.15,
  contentConsistency: 0.1,
  commercialPerformance: 0.15,
  growthMomentum: 0.1,
} as const;

export const SIGNAL_WEIGHTS = {
  audienceCredibility: {
    growthStability: 0.25,
    erReasonable: 0.2,
    commentLikeRatio: 0.15,
    lowBotComments: 0.2,
    viewFollowerRatio: 0.1,
    demographicConsistency: 0.1,
  },
  engagementQuality: {
    erPercentile: 0.4,
    ervPercentile: 0.25,
    saveShareRate: 0.2,
    meaningfulComments: 0.15,
  },
  reachPower: {
    viewRatePercentile: 0.5,
    medianViews: 0.3,
    followers: 0.2,
  },
  contentConsistency: {
    postingFrequency: 0.4,
    consistency: 0.4,
    formatDiversity: 0.2,
  },
  commercialPerformance: {
    sponsoredRatio: 0.4,
    purchaseIntentComments: 0.3,
    campaignHistory: 0.3,
  },
  growthMomentum: {
    followerGrowth30d: 0.5,
    viewsTrend: 0.3,
    erTrend: 0.2,
  },
} as const;

export const BRAND_MATCH_WEIGHTS = {
  generalScore: 0.5,
  audienceMatch: 0.25,
  categoryMatch: 0.15,
  budgetMatch: 0.1,
} as const;

export const GRADE_THRESHOLDS = [
  { grade: "A+" as const, min: 85, label: "Öncelikli, güvenle çalışılabilir" },
  { grade: "A" as const, min: 70, label: "Güçlü aday" },
  { grade: "B" as const, min: 55, label: "Belirli kampanyalar için uygun" },
  { grade: "C" as const, min: 40, label: "Dikkatli değerlendirilmeli" },
  { grade: "D" as const, min: 0, label: "Riskli / yetersiz veri" },
];

export const COLOR_THRESHOLDS = {
  greenMin: 70,
  yellowMin: 40,
} as const;

export const AUTO_TAG_RULES = {
  highEngagementMinScore: 72,
  strongReelsMinVrPct: 25,
  fastGrowingMinGrowth30dPct: 5,
  loyalAudienceMinSaveSharePct: 1.5,
  strongSponsoredMinScore: 70,
  botRiskMaxCredibilityScore: 45,
  lowFrequencyMaxWeeklyPosts: 1.0,
  fallingErThresholdPct: -15,
} as const;

/** Sektör CPM kıyas değerleri (TRY, EMV hesabı için). */
export const CATEGORY_CPM_BENCHMARK_TRY: Record<string, number> = {
  guzellik: 140,
  moda: 130,
  teknoloji: 180,
  yemek: 110,
  anne_cocuk: 150,
  spor: 125,
  oyun: 120,
  seyahat: 145,
  yasam_tarzi: 120,
  eglence: 95,
  default: 125,
};
