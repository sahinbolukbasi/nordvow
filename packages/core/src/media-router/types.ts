/**
 * Nordvow Creative AI - Media Router & Provider Abstraction Types
 * Strict adherence to architectural invariants:
 * - Abstract Aliases only (Client never references raw provider/model keys)
 * - Standard interfaces: generateImage, editImage, generateVideo, editVideo, tts, lipSync, avatar, upscale, removeBackground
 * - Cost transparency, margin safety, role-gating
 */

export type ModelAlias =
  | "draft-image"
  | "mid-image"
  | "pro-image"
  | "vector-image"
  | "typography-image"
  | "draft-video"
  | "mid-video"
  | "cinematic-video"
  | "lip-sync"
  | "avatar-talking"
  | "upscale-image"
  | "remove-bg-image"
  | "remove-bg-video"
  | "fast-tts"
  | "ultra-tts"
  | "music-gen";

export type MediaCapability =
  | "IMAGE_GENERATION"
  | "IMAGE_EDIT"
  | "VIDEO_GENERATION"
  | "VIDEO_EDIT"
  | "TTS"
  | "LIP_SYNC"
  | "AVATAR"
  | "UPSCALE"
  | "REMOVE_BACKGROUND";

export type UserRole = "ADMIN" | "AGENCY" | "BRAND" | "INFLUENCER";

export interface GenerationParams {
  width?: number;
  height?: number;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:5" | "21:9";
  seed?: number;
  steps?: number;
  guidanceScale?: number;
  durationSeconds?: number;
  fps?: number;
  voiceId?: string;
  speed?: number;
  inputImageUrl?: string;
  inputAudioUrl?: string;
  referenceImages?: string[];
  stylePreset?: string;
  brandKitId?: string;
  negativePrompt?: string;
  webhookUrl?: string;
}

export interface MediaJobRequest {
  organizationId?: string;
  userId: string;
  userRole: UserRole;
  alias: ModelAlias;
  prompt: string;
  negativePrompt?: string;
  params?: GenerationParams;
  clientIp?: string;
  userAgent?: string;
  isDraftFirstOverride?: boolean;
}

export interface MediaJobResult {
  jobId: string;
  status: "QUEUED" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  alias: ModelAlias;
  providerUsed?: string;
  modelUsed?: string;
  outputUrls: string[]; // Only Nordvow CloudFront CDN URLs
  creditsCharged: number;
  costBreakdown: {
    officialCostUsd: number;
    loadedCostUsd: number;
    retailPriceUsd: number;
    marginPercentage: number;
  };
  inferenceMs?: number;
  c2paManifestId?: string;
  cached: boolean;
  error?: string;
}

export interface ProviderHealth {
  providerId: string;
  name: string;
  isEnabled: boolean;
  healthScore: number; // 0 - 100
  errorRate: number; // 0.0 - 1.0
  avgLatencyMs: number;
  lastCheckedAt: Date;
}

