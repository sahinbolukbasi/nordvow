import { prisma } from "../db";
import {
  DEFAULT_WORKING_HOURS,
  localizedName,
  type CityDto,
  type CountryDto,
  type DayWorkingHours,
  type HolidayDto,
  type LocalizedNames,
  type WorkingHoursMap,
} from "./location-utils";

export {
  checkCountryScheduleNotice,
  DEFAULT_WORKING_HOURS,
  localizedName,
  type CityDto,
  type CountryDto,
  type DayWorkingHours,
  type HolidayDto,
  type LocalizedNames,
  type WorkingHoursMap,
} from "./location-utils";

type SeedCountry = {
  code: string;
  names: LocalizedNames;
  currency: string;
  defaultLocale: string;
  timezone: string;
  sortOrder: number;
  workingHours?: WorkingHoursMap;
  cities: { slug: string; names: LocalizedNames; timezone: string; latitude: number; longitude: number; regionName?: string }[];
  holidays: { date: string; names: LocalizedNames; isRecurring: boolean }[];
};

export const DEFAULT_LOCATION_SEED: SeedCountry[] = [
  {
    code: "TR",
    names: { tr: "Türkiye", en: "Turkey" },
    currency: "TRY",
    defaultLocale: "tr",
    timezone: "Europe/Istanbul",
    sortOrder: 10,
    cities: [
      { slug: "istanbul", names: { tr: "İstanbul", en: "Istanbul" }, timezone: "Europe/Istanbul", latitude: 41.0082, longitude: 28.9784, regionName: "Marmara" },
      { slug: "ankara", names: { tr: "Ankara", en: "Ankara" }, timezone: "Europe/Istanbul", latitude: 39.9334, longitude: 32.8597, regionName: "İç Anadolu" },
      { slug: "izmir", names: { tr: "İzmir", en: "Izmir" }, timezone: "Europe/Istanbul", latitude: 38.4237, longitude: 27.1428, regionName: "Ege" },
      { slug: "antalya", names: { tr: "Antalya", en: "Antalya" }, timezone: "Europe/Istanbul", latitude: 36.8969, longitude: 30.7133, regionName: "Akdeniz" },
      { slug: "bursa", names: { tr: "Bursa", en: "Bursa" }, timezone: "Europe/Istanbul", latitude: 40.1885, longitude: 29.061, regionName: "Marmara" },
      { slug: "bodrum", names: { tr: "Bodrum", en: "Bodrum" }, timezone: "Europe/Istanbul", latitude: 37.0344, longitude: 27.4305, regionName: "Muğla" },
    ],
    holidays: [
      { date: "2026-01-01", names: { tr: "Yılbaşı", en: "New Year's Day" }, isRecurring: true },
      { date: "2026-04-23", names: { tr: "Ulusal Egemenlik ve Çocuk Bayramı", en: "National Sovereignty and Children's Day" }, isRecurring: true },
      { date: "2026-05-01", names: { tr: "Emek ve Dayanışma Günü", en: "Labour and Solidarity Day" }, isRecurring: true },
      { date: "2026-05-19", names: { tr: "Atatürk'ü Anma, Gençlik ve Spor Bayramı", en: "Commemoration of Atatürk, Youth and Sports Day" }, isRecurring: true },
      { date: "2026-08-30", names: { tr: "Zafer Bayramı", en: "Victory Day" }, isRecurring: true },
      { date: "2026-10-29", names: { tr: "Cumhuriyet Bayramı", en: "Republic Day" }, isRecurring: true },
    ],
  },
  {
    code: "US",
    names: { tr: "Amerika Birleşik Devletleri", en: "United States" },
    currency: "USD",
    defaultLocale: "en",
    timezone: "America/New_York",
    sortOrder: 20,
    cities: [
      { slug: "new-york", names: { tr: "New York", en: "New York" }, timezone: "America/New_York", latitude: 40.7128, longitude: -74.006, regionName: "New York" },
      { slug: "los-angeles", names: { tr: "Los Angeles", en: "Los Angeles" }, timezone: "America/Los_Angeles", latitude: 34.0522, longitude: -118.2437, regionName: "California" },
      { slug: "san-francisco", names: { tr: "San Francisco", en: "San Francisco" }, timezone: "America/Los_Angeles", latitude: 37.7749, longitude: -122.4194, regionName: "California" },
      { slug: "chicago", names: { tr: "Chicago", en: "Chicago" }, timezone: "America/Chicago", latitude: 41.8781, longitude: -87.6298, regionName: "Illinois" },
      { slug: "miami", names: { tr: "Miami", en: "Miami" }, timezone: "America/New_York", latitude: 25.7617, longitude: -80.1918, regionName: "Florida" },
      { slug: "austin", names: { tr: "Austin", en: "Austin" }, timezone: "America/Chicago", latitude: 30.2672, longitude: -97.7431, regionName: "Texas" },
    ],
    holidays: [
      { date: "2026-01-01", names: { tr: "Yılbaşı", en: "New Year's Day" }, isRecurring: true },
      { date: "2026-07-04", names: { tr: "Bağımsızlık Günü", en: "Independence Day" }, isRecurring: true },
      { date: "2026-11-26", names: { tr: "Şükran Günü", en: "Thanksgiving Day" }, isRecurring: false },
      { date: "2026-12-25", names: { tr: "Noel", en: "Christmas Day" }, isRecurring: true },
    ],
  },
  {
    code: "GB",
    names: { tr: "Birleşik Krallık", en: "United Kingdom" },
    currency: "GBP",
    defaultLocale: "en",
    timezone: "Europe/London",
    sortOrder: 30,
    cities: [
      { slug: "london", names: { tr: "Londra", en: "London" }, timezone: "Europe/London", latitude: 51.5074, longitude: -0.1278, regionName: "England" },
      { slug: "manchester", names: { tr: "Manchester", en: "Manchester" }, timezone: "Europe/London", latitude: 53.4808, longitude: -2.2426, regionName: "England" },
      { slug: "edinburgh", names: { tr: "Edinburg", en: "Edinburgh" }, timezone: "Europe/London", latitude: 55.9533, longitude: -3.1883, regionName: "Scotland" },
    ],
    holidays: [
      { date: "2026-01-01", names: { tr: "Yılbaşı", en: "New Year's Day" }, isRecurring: true },
      { date: "2026-12-25", names: { tr: "Noel", en: "Christmas Day" }, isRecurring: true },
      { date: "2026-12-26", names: { tr: "Boxing Day", en: "Boxing Day" }, isRecurring: true },
    ],
  },
  {
    code: "DE",
    names: { tr: "Almanya", en: "Germany" },
    currency: "EUR",
    defaultLocale: "en",
    timezone: "Europe/Berlin",
    sortOrder: 40,
    cities: [
      { slug: "berlin", names: { tr: "Berlin", en: "Berlin" }, timezone: "Europe/Berlin", latitude: 52.52, longitude: 13.405, regionName: "Berlin" },
      { slug: "munich", names: { tr: "Münih", en: "Munich" }, timezone: "Europe/Berlin", latitude: 48.1351, longitude: 11.582, regionName: "Bavaria" },
      { slug: "hamburg", names: { tr: "Hamburg", en: "Hamburg" }, timezone: "Europe/Berlin", latitude: 53.5511, longitude: 9.9937, regionName: "Hamburg" },
      { slug: "frankfurt", names: { tr: "Frankfurt", en: "Frankfurt" }, timezone: "Europe/Berlin", latitude: 50.1109, longitude: 8.6821, regionName: "Hesse" },
    ],
    holidays: [
      { date: "2026-01-01", names: { tr: "Yılbaşı", en: "New Year's Day" }, isRecurring: true },
      { date: "2026-05-01", names: { tr: "İşçi Bayramı", en: "Labour Day" }, isRecurring: true },
      { date: "2026-10-03", names: { tr: "Alman Birliği Günü", en: "German Unity Day" }, isRecurring: true },
      { date: "2026-12-25", names: { tr: "Noel", en: "Christmas Day" }, isRecurring: true },
    ],
  },
  {
    code: "FR",
    names: { tr: "Fransa", en: "France" },
    currency: "EUR",
    defaultLocale: "en",
    timezone: "Europe/Paris",
    sortOrder: 50,
    cities: [
      { slug: "paris", names: { tr: "Paris", en: "Paris" }, timezone: "Europe/Paris", latitude: 48.8566, longitude: 2.3522, regionName: "Île-de-France" },
      { slug: "lyon", names: { tr: "Lyon", en: "Lyon" }, timezone: "Europe/Paris", latitude: 45.764, longitude: 4.8357, regionName: "Auvergne-Rhône-Alpes" },
      { slug: "nice", names: { tr: "Nice", en: "Nice" }, timezone: "Europe/Paris", latitude: 43.7102, longitude: 7.262, regionName: "Provence-Alpes-Côte d'Azur" },
    ],
    holidays: [
      { date: "2026-01-01", names: { tr: "Yılbaşı", en: "New Year's Day" }, isRecurring: true },
      { date: "2026-07-14", names: { tr: "Bastille Günü", en: "Bastille Day" }, isRecurring: true },
      { date: "2026-12-25", names: { tr: "Noel", en: "Christmas Day" }, isRecurring: true },
    ],
  },
  {
    code: "NL",
    names: { tr: "Hollanda", en: "Netherlands" },
    currency: "EUR",
    defaultLocale: "en",
    timezone: "Europe/Amsterdam",
    sortOrder: 60,
    cities: [
      { slug: "amsterdam", names: { tr: "Amsterdam", en: "Amsterdam" }, timezone: "Europe/Amsterdam", latitude: 52.3676, longitude: 4.9041, regionName: "North Holland" },
      { slug: "rotterdam", names: { tr: "Rotterdam", en: "Rotterdam" }, timezone: "Europe/Amsterdam", latitude: 51.9244, longitude: 4.4777, regionName: "South Holland" },
    ],
    holidays: [
      { date: "2026-01-01", names: { tr: "Yılbaşı", en: "New Year's Day" }, isRecurring: true },
      { date: "2026-04-27", names: { tr: "Kral Günü", en: "King's Day" }, isRecurring: true },
    ],
  },
  {
    code: "JP",
    names: { tr: "Japonya", en: "Japan" },
    currency: "JPY",
    defaultLocale: "en",
    timezone: "Asia/Tokyo",
    sortOrder: 70,
    cities: [
      { slug: "tokyo", names: { tr: "Tokyo", en: "Tokyo" }, timezone: "Asia/Tokyo", latitude: 35.6762, longitude: 139.6503, regionName: "Kanto" },
      { slug: "osaka", names: { tr: "Osaka", en: "Osaka" }, timezone: "Asia/Tokyo", latitude: 34.6937, longitude: 135.5023, regionName: "Kansai" },
      { slug: "kyoto", names: { tr: "Kyoto", en: "Kyoto" }, timezone: "Asia/Tokyo", latitude: 35.0116, longitude: 135.7681, regionName: "Kansai" },
    ],
    holidays: [
      { date: "2026-01-01", names: { tr: "Yılbaşı", en: "New Year's Day" }, isRecurring: true },
      { date: "2026-02-11", names: { tr: "Ulusal Kuruluş Günü", en: "National Foundation Day" }, isRecurring: true },
      { date: "2026-05-03", names: { tr: "Anayasa Günü", en: "Constitution Memorial Day" }, isRecurring: true },
    ],
  },
  {
    code: "AE",
    names: { tr: "Birleşik Arap Emirlikleri", en: "United Arab Emirates" },
    currency: "AED",
    defaultLocale: "en",
    timezone: "Asia/Dubai",
    sortOrder: 80,
    cities: [
      { slug: "dubai", names: { tr: "Dubai", en: "Dubai" }, timezone: "Asia/Dubai", latitude: 25.2048, longitude: 55.2708, regionName: "Dubai" },
      { slug: "abu-dhabi", names: { tr: "Abu Dabi", en: "Abu Dhabi" }, timezone: "Asia/Dubai", latitude: 24.4539, longitude: 54.3773, regionName: "Abu Dhabi" },
    ],
    holidays: [
      { date: "2026-01-01", names: { tr: "Yılbaşı", en: "New Year's Day" }, isRecurring: true },
      { date: "2026-12-02", names: { tr: "BAE Ulusal Günü", en: "UAE National Day" }, isRecurring: true },
    ],
  },
];

