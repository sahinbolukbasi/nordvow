import type { Metadata } from "next";
import { EventQrHub } from "@/components/luma/event-views";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "QR Giriş & Biletler" };
export const dynamic = "force-dynamic";

export default async function BrandQrHubPage({
  searchParams,
}: {
  searchParams: Promise<{ etkinlik?: string }>;
}) {
  const actor = await requireActor("BRAND");
  const { etkinlik } = await searchParams;
  return <EventQrHub qrPath="/marka/qr-giris" tenantId={actor.brandId!} selectedEventId={etkinlik} />;
}

