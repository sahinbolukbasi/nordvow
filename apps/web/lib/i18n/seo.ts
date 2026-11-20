import type { Metadata } from "next";
import type { Locale } from "@infulancer/core/i18n/regions";
import { BRAND_NAME } from "@/lib/brand";

export const SITE_LOCALES = ["tr", "en"] as const;
export type SiteLocale = (typeof SITE_LOCALES)[number];

export function siteBaseUrl(): string {
  return (process.env.APP_URL ?? "https://nordvow.com").replace(/\/+$/, "");
}

/** Yol önündeki /tr veya /en önekini temizleyip normalize eder ("/" veya "/blog"). */
export function stripLocalePrefix(pathname: string): string {
  const cleaned = pathname.replace(/^\/(tr|en)(?=\/|$)/, "") || "/";
  return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

/** Verilen rota için dil önekli URL üretir ("/tr/blog" veya "/en/blog"). */
export function localizedPath(pathname: string, locale: string): string {
  const loc: SiteLocale = locale === "tr" ? "tr" : "en";
  const base = stripLocalePrefix(pathname);
  return base === "/" ? `/${loc}` : `/${loc}${base}`;
}

/**
 * Her sayfa için hreflang (tr, en, x-default), canonical ve dile göre OpenGraph metadata üretir.
 */
export function buildLocalizedMetadata(input: {
  pathname: string;
  locale: Locale | string;
  title?: string;
  description?: string;
}): Metadata {
  const baseUrl = siteBaseUrl();
  const cleanPath = stripLocalePrefix(input.pathname);
  const activeLocale: SiteLocale = input.locale === "tr" ? "tr" : "en";

  const trUrl = `${baseUrl}${localizedPath(cleanPath, "tr")}`;
  const enUrl = `${baseUrl}${localizedPath(cleanPath, "en")}`;
  const canonical = activeLocale === "tr" ? trUrl : enUrl;

  const defaultTitle =
    activeLocale === "tr"
      ? `${BRAND_NAME} · Influencer pazarlama ve operasyon platformu`
      : `${BRAND_NAME} · Global influencer marketing & operations platform`;
  const defaultDesc =
    activeLocale === "tr"
      ? "Influencer kampanyalarını brief'ten ödemeye kadar tek panelden yönetin: doğru içerik üreticisi, ölçülebilir sonuç."
      : "Manage influencer campaigns from brief to payout in one workspace: right creators, measurable outcomes.";

  const title = input.title ?? defaultTitle;
  const description = input.description ?? defaultDesc;

  return {
    title,
    description,
    alternates: {
      canonical,
      languages: {
        tr: trUrl,
        en: enUrl,
        "x-default": enUrl,
      },
    },
    openGraph: {
      type: "website",
      siteName: BRAND_NAME,
      title,
      description,
      url: canonical,
      locale: activeLocale === "tr" ? "tr_TR" : "en_US",
      alternateLocale: activeLocale === "tr" ? ["en_US"] : ["tr_TR"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}
