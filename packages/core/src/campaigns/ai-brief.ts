import { z } from "zod";
import { contentPlanSchema, OBJECTIVES, type ContentPlanItem, type Objective } from "../domain/campaign-plan";
import type { Platform } from "../enums";
import { envStr } from "../env";
import { converseStructured } from "../llm/bedrock";
import { findCampaignTemplate, type CampaignSectorId } from "./templates";

export type BriefTone = "samimi" | "eglenceli" | "premium";

export const aiBriefOutputSchema = z.object({
  titleAlternatives: z.array(z.string().min(3).max(90)).min(1).max(5),
  mainMessage: z.string().min(15).max(1500),
  dos: z.array(z.string().min(3).max(200)).min(2).max(10),
  donts: z.array(z.string().min(3).max(200)).min(2).max(10),
  mandatoryDisclosure: z.string().min(5).max(200),
  hashtags: z.array(z.string().min(2).max(40)).min(2).max(15),
  contentPlan: contentPlanSchema,
  moodBoardPrompt: z.string().min(10).max(500),
});

export type GeneratedCampaignBrief = z.infer<typeof aiBriefOutputSchema> & {
  source: "bedrock" | "template_fallback";
  model?: string;
};

export interface GenerateBriefInput {
  brandName: string;
  brandHandle?: string | null;
  campaignName?: string | null;
  objective: Objective;
  secondaryObjective?: Objective | null;
  sector?: CampaignSectorId | null;
  productTitle?: string | null;
  productDescription?: string | null;
  productPrice?: string | null;
  platforms: Platform[];
  audienceSummary?: string | null;
  tone?: BriefTone;
}

const MANDATORY_ROK_RULES = [
  "Sağlık veya tedavi beyanı kullanma",
  "Denemediğin ürünü deneyimlemiş gibi anlatma (ROK kılavuzu)",
];

function buildDisclosureLine(brandName: string, brandHandle?: string | null): string {
  const cleanHandle = brandHandle ? `@${brandHandle.replace(/^@+/, "")}` : brandName;
  return `Reklam | ${cleanHandle} — ilk anda görünür, diğer etiketlerden önce ve çok parçalı içerikte her parçada (md. 23/A)`;
}

function buildFallbackBrief(input: GenerateBriefInput): GeneratedCampaignBrief {
  const tpl = findCampaignTemplate(input.sector, input.objective);
  const subject = input.productTitle?.trim() || input.campaignName?.trim() || `${input.brandName} Kampanyası`;
  const platforms = input.platforms.length ? input.platforms : tpl.defaultPlatforms;
  const plan: ContentPlanItem[] = [];
  for (const p of platforms) {
    const matched = tpl.recommendedPlan.find((r) => r.platform === p);
    if (matched) {
      plan.push({ ...matched });
    } else if (p === "INSTAGRAM") {
      plan.push({ platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "15–30 sn, 9:16 dikey ürün anlatımı" });
    } else if (p === "TIKTOK") {
      plan.push({ platform: "TIKTOK", contentType: "VIDEO", count: 1, notes: "15–30 sn, trend ses + ürün deneyimi" });
    } else if (p === "YOUTUBE") {
      plan.push({ platform: "YOUTUBE", contentType: "SHORTS", count: 1, notes: "30–45 sn, öne çıkan faydalar" });
    }
  }

  const toneAdj =
    input.tone === "eglenceli"
      ? "Enerjik ve samimi"
      : input.tone === "premium"
        ? "Sade, seçkin ve yüksek estetikli"
        : "Doğal ve günlük hayattan";

  const hashtags = [...new Set([...tpl.hashtags, "#reklam"])].map((h) => (h.startsWith("#") ? h : `#${h}`));

  return {
    titleAlternatives: [
      `${subject} ile Günlük Rutin`,
      `${input.brandName} Deneyimi`,
      `${subject} — İlk İzlenim`,
    ],
    mainMessage: `${toneAdj} bir anlatımla ${subject} ürününü günlük rutininizde doğal şekilde gösterin. ${tpl.briefStarter}`,
    dos: tpl.dos,
    donts: [...new Set([...tpl.donts, ...MANDATORY_ROK_RULES])],
    mandatoryDisclosure: buildDisclosureLine(input.brandName, input.brandHandle),
    hashtags,
    contentPlan: plan,
    moodBoardPrompt: `${input.brandName} ${subject}, doğal gün ışığı, modern editorial ürün fotoğrafı, temiz kompozisyon, yüksek estetik`,
    source: "template_fallback",
  };
}

/**
 * AWS Bedrock (eu. inference profile) kullanarak düzenlenebilir kampanya brief'i üretir.
 * Şema doğrulamasından geçmezse veya Bedrock erişilemezse deterministik şablon çıktısına düşer (asla hata fırlatıp formu bozmaz).
 */
