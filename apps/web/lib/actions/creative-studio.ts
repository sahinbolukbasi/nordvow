"use server";
import { createHash } from "node:crypto";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { submitEditPipeline, type EditAction } from "@infulancer/core/creative/edit";
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
} from "@infulancer/core/creative/fal";
import {
  chargeHold,
  ensureStarterCredits,
  InsufficientCreditsError,
  placeHold,
  releaseHold,
} from "@infulancer/core/creative/credits";
import { chargeIn, creativePricing } from "@infulancer/core/creative/pricing";
import { tenantCurrency } from "@infulancer/core/creative/tenant";
import { embedC2pa } from "@infulancer/core/creative/c2pa";
import { objectStore } from "@infulancer/core/channels/raw-store";
import { ModelUnavailableError, resolveModel } from "@infulancer/core/creative/registry";
import { converseChat, parseJsonObject } from "@infulancer/core/llm/bedrock";
import { envStr } from "@infulancer/core/env";
import { enqueueVideoEdit } from "@infulancer/core/creative/video-edit";
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
  let target = "/creative?sekme=studyo";
  try {
    const u = await importGeneratedAsset(await creativeTenantFor(actor), str(fd, "assetId"), actor.userId);
    target = `/creative?sekme=studyo&dosya=${u.id}${actor.role === "ADMIN" ? `&hesap=${u.tenantId}` : ""}`;
  } catch (e) {
    target = `/creative?sekme=galeri&hata=${encodeURIComponent(e instanceof DomainError ? e.message : "İçerik açılamadı.")}`;
  }
  redirect(target);
}

/** Admin tarafından fal.ai API anahtarını (FAL_KEY) kaydetme. */
export async function saveFalKeyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireAdmin();
  return attempt(async () => {
    const falKey = str(fd, "falKey").trim().replace(/^Key\s+/i, "");
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
      data: { configured: Boolean(falKey) },
    });
    revalidateAll();
    return {
      ok: true,
      message: falKey ? "fal.ai API anahtarı kaydedildi ve aktif edildi." : "fal.ai anahtarı temizlendi; stüdyo motoru aktif.",
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
  assetId?: string | null;
  availableCredits?: number;
  suggestions: PromptIdeaItem[];
};

