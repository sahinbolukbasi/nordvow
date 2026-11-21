"use server";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { DEFAULT_WORKING_HOURS, type WorkingHoursMap } from "@infulancer/core/i18n/locations";
import { isLocale } from "@infulancer/core/i18n/regions";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { attempt, parseInput, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";
import { isValidTimeZone } from "@/lib/time";

const countrySchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().min(2).max(2).transform((v) => v.toUpperCase()),
  nameTr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  currency: z.string().trim().min(3).max(3).transform((v) => v.toUpperCase()),
  defaultLocale: z.string().refine((v) => isLocale(v), { message: "Geçersiz dil." }),
  timezone: z.string().refine(isValidTimeZone, { message: "Geçersiz IANA saat dilimi." }),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});

export async function upsertCountryAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const input = parseInput(countrySchema, {
      id: str(fd, "id") || undefined,
      code: str(fd, "code"),
      nameTr: str(fd, "nameTr"),
      nameEn: str(fd, "nameEn"),
      currency: str(fd, "currency"),
      defaultLocale: str(fd, "defaultLocale") || "en",
      timezone: str(fd, "timezone") || "UTC",
      sortOrder: Number(str(fd, "sortOrder") || "100"),
    });

    const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
    const workingHours: WorkingHoursMap = { ...DEFAULT_WORKING_HOURS };
    for (const d of days) {
      const start = str(fd, `wh_${d}_start`) || DEFAULT_WORKING_HOURS[d].start;
      const end = str(fd, `wh_${d}_end`) || DEFAULT_WORKING_HOURS[d].end;
      const closed = fd.get(`wh_${d}_closed`) === "on" || str(fd, `wh_${d}_closed`) === "true";
      workingHours[d] = { start, end, closed };
    }

    const names = { tr: input.nameTr, en: input.nameEn };
    const row = input.id && !input.id.startsWith("seed-")
      ? await prisma.country.update({
          where: { id: input.id },
          data: {
            code: input.code,
            names,
            currency: input.currency,
            defaultLocale: input.defaultLocale,
            timezone: input.timezone,
            workingHours,
            sortOrder: input.sortOrder,
          },
        })
      : await prisma.country.upsert({
          where: { code: input.code },
          update: {
            names,
            currency: input.currency,
            defaultLocale: input.defaultLocale,
            timezone: input.timezone,
            workingHours,
            sortOrder: input.sortOrder,
          },
          create: {
            code: input.code,
            names,
            currency: input.currency,
            defaultLocale: input.defaultLocale,
            timezone: input.timezone,
            workingHours,
            isActive: true,
            sortOrder: input.sortOrder,
          },
        });

    await audit.append({
      actor: toAuditActor(actor),
      action: "COUNTRY_UPSERTED",
      entityType: "Country",
      entityId: row.id,
      data: { code: row.code, currency: row.currency },
    });
    revalidateAll();
    return { ok: true, message: `${row.code} kaydedildi.` };
  });
}

export async function toggleCountryActiveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    const isActive = str(fd, "isActive") === "true";
    const row = await prisma.country.update({ where: { id }, data: { isActive } });
    await audit.append({
      actor: toAuditActor(actor),
      action: "COUNTRY_STATUS",
      entityType: "Country",
      entityId: row.id,
      data: { isActive },
    });
    revalidateAll();
    return { ok: true, message: isActive ? "Ülke aktifleştirildi." : "Ülke pasif yapıldı." };
  });
}

const citySchema = z.object({
  id: z.string().optional(),
  countryId: z.string().min(1),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/, { message: "Slug yalnız küçük harf, rakam ve tire olabilir." }),
  nameTr: z.string().trim().min(2).max(120),
  nameEn: z.string().trim().min(2).max(120),
  regionName: z.string().trim().max(120).optional(),
  timezone: z.string().refine(isValidTimeZone, { message: "Geçersiz IANA saat dilimi." }),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
});

