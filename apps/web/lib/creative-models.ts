/**
 * Creative: model anahtarlarını kullanıcı dostu ad/açıklama/birim etiketine çevirir.
 * Sunucu ve istemci bileşenleri ortak kullanır ("use client" yok, sunucuya özel import yok).
 */
export type CreativeKind = "image" | "video" | "audio";
export const KIND_LABEL: Record<CreativeKind, string> = { image: "Görsel", video: "Video", audio: "Seslendirme" };

const MODEL_INFO: Record<string, { name: string; hint: string }> = {
  "flux-schnell": { name: "FLUX Schnell", hint: "Ultra ucuz, hızlı taslak ($0.003/MP)" },
  "z-image-turbo": { name: "Z-Image Turbo", hint: "Çok ucuz sosyal medya ($0.005/MP)" },
  "flux-dev": { name: "FLUX Dev", hint: "Fiyat/performans post görseli ($0.025/MP)" },
  "seedream-v4-5": { name: "Seedream 4.5", hint: "Estetik, moda ve ürün ($0.04/görsel)" },
  "flux-3": { name: "FLUX 3", hint: "Yüksek fotorealizm ($0.048/MP)" },
  "seedream-v5-pro": { name: "Seedream 5 Pro", hint: "Stüdyo reklam kalitesi ($0.135/görsel)" },
  "recraft-v3": { name: "Recraft V3", hint: "Gerçekçi ve illüstrasyon" },
  "ideogram-v3": { name: "Ideogram V3", hint: "Yazılı afiş ve tipografi" },
  "ltxv-distilled": { name: "LTX Video", hint: "En ekonomik, 5 sn" },
  "minimax-h3-max-turbo": { name: "MiniMax H3 Max Turbo", hint: "En ucuz B-Roll ($0.02/sn)" },
  "minimax-h3-max": { name: "MiniMax H3 Max", hint: "Dengeli dikey video ($0.04/sn)" },
  "wan-v3": { name: "Wan V3 (720p)", hint: "Dinamik kamera hareketi ($0.08/sn)" },
  "gemini-omni-flash": { name: "Gemini Omni Flash 1.2", hint: "Sahne geçişi ve uzatma ($0.0819/sn)" },
  "wan-v3-1080p": { name: "Wan V3 1080p", hint: "Yüksek çözünürlük 1080p ($0.28/sn)" },
  "veo-3-1": { name: "Veo 3.1", hint: "Ses efektli sinematik ($0.40/sn)" },
  "hailuo-02-standard": { name: "Hailuo 02", hint: "Dengeli, 6/10 sn" },
  "hailuo-02-fast-i2v": { name: "Hailuo 02 Fast", hint: "Görselden video, ekonomik" },
  "kling-v2-5-i2v": { name: "Kling 2.5 Pro I2V", hint: "Ürün canlandırma ($0.07/sn)" },
  "nano-banana-2": { name: "Nano Banana 2", hint: "Tipografi & tutarlı karakter ($0.08/görsel)" },
  "nano-banana-pro": { name: "Nano Banana Pro", hint: "Üst düzey marka görseli ($0.15/görsel)" },
  "nano-banana": { name: "Nano Banana", hint: "Görsel düzenleme / ürün yerleştirme ($0.0398)" },
  "gpt-image-2": { name: "GPT Image 2", hint: "Maksimum kalite ($1.00/görsel)" },
  "ideogram-4": { name: "Ideogram 4", hint: "Yazılı afiş ve tipografi" },
  "recraft-v4-pro": { name: "Recraft V4 Pro", hint: "İllüstrasyon ve vektör" },
  "nova-canvas": { name: "Nova Canvas", hint: "fal.ai'ye yönlendirildi" },
  "titan-image-g1-v2": { name: "Titan Image", hint: "fal.ai'ye yönlendirildi" },
  "minimax-h3-turbo": { name: "Hailuo 3 Turbo", hint: "Hızlı video" },
  "kling-v2-5-turbo-pro": { name: "Kling 2.5 Turbo Pro", hint: "Akıcı hareket ($0.07/sn)" },
  "kling-v3-pro": { name: "Kling 3 Pro", hint: "Sinematik & insan hareketi ($0.14/sn)" },
  "seedance-2": { name: "Seedance 2", hint: "Uzun sahneler" },
  "nova-reel": { name: "Nova Reel", hint: "fal.ai'ye yönlendirildi" },
  "kokoro-en": { name: "Kokoro TTS", hint: "Ultra ucuz İngilizce ($0.02/1K)" },
  "dia-tts": { name: "Dia TTS", hint: "İki kişilik diyalog [S1]/[S2] ($0.04/1K)" },
  "f5-tts": { name: "F5 TTS", hint: "Referans ses ($0.05/1K)" },
  "elevenlabs-turbo-2-5": { name: "ElevenLabs Turbo v2.5", hint: "Hızlı Türkçe/Çok dilli ($0.05/1K)" },
  "elevenlabs-v3": { name: "ElevenLabs v3", hint: "En doğal Türkçe & duygu vurgusu ($0.10/1K)" },
  "elevenlabs-multilingual-v2": { name: "ElevenLabs Çok Dilli", hint: "En doğal Türkçe" },
  "minimax-speech-2-8-turbo": { name: "MiniMax Speech", hint: "Ekonomik ses" },
  "ace-step": { name: "ACE-Step Music", hint: "En ucuz fon müziği ($0.0002/sn)" },
  "cassetteai-music": { name: "CassetteAI Music", hint: "Telifsiz Reels fon müziği ($0.02/dk)" },
  "lyria-3": { name: "Lyria 3", hint: "Modern beat & şarkı ($0.06/parça)" },
  "minimax-music-2-6": { name: "MiniMax Music 2.6", hint: "Vokalli özel şarkı ($0.15/parça)" },
  "elevenlabs-music": { name: "ElevenLabs Music", hint: "Stüdyo seviyesi prodüksiyon ($0.80/dk)" },
};
const UNIT_LABEL: Record<string, string> = { image: "adet", second: "saniye", "1k_chars": "× 1000 karakter", "1k_tokens": "× 1000 token", megapixel: "megapiksel" };

