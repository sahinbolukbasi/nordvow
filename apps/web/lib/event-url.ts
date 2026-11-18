/**
 * Etkinlik URL yardımcıları: Türkçe karakterleri koruyarak okunaklı URL slug'ı üretir
 * ve hem `/etkinlik/<slug>--<id>` hem `/etkinlik/<id>` hem `/etkinlik/<slug>` biçimlerini çözer.
 */
export function slugifyTurkish(input: string): string {
  const map: Record<string, string> = {
    ç: "c",
    Ç: "c",
    ğ: "g",
    Ğ: "g",
    ı: "i",
    I: "i",
    İ: "i",
    ö: "o",
    Ö: "o",
    ş: "s",
    Ş: "s",
    ü: "u",
    Ü: "u",
  };
  const replaced = input
    .split("")
    .map((ch) => map[ch] ?? ch)
    .join("")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return replaced
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

/** Etkinlik için okunaklı herkese açık yol üretir: `/etkinlik/etkinlik-adi--<id>`. */
export function eventPublicPath(id: string, title?: string | null): string {
  const slug = title ? slugifyTurkish(title) : "";
  return slug ? `/etkinlik/${slug}--${id}` : `/etkinlik/${id}`;
}

/** URL parametresinden ham etkinlik ID'sini çıkarır (`slug--id` veya `id`). */
export function extractEventIdFromParam(param: string): string {
  const idx = param.lastIndexOf("--");
  if (idx !== -1 && idx + 2 < param.length) {
    return param.slice(idx + 2);
  }
  return param;
}

