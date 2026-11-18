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
 * - Görünmez Unicode karakterleri ve boşlukları kaldırır
 * - URL ön eklerini (https://instagram.com/...) ve ? / # parametrelerini temizler
 * - Türkçe karakterleri ve aksanları ASCII'ye dönüştürür (ör. İ -> i\u0307 hatasını önler)
 */
export function cleanSocialHandle(raw: string, platform?: "INSTAGRAM" | "TIKTOK" | "YOUTUBE"): string {
  const cleaned = raw
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am|tiktok\.com|youtube\.com)\/@?/i, "")
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
