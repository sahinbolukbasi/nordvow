import { MediaCapability, Role } from "../db";
import { ModelAlias } from "./types";

export interface MediaProviderSeed {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  healthScore: number;
  errorRate: number;
  avgLatencyMs: number;
  rateLimitPerMin?: number;
}

export interface MediaModelSeed {
  alias: ModelAlias;
  capability: MediaCapability;
  displayName: string;
  primaryProviderId: string;
  primaryModelId: string;
  fallbackProviderId?: string;
  fallbackModelId?: string;
  officialCostUsd: number;
  loadedMultiplier: number;
  retailMultiplier: number;
  creditPrice: number;
  unitType: string;
  minRole: Role;
  isDraftFirstRequired: boolean;
  isBatchSupported: boolean;
}

export const MEDIA_PROVIDER_SEEDS: MediaProviderSeed[] = [
  { id: "fal", name: "fal.ai Aggregator", description: "Yüksek hızlı serverless AI aggregator (FLUX, Bria, PixVerse, SeedVR2)", isEnabled: true, healthScore: 99.5, errorRate: 0.002, avgLatencyMs: 850, rateLimitPerMin: 1200 },
  { id: "google", name: "Google Vertex / Gemini Direct API", description: "Doğrudan Google API (Nano Banana 2.1/Pro, Omni 1.2, Lyria)", isEnabled: true, healthScore: 99.9, errorRate: 0.001, avgLatencyMs: 1200, rateLimitPerMin: 2000 },
  { id: "byteplus", name: "BytePlus ModelArk Direct API", description: "BytePlus Resmi API (Seedream 5.0 Flash/Lite, Seedance 2.0 Fast)", isEnabled: true, healthScore: 98.9, errorRate: 0.005, avgLatencyMs: 1400, rateLimitPerMin: 800 },
  { id: "minimax", name: "MiniMax Direct API", description: "MiniMax Resmi API (H3-Highspeed, H3-Lite, Speech 2.8)", isEnabled: true, healthScore: 98.7, errorRate: 0.004, avgLatencyMs: 1600, rateLimitPerMin: 600 },
  { id: "elevenlabs", name: "ElevenLabs Direct API", description: "ElevenLabs Resmi API (v4, v4 Turbo, Flash, Music)", isEnabled: true, healthScore: 99.8, errorRate: 0.001, avgLatencyMs: 450, rateLimitPerMin: 1500 },
  { id: "kling", name: "Kling AI Direct API", description: "Kling Resmi API (Kling 4.0/3.0 Sinematik Video, Lip-Sync)", isEnabled: true, healthScore: 98.0, errorRate: 0.008, avgLatencyMs: 3200, rateLimitPerMin: 300 },
  { id: "heygen", name: "HeyGen Direct API", description: "HeyGen Resmi API (Avatar III / IV / V Konuşan Dijital İkiz)", isEnabled: true, healthScore: 98.5, errorRate: 0.006, avgLatencyMs: 4500, rateLimitPerMin: 200 },
  { id: "recraft", name: "Recraft V4.1 Direct API", description: "Recraft Resmi API (Vektör ve Marka Tasarım Stilleri)", isEnabled: true, healthScore: 99.0, errorRate: 0.003, avgLatencyMs: 1100, rateLimitPerMin: 500 },
  { id: "ideogram", name: "Ideogram Direct API", description: "Ideogram Resmi API (Yüksek Başarımlı Tipografi ve Afiş)", isEnabled: true, healthScore: 99.2, errorRate: 0.002, avgLatencyMs: 1300, rateLimitPerMin: 600 },
  { id: "replicate", name: "Replicate Fallback Aggregator", description: "429 / 5xx durumlarında otomatik ikincil yedek sağlayıcı", isEnabled: true, healthScore: 99.1, errorRate: 0.003, avgLatencyMs: 1500, rateLimitPerMin: 1000 },
];

