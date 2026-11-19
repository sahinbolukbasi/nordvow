import { cache } from "react";
import { cookies, headers } from "next/headers";
import { prisma } from "@infulancer/core/db";
import { DEFAULT_REGION, detectRegion, isLocale, isRegion, regionOf, type Locale, type Region } from "@infulancer/core/i18n/regions";
import { auth } from "@/auth";
import { getUserStatus } from "@/lib/auth-guard";
import { translate } from "./dict";

export const LOCALE_COOKIE = "nv_locale";
export const COUNTRY_COOKIE = "nv_country";

/**
 * Etkin dil ve bölge: girişli kullanıcıda hesap ayarı, yoksa ilk ziyarette otomatik algılanan
 * (Cloudflare/CloudFront ülke başlığı + tarayıcı dili → proxy çerezi). Her istekte bir kez okunur.
 */
export const getPreferences = cache(async (): Promise<{ locale: Locale; region: Region }> => {
  const jar = await cookies();
  let locale = jar.get(LOCALE_COOKIE)?.value;
  let country = jar.get(COUNTRY_COOKIE)?.value;
  if (!locale || !country) {
    // İlk istek: çerez henüz yok → başlıklardan algıla (proxy aynı değeri çereze yazar).
    const h = await headers();
    const d = detectRegion({ ipCountry: h.get("cf-ipcountry") ?? h.get("cloudfront-viewer-country"), acceptLanguage: h.get("accept-language") });
    locale ??= d.locale;
    country ??= d.country;
  }
  const session = await auth().catch(() => null);
  const userId = session?.user?.id;
  if (userId) {
    // getUserStatus React.cache ile memoize edilir: aynı istekte auth-guard ile tek DB sorgusunu paylaşır.
    const u = await getUserStatus(userId);
    if (u?.locale) locale = u.locale;
    if (u?.country) country = u.country;
    // İlk girişte algılanan tercih hesaba yazılır (arka planda, sayfa açılışını bekletmeden).
    if (u && (!u.locale || !u.country) && (isLocale(locale) || isRegion(country))) {
      void prisma.user.update({ where: { id: userId }, data: { locale: u.locale ?? (isLocale(locale) ? locale : null), country: u.country ?? (isRegion(country) ? country!.toUpperCase() : null) } }).catch(() => undefined);
    }
  }
  const region = isRegion(country) ? regionOf(country) : DEFAULT_REGION;
  return { locale: isLocale(locale) ? locale : region.locale, region };
});

/** Sunucu bileşenlerinde çeviri: t("anahtar", "Türkçe metin"). */
export async function getT() {
  const { locale } = await getPreferences();
  return (key: string, fallback: string) => translate(locale, key, fallback);
}
