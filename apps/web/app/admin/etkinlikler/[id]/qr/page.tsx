import type { Metadata } from "next";
import { EventQrManage } from "@/components/luma/event-views";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "QR Giriş & Biletler" };
export const dynamic = "force-dynamic";

export default async function AdminEventQrPage({ params }: { params: Promise<{ id: string }> }) {
  await requireActor("ADMIN");
  const { id } = await params;
  return <EventQrManage id={id} basePath="/admin/etkinlikler" />;
}