export async function upsertCityAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const latRaw = str(fd, "latitude");
    const lngRaw = str(fd, "longitude");
    const input = parseInput(citySchema, {
      id: str(fd, "id") || undefined,
      countryId: str(fd, "countryId"),
      slug: (str(fd, "slug") || str(fd, "nameEn")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      nameTr: str(fd, "nameTr"),
      nameEn: str(fd, "nameEn"),
      regionName: str(fd, "regionName") || undefined,
      timezone: str(fd, "timezone"),
      latitude: latRaw ? Number(latRaw.replace(",", ".")) : null,
      longitude: lngRaw ? Number(lngRaw.replace(",", ".")) : null,
    });

    const names = { tr: input.nameTr, en: input.nameEn };
    const row = input.id && !input.id.startsWith("seed-")
      ? await prisma.city.update({
          where: { id: input.id },
          data: {
            slug: input.slug,
            names,
            regionName: input.regionName ?? null,
            timezone: input.timezone,
            latitude: input.latitude,
            longitude: input.longitude,
          },
        })
      : await prisma.city.upsert({
          where: { countryId_slug: { countryId: input.countryId, slug: input.slug } },
          update: {
            names,
            regionName: input.regionName ?? null,
            timezone: input.timezone,
            latitude: input.latitude,
            longitude: input.longitude,
          },
          create: {
            countryId: input.countryId,
            slug: input.slug,
            names,
            regionName: input.regionName ?? null,
            timezone: input.timezone,
            latitude: input.latitude,
            longitude: input.longitude,
            isActive: true,
          },
        });

    await audit.append({
      actor: toAuditActor(actor),
      action: "CITY_UPSERTED",
      entityType: "City",
      entityId: row.id,
      data: { slug: row.slug, timezone: row.timezone },
    });
    revalidateAll();
    return { ok: true, message: `${input.nameTr} kaydedildi.` };
  });
}

export async function toggleCityActiveAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    const isActive = str(fd, "isActive") === "true";
    const row = await prisma.city.update({ where: { id }, data: { isActive } });
    await audit.append({
      actor: toAuditActor(actor),
      action: "CITY_STATUS",
      entityType: "City",
      entityId: row.id,
      data: { isActive },
    });
    revalidateAll();
    return { ok: true, message: isActive ? "Şehir aktifleştirildi." : "Şehir pasif yapıldı." };
  });
}

const holidaySchema = z.object({
  countryId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Tarih YYYY-AA-GG biçiminde olmalı." }),
  nameTr: z.string().trim().min(2).max(160),
  nameEn: z.string().trim().min(2).max(160),
  isRecurring: z.boolean(),
});

export async function upsertHolidayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const input = parseInput(holidaySchema, {
      countryId: str(fd, "countryId"),
      date: str(fd, "date"),
      nameTr: str(fd, "nameTr"),
      nameEn: str(fd, "nameEn"),
      isRecurring: fd.get("isRecurring") === "on" || str(fd, "isRecurring") === "true",
    });

    const row = await prisma.publicHoliday.upsert({
      where: { countryId_date: { countryId: input.countryId, date: input.date } },
      update: { names: { tr: input.nameTr, en: input.nameEn }, isRecurring: input.isRecurring, isActive: true },
      create: {
        countryId: input.countryId,
        date: input.date,
        names: { tr: input.nameTr, en: input.nameEn },
        isRecurring: input.isRecurring,
        isActive: true,
      },
    });
    await audit.append({
      actor: toAuditActor(actor),
      action: "HOLIDAY_UPSERTED",
      entityType: "PublicHoliday",
      entityId: row.id,
      data: { date: row.date },
    });
    revalidateAll();
    return { ok: true, message: "Resmî tatil kaydedildi." };
  });
}

export async function deleteHolidayAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    await prisma.publicHoliday.delete({ where: { id } });
    await audit.append({
      actor: toAuditActor(actor),
      action: "HOLIDAY_DELETED",
      entityType: "PublicHoliday",
      entityId: id,
      data: {},
    });
    revalidateAll();
    return { ok: true, message: "Resmî tatil silindi." };
  });
}

export async function saveTranslationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const locale = str(fd, "locale");
    const key = str(fd, "key");
    const value = str(fd, "value");
    if (!isLocale(locale)) throw new DomainError("DOGRULAMA", "Geçersiz dil.");
    if (!key) throw new DomainError("DOGRULAMA", "Çeviri anahtarı gerekli.");

    const row = await prisma.translationOverride.upsert({
      where: { locale_key: { locale, key } },
      update: { value },
      create: { locale, key, value },
    });
    await audit.append({
      actor: toAuditActor(actor),
      action: "TRANSLATION_UPDATED",
      entityType: "TranslationOverride",
      entityId: row.id,
      data: { locale, key },
    });
    revalidateAll();
    return { ok: true, message: "Çeviri kaydedildi." };
  });
}