function fallbackLocations(): CountryDto[] {
  return DEFAULT_LOCATION_SEED.map((c) => ({
    id: `seed-${c.code.toLowerCase()}`,
    code: c.code,
    names: c.names,
    currency: c.currency,
    defaultLocale: c.defaultLocale,
    timezone: c.timezone,
    workingHours: c.workingHours ?? DEFAULT_WORKING_HOURS,
    isActive: true,
    sortOrder: c.sortOrder,
    cities: c.cities.map((city, idx) => ({
      id: `seed-${c.code.toLowerCase()}-${city.slug}`,
      countryId: `seed-${c.code.toLowerCase()}`,
      slug: city.slug,
      names: city.names,
      regionName: city.regionName ?? null,
      timezone: city.timezone,
      latitude: city.latitude,
      longitude: city.longitude,
      isActive: true,
      sortOrder: (idx + 1) * 10,
    })),
    holidays: c.holidays.map((h, idx) => ({
      id: `seed-hol-${c.code.toLowerCase()}-${idx}`,
      countryId: `seed-${c.code.toLowerCase()}`,
      date: h.date,
      names: h.names,
      isRecurring: h.isRecurring,
      isActive: true,
    })),
  }));
}

let seededOnce = false;

/** Ülke/şehir tabloları boşsa varsayılan global veri setini bir kez doldurur. */
export async function ensureDefaultLocationsSeeded(): Promise<void> {
  if (seededOnce) return;
  try {
    const count = await prisma.country.count();
    if (count > 0) {
      seededOnce = true;
      return;
    }
    for (const c of DEFAULT_LOCATION_SEED) {
      const country = await prisma.country.upsert({
        where: { code: c.code },
        update: {},
        create: {
          code: c.code,
          names: c.names,
          currency: c.currency,
          defaultLocale: c.defaultLocale,
          timezone: c.timezone,
          workingHours: c.workingHours ?? DEFAULT_WORKING_HOURS,
          isActive: true,
          sortOrder: c.sortOrder,
        },
      });
      for (let i = 0; i < c.cities.length; i++) {
        const city = c.cities[i]!;
        await prisma.city.upsert({
          where: { countryId_slug: { countryId: country.id, slug: city.slug } },
          update: {},
          create: {
            countryId: country.id,
            slug: city.slug,
            names: city.names,
            regionName: city.regionName ?? null,
            timezone: city.timezone,
            latitude: city.latitude,
            longitude: city.longitude,
            isActive: true,
            sortOrder: (i + 1) * 10,
          },
        });
      }
      for (const h of c.holidays) {
        await prisma.publicHoliday.upsert({
          where: { countryId_date: { countryId: country.id, date: h.date } },
          update: {},
          create: {
            countryId: country.id,
            date: h.date,
            names: h.names,
            isRecurring: h.isRecurring,
            isActive: true,
          },
        });
      }
    }
    seededOnce = true;
  } catch {
    // DB henüz hazır değilse statik yedek kullanılır.
  }
}

