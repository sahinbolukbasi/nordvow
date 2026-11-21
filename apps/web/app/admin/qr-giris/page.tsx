import type { Metadata } from "next";
import { getQrScannerRestriction } from "@infulancer/core/events/scanner-accounts";
import { EventQrHub } from "@/components/luma/event-views";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "QR Giriş & Biletler" };
export const dynamic = "force-dynamic";

export default async function AdminQrHubPage({
  searchParams,
}: {
  searchParams: Promise<{ etkinlik?: string }>;
}) {
  const actor = await requireActor("ADMIN");
  const [{ etkinlik }, restriction] = await Promise.all([
    searchParams,
    getQrScannerRestriction(actor.userId),
  ]);
  return (
    <EventQrHub
      qrPath="/admin/qr-giris"
      selectedEventId={etkinlik}
      allowedEventIds={restriction?.allowedEventIds}
    />
  );
}

