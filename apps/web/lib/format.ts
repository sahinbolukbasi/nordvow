// Sayı/yüzde biçimleyicileri (tr-TR).
export const pct = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 0 });
export const num = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 });
export const pct1 = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1 });
export const pct2 = new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 2 });

const dec1 = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

/**
 * Türkçe kısa sayı biçimi ("B" kısaltması kullanılmaz; bin/milyar karışıklığını önler):
 * - < 10.000: tam sayı (ör. 2.698)
 * - 10.000 – 999.999: 225,5 bin
 * - 1.000.000 – 999.999.999: 1,2 Mn
 * - >= 1.000.000.000: 3,4 Mr
 */
export function fmtCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs < 10_000) return num.format(Math.round(value));
  if (abs < 1_000_000) return `${dec1.format(value / 1_000)} bin`;
  if (abs < 1_000_000_000) return `${dec1.format(value / 1_000_000)} Mn`;
  return `${dec1.format(value / 1_000_000_000)} Mr`;
}

/** Geriye dönük uyumlu sarmalayıcı (`compact.format(n)`). */
export const compact = {
  format: fmtCompact,
};

/** 0–100 ölçeğindeki yüzde değerini (ör. 0.25) TR virgüllü biçimler (`%0,25`). */
export function fmtPctValue(percentValue: number): string {
  if (!Number.isFinite(percentValue)) return "—";
  return pct2.format(percentValue / 100);
}

/** "TR12 •••• •••• 3456": baştaki 4 ve sondaki 4 karakter görünür. */
export function maskIban(iban: string): string {
  const v = iban.replace(/\s+/g, "").toUpperCase();
  if (v.length <= 8) return v;
  return `${v.slice(0, 4)} •••• •••• ${v.slice(-4)}`;
}

/** KPI değerini biçimler (ER oran, diğerleri sayı). */
export function fmtKpi(kpi: string, v: number): string {
  return kpi === "er" ? pct1.format(v) : num.format(v);
}

/** Ölçülmemiş metrikler için standart kullanıcı ipucu. */
export const UNMEASURED_HINT = "Hesap bağlanınca görünür";

/** Kullanıcı adını her zaman tek `@` ile biçimler (asla `@@` üretmez). */
export function formatHandle(raw: string | null | undefined): string {
  if (!raw) return "";
  const clean = raw.trim().replace(/^@+/, "");
  return clean ? `@${clean}` : "";
}

/** Takipçi sayısı 0 veya eksikse "—" döndürür (dürüst veri kuralı). */
export function fmtFollowers(followers: number | null | undefined): string {
  if (followers == null || !Number.isFinite(followers) || followers <= 0) return "—";
  return fmtCompact(followers);
}

/** Etkileşim oranı 0 veya eksikse "—" döndürür; varsa TR virgüllü yüzde (`%2,8`). */
export function fmtEr(er: number | null | undefined): string {
  if (er == null || !Number.isFinite(er) || er <= 0) return "—";
  return pct1.format(er);
}

/** YYYY-MM-DD dizgisini Türkçe GG.AA.YYYY biçimine çevirir. */
export function fmtTrDate(isoDay: string | Date | null | undefined): string {
  if (!isoDay) return "—";
  if (isoDay instanceof Date) {
    if (Number.isNaN(isoDay.getTime())) return "—";
    return new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(isoDay);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay.trim());
  if (!m) return isoDay;
  return `${m[3]}.${m[2]}.${m[1]}`;
}
