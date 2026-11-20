export type LocalizedNames = Record<string, string>;

export type DayWorkingHours = {
  start: string;
  end: string;
  closed: boolean;
};

export type WorkingHoursMap = {
  mon: DayWorkingHours;
  tue: DayWorkingHours;
  wed: DayWorkingHours;
  thu: DayWorkingHours;
  fri: DayWorkingHours;
  sat: DayWorkingHours;
  sun: DayWorkingHours;
};

export const DEFAULT_WORKING_HOURS: WorkingHoursMap = {
  mon: { start: "09:00", end: "18:00", closed: false },
  tue: { start: "09:00", end: "18:00", closed: false },
  wed: { start: "09:00", end: "18:00", closed: false },
  thu: { start: "09:00", end: "18:00", closed: false },
  fri: { start: "09:00", end: "18:00", closed: false },
  sat: { start: "10:00", end: "14:00", closed: true },
  sun: { start: "10:00", end: "14:00", closed: true },
};

export type CityDto = {
  id: string;
  countryId: string;
  slug: string;
  names: LocalizedNames;
  regionName: string | null;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  sortOrder: number;
};

export type HolidayDto = {
  id: string;
  countryId: string;
  date: string;
  names: LocalizedNames;
  isRecurring: boolean;
  isActive: boolean;
};

export type CountryDto = {
  id: string;
  code: string;
  names: LocalizedNames;
  currency: string;
  defaultLocale: string;
  timezone: string;
  workingHours: WorkingHoursMap;
  isActive: boolean;
  sortOrder: number;
  cities: CityDto[];
  holidays: HolidayDto[];
};

/** Çok dilli JSON nesnesinden seçili dildeki adı döndürür (yedek: en -> tr -> ilk değer). */
export function localizedName(names: unknown, locale: string = "tr"): string {
  if (!names || typeof names !== "object") return "";
  const rec = names as Record<string, unknown>;
  const direct = rec[locale];
  if (typeof direct === "string" && direct.trim()) return direct;
  const fallbackOrder = locale === "tr" ? ["en", "tr"] : ["en", "tr"];
  for (const k of fallbackOrder) {
    if (typeof rec[k] === "string" && (rec[k] as string).trim()) return rec[k] as string;
  }
  const first = Object.values(rec).find((v) => typeof v === "string" && v.trim());
  return typeof first === "string" ? first : "";
}

const DAY_KEYS: (keyof WorkingHoursMap)[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Seçilen tarihin ülke resmi tatiline veya çalışma saatleri dışına denk gelip gelmediğini kontrol eder.
 */
export function checkCountryScheduleNotice(
  country: CountryDto | null | undefined,
  day: string,
  time: string,
  locale: string = "tr",
): { holidayName: string | null; outsideWorkingHours: boolean; workingWindow: string | null } {
  if (!country || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return { holidayName: null, outsideWorkingHours: false, workingWindow: null };
  }
  const mmdd = day.slice(5);
  const hol = country.holidays.find(
    (h) => h.isActive && (h.date === day || (h.isRecurring && h.date.slice(5) === mmdd)),
  );
  const holidayName = hol ? localizedName(hol.names, locale) : null;

  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const key = DAY_KEYS[dow] ?? "mon";
  const wh = country.workingHours[key];
  if (!wh) return { holidayName, outsideWorkingHours: false, workingWindow: null };
  if (wh.closed) {
    return { holidayName, outsideWorkingHours: true, workingWindow: null };
  }
  const outside = Boolean(time && (time < wh.start || time > wh.end));
  return { holidayName, outsideWorkingHours: outside, workingWindow: `${wh.start}–${wh.end}` };
}

