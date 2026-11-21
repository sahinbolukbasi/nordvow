import { createHash } from "node:crypto";
import { isLocale, type Locale } from "./regions";

/** Arama motoru ve sosyal önizleme botlarını algılar; botlar konuma göre yönlendirilmez. */
const BOT_UA_RE =
  /googlebot|bingbot|yandexbot|duckduckbot|baiduspider|slurp|applebot|sogou|exabot|facebot|facebookexternalhit|ia_archiver|twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|pinterest|semrushbot|ahrefsbot|mj12bot|dotbot|petalbot|gptbot|claudebot|oai-searchbot|perplexitybot|bytespider|lighthouse|pagespeed|headlesschrome/i;

export function isSearchBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return BOT_UA_RE.test(userAgent);
}

/** Geçersiz / özel CDN ülke kodları (Cloudflare XX=unknown, T1=Tor, A1/A2=proxy/satellite). */
const INVALID_COUNTRY_CODES = new Set(["XX", "T1", "A1", "A2", "ZZ", "EU"]);

export function normalizeCountryCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean) || INVALID_COUNTRY_CODES.has(clean)) return null;
  return clean;
}

/**
 * CDN / Proxy başlıklarından ülke kodunu (ISO 3166-1 alpha-2) okur.
 * Desteklenen başlıklar: Cloudflare, Vercel, CloudFront, AppEngine, özel proxy.
 */
export function extractCountryFromHeaders(
  getHeader: (name: string) => string | null | undefined,
): string | null {
  const candidates = [
    getHeader("cf-ipcountry"),
    getHeader("x-vercel-ip-country"),
    getHeader("cloudfront-viewer-country"),
    getHeader("x-country-code"),
    getHeader("x-appengine-country"),
  ];
  for (const c of candidates) {
    const code = normalizeCountryCode(c);
    if (code) return code;
  }
  return null;
}

/**
 * Kural: Türkiye'den (TR) girenlere Türkçe (tr), diğer tüm ülkelerden girenlere İngilizce (en).
 */
export function localeForCountry(countryCode: string | null | undefined): "tr" | "en" {
  return normalizeCountryCode(countryCode) === "TR" ? "tr" : "en";
}

/**
 * Tarayıcının Accept-Language başlığını kalite (q) değerine göre çözümler.
 * Türkçe öncelikliyse "tr", aksi halde "en" döner.
 */
