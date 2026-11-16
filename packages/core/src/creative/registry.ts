import { prisma } from "../db";
import { creativePricing, refreshFx, unitPriceTry } from "./pricing";
import { getConfig } from "../config/store";
import { notifyAdmins } from "../agents/common";

/**
 * Model kaydı: model ID'leri KODDA DEĞİL bu tabloda; ~12 aylık model ömrü varsayılır.
 * Deprecated modele gelen iş replacement_key'e yönlenir ve admin uyarılır.
 * license_status != 'cleared' olan model müşteri işinde ÇALIŞMAZ (FLUX lisans riski, fal'dan yazılı
 * teyit gelene kadar FLUX ve araştırma-kökenli modeller pending + feature flag kapalı).
 */
export class ModelUnavailableError extends Error {}

export async function resolveModel(key: string, depth = 0): Promise<NonNullable<Awaited<ReturnType<typeof prisma.modelRegistry.findUnique>>>> {
  const m = await prisma.modelRegistry.findUnique({ where: { key } });
  if (!m) throw new ModelUnavailableError(`Model kaydı bulunamadı: ${key}`);
  if (m.status !== "active") {
    if (m.replacementKey && depth < 3) {
      await notifyAdmins("Deprecated model kullanımı", `${key} kullanım dışı; iş ${m.replacementKey} modeline yönlendirildi.`, "/creative");
      return resolveModel(m.replacementKey, depth + 1);
    }
    throw new ModelUnavailableError(`${key} kullanım dışı ve yerine geçecek model tanımlı değil.`);
  }
  if (m.licenseStatus !== "cleared") {
    throw new ModelUnavailableError(`${key} lisans durumu '${m.licenseStatus}': müşteri işinde kullanılamaz.`);
  }
  if (m.featureFlag) {
    const flags = await getConfig("features");
    if (!flags[m.featureFlag]) throw new ModelUnavailableError(`${key} özellik bayrağı (${m.featureFlag}) kapalı.`);
  }
  return m;
}

type Seed = {
  key: string; provider: string; modelId: string; kind: string; unit: string; unitPriceUsd: number;
  deterministic?: boolean; maxUnits?: number; status?: "active" | "deprecated"; replacementKey?: string;
  licenseStatus?: "cleared" | "pending" | "restricted"; featureFlag?: string;
  /** Fiyat ve model kimliği fal/Bedrock model sayfasından doğrulandı mı (7 Kas 2026). */
  priceVerified?: boolean;
};
/**
 * Model kaydı tohumu. Fiyatlar sağlayıcının KENDİ model sayfasından (fal.ai/models/<id>/llms.txt)
 * 7 Kas 2026'da teyit edildi. TL fiyat burada yazılmaz: pricing.ts formülüyle (USD × kur × markup)
 * her başlangıçta hesaplanır. Kimliği doğrulanamayan eski kayıtlar deprecated + doğru karşılığa yönlenir.
 */
