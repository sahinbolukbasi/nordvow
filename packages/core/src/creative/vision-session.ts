import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BedrockRuntimeClient, ConverseCommand, type ImageFormat } from "@aws-sdk/client-bedrock-runtime";
import { prisma } from "../db";
import { envStr } from "../env";
import { parseJsonObject } from "../llm/bedrock";
import { downloadToFile, getOwnedUpload } from "./uploads";

export type AssetRole = "product" | "character" | "style_ref" | "background";

export type ProductCategory =
  | "cosmetics_bottle"
  | "unboxing_packaging"
  | "tech_gadget"
  | "apparel_fashion"
  | "food_beverage"
  | "general_product";

export type SfxProfile = "cosmetics" | "unboxing" | "tech" | "apparel" | "food" | "ambient";

export type VisionAssetAnalysis = {
  asset_id: string;
  role: AssetRole;
  product_category: ProductCategory;
  subject_summary_en: string;
  subject_summary_tr: string;
  materials_textures: string[];
  dominant_colors: string[];
  lighting_mood: string;
  camera_angle: string;
  background_description: string;
  has_text_or_logo: boolean;
  detected_brand_text: string | null;
  recommended_sfx_profile: SfxProfile;
};

export type SfxCue = {
  id: string;
  timestamp_ms: number;
  duration_ms: number;
  sfx_key: string;
  category: "cosmetics" | "unboxing" | "tech" | "apparel" | "food" | "transition";
  label_tr: string;
  source: "builtin_synth" | "fal_elevenlabs_sfx";
  volume: number;
};

export type MotionGraphicLayer = {
  id: string;
  type: "kinetic_subtitle" | "feature_callout" | "price_badge" | "zoom_pulse" | "speed_ramp" | "whip_pan";
  start_ms: number;
  end_ms: number;
  text: string;
  position: "top_safe" | "center" | "bottom_safe" | "left_slide" | "top_right_badge";
  animation: "slide_left" | "pop_spring" | "fade_up" | "smooth_zoom";
  accent_color: string;
};

export type TimelinePlan = {
  duration_ms: number;
  aspect_ratio: "9:16" | "4:5" | "1:1" | "16:9";
  clean_ai_base: boolean;
  color_grade: "orijinal" | "canli" | "siyah-beyaz" | "sicak" | "soguk";
  speed_multiplier: number;
  sfx_track: SfxCue[];
  motion_layers: MotionGraphicLayer[];
  voiceover_script_tr: string | null;
};

export type BoundAsset = {
  asset_id: string;
  upload_id: string;
  kind: "image" | "video";
  name: string | null;
  vision: VisionAssetAnalysis;
  locked_at: string;
};

export type CreativeSessionState = {
  session_id: string;
  updated_at: string;
  active_assets: BoundAsset[];
  brand_context: {
    platform: "instagram_reels" | "instagram_story" | "instagram_post" | "tiktok";
    aspect_ratio: "9:16" | "4:5" | "1:1" | "16:9";
    tone: string;
    constraints: string[];
  };
  current_canvas: {
    asset_id: string | null;
    upload_id: string | null;
    kind: "image" | "video" | "audio" | null;
    version: number;
    parent_asset_id: string | null;
    last_prompt: string | null;
  };
  timeline_plan: TimelinePlan;
  intent_history: string[];
};

export const CATEGORY_LABELS_TR: Record<ProductCategory, string> = {
  cosmetics_bottle: "Kozmetik / Şişe",
  unboxing_packaging: "Kutu Açılımı / Paket",
  tech_gadget: "Teknoloji / Aksesuar",
  apparel_fashion: "Giyim / Tekstil",
  food_beverage: "Gıda / İçecek",
  general_product: "Ürün / Sahne",
};

function defaultTimelinePlan(): TimelinePlan {
  return {
    duration_ms: 5000,
    aspect_ratio: "9:16",
    clean_ai_base: true,
    color_grade: "orijinal",
    speed_multiplier: 1,
    sfx_track: [],
    motion_layers: [],
    voiceover_script_tr: null,
  };
}