export function localeFromAcceptLanguage(acceptLanguage: string | null | undefined): "tr" | "en" {
  if (!acceptLanguage) return "en";
  const parsed = acceptLanguage
    .split(",")
    .map((part) => {
      const [rawTag, ...params] = part.trim().split(";");
      const tag = (rawTag ?? "").trim().toLowerCase();
      let q = 1;
      for (const p of params) {
        const m = /^\s*q=([0-9.]+)\s*$/.exec(p);
        if (m) q = Number(m[1]);
      }
      return { tag, q: Number.isFinite(q) ? q : 0 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const item of parsed) {
    if (item.tag === "tr" || item.tag.startsWith("tr-")) return "tr";
    if (item.tag === "en" || item.tag.startsWith("en-")) return "en";
  }
  return "en";
}

/** Özel/yerel IP aralıklarını tespit eder (geolocation API çağrısı yapılmaz). */
export function isPrivateOrLocalIp(ip: string | null | undefined): boolean {
  if (!ip) return true;
  const v = ip.trim().toLowerCase();
  if (!v || v === "::1" || v === "localhost" || v.startsWith("127.") || v.startsWith("10.") || v.startsWith("192.168.")) {
    return true;
  }
  if (v.startsWith("172.")) {
    const second = Number(v.split(".")[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.")) {
    return true;
  }
  return false;
}

/**
 * Yedek IP → Ülke önbelleği.
 * Gizlilik/KVKK/GDPR: Ham IP ASLA saklanmaz; önbellek anahtarı tek yönlü SHA-256 özetidir.
 */
const geoCache = new Map<string, { country: string | null; expiresAt: number }>();
const GEO_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 saat
const GEO_CACHE_MAX = 2000;

function hashIp(ip: string): string {
  return createHash("sha256").update(`geo:${ip}`).digest("hex").slice(0, 24);
}

/**
 * CDN başlığı olmadığında yedek IP tabanlı ülke algılama servisi.
 * Yalnızca ülke kodu (ISO 2 harf) döner; ham IP hiçbir yere yazılmaz.
 * Test/offline ortamda GEOIP_FALLBACK_ENABLED=false ile kapatılabilir.
 */
export async function lookupCountryByIp(
  rawIp: string | null | undefined,
  options?: { timeoutMs?: number },
): Promise<string | null> {
  if (process.env.GEOIP_FALLBACK_ENABLED === "false") return null;
  const ip = (rawIp ?? "").split(",")[0]?.trim() ?? "";
  if (isPrivateOrLocalIp(ip)) return null;

  const key = hashIp(ip);
  const cached = geoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.country;
  }

  const timeoutMs = options?.timeoutMs ?? 1200;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Özel GEOIP_API_URL varsa onu kullan (ör. https://ipwho.is/{ip}), yoksa ipwho.is yedek.
    const template = process.env.GEOIP_API_URL ?? "https://ipwho.is/{ip}?fields=success,country_code";
    const url = template.replace("{ip}", encodeURIComponent(ip));
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { country_code?: string; countryCode?: string; country?: string };
    const code = normalizeCountryCode(data.country_code ?? data.countryCode ?? data.country);
    if (geoCache.size >= GEO_CACHE_MAX) {
      const firstKey = geoCache.keys().next().value;
      if (firstKey) geoCache.delete(firstKey);
    }
    geoCache.set(key, { country: code, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
    return code;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type GeoResolveInput = {
  /** Kullanıcının daha önce elle seçtiği dil (cookie / localStorage). */
  cookieLocale?: string | null;
  /** Dil seçiminin kullanıcı tarafından elle yapıldığı bilgisi. */
  isManualLocale?: boolean;
  /** Çerezdeki ülke kodu. */
  cookieCountry?: string | null;
  /** CDN / proxy başlığından gelen ülke kodu. */
  headerCountry?: string | null;
  /** IP geolocation yedek servisinden gelen ülke kodu. */
  geoIpCountry?: string | null;
  /** Tarayıcının Accept-Language başlığı. */
  acceptLanguage?: string | null;
};

export type GeoResolveResult = {
  locale: Locale;
  country: string;
  source: "manual" | "cookie" | "cdn-header" | "geoip" | "accept-language" | "default";
};

/**
 * Öncelik sırasına göre dil ve ülke çözümler:
 * 1) Kullanıcının daha önce seçtiği dil (cookie / manuel tercih)
 * 2) CDN/proxy başlığı (CF-IPCountry, x-vercel-ip-country, cloudfront-viewer-country)
 * 3) IP tabanlı geolocation servisi (yedek)
 * 4) Tarayıcının Accept-Language başlığı
 *
 * Kural: Türkiye (TR) -> tr, diğer tüm ülkeler -> en.
 */
export function resolveLocaleAndCountry(input: GeoResolveInput): GeoResolveResult {
  const headerCountry = normalizeCountryCode(input.headerCountry);
  const geoCountry = normalizeCountryCode(input.geoIpCountry);
  const cookieCountry = normalizeCountryCode(input.cookieCountry);
  const detectedCountry = headerCountry ?? geoCountry ?? cookieCountry;

  // 1) Kullanıcının elle seçtiği dil her zaman konum algısını ezer.
  if (input.isManualLocale && isLocale(input.cookieLocale)) {
    return {
      locale: input.cookieLocale,
      country: cookieCountry ?? detectedCountry ?? (input.cookieLocale === "tr" ? "TR" : "US"),
      source: "manual",
    };
  }

  // 1b) Çerezde kayıtlı dil varsa (ör. önceki ziyarette kaydedilmiş) ve çelişen yeni bir CDN başlığı yoksa koru.
  if (isLocale(input.cookieLocale) && !headerCountry) {
    return {
      locale: input.cookieLocale,
      country: cookieCountry ?? geoCountry ?? (input.cookieLocale === "tr" ? "TR" : "US"),
      source: "cookie",
    };
  }

  // 2) CDN / proxy başlığı
  if (headerCountry) {
    return {
      locale: localeForCountry(headerCountry),
      country: headerCountry,
      source: "cdn-header",
    };
  }

  // 3) IP tabanlı geolocation yedeği
  if (geoCountry) {
    return {
      locale: localeForCountry(geoCountry),
      country: geoCountry,
      source: "geoip",
    };
  }

  // 4) Accept-Language başlığı
  if (input.acceptLanguage) {
    const lang = localeFromAcceptLanguage(input.acceptLanguage);
    return {
      locale: lang,
      country: cookieCountry ?? (lang === "tr" ? "TR" : "US"),
      source: "accept-language",
    };
  }

  // 5) Varsayılan
  return {
    locale: "en",
    country: cookieCountry ?? "US",
    source: "default",
  };
}