export const MEDIA_MODEL_SEEDS: MediaModelSeed[] = [
  // ─── GÖRÜNTÜ ÜRETİMİ & DÜZENLEME ───
  {
    alias: "draft-image",
    capability: MediaCapability.IMAGE_GENERATION,
    displayName: "Taslak Görsel (FLUX.1 Schnell)",
    primaryProviderId: "fal",
    primaryModelId: "fal-ai/flux/schnell",
    fallbackProviderId: "byteplus",
    fallbackModelId: "seedream-5-flash",
    officialCostUsd: 0.003, // ~$0.003
    loadedMultiplier: 1.15,
    retailMultiplier: 4.35,
    creditPrice: 1.5, // 1.5 Kredi ($0.015)
    unitType: "image",
    minRole: Role.INFLUENCER,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },
  {
    alias: "mid-image",
    capability: MediaCapability.IMAGE_GENERATION,
    displayName: "Orta Kalite / Marka Görseli (Nano Banana 2.1)",
    primaryProviderId: "google", // Doğrudan Google API maliyeti yarıya düşürür (~$0.0336)
    primaryModelId: "google/nano-banana-2.1",
    fallbackProviderId: "byteplus",
    fallbackModelId: "seedream-5-lite",
    officialCostUsd: 0.0336,
    loadedMultiplier: 1.15,
    retailMultiplier: 3.10,
    creditPrice: 12.0, // 12 Kredi ($0.12)
    unitType: "image",
    minRole: Role.BRAND,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },
  {
    alias: "pro-image",
    capability: MediaCapability.IMAGE_GENERATION,
    displayName: "Ultra Kalite & Detay (Nano Banana Pro)",
    primaryProviderId: "google",
    primaryModelId: "google/nano-banana-pro",
    fallbackProviderId: "fal",
    fallbackModelId: "fal-ai/flux-pro/v1.1",
    officialCostUsd: 0.08,
    loadedMultiplier: 1.15,
    retailMultiplier: 3.0,
    creditPrice: 28.0,
    unitType: "image",
    minRole: Role.AGENCY,
    isDraftFirstRequired: true,
    isBatchSupported: true,
  },
  {
    alias: "vector-image",
    capability: MediaCapability.IMAGE_GENERATION,
    displayName: "Vektör & Marka Stili (Recraft V4.1 Resmi API)",
    primaryProviderId: "recraft",
    primaryModelId: "recraft-v4.1",
    fallbackProviderId: "fal",
    fallbackModelId: "fal-ai/recraft/v3/text-to-image",
    officialCostUsd: 0.04,
    loadedMultiplier: 1.15,
    retailMultiplier: 3.26,
    creditPrice: 15.0,
    unitType: "image",
    minRole: Role.BRAND,
    isDraftFirstRequired: false,
    isBatchSupported: false,
  },
  {
    alias: "typography-image",
    capability: MediaCapability.IMAGE_GENERATION,
    displayName: "Tipografi & Afiş Tasarımı (Ideogram Direct API)",
    primaryProviderId: "ideogram",
    primaryModelId: "ideogram-v3",
    fallbackProviderId: "fal",
    fallbackModelId: "fal-ai/ideogram/v3",
    officialCostUsd: 0.06,
    loadedMultiplier: 1.15,
    retailMultiplier: 3.18,
    creditPrice: 22.0,
    unitType: "image",
    minRole: Role.BRAND,
    isDraftFirstRequired: false,
    isBatchSupported: false,
  },
  {
    alias: "remove-bg-image",
    capability: MediaCapability.REMOVE_BACKGROUND,
    displayName: "Görsel Arka Plan Kaldırma (Bria RMBG 2.0)",
    primaryProviderId: "fal",
    primaryModelId: "fal-ai/bria/rmbg-2.0",
    fallbackProviderId: "replicate",
    fallbackModelId: "bria/rmbg",
    officialCostUsd: 0.015,
    loadedMultiplier: 1.15,
    retailMultiplier: 2.9,
    creditPrice: 5.0,
    unitType: "image",
    minRole: Role.INFLUENCER,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },
  {
    alias: "upscale-image",
    capability: MediaCapability.UPSCALE,
    displayName: "Görsel Çözünürlük Yükseltme (SeedVR2 4K)",
    primaryProviderId: "fal",
    primaryModelId: "fal-ai/seedvr2/upscaler",
    fallbackProviderId: "replicate",
    fallbackModelId: "seedvr/upscaler",
    officialCostUsd: 0.02,
    loadedMultiplier: 1.15,
    retailMultiplier: 3.04,
    creditPrice: 7.0,
    unitType: "image",
    minRole: Role.BRAND,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },

  // ─── VİDEO ÜRETİMİ & DÜZENLEME ───
  {
    alias: "draft-video",
    capability: MediaCapability.VIDEO_GENERATION,
    displayName: "Taslak Video (PixVerse V6)",
    primaryProviderId: "fal",
    primaryModelId: "fal-ai/pixverse/v6",
    fallbackProviderId: "replicate",
    fallbackModelId: "pixverse-v6",
    officialCostUsd: 0.005, // ~$0.005 / sn -> 5 sn = $0.025
    loadedMultiplier: 1.30,
    retailMultiplier: 3.07,
    creditPrice: 10.0, // 5 sn için 10 Kredi ($0.10)
    unitType: "second",
    minRole: Role.INFLUENCER,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },
  {
    alias: "mid-video",
    capability: MediaCapability.VIDEO_GENERATION,
    displayName: "UGC & Reklam Videosu (MiniMax H3-Highspeed)",
    primaryProviderId: "minimax", // ~$0.06 / sn -> 5 sn = $0.30
    primaryModelId: "minimax-h3-highspeed",
    fallbackProviderId: "byteplus",
    fallbackModelId: "seedance-2-fast",
    officialCostUsd: 0.06,
    loadedMultiplier: 1.30,
    retailMultiplier: 3.07,
    creditPrice: 120.0, // 5 sn için 120 Kredi ($1.20)
    unitType: "second",
    minRole: Role.BRAND,
    isDraftFirstRequired: true,
    isBatchSupported: true,
  },
  {
    alias: "cinematic-video",
    capability: MediaCapability.VIDEO_GENERATION,
    displayName: "Sinematik & Yüksek Hareket (Kling 4.0 Direct API)",
    primaryProviderId: "kling",
    primaryModelId: "kling-v4.0-pro",
    fallbackProviderId: "kling",
    fallbackModelId: "kling-v3.0",
    officialCostUsd: 0.157, // ~$0.157 / sn -> 5 sn = $0.785
    loadedMultiplier: 1.30,
    retailMultiplier: 3.23,
    creditPrice: 330.0, // 5 sn için 330 Kredi ($3.30)
    unitType: "second",
    minRole: Role.AGENCY,
    isDraftFirstRequired: true,
    isBatchSupported: false,
  },
  {
    alias: "lip-sync",
    capability: MediaCapability.LIP_SYNC,
    displayName: "Konuşma Ağız Senkronizasyonu (Kling Lip-Sync)",
    primaryProviderId: "kling",
    primaryModelId: "kling-lip-sync",
    fallbackProviderId: "fal",
    fallbackModelId: "fal-ai/latentsync",
    officialCostUsd: 0.04,
    loadedMultiplier: 1.30,
    retailMultiplier: 3.26,
    creditPrice: 17.0, // saniye başı
    unitType: "second",
    minRole: Role.BRAND,
    isDraftFirstRequired: false,
    isBatchSupported: false,
  },
  {
    alias: "avatar-talking",
    capability: MediaCapability.AVATAR,
    displayName: "Fotogerçekçi Dijital İkiz (HeyGen Avatar V Direct API)",
    primaryProviderId: "heygen",
    primaryModelId: "heygen-avatar-v",
    fallbackProviderId: "heygen",
    fallbackModelId: "heygen-avatar-iv",
    officialCostUsd: 0.10,
    loadedMultiplier: 1.30,
    retailMultiplier: 3.07,
    creditPrice: 40.0, // saniye başı
    unitType: "second",
    minRole: Role.AGENCY,
    isDraftFirstRequired: true,
    isBatchSupported: false,
  },
  {
    alias: "remove-bg-video",
    capability: MediaCapability.REMOVE_BACKGROUND,
    displayName: "Video Arka Plan Silme (VEED Removal)",
    primaryProviderId: "fal",
    primaryModelId: "fal-ai/veed/video-background-removal",
    fallbackProviderId: "replicate",
    fallbackModelId: "veed/background-removal",
    officialCostUsd: 0.05,
    loadedMultiplier: 1.30,
    retailMultiplier: 3.07,
    creditPrice: 20.0, // saniye başı
    unitType: "second",
    minRole: Role.BRAND,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },

  // ─── SES, MÜZİK & DUBLAJ ───
  {
    alias: "fast-tts",
    capability: MediaCapability.TTS,
    displayName: "Ultra Hızlı Seslendirme (MiniMax Speech 2.8)",
    primaryProviderId: "minimax",
    primaryModelId: "speech-2.8",
    fallbackProviderId: "elevenlabs",
    fallbackModelId: "eleven_flash_v2_5",
    officialCostUsd: 0.015,
    loadedMultiplier: 1.15,
    retailMultiplier: 3.47,
    creditPrice: 6.0, // 1000 karakter
    unitType: "1000_chars",
    minRole: Role.INFLUENCER,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },
  {
    alias: "ultra-tts",
    capability: MediaCapability.TTS,
    displayName: "Doğal Seslendirme & Klon (ElevenLabs v4 Turbo)",
    primaryProviderId: "elevenlabs",
    primaryModelId: "eleven_turbo_v2_5",
    fallbackProviderId: "elevenlabs",
    fallbackModelId: "eleven_multilingual_v2",
    officialCostUsd: 0.04, // ~$0.04 / 1000 karakter
    loadedMultiplier: 1.15,
    retailMultiplier: 3.26,
    creditPrice: 15.0, // 1000 karakter için 15 Kredi ($0.15)
    unitType: "1000_chars",
    minRole: Role.BRAND,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },
  {
    alias: "music-gen",
    capability: MediaCapability.TTS,
    displayName: "Arka Plan Müziği & Jingle (ElevenLabs Music & Lyria)",
    primaryProviderId: "elevenlabs",
    primaryModelId: "eleven_music_v1",
    fallbackProviderId: "google",
    fallbackModelId: "google/lyria-3.5",
    officialCostUsd: 0.15, // ~$0.15 / dk
    loadedMultiplier: 1.15,
    retailMultiplier: 3.18,
    creditPrice: 55.0, // dakika başı 55 Kredi ($0.55)
    unitType: "minute",
    minRole: Role.BRAND,
    isDraftFirstRequired: false,
    isBatchSupported: true,
  },
];
