import { AGENCY_TZ } from "./time";

/**
 * Etkinlik/kupon kartları için tarih parçaları (Luma tarzı tarih rozeti).
 * Sunucu ve istemcide ortak; yalnız Intl kullanır.
 * Seçilen şehrin IANA saat dilimine (DST uyumlu) ve aktif dile göre biçimlendirir.
 */
const cache = new Map<string, Intl.DateTimeFormat>();

function resolveTag(locale?: string): string {
  if (!locale || locale === "tr") return "tr-TR";
  if (locale === "en") return "en-US";
  if (locale === "de") return "de-DE";
  if (locale === "fr") return "fr-FR";
  return locale;
}

function f(key: string, opts: Intl.DateTimeFormatOptions, timeZone?: string, locale?: string): Intl.DateTimeFormat {
  const tz = timeZone || AGENCY_TZ;
  const tag = resolveTag(locale);
  const ck = `${key}|${tz}|${tag}`;
  let x = cache.get(ck);
  if (!x) {
    x = new Intl.DateTimeFormat(tag, { timeZone: tz, ...opts });
    cache.set(ck, x);
  }
  return x;
}

/** "KAS" / "NOV" */
export function monthShort(d: Date, timeZone?: string, locale?: string): string {
  const tag = resolveTag(locale);
  return f("mon", { month: "short" }, timeZone, locale).format(d).replace(".", "").toLocaleUpperCase(tag);
}
/** "12" */
export function dayNum(d: Date, timeZone?: string, locale?: string): string {
  return f("day", { day: "numeric" }, timeZone, locale).format(d);
}
/** "12 Kas" / "Nov 12" */
export function dayMonthShort(d: Date, timeZone?: string, locale?: string): string {
  return f("dms", { day: "numeric", month: "short" }, timeZone, locale).format(d);
}
/** "Çarşamba" / "Wednesday" */
export function weekdayLong(d: Date, timeZone?: string, locale?: string): string {
  return f("wd", { weekday: "long" }, timeZone, locale).format(d);
}
/** "19:00" */
export function timeShort(d: Date, timeZone?: string, locale?: string): string {
  return f("time", { hour: "2-digit", minute: "2-digit", hour12: false }, timeZone, locale).format(d);
}
/** "12 Kasım 2026" / "November 12, 2026" */
export function dateLong(d: Date, timeZone?: string, locale?: string): string {
  return f("dl", { day: "numeric", month: "long", year: "numeric" }, timeZone, locale).format(d);
}
/** "Çarşamba, 12 Kasım · 19:00 – 23:00" (seçilen şehrin saat dilimine göre). */
export function rangeLabel(start: Date, end?: Date | null, timeZone?: string, locale?: string): string {
  const head = `${weekdayLong(start, timeZone, locale)}, ${f("dm", { day: "numeric", month: "long" }, timeZone, locale).format(start)} · ${timeShort(start, timeZone, locale)}`;
  if (!end) return head;
  const sameDay =
    f("ymd", { year: "numeric", month: "2-digit", day: "2-digit" }, timeZone, locale).format(start) ===
    f("ymd", { year: "numeric", month: "2-digit", day: "2-digit" }, timeZone, locale).format(end);
  return sameDay
    ? `${head} – ${timeShort(end, timeZone, locale)}`
    : `${head} – ${f("dm", { day: "numeric", month: "long" }, timeZone, locale).format(end)} ${timeShort(end, timeZone, locale)}`;
}

/** Yüzde (0-100), payda 0 ise 0. */
export function pctOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}
