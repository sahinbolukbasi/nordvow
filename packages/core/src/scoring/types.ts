import type { Platform } from "../generated/prisma/enums";
import type { FollowerBandKey } from "./scoring.config";

export type MetricStatus = "tamam" | "eksik" | "baglanti_gerekli" | "gizli" | "hata";
export type ConfidenceLevel = "YUKSEK" | "ORTA" | "DUSUK";
export type ScoreGrade = "A+" | "A" | "B" | "C" | "D";
export type DimensionKey =
  | "audienceCredibility"
  | "engagementQuality"
  | "reachPower"
  | "contentConsistency"
  | "commercialPerformance"
  | "growthMomentum";

export type MediaSample = {
  id: string;
  mediaType: "POST" | "CAROUSEL" | "REELS" | "STORY" | "VIDEO" | "SHORTS";
  publishedAt: Date;
  likes: number | null;
  likesHidden?: boolean;
  comments: number | null;
  shares?: number | null;
  saves?: number | null;
  views?: number | null;
  reach?: number | null;
  isSponsored?: boolean;
  meaningfulCommentRatio?: number | null; // 0..1
  botCommentRatio?: number | null; // 0..1
  purchaseIntentRatio?: number | null; // 0..1
};

export type SnapshotSample = {
  takenAt: Date;
  followers: number;
  engagementRate: number; // 0..1
};

export type PlatformMeasurementInput = {
  platform: Platform;
  handle: string;
  categoryKey: string;
  categoryLabel: string;
  followers: number;
  hasOAuth: boolean;
  isPrivate?: boolean;
  syncError?: string | null;
  lastSyncedAt?: Date | null;
  sourceLabel: string;
  posts: MediaSample[];
  snapshots: SnapshotSample[];
  /** OAuth demografi tutarlılığı (0..100). */
  demographicConsistencyScore?: number | null;
  /** OAuth kitle uyumu (0..100). */
  audienceMatchPct?: number | null;
  /** Platform kampanya geçmişi puanı (0..100). */
  campaignHistoryScore?: number | null;
};

export type RawMetricsSummary = {
  erPct: { value: number | null; status: MetricStatus };
  vrPct: { value: number | null; status: MetricStatus };
  ervPct: { value: number | null; status: MetricStatus };
  commentLikeRatio: { value: number | null; status: MetricStatus };
  saveShareRatePct: { value: number | null; status: MetricStatus };
  weeklyFrequency: { value: number | null; status: MetricStatus };
  consistencyScore: { value: number | null; status: MetricStatus };
  growth30dPct: { value: number | null; status: MetricStatus };
  sponsoredOrganicRatio: { value: number | null; status: MetricStatus };
  audienceMatchPct: { value: number | null; status: MetricStatus };
  medianViews: number | null;
  viralCount: number;
  postsEvaluated: number;
  snapshotDays: number;
};

export type SignalDetail = {
  key: string;
  label: string;
  value: number | null;
  weight: number;
  status: MetricStatus;
};

export type ImprovementHint = {
  text: string;
  estimatedGain: number;
};

export type DimensionScoreResult = {
  key: DimensionKey;
  title: string;
  score: number | null;
  status: MetricStatus;
  confidence: ConfidenceLevel;
  percentile: number | null;
  benchmarkLabel: string;
  why: string[];
  howToImprove: ImprovementHint[];
  source: string;
  updatedAt: string;
  signals: SignalDetail[];
};

export type PlatformScoreResult = {
  platform: Platform;
  handle: string;
  band: FollowerBandKey;
  bandLabel: string;
  followers: number;
  hasOAuth: boolean;
  overallScore: number | null;
  grade: ScoreGrade | null;
  isEstimated: boolean;
  confidence: ConfidenceLevel;
  rawMetrics: RawMetricsSummary;
  dimensions: DimensionScoreResult[];
  tags: string[];
  source: string;
  updatedAt: string;
};

export type InfluencerTaskItem = {
  id: string;
  goal: string;
  task: string;
  affectedScore: string;
  completed: boolean;
  estimatedGainLabel: string;
};

export type BrandMatchResult = {
  score: number;
  generalComponent: number;
  audienceComponent: number;
  categoryComponent: number;
  budgetComponent: number;
};

export type InfluencerNordvowScoreReport = {
  scoreVersion: string;
  influencerId: string;
  overallScore: number | null;
  grade: ScoreGrade | null;
  gradeLabel: string;
  isEstimated: boolean;
  confidence: ConfidenceLevel;
  totalFollowers: number;
  totalEstimatedReach: number;
  platforms: PlatformScoreResult[];
  dimensions: DimensionScoreResult[];
  tags: string[];
  tasks: InfluencerTaskItem[];
  profileCompletion: {
    percent: number;
    nextHint: string;
  };
  brandMatch?: BrandMatchResult;
  computedAt: string;
};

export type PeerBenchmarkGroup = {
  label: string;
  sampleSize: number;
  usedFallbackBandOnly: boolean;
  erValues: number[];
  vrValues: number[];
  ervValues: number[];
  saveShareValues: number[];
  weeklyFreqValues: number[];
  consistencyValues: number[];
  growth30dValues: number[];
  medianViewsValues: number[];
  followerValues: number[];
  medianEr: number;
  medianVr: number;
};