export function createInitialSessionState(tenantId: string): CreativeSessionState {
  return {
    session_id: `sess_${tenantId}`,
    updated_at: new Date().toISOString(),
    active_assets: [],
    brand_context: {
      platform: "instagram_reels",
      aspect_ratio: "9:16",
      tone: "premium editorial UGC",
      constraints: ["clean_ai_base_no_garbled_text"],
    },
    current_canvas: {
      asset_id: null,
      upload_id: null,
      kind: null,
      version: 0,
      parent_asset_id: null,
      last_prompt: null,
    },
    timeline_plan: defaultTimelinePlan(),
    intent_history: [],
  };
}

function sessionStateKey(tenantId: string): string {
  return `creative.sessionState.${tenantId}`;
}

function visionCacheKey(uploadId: string): string {
  return `creative.vision.${uploadId}`;
}

export async function loadCreativeSessionState(tenantId: string): Promise<CreativeSessionState> {
  try {
    const row = await prisma.configValue.findUnique({
      where: { key: sessionStateKey(tenantId) },
      select: { value: true },
    });
    if (row?.value && typeof row.value === "object") {
      const parsed = row.value as Partial<CreativeSessionState>;
      const base = createInitialSessionState(tenantId);
      return {
        ...base,
        ...parsed,
        active_assets: Array.isArray(parsed.active_assets) ? parsed.active_assets : [],
        brand_context: parsed.brand_context ?? base.brand_context,
        current_canvas: parsed.current_canvas ?? base.current_canvas,
        timeline_plan: parsed.timeline_plan
          ? {
              ...defaultTimelinePlan(),
              ...parsed.timeline_plan,
              sfx_track: Array.isArray(parsed.timeline_plan.sfx_track) ? parsed.timeline_plan.sfx_track : [],
              motion_layers: Array.isArray(parsed.timeline_plan.motion_layers) ? parsed.timeline_plan.motion_layers : [],
            }
          : base.timeline_plan,
        intent_history: Array.isArray(parsed.intent_history) ? parsed.intent_history : [],
      };
    }
  } catch {
    // ignore read error
  }
  return createInitialSessionState(tenantId);
}

export async function saveCreativeSessionState(tenantId: string, state: CreativeSessionState): Promise<void> {
  const next: CreativeSessionState = {
    ...state,
    updated_at: new Date().toISOString(),
    active_assets: state.active_assets.slice(0, 6),
    intent_history: state.intent_history.slice(-15),
  };
  try {
    await prisma.configValue.upsert({
      where: { key: sessionStateKey(tenantId) },
      create: { key: sessionStateKey(tenantId), value: next as never, verified: true, note: "Structured CreativeSessionState" },
      update: { value: next as never, verified: true },
    });
  } catch {
    // non-fatal state write
  }
}

export async function resetCreativeSessionState(tenantId: string): Promise<void> {
  await prisma.configValue.deleteMany({ where: { key: sessionStateKey(tenantId) } }).catch(() => undefined);
}

function inferCategoryFromHint(hint: string): {
  category: ProductCategory;
  sfxProfile: SfxProfile;
  textures: string[];
  summaryTr: string;
  summaryEn: string;
} {
  const h = hint.toLocaleLowerCase("tr");
  if (/(serum|parfüm|parfum|kozmetik|krem|şişe|sise|losyon|tonik|ruj|rimel|skincare|bottle|cosmetic|perfume)/.test(h)) {
    return {
      category: "cosmetics_bottle",
      sfxProfile: "cosmetics",
      textures: ["glass", "metallic cap", "smooth label"],
      summaryTr: "Kozmetik / bakım ürünü şişesi",
      summaryEn: "cosmetic or skincare bottle with clean label and cap",
    };
  }
  if (/(kutu|paket|unboxing|ambalaj|kargo|box|package)/.test(h)) {
    return {
      category: "unboxing_packaging",
      sfxProfile: "unboxing",
      textures: ["matte cardboard", "packaging seal", "craft paper"],
      summaryTr: "Kutu / e-ticaret ambalaj paketi",
      summaryEn: "branded product packaging box with protective inner wrap",
    };
  }
  if (/(kulaklık|kulaklik|saat|telefon|teknoloji|elektronik|kamera|laptop|tech|gadget|watch|earbuds|headphone|case)/.test(h)) {
    return {
      category: "tech_gadget",
      sfxProfile: "tech",
      textures: ["brushed aluminum", "matte polycarbonate", "glass screen"],
      summaryTr: "Teknoloji cihazı / aksesuar",
      summaryEn: "modern consumer tech gadget with brushed metallic and matte details",
    };
  }
  if (/(elbise|ceket|tişört|tisort|gömlek|kombin|çanta|ayakkabı|moda|kumaş|giyim|fashion|apparel|bag|shoe|jacket)/.test(h)) {
    return {
      category: "apparel_fashion",
      sfxProfile: "apparel",
      textures: ["woven fabric", "cotton weave", "stitching detail"],
      summaryTr: "Moda / giyim ve tekstil ürünü",
      summaryEn: "fashion apparel or wearable item with distinct fabric texture",
    };
  }
  if (/(kahve|latte|içecek|icecek|kupa|fincan|tatlı|yemek|kruvasan|çikolata|coffee|drink|food|bottle)/.test(h)) {
    return {
      category: "food_beverage",
      sfxProfile: "food",
      textures: ["ceramic glaze", "liquid surface", "artisanal crust"],
      summaryTr: "Gıda / içecek ürünü",
      summaryEn: "artisanal beverage or culinary item with rich natural textures",
    };
  }
  return {
    category: "general_product",
    sfxProfile: "ambient",
    textures: ["smooth surface", "studio edges"],
    summaryTr: "Öne çıkan ana ürün / konu",
    summaryEn: "primary product subject with preserved silhouette and surface details",
  };
}

