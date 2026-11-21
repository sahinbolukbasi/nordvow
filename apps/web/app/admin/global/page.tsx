import type { Metadata } from "next";
import { listLocations } from "@infulancer/core/i18n/locations";
import { LOCALES, type Locale } from "@infulancer/core/i18n/regions";
import { GlobalAdminManager, type TranslationRow } from "@/components/admin/global-manager";
import { requireActor } from "@/lib/auth-guard";
import { CATALOGS, findMissingTranslations } from "@/lib/i18n/messages";
import { getTranslationOverrides } from "@/lib/i18n/overrides";
import { getTT } from "@/lib/i18n/tt-server";

export const metadata: Metadata = { title: "Global & Çeviriler" };
export const dynamic = "force-dynamic";

export default async function AdminGlobalPage() {
  await requireActor("ADMIN");
  const [tt, countries, trOv, enOv, deOv, frOv] = await Promise.all([
    getTT(),
    listLocations({ includeInactive: true }),
    getTranslationOverrides("tr"),
    getTranslationOverrides("en"),
    getTranslationOverrides("de"),
    getTranslationOverrides("fr"),
  ]);

  const overrides: Record<Locale, Record<string, string>> = {
    tr: trOv,
    en: enOv,
    de: deOv,
    fr: frOv,
  };

  const missingByLocale = {} as Record<Locale, number>;
  for (const loc of LOCALES) {
    missingByLocale[loc] = findMissingTranslations(loc, overrides[loc]).length;
  }

  const allKeys = Object.keys(CATALOGS.tr);
  const translationRows: TranslationRow[] = allKeys.map((key) => ({
    key,
    values: {
      tr: overrides.tr[key] ?? CATALOGS.tr[key] ?? "",
      en: overrides.en[key] ?? CATALOGS.en[key] ?? "",
      de: overrides.de[key] ?? CATALOGS.de[key] ?? "",
      fr: overrides.fr[key] ?? CATALOGS.fr[key] ?? "",
    },
  }));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-title text-fg">{tt("Global & Çeviriler")}</h1>
        <p className="text-[14px] text-fg-muted">
          {tt("Ülke, şehir, resmî tatil, çalışma saatleri ve çok dilli çeviri yönetimi.")}
        </p>
      </header>
      <GlobalAdminManager
        countries={countries}
        missingByLocale={missingByLocale}
        translationRows={translationRows}
      />
    </div>
  );
}