function normalizeWorkingHours(raw: unknown): WorkingHoursMap {
  if (!raw || typeof raw !== "object") return DEFAULT_WORKING_HOURS;
  const r = raw as Partial<WorkingHoursMap>;
  return {
    mon: r.mon ?? DEFAULT_WORKING_HOURS.mon,
    tue: r.tue ?? DEFAULT_WORKING_HOURS.tue,
    wed: r.wed ?? DEFAULT_WORKING_HOURS.wed,
    thu: r.thu ?? DEFAULT_WORKING_HOURS.thu,
    fri: r.fri ?? DEFAULT_WORKING_HOURS.fri,
    sat: r.sat ?? DEFAULT_WORKING_HOURS.sat,
    sun: r.sun ?? DEFAULT_WORKING_HOURS.sun,
  };
}

/** Aktif ülkeleri, şehirlerini ve resmî tatillerini döndürür. DB erişilemezse yedek liste döner. */
export async function listLocations(options?: { includeInactive?: boolean }): Promise<CountryDto[]> {
  try {
    await ensureDefaultLocationsSeeded();
    const where = options?.includeInactive ? {} : { isActive: true };
    const rows = await prisma.country.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
      include: {
        cities: {
          where: options?.includeInactive ? {} : { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { slug: "asc" }],
        },
        holidays: {
          where: options?.includeInactive ? {} : { isActive: true },
          orderBy: { date: "asc" },
        },
      },
    });
    if (!rows.length && !options?.includeInactive) return fallbackLocations();
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      names: (r.names ?? {}) as LocalizedNames,
      currency: r.currency,
      defaultLocale: r.defaultLocale,
      timezone: r.timezone,
      workingHours: normalizeWorkingHours(r.workingHours),
      isActive: r.isActive,
      sortOrder: r.sortOrder,
      cities: r.cities.map((c) => ({
        id: c.id,
        countryId: c.countryId,
        slug: c.slug,
        names: (c.names ?? {}) as LocalizedNames,
        regionName: c.regionName,
        timezone: c.timezone,
        latitude: c.latitude,
        longitude: c.longitude,
        isActive: c.isActive,
        sortOrder: c.sortOrder,
      })),
      holidays: r.holidays.map((h) => ({
        id: h.id,
        countryId: h.countryId,
        date: h.date,
        names: (h.names ?? {}) as LocalizedNames,
        isRecurring: h.isRecurring,
        isActive: h.isActive,
      })),
    }));
  } catch {
    return fallbackLocations();
  }
}
