"use server";
import { cookies } from "next/headers";
import { prisma } from "@infulancer/core/db";
import { isLocale } from "@infulancer/core/i18n/regions";
import { normalizeCountryCode } from "@infulancer/core/i18n/geo";
import { auth } from "@/auth";
import type { ActionState } from "@/lib/action-state";
import { revalidateAll, str } from "@/lib/action-utils";
import { COUNTRY_COOKIE, LOCALE_COOKIE, LOCALE_MANUAL_COOKIE } from "@/lib/i18n/server";

/**
 * Dil ve ülke tercihini kaydeder (çerez + girişliyse hesap).
 * Elle yapılan seçim `nv_locale_manual=1` ile işaretlenir ve konum algısını her zaman ezer.
 */
export async function setRegionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const locale = str(fd, "locale");
  const country = normalizeCountryCode(str(fd, "country"));
  if (!isLocale(locale) || !country) return { error: "Geçersiz dil veya ülke." };

  const jar = await cookies();
  const opts = {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };
  jar.set(LOCALE_COOKIE, locale, opts);
  jar.set(COUNTRY_COOKIE, country, opts);
  jar.set(LOCALE_MANUAL_COOKIE, "1", opts);

  const session = await auth().catch(() => null);
  if (session?.user?.id) {
    await prisma.user.update({ where: { id: session.user.id }, data: { locale, country } }).catch(() => undefined);
  }
  revalidateAll();
  return { ok: true, message: "Kaydedildi." };
}