export async function generateAiCampaignBrief(
  input: GenerateBriefInput,
  opts?: { structuredCaller?: typeof converseStructured },
): Promise<GeneratedCampaignBrief> {
  const fallback = buildFallbackBrief(input);
  const caller = opts?.structuredCaller ?? converseStructured;

  if (!opts?.structuredCaller && envStr("LLM_PROVIDER", "mock") !== "bedrock") {
    return fallback;
  }

  const primaryLabel = OBJECTIVES.find((o) => o.id === input.objective)?.title ?? input.objective;
  const secondaryLabel = input.secondaryObjective
    ? OBJECTIVES.find((o) => o.id === input.secondaryObjective)?.title
    : null;
  const toneInstruction =
    input.tone === "eglenceli"
      ? "Ton: eğlenceli, dinamik ve akıcı."
      : input.tone === "premium"
        ? "Ton: premium, seçkin, yalın ve güven verici."
        : "Ton: samimi, doğal ve günlük dille.";

  const system = [
    "Sen Türkiye pazarında deneyimli bir influencer pazarlama kreatif direktörüsün.",
    "Verilen ürün/marka bilgilerine göre Türkçe, net, uygulanabilir bir kampanya brief'i üret.",
    "Yasal zorunluluk: Yapılmayacaklar listesinde sağlık beyanı yasağı ve denenmemiş ürünü deneyimlemiş gibi anlatmama (ROK kılavuzu) mutlaka yer almalı.",
    "Zorunlu reklam ibaresi (md. 23/A): 'Reklam' veya 'Tanıtım' + marka adı, ilk anda görünür ve diğer etiketlerden önce olmalı.",
    "Verilmeyen hiçbir fiyat, indirim yüzdesi veya tarih UYDURMA.",
    toneInstruction,
  ].join("\n");

  const userPrompt = [
    `Marka: ${input.brandName}${input.brandHandle ? ` (@${input.brandHandle.replace(/^@+/, "")})` : ""}`,
    `Ana hedef: ${primaryLabel}${secondaryLabel ? ` + İkincil hedef: ${secondaryLabel}` : ""}`,
    input.productTitle ? `Ürün: ${input.productTitle}` : "",
    input.productDescription ? `Ürün özeti: ${input.productDescription}` : "",
    input.productPrice ? `Ürün fiyatı: ${input.productPrice}` : "",
    `Platformlar: ${input.platforms.join(", ") || "INSTAGRAM"}`,
    input.audienceSummary ? `Hedef kitle: ${input.audienceSummary}` : "",
    "3 başlık alternatifi, ana mesaj, yapılacaklar, yapılmayacaklar, md. 23/A ibaresi, hashtag önerileri, platformlara uygun içerik planı ve konsept görsel promptu üret.",
  ]
    .filter(Boolean)
    .join("\n");

  const jsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["titleAlternatives", "mainMessage", "dos", "donts", "mandatoryDisclosure", "hashtags", "contentPlan", "moodBoardPrompt"],
    properties: {
      titleAlternatives: { type: "array", items: { type: "string" } },
      mainMessage: { type: "string" },
      dos: { type: "array", items: { type: "string" } },
      donts: { type: "array", items: { type: "string" } },
      mandatoryDisclosure: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
      contentPlan: {
        type: "array",
        items: {
          type: "object",
          required: ["platform", "contentType", "count", "notes"],
          properties: {
            platform: { type: "string", enum: ["INSTAGRAM", "TIKTOK", "YOUTUBE"] },
            contentType: { type: "string" },
            count: { type: "integer" },
            notes: { type: "string" },
          },
        },
      },
      moodBoardPrompt: { type: "string" },
    },
  };

  try {
    const res = await caller<Record<string, unknown>>({
      system,
      turns: [{ role: "user", text: userPrompt }],
      schemaName: "campaign_quick_brief",
      schemaDescription: "Nordvow hızlı kampanya AI brief çıktısı",
      schema: jsonSchema,
      maxTokens: 900,
      temperature: 0.4,
    });

    if (!res.data) return fallback;
    const parsed = aiBriefOutputSchema.safeParse(res.data);
    if (!parsed.success) {
      console.warn("[campaigns/ai-brief] AI JSON şeması doğrulanamadı, şablona düşüldü:", parsed.error.issues[0]?.message);
      return fallback;
    }

    // ROK ve md. 23/A garantisi + #reklam etiketi garantisi
    const donts = [...new Set([...parsed.data.donts, ...MANDATORY_ROK_RULES])].slice(0, 10);
    const hashtags = [
      ...new Set([
        ...parsed.data.hashtags.map((h) => (h.startsWith("#") ? h : `#${h.replace(/\s+/g, "")}`)),
        "#reklam",
      ]),
    ].slice(0, 12);

    return {
      ...parsed.data,
      donts,
      hashtags,
      mandatoryDisclosure: buildDisclosureLine(input.brandName, input.brandHandle),
      source: "bedrock",
      model: res.model,
    };
  } catch (err) {
    console.warn("[campaigns/ai-brief] Bedrock çağrısı hata verdi, şablona düşüldü:", err instanceof Error ? err.message : err);
    return fallback;
  }
}

/**
 * Yüklenen mood board / referans dosyalarının stil özetini üretir (Bedrock veya deterministik özet).
 */
export async function summarizeMoodBoardStyle(input: {
  brandName: string;
  fileNames: string[];
  notes?: string | null;
}): Promise<string> {
  if (input.fileNames.length === 0 && !input.notes?.trim()) {
    return "Stil: doğal gün ışığı, yakın plan ürün odağı, sade ve sıcak tonlar.";
  }
  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const res = await converseStructured<{ styleSummary: string }>({
        system: "Sen bir sanat yönetmenisin. Verilen referans dosya adları ve marka notlarından tek cümlelik Türkçe görsel stil özeti ('Stil: ...') üret.",
        turns: [
          {
            role: "user",
            text: `Marka: ${input.brandName}\nReferans dosyalar: ${input.fileNames.join(", ")}\nNotlar: ${input.notes || "—"}`,
          },
        ],
        schemaName: "moodboard_style_summary",
        schema: {
          type: "object",
          required: ["styleSummary"],
          properties: { styleSummary: { type: "string" } },
        },
        maxTokens: 160,
        temperature: 0.3,
      });
      if (res.data?.styleSummary?.trim()) return res.data.styleSummary.trim();
    } catch {
      // Fallback aşağıda
    }
  }
  const noteHint = input.notes?.trim() ? ` ${input.notes.trim().slice(0, 120)}` : "";
  return `Stil: doğal ışık, yakın plan ürün çekimi, temiz kompozisyon (${input.fileNames.length} referans görsel/video).${noteHint}`;
}

