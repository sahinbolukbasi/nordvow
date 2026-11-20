import { NextResponse } from "next/server";
import { listLocations } from "@infulancer/core/i18n/locations";
import { getPreferences } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/** Aktif ülke → şehir hiyerarşisini, çalışma saatlerini ve resmî tatilleri döndürür. */
export async function GET() {
  const [{ detectedCountry, locale }, countries] = await Promise.all([
    getPreferences(),
    listLocations(),
  ]);
  return NextResponse.json({
    detectedCountry,
    locale,
    countries,
  });
}
