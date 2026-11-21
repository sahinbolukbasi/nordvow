"use server";
import { createHash } from "node:crypto";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { submitEditPipeline, type EditAction } from "@infulancer/core/creative/edit";
import { humanizeCreativeError } from "@infulancer/core/creative/errors";
import { submitGeneration } from "@infulancer/core/creative/generate";
import type { Aspect } from "@infulancer/core/creative/adapters";
import { planVideoEditFromBrief } from "@infulancer/core/creative/video-brief";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  clearFalKeyCache,
  CreativeRejectedError,
  handleFalWebhook,
  mergeVoiceoverOntoVideoBytes,
  renderStudioVideoMp4,
  verifyFalKeyConnection,
} from "@infulancer/core/creative/fal";
import {
  chargeHold,
  ensureStarterCredits,
  getAvailableCredits,
  InsufficientCreditsError,
  placeHold,
  refundJobCredits,
  releaseHold,
} from "@infulancer/core/creative/credits";
import { chargeIn, creativePricing } from "@infulancer/core/creative/pricing";
import { tenantCurrency } from "@infulancer/core/creative/tenant";
import { embedC2pa } from "@infulancer/core/creative/c2pa";
import { objectStore } from "@infulancer/core/channels/raw-store";
import { ModelUnavailableError, resolveModel, seedModelRegistry } from "@infulancer/core/creative/registry";
import {
  endpointToModelKey,
  FAL_ORCHESTRATOR_CATALOG,
  getComboPresetForTier,
  routeCostAwareOperation,
  runStoryChatbotConverse,
  type CostAwareOperationType,
  type StoryChatbotPayload,
} from "@infulancer/core/creative/orchestrator";
import {
  analyzeAssetWithVision,
  bindAssetsToSession,
  CATEGORY_LABELS_TR,
  loadCreativeSessionState,
  resetCreativeSessionState,
  saveCreativeSessionState,
  updateSessionFromUserIntent,
  type BoundAsset,
} from "@infulancer/core/creative/vision-session";
import { renderProgrammaticTimelineVideo } from "@infulancer/core/creative/sfx-timeline";
import { converseChat, parseJsonObject } from "@infulancer/core/llm/bedrock";
import { envStr } from "@infulancer/core/env";
import { enqueueVideoEdit } from "@infulancer/core/creative/video-edit";
import { startAiVideoEditJob, startPhotoToVideoJob } from "@infulancer/core/creative/studio/jobQueue";
import { routeCreativeSkill, SKILL_BY_ID } from "@infulancer/core/creative/skills/registry";
import { downloadToFile, getOwnedUpload, importGeneratedAsset } from "@infulancer/core/creative/uploads";
import { redirect } from "next/navigation";
import { deleteObject } from "@infulancer/core/storage/s3";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { attempt, revalidateAll, str } from "@/lib/action-utils";
import { requireActor, requireAdmin } from "@/lib/auth-guard";
import { creativeTenantFor, ownTenantOrNull } from "@/lib/creative-tenant";

export async function imageEditAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  return attempt(async () => {
    const tenantId = await creativeTenantFor(actor);
    const actions = (fd.getAll("actions").length ? fd.getAll("actions") : [fd.get("action")]).map(String).filter(Boolean) as EditAction[];
    const prompt = str(fd, "prompt") || null;
    const videoPrompt = str(fd, "videoPrompt") || prompt;
    const seconds = Number(str(fd, "seconds") || "5");
    const portrait = str(fd, "portrait") === "on";
    let jobId = "";
    try {
      const job = await submitEditPipeline({
        tenantId,
        uploadId: str(fd, "uploadId"),
        steps: actions.map((a) => ({ action: a, prompt: a.startsWith("videoya") ? videoPrompt : prompt, seconds, portrait })),
      });
      jobId = job.id;
      if ((process.env.FAL_MODE ?? "mock") === "mock" && job.requestId) {
        const video = job.modelKey.includes("i2v");
        await handleFalWebhook({ request_id: job.requestId, status: "OK", payload: video ? { video: { url: `studio://video/${job.requestId}` } } : { image: { url: `studio://image/${job.requestId}` } } });
      }
      await audit.append({ actor: toAuditActor(actor), action: "CREATIVE_EDIT_SUBMITTED", entityType: "CreativeJob", entityId: job.id, data: { tenantId, actions } });
    } catch (e) {
      if (e instanceof CreativeRejectedError || e instanceof ModelUnavailableError || e instanceof InsufficientCreditsError) throw new DomainError("KURAL_IHLALI", e.message);
      throw e;
    }
    revalidateAll();
    return { ok: true, message: actions.length > 1 ? `${actions.length} adımlı AI düzenleme başladı.` : "AI düzenlemesi başladı.", data: { jobId } };
  });
}

export async function videoBriefAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  return attempt(async () => {
    const tenantId = await creativeTenantFor(actor);
    const brief = str(fd, "brief");
    if (brief.length < 5) throw new DomainError("DOGRULAMA", "Videoya ne yapılsın? En az 5 karakter yazın (ör. ilk 15 saniye, story formatı, canlı renkler).");
    const upload = await getOwnedUpload(tenantId, str(fd, "uploadId"));
    const plan = await planVideoEditFromBrief(brief, upload.durationSec ?? (Number(str(fd, "duration")) || null));
    const job = await enqueueVideoEdit({ tenantId, uploadId: upload.id, ops: plan.ops });
    return { ok: true, message: `Plan: ${plan.summary.join(" · ")}`, data: { jobId: job.id, source: plan.source } };
  });
}

export async function videoEditAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  return attempt(async () => {
    const tenantId = await creativeTenantFor(actor);
    const num = (k: string) => (str(fd, k) === "" ? null : Number(str(fd, k)));
    const job = await enqueueVideoEdit({
      tenantId,
      uploadId: str(fd, "uploadId"),
      ops: { trimStart: num("trimStart") ?? 0, trimEnd: num("trimEnd"), aspect: str(fd, "aspect") || "orijinal", speed: Number(str(fd, "speed") || "1"), mute: str(fd, "mute") === "on", look: str(fd, "look") || "orijinal", fade: str(fd, "fade") === "on" },
    });
    return { ok: true, message: "Video işleniyor…", data: { jobId: job.id } };
  });
}

export async function deleteUploadAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  return attempt(async () => {
    const u = await getOwnedUpload(ownTenantOrNull(actor), str(fd, "id"));
    await prisma.creativeUpload.delete({ where: { id: u.id } });
    await deleteObject(u.s3Key);
    revalidateAll();
    return { ok: true, message: "Dosya silindi." };
  });
}

export async function saveAssetToLibraryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  return attempt(async () => {
    const tenantId = await creativeTenantFor(actor);
    const u = await importGeneratedAsset(tenantId, str(fd, "assetId"), actor.userId);
    revalidateAll();
    return {
      ok: true,
      message: `${u.kind === "video" ? "Video" : "Fotoğraf"} kitaplığa kaydedildi.`,
      data: { uploadId: u.id, kind: u.kind, name: u.name ?? "" },
    };
  });
}

export async function openAssetInStudioAction(fd: FormData): Promise<void> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  let target = "/creative";
  try {
    const u = await importGeneratedAsset(await creativeTenantFor(actor), str(fd, "assetId"), actor.userId);
    target = `/creative?ref=${encodeURIComponent(u.id)}`;
  } catch (e) {
    target = `/creative?hata=${encodeURIComponent(e instanceof DomainError ? e.message : "İçerik açılamadı.")}`;
  }
  redirect(target);
}

/** Admin tarafından fal.ai API anahtarını (FAL_KEY) canlı doğrulayarak kaydetme. */
export async function saveFalKeyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  return attempt(async () => {
    const falKey = str(fd, "falKey").trim().replace(/^Key\s+/i, "");
    if (falKey) {
      const check = await verifyFalKeyConnection(falKey);
      if (!check.ok) {
        return { ok: false, error: check.message };
      }
    }
    await prisma.configValue.upsert({
      where: { key: "creative.falKey" },
      create: { key: "creative.falKey", value: falKey, verified: Boolean(falKey), note: "fal.ai API anahtarı" },
      update: { value: falKey, verified: Boolean(falKey) },
    });
    clearFalKeyCache();
    await audit.append({
      actor: toAuditActor(actor),
      action: "FAL_KEY_UPDATED",
      entityType: "ConfigValue",
      entityId: "creative.falKey",
      data: { configured: Boolean(falKey), verified: Boolean(falKey) },
    });
    revalidateAll();
    return {
      ok: true,
      message: falKey
        ? "fal.ai API anahtarı canlı bağlantı ile doğrulandı, kaydedildi ve aktif edildi."
        : "fal.ai anahtarı temizlendi.",
    };
  });
}

export type SavedPromptItem = {
  id: string;
  title: string;
  prompt: string;
  kind: "image" | "video" | "audio" | "brief";
  createdAt: string;
};

function savedPromptsConfigKey(tenantId: string): string {
  return `creative.savedPrompts.${tenantId}`;
}

export async function listSavedPromptsForTenant(tenantId: string): Promise<SavedPromptItem[]> {
  const row = await prisma.configValue.findUnique({
    where: { key: savedPromptsConfigKey(tenantId) },
    select: { value: true },
  });
  if (!Array.isArray(row?.value)) return [];
  return (row.value as SavedPromptItem[]).filter((x) => x && typeof x.id === "string" && typeof x.prompt === "string");
}

