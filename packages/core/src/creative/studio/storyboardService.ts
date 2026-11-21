import { BedrockRuntimeClient, ConverseCommand, type ContentBlock, type ImageFormat } from "@aws-sdk/client-bedrock-runtime";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { envStr } from "../../env";
import { parseJsonObject } from "../../llm/bedrock";
import { downloadToFile, getOwnedUpload } from "../uploads";
import { storyboardSchema, type PipelineAspect, type Storyboard } from "./schemas";

let visionClient: BedrockRuntimeClient | undefined;
function client(): BedrockRuntimeClient {
  visionClient ??= new BedrockRuntimeClient({ region: envStr("BEDROCK_REGION", "eu-central-1") });
  return visionClient;
}

function imageFormatOf(mime: string): ImageFormat {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpeg";
}

function fallbackStoryboard(
  uploads: { id: string; name: string | null }[],
  opts: { goal?: string; musicStyle?: string; defaultDuration?: number },
): Storyboard {
  const dur = Math.min(10, Math.max(3, opts.defaultDuration ?? 5));
  const transitions = ["fade", "dissolve", "wipeleft", "slideleft"] as const;
  const scenes = uploads.map((u, idx) => ({
    sceneIndex: idx,
    uploadIndex: idx,
    uploadId: u.id,
    motionPrompt: `${opts.goal ? `${opts.goal} — ` : ""}Smooth cinematic camera push-in with subtle parallax and natural lighting on scene ${idx + 1} (${u.name ?? "photo"})`,
    cameraMove: idx % 2 === 0 ? "yavaş yakınlaşma" : "yatay kaydırma",
    durationSec: dur,
    transition: transitions[idx % transitions.length]!,
    voiceoverText: "",
    subtitleText: u.name ? u.name.replace(/\.[^.]+$/, "").slice(0, 48) : `Sahne ${idx + 1}`,
  }));
  return {
    title: opts.goal?.slice(0, 60) || "Ürün & Marka Hikâyesi",
    musicStyle: opts.musicStyle || "modern enerjik elektronik fon müziği",
    voiceoverScript: opts.goal ? `${opts.goal}. Şimdi keşfedin!` : "",
    scenes,
  };
}

/**
 * 1–20 fotoğrafı S3'ten okur, AWS Bedrock (Claude Vision) ile analiz edip
 * Zod şemasıyla doğrulanmış bir Storyboard JSON döndürür.
 * Geçersiz JSON çıktısında en fazla 2 kez yeniden ister.
 */