export const MODEL_SEEDS: Seed[] = [
  // --- 1. Görsel Üretim Endpoint'leri (Ucuzdan Pahalıya) ---
  { key: "flux-schnell", provider: "fal", modelId: "fal-ai/flux/schnell", kind: "image", unit: "image", unitPriceUsd: 0.003, licenseStatus: "cleared", priceVerified: true }, // Ultra Ucuz / Hızlı Taslak ($0.003/MP)
  { key: "z-image-turbo", provider: "fal", modelId: "fal-ai/z-image/turbo", kind: "image", unit: "image", unitPriceUsd: 0.005, licenseStatus: "pending", featureFlag: "creative.researchModels", priceVerified: true }, // Çok Ucuz Sosyal Medya ($0.005/MP)
  { key: "flux-dev", provider: "fal", modelId: "fal-ai/flux/dev", kind: "image", unit: "image", unitPriceUsd: 0.025, licenseStatus: "cleared", priceVerified: true }, // Fiyat/Performans ($0.025/MP)
  { key: "seedream-v4-5", provider: "fal", modelId: "fal-ai/bytedance/seedream/v4.5/text-to-image", kind: "image", unit: "image", unitPriceUsd: 0.04, licenseStatus: "cleared", priceVerified: true }, // Estetik / Moda / Ürün ($0.04/görsel)
  { key: "nano-banana", provider: "fal", modelId: "fal-ai/nano-banana", kind: "image", unit: "image", unitPriceUsd: 0.0398, licenseStatus: "cleared", priceVerified: true }, // Görsel Düzenleme / Ürün Yerleştirme ($0.0398/görsel)
  { key: "recraft-v3", provider: "fal", modelId: "fal-ai/recraft/v3/text-to-image", kind: "image", unit: "image", unitPriceUsd: 0.04, licenseStatus: "cleared", priceVerified: true },
  { key: "flux-3", provider: "fal", modelId: "blackforestlabs/flux-3/text-to-image", kind: "image", unit: "image", unitPriceUsd: 0.048, licenseStatus: "cleared", priceVerified: true }, // Yüksek Fotorealizm ($0.048/MP)
  { key: "ideogram-v3", provider: "fal", modelId: "fal-ai/ideogram/v3", kind: "image", unit: "image", unitPriceUsd: 0.06, licenseStatus: "cleared", priceVerified: true }, // BALANCED
  { key: "nano-banana-2", provider: "fal", modelId: "fal-ai/nano-banana-2", kind: "image", unit: "image", unitPriceUsd: 0.08, licenseStatus: "cleared", priceVerified: true }, // Tipografi & Tutarlı Karakter ($0.08/görsel)
  { key: "seedream-v5-pro", provider: "fal", modelId: "fal-ai/bytedance/seedream/v5/pro", kind: "image", unit: "image", unitPriceUsd: 0.135, licenseStatus: "cleared", priceVerified: true }, // Stüdyo Reklam Kalitesi ($0.135/görsel)
  { key: "nano-banana-pro", provider: "fal", modelId: "fal-ai/nano-banana-pro", kind: "image", unit: "image", unitPriceUsd: 0.15, licenseStatus: "cleared", priceVerified: true }, // Üst Düzey Marka Görseli ($0.15/görsel)
  { key: "gpt-image-2", provider: "fal", modelId: "openai/gpt-image-2", kind: "image", unit: "image", unitPriceUsd: 1, licenseStatus: "pending" }, // Maksimum Kalite ($1.00/görsel)
  // Eski/doğrulanamayan kimlikler → doğru karşılığa yönlenir
  { key: "ideogram-4", provider: "fal", modelId: "fal-ai/ideogram/v3", kind: "image", unit: "image", unitPriceUsd: 0.06, status: "deprecated", replacementKey: "ideogram-v3", licenseStatus: "cleared" },
  { key: "recraft-v4-pro", provider: "fal", modelId: "fal-ai/recraft/v3/text-to-image", kind: "image", unit: "image", unitPriceUsd: 0.04, status: "deprecated", replacementKey: "recraft-v3", licenseStatus: "cleared" },

  // --- 2. Video Üretim Endpoint'leri (Reels & Story - Ucuzdan Pahalıya) ---
  { key: "minimax-h3-max-turbo", provider: "fal", modelId: "minimax/h3-max-turbo/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.02, licenseStatus: "cleared", maxUnits: 10, priceVerified: true }, // En Ucuz B-Roll ($0.015-$0.025/sn)
  { key: "ltxv-distilled", provider: "fal", modelId: "fal-ai/ltxv-13b-098-distilled", kind: "video", unit: "second", unitPriceUsd: 0.02, licenseStatus: "cleared", maxUnits: 5, priceVerified: true },
  { key: "minimax-h3-max", provider: "fal", modelId: "minimax/h3-max/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.04, licenseStatus: "cleared", maxUnits: 10, priceVerified: true }, // Dengeli Dikey Video ($0.03-$0.05/sn)
  { key: "hailuo-02-standard", provider: "fal", modelId: "fal-ai/minimax/hailuo-02/standard/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.045, licenseStatus: "cleared", maxUnits: 10, priceVerified: true },
  { key: "wan-v3", provider: "fal", modelId: "fal-ai/wan/v3/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.08, licenseStatus: "cleared", maxUnits: 10, priceVerified: true }, // Dinamik Kamera Hareketi ($0.068-$0.14/sn)
  { key: "kling-v2-5-turbo-pro", provider: "fal", modelId: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.07, licenseStatus: "cleared", maxUnits: 10, priceVerified: true },
  { key: "gemini-omni-flash", provider: "fal", modelId: "fal-ai/gemini-omni-flash/v1.2", kind: "video", unit: "second", unitPriceUsd: 0.0819, licenseStatus: "cleared", maxUnits: 10, priceVerified: true }, // Sahne Geçişi / Uzatma ($0.0819/sn)
  { key: "kling-v3-pro", provider: "fal", modelId: "fal-ai/kling-video/v3/pro/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.112, licenseStatus: "cleared", maxUnits: 15, priceVerified: true }, // Sinematik & İnsan Hareketi
  { key: "wan-v3-1080p", provider: "fal", modelId: "fal-ai/wan/v3/1080p", kind: "video", unit: "second", unitPriceUsd: 0.28, licenseStatus: "cleared", maxUnits: 10, priceVerified: true }, // Yüksek Çözünürlük 1080p ($0.28/sn)
  { key: "veo-3-1", provider: "fal", modelId: "fal-ai/veo3.1", kind: "video", unit: "second", unitPriceUsd: 0.4, licenseStatus: "cleared", maxUnits: 10, priceVerified: true }, // Ses Efektli Sinematik ($0.20-$0.60/sn)
  { key: "minimax-h3-turbo", provider: "fal", modelId: "fal-ai/minimax/hailuo-02/standard/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.045, status: "deprecated", replacementKey: "hailuo-02-standard", licenseStatus: "cleared" },
  { key: "minimax-h3-ref2video", provider: "fal", modelId: "fal-ai/minimax/hailuo-02/standard/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.045, status: "deprecated", replacementKey: "hailuo-02-standard", licenseStatus: "cleared" },
  { key: "seedance-2", provider: "fal", modelId: "fal-ai/ltxv-13b-098-distilled", kind: "video", unit: "second", unitPriceUsd: 0.02, status: "deprecated", replacementKey: "ltxv-distilled", licenseStatus: "cleared" },
  { key: "kling-2-1-pro", provider: "fal", modelId: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.07, status: "deprecated", replacementKey: "kling-v2-5-turbo-pro", licenseStatus: "cleared" },
  // Görselden video (stüdyo / ürün canlandırma)
  { key: "hailuo-02-fast-i2v", provider: "fal", modelId: "fal-ai/minimax/hailuo-02-fast/image-to-video", kind: "video", unit: "second", unitPriceUsd: 0.017, licenseStatus: "cleared", maxUnits: 10, priceVerified: true },
  { key: "kling-v2-5-i2v", provider: "fal", modelId: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", kind: "video", unit: "second", unitPriceUsd: 0.07, licenseStatus: "cleared", maxUnits: 10, priceVerified: true }, // Ürün Canlandırma ($0.07/sn)
  { key: "minimax-h3-i2v", provider: "fal", modelId: "fal-ai/minimax/hailuo-02-fast/image-to-video", kind: "video", unit: "second", unitPriceUsd: 0.017, status: "deprecated", replacementKey: "hailuo-02-fast-i2v", licenseStatus: "cleared" },

  // --- 3. Seslendirme (TTS) & 4. Arka Plan Müziği Endpoint'leri ---
  { key: "kokoro-en", provider: "fal", modelId: "fal-ai/kokoro/american-english", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.02, licenseStatus: "cleared", priceVerified: true }, // Ultra Ucuz İngilizce ($0.02/1K)
  { key: "dia-tts", provider: "fal", modelId: "fal-ai/dia-tts", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.04, licenseStatus: "cleared", priceVerified: true }, // İki Kişilik Diyalog ($0.04/1K)
  { key: "f5-tts", provider: "fal", modelId: "fal-ai/f5-tts", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.05, licenseStatus: "cleared", priceVerified: true },
  { key: "elevenlabs-turbo-2-5", provider: "fal", modelId: "fal-ai/elevenlabs/tts/turbo-v2.5", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.05, licenseStatus: "cleared", priceVerified: true }, // Hızlı Çok Dilli / Türkçe ($0.05/1K)
  { key: "minimax-speech-2-8-turbo", provider: "fal", modelId: "fal-ai/minimax/speech-2.8-turbo", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.06, licenseStatus: "cleared", priceVerified: true },
  { key: "elevenlabs-v3", provider: "fal", modelId: "fal-ai/elevenlabs/tts/eleven-v3", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.1, licenseStatus: "cleared", priceVerified: true }, // En Doğal Türkçe & Duygu Vurgusu ($0.10/1K)
  { key: "elevenlabs-multilingual-v2", provider: "fal", modelId: "fal-ai/elevenlabs/tts/multilingual-v2", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.1, licenseStatus: "cleared", priceVerified: true },
  // Arka Plan Müziği
  { key: "ace-step", provider: "fal", modelId: "fal-ai/ace-step", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.01, licenseStatus: "cleared", priceVerified: true }, // En Ucuz Fon Müziği ($0.0002/sn)
  { key: "cassetteai-music", provider: "fal", modelId: "fal-ai/cassetteai/music-generator", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.02, licenseStatus: "cleared", priceVerified: true }, // Hızlı Enstrümantal ($0.02/dk)
  { key: "lyria-3", provider: "fal", modelId: "fal-ai/lyria3", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.06, licenseStatus: "cleared", priceVerified: true }, // Modern Beat & Şarkı ($0.04-$0.08/parça)
  { key: "minimax-music-2-6", provider: "fal", modelId: "fal-ai/minimax-music/v2.6", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.15, licenseStatus: "cleared", priceVerified: true }, // Vokalli Özel Şarkı ($0.15/parça)
  { key: "elevenlabs-music", provider: "fal", modelId: "fal-ai/elevenlabs/music", kind: "audio", unit: "1k_chars", unitPriceUsd: 0.8, licenseStatus: "cleared", priceVerified: true }, // Stüdyo Seviyesi Prodüksiyon ($0.80/dk)

  // --- Stüdyo düzenleme (adet) ---
  { key: "esrgan-upscale", provider: "fal", modelId: "fal-ai/esrgan", kind: "edit", unit: "image", unitPriceUsd: 0.005, licenseStatus: "cleared" }, // işlem süresi bazlı (~$0.00111/sn); tahmini
  { key: "bria-bg-remove", provider: "fal", modelId: "fal-ai/bria/background/remove", kind: "edit", unit: "image", unitPriceUsd: 0.018, licenseStatus: "cleared", priceVerified: true },
  { key: "nano-banana-edit", provider: "fal", modelId: "fal-ai/nano-banana/edit", kind: "edit", unit: "image", unitPriceUsd: 0.0398, licenseStatus: "cleared", priceVerified: true },
  { key: "flux-kontext-pro", provider: "fal", modelId: "fal-ai/flux-pro/kontext", kind: "edit", unit: "image", unitPriceUsd: 0.04, licenseStatus: "pending", featureFlag: "creative.flux", priceVerified: true },
  { key: "flux-lora-fast-training", provider: "fal", modelId: "fal-ai/flux-lora-fast-training", kind: "training", unit: "run", unitPriceUsd: 2, licenseStatus: "pending", featureFlag: "creative.flux" },
  { key: "fashn-tryon-1-6", provider: "fal", modelId: "fal-ai/fashn/tryon/v1.6", kind: "tryon", unit: "image", unitPriceUsd: 0.075, licenseStatus: "pending", priceVerified: true },
  { key: "bria-tryon", provider: "fal", modelId: "bria/fibo-edit-1.5/virtual-try-on", kind: "tryon", unit: "image", unitPriceUsd: 0.04, licenseStatus: "pending" },

  // --- Amazon Bedrock (tüm kreatif işler fal.ai'ye taşındı; eski anahtarlar fal karşılıklarına yönlenir) ---
  { key: "stability-fast-upscale", provider: "fal", modelId: "fal-ai/esrgan", kind: "edit", unit: "image", unitPriceUsd: 0.005, status: "deprecated", replacementKey: "esrgan-upscale", licenseStatus: "cleared" },
  { key: "stability-outpaint", provider: "fal", modelId: "fal-ai/nano-banana/edit", kind: "edit", unit: "image", unitPriceUsd: 0.0398, status: "deprecated", replacementKey: "nano-banana-edit", licenseStatus: "cleared" },
  { key: "stability-remove-bg", provider: "fal", modelId: "fal-ai/bria/background/remove", kind: "edit", unit: "image", unitPriceUsd: 0.018, status: "deprecated", replacementKey: "bria-bg-remove", licenseStatus: "cleared" },
  { key: "stability-conservative-upscale", provider: "fal", modelId: "fal-ai/esrgan", kind: "edit", unit: "image", unitPriceUsd: 0.005, status: "deprecated", replacementKey: "esrgan-upscale", licenseStatus: "cleared" },
  { key: "stability-creative-upscale", provider: "fal", modelId: "fal-ai/esrgan", kind: "edit", unit: "image", unitPriceUsd: 0.005, status: "deprecated", replacementKey: "esrgan-upscale", licenseStatus: "cleared" },
  { key: "nova-canvas", provider: "fal", modelId: "fal-ai/flux/schnell", kind: "image", unit: "image", unitPriceUsd: 0.003, status: "deprecated", replacementKey: "flux-schnell", licenseStatus: "cleared" },
  { key: "titan-image-g1-v2", provider: "fal", modelId: "fal-ai/flux/schnell", kind: "image", unit: "image", unitPriceUsd: 0.003, status: "deprecated", replacementKey: "flux-schnell", licenseStatus: "cleared" },
  { key: "nova-reel", provider: "fal", modelId: "fal-ai/minimax/hailuo-02/standard/text-to-video", kind: "video", unit: "second", unitPriceUsd: 0.045, status: "deprecated", replacementKey: "hailuo-02-standard", licenseStatus: "cleared", maxUnits: 10 },
];
export async function seedModelRegistry() {
  // Kur güncel olsun; ağ yoksa son bilinen kur (pricing.creative) kullanılır.
  const pricing = process.env.NODE_ENV === "test" ? await creativePricing() : await refreshFx();
  for (const s of MODEL_SEEDS) {
    const data = {
      provider: s.provider,
      modelId: s.modelId,
      kind: s.kind,
      unit: s.unit,
      unitPriceUsd: s.unitPriceUsd,
      // TL birim fiyat = USD × kur × markup (1 kredi = 1 TL).
      creditsPerUnit: unitPriceTry(s.unitPriceUsd, pricing),
      priceVerified: s.priceVerified ?? false,
      deterministic: s.deterministic ?? true,
      maxUnits: s.maxUnits ?? null,
      status: s.status ?? "active",
      deprecatedAt: s.status === "deprecated" ? new Date("2026-09-01") : null,
      replacementKey: s.replacementKey ?? null,
      licenseStatus: s.licenseStatus ?? "pending",
      featureFlag: s.featureFlag ?? null,
    };
    await prisma.modelRegistry.upsert({
      where: { key: s.key },
      create: { key: s.key, ...data },
      update: { provider: data.provider, modelId: data.modelId, kind: data.kind, unit: data.unit, unitPriceUsd: data.unitPriceUsd, creditsPerUnit: data.creditsPerUnit, priceVerified: data.priceVerified, maxUnits: data.maxUnits, status: data.status, replacementKey: data.replacementKey, licenseStatus: data.licenseStatus, featureFlag: data.featureFlag },
    });
  }
}
