import { formatCurrencyIntl } from "@infulancer/core/i18n/currency-service";
import { regionOf, type Locale } from "@infulancer/core/i18n/regions";

/** Seçili dil ve ülkeye göre BCP-47 Intl locale etiketi döndürür (ör. "tr-TR", "en-US", "en-GB"). */
export function resolveIntlTag(locale: Locale | string, country?: string | null): string {
  if (locale === "tr") return "tr-TR";
  if (country) {
    const c = country.toUpperCase();
    if (c === "GB" || c === "US" || c === "AU" || c === "CA") return `en-${c}`;
    const r = regionOf(c);
    if (r.code === c && r.intl.startsWith(locale)) return r.intl;
  }
  if (locale === "en") return "en-US";
  if (locale === "de") return "de-DE";
  if (locale === "fr") return "fr-FR";
  return "en-US";
}

/** Seçili dil ve saat dilimine göre tarih biçimlendirir (Intl.DateTimeFormat). */
export function formatDateIntl(
  date: Date | string,
  options: { locale?: string; country?: string | null; timeZone?: string; dateStyle?: "full" | "long" | "medium" | "short" } = {},
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const tag = resolveIntlTag(options.locale ?? "en", options.country);
  return new Intl.DateTimeFormat(tag, {
    dateStyle: options.dateStyle ?? "medium",
    timeZone: options.timeZone ?? "UTC",
  }).format(d);
}

/** Seçili dil ve saat dilimine göre tarih + saat biçimlendirir (DST uyumlu). */
export function formatDateTimeIntl(
  date: Date | string,
  options: {
    locale?: string;
    country?: string | null;
    timeZone?: string;
    dateStyle?: "full" | "long" | "medium" | "short";
    timeStyle?: "full" | "long" | "medium" | "short";
  } = {},
): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const tag = resolveIntlTag(options.locale ?? "en", options.country);
  return new Intl.DateTimeFormat(tag, {
    dateStyle: options.dateStyle ?? "medium",
    timeStyle: options.timeStyle ?? "short",
    timeZone: options.timeZone ?? "UTC",
  }).format(d);
}

/** Seçili dile göre sayı biçimlendirir. */
export function formatNumberIntl(
  value: number,
  options: { locale?: string; country?: string | null; maximumFractionDigits?: number; compact?: boolean } = {},
): string {
  if (!Number.isFinite(value)) return "—";
  const tag = resolveIntlTag(options.locale ?? "en", options.country);
  return new Intl.NumberFormat(tag, {
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
    ...(options.compact ? { notation: "compact" as const } : {}),
  }).format(value);
}

/** Seçili dil ve ülke para birimine göre tutar biçimlendirir (alt birim: kuruş/cent). */
export function formatMoneyIntl(
  minor: number | bigint,
  currency: string,
  options: { locale?: string; country?: string | null } = {},
): string {
  const tag = resolveIntlTag(options.locale ?? "en", options.country);
  return formatCurrencyIntl(minor, currency, tag);
}
