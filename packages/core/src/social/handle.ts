const TR_CHAR_MAP: Record<string, string> = {
  İ: "i",
  I: "i",
  ı: "i",
  Ğ: "g",
  ğ: "g",
  Ü: "u",
  ü: "u",
  Ş: "s",
  ş: "s",
  Ö: "o",
  ö: "o",
  Ç: "c",
  ç: "c",
};

/**
 * Sosyal medya kullanıcı adını temizler:
 * - Görünmez Unicode / yönlendirme karakterlerini (ZWSP, LRM, RLM, NBSP) kaldırır
 * - Tam genişlikli / Unicode alt çizgileri (＿, ﹍, ﹎, ﹏) standart ASCII `_` karakterine çevirir
 * - URL ön eklerini (https://(www.|m.)instagram.com/...) ve ? / # parametrelerini temizler
 * - Türkçe karakterleri ve aksanları ASCII'ye dönüştürür (ör. İ -> i\u0307 hatasını önler)
 * - Sondaki veya ortadaki `_` karakterlerini korur (ör. `buketakdag_`)
 */
export function cleanSocialHandle(raw: string, platform?: "INSTAGRAM" | "TIKTOK" | "YOUTUBE"): string {
  const cleaned = raw
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00A0]/g, "")
    .replace(/[\uFF3F\uFE4D-\uFE4F\u203F\u2040]/g, "_")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:(?:www|m)\.)?(?:instagram\.com|instagr\.am|tiktok\.com|youtube\.com)\/@?/i, "")
    .replace(/[/?#].*$/, "")
    .replace(/^@+/, "")
    .replace(/[İIıĞğÜüŞşÖöÇç]/g, (ch) => TR_CHAR_MAP[ch] ?? ch)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "");

  if (platform === "INSTAGRAM") return cleaned.replace(/[^a-z0-9._]/g, "");
  return cleaned.replace(/[^a-z0-9._-]/g, "");
}

/** Baştaki tüm `@` karakterlerini ve boşlukları temizler (veritabanı standardı: `@` işaretsiz). */
export function stripLeadingAt(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/^@+/, "");
}

/** Arayüz gösterimi için tek `@` önekli kullanıcı adı üretir (asla `@@` üretmez). */
export function formatSocialHandle(raw: string | null | undefined): string {
  const clean = stripLeadingAt(raw);
  return clean ? `@${clean}` : "";
}
