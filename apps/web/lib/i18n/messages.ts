import type { Locale } from "@infulancer/core/i18n/regions";
import tr from "./messages/tr.json";
import en from "./messages/en.json";
import de from "./messages/de.json";
import fr from "./messages/fr.json";

/**
 * Çok dilli mesaj katalogları (tr.json, en.json, de.json, fr.json).
 * Yeni dil eklemek için messages/<dil>.json ekleyip CATALOGS nesnesine kaydetmek yeterlidir.
 */
export type Messages = Record<string, string>;

export const CATALOGS: Record<Locale, Messages> = {
  tr,
  en,
  de,
  fr,
};

export function messagesFor(locale: Locale, overrides?: Messages): Messages {
  const base = CATALOGS[locale] ?? CATALOGS.en;
  if (!overrides || Object.keys(overrides).length === 0) return base;
  return { ...base, ...overrides };
}

/** Kaynak dildeki (tr) anahtarlara göre hedef dildeki eksik çevirileri döndürür. */
export function findMissingTranslations(targetLocale: Locale, overrides?: Messages): string[] {
  const sourceKeys = Object.keys(CATALOGS.tr);
  const target = messagesFor(targetLocale, overrides);
  return sourceKeys.filter((k) => {
    const val = target[k];
    return typeof val !== "string" || val.trim() === "";
  });
}
