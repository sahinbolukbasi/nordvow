"use client";
import { useMemo, useState } from "react";
import { DEFAULT_WORKING_HOURS, localizedName, type CountryDto } from "@infulancer/core/i18n/location-utils";
import { LOCALES, LOCALE_LABEL, type Locale } from "@infulancer/core/i18n/regions";
import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select } from "@/components/ui/form";
import { usePrefs } from "@/lib/i18n/client";
import { useTT } from "@/lib/i18n/tt-client";
import {
  deleteHolidayAction,
  saveTranslationAction,
  toggleCityActiveAction,
  toggleCountryActiveAction,
  upsertCityAction,
  upsertCountryAction,
  upsertHolidayAction,
} from "@/lib/actions/global-admin";

type TabId = "countries" | "cities" | "holidays" | "translations";

export type TranslationRow = {
  key: string;
  values: Record<Locale, string>;
};

const DAYS = [
  { key: "mon", label: "Pzt / Mon" },
  { key: "tue", label: "Sal / Tue" },
  { key: "wed", label: "Çar / Wed" },
  { key: "thu", label: "Per / Thu" },
  { key: "fri", label: "Cum / Fri" },
  { key: "sat", label: "Cmt / Sat" },
  { key: "sun", label: "Paz / Sun" },
] as const;