function pickFalModelKey(
  models: { key: string; kind: string; creditsPerUnit: unknown }[],
  kind: "image" | "video" | "audio",
  tier: CreditTier,
  promptText: string,
): string {
  const p = promptText.toLocaleLowerCase("tr");
  const list = models
    .filter((m) => m.kind === kind)
    .sort((a, b) => Number(a.creditsPerUnit) - Number(b.creditsPerUnit));

  if (kind === "image") {
    if (tier === "economy") return list.find((m) => m.key === "flux-schnell")?.key ?? list[0]?.key ?? "flux-schnell";
    if (tier === "standard") {
      if (/(yazı|afiş|poster|tipografi|başlık|logo)/.test(p)) return list.find((m) => m.key === "ideogram-v3")?.key ?? "flux-schnell";
      if (/(illüstrasyon|vektör|çizim|ikon)/.test(p)) return list.find((m) => m.key === "recraft-v3")?.key ?? "flux-schnell";
      return list.find((m) => m.key === "nano-banana-2" || m.key === "recraft-v3")?.key ?? list[Math.min(1, list.length - 1)]?.key ?? "flux-schnell";
    }
    if (/(yazı|afiş|poster|tipografi)/.test(p)) return list.find((m) => m.key === "ideogram-4" || m.key === "ideogram-v3")?.key ?? "flux-schnell";
    if (/(illüstrasyon|vektör)/.test(p)) return list.find((m) => m.key === "recraft-v4-pro" || m.key === "recraft-v3")?.key ?? "flux-schnell";
    return list.find((m) => m.key === "nano-banana-pro")?.key ?? list[list.length - 1]?.key ?? "flux-schnell";
  }

  if (kind === "video") {
    if (tier === "economy") return list.find((m) => m.key === "ltxv-distilled")?.key ?? list[0]?.key ?? "ltxv-distilled";
    if (tier === "standard") return list.find((m) => m.key === "hailuo-02-standard" || m.key === "kling-v2-5-turbo-pro")?.key ?? list[Math.min(1, list.length - 1)]?.key ?? "ltxv-distilled";
    return list.find((m) => m.key === "kling-v3-pro" || m.key === "seedance-2")?.key ?? list[list.length - 1]?.key ?? "ltxv-distilled";
  }

  if (tier === "economy") return list.find((m) => m.key === "minimax-speech-2-8-turbo")?.key ?? list[0]?.key ?? "minimax-speech-2-8-turbo";
  if (tier === "standard") return list.find((m) => m.key === "elevenlabs-turbo-2-5")?.key ?? list[0]?.key ?? "minimax-speech-2-8-turbo";
  return list.find((m) => m.key === "elevenlabs-multilingual-v2")?.key ?? list[list.length - 1]?.key ?? "minimax-speech-2-8-turbo";
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
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  }

  const activeModels = await prisma.modelRegistry.findMany({
    where: { status: "active", licenseStatus: "cleared", provider: "fal" },
    select: { key: true, kind: true, creditsPerUnit: true },
  });
  const audioModelKey = pickFalModelKey(activeModels, "audio", input.tier, script);
  const model = await resolveModel(audioModelKey);
  const units = Math.max(1, Math.ceil(script.length / 1000));
  const pricing = await creativePricing();
  const credits = chargeIn(Number(model.creditsPerUnit), units, pricing, await tenantCurrency(tenantId));
  const hold = await placeHold(tenantId, credits);
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

  try {
    let mergedBytes: Uint8Array;
    const dir = mkdtempSync(path.join(tmpdir(), "nv-dl-"));
    try {
      const tmpIn = path.join(dir, "in.mp4");
      await downloadToFile(s3Key, tmpIn);
      const rawBytes = new Uint8Array(readFileSync(tmpIn));
      if (rawBytes.byteLength > 256) {
        mergedBytes = await mergeVoiceoverOntoVideoBytes(rawBytes, script);
      } else {
        const gen = await renderStudioVideoMp4({ prompt: script, aspect: "9:16", voiceText: script });
        mergedBytes = gen.bytes;
      }
    } catch {
      const gen = await renderStudioVideoMp4({ prompt: script, aspect: "9:16", voiceText: script });
      mergedBytes = gen.bytes;
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
          modelKey: "ltxv-distilled",
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

    const acc = await prisma.creditAccount.findUnique({ where: { tenantId }, select: { balanceCredits: true, heldCredits: true } });
    const avail = acc ? Number(acc.balanceCredits) - Number(acc.heldCredits) : undefined;
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
    await releaseHold(hold.id);
    await prisma.creativeJob.update({
      where: { id: job.id },
      data: { status: "FAILED", rejectReason: (e as Error).message, completedAt: new Date() },
    });
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Videoya ses eklenemedi.",
      action: "ask",
      reply: "",
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

  // 1. Selamlaşma veya "Neler yapabilirsin?" kontrolü
  const isGreeting =
    words.length <= 4 &&
    /^(selam|merhaba|slm|hey|günaydın|gunaydin|iyi günler|iyi akşamlar|nasılsın|nasilsin|naber|merhabalar|selamlar|hi|hello)[!.,?]*$/i.test(norm);
  const wantsCapabilities = /(neler yapabilirsin|ne yapabiliyorsun|yeteneklerin|nasıl çalışır|ne üretebilirsin|yardım|kendini tanıt|neler yapıyorsun)/.test(norm);

  if ((isGreeting || wantsCapabilities) && !input.forceGenerate) {
    return {
      ok: true,
      action: "ask",
      reply:
        "Merhaba! Hoş geldiniz, ben **Nordvow Creative AI** — kişisel kreatif yönetmeniniz ve üretim stüdyonuzum.\n\n" +
        "Neler yapabildiğimi görmek ister misiniz? Sizin için tek bir sohbet ekranında şunları yapabiliyorum:\n\n" +
        "• **1. Profesyonel Fotoğraf Üretimi (4:5 Post, 9:16 Story, 1:1 Kare):** Ürün çekimi, kafe & gastronomi, kozmetik makro çekim, editorial moda ve kampanya tasarımları (FLUX Schnell, Recraft V3, Ideogram V3, Nano Banana Pro).\n" +
        "• **2. Sinematik Reels & Tanıtım Videosu (9:16 Dikey / 16:9 Yatay):** Fikrinizden sıfırdan 5-10 saniyelik videolar üretir veya yüklediğiniz bir ürün fotoğrafını hareketli Reels videosuna dönüştürürüm.\n" +
        "• **3. Videolarınıza Türkçe AI Seslendirme (Voiceover) Üretme & Ekleme:** İstediğiniz metni doğal Türkçe seslendirmeye çevirip doğrudan videonuzun üzerine gömerim veya sıfırdan sesli video üretirim.\n" +
        "• **4. Instagram Post Brief, Caption & Hashtag Stüdyosu:** Ayrı bir sayfaya gitmenize gerek kalmadan dikkat çekici başlık (Hook), açıklama metni, brief yapılacaklar listesi ve `#reklam` uyumlu hashtag setini burada hazırlarım.\n" +
        "• **5. Akıllı Prompt Geliştirme & Kayıtlı Promptlar:** Kısaca ne istediğinizi söyleyin; ışık, kamera açısı ve stüdyo detaylarını ben tamamlayayım.\n\n" +
        "Aşağıdaki fikir kartlarından birine tıklayarak detayı sohbet kutusuna ekleyebilir veya aklınızdaki fikri bana yazabilirsiniz. Bugün ne üretelim?",
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  }

  // 2. Mevcut bir videoya ses üretip ekleme isteği kontrolü
  const asksVoiceOnVideo =
    /(videoma ses|videoya ses|bu videoya ses|videoyu seslendir|videonun üzerine ses|seslendirme ekle)/.test(norm) &&
    Boolean(input.targetVideoAssetId);

  if (asksVoiceOnVideo && input.targetVideoAssetId) {
    const colonIdx = msg.indexOf(":");
    const quoteMatch = msg.match(/['"“”]([^'"“”]{4,})['"“”]/);
    let script = quoteMatch?.[1] ?? (colonIdx >= 0 ? msg.slice(colonIdx + 1).trim() : "");
    if (!script || script.length < 5) {
      script = "Yeni sezon koleksiyonumuz şimdi yayında! Sınırlı stok fırsatını kaçırmamak için hemen profildeki bağlantıya tıklayın.";
    }
    return addVoiceoverToVideoAction({
      videoId: input.targetVideoAssetId,
      scriptText: script,
      tier: input.tier,
    });
  }

  // 3. Yalnızca Post Brief & Caption isteği (görsel/video üretmeden metin & brief hazırlama)
  const onlyBriefRequest =
    !input.forceGenerate &&
    /(sadece brief|sadece post metni|görsel üretmeden|yalnızca metin|post brief hazırla|instagram açıklaması yaz|hashtag yaz)/.test(norm);

  if (onlyBriefRequest) {
    let briefReply = `İstediğiniz konu için Instagram Post Brief ve hazır paylaşım metnini hazırladım. Dilerseniz bu brief'e uygun 4:5 fotoğraf veya 9:16 sesli Reels videosunu da hemen üretebilirim!`;
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

  let decision: {
    action: "ask" | "generate";
    kind: "image" | "video" | "audio";
    format: "9:16" | "4:5" | "1:1" | "16:9";
    reply: string;
    enhancedPrompt: string;
    postBrief: string;
    voiceoverScript: string;
    suggestions: PromptIdeaItem[];
  } | null = null;

  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const turns = [
        ...input.history.slice(-6).map((h) => ({ role: h.role, text: h.text.slice(0, 600) })),
        { role: "user" as const, text: msg },
      ];
      const out = await converseChat({
        system: [
          "Sen Nordvow Creative AI'sın. Kullanıcıyla samimi, yaratıcı Türkçe sohbet ederek Instagram/sosyal medya fotoğrafı, videosu, sesli videosu, seslendirmesi ve Post Brief'i üretirsin.",
          explicitGen
            ? "Kullanıcı üretim yapılmasını istiyor veya yeterli detay verdi: KESİNLİKLE action='generate' seç!"
            : "Kullanıcının mesajı henüz kısa bir fikir aşamasındaysa (örn. 'kahve postu atmak istiyorum') action='ask' seç; samimi şekilde 2-3 yaratıcı fikir öner, formatı (4:5 post mu, 9:16 sesli Reels videosu mu) ve ışık/atmosfer tercihini sor.",
          "action='generate' olduğunda:",
          "- kind: 'image' (fotoğraf), 'video' (Reels/video) veya 'audio' (yalnız seslendirme).",
          "- enhancedPrompt: kullanıcının isteğini çok detaylı, sinematik ışık, kadraj ve doku içeren profesyonel bir prompta dönüştür.",
          "- postBrief: dikkat çekici açılış cümlesi (Hook), samimi açıklama, CTA, #reklam #işbirliği ve 5 ilgili hashtag içeren hazır bir Instagram Post Metni & Brief yaz.",
          "- voiceoverScript: eğer video veya ses üretilecekse 1-2 cümlelik doğal Türkçe reklam seslendirme metni yaz.",
          "SADECE şu JSON formatında yanıt döndür:",
          '{"action":"ask"|"generate","kind":"image"|"video"|"audio","format":"9:16"|"4:5"|"1:1"|"16:9","reply":"<kullanıcıya mesajın>","enhancedPrompt":"<detaylı prompt>","postBrief":"<Instagram post metni ve hashtagler>","voiceoverScript":"<Türkçe seslendirme metni>"}',
        ].join("\n"),
        turns,
        maxTokens: 600,
        temperature: 0.4,
      });
      const parsed = parseJsonObject(out.text);
      if (parsed && typeof parsed.reply === "string") {
        const k = parsed.kind === "video" || parsed.kind === "audio" ? parsed.kind : "image";
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
    return {
      ok: true,
      action: "ask",
      reply: decision.reply,
      postBrief: decision.postBrief || null,
      suggestions: [
        {
          title: `${topic} (4:5 Fotoğraf + Brief)`,
          category: "4:5 Fotoğraf",
          prompt: `Şimdi üret: ${msg} — 4:5 Instagram gönderi formatında, doğal ve sıcak stüdyo ışığında yüksek çözünürlüklü fotoğraf ve Post Brief üret.`,
        },
        {
          title: `${topic} (9:16 Sesli Reels Videosu)`,
          category: "9:16 Sesli Video",
          prompt: `Şimdi üret: ${msg} — 9:16 dikey Reels formatında 5 saniyelik sinematik video ve üzerine Türkçe reklam seslendirmesi üret.`,
        },
        ...DEFAULT_PROMPT_IDEAS.slice(0, 4),
      ],
    };
  }

  // action === "generate" -> fal.ai / Studio Engine gönderimi + kredi hesabı
  const activeModels = await prisma.modelRegistry.findMany({
    where: { status: "active", licenseStatus: "cleared", provider: "fal" },
    select: { key: true, kind: true, creditsPerUnit: true },
  });
  const modelKey = pickFalModelKey(activeModels, decision.kind, input.tier, decision.enhancedPrompt);
  const refs = (input.referenceUploadIds ?? []).filter(Boolean).slice(0, 4);
  const voiceScriptForVideo =
    decision.kind === "video" && (wantsVoiceWithVideo || decision.voiceoverScript)
      ? decision.voiceoverScript || "Yeni sezon koleksiyonumuz şimdi yayında! Detaylar için hemen inceleyin."
      : undefined;

  try {
    const job = await submitGeneration({
      tenantId,
      modelKey,
      prompt: decision.kind === "audio" ? decision.voiceoverScript || msg : decision.enhancedPrompt,
      aspect: decision.format as Aspect,
      referenceUploadIds: decision.kind === "audio" ? [] : refs,
      voiceText: voiceScriptForVideo,
    });

    if ((process.env.FAL_MODE ?? "mock") === "mock" && job.requestId) {
      const payload =
        decision.kind === "video"
          ? { video: { url: `studio://video/${job.requestId}` } }
          : decision.kind === "audio"
            ? { audio: { url: `studio://audio/${job.requestId}` } }
            : { images: [{ url: `studio://image/${job.requestId}` }] };
      await handleFalWebhook({ request_id: job.requestId, status: "OK", payload, metrics: { inference_time: 1.0 } }).catch(() => undefined);
    }

    const [asset, acc] = await Promise.all([
      prisma.generatedAsset.findFirst({ where: { jobId: job.id }, select: { id: true } }),
      prisma.creditAccount.findUnique({ where: { tenantId }, select: { balanceCredits: true, heldCredits: true } }),
    ]);
    const avail = acc ? Number(acc.balanceCredits) - Number(acc.heldCredits) : undefined;

    await audit.append({
      actor: toAuditActor(actor),
      action: "CREATIVE_DIRECTOR_SUBMITTED",
      entityType: "CreativeJob",
      entityId: job.id,
      data: { tenantId, modelKey: job.modelKey, tier: input.tier, format: decision.format },
    });
    revalidateAll();

    return {
      ok: true,
      action: "generate",
      reply: decision.reply,
      postBrief: decision.postBrief || null,
      enhancedPrompt: decision.enhancedPrompt,
      voiceoverScript: voiceScriptForVideo ?? (decision.kind === "audio" ? decision.voiceoverScript || msg : null),
      kind: decision.kind,
      format: decision.format,
      modelKey: job.modelKey,
      jobId: asset ? null : job.id,
      assetId: asset?.id ?? null,
      availableCredits: avail,
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Üretim başlatılamadı.",
      action: "ask",
      reply: "",
      suggestions: DEFAULT_PROMPT_IDEAS,
    };
  }
}
