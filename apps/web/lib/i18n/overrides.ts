import { cache } from "react";
import { prisma } from "@infulancer/core/db";
import type { Locale } from "@infulancer/core/i18n/regions";
import { messagesFor, type Messages } from "./messages";

/**
 * Veritabanındaki admin çeviri geçersiz kılmalarını (TranslationOverride) okur.
 * İstek başına React.cache ile önbelleklenir; DB erişilemezse sessizce boş döner.
 */
export const getTranslationOverrides = cache(async (locale: Locale): Promise<Messages> => {
  try {
    const rows = await prisma.translationOverride.findMany({
      where: { locale },
      select: { key: true, value: true },
    });
    const out: Messages = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  } catch {
    return {};
  }
});

/** JSON dil dosyasını veritabanındaki admin geçersiz kılmalarıyla birleştirir. */
export async function getMergedMessages(locale: Locale): Promise<Messages> {
  const overrides = await getTranslationOverrides(locale);
  return messagesFor(locale, overrides);
}
