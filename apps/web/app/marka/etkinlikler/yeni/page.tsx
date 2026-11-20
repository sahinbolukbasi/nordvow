import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { listLocations } from "@infulancer/core/i18n/locations";
import { EventCreateForm } from "@/components/events/event-forms";
import { BackLink } from "@/components/luma/primitives";
import { requireActor } from "@/lib/auth-guard";
import { getPreferences } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Yeni etkinlik" };
export const dynamic = "force-dynamic";

export default async function BrandNewEventPage() {
  const tt = await getTT();
  const actor = await requireActor("BRAND");
  const [brand, allBrands, countries, { detectedCountry }] = await Promise.all([
    prisma.brand.findUnique({ where: { id: actor.brandId! }, select: { name: true } }),
    prisma.brand.findMany({ where: { id: { not: actor.brandId! } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    listLocations(),
    getPreferences(),
  ]);
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <BackLink href="/marka/etkinlikler">{tt("Etkinlikler")}</BackLink>
      <div className="flex flex-col gap-1">
        <h1 className="text-title text-fg">{tt("Yeni etkinlik")}</h1>
        <p className="text-[14px] text-fg-muted">{tt("Taslak olarak oluşturulur; yayınlayıp misafir davet etmek için yönetim sayfasına geçersiniz.")}</p>
      </div>
      <EventCreateForm isAdmin={false} brands={allBrands} organizerName={brand?.name ?? "Markanız"} countries={countries} defaultCountryCode={detectedCountry} />
    </div>
  );
}
