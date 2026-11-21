import { envStr } from "../../env";
import { converseStructured } from "../../llm/bedrock";
import { planFromKeywords } from "../video-brief";
import { editPlanSchema, type EditPlan } from "./schemas";

function fallbackEditPlan(command: string, durationSec: number | null): EditPlan {
  const kw = planFromKeywords(command, durationSec);
  const t = command.toLocaleLowerCase("tr");
  const isViralReel = /reels|tiktok|shorts|viral|sosyal medya|dinamik|akıcı/.test(t);
  const hasMusic = /müzik|enerjik|ritim|beat|şarkı|fon|lo-fi|lofi|sinematik/.test(t) || isViralReel;
  const hasSub = /altyazı|alt yazı|caption|yazı|metin/.test(t) || isViralReel;
  const hasSilenceCut = /sessiz|boşluk|kes|temizle|akıcı|hızlı kurgu|tempo/.test(t) || isViralReel;
  const hasHook = /kanca|hook|başlık|kapak yazısı/.test(t) || isViralReel;
  const hasCinematic = /sinematik|film|dramatik|lüks|premium/.test(t);
  const hasRegen = /yeniden üret|sahne.*değiştir|b-roll|broll|giriş sahnesi|kapanış sahnesi|ai sahne/.test(t);
  const isOutro = /kapanış|sona|outro|bitiş/.test(t);

  const colorLook = hasCinematic ? "sinematik" : kw.ops.look === "orijinal" && isViralReel ? "canli" : kw.ops.look;
  const aspect =
    kw.ops.aspect !== "orijinal"
      ? kw.ops.aspect === "4:5"
        ? "9:16"
        : kw.ops.aspect
      : isViralReel
        ? "9:16"
        : "orijinal";

  const wantsExplicitMute = /sesi\s*kapat|sessize\s*al|sesi\s*sil|orijinal\s*sesi\s*kaldır|mute/.test(t);
  const muteOriginal = wantsExplicitMute || (kw.ops.mute && !hasSilenceCut);

  const summary: string[] = kw.summary.filter(
    (s) => !s.startsWith("Değişiklik bulunamadı") && (muteOriginal || s !== "Ses kapalı"),
  );
  if (hasSilenceCut) summary.push("Sessiz boşlukları otomatik kes ve kurguyu akıcılaştır");
  if (hasSub) summary.push("fal.ai Wizper + Bedrock ile otomatik Türkçe altyazı ekle");
  if (hasHook) summary.push("Açılışa dikkat çekici kanca başlığı yerleştir");
  if (hasCinematic) summary.push("Sinematik renk düzenlemesi uygula");
  if (hasMusic) summary.push("fal.ai ile uygun arka plan fon müziği üret ve ses dengesini kur");
  if (hasRegen) summary.push(`fal.ai ile AI B-roll ${isOutro ? "kapanış" : "giriş"} sahnesi üret ve birleştir`);
  if (summary.length === 0) summary.push("Ham videoyu prompta göre renk, ses ve kurgu açısından iyileştir");

  return editPlanSchema.parse({
    summary: [...new Set(summary)].slice(0, 8),
    trim:
      kw.ops.trimStart > 0 || kw.ops.trimEnd != null
        ? { startSec: kw.ops.trimStart, endSec: kw.ops.trimEnd, targetDurationSec: kw.ops.trimEnd }
        : undefined,
    removeSilences: hasSilenceCut ? { enabled: true, thresholdDb: -35, minSilenceSec: 0.45 } : undefined,
    speed: kw.ops.speed,
    aspect,
    colorLook,
    transition: kw.ops.fade || hasCinematic ? "fade" : "cut",
    autoTranscribe: hasSub,
    subtitleStyle: isViralReel ? "bold-yellow" : "classic",
    hookTitle: hasHook
      ? {
          enabled: true,
          text: command.length <= 52 ? command : "Bunu Mutlaka İzle",
          durationSec: 3,
          position: "top",
        }
      : undefined,
    subtitles: hasSub ? { enabled: true, lines: [] } : undefined,
    audioMix:
      hasMusic || muteOriginal
        ? {
            muteOriginal,
            musicPrompt: hasMusic
              ? hasCinematic
                ? "cinematic modern ambient emotional background music"
                : "energetic upbeat modern social media reel background music"
              : null,
            voiceoverText: null,
            musicVolume: muteOriginal ? 0.38 : 0.2,
            normalizeAudio: true,
          }
        : { muteOriginal: false, musicPrompt: null, voiceoverText: null, musicVolume: 0.2, normalizeAudio: true },
    regenerateScene: hasRegen
      ? {
          enabled: true,
          sceneIndex: 0,
          prompt: `Cinematic high quality b-roll footage matching: ${command.slice(0, 260)}`,
          durationSec: 5,
          insertAtSec: 0,
          position: isOutro ? "outro" : "intro",
        }
      : undefined,
  });
}

/**
 * Kullanıcının doğal dildeki video edit komutunu AWS Bedrock (Claude) üzerinden
 * Zod şemalı `EditPlan` JSON'una çevirir. Geçersiz çıktıda tekrar ister; olmazsa kural tabanlı yedek döner.
 */
