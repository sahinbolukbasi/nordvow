/**
 * Ayrı kur dönüşümü ve çoklu para birimi biçimlendirme servis katmanı.
 * Varsayılan olarak tüm tutarlar kendi para biriminde saklanır; gerektiğinde
 * canlı veya önbellekli kur tablosu üzerinden dönüşüm yapılır.
 */

export const SUPPORTED_CURRENCIES = ["TRY", "USD", "EUR", "GBP", "JPY", "AED", "CHF", "CAD", "AUD"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** 1 USD = X birim (canlı servis erişilemediğinde yedek oranlar). */
export const FALLBACK_USD_RATES: Record<string, number> = {
  USD: 1,
  TRY: 38.5,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 154.0,
  AED: 3.67,
  CHF: 0.88,
  CAD: 1.39,
  AUD: 1.54,
};

/** 0 ondalıklı (alt birimsiz) para birimleri (ör. JPY). */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND"]);

export function currencyExponent(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function minorToMajor(minor: number | bigint, currency: string): number {
  const exp = currencyExponent(currency);
  return exp === 0 ? Number(minor) : Number(minor) / 10 ** exp;
}

export function majorToMinor(major: number, currency: string): number {
  const exp = currencyExponent(currency);
  return exp === 0 ? Math.round(major) : Math.round(major * 10 ** exp);
}

export interface FxRateProvider {
  getRates(): Promise<Record<string, number>>;
}

class CachedFxService implements FxRateProvider {
  private cache: { rates: Record<string, number>; expiresAt: number } | null = null;
  private readonly ttlMs = 60 * 60 * 1000; // 1 saat

  async getRates(): Promise<Record<string, number>> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.rates;
    }
    const url = process.env.FX_RATES_API_URL;
    if (!url) {
      return FALLBACK_USD_RATES;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      if (!res.ok) return FALLBACK_USD_RATES;
      const json = (await res.json()) as { rates?: Record<string, number> };
      if (json.rates && typeof json.rates.USD === "number") {
        const merged = { ...FALLBACK_USD_RATES, ...json.rates };
        this.cache = { rates: merged, expiresAt: Date.now() + this.ttlMs };
        return merged;
      }
      return FALLBACK_USD_RATES;
    } catch {
      return FALLBACK_USD_RATES;
    }
  }
}

export const currencyService = new CachedFxService();

/**
 * Küçük birimdeki tutarı `fromCurrency` → `toCurrency` dönüştürür.
 */
export function convertCurrencyMinor(
  minor: number | bigint,
  fromCurrency: string,
  toCurrency: string,
  rates: Record<string, number> = FALLBACK_USD_RATES,
): number {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  const major = minorToMajor(minor, from);
  if (from === to) return Number(minor);
  const fromRate = rates[from] ?? FALLBACK_USD_RATES[from];
  const toRate = rates[to] ?? FALLBACK_USD_RATES[to];
  if (!fromRate || !toRate || fromRate <= 0) return Number(minor);
  const convertedMajor = (major / fromRate) * toRate;
  return majorToMinor(convertedMajor, to);
}

/**
 * Intl.NumberFormat ile dile ve para birimine göre biçimlendirme.
 */
export function formatCurrencyIntl(
  minor: number | bigint,
  currency: string,
  locale: string = "en-US",
): string {
  const code = (currency || "USD").toUpperCase();
  const major = minorToMajor(minor, code);
  const exp = currencyExponent(code);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: exp === 0 ? 0 : major % 1 === 0 ? 0 : 2,
      maximumFractionDigits: exp === 0 ? 0 : 2,
    }).format(major);
  } catch {
    return `${major.toFixed(exp)} ${code}`;
  }
}
