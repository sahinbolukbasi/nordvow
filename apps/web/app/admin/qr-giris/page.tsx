import type { Metadata } from "next";
import { EventQrHub } from "@/components/luma/event-views";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "QR Giriş & Biletler" };
export const dynamic = "force-dynamic";

export default async function AdminQrHubPage({
  searchParams,
}: {
  searchParams: Promise<{ etkinlik?: string }>;
}) {
  await requireActor("ADMIN");
  const { etkinlik } = await searchParams;
  return <EventQrHub qrPath="/admin/qr-giris" selectedEventId={etkinlik} />;
}

