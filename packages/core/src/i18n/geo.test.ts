import { describe, expect, it } from "vitest";
import {
  extractCountryFromHeaders,
  isSearchBot,
  localeForCountry,
  localeFromAcceptLanguage,
  resolveLocaleAndCountry,
} from "./geo";
import { convertCurrencyMinor, formatCurrencyIntl } from "./currency-service";
import { checkCountryScheduleNotice, DEFAULT_WORKING_HOURS, type CountryDto } from "./locations";

describe("i18n geo & language resolution", () => {
  it("routes TR to Turkish and all other countries (US, DE, JP, GB) to English", () => {
    expect(localeForCountry("TR")).toBe("tr");
    expect(localeForCountry("tr")).toBe("tr");
    expect(localeForCountry("US")).toBe("en");
    expect(localeForCountry("DE")).toBe("en");
    expect(localeForCountry("JP")).toBe("en");
    expect(localeForCountry("GB")).toBe("en");
  });

  it("extracts country from Cloudflare, Vercel, and CloudFront headers in priority order", () => {
    const cf = new Headers({ "cf-ipcountry": "TR", "x-vercel-ip-country": "US" });
    expect(extractCountryFromHeaders((k) => cf.get(k))).toBe("TR");

    const vercel = new Headers({ "x-vercel-ip-country": "DE" });
    expect(extractCountryFromHeaders((k) => vercel.get(k))).toBe("DE");

    const cloudfront = new Headers({ "cloudfront-viewer-country": "JP" });
    expect(extractCountryFromHeaders((k) => cloudfront.get(k))).toBe("JP");

    const invalid = new Headers({ "cf-ipcountry": "XX", "x-vercel-ip-country": "US" });
    expect(extractCountryFromHeaders((k) => invalid.get(k))).toBe("US");
  });

  it("enforces priority: manual preference > CDN header > GeoIP > Accept-Language", () => {
    // Manual override beats CDN header
    expect(
      resolveLocaleAndCountry({
        cookieLocale: "en",
        isManualLocale: true,
        cookieCountry: "TR",
        headerCountry: "TR",
        acceptLanguage: "tr-TR,tr;q=0.9",
      }),
    ).toMatchObject({ locale: "en", source: "manual" });

    // CDN header beats GeoIP and Accept-Language
    expect(
      resolveLocaleAndCountry({
        headerCountry: "DE",
        geoIpCountry: "TR",
        acceptLanguage: "tr-TR,tr;q=0.9",
      }),
    ).toMatchObject({ locale: "en", country: "DE", source: "cdn-header" });

    expect(
      resolveLocaleAndCountry({
        headerCountry: "TR",
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toMatchObject({ locale: "tr", country: "TR", source: "cdn-header" });

    // GeoIP fallback beats Accept-Language
    expect(
      resolveLocaleAndCountry({
        geoIpCountry: "JP",
        acceptLanguage: "tr-TR,tr;q=0.9",
      }),
    ).toMatchObject({ locale: "en", country: "JP", source: "geoip" });

    // Accept-Language fallback
    expect(
      resolveLocaleAndCountry({
        acceptLanguage: "tr-TR,tr;q=0.9,en;q=0.5",
      }),
    ).toMatchObject({ locale: "tr", country: "TR", source: "accept-language" });

    expect(
      resolveLocaleAndCountry({
        acceptLanguage: "de-DE,de;q=0.9,en;q=0.8",
      }),
    ).toMatchObject({ locale: "en", country: "US", source: "accept-language" });
  });

  it("parses Accept-Language quality weights properly", () => {
    expect(localeFromAcceptLanguage("en-US;q=0.6,tr-TR;q=0.9")).toBe("tr");
    expect(localeFromAcceptLanguage("tr-TR;q=0.5,en-US;q=0.9")).toBe("en");
  });

  it("detects search engine bots so they are not geo-redirected", () => {
    expect(isSearchBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isSearchBot("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe(true);
    expect(isSearchBot("Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)")).toBe(true);
    expect(isSearchBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Safari/537.36")).toBe(false);
  });
});

describe("currency service & schedule constraints", () => {
  it("converts and formats currencies including zero-decimal JPY", () => {
    const usdToJpy = convertCurrencyMinor(1000, "USD", "JPY", { USD: 1, JPY: 150 }); // $10 -> ¥1500
    expect(usdToJpy).toBe(1500);
    expect(formatCurrencyIntl(1500, "JPY", "en-US")).toContain("1,500");
    expect(formatCurrencyIntl(25000, "TRY", "tr-TR")).toContain("250");
  });

  it("detects country public holidays and outside working hours", () => {
    const trCountry: CountryDto = {
      id: "c-tr",
      code: "TR",
      names: { tr: "Türkiye", en: "Turkey" },
      currency: "TRY",
      defaultLocale: "tr",
      timezone: "Europe/Istanbul",
      workingHours: DEFAULT_WORKING_HOURS,
      isActive: true,
      sortOrder: 10,
      cities: [],
      holidays: [
        {
          id: "h-1",
          countryId: "c-tr",
          date: "2026-10-29",
          names: { tr: "Cumhuriyet Bayramı", en: "Republic Day" },
          isRecurring: true,
          isActive: true,
        },
      ],
    };

    const hol = checkCountryScheduleNotice(trCountry, "2027-10-29", "14:00", "tr");
    expect(hol.holidayName).toBe("Cumhuriyet Bayramı");
    expect(hol.outsideWorkingHours).toBe(false);

    const late = checkCountryScheduleNotice(trCountry, "2026-11-19", "21:30", "en");
    expect(late.holidayName).toBeNull();
    expect(late.outsideWorkingHours).toBe(true);
  });
});