let visionClient: BedrockRuntimeClient | undefined;
function bedrockVision(): BedrockRuntimeClient {
  visionClient ??= new BedrockRuntimeClient({ region: envStr("BEDROCK_REGION", "eu-central-1") });
  return visionClient;
}

function toBedrockImageFormat(mime: string): ImageFormat {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpeg";
}

/**
 * Vision-First Analiz:
 * Yüklenen veya kitaplıktan seçilen her görseli yapılandırılmış JSON olarak analiz eder
 * ve `config_values` tablosunda önbelleğe alır (aynı varlık için sıfır tekrar maliyeti).
 */
export async function analyzeAssetWithVision(input: {
  tenantId: string;
  assetOrUploadId: string;
  roleHint?: AssetRole;
  contextHint?: string | null;
}): Promise<BoundAsset | null> {
  let upload;
  try {
    upload = await getOwnedUpload(input.tenantId, input.assetOrUploadId);
  } catch {
    return null;
  }

  const cKey = visionCacheKey(upload.id);
  const cached = await prisma.configValue.findUnique({ where: { key: cKey }, select: { value: true } }).catch(() => null);
  if (cached?.value && typeof cached.value === "object") {
    const existing = cached.value as VisionAssetAnalysis;
    if (existing.subject_summary_en && existing.product_category) {
      return {
        asset_id: input.assetOrUploadId,
        upload_id: upload.id,
        kind: upload.kind === "video" ? "video" : "image",
        name: upload.name ?? null,
        vision: { ...existing, asset_id: input.assetOrUploadId },
        locked_at: new Date().toISOString(),
      };
    }
  }

  const hintText = [upload.name ?? "", input.contextHint ?? ""].filter(Boolean).join(" ").trim();
  const heuristic = inferCategoryFromHint(hintText);
  let analysis: VisionAssetAnalysis = {
    asset_id: input.assetOrUploadId,
    role: input.roleHint ?? "product",
    product_category: heuristic.category,
    subject_summary_en: heuristic.summaryEn,
    subject_summary_tr: heuristic.summaryTr,
    materials_textures: heuristic.textures,
    dominant_colors: ["natural neutral", "warm highlights"],
    lighting_mood: "soft studio directional light",
    camera_angle: "eye-level three-quarter commercial angle",
    background_description: "original uploaded scene background",
    has_text_or_logo: false,
    detected_brand_text: null,
    recommended_sfx_profile: heuristic.sfxProfile,
  };

  if (upload.kind === "image" && envStr("LLM_PROVIDER", "mock") === "bedrock") {
    const dir = mkdtempSync(path.join(tmpdir(), "nv-vis-"));
    try {
      const tmpPath = path.join(dir, "asset.bin");
      await downloadToFile(upload.s3Key, tmpPath);
      const bytes = readFileSync(tmpPath);
      if (bytes.byteLength > 64 && bytes.byteLength <= 4_500_000) {
        const modelId = envStr("BEDROCK_VISION_MODEL_ID", "eu.amazon.nova-lite-v1:0");
        const sysPrompt = [
          "You are a precision Product Vision Inspector for an AI Creative Studio.",
          "Analyze the uploaded image and return ONLY a valid JSON object matching:",
          "{",
          '  "role": "product" | "character" | "style_ref" | "background",',
          '  "product_category": "cosmetics_bottle" | "unboxing_packaging" | "tech_gadget" | "apparel_fashion" | "food_beverage" | "general_product",',
          '  "subject_summary_en": "<detailed 1-sentence English visual description of exact product/subject shape, label, material>",',
          '  "subject_summary_tr": "<concise Turkish description>",',
          '  "materials_textures": ["<material 1>", "<material 2>"],',
          '  "dominant_colors": ["<color 1>", "<color 2>"],',
          '  "lighting_mood": "<lighting description>",',
          '  "camera_angle": "<angle description>",',
          '  "background_description": "<current background>",',
          '  "has_text_or_logo": true | false,',
          '  "detected_brand_text": "<exact visible label text or null>",',
          '  "recommended_sfx_profile": "cosmetics" | "unboxing" | "tech" | "apparel" | "food" | "ambient"',
          "}",
        ].join("\n");

        const res = await bedrockVision().send(
          new ConverseCommand({
            modelId,
            system: [{ text: sysPrompt }],
            messages: [
              {
                role: "user",
                content: [
                  { image: { format: toBedrockImageFormat(upload.mime), source: { bytes: new Uint8Array(bytes) } } },
                  { text: `Dosya adı: ${upload.name ?? "gorsel"}.${input.contextHint ? ` Bağlam: ${input.contextHint}` : ""} Sadece JSON döndür.` },
                ],
              },
            ],
            inferenceConfig: { maxTokens: 450, temperature: 0.1 },
          }),
        );
        const text = (res.output?.message?.content ?? []).map((c) => c.text ?? "").join("").trim();
        const parsed = parseJsonObject(text);
        if (parsed && typeof parsed.subject_summary_en === "string") {
          const validCats: ProductCategory[] = [
            "cosmetics_bottle",
            "unboxing_packaging",
            "tech_gadget",
            "apparel_fashion",
            "food_beverage",
            "general_product",
          ];
          const validRoles: AssetRole[] = ["product", "character", "style_ref", "background"];
          const validSfx: SfxProfile[] = ["cosmetics", "unboxing", "tech", "apparel", "food", "ambient"];
          const cat = validCats.includes(parsed.product_category as ProductCategory)
            ? (parsed.product_category as ProductCategory)
            : analysis.product_category;
          const role = validRoles.includes(parsed.role as AssetRole) ? (parsed.role as AssetRole) : analysis.role;
          const sfx = validSfx.includes(parsed.recommended_sfx_profile as SfxProfile)
            ? (parsed.recommended_sfx_profile as SfxProfile)
            : analysis.recommended_sfx_profile;
          analysis = {
            asset_id: input.assetOrUploadId,
            role,
            product_category: cat,
            subject_summary_en: String(parsed.subject_summary_en).slice(0, 320),
            subject_summary_tr: typeof parsed.subject_summary_tr === "string" ? parsed.subject_summary_tr.slice(0, 220) : analysis.subject_summary_tr,
            materials_textures: Array.isArray(parsed.materials_textures)
              ? parsed.materials_textures.map(String).slice(0, 5)
              : analysis.materials_textures,
            dominant_colors: Array.isArray(parsed.dominant_colors)
              ? parsed.dominant_colors.map(String).slice(0, 5)
              : analysis.dominant_colors,
            lighting_mood: typeof parsed.lighting_mood === "string" ? parsed.lighting_mood.slice(0, 100) : analysis.lighting_mood,
            camera_angle: typeof parsed.camera_angle === "string" ? parsed.camera_angle.slice(0, 100) : analysis.camera_angle,
            background_description:
              typeof parsed.background_description === "string" ? parsed.background_description.slice(0, 120) : analysis.background_description,
            has_text_or_logo: Boolean(parsed.has_text_or_logo),
            detected_brand_text: typeof parsed.detected_brand_text === "string" && parsed.detected_brand_text.trim() ? parsed.detected_brand_text.trim() : null,
            recommended_sfx_profile: sfx,
          };
        }
      }
    } catch {
      // Fallback heuristic stays active so Vision never crashes the pipeline
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  await prisma.configValue
    .upsert({
      where: { key: cKey },
      create: { key: cKey, value: analysis as never, verified: true, note: "Cached VisionAssetAnalysis" },
      update: { value: analysis as never, verified: true },
    })
    .catch(() => undefined);

  return {
    asset_id: input.assetOrUploadId,
    upload_id: upload.id,
    kind: upload.kind === "video" ? "video" : "image",
    name: upload.name ?? null,
    vision: analysis,
    locked_at: new Date().toISOString(),
  };
}

/** Yeni bağlanan varlıkları oturum durumuna (Asset Binding) tekilleştirerek işler. */
export function bindAssetsToSession(state: CreativeSessionState, newlyAnalyzed: BoundAsset[]): CreativeSessionState {
  if (!newlyAnalyzed.length) return state;
  const byUpload = new Map<string, BoundAsset>();
  for (const b of state.active_assets) byUpload.set(b.upload_id, b);
  for (const b of newlyAnalyzed) byUpload.set(b.upload_id, b);
  const merged = [...byUpload.values()].slice(-4);
  return {
    ...state,
    active_assets: merged,
  };
}

/** Kullanıcının mesajındaki ton/kısıt/format sinyallerini oturum durumuna kaydeder. */
export function updateSessionFromUserIntent(state: CreativeSessionState, userMessage: string): CreativeSessionState {
  const norm = userMessage.toLocaleLowerCase("tr");
  const nextConstraints = new Set(state.brand_context.constraints);
  if (/yazı olmasın|yazi olmasin|metinsiz|temiz arka/.test(norm)) {
    nextConstraints.add("no_ai_text");
  }
  if (/hızlı kurgu|hizli kurgu|dinamik/.test(norm)) {
    nextConstraints.add("fast_paced_cuts");
  }
  const aspect = norm.includes("4:5") || norm.includes("post")
    ? "4:5"
    : norm.includes("1:1") || norm.includes("kare")
      ? "1:1"
      : norm.includes("16:9") || norm.includes("yatay")
        ? "16:9"
        : state.brand_context.aspect_ratio;
  const platform =
    aspect === "4:5" || aspect === "1:1"
      ? "instagram_post"
      : norm.includes("tiktok")
        ? "tiktok"
        : norm.includes("story")
          ? "instagram_story"
          : state.brand_context.platform;

  return {
    ...state,
    brand_context: {
      ...state.brand_context,
      platform,
      aspect_ratio: aspect,
      constraints: [...nextConstraints].slice(0, 8),
    },
    timeline_plan: {
      ...state.timeline_plan,
      aspect_ratio: aspect,
    },
    intent_history: [...state.intent_history, userMessage.slice(0, 180)].slice(-15),
  };
}

/**
 * Fidelity Lock:
 * Referans varlığı (ürün/karakter) şekil, logo, malzeme ve renk bakımından koruyarak
 * yalnızca kullanıcının istediği sahne/arka plan/hareket değişikliğini derler.
 */
export function compileFidelityLockedPrompt(
  vision: VisionAssetAnalysis,
  requestedChange: string,
  mode: "edit_image" | "image_to_video",
): string {
  const mat = vision.materials_textures.length ? `Materials: ${vision.materials_textures.join(", ")}. ` : "";
  const col = vision.dominant_colors.length ? `Colors: ${vision.dominant_colors.join(", ")}. ` : "";
  const label = vision.detected_brand_text ? `Exact visible label/logo text "${vision.detected_brand_text}" MUST stay crisp and unaltered. ` : "";

  if (mode === "image_to_video") {
    return (
      `Clean commercial product motion video preserving the exact ${vision.subject_summary_en}. ` +
      `${mat}${label}` +
      `Apply ONLY the requested motion and environment: ${requestedChange}. ` +
      `Smooth cinematic camera push-in, realistic physics, natural reflections, STRICTLY NO overlaid text, NO random watermarks, NO shape morphing.`
    );
  }

  return (
    `STRICT FIDELITY LOCK: Preserve the exact primary subject (${vision.subject_summary_en}) from the reference image with 100% identical geometry, proportions, and surface identity. ` +
    `${mat}${col}${label}` +
    `Modify ONLY what is requested: ${requestedChange}. ` +
    `Photorealistic commercial studio quality, seamless natural contact shadows, no distorted text.`
  );
}