export function GlobalAdminManager({
  countries,
  missingByLocale,
  translationRows,
}: {
  countries: CountryDto[];
  missingByLocale: Record<Locale, number>;
  translationRows: TranslationRow[];
}) {
  const tt = useTT();
  const { locale } = usePrefs();
  const [tab, setTab] = useState<TabId>("countries");
  const [selectedCountryId, setSelectedCountryId] = useState<string>(countries[0]?.id ?? "");
  const [targetLocale, setTargetLocale] = useState<Locale>("en");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [searchKey, setSearchKey] = useState("");
  const [editCountry, setEditCountry] = useState<CountryDto | null>(null);

  const selectedCountry = useMemo(
    () => countries.find((c) => c.id === selectedCountryId) ?? countries[0] ?? null,
    [countries, selectedCountryId],
  );

  const totalMissingEn = missingByLocale.en ?? 0;
  const totalMissingTarget = missingByLocale[targetLocale] ?? 0;

  const visibleTranslations = useMemo(() => {
    const q = searchKey.trim().toLowerCase();
    return translationRows
      .filter((r) => {
        const val = r.values[targetLocale] ?? "";
        if (onlyMissing && val.trim() !== "") return false;
        if (q && !r.key.toLowerCase().includes(q) && !val.toLowerCase().includes(q)) return false;
        return true;
      })
      .slice(0, 120);
  }, [translationRows, targetLocale, onlyMissing, searchKey]);

  const tabBtn = (id: TabId, label: string, badge?: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setTab(id)}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[13px] font-medium transition-standard ${
        tab === id
          ? "border-fg bg-fg text-bg"
          : "border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg"
      }`}
    >
      <span>{label}</span>
      {typeof badge === "number" && badge > 0 ? (
        <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">{badge}</span>
      ) : null}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Eksik çeviri özet uyarısı */}
      {totalMissingEn > 0 ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200"
        >
          <span>
            ⚠️ <strong>{tt("Eksik çeviri uyarısı")}:</strong> EN: {totalMissingEn} {tt("eksik çeviri bulundu")}.
          </span>
          <button
            type="button"
            onClick={() => {
              setTab("translations");
              setTargetLocale("en");
              setOnlyMissing(true);
            }}
            className="rounded-full border border-amber-400/50 px-3 py-1 text-[12px] font-semibold hover:bg-amber-400/20"
          >
            {tt("Sadece eksikleri göster")}
          </button>
        </div>
      ) : null}

      {/* Sekmeler */}
      <div className="flex flex-wrap gap-2">
        {tabBtn("countries", `${tt("Ülkeler")} (${countries.length})`)}
        {tabBtn("cities", tt("Şehirler"))}
        {tabBtn("holidays", tt("Resmî Tatiller"))}
        {tabBtn("translations", tt("Çeviriler"), totalMissingEn)}
      </div>

      {/* 1. ÜLKELER + ÇALIŞMA SAATLERİ */}
      {tab === "countries" ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
          <div className="flex flex-col gap-3">
            {countries.map((c) => (
              <div
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-bg px-2 py-0.5 text-[12px] font-bold text-fg">{c.code}</span>
                    <span className="font-semibold text-fg">{localizedName(c.names, locale)}</span>
                    <span className="text-[12px] text-fg-muted">
                      ({c.names.tr} / {c.names.en})
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        c.isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-fg-muted/15 text-fg-muted"
                      }`}
                    >
                      {c.isActive ? tt("Aktif") : tt("Pasif")}
                    </span>
                  </div>
                  <p className="text-[12px] text-fg-muted">
                    {c.currency} · {c.defaultLocale.toUpperCase()} · {c.timezone} · {c.cities.length} {tt("Şehirler")} ·{" "}
                    {c.holidays.length} {tt("Resmî Tatiller")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditCountry(c)}>
                    {tt("Güncelle")}
                  </Button>
                  <ActionForm action={toggleCountryActiveAction} className="!flex-row">
                    <input type="hidden" name="id" value={c.id} />
                    <input type="hidden" name="isActive" value={String(!c.isActive)} />
                    <Button type="submit" size="sm" variant="ghost">
                      {c.isActive ? tt("Pasif yap") : tt("Aktif yap")}
                    </Button>
                  </ActionForm>
                </div>
              </div>
            ))}
          </div>

          <section className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-fg">
                {editCountry ? `${editCountry.code} · ${tt("Güncelle")}` : tt("Yeni ülke ekle")}
              </h2>
              {editCountry ? (
                <button
                  type="button"
                  onClick={() => setEditCountry(null)}
                  className="text-[12px] text-fg-muted underline"
                >
                  + {tt("Yeni ülke ekle")}
                </button>
              ) : null}
            </div>
            <ActionForm
              key={editCountry?.id ?? "new-country"}
              action={upsertCountryAction}
              submitLabel={tt("Kaydet")}
              className="gap-3"
            >
              {editCountry ? <input type="hidden" name="id" value={editCountry.id} /> : null}
              <div className="grid grid-cols-2 gap-3">
                <Field label={tt("ISO Kodu")}>
                  {(p) => <Input {...p} name="code" required maxLength={2} defaultValue={editCountry?.code ?? ""} placeholder="TR" />}
                </Field>
                <Field label={tt("Para Birimi")}>
                  {(p) => <Input {...p} name="currency" required maxLength={3} defaultValue={editCountry?.currency ?? "USD"} placeholder="TRY" />}
                </Field>
                <Field label={tt("Türkçe Ad")}>
                  {(p) => <Input {...p} name="nameTr" required defaultValue={editCountry?.names.tr ?? ""} placeholder="Türkiye" />}
                </Field>
                <Field label={tt("İngilizce Ad")}>
                  {(p) => <Input {...p} name="nameEn" required defaultValue={editCountry?.names.en ?? ""} placeholder="Turkey" />}
                </Field>
                <Field label={tt("Varsayılan Dil")}>
                  {(p) => (
                    <Select {...p} name="defaultLocale" defaultValue={editCountry?.defaultLocale ?? "en"}>
                      {LOCALES.map((l) => (
                        <option key={l} value={l}>
                          {LOCALE_LABEL[l]} ({l})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={tt("Saat dilimi")}>
                  {(p) => <Input {...p} name="timezone" required defaultValue={editCountry?.timezone ?? "Europe/Istanbul"} placeholder="Europe/Istanbul" />}
                </Field>
              </div>
              <div className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
                <p className="text-[12px] font-semibold text-fg">{tt("Çalışma saatleri")}</p>
                {DAYS.map((d) => {
                  const wh = editCountry?.workingHours?.[d.key] ?? DEFAULT_WORKING_HOURS[d.key];
                  return (
                    <div key={d.key} className="grid grid-cols-[90px_1fr_1fr_auto] items-center gap-2 text-[12px]">
                      <span className="text-fg-muted">{d.label}</span>
                      <Input name={`wh_${d.key}_start`} type="time" defaultValue={wh.start} className="h-8 text-xs" />
                      <Input name={`wh_${d.key}_end`} type="time" defaultValue={wh.end} className="h-8 text-xs" />
                      <label className="inline-flex items-center gap-1 text-[11px] text-fg-muted">
                        <input type="checkbox" name={`wh_${d.key}_closed`} defaultChecked={wh.closed} />
                        {tt("Pasif")}
                      </label>
                    </div>
                  );
                })}
              </div>
            </ActionForm>
          </section>
        </div>
      ) : null}

      {/* 2. ŞEHİRLER */}
      {tab === "cities" ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <label className="text-[13px] font-medium text-fg">{tt("Ülke")}:</label>
            <select
              value={selectedCountry?.id ?? ""}
              onChange={(e) => setSelectedCountryId(e.target.value)}
              className="h-9 rounded-xl border border-line bg-surface px-3 text-[13px] text-fg"
            >
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c.names, locale)} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="flex flex-col gap-2.5">
              {(selectedCountry?.cities ?? []).map((city) => (
                <div
                  key={city.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-fg">{localizedName(city.names, locale)}</span>
                      <span className="text-[12px] text-fg-muted">({city.names.tr} / {city.names.en})</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] ${
                          city.isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-fg-muted/15 text-fg-muted"
                        }`}
                      >
                        {city.isActive ? tt("Aktif") : tt("Pasif")}
                      </span>
                    </div>
                    <p className="text-[12px] text-fg-muted">
                      {city.timezone}
                      {city.regionName ? ` · ${city.regionName}` : ""}
                      {city.latitude != null && city.longitude != null ? ` · ${city.latitude}, ${city.longitude}` : ""}
                    </p>
                  </div>
                  <ActionForm action={toggleCityActiveAction} className="!flex-row">
                    <input type="hidden" name="id" value={city.id} />
                    <input type="hidden" name="isActive" value={String(!city.isActive)} />
                    <Button type="submit" size="sm" variant="ghost">
                      {city.isActive ? tt("Pasif yap") : tt("Aktif yap")}
                    </Button>
                  </ActionForm>
                </div>
              ))}
            </div>

            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="mb-4 font-semibold text-fg">{tt("Yeni şehir ekle")}</h2>
              <ActionForm action={upsertCityAction} submitLabel={tt("Kaydet")} className="gap-3">
                <input type="hidden" name="countryId" value={selectedCountry?.id ?? ""} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label={tt("Türkçe Ad")}>{(p) => <Input {...p} name="nameTr" required placeholder="İzmir" />}</Field>
                  <Field label={tt("İngilizce Ad")}>{(p) => <Input {...p} name="nameEn" required placeholder="Izmir" />}</Field>
                  <Field label="Slug">{(p) => <Input {...p} name="slug" placeholder="izmir" />}</Field>
                  <Field label={tt("Bölge / Eyalet")}>{(p) => <Input {...p} name="regionName" placeholder="Ege" />}</Field>
                  <Field label={tt("Saat dilimi")}>
                    {(p) => <Input {...p} name="timezone" required defaultValue={selectedCountry?.timezone ?? "UTC"} />}
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label={tt("Enlem")}>{(p) => <Input {...p} name="latitude" type="number" step="any" placeholder="41.008" />}</Field>
                    <Field label={tt("Boylam")}>{(p) => <Input {...p} name="longitude" type="number" step="any" placeholder="28.978" />}</Field>
                  </div>
                </div>
              </ActionForm>
            </section>
          </div>
        </div>
      ) : null}

      {/* 3. RESMÎ TATİLLER */}
      {tab === "holidays" ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <label className="text-[13px] font-medium text-fg">{tt("Ülke")}:</label>
            <select
              value={selectedCountry?.id ?? ""}
              onChange={(e) => setSelectedCountryId(e.target.value)}
              className="h-9 rounded-xl border border-line bg-surface px-3 text-[13px] text-fg"
            >
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {localizedName(c.names, locale)} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
            <div className="flex flex-col gap-2.5">
              {(selectedCountry?.holidays ?? []).map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-bg px-2 py-0.5 font-mono text-[12px] text-fg">{h.date}</span>
                      <span className="font-semibold text-fg">{localizedName(h.names, locale)}</span>
                      {h.isRecurring ? (
                        <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] text-fg-muted">{tt("Her yıl tekrarlanır")}</span>
                      ) : null}
                    </div>
                    <p className="text-[12px] text-fg-muted">{h.names.tr} / {h.names.en}</p>
                  </div>
                  <ActionForm action={deleteHolidayAction} className="!flex-row">
                    <input type="hidden" name="id" value={h.id} />
                    <Button type="submit" size="sm" variant="ghost">{tt("Sil")}</Button>
                  </ActionForm>
                </div>
              ))}
            </div>

            <section className="rounded-2xl border border-line bg-surface p-5">
              <h2 className="mb-4 font-semibold text-fg">{tt("Yeni resmî tatil ekle")}</h2>
              <ActionForm action={upsertHolidayAction} submitLabel={tt("Kaydet")} className="gap-3">
                <input type="hidden" name="countryId" value={selectedCountry?.id ?? ""} />
                <Field label="YYYY-MM-DD">{(p) => <Input {...p} name="date" type="date" required />}</Field>
                <Field label={tt("Türkçe Ad")}>{(p) => <Input {...p} name="nameTr" required placeholder="Cumhuriyet Bayramı" />}</Field>
                <Field label={tt("İngilizce Ad")}>{(p) => <Input {...p} name="nameEn" required placeholder="Republic Day" />}</Field>
                <label className="inline-flex items-center gap-2 text-[13px] text-fg">
                  <input type="checkbox" name="isRecurring" defaultChecked className="h-4 w-4" />
                  {tt("Her yıl tekrarlanır")}
                </label>
              </ActionForm>
            </section>
          </div>
        </div>
      ) : null}

      {/* 4. ÇEVİRİLER + EKSİK ÇEVİRİ UYARISI */}
      {tab === "translations" ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={targetLocale}
                onChange={(e) => setTargetLocale(e.target.value as Locale)}
                className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              >
                {LOCALES.map((l) => (
                  <option key={l} value={l}>
                    {LOCALE_LABEL[l]} ({l.toUpperCase()}) — {missingByLocale[l] ?? 0} eksik
                  </option>
                ))}
              </select>
              <input
                type="search"
                value={searchKey}
                onChange={(e) => setSearchKey(e.target.value)}
                placeholder={tt("Çeviri ara...")}
                className="h-9 w-64 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg"
              />
              <label className="inline-flex items-center gap-2 text-[13px] text-fg">
                <input
                  type="checkbox"
                  checked={onlyMissing}
                  onChange={(e) => setOnlyMissing(e.target.checked)}
                  className="h-4 w-4"
                />
                {tt("Sadece eksikleri göster")}
              </label>
            </div>
            <span className="text-[12px] text-fg-muted">
              {totalMissingTarget > 0 ? (
                <strong className="text-amber-400">
                  {totalMissingTarget} {tt("eksik çeviri bulundu")}
                </strong>
              ) : (
                <strong className="text-emerald-400">✓ {tt("Tüm çeviriler eksiksiz")}</strong>
              )}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {visibleTranslations.map((row) => {
              const current = row.values[targetLocale] ?? "";
              const isMissing = current.trim() === "";
              return (
                <ActionForm
                  key={`${targetLocale}:${row.key}`}
                  action={saveTranslationAction}
                  className={`!flex-row flex-wrap items-center gap-3 rounded-xl border p-3 ${
                    isMissing ? "border-amber-500/40 bg-amber-500/5" : "border-line bg-surface"
                  }`}
                >
                  <input type="hidden" name="locale" value={targetLocale} />
                  <input type="hidden" name="key" value={row.key} />
                  <div className="min-w-[220px] flex-1 text-[12px] text-fg-muted">
                    <span className="font-mono text-fg">{row.key}</span>
                  </div>
                  <Input
                    name="value"
                    defaultValue={current}
                    placeholder={`${targetLocale.toUpperCase()}...`}
                    className="h-9 min-w-[240px] flex-1 text-[13px]"
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    {tt("Kaydet")}
                  </Button>
                </ActionForm>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
