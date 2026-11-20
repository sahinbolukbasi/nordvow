import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { getBrandWalletSummary } from "@infulancer/core/finance/brand-wallet";
import { formatKurus } from "@infulancer/core/domain/labels";
import type { ShipmentStatus } from "@infulancer/core/enums";
import { shipmentStatusLabels } from "@infulancer/core/shipping/types";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/layout";
import { requireActor } from "@/lib/auth-guard";
import { fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Kargo yönetimi" };
export const dynamic = "force-dynamic";

const statusTone: Record<ShipmentStatus, string> = {
  PENDING_ADDRESS: "text-amber-600",
  READY_TO_SHIP: "text-sky-600",
  LABEL_CREATED: "text-indigo-600",
  IN_TRANSIT: "text-violet-600",
  OUT_FOR_DELIVERY: "text-blue-600",
  DELIVERED: "text-emerald-600",
  RETURNED: "text-rose-600",
};

export default async function BrandShippingPage() {
  const actor = await requireActor("BRAND");
  if (!actor.brandId) return null;
  const [shipments, summary] = await Promise.all([
    prisma.shipment.findMany({
      where: { brandId: actor.brandId },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        campaignId: true,
        status: true,
        carrierName: true,
        trackingNumber: true,
        trackingUrl: true,
        barcodeLabelUrl: true,
        shippingCostKurus: true,
        updatedAt: true,
        campaign: { select: { id: true, name: true } },
        influencer: { select: { name: true } },
      },
    }),
    getBrandWalletSummary(actor.brandId),
  ]);
  const stats = {
    total: shipments.length,
    pending: shipments.filter((s) => ["PENDING_ADDRESS", "READY_TO_SHIP"].includes(s.status)).length,
    inTransit: shipments.filter((s) => ["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(s.status)).length,
    delivered: shipments.filter((s) => s.status === "DELIVERED").length,
    returned: shipments.filter((s) => s.status === "RETURNED").length,
    cost: shipments.reduce((sum, s) => sum + (s.shippingCostKurus ?? 0), 0),
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kargo yönetimi"
        description="Kampanyalarınızın gönderilerini, barkodlarını, takip numaralarını ve teslimat durumlarını tek ekrandan yönetin."
        actions={<Link href="/marka/ayarlar/kargo" className="rounded-full border border-line px-3 py-2 text-sm">Kargo entegrasyonları</Link>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        {[
          ["Toplam gönderi", stats.total],
          ["Hazırlanıyor", stats.pending],
          ["Kargoda", stats.inTransit],
          ["Teslim edildi", stats.delivered],
          ["İade / sorun", stats.returned],
          ["Kargo harcaması", formatKurus(stats.cost)],
        ].map(([label, value]) => (
          <Card key={String(label)} interactive={false} className="p-4">
            <p className="text-xs text-fg-muted">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </Card>
        ))}
      </div>
      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>Bakiye özeti</CardTitle>
        <div className="flex flex-wrap gap-5 text-sm">
          <span>Mevcut bakiye: <strong>{formatKurus(summary.balanceKurus)}</strong></span>
          <span>Bloke: <strong>{formatKurus(summary.blockedKurus)}</strong></span>
          <span>Kargo harcaması: <strong>{formatKurus(summary.spendingKurus.SHIPPING)}</strong></span>
        </div>
      </Card>
      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>Kampanya gönderileri</CardTitle>
        {!shipments.length ? <EmptyState message="Henüz kargo kaydı bulunmuyor." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-line text-xs text-fg-muted"><th className="px-3 py-3">Influencer</th><th className="px-3 py-3">Kampanya</th><th className="px-3 py-3">Kargo / Takip</th><th className="px-3 py-3">Durum</th><th className="px-3 py-3">Barkod</th><th className="px-3 py-3">Güncelleme</th></tr></thead>
              <tbody className="divide-y divide-line">
                {shipments.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-3">{s.influencer.name}</td>
                    <td className="px-3 py-3"><Link className="underline" href={`/marka/kampanyalar/${s.campaignId}#kargo`}>{s.campaign.name}</Link></td>
                    <td className="px-3 py-3">
                      {s.trackingNumber ? (
                        s.trackingUrl ? <a className="font-mono text-xs underline" href={s.trackingUrl} target="_blank" rel="noreferrer">{s.carrierName ?? "Kargo"} · {s.trackingNumber}</a> : <span className="font-mono text-xs">{s.carrierName ?? "Kargo"} · {s.trackingNumber}</span>
                      ) : "Takip bekleniyor"}
                    </td>
                    <td className={`px-3 py-3 text-xs font-medium ${statusTone[s.status]}`}>{shipmentStatusLabels[s.status]}</td>
                    <td className="px-3 py-3">{s.barcodeLabelUrl ? <a className="underline" href={s.barcodeLabelUrl} target="_blank" rel="noreferrer">Barkodu aç / yazdır</a> : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs text-fg-muted">{fmtDateTime(s.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
