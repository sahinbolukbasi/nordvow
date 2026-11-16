"use server";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { submitEditPipeline, type EditAction } from "@infulancer/core/creative/edit";
import { submitGeneration } from "@infulancer/core/creative/generate";
import type { Aspect } from "@infulancer/core/creative/adapters";
import { planVideoEditFromBrief } from "@infulancer/core/creative/video-brief";
import { handleFalWebhook, CreativeRejectedError } from "@infulancer/core/creative/fal";
import { ensureStarterCredits, InsufficientCreditsError } from "@infulancer/core/creative/credits";
import { ModelUnavailableError } from "@infulancer/core/creative/registry";
import { converseChat, parseJsonObject } from "@infulancer/core/llm/bedrock";
import { envStr } from "@infulancer/core/env";
import { enqueueVideoEdit } from "@infulancer/core/creative/video-edit";
import { getOwnedUpload, importGeneratedAsset } from "@infulancer/core/creative/uploads";
import { redirect } from "next/navigation";
import { deleteObject } from "@infulancer/core/storage/s3";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { attempt, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";
import { creativeTenantFor, ownTenantOrNull } from "@/lib/creative-tenant";

/**
 * Yüklenen görsel üzerinde ücretli AI düzenlemesi. Birden çok düzenleme seçilebilir (actions[]);
 * adımlar sırayla zincirlenir ve her adım kendi tutarını öder. İlk işin kimliği data.jobId ile döner
 * (ilerleme ekranı bunu izler).
 */
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
      // Demo (mock) modunda fal webhook'u beklenmeden sonuç simüle edilir (zincir de devam eder).
      if ((process.env.FAL_MODE ?? "mock") === "mock" && job.requestId) {
        const video = job.modelKey.includes("i2v");
        await handleFalWebhook({ request_id: job.requestId, status: "OK", payload: video ? { video: { url: "https://example.invalid/mock.mp4" } } : { image: { url: "https://example.invalid/mock.png" } } });
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
/**
 * Brief ile AI video düzenleme: yazılan istek düzenleme adımlarına çevrilir (metin modeli; yoksa kural
 * çözümleyici) ve ffmpeg kuyruğuna alınır. Ücretsizdir (fal kullanılmaz).
 */
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
/** Video düzenlemeyi kuyruğa alır (ffmpeg, ücretsiz). İş kimliği data.jobId ile döner. */
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

/** Kitaplıktan dosya siler (S3 nesnesi dahil). */
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

/** AI ile üretilen fotoğraf veya videoyu kullanıcı kitaplığına (creative_uploads) kaydeder. */
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

/** Galerideki AI çıktısını stüdyoya kopyalayıp düzenleyicide açar. */
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

export type CreditTier = "economy" | "standard" | "pro";

export type CreativeDirectorResponse = {
  ok: boolean;
  error?: string;
  action: "ask" | "generate";
  reply: string;
  postBrief?: string | null;
  enhancedPrompt?: string | null;
  kind?: "image" | "video" | "audio";
  format?: "9:16" | "4:5" | "1:1" | "16:9";
  modelKey?: string;
  jobId?: string | null;
  assetId?: string | null;
  availableCredits?: number;
  suggestions: string[];
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

/**
 * Bedrock destekli Sohbet Creative Yönetmeni:
 * - Kullanıcının isteğini dinler, gerekiyorsa 1-2 netleştirici soru ve hazır tıklanabilir öneriler sunar.
 * - Üretim aşamasında prompt'u Bedrock ile zenginleştirir, Instagram Post Brief & Caption yazar,
 *   seçili kredi paketine (Uygun / Dengeli / Yüksek Kalite) uygun fal.ai modeline gönderir ve krediyi düşer.
 */
export async function chatCreativeDirectorAction(input: {
  message: string;
  history: { role: "user" | "assistant"; text: string }[];
  tier: CreditTier;
  referenceUploadIds?: string[];
  forceGenerate?: boolean;
}): Promise<CreativeDirectorResponse> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const tenantId = await creativeTenantFor(actor);
  if (actor.role !== "ADMIN") await ensureStarterCredits(tenantId);

  const msg = input.message.trim();
  if (!msg) return { ok: false, error: "Lütfen bir mesaj yazın.", action: "ask", reply: "", suggestions: [] };

  const norm = msg.toLocaleLowerCase("tr");
  const wantsCapabilities = /(neler yapabilirsin|yeteneklerin|nasil calisir|ne uretebilirsin|yardim)/.test(norm);
  if (wantsCapabilities && !input.forceGenerate) {
    return {
      ok: true,
      action: "ask",
      reply:
        "Sizinle sohbet ederek 3 farklı üretim yapabilirim:\n" +
        "1. Instagram Post & Story Fotoğrafı (FLUX Schnell, Ideogram, Recraft, Nano Banana)\n" +
        "2. 9:16 Dikey Reels / TikTok Videosu (LTX Video, Hailuo, Kling)\n" +
        "3. Türkçe Doğal Seslendirme (MiniMax, ElevenLabs)\n\n" +
        "Ayrıca her üretimde prompt'unuzu profesyonel stüdyo diline çevirip altına hazır Instagram Post Metni (Caption & Hashtag) yazarım. Hangisiyle başlayalım?",
      suggestions: [
        "Instagram için 4:5 ürün tanıtım fotoğrafı üret",
        "9:16 dikey Story / Reels fotoğrafı oluştur",
        "5 saniyelik sinematik Reels videosu üret",
        "Kampanya için enerjik seslendirme oluştur",
      ],
    };
  }

  const explicitGen =
    input.forceGenerate ||
    /(şimdi üret|simdi uret|hemen üret|evet üret|bu şekilde üret|üret:|oluştur:|fotograf uret|fotoğraf üret|resim üret|video üret|ses üret)/.test(norm) ||
    input.history.filter((h) => h.role === "user").length >= 1;

  let decision: {
    action: "ask" | "generate";
    kind: "image" | "video" | "audio";
    format: "9:16" | "4:5" | "1:1" | "16:9";
    reply: string;
    enhancedPrompt: string;
    postBrief: string;
    suggestions: string[];
  } | null = null;

  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const turns = [
        ...input.history.slice(-8).map((h) => ({ role: h.role, text: h.text.slice(0, 600) })),
        { role: "user" as const, text: msg },
      ];
      const out = await converseChat({
        system: [
          "Sen Nordvow Creative AI Yönetmenisin. Kullanıcıyla samimi, kısa Türkçe sohbet ederek Instagram/sosyal medya fotoğrafı, videosu veya seslendirmesi üretirsin.",
          explicitGen
            ? "Kullanıcı üretim yapılmasını istiyor veya yeterli bilgi verdi: KESİNLİKLE action='generate' seç!"
            : "Eğer kullanıcının ilk mesajı çok genel bir fikir ise (örn. 'Instagrama post atmak istiyorum') ve henüz detay vermediyse action='ask' seçip gönderinin en iyi olması için 1-2 kısa soru sor (format 4:5 post mu 9:16 story mi, atmosfer/ışık nasıl olsun) ve öneri ver. Eğer doğrudan ne üretileceğini söylediyse action='generate' seç.",
          "action='generate' olduğunda:",
          "- enhancedPrompt: kullanıcının isteğini fal.ai FLUX Schnell / video modeli için çok detaylı, sinematik ışık, kadraj ve doku içeren profesyonel bir görsel/video promptuna dönüştür.",
          "- postBrief: bu içerik için dikkat çekici başlangıç cümlesi, samimi açıklama, #reklam #işbirliği etiketi ve 5 ilgili hashtag içeren hazır bir Instagram Post Metni yaz.",
          "SADECE şu JSON formatında yanıt döndür (başka metin yazma):",
          '{"action":"ask"|"generate","kind":"image"|"video"|"audio","format":"9:16"|"4:5"|"1:1"|"16:9","reply":"<kullanıcıya mesajın>","enhancedPrompt":"<geliştirilmiş fal.ai promptu>","postBrief":"<Instagram post metni ve hashtagler>","suggestions":["<öneri 1>","<öneri 2>","<öneri 3>"]}',
        ].join("\n"),
        turns,
        maxTokens: 550,
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
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String).slice(0, 4) : [],
        };
      }
    } catch (e) {
      console.warn("[creative-director] Bedrock fallback:", (e as Error).message);
    }
  }

  if (!decision) {
    const isVideo = /(video|reels|hareketli|klip)/.test(norm);
    const isAudio = /(ses|seslendir|konusma|anons|spot)/.test(norm);
    const kind = isVideo ? "video" : isAudio ? "audio" : "image";
    const format = norm.includes("4:5") || norm.includes("post") ? "4:5" : norm.includes("1:1") || norm.includes("kare") ? "1:1" : norm.includes("16:9") ? "16:9" : "9:16";

    if (!explicitGen && msg.split(/\s+/).length <= 5) {
      return {
        ok: true,
        action: "ask",
        reply: `Harika fikir! "${msg}" için nasıl bir atmosfer ve format tercih edersiniz? İsterseniz doğal sabah ışığında 4:5 Instagram gönderisi veya dinamik 9:16 Story / Reels olarak hemen hazırlayabilirim.`,
        suggestions: [
          `Şimdi üret: ${msg}, doğal ışıkta 4:5 Instagram postu`,
          `Şimdi üret: ${msg}, 9:16 dikey Story / Reels tasarım`,
          `Şimdi üret: ${msg}, minimal stüdyo çekimi`,
          `Videoya çevirerek 9:16 Reels üret: ${msg}`,
        ],
      };
    }

    decision = {
      action: "generate",
      kind,
      format,
      reply: "İsteğinizi Bedrock ile zenginleştirip Instagram Post Brief'inizi hazırladım ve fal.ai üretimine gönderdim.",
      enhancedPrompt: `${msg}, profesyonel stüdyo aydınlatması, yüksek detay, keskin netlik, modern sosyal medya estetiği, ${format} kadraj`,
      postBrief: `✨ ${msg}\n\nYeni sezonun en özel detaylarını keşfetmeye hazır mısınız? Yorumlarda buluşalım!\n\n#reklam #işbirliği #nordvow #yeni #kesfet`,
      suggestions: [
        "9:16 Story formatına uyarla",
        "4:5 Instagram Post formatına uyarla",
        "Bu görseli 5 sn Reels videosuna çevir",
      ],
    };
  }

  if (decision.action === "ask") {
    const baseTopic = msg.slice(0, 60);
    const suggestions = decision.suggestions.length
      ? decision.suggestions
      : [
          `Şimdi üret: ${baseTopic} (4:5 Instagram Post)`,
          `Şimdi üret: ${baseTopic} (9:16 Story / Reels)`,
          `Şimdi üret: ${baseTopic} (Sinematik stüdyo ışığı)`,
        ];
    return {
      ok: true,
      action: "ask",
      reply: decision.reply,
      suggestions,
    };
  }

  // action === "generate" -> fal.ai gönderimi + kredi hesabı
  const activeModels = await prisma.modelRegistry.findMany({
    where: { status: "active", licenseStatus: "cleared", provider: "fal" },
    select: { key: true, kind: true, creditsPerUnit: true },
  });
  const modelKey = pickFalModelKey(activeModels, decision.kind, input.tier, decision.enhancedPrompt);
  const refs = (input.referenceUploadIds ?? []).filter(Boolean).slice(0, 4);

  try {
    const job = await submitGeneration({
      tenantId,
      modelKey,
      prompt: decision.enhancedPrompt,
      aspect: decision.format as Aspect,
      seconds: decision.kind === "video" ? 5 : undefined,
      referenceUploadIds: refs,
    });

    if ((process.env.FAL_MODE ?? "mock") === "mock" && job.requestId) {
      const payload =
        decision.kind === "video"
          ? { video: { url: "https://example.invalid/mock.mp4" } }
          : decision.kind === "audio"
            ? { audio: { url: "https://example.invalid/mock.mp3" } }
            : { images: [{ url: "https://example.invalid/mock.png" }] };
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
      kind: decision.kind,
      format: decision.format,
      modelKey: job.modelKey,
      jobId: asset ? null : job.id,
      assetId: asset?.id ?? null,
      availableCredits: avail,
      suggestions: decision.suggestions.length
        ? decision.suggestions
        : [
            "9:16 Story formatına uyarla",
            "4:5 Instagram Post formatına uyarla",
            "Bu sahneyi 5 sn Reels videosuna çevir",
          ],
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Üretim başlatılamadı.",
      action: "ask",
      reply: "",
      suggestions: [],
    };
  }
}