export async function generateStoryboardFromPhotos(input: {
  tenantId: string;
  uploadIds: string[];
  aspect: PipelineAspect;
  goal?: string;
  musicStyle?: string;
  defaultDurationSec?: number;
}): Promise<{ storyboard: Storyboard; source: "bedrock" | "fallback"; model: string }> {
  const ids = input.uploadIds.slice(0, 20);
  if (ids.length === 0) throw new Error("En az 1 fotoğraf seçilmelidir.");

  const uploads = await Promise.all(ids.map((id) => getOwnedUpload(input.tenantId, id)));
  if (uploads.some((u) => u.kind !== "image")) {
    throw new Error("Storyboard oluşturma için yalnızca fotoğraf dosyaları kullanılabilir.");
  }

  const fb = fallbackStoryboard(uploads, {
    goal: input.goal,
    musicStyle: input.musicStyle,
    defaultDuration: input.defaultDurationSec,
  });

  if (envStr("LLM_PROVIDER", "mock") !== "bedrock") {
    return { storyboard: fb, source: "fallback", model: "mock-storyboard" };
  }

  // En fazla 10 fotoğrafı görsel blok olarak gönder (Bedrock tek istek sınırı içinde güvenli kalır; geri kalanlar metin indeksiyle eklenir).
  const dir = mkdtempSync(path.join(tmpdir(), "nv-sb-"));
  const imageBlocks: ContentBlock[] = [];
  try {
    for (let i = 0; i < Math.min(uploads.length, 10); i++) {
      const u = uploads[i]!;
      try {
        const localPath = path.join(dir, `img-${i}`);
        await downloadToFile(u.s3Key, localPath);
        const bytes = new Uint8Array(readFileSync(localPath));
        if (bytes.byteLength > 0 && bytes.byteLength <= 4.5 * 1024 * 1024) {
          imageBlocks.push({ text: `Fotoğraf #${i} (${u.name ?? u.id}):` });
          imageBlocks.push({ image: { format: imageFormatOf(u.mime), source: { bytes } } });
        }
      } catch {
        // Tek görsel indirilemezse diğerleriyle devam et.
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const modelId = envStr("BEDROCK_VISION_MODEL_ID", "eu.anthropic.claude-sonnet-4-5-20250929-v1:0");
  const systemPrompt = [
    "Sen profesyonel bir sosyal medya video yönetmenisin.",
    "Verilen fotoğrafları analiz et ve her biri için bir storyboard sahnesi planla.",
    "Yanıtın SADECE aşağıdaki alanlara sahip geçerli bir JSON nesnesi olsun:",
    '{ "title": string, "musicStyle": string, "voiceoverScript": string, "scenes": [{ "sceneIndex": number, "uploadIndex": number, "motionPrompt": string (İngilizce, image-to-video modeli için kamera/hareket komutu), "cameraMove": string (Türkçe), "durationSec": number (3-10 arası tamsayı), "transition": "cut"|"fade"|"wipeleft"|"slideleft"|"dissolve", "voiceoverText": string (Türkçe), "subtitleText": string (kısa Türkçe altyazı) }] }',
    `Toplam ${uploads.length} fotoğraf var; scenes dizisi 0..${uploads.length - 1} arası tüm uploadIndex'leri kapsamalı.`,
  ].join("\n");

  const baseText = [
    `Hedef format: ${input.aspect}`,
    input.goal ? `Kullanıcı hedefi: ${input.goal}` : "Kullanıcı hedefi: Dikkat çekici, akıcı sosyal medya tanıtım videosu",
    input.musicStyle ? `Tercih edilen müzik: ${input.musicStyle}` : "",
    `Varsayılan sahne süresi: ${input.defaultDurationSec ?? 5} sn`,
    `Fotoğraf listesi: ${uploads.map((u, idx) => `${idx}: ${u.name ?? u.id}`).join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  let correctionNote = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const content: ContentBlock[] = [
        ...imageBlocks,
        { text: correctionNote ? `${baseText}\n\nÖnceki yanıt geçersizdi, lütfen düzelt: ${correctionNote}` : baseText },
      ];
      const res = await client().send(
        new ConverseCommand({
          modelId,
          system: [{ text: systemPrompt }],
          messages: [{ role: "user", content }],
          inferenceConfig: { maxTokens: 2000, temperature: 0.35 },
        }),
      );
      const rawText = ((res.output as { message?: { content?: { text?: string }[] } })?.message?.content ?? [])
        .map((c) => c.text ?? "")
        .join("")
        .trim();
      const obj = parseJsonObject(rawText);
      if (!obj) {
        correctionNote = "Geçerli bir JSON nesnesi döndür.";
        continue;
      }
      const parsed = storyboardSchema.safeParse(obj);
      if (!parsed.success) {
        correctionNote = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300);
        continue;
      }
      // uploadId eşlemesini sunucuda garanti altına al.
      const normalizedScenes = parsed.data.scenes.map((s, idx) => {
        const safeUploadIdx = Math.min(uploads.length - 1, Math.max(0, s.uploadIndex));
        return {
          ...s,
          sceneIndex: idx,
          uploadIndex: safeUploadIdx,
          uploadId: uploads[safeUploadIdx]!.id,
        };
      });
      return {
        storyboard: { ...parsed.data, scenes: normalizedScenes },
        source: "bedrock",
        model: modelId,
      };
    } catch (e) {
      correctionNote = (e as Error).message.slice(0, 200);
    }
  }

  return { storyboard: fb, source: "fallback", model: modelId };
}

