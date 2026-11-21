"use client";
import { useEffect, useMemo, useState } from "react";
import { localizedName, type CityDto, type CountryDto } from "@infulancer/core/i18n/location-utils";
import { usePrefs } from "@/lib/i18n/client";
import { useTT } from "@/lib/i18n/tt-client";

export type SelectedLocation = {
  country: CountryDto | null;
  city: CityDto | null;
  timezone: string;
  currency: string;
};

/**
 * Arama destekli bağımlı Ülke → Şehir seçici.
 * Kullanıcının algılanan ülkesi varsayılan olarak seçili gelir ve değiştirilebilir.
 */
export function CountryCityPicker({
  countries,
  defaultCountryCode,
  onChange,
}: {
  countries: CountryDto[];
  defaultCountryCode?: string;
  onChange?: (loc: SelectedLocation) => void;
}) {
  const tt = useTT();
  const { locale, country: detectedCountry } = usePrefs();
  const initialCode = (defaultCountryCode ?? detectedCountry ?? "TR").toUpperCase();

  const [countrySearch, setCountrySearch] = useState("");
  const [citySearch, setCitySearch] = useState("");
  const [selectedCountryId, setSelectedCountryId] = useState<string>(() => {
    const found = countries.find((c) => c.code === initialCode) ?? countries[0];
    return found?.id ?? "";
  });
  const [selectedCityId, setSelectedCityId] = useState<string>("");

  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => {
      const label = localizedName(c.names, locale).toLowerCase();
      return label.includes(q) || c.code.toLowerCase().includes(q) || c.currency.toLowerCase().includes(q);
    });
  }, [countries, countrySearch, locale]);

  const selectedCountry = useMemo(
    () => countries.find((c) => c.id === selectedCountryId) ?? null,
    [countries, selectedCountryId],
  );

  const filteredCities = useMemo(() => {
    const list = selectedCountry?.cities ?? [];
    const q = citySearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => {
      const label = localizedName(c.names, locale).toLowerCase();
      return label.includes(q) || (c.regionName ?? "").toLowerCase().includes(q);
    });
  }, [selectedCountry, citySearch, locale]);

  const selectedCity = useMemo(
    () => selectedCountry?.cities.find((c) => c.id === selectedCityId) ?? null,
    [selectedCountry, selectedCityId],
  );

  // Ülke değiştiğinde ilk şehri seç veya sıfırla.
  useEffect(() => {
    if (!selectedCountry) {
      setSelectedCityId("");
      return;
    }
    const stillValid = selectedCountry.cities.some((c) => c.id === selectedCityId);
    if (!stillValid) {
      setSelectedCityId(selectedCountry.cities[0]?.id ?? "");
      setCitySearch("");
    }
  }, [selectedCountry, selectedCityId]);

  useEffect(() => {
    const timezone = selectedCity?.timezone ?? selectedCountry?.timezone ?? "Europe/Istanbul";
    const currency = selectedCountry?.currency ?? "USD";
    onChange?.({ country: selectedCountry, city: selectedCity, timezone, currency });
  }, [selectedCountry, selectedCity, onChange]);

  const activeTimezone = selectedCity?.timezone ?? selectedCountry?.timezone ?? "UTC";
  const cityLabel = selectedCity ? localizedName(selectedCity.names, locale) : "";

  return (
    <div className="flex flex-col gap-3">
      {/* Form gönderimi için gizli alanlar */}
      <input type="hidden" name="countryId" value={selectedCountry?.id ?? ""} />
      <input type="hidden" name="cityId" value={selectedCity?.id ?? ""} />
      <input type="hidden" name="city" value={cityLabel} />
      <input type="hidden" name="timezone" value={activeTimezone} />
      <input type="hidden" name="currency" value={selectedCountry?.currency ?? "USD"} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Ülke seçimi (arama destekli) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-fg">{tt("Ülke")}</label>
          <input
            type="search"
            value={countrySearch}
            onChange={(e) => setCountrySearch(e.target.value)}
            placeholder={tt("Ülke ara...")}
            className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg outline-none focus:border-fg"
          />
          <select
            aria-label={tt("Ülke")}
            value={selectedCountryId}
            onChange={(e) => setSelectedCountryId(e.target.value)}
            className="h-10 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg outline-none focus:border-fg"
          >
            {filteredCountries.map((c) => (
              <option key={c.id} value={c.id}>
                {localizedName(c.names, locale)} ({c.code}) · {c.currency}
              </option>
            ))}
          </select>
        </div>

        {/* Şehir seçimi (ülkeye bağımlı + arama destekli) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[13px] font-medium text-fg">{tt("Şehir")}</label>
          <input
            type="search"
            value={citySearch}
            onChange={(e) => setCitySearch(e.target.value)}
            placeholder={selectedCountry ? tt("Şehir ara...") : tt("Önce ülke seçin")}
            disabled={!selectedCountry}
            className="h-9 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg outline-none focus:border-fg disabled:opacity-50"
          />
          <select
            aria-label={tt("Şehir")}
            value={selectedCityId}
            onChange={(e) => setSelectedCityId(e.target.value)}
            disabled={!selectedCountry || filteredCities.length === 0}
            className="h-10 rounded-xl border border-line bg-bg px-3 text-[13px] text-fg outline-none focus:border-fg disabled:opacity-50"
          >
            {filteredCities.length === 0 ? (
              <option value="">{tt("Şehir seçin")}</option>
            ) : (
              filteredCities.map((city) => (
                <option key={city.id} value={city.id}>
                  {localizedName(city.names, locale)}
                  {city.regionName ? ` · ${city.regionName}` : ""} ({city.timezone})
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {selectedCountry ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg/50 px-3 py-2 text-[12px] text-fg-muted">
          <span>
            <strong className="text-fg">{tt("Saat dilimi")}:</strong> {activeTimezone}
          </span>
          <span>·</span>
          <span>
            <strong className="text-fg">{tt("Para Birimi")}:</strong> {selectedCountry.currency}
          </span>
          {selectedCity?.latitude != null && selectedCity?.longitude != null ? (
            <>
              <span>·</span>
              <span>
                {selectedCity.latitude.toFixed(2)}, {selectedCity.longitude.toFixed(2)}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