export async function saveCreativePromptAction(input: {
  title?: string;
  prompt: string;
  kind?: "image" | "video" | "audio" | "brief";
}): Promise<{ ok: boolean; items: SavedPromptItem[]; error?: string }> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const tenantId = await creativeTenantFor(actor);
  const text = input.prompt.trim();
  if (text.length < 3) {
    return { ok: false, items: await listSavedPromptsForTenant(tenantId), error: "Kaydedilecek prompt en az 3 karakter olmalı." };
  }
  const existing = await listSavedPromptsForTenant(tenantId);
  const cleanTitle =
    (input.title ?? "").trim() ||
    text
      .replace(/^Şimdi üret:\s*/i, "")
      .slice(0, 44)
      .trim();
  const item: SavedPromptItem = {
    id: `sp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: cleanTitle,
    prompt: text.slice(0, 2000),
    kind: input.kind ?? "image",
    createdAt: new Date().toISOString(),
  };
  const deduped = existing.filter((x) => x.prompt.toLocaleLowerCase("tr") !== text.toLocaleLowerCase("tr"));
  const next = [item, ...deduped].slice(0, 30);
  const key = savedPromptsConfigKey(tenantId);
  await prisma.configValue.upsert({
    where: { key },
    create: { key, value: next, verified: true, note: "Kullanıcı kayıtlı creative promptları" },
    update: { value: next, verified: true },
  });
  return { ok: true, items: next };
}

export async function deleteCreativePromptAction(id: string): Promise<{ ok: boolean; items: SavedPromptItem[] }> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const tenantId = await creativeTenantFor(actor);
  const existing = await listSavedPromptsForTenant(tenantId);
  const next = existing.filter((x) => x.id !== id);
  const key = savedPromptsConfigKey(tenantId);
  await prisma.configValue.upsert({
    where: { key },
    create: { key, value: next, verified: true, note: "Kullanıcı kayıtlı creative promptları" },
    update: { value: next, verified: true },
  });
  return { ok: true, items: next };
}

export type CreditTier = "economy" | "standard" | "pro";

export type PromptIdeaItem = {
  title: string;
  category: string;
  prompt: string;
};

export type OrchestratorMeta = {
  status: "needs_info" | "ready";
  missingSlots: string[];
  endpoint: string;
  unitCostLabel: string;
  falPayload: Record<string, unknown>;
  comboPreset: {
    label: string;
    image: string;
    video: string;
    tts: string;
    music: string;
  };
  operationType?: CostAwareOperationType;
  zeroCreditEdit?: boolean;
  boundAsset?: { assetId: string; role: string; categoryTr: string; summaryTr: string; textures: string[] } | null;
  sfxTrack?: { timestampMs: number; labelTr: string; sfxKey: string }[];
  motionLayers?: { type: string; text?: string; animation: string; startMs: number; endMs: number }[];
  preFlightSummary?: string | null;
};

export type PersistedChatTurn = {
  id: string;
  from: "user" | "bot";
  text: string;
  postBrief?: string | null;
  enhancedPrompt?: string | null;
  voiceoverScript?: string | null;
  assetId?: string | null;
  uploadId?: string | null;
  kind?: "image" | "video" | "audio";
  format?: string;
  modelKey?: string;
  prompt?: string;
  savedToLibrary?: boolean;
  error?: string | null;
  invokedSkill?: { id: string; label: string; agentName: string; reason: string } | null;
};

function chatHistoryKey(tenantId: string): string {
  return `creative.chatHistory.${tenantId}`;
}

export async function loadCreativeChatHistory(tenantId: string): Promise<PersistedChatTurn[]> {
  try {
    const row = await prisma.configValue.findUnique({ where: { key: chatHistoryKey(tenantId) }, select: { value: true } });
    return Array.isArray(row?.value) ? (row.value as PersistedChatTurn[]) : [];
  } catch {
    return [];
  }
}

async function persistChatExchange(tenantId: string, userText: string, res: CreativeDirectorResponse): Promise<void> {
  try {
    const existing = await loadCreativeChatHistory(tenantId);
    const now = Date.now();
    const userTurn: PersistedChatTurn = { id: `u-${now}`, from: "user", text: userText };
    const botTurn: PersistedChatTurn = res.ok
      ? {
        id: `b-${now + 1}`,
        from: "bot",
        text: res.reply,
        postBrief: res.postBrief ?? null,
        enhancedPrompt: res.enhancedPrompt ?? null,
        voiceoverScript: res.voiceoverScript ?? null,
        assetId: res.assetId ?? null,
        kind: res.kind,
        format: res.format,
        modelKey: res.modelKey,
        prompt: res.enhancedPrompt ?? userText,
        invokedSkill: res.invokedSkill ?? null,
        savedToLibrary: Boolean(res.assetId),
      }
      : {
        id: `b-err-${now + 1}`,
        from: "bot",
        text: `İşlem tamamlanamadı: ${res.error ?? "Beklenmeyen hata"}`,
        error: res.error ?? null,
      };
    const next = [...existing, userTurn, botTurn].slice(-60);
    await prisma.configValue.upsert({
      where: { key: chatHistoryKey(tenantId) },
      create: { key: chatHistoryKey(tenantId), value: next as never },
      update: { value: next as never },
    });
  } catch {
    /* sohbet geçmişi kaydı ana akışı bozmasın */
  }
}

export async function clearCreativeChatAction(): Promise<{ ok: boolean }> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const tenantId = await creativeTenantFor(actor);
  await Promise.all([
    prisma.configValue.deleteMany({ where: { key: chatHistoryKey(tenantId) } }),
    resetCreativeSessionState(tenantId),
  ]);
  revalidateAll();
  return { ok: true };
}

export type CreativeDirectorResponse = {
  ok: boolean;
  error?: string;
  action: "ask" | "generate";
  reply: string;
  postBrief?: string | null;
  enhancedPrompt?: string | null;
  voiceoverScript?: string | null;
  kind?: "image" | "video" | "audio";
  format?: "9:16" | "4:5" | "1:1" | "16:9";
  modelKey?: string;
  jobId?: string | null;
  videoEditJobId?: string | null;
  pipelineJobId?: string | null;
  assetId?: string | null;
  availableCredits?: number;
  orchestrator?: OrchestratorMeta | null;
  invokedSkill?: { id: string; label: string; agentName: string; reason: string } | null;
  suggestions: PromptIdeaItem[];
};

function pickFalModelKey(
  models: { key: string; kind: string; creditsPerUnit: unknown }[],
  kind: "image" | "video" | "audio",
  tier: CreditTier,
  promptText: string,
): string {
  const p = promptText.toLocaleLowerCase("tr");
  const hasKey = (k: string) => models.some((m) => m.key === k);
  const list = models
    .filter((m) => m.kind === kind)
    .sort((a, b) => Number(a.creditsPerUnit) - Number(b.creditsPerUnit));

  if (kind === "image") {
    if (/(yazı|afiş|poster|tipografi|başlık|logo|reading|typography)/.test(p)) {
      if (hasKey("nano-banana-2")) return "nano-banana-2";
      if (hasKey("ideogram-v3")) return "ideogram-v3";
    }
    if (tier === "economy") return hasKey("flux-schnell") ? "flux-schnell" : (list[0]?.key ?? "flux-schnell");
    if (tier === "standard") {
      if (/(moda|portre|estetik|kozmetik)/.test(p) && hasKey("seedream-v4-5")) return "seedream-v4-5";
      if (hasKey("flux-dev")) return "flux-dev";
      return hasKey("nano-banana-2") ? "nano-banana-2" : (list[Math.min(1, list.length - 1)]?.key ?? "flux-schnell");
    }
    if (/(katalog|stüdyo reklam)/.test(p) && hasKey("seedream-v5-pro")) return "seedream-v5-pro";
    if (hasKey("nano-banana-pro")) return "nano-banana-pro";
    return hasKey("nano-banana-2") ? "nano-banana-2" : (list[list.length - 1]?.key ?? "flux-schnell");
  }

  if (kind === "video") {
    if (tier === "economy") {
      if (hasKey("minimax-h3-max-turbo")) return "minimax-h3-max-turbo";
      return hasKey("ltxv-distilled") ? "ltxv-distilled" : (list[0]?.key ?? "ltxv-distilled");
    }
    if (tier === "standard") {
      if (/(dinamik|kamera hareketi|wan)/.test(p) && hasKey("wan-v3")) return "wan-v3";
      if (hasKey("minimax-h3-max")) return "minimax-h3-max";
      return hasKey("hailuo-02-standard") ? "hailuo-02-standard" : (list[Math.min(1, list.length - 1)]?.key ?? "ltxv-distilled");
    }
    if (/(ses efekt|veo)/.test(p) && hasKey("veo-3-1")) return "veo-3-1";
    if (/(1080p|yüksek çözünürlük)/.test(p) && hasKey("wan-v3-1080p")) return "wan-v3-1080p";
    return hasKey("kling-v3-pro") ? "kling-v3-pro" : (list[list.length - 1]?.key ?? "ltxv-distilled");
  }

  // Seslendirme (TTS) veya Arka Plan Müziği
  const isMusic = /(müzik|muzik|fon müziği|beat|şarkı|enstrümantal|melodi)/.test(p);
  if (isMusic) {
    if (tier === "economy" && hasKey("ace-step")) return "ace-step";
    if (tier === "standard" && hasKey("cassetteai-music")) return "cassetteai-music";
    if (/(vokal|sözlü)/.test(p) && hasKey("minimax-music-2-6")) return "minimax-music-2-6";
    if (hasKey("lyria-3")) return "lyria-3";
  }
  if (/(diyalog|\[s1\]|iki kişi|podcast)/i.test(p) && hasKey("dia-tts")) return "dia-tts";
  if (tier === "economy") return hasKey("elevenlabs-turbo-2-5") ? "elevenlabs-turbo-2-5" : (list[0]?.key ?? "minimax-speech-2-8-turbo");
  if (tier === "standard") return hasKey("elevenlabs-turbo-2-5") ? "elevenlabs-turbo-2-5" : (list[0]?.key ?? "minimax-speech-2-8-turbo");
  if (hasKey("elevenlabs-v3")) return "elevenlabs-v3";
  return hasKey("elevenlabs-multilingual-v2") ? "elevenlabs-multilingual-v2" : (list[list.length - 1]?.key ?? "minimax-speech-2-8-turbo");
}

const DEFAULT_PROMPT_IDEAS: PromptIdeaItem[] = [
  {
    title: "Sabah Işığında Ürün & Kahve Postu",
    category: "4:5 Fotoğraf + Brief",
    prompt:
      "Instagram için 4:5 dikey formatta ürün ve kahve çekimi üret: Sabah güneş ışığı alan doğal ahşap masa üzerinde minimal kompozisyon, sıcak krem ve toprak tonları, arkada hafif flu bitkiler, yüksek stüdyo netliği ve dikkat çekici Instagram post metni ile hashtagler hazırla.",
  },
  {
    title: "Sinematik Sesli Reels Videosu",
    category: "9:16 Sesli Video",
    prompt:
      "Instagram Reels için 9:16 dikey formatta 5 saniyelik sinematik tanıtım videosu ve Türkçe seslendirme üret: Yavaşça ürüne doğru yaklaşan kamera hareketi, altın saat ışık yansımaları, modern lüks atmosfer ve enerjik bir Türkçe reklam seslendirmesi ekle.",
  },
  {
    title: "Videoma Türkçe Seslendirme Ekle",
    category: "Videoya Ses",
    prompt:
      "Videom için enerjik ve samimi bir Türkçe reklam seslendirmesi üretip videoya ekle: 'Yeni sezon koleksiyonumuz şimdi yayında! Sınırlı stok fırsatını kaçırmamak için hemen profildeki bağlantıya tıklayın.'",
  },
  {
    title: "Kozmetik & Cilt Bakımı Stüdyo",
    category: "4:5 Makro Fotoğraf",
    prompt:
      "Kozmetik ve cilt bakımı ürünü için 4:5 makro stüdyo fotoğrafı üret: Su damlacıkları ve doğal botanik yapraklar arasında zarif şişe, yumuşak difüzör aydınlatması, pastel bej arka plan ve ürün faydalarını anlatan Instagram Post Brief'i oluştur.",
  },
  {
    title: "Editorial Moda & Sokak Stili",
    category: "9:16 Story Görseli",
    prompt:
      "Instagram Story için 9:16 dikey formatta editorial moda çekimi üret: Şehir sokaklarında doğal gün ışığında modern minimalist kombin, sinematik renk tonlaması ve etkileşim artıran Story metni hazırla.",
  },
  {
    title: "Kampanya Post Brief & Hashtag Seti",
    category: "Post & Brief",
    prompt:
      "Yeni ürün lansmanımız için görsel üretmeden önce kapsamlı bir Instagram Post Brief'i, dikkat çekici 3 farklı açılış cümlesi (Hook), açıklama metni, yapılacaklar listesi ve #reklam uyumlu hashtag seti hazırla.",
  },
];

/**
 * Mevcut bir videoya (GeneratedAsset veya CreativeUpload) Türkçe AI seslendirme üretip gömer.
 */
export async function addVoiceoverToVideoAction(input: {
  videoId: string;
  scriptText: string;
  tier: CreditTier;
}): Promise<CreativeDirectorResponse> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const tenantId = await creativeTenantFor(actor);
  if (actor.role !== "ADMIN") await ensureStarterCredits(tenantId);

  const script = input.scriptText.trim();
  if (script.length < 3) {
    return {
      ok: false,
      error: "Seslendirme metni en az 3 karakter olmalı.",
      action: "ask",
      reply: "",
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  }

  let holdId: string | null = null;
  let jobId: string | null = null;

  try {
    // Videoyu GeneratedAsset veya CreativeUpload tablosundan bul
    const asset = await prisma.generatedAsset.findFirst({ where: { id: input.videoId, tenantId } });
    const upload = !asset ? await prisma.creativeUpload.findFirst({ where: { id: input.videoId, tenantId } }) : null;
    const s3Key = asset?.s3Key ?? upload?.s3Key;
    if (!s3Key) {
      return {
        ok: false,
        error: "Ses eklenecek video bulunamadı.",
        action: "ask",
        reply: "",
        availableCredits: await getAvailableCredits(tenantId),
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
    }

    let activeModels = await prisma.modelRegistry.findMany({
      where: { status: "active", licenseStatus: "cleared", provider: "fal" },
      select: { key: true, kind: true, creditsPerUnit: true },
    });
    if (!activeModels.some((m) => m.kind === "audio")) {
      await seedModelRegistry().catch(() => undefined);
      activeModels = await prisma.modelRegistry.findMany({
        where: { status: "active", licenseStatus: "cleared", provider: "fal" },
        select: { key: true, kind: true, creditsPerUnit: true },
      });
    }

    const audioModelKey = pickFalModelKey(activeModels, "audio", input.tier, script);
    const model = await resolveModel(audioModelKey);
    const units = Math.max(1, Math.ceil(script.length / 1000));
    const pricing = await creativePricing();
    const credits = chargeIn(Number(model.creditsPerUnit), units, pricing, await tenantCurrency(tenantId));
    const hold = await placeHold(tenantId, credits);
    holdId = hold.id;
    const promptHash = createHash("sha256").update(script).digest("hex");

    const job = await prisma.creativeJob.create({
      data: {
        tenantId,
        modelKey: model.key,
        modelId: model.modelId,
        prompt: `Videoya Seslendirme: ${script}`,
        promptHash,
        units,
        creditHoldId: hold.id,
        inputUploadId: upload?.id ?? null,
        status: "IN_PROGRESS",
        submittedAt: new Date(),
      },
    });
    jobId = job.id;

    let mergedBytes: Uint8Array;
    const dir = mkdtempSync(path.join(tmpdir(), "nv-dl-"));
    try {
      const tmpIn = path.join(dir, "in.mp4");
      let rawBytes: Uint8Array | null = null;
      try {
        await downloadToFile(s3Key, tmpIn);
        const buf = readFileSync(tmpIn);
        if (buf.byteLength > 256) rawBytes = new Uint8Array(buf);
      } catch {
        rawBytes = null;
      }
      if (rawBytes) {
        mergedBytes = await mergeVoiceoverOntoVideoBytes(rawBytes, script);
      } else {
        const gen = await renderStudioVideoMp4({ prompt: script, aspect: "9:16", voiceText: script });
        mergedBytes = gen.bytes;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const c2pa = embedC2pa({
      assetBytes: mergedBytes,
      mime: "video/mp4",
      modelKey: model.key,
      modelId: model.modelId,
      tenantId,
      promptHash,
    });
    const outKey = `generated/${tenantId}/${job.id}`;
    await objectStore().put(outKey, c2pa.signedBytes, "video/mp4");
    await objectStore().put(`${outKey}.c2pa.json`, c2pa.sidecarJson, "application/json");

    const createdAsset = await prisma.$transaction(async (tx) => {
      const a = await tx.generatedAsset.create({
        data: {
          tenantId,
          jobId: job.id,
          modelKey: asset?.modelKey ?? "ltxv-distilled",
          modelId: model.modelId,
          promptHash,
          s3Key: outKey,
          c2paManifestId: c2pa.manifestId,
          isAiGenerated: true,
        },
      });
      await tx.creativeUpload.create({
        data: {
          tenantId,
          kind: "video",
          mime: "video/mp4",
          sizeBytes: Math.max(1, c2pa.signedBytes.byteLength),
          s3Key: outKey,
          name: `Sesli Video · ${script.slice(0, 72)}`,
          source: "ai",
          parentId: upload?.id ?? null,
          durationSec: 5,
        },
      });
      await chargeHold(hold.id, tx);
      await tx.creativeJob.update({
        where: { id: job.id },
        data: { status: "COMPLETED", completedAt: new Date(), inferenceMs: 1200 },
      });
      return a;
    });

    const avail = await getAvailableCredits(tenantId);
    revalidateAll();

    return {
      ok: true,
      action: "generate",
      reply: `Videonuz için Türkçe AI seslendirme üretildi ve doğrudan videonun ses kanalına gömüldü! Aşağıdaki oynatıcıdan veya sağdaki telefon önizlemesinden sesli olarak izleyebilirsiniz.`,
      voiceoverScript: script,
      enhancedPrompt: script,
      kind: "video",
      format: "9:16",
      modelKey: model.key,
      assetId: createdAsset.id,
      availableCredits: avail,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  } catch (e) {
    if (jobId) {
      await refundJobCredits(jobId, "Videoya seslendirme eklenemedi; bakiye iade edildi.").catch(() => undefined);
      await prisma.creativeJob
        .update({
          where: { id: jobId },
          data: { status: "FAILED", rejectReason: e instanceof Error ? e.message : "Videoya ses eklenemedi.", completedAt: new Date() },
        })
        .catch(() => undefined);
    } else if (holdId) {
      await releaseHold(holdId).catch(() => undefined);
    }
    const avail = await getAvailableCredits(tenantId).catch(() => undefined);
    const baseMsg = humanizeCreativeError(e);
    const withRefund = holdId && !(e instanceof InsufficientCreditsError) ? `${baseMsg} (Ücret alınmadı, bakiyeniz iade edildi.)` : baseMsg;
    return {
      ok: false,
      error: withRefund,
      action: "ask",
      reply: "",
      availableCredits: avail,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  }
}

/**
 * Nordvow Creative AI Sohbet Yöneticisi:
 * - Selamlaşma ve yetenek sorularında detaylı tanıtım yapar.
 * - Görsel, Video, Sesli Video, Videoya Ses Ekleme ve Instagram Post & Brief oluşturmayı tek sohbette yönetir.
 * - Tıklanabilir hazır prompt fikirlerini detaylı olarak döndürür.
 */
export async function chatCreativeDirectorAction(input: {
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
  tier: CreditTier;
  referenceUploadIds?: string[];
  targetVideoAssetId?: string | null;
  forceGenerate?: boolean;
}): Promise<CreativeDirectorResponse> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const tenantId = await creativeTenantFor(actor);
  if (actor.role !== "ADMIN") await ensureStarterCredits(tenantId);

  const msg = input.message.trim();
  if (!msg) return { ok: false, error: "Lütfen bir mesaj yazın.", action: "ask", reply: "", suggestions: DEFAULT_PROMPT_IDEAS };

  const norm = msg.toLocaleLowerCase("tr");
  const words = norm.split(/\s+/).filter(Boolean);

  // Vision-First & Structured Session State yüklemesi
  let session = await loadCreativeSessionState(tenantId);
  session = updateSessionFromUserIntent(session, msg);

  const rawRefIds = [...new Set((input.referenceUploadIds ?? []).filter(Boolean))].slice(0, 4);
  const analyzedRefs: BoundAsset[] = [];
  for (const rid of rawRefIds) {
    const bound = await analyzeAssetWithVision({
      tenantId,
      assetOrUploadId: rid,
      contextHint: msg,
    });
    if (bound) analyzedRefs.push(bound);
  }
  if (analyzedRefs.length > 0) {
    session = bindAssetsToSession(session, analyzedRefs);
  } else if (session.current_canvas.asset_id && session.current_canvas.kind === "image" && !session.active_assets.length) {
    const canvasBound = await analyzeAssetWithVision({
      tenantId,
      assetOrUploadId: session.current_canvas.asset_id,
      contextHint: session.current_canvas.last_prompt ?? msg,
    });
    if (canvasBound) session = bindAssetsToSession(session, [canvasBound]);
  }
  await saveCreativeSessionState(tenantId, session);

  const toBoundSummary = (b: BoundAsset | null) =>
    b
      ? {
        assetId: b.asset_id,
        role: b.vision.role,
        categoryTr: CATEGORY_LABELS_TR[b.vision.product_category],
        summaryTr: b.vision.subject_summary_tr,
        textures: b.vision.materials_textures,
      }
      : null;

  // 1. Selamlaşma veya "Neler yapabilirsin?" kontrolü
  const isGreeting =
    words.length <= 4 &&
    /^(selam|merhaba|slm|hey|günaydın|gunaydin|iyi günler|iyi akşamlar|nasılsın|nasilsin|naber|merhabalar|selamlar|hi|hello)[!.,?]*$/i.test(norm);
  const wantsCapabilities = /(neler yapabilirsin|ne yapabiliyorsun|yeteneklerin|nasıl çalışır|ne üretebilirsin|yardım|kendini tanıt|neler yapıyorsun)/.test(norm);

  if ((isGreeting || wantsCapabilities) && !input.forceGenerate) {
    const out: CreativeDirectorResponse = {
      ok: true,
      action: "ask",
      reply:
        "Merhaba! Hoş geldiniz, ben **Nordvow Creative AI** — tek ekranda tüm fotoğraf, video ve kurgu işlemlerinizi yöneten yapay zekâ stüdyonuzum.\n\n" +
        "Sizin için bu sohbette doğrudan şunları yapabilirim:\n\n" +
        "• **1. Fotoğraf Üretimi & Komutla Düzenleme:** Sıfırdan 4:5 Post, 9:16 Story, 1:1 Kare görsel üretir veya yüklediğiniz fotoğrafı komutla yeniden düzenlerim.\n" +
        "• **2. Fotoğraf Arka Plan Kaldırma & 2x Netleştirme:** Fotoğraf yükleyip *“arka planı kaldır”* veya *“netleştir”* yazmanız yeterli.\n" +
        "• **3. Fotoğraftan Sinematik Video (Image-to-Video):** Yüklediğiniz ürün/model fotoğrafını 5-10 sn akıcı Reels videosuna dönüştürürüm.\n" +
        "• **4. AI Video Düzenleme & FFmpeg Kurgu:** Video yükleyip *“videoyu 9:16 yap, hızlandır, ilk 10 saniyeyi kes, canlı renk uygula”* gibi doğal komutlarla videonuzu yeniden işlerim.\n" +
        "• **5. Videoya Türkçe AI Seslendirme (Voiceover):** İstediğiniz metni doğal Türkçe seslendirmeye çevirip doğrudan videonuzun üzerine gömerim.\n" +
        "• **6. Instagram Post Brief, Caption & Hashtag:** Dikkat çekici açılış cümlesi, açıklama metni ve `#reklam` uyumlu hashtag seti hazırlarım.\n\n" +
        "Dosya yükleyip ne yapmak istediğinizi yazabilir veya aşağıdaki fikir kartlarından birine tıklayabilirsiniz.",
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
    await persistChatExchange(tenantId, msg, out);
    return out;
  }

  // 2. LLM + Kayıtlı Skill Agent Orkestratörü (tüm creative yeteneklerini tek sohbetten yönlendirir)
  const attachedUploads = rawRefIds.length
    ? await prisma.creativeUpload
      .findMany({ where: { tenantId, id: { in: rawRefIds } }, select: { id: true, kind: true, name: true } })
      .catch(() => [])
    : [];
  const attachedPhotoIds = attachedUploads.filter((u) => u.kind === "image").map((u) => u.id);
  const attachedVideoUpload = attachedUploads.find((u) => u.kind === "video") ?? null;
  const resolvedVideoTargetId = attachedVideoUpload?.id ?? input.targetVideoAssetId ?? null;

  const skillDecision = await routeCreativeSkill({
    message: msg,
    history: input.history.map((h) => ({ role: h.role, text: h.text })),
    attachedImagesCount: attachedPhotoIds.length || analyzedRefs.filter((r) => r.kind === "image").length,
    hasAttachedVideo: Boolean(attachedVideoUpload),
    hasLastGeneratedVideo: Boolean(resolvedVideoTargetId),
  });
  const activeSkillDef = SKILL_BY_ID[skillDecision.skill];
  const invokedSkill = {
    id: activeSkillDef.id,
    label: activeSkillDef.label,
    agentName: activeSkillDef.agentName,
    reason: skillDecision.reason,
  };

  // Skill: Kredi & Bakiye Sorgusu
  if (skillDecision.skill === "credit_status") {
    const [availCredits, accCur] = await Promise.all([
      getAvailableCredits(tenantId).catch(() => 0),
      tenantCurrency(tenantId).catch(() => "TRY"),
    ]);
    const out: CreativeDirectorResponse = {
      ok: true,
      action: "ask",
      reply: `Mevcut kullanılabilir bakiyeniz: **${availCredits.toLocaleString("tr-TR")} ${accCur}**.\n\nGörsel üretimi, video üretimi, AI video kurgu (FFmpeg + altyazı + müzik) ve seslendirme işlemlerini doğrudan bu sohbetten başlatabilirsiniz.`,
      availableCredits: availCredits,
      invokedSkill,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
    await persistChatExchange(tenantId, msg, out);
    return out;
  }

  // Skill: Kitaplık / Medya Listeleme
  if (skillDecision.skill === "library_search") {
    const [recentUploads, recentAssets] = await Promise.all([
      prisma.creativeUpload.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.generatedAsset.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 8 }),
    ]);
    const lines: string[] = [];
    for (const u of recentUploads) {
      lines.push(`• **${u.kind === "video" ? "🎬 Video" : "🖼️ Fotoğraf"}:** ${u.name ?? u.id.slice(-6)} (${u.source === "edit" ? "Kurgu" : u.source === "ai" ? "AI" : "Yükleme"})`);
    }
    for (const a of recentAssets.slice(0, Math.max(0, 10 - lines.length))) {
      lines.push(`• **✨ AI Çıktı:** ${a.modelKey} (${a.id.slice(-6)})`);
    }
    const replyText =
      lines.length > 0
        ? `Kitaplığınızdaki son medya dosyaları:\n\n${lines.join("\n")}\n\nDüzenlemek veya videoya çevirmek istediğiniz dosyayı aşağıdaki **+** (ekle) menüsünden seçip komut yazmanız yeterli.`
        : "Kitaplığınızda henüz dosya yok. Aşağıdan fotoğraf/video yükleyebilir veya sıfırdan görsel/video üretmemi isteyebilirsiniz.";
    const out: CreativeDirectorResponse = {
      ok: true,
      action: "ask",
      reply: replyText,
      invokedSkill,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
    await persistChatExchange(tenantId, msg, out);
    return out;
  }

  // Skill: Çoklu Fotoğraftan AI Video Montajı (Bedrock Storyboard + fal.ai + FFmpeg)
  if (skillDecision.skill === "photo_to_video_montage" && attachedPhotoIds.length >= 2) {
    try {
      const pJob = await startPhotoToVideoJob({
        tenantId,
        uploadIds: attachedPhotoIds,
        modelChoice: input.tier === "pro" ? "kling" : "hailuo",
        aspect: skillDecision.aspect === "16:9" || skillDecision.aspect === "1:1" ? skillDecision.aspect : "9:16",
        goal: msg,
      });
      const out: CreativeDirectorResponse = {
        ok: true,
        action: "generate",
        reply: `${attachedPhotoIds.length} fotoğrafınız için AI storyboard ve video montaj işi başlatıldı! Arka planda sahneler üretilip müzikle birleştiriliyor; tamamlandığında doğrudan bu sohbette açılacak.`,
        kind: "video",
        format: skillDecision.aspect ?? "9:16",
        modelKey: "photo-to-video",
        pipelineJobId: pJob.id,
        invokedSkill,
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    } catch (e) {
      const out: CreativeDirectorResponse = {
        ok: false,
        error: humanizeCreativeError(e),
        action: "ask",
        reply: humanizeCreativeError(e),
        invokedSkill,
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    }
  }

  // Skill: Videoya Seslendirme (Voiceover)
  if (skillDecision.skill === "video_voiceover" && resolvedVideoTargetId) {
    let script = skillDecision.extractedScript ?? "";
    if (!script || script.length < 5) {
      script = "Yeni sezon koleksiyonumuz şimdi yayında! Sınırlı stok fırsatını kaçırmamak için hemen profildeki bağlantıya tıklayın.";
    }
    const out = await addVoiceoverToVideoAction({
      videoId: resolvedVideoTargetId,
      scriptText: script,
      tier: input.tier,
    });
    const enriched: CreativeDirectorResponse = { ...out, invokedSkill };
    await persistChatExchange(tenantId, msg, enriched);
    return enriched;
  }

  // Skill: AI Video Kurgu & FFmpeg (altyazı, müzik, kesme, sessizlik silme, 9:16, hız, renk, metin)
  if (skillDecision.skill === "ai_video_edit" && resolvedVideoTargetId) {
    try {
      const upload = await getOwnedUpload(tenantId, resolvedVideoTargetId);
      if (upload.kind === "video") {
        const pJob = await startAiVideoEditJob({
          tenantId,
          sourceUploadId: upload.id,
          command: msg,
          modelChoice: input.tier === "pro" ? "kling" : "hailuo",
        });
        const out: CreativeDirectorResponse = {
          ok: true,
          action: "generate",
          reply: "AI Video Kurgu planınız oluşturuldu! İsteğiniz (kırpma, altyazı, müzik, renk/hız veya format dönüşümü) arka planda FFmpeg + Bedrock ile işleniyor; bitince burada önizlemeye düşecek.",
          kind: "video",
          format: skillDecision.aspect ?? "9:16",
          modelKey: "ai-video-edit",
          pipelineJobId: pJob.id,
          invokedSkill,
          suggestions: DEFAULT_PROMPT_IDEAS,
        };
        await persistChatExchange(tenantId, msg, out);
        return out;
      }
    } catch (e) {
      const out: CreativeDirectorResponse = {
        ok: false,
        error: humanizeCreativeError(e),
        action: "ask",
        reply: humanizeCreativeError(e),
        invokedSkill,
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    }
  }

  const asksVideoEdit =
    Boolean(input.targetVideoAssetId) &&
    /(videoyu|bu video|kırp|kirp|kes|kadraj|9:16|1:1|16:9|hızlandır|hizlandir|yavaşlat|yavaslat|sessiz|sesi kapat|renk|filtre|canlı|canli|siyah beyaz|soldur|düzenle|duzenle)/.test(norm);

  if (asksVideoEdit && input.targetVideoAssetId) {
    try {
      const upload = await getOwnedUpload(tenantId, input.targetVideoAssetId);
      if (upload.kind === "video") {
        const plan = await planVideoEditFromBrief(msg, upload.durationSec ?? null);
        const vJob = await enqueueVideoEdit({ tenantId, uploadId: upload.id, ops: plan.ops });
        const out: CreativeDirectorResponse = {
          ok: true,
          action: "generate",
          reply: `Video düzenleme planı hazırlandı (${plan.summary.join(" · ")}). FFmpeg ile işleniyor; tamamlanınca önizlemede açılacak.`,
          kind: "video",
          format: plan.ops.aspect === "orijinal" ? "9:16" : plan.ops.aspect,
          modelKey: "ffmpeg-edit",
          videoEditJobId: vJob.id,
          suggestions: DEFAULT_PROMPT_IDEAS,
        };
        await persistChatExchange(tenantId, msg, out);
        return out;
      }
    } catch (e) {
      const out: CreativeDirectorResponse = {
        ok: false,
        error: humanizeCreativeError(e),
        action: "ask",
        reply: "",
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    }
  }

  // 2c. Çoklu fotoğraf (2-20) seçiliyse ve video/montaj istendiyse Storyboard + FFmpeg Photo-to-Video Pipeline
  const refsPre = (input.referenceUploadIds ?? []).filter(Boolean).slice(0, 20);
  if (refsPre.length >= 2 && /(video|reels|hareketli|klip|slayt|montaj)/.test(norm)) {
    try {
      const aspect = norm.includes("1:1") ? "1:1" : norm.includes("16:9") ? "16:9" : "9:16";
      const pJob = await startPhotoToVideoJob({
        tenantId,
        uploadIds: refsPre,
        modelChoice: input.tier === "pro" ? "kling" : "hailuo",
        aspect,
        goal: msg,
      });
      const out: CreativeDirectorResponse = {
        ok: true,
        action: "generate",
        reply: `${refsPre.length} fotoğrafınız için çok sahneli AI Video Pipeline başlatıldı (${aspect}). Sahneler üretilip FFmpeg ile birleştirildiğinde önizlemede açılacak.`,
        kind: "video",
        format: aspect,
        modelKey: pJob.modelKey,
        pipelineJobId: pJob.id,
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    } catch (e) {
      const out: CreativeDirectorResponse = {
        ok: false,
        error: humanizeCreativeError(e),
        action: "ask",
        reply: "",
        availableCredits: await getAvailableCredits(tenantId).catch(() => undefined),
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    }
  }

  // 2d. Cost-Aware Router Ön Kontrolü: 0-Kredi Programatik SFX/Animasyon Kurgu + Kilitli BG Remove / Upscale
  const costRoute = routeCostAwareOperation({
    message: msg,
    tier: input.tier,
    session,
    explicitRefs: analyzedRefs,
    targetVideoId: input.targetVideoAssetId,
  });

  if (costRoute.operation === "programmatic_edit" && costRoute.sourceCanvasId) {
    try {
      const prog = await renderProgrammaticTimelineVideo({
        tenantId,
        sourceAssetOrUploadId: costRoute.sourceCanvasId,
        timeline: costRoute.timeline,
        label: msg,
      });
      session.current_canvas = {
        asset_id: prog.assetId,
        upload_id: prog.uploadId,
        kind: "video",
        version: session.current_canvas.version + 1,
        parent_asset_id: costRoute.sourceCanvasId,
        last_prompt: msg,
      };
      session.timeline_plan = costRoute.timeline;
      await saveCreativeSessionState(tenantId, session);
      const avail = await getAvailableCredits(tenantId).catch(() => undefined);
      revalidateAll();

      const sfxListText = costRoute.timeline.sfx_track
        .map((c) => `${(c.timestamp_ms / 1000).toFixed(1)}sn ${c.label_tr}`)
        .join(", ");
      const mgListText = costRoute.timeline.motion_layers.map((m) => m.text).filter(Boolean).join(", ");
      const out: CreativeDirectorResponse = {
        ok: true,
        action: "generate",
        reply: `0 AI Video Kredisiyle Programatik Kurgu Tamamlandı! Mevcut tuvaliniz yeniden üretilmeden zaman çizelgesine${sfxListText ? ` SFX (${sfxListText})` : ""}${mgListText ? ` ve özel animasyon katmanları (${mgListText})` : ""} işlendi.`,
        kind: "video",
        format: costRoute.timeline.aspect_ratio,
        modelKey: "ffmpeg-programmatic",
        assetId: prog.assetId,
        availableCredits: avail,
        orchestrator: {
          status: "ready",
          missingSlots: [],
          endpoint: costRoute.endpoint,
          unitCostLabel: "0 Kredi · FFmpeg Programatik",
          falPayload: {},
          comboPreset: getComboPresetForTier(input.tier),
          operationType: "programmatic_edit",
          zeroCreditEdit: true,
          boundAsset: toBoundSummary(costRoute.boundAsset),
          sfxTrack: costRoute.timeline.sfx_track.map((c) => ({
            timestampMs: c.timestamp_ms,
            labelTr: c.label_tr,
            sfxKey: c.sfx_key,
          })),
          motionLayers: costRoute.timeline.motion_layers.map((m) => ({
            type: m.type,
            text: m.text,
            animation: m.animation,
            startMs: m.start_ms,
            endMs: m.end_ms,
          })),
          preFlightSummary: costRoute.preFlightSummaryTr,
        },
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    } catch (e) {
      const out: CreativeDirectorResponse = {
        ok: false,
        error: humanizeCreativeError(e),
        action: "ask",
        reply: "",
        availableCredits: await getAvailableCredits(tenantId).catch(() => undefined),
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    }
  }

  // Referans veya kilitli varlık üzerinde tek adımlı AI düzenleme (arka plan kaldır / netleştir)
  const effectiveUploadForEdit = costRoute.boundAsset?.upload_id ?? refsPre[0] ?? null;
  if (effectiveUploadForEdit && (costRoute.operation === "bg_remove" || costRoute.operation === "upscale")) {
    try {
      const asksBgRemove = costRoute.operation === "bg_remove";
      const action: EditAction = asksBgRemove ? "arka-plan-kaldir" : "netlestir";
      const job = await submitEditPipeline({
        tenantId,
        uploadId: effectiveUploadForEdit,
        steps: [{ action, prompt: msg }],
      });
      if ((process.env.FAL_MODE ?? "mock") === "mock" && job.requestId) {
        await handleFalWebhook({ request_id: job.requestId, status: "OK", payload: { image: { url: `studio://image/${job.requestId}` } } }).catch(() => undefined);
      }
      const asset = await prisma.generatedAsset.findFirst({ where: { jobId: job.id }, select: { id: true } });
      if (asset?.id) {
        session.current_canvas = {
          asset_id: asset.id,
          upload_id: effectiveUploadForEdit,
          kind: "image",
          version: session.current_canvas.version + 1,
          parent_asset_id: effectiveUploadForEdit,
          last_prompt: msg,
        };
        await saveCreativeSessionState(tenantId, session);
      }
      const avail = await getAvailableCredits(tenantId).catch(() => undefined);
      const out: CreativeDirectorResponse = {
        ok: true,
        action: "generate",
        reply: asksBgRemove
          ? "Fotoğrafınızın arka planı varlık kilidiyle kaldırılıyor; tamamlandığında önizlemede ve kitaplıkta görünecek."
          : "Fotoğrafınız 2x netleştiriliyor; tamamlandığında önizlemede ve kitaplıkta görünecek.",
        kind: "image",
        format: "4:5",
        modelKey: job.modelKey,
        jobId: asset ? null : job.id,
        assetId: asset?.id ?? null,
        availableCredits: avail,
        orchestrator: {
          status: "ready",
          missingSlots: [],
          endpoint: costRoute.endpoint,
          unitCostLabel: asksBgRemove ? "$0.018/görsel" : "$0.005/görsel",
          falPayload: {},
          comboPreset: getComboPresetForTier(input.tier),
          operationType: costRoute.operation,
          zeroCreditEdit: false,
          boundAsset: toBoundSummary(costRoute.boundAsset),
          preFlightSummary: costRoute.preFlightSummaryTr,
        },
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    } catch (e) {
      const out: CreativeDirectorResponse = {
        ok: false,
        error: humanizeCreativeError(e),
        action: "ask",
        reply: "",
        availableCredits: await getAvailableCredits(tenantId).catch(() => undefined),
        suggestions: DEFAULT_PROMPT_IDEAS,
      };
      await persistChatExchange(tenantId, msg, out);
      return out;
    }
  }

  // 3. Yalnızca Post Brief & Caption isteği (görsel/video üretmeden metin & brief hazırlama)
  const onlyBriefRequest =
    !input.forceGenerate &&
    /(sadece brief|sadece post metni|görsel üretmeden|yalnızca metin|post brief hazırla|instagram açıklaması yaz|hashtag yaz)/.test(norm);

  if (onlyBriefRequest) {
    const briefReply = `İstediğiniz konu için Instagram Post Brief ve hazır paylaşım metnini hazırladım. Dilerseniz bu brief'e uygun 4:5 fotoğraf veya 9:16 sesli Reels videosunu da hemen üretebilirim!`;
    let postBriefText =
      `📌 KAMPANYA & POST BRIEF\n` +
      `• Konsept: ${msg}\n` +
      `• Önerilen Format: 4:5 Dikey Gönderi + 9:16 Story Tekrarı\n` +
      `• Görsel Ton: Doğal ışık, temiz arka plan, ürünü öne çıkaran yakın kadraj\n\n` +
      `✍️ HAZIR INSTAGRAM AÇIKLAMASI (CAPTION)\n` +
      `✨ Beklenen an geldi! Her detayında kaliteyi hissedeceğiniz yeni deneyimimizle tanışmaya hazır mısınız?\n\n` +
      `Sizin favori detayınız hangisi? Yorumlarda bizimle paylaşın, profildeki bağlantıdan hemen inceleyin!\n\n` +
      `⚠️ Yasal Etiket: #reklam #işbirliği\n` +
      `🏷️ Hashtagler: #nordvow #yenisezon #kesfet #stil #öneri`;

    if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
      try {
        const out = await converseChat({
          system:
            "Sen Nordvow Creative AI'sın. Kullanıcının istediği konu için Türkçe olarak çok kaliteli bir Instagram Post Brief'i (Konsept, Yapılacaklar, Yapılmayacaklar) ve hemen kopyalanıp paylaşılabilecek dikkat çekici bir Instagram Açıklama Metni (Hook + Metin + CTA + #reklam #işbirliği + 6 hashtag) yaz.",
          turns: [{ role: "user", text: msg }],
          maxTokens: 500,
          temperature: 0.4,
        });
        if (out.text.trim().length > 20) {
          postBriefText = out.text.trim();
        }
      } catch {
        // fallback brief
      }
    }

    return {
      ok: true,
      action: "ask",
      reply: briefReply,
      postBrief: postBriefText,
      suggestions: [
        {
          title: "Bu Brief İçin 4:5 Fotoğraf Üret",
          category: "4:5 Fotoğraf",
          prompt: `Şimdi üret: ${msg} — 4:5 dikey Instagram gönderi formatında profesyonel stüdyo ışığında fotoğraf üret`,
        },
        {
          title: "Bu Brief İçin Sesli 9:16 Reels Üret",
          category: "9:16 Sesli Video",
          prompt: `Şimdi üret: ${msg} — 9:16 dikey formatta 5 saniyelik sinematik Reels videosu ve Türkçe seslendirme üret`,
        },
        ...DEFAULT_PROMPT_IDEAS.slice(0, 3),
      ],
    };
  }

  // 4. Kullanıcının doğrudan üretim isteyip istemediğini veya sohbetin üretim aşamasına gelip gelmediğini belirle
  const activeUserTurns = input.history.filter((h) => h.role === "user").length;
  const hasExplicitGenVerb =
    /(şimdi üret|simdi uret|hemen üret|evet üret|bu şekilde üret|üret:|oluştur:|fotograf uret|fotoğraf üret|resim üret|video üret|ses üret|seslendirme üret|hazırla ve üret|olur üret|evet yapalım|başla)/.test(
      norm,
    );
  const isDetailedPrompt = words.length >= 9;
  const explicitGen = Boolean(input.forceGenerate || hasExplicitGenVerb || isDetailedPrompt || activeUserTurns >= 1);

  const wantsVoiceWithVideo = /(sesli video|seslendirme|konuşmalı|anlatımlı|ses ekle|ses de olsun|sesli reels)/.test(norm);

  const isVideoReq = /(video|reels|hareketli|klip|b-roll|canlandır)/.test(norm);
  const isAudioReq = !isVideoReq && /(ses|seslendir|konusma|konuşma|anons|spot|müzik|muzik|fon müziği|beat|şarkı|tts|diyalog)/.test(norm);
  const turns = [
    ...input.history.slice(-6).map((h) => ({ role: h.role, text: h.text.slice(0, 600) })),
    { role: "user" as const, text: msg },
  ];

  let decision: {
    action: "ask" | "generate";
    kind: "image" | "video" | "audio";
    format: "9:16" | "4:5" | "1:1" | "16:9";
    reply: string;
    enhancedPrompt: string;
    postBrief: string;
    voiceoverScript: string;
    storyPayload?: StoryChatbotPayload;
    suggestions: PromptIdeaItem[];
  } | null = null;

  // Görsel / Story / Post isteklerinde doğrudan AWS Bedrock Converse API + Structured Outputs (JSON Schema) çalıştır
  if (!isVideoReq && !isAudioReq) {
    const storyOut = await runStoryChatbotConverse({
      messages: turns,
      tier: input.tier,
      forceReady: explicitGen,
    });
    const f = storyOut.fal_payload.aspect_ratio;
    decision = {
      action: storyOut.status === "ready" ? "generate" : "ask",
      kind: "image",
      format: f,
      reply: storyOut.assistant_reply,
      enhancedPrompt: storyOut.fal_payload.prompt,
      postBrief:
        storyOut.status === "ready"
          ? `✨ ${msg}\n\nYeni sezonun en özel detaylarını keşfetmeye hazır mısınız? Yorumlarda buluşalım, profildeki bağlantıdan hemen inceleyin!\n\n#reklam #işbirliği #nordvow #story #kesfet`
          : "",
      voiceoverScript: "",
      storyPayload: storyOut,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  } else if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const out = await converseChat({
        system: [
          "Sen Nordvow Creative AI Medya Orkestratörüsün. Kullanıcıyla samimi, yaratıcı Türkçe sohbet ederek Instagram Reels videosu, sesli video, seslendirme (TTS) veya arka plan müziği üretirsin.",
          explicitGen
            ? "Kullanıcı üretim yapılmasını istiyor veya yeterli detay verdi: KESİNLİKLE action='generate' seç!"
            : "Kullanıcının mesajı henüz kısa bir fikir aşamasındaysa action='ask' seç; samimi şekilde 1-2 kısa soru sor.",
          "action='generate' olduğunda:",
          "- kind: 'video' (Reels/video) veya 'audio' (seslendirme / arka plan müziği).",
          "- enhancedPrompt: fal.ai video/ses modeli için zengin İNGİLİZCE prompt yaz (Reels için 'vertical 9:16 composition, cinematic motion').",
          "- postBrief: dikkat çekici açılış cümlesi (Hook), açıklama, #reklam #işbirliği ve 5 ilgili hashtag içeren hazır bir Instagram Post Metni yaz.",
          "- voiceoverScript: 1-2 cümlelik doğal Türkçe reklam seslendirme metni yaz.",
          "SADECE şu JSON formatında yanıt döndür:",
          '{"action":"ask"|"generate","kind":"video"|"audio","format":"9:16"|"4:5"|"1:1"|"16:9","reply":"<kullanıcıya mesajın>","enhancedPrompt":"<detaylı İngilizce prompt>","postBrief":"<Instagram post metni ve hashtagler>","voiceoverScript":"<Türkçe seslendirme metni>"}',
        ].join("\n"),
        turns,
        maxTokens: 600,
        temperature: 0.4,
      });
      const parsed = parseJsonObject(out.text);
      if (parsed && typeof parsed.reply === "string") {
        const k = parsed.kind === "audio" ? "audio" : "video";
        const f = parsed.format === "4:5" || parsed.format === "1:1" || parsed.format === "16:9" ? parsed.format : "9:16";
        decision = {
          action: explicitGen ? "generate" : parsed.action === "ask" ? "ask" : "generate",
          kind: k,
          format: f,
          reply: String(parsed.reply).trim(),
          enhancedPrompt: String(parsed.enhancedPrompt || msg).trim(),
          postBrief: String(parsed.postBrief || "").trim(),
          voiceoverScript: String(parsed.voiceoverScript || "").trim(),
          suggestions: DEFAULT_PROMPT_IDEAS,
        };
      }
    } catch (e) {
      console.warn("[nordvow-creative-ai] Bedrock fallback:", (e as Error).message);
    }
  }

  if (!decision) {
    const isVideo = /(video|reels|hareketli|klip)/.test(norm);
    const isAudio = !isVideo && /(ses|seslendir|konusma|konuşma|anons|spot)/.test(norm);
    const kind = isVideo ? "video" : isAudio ? "audio" : "image";
    const format = norm.includes("4:5") || norm.includes("post") ? "4:5" : norm.includes("1:1") || norm.includes("kare") ? "1:1" : norm.includes("16:9") ? "16:9" : "9:16";

    if (!explicitGen) {
      return {
        ok: true,
        action: "ask",
        reply:
          `Harika bir fikir! **"${msg}"** için birlikte en etkileyici içeriği tasarlayalım:\n\n` +
          `• **Seçenek 1 (4:5 Instagram Post Fotoğrafı):** Doğal sabah ışığında, ürün/konsept odaklı yüksek netlikte fotoğraf + hazır Post Brief.\n` +
          `• **Seçenek 2 (9:16 Sinematik Sesli Reels Videosu):** Yavaş kamera hareketli dikey video + üzerine profesyonel Türkçe reklam seslendirmesi.\n` +
          `• **Seçenek 3 (Minimal Stüdyo Çekimi):** Temiz fonda spot aydınlatmalı modern tasarım.\n\n` +
          `Hangisini tercih edersiniz? Aşağıdaki hazır kartlardan birine tıklayıp sohbet kutusuna ekleyebilir veya tercihinizi yazabilirsiniz.`,
        suggestions: [
          {
            title: `${msg.slice(0, 24)} · 4:5 Post Fotoğrafı`,
            category: "4:5 Fotoğraf",
            prompt: `Şimdi üret: ${msg} — doğal sabah ışığında, sıcak tonlarda, yüksek detaylı 4:5 dikey Instagram gönderi fotoğrafı ve Post Brief'i hazırla.`,
          },
          {
            title: `${msg.slice(0, 24)} · 9:16 Sesli Reels`,
            category: "9:16 Sesli Video",
            prompt: `Şimdi üret: ${msg} — 9:16 dikey formatta 5 saniyelik sinematik kamera hareketli Reels videosu ve enerjik Türkçe seslendirme üret.`,
          },
          {
            title: `${msg.slice(0, 24)} · Stüdyo Tasarım`,
            category: "9:16 Story",
            prompt: `Şimdi üret: ${msg} — 9:16 Instagram Story formatında modern minimal stüdyo aydınlatmalı görsel ve etkileşim metni oluştur.`,
          },
          ...DEFAULT_PROMPT_IDEAS.slice(0, 3),
        ],
      };
    }

    decision = {
      action: "generate",
      kind,
      format,
      reply:
        kind === "video"
          ? "Video sahnenizi, Türkçe seslendirmesini ve Instagram Post Brief'inizi hazırladım!"
          : kind === "audio"
            ? "Türkçe AI seslendirmenizi ve paylaşım notlarınızı hazırladım!"
            : "Fotoğrafınızı ve hazır Instagram Post Brief'inizi oluşturup kitaplığınıza kaydettim!",
      enhancedPrompt: `${msg}, profesyonel stüdyo aydınlatması, yüksek detay, keskin netlik, modern sosyal medya estetiği, ${format} kadraj`,
      postBrief: `✨ ${msg}\n\nYeni sezonun en özel detaylarını keşfetmeye hazır mısınız? Yorumlarda buluşalım, profildeki bağlantıdan hemen inceleyin!\n\n#reklam #işbirliği #nordvow #yeni #kesfet`,
      voiceoverScript: `Yeni koleksiyonumuzun en özel tasarımını şimdi keşfedin! Detaylar için profildeki bağlantıya tıklayın.`,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  }

  if (decision.action === "ask") {
    const topic = msg.slice(0, 36);
    const sp = decision.storyPayload;
    const ep = sp?.fal_payload.model_endpoint ?? (input.tier === "economy" ? "fal-ai/flux/schnell" : "fal-ai/flux/dev");
    const spec = FAL_ORCHESTRATOR_CATALOG.find((x) => x.endpoint === ep);
    return {
      ok: true,
      action: "ask",
      reply: decision.reply,
      postBrief: decision.postBrief || null,
      orchestrator: {
        status: "needs_info",
        missingSlots: sp?.missing_slots ?? ["style_mood", "text_overlay"],
        endpoint: ep,
        unitCostLabel: spec?.unitLabel ?? "$0.003/MP",
        falPayload: sp?.fal_payload ?? { model_endpoint: ep, prompt: decision.enhancedPrompt, aspect_ratio: decision.format },
        comboPreset: getComboPresetForTier(input.tier),
      },
      suggestions: [
        {
          title: `${topic} (9:16 Story · Üstte Yazı Alanı Boş)`,
          category: "9:16 Story",
          prompt: `Şimdi üret: ${msg} — doğal sinematik ışıkta, üst kısımda yazı için temiz boş alan bırakarak 9:16 Instagram Story üret.`,
        },
        {
          title: `${topic} (4:5 Post Fotoğrafı + Brief)`,
          category: "4:5 Fotoğraf",
          prompt: `Şimdi üret: ${msg} — 4:5 Instagram gönderi formatında, doğal ve sıcak stüdyo ışığında yüksek çözünürlüklü fotoğraf ve Post Brief üret.`,
        },
        {
          title: `${topic} (9:16 Sesli Reels Videosu)`,
          category: "9:16 Sesli Video",
          prompt: `Şimdi üret: ${msg} — 9:16 dikey Reels formatında 5 saniyelik sinematik video ve üzerine Türkçe reklam seslendirmesi üret.`,
        },
        ...DEFAULT_PROMPT_IDEAS.slice(0, 3),
      ],
    };
  }

  // action === "generate" -> fal.ai / Cost-Aware Router gönderimi + kredi hesabı + Vision Fidelity Lock
  let activeModels = await prisma.modelRegistry.findMany({
    where: { status: "active", licenseStatus: "cleared", provider: "fal" },
    select: { key: true, kind: true, creditsPerUnit: true },
  });

  // Bağlı bir görsel varlık (product/character) varsa, bağlam kopmadan onun üzerinden düzenle/videoya çevir
  const boundUploadIds = [
    ...rawRefIds,
    ...(rawRefIds.length === 0 && costRoute.boundAsset ? [costRoute.boundAsset.upload_id] : []),
  ].slice(0, 4);
  const refs = boundUploadIds.filter(Boolean);
  const isFidelityEditOrI2v =
    refs.length > 0 && (costRoute.operation === "edit_image_kontext" || costRoute.operation === "image_to_video");

  const preferredKey = isFidelityEditOrI2v
    ? costRoute.modelKey
    : decision.storyPayload
      ? endpointToModelKey(decision.storyPayload.fal_payload.model_endpoint)
      : pickFalModelKey(activeModels, decision.kind, input.tier, decision.enhancedPrompt);

  if (!activeModels.some((m) => m.key === preferredKey)) {
    await seedModelRegistry().catch(() => undefined);
    activeModels = await prisma.modelRegistry.findMany({
      where: { status: "active", licenseStatus: "cleared", provider: "fal" },
      select: { key: true, kind: true, creditsPerUnit: true },
    });
  }

  const effectiveKind = costRoute.operation === "image_to_video" ? "video" : decision.kind;
  const modelKey = activeModels.some((m) => m.key === preferredKey)
    ? preferredKey
    : pickFalModelKey(activeModels, effectiveKind, input.tier, decision.enhancedPrompt);

  const catalogItem = FAL_ORCHESTRATOR_CATALOG.find((c) => c.key === modelKey);
  const selectedEndpoint =
    costRoute.operation === "edit_image_kontext" || costRoute.operation === "image_to_video"
      ? costRoute.endpoint
      : (decision.storyPayload?.fal_payload.model_endpoint ?? catalogItem?.endpoint ?? `fal-ai/${modelKey}`);

  const voiceScriptForVideo =
    effectiveKind === "video" && (wantsVoiceWithVideo || decision.voiceoverScript)
      ? decision.voiceoverScript || "Yeni sezon koleksiyonumuz şimdi yayında! Detaylar için hemen inceleyin."
      : undefined;

  const baseCleanPrompt =
    effectiveKind === "video" && costRoute.fidelityPrompt
      ? costRoute.fidelityPrompt
      : costRoute.fidelityPrompt ??
      (effectiveKind === "video"
        ? `${decision.enhancedPrompt || msg}. Clean composition, strictly no text overlays, no watermarks.`
        : decision.enhancedPrompt || msg);

  const orchestratorMeta: OrchestratorMeta = {
    status: "ready",
    missingSlots: [],
    endpoint: selectedEndpoint,
    unitCostLabel: catalogItem?.unitLabel ?? `$${costRoute.estimatedCostUsd.toFixed(3)}`,
    falPayload:
      decision.storyPayload?.fal_payload ??
      (effectiveKind === "video"
        ? { model_endpoint: selectedEndpoint, prompt: baseCleanPrompt, aspect_ratio: decision.format, duration: "5" }
        : effectiveKind === "audio"
          ? { model_endpoint: selectedEndpoint, text: decision.voiceoverScript || msg, language_code: "tr" }
          : { model_endpoint: selectedEndpoint, prompt: baseCleanPrompt, aspect_ratio: decision.format }),
    comboPreset: getComboPresetForTier(input.tier),
    operationType: costRoute.operation,
    zeroCreditEdit: false,
    boundAsset: toBoundSummary(costRoute.boundAsset),
    sfxTrack:
      effectiveKind === "video"
        ? costRoute.timeline.sfx_track.map((c) => ({ timestampMs: c.timestamp_ms, labelTr: c.label_tr, sfxKey: c.sfx_key }))
        : undefined,
    motionLayers:
      effectiveKind === "video"
        ? costRoute.timeline.motion_layers.map((m) => ({
          type: m.type,
          text: m.text,
          animation: m.animation,
          startMs: m.start_ms,
          endMs: m.end_ms,
        }))
        : undefined,
    preFlightSummary: costRoute.preFlightSummaryTr,
  };

  try {
    const rawPrompt = (effectiveKind === "audio" ? decision.voiceoverScript || msg : baseCleanPrompt).trim();
    const safePrompt = rawPrompt.length >= 5 ? rawPrompt : `${rawPrompt || msg} — profesyonel stüdyo ışığında sosyal medya içeriği`.trim();
    const job = await submitGeneration({
      tenantId,
      modelKey,
      prompt: safePrompt,
      aspect: decision.format as Aspect,
      referenceUploadIds: effectiveKind === "audio" ? [] : refs,
      voiceText: voiceScriptForVideo,
    });

    if ((process.env.FAL_MODE ?? "mock") === "mock" && job.requestId) {
      const payload =
        effectiveKind === "video"
          ? { video: { url: `studio://video/${job.requestId}` } }
          : effectiveKind === "audio"
            ? { audio: { url: `studio://audio/${job.requestId}` } }
            : { images: [{ url: `studio://image/${job.requestId}` }] };
      await handleFalWebhook({ request_id: job.requestId, status: "OK", payload, metrics: { inference_time: 1.0 } }).catch(() => undefined);
    }

    let finalAssetId =
      (await prisma.generatedAsset.findFirst({ where: { jobId: job.id }, select: { id: true } }))?.id ?? null;

    // Video senkron üretildiyse ve SFX / Motion Graphics katmanı planlandıysa 0 krediyle uygula
    if (
      finalAssetId &&
      effectiveKind === "video" &&
      (costRoute.timeline.sfx_track.length > 0 || costRoute.timeline.motion_layers.length > 0)
    ) {
      try {
        const decorated = await renderProgrammaticTimelineVideo({
          tenantId,
          sourceAssetOrUploadId: finalAssetId,
          timeline: costRoute.timeline,
          label: `${msg} (SFX + Motion)`,
        });
        finalAssetId = decorated.assetId;
      } catch {
        // SFX post-process başarısız olursa temiz baz AI video yine de kullanıcıya ulaşır
      }
    }

    if (finalAssetId && effectiveKind !== "audio") {
      session.current_canvas = {
        asset_id: finalAssetId,
        upload_id: refs[0] ?? null,
        kind: effectiveKind,
        version: session.current_canvas.version + 1,
        parent_asset_id: refs[0] ?? session.current_canvas.asset_id,
        last_prompt: msg,
      };
      session.timeline_plan = costRoute.timeline;
      if (effectiveKind === "image") {
        const outBound = await analyzeAssetWithVision({
          tenantId,
          assetOrUploadId: finalAssetId,
          contextHint: msg,
        }).catch(() => null);
        if (outBound && refs.length === 0) {
          session = bindAssetsToSession(session, [outBound]);
          orchestratorMeta.boundAsset = toBoundSummary(outBound);
        }
      }
      await saveCreativeSessionState(tenantId, session);
    }

    const acc = await prisma.creditAccount.findUnique({ where: { tenantId }, select: { balanceCredits: true, heldCredits: true } });
    const avail = acc ? Number(acc.balanceCredits) - Number(acc.heldCredits) : undefined;

    await audit.append({
      actor: toAuditActor(actor),
      action: "CREATIVE_DIRECTOR_SUBMITTED",
      entityType: "CreativeJob",
      entityId: job.id,
      data: {
        tenantId,
        modelKey: job.modelKey,
        endpoint: selectedEndpoint,
        tier: input.tier,
        format: decision.format,
        operation: costRoute.operation,
      },
    });
    revalidateAll();

    const out: CreativeDirectorResponse = {
      ok: true,
      action: "generate",
      reply: isFidelityEditOrI2v
        ? `Varlık Kilidi (Fidelity Lock) ile düzenlendi! ${decision.reply}`
        : decision.reply,
      postBrief: decision.postBrief || null,
      enhancedPrompt: baseCleanPrompt,
      voiceoverScript: voiceScriptForVideo ?? (effectiveKind === "audio" ? decision.voiceoverScript || msg : null),
      kind: effectiveKind,
      format: decision.format,
      modelKey: job.modelKey,
      jobId: finalAssetId ? null : job.id,
      assetId: finalAssetId,
      availableCredits: avail,
      orchestrator: orchestratorMeta,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
    await persistChatExchange(tenantId, msg, out);
    return out;
  } catch (e) {
    const avail = await getAvailableCredits(tenantId).catch(() => undefined);
    const msgErr = humanizeCreativeError(e);
    const note = e instanceof InsufficientCreditsError ? msgErr : `${msgErr} (Ücret alınmadı, bakiyeniz korundu.)`;
    const out: CreativeDirectorResponse = {
      ok: false,
      error: note,
      action: "ask",
      reply: "",
      availableCredits: avail,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
    await persistChatExchange(tenantId, msg, out);
    return out;
  }
}