export function modelName(key: string): string {
  return MODEL_INFO[key]?.name ?? key.split("-").map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w)).join(" ");
}
export function modelHint(key: string): string {
  return MODEL_INFO[key]?.hint ?? "";
}
export function unitLabel(unit: string): string {
  return UNIT_LABEL[unit] ?? unit;
}
export function asKind(kind: string): CreativeKind | null {
  return kind === "image" || kind === "video" || kind === "audio" ? kind : null;
}
/** Referans görsel gerektiren modeller (görselden videoya vb.) metin besteci için uygun değildir. */
export function needsReference(key: string): boolean {
  return /i2v|ref2video|image-to-video|tryon|upscale|outpaint|remove-bg/.test(key);
}
/** Kartlar için türe göre degrade (görsel önizlemesi yokken). */
export const KIND_TONE: Record<CreativeKind, string[]> = {
  image: ["from-rose-400 via-fuchsia-500 to-indigo-600", "from-amber-300 via-orange-400 to-rose-500", "from-emerald-300 via-teal-400 to-sky-600"],
  video: ["from-sky-400 via-indigo-500 to-violet-700", "from-fuchsia-500 via-purple-600 to-slate-900", "from-cyan-400 via-blue-600 to-indigo-900"],
  audio: ["from-lime-300 via-emerald-400 to-teal-600", "from-yellow-300 via-amber-400 to-orange-600", "from-violet-300 via-purple-400 to-fuchsia-600"],
};
export function toneFor(kind: CreativeKind, seed: string): string {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const list = KIND_TONE[kind];
  return list[h % list.length]!;
}
export const fmtCredits = (n: number) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);
/** Creative Stüdyo birimi: Kredi (TL yerine kredi gösterilir). */
export function fmtTl(n: number, _currency = "TRY"): string {
  const v = Math.abs(n) < 10 && !Number.isInteger(n) ? n : Math.round(n);
  return `${fmtCredits(v)} Kredi`;
}
/** Sunucudaki pricing.chargeIn ile aynı: 2 hane yukarı yuvarlanır; en az min. */
export function chargeAmount(cpu: number, units: number, min: number, _currency = "TRY"): number {
  const raw = cpu * units;
  const v = Math.ceil(raw * 100 - 1e-9) / 100;
  return Math.max(min, v);
}