export async function planAiVideoEdit(input: {
  command: string;
  videoDurationSec: number | null;
  hasAudio?: boolean;
  silenceCount?: number;
  silenceTotalSec?: number;
}): Promise<{ plan: EditPlan; source: "bedrock" | "fallback"; model: string }> {
  const fb = fallbackEditPlan(input.command, input.videoDurationSec);
  if (envStr("LLM_PROVIDER", "mock") !== "bedrock") {
    return { plan: fb, source: "fallback", model: "rules-fallback" };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "speed", "aspect", "colorLook", "transition", "autoTranscribe", "subtitleStyle"],
    properties: {
      summary: { type: "array", items: { type: "string" } },
      trim: {
        type: "object",
        additionalProperties: false,
        properties: {
          startSec: { type: "number" },
          endSec: { type: ["number", "null"] },
          targetDurationSec: { type: ["number", "null"] },
        },
      },
      removeSilences: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          thresholdDb: { type: "number" },
          minSilenceSec: { type: "number" },
        },
      },
      speed: { type: "number" },
      aspect: { type: "string", enum: ["orijinal", "9:16", "1:1", "16:9"] },
      colorLook: { type: "string", enum: ["orijinal", "canli", "sinematik", "siyah-beyaz", "sicak", "soguk"] },
      transition: { type: "string", enum: ["cut", "fade", "wipeleft", "slideleft", "dissolve"] },
      autoTranscribe: { type: "boolean" },
      subtitleStyle: { type: "string", enum: ["classic", "bold-yellow", "box"] },
      hookTitle: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          text: { type: "string" },
          durationSec: { type: "number" },
          position: { type: "string", enum: ["top", "center"] },
        },
      },
      subtitles: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["startSec", "endSec", "text"],
              properties: {
                startSec: { type: "number" },
                endSec: { type: "number" },
                text: { type: "string" },
              },
            },
          },
        },
      },
      audioMix: {
        type: "object",
        additionalProperties: false,
        properties: {
          muteOriginal: { type: "boolean" },
          musicPrompt: { type: ["string", "null"] },
          voiceoverText: { type: ["string", "null"] },
          musicVolume: { type: "number" },
          normalizeAudio: { type: "boolean" },
        },
      },
      regenerateScene: {
        type: "object",
        additionalProperties: false,
        properties: {
          enabled: { type: "boolean" },
          sceneIndex: { type: "integer" },
          prompt: { type: "string" },
          durationSec: { type: "integer" },
          insertAtSec: { type: "number" },
          position: { type: "string", enum: ["intro", "outro"] },
        },
      },
    },
  };

  const systemPrompt = [
    "Sen uzman bir sosyal medya ve reklam video yönetmeni / kurgu planlayıcısısın.",
    "Kullanıcı sana ham bir video ve Türkçe bir düzenleme prompt'u veriyor. Görevin, ham videoyu en profesyonel hale getirecek EditPlan JSON'unu üretmek.",
    "Kurallar:",
    "1) summary alanında uygulanacak adımları kısa, anlaşılır Türkçe maddelerle yaz.",
    "2) Kullanıcı altyazı, Reels, TikTok, Shorts veya viral kurgu isterse autoTranscribe=true ve subtitles.enabled=true yap (subtitles.lines boş bırakılabilir, fal.ai Wizper konuşmayı otomatik çözecektir). Özel bir metin yazılmasını isterse lines içine ekle.",
    "3) Kullanıcı boşluk/sessizlik kesme, akıcı/hızlı kurgu veya Reels isterse removeSilences.enabled=true yap.",
    "4) Kullanıcı dikkat çekici açılış, kanca/hook veya Reels isterse hookTitle.enabled=true yap ve 3-6 kelimelik vurucu Türkçe başlık yaz.",
    "5) Fon müziği istenirse audioMix.musicPrompt alanına İngilizce detaylı enstrümantal müzik tarifi yaz. Konuşmalı videoda muteOriginal=false ve musicVolume=0.18-0.24 tut ki konuşma net duyulsun.",
    "6) Kullanıcı yeni sahne, B-roll, AI giriş/kapanış sahnesi isterse regenerateScene.enabled=true yap, İngilizce sinematik video prompt'u yaz ve position ('intro' veya 'outro') belirle.",
    "7) Renk tonu için uygun colorLook seç ('canli', 'sinematik', 'sicak', 'soguk', 'siyah-beyaz', 'orijinal').",
  ].join("\n");

  const metaParts = [
    `Kaynak video süresi: ${input.videoDurationSec != null ? `${input.videoDurationSec.toFixed(1)} sn` : "bilinmiyor"}`,
    `Ses kanalı: ${input.hasAudio === false ? "yok" : "var"}`,
    input.silenceCount != null
      ? `Tespit edilen sessiz boşluk: ${input.silenceCount} adet (toplam ${(input.silenceTotalSec ?? 0).toFixed(1)} sn)`
      : null,
  ].filter(Boolean);

  let extraNote = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await converseStructured<Record<string, unknown>>({
        system: systemPrompt,
        turns: [
          {
            role: "user",
            text: `${metaParts.join(" · ")}\nKullanıcı prompt'u: ${input.command}${extraNote ? `\nDüzeltme: ${extraNote}` : ""}`,
          },
        ],
        schemaName: "video_edit_plan",
        schema,
        maxTokens: 1100,
        temperature: 0.25,
      });
      if (!res.data) {
        extraNote = "Geçerli bir JSON nesnesi döndür.";
        continue;
      }
      const parsed = editPlanSchema.safeParse(res.data);
      if (parsed.success) {
        return { plan: parsed.data, source: "bedrock", model: res.model };
      }
      extraNote = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 240);
    } catch (e) {
      extraNote = (e as Error).message.slice(0, 200);
    }
  }

  return { plan: fb, source: "fallback", model: "rules-fallback" };
}
