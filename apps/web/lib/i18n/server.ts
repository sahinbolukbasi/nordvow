import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@infulancer/core/db";
import { extractCountryFromHeaders, resolveLocaleAndCountry } from "@infulancer/core/i18n/geo";
import { DEFAULT_REGION, isLocale, isRegion, regionOf, type Locale, type Region } from "@infulancer/core/i18n/regions";
import { auth } from "@/auth";
import { getUserStatus } from "@/lib/auth-guard";
import { translate } from "./dict";

export const LOCALE_COOKIE = "nv_locale";
export const COUNTRY_COOKIE = "nv_country";
export const LOCALE_MANUAL_COOKIE = "nv_locale_manual";

/**
 * Etkin dil ve bölge:
 * Öncelik sırası:
 * 1) URL öneki (/tr/... veya /en/...) -> proxy x-locale başlığı
 * 2) Kullanıcının elle seçtiği dil (nv_locale_manual=1 + nv_locale çerezi)
 * 3) CDN/proxy ülke başlığı -> IP geolocation yedeği -> Accept-Language
 * Kural: Türkiye (TR) -> tr, diğer tüm ülkeler -> en.
 */
export const getPreferences = cache(async (): Promise<{ locale: Locale; region: Region; detectedCountry: string }> => {
  const [jar, h] = await Promise.all([cookies(), headers()]);
  const urlLocale = h.get("x-locale");
  const isManual = jar.get(LOCALE_MANUAL_COOKIE)?.value === "1";
  const cookieLocale = jar.get(LOCALE_COOKIE)?.value;
  const cookieCountry = jar.get(COUNTRY_COOKIE)?.value;
  const headerCountry = h.get("x-detected-country") ?? extractCountryFromHeaders((name) => h.get(name));

  const resolved = resolveLocaleAndCountry({
    cookieLocale: isLocale(urlLocale) ? urlLocale : cookieLocale,
    isManualLocale: isLocale(urlLocale) || isManual,
    cookieCountry,
    headerCountry,
    acceptLanguage: h.get("accept-language"),
  });

  let locale: Locale = resolved.locale;
  let country: string = resolved.country;

  // Girişli kullanıcının kayıtlı ülke/dil tercihi varsa (URL öneki ve manuel seçim hariç) uygula.
  const session = await auth().catch(() => null);
  const userId = session?.user?.id;
  if (userId) {
    const u = await getUserStatus(userId).catch(() => null);
    if (!isLocale(urlLocale) && !isManual && u?.locale && isLocale(u.locale)) {
      locale = u.locale;
    }
    if (!isManual && u?.country && isRegion(u.country)) {
      country = u.country;
    }
    if (u && (!u.locale || !u.country) && (isLocale(locale) || isRegion(country))) {
      void prisma.user
        .update({
          where: { id: userId },
          data: {
            locale: u.locale ?? (isLocale(locale) ? locale : null),
            country: u.country ?? (isRegion(country) ? country.toUpperCase() : null),
          },
        })
        .catch(() => undefined);
    }
  }

  const region = isRegion(country) ? regionOf(country) : DEFAULT_REGION;
  return {
    locale: isLocale(locale) ? locale : "en",
    region,
    detectedCountry: country,
  };
});

/** Sunucu bileşenlerinde çeviri: t("anahtar", "Türkçe metin"). */
export async function getT() {
  const { locale } = await getPreferences();
  return (key: string, fallback: string) => translate(locale, key, fallback);
}
