import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { EventsIndex } from "@/components/luma/event-views";
import { requireActor } from "@/lib/auth-guard";
export const metadata: Metadata = { title: "Etkinlikler" };
export const dynamic = "force-dynamic";
export default async function BrandEventsPage({ searchParams }: { searchParams: Promise<{ filtre?: string; ara?: string; ulke?: string; sehir?: string }> }) {
  const tt = await getTT();
  const actor = await requireActor("BRAND");
  const { filtre, ara, ulke, sehir } = await searchParams;
  return <EventsIndex basePath="/marka/etkinlikler" tenantId={actor.brandId!} filter={filtre} query={ara} countryFilter={ulke} cityFilter={sehir} title={tt("Etkinlikler")} description={tt("Etkinliklerinizi oluşturun, içerik üreticilerini davet edin; katılanlara QR'lı bilet gider.")} />;
}
