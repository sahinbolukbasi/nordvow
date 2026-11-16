import { envStr } from "../../env";
import { converseStructured } from "../../llm/bedrock";
import { planFromKeywords } from "../video-brief";
import { editPlanSchema, type EditPlan } from "./schemas";

function fallbackEditPlan(command: string, durationSec: number | null): EditPlan {
  const kw = planFromKeywords(command, durationSec);
  const t = command.toLocaleLowerCase("tr");
  const hasMusic = /müzik|enerjik|ritim|beat|şarkı/.test(t);
  const hasSub = /altyazı|yazı|metin/.test(t);
  const hasRegen = /yeniden üret|sahne.*değiştir|b-roll ekle/.test(t);

  return editPlanSchema.parse({
    summary: [
      ...kw.summary,
      ...(hasMusic ? ["Enerjik fon müziği ekle"] : []),
      ...(hasSub ? ["Altyazı katmanı ekle"] : []),
      ...(hasRegen ? ["İlgili sahneyi AI ile yeniden üret"] : []),
    ].slice(0, 8),
    trim:
      kw.ops.trimStart > 0 || kw.ops.trimEnd != null
        ? { startSec: kw.ops.trimStart, endSec: kw.ops.trimEnd, targetDurationSec: kw.ops.trimEnd }
        : undefined,
    speed: kw.ops.speed,
    aspect: kw.ops.aspect === "4:5" ? "9:16" : kw.ops.aspect,
    colorLook: kw.ops.look,
    transition: kw.ops.fade ? "fade" : "cut",
    subtitles: hasSub
      ? {
          enabled: true,
          lines: [{ startSec: 0.5, endSec: 4.5, text: command.slice(0, 60) }],
        }
      : undefined,
    audioMix:
      hasMusic || kw.ops.mute
        ? {
            muteOriginal: kw.ops.mute,
            musicPrompt: hasMusic ? "energetic upbeat social media reel music" : null,
            voiceoverText: null,
            musicVolume: 0.28,
          }
        : undefined,
    regenerateScene: hasRegen
      ? {
          enabled: true,
          sceneIndex: 0,
          prompt: `Cinematic b-roll replacement: ${command.slice(0, 200)}`,
          durationSec: 5,
          insertAtSec: 0,
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
}): Promise<{ plan: EditPlan; source: "bedrock" | "fallback"; model: string }> {
  const fb = fallbackEditPlan(input.command, input.videoDurationSec);
  if (envStr("LLM_PROVIDER", "mock") !== "bedrock") {
    return { plan: fb, source: "fallback", model: "rules-fallback" };
  }

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["summary", "speed", "aspect", "colorLook", "transition"],
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
      speed: { type: "number" },
      aspect: { type: "string", enum: ["orijinal", "9:16", "1:1", "16:9"] },
      colorLook: { type: "string", enum: ["orijinal", "canli", "siyah-beyaz", "sicak", "soguk"] },
      transition: { type: "string", enum: ["cut", "fade", "wipeleft", "slideleft", "dissolve"] },
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
        },
      },
    },
  };

  let extraNote = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await converseStructured<Record<string, unknown>>({
        system:
          "Sen uzman bir video kurgu planlayıcısısın. Kullanıcının doğal dildeki düzenleme komutunu verilen JSON şemasına çevir. summary alanında Türkçe kısa maddeler yaz.",
        turns: [
          {
            role: "user",
            text: `Kaynak video süresi: ${input.videoDurationSec ?? "bilinmiyor"} sn.\nEdit komutu: ${input.command}${extraNote ? `\nDüzeltme: ${extraNote}` : ""}`,
          },
        ],
        schemaName: "video_edit_plan",
        schema,
        maxTokens: 900,
        temperature: 0.2,
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

