import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import type { ShipmentStatus } from "@infulancer/core/enums";
import { listBrandShippingIntegrations } from "@infulancer/core/shipping/service";
import { shipmentStatusLabels } from "@infulancer/core/shipping/types";
import { BrandShippingIntegrationsPanel } from "@/components/shipping/brand-integrations-panel";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/layout";
import { requireActor } from "@/lib/auth-guard";
import { getTT } from "@/lib/i18n/tt-server";
import { fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Kargo Yönetimi" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<ShipmentStatus, string> = {
  PENDING_ADDRESS: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  READY_TO_SHIP: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  LABEL_CREATED: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  IN_TRANSIT: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  OUT_FOR_DELIVERY: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  DELIVERED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  RETURNED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export default async function AdminShippingPage({
  searchParams,
}: {
  searchParams: Promise<{ marka?: string }>;
}) {
  await requireActor("ADMIN");
  const tt = await getTT();
  const { marka } = await searchParams;

  const [shipments, campaigns, integrations, brands] = await Promise.all([
    prisma.shipment.findMany({
      include: {
        brand: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        influencer: { select: { id: true, name: true, city: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.campaign.findMany({
      where: {
        OR: [
          { objective: "urun_gonderimi" },
          { shippingConfig: { is: { requiresProductShipment: true } } },
          { shipments: { some: {} } },
        ],
      },
      include: {
        brand: { select: { id: true, name: true } },
        shippingConfig: { select: { shippingMode: true, requiresProductShipment: true } },
        _count: { select: { shipments: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.brandShippingIntegration.findMany({
      include: { brand: { select: { id: true, name: true } } },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      take: 100,
    }),
    prisma.brand.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const selectedBrandId = brands.find((b) => b.id === marka)?.id ?? brands[0]?.id ?? null;
  const selectedBrandIntegrations = selectedBrandId
    ? await listBrandShippingIntegrations(selectedBrandId)
    : [];

  const kpi = {
    total: shipments.length,
    pendingAddress: shipments.filter((s) => s.status === "PENDING_ADDRESS").length,
    readyToShip: shipments.filter((s) => s.status === "READY_TO_SHIP").length,
    inTransit: shipments.filter((s) =>
      ["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(s.status),
    ).length,
    delivered: shipments.filter((s) => s.status === "DELIVERED").length,
    returned: shipments.filter((s) => s.status === "RETURNED").length,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tt("Kargo & Lojistik Yönetimi")}
        description={tt("Tüm markalar ve kampanyalardaki ürün gönderimlerini, teslimat durumlarını ve kargo entegrasyonlarını buradan takip edin.")}
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">{tt("Toplam Gönderi")}</p>
          <p className="mt-1 text-xl font-bold text-fg tabular-nums">{kpi.total}</p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">{tt("Adres Bekleyen")}</p>
          <p className="mt-1 text-xl font-bold text-amber-500 tabular-nums">{kpi.pendingAddress}</p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">{tt("Gönderime Hazır")}</p>
          <p className="mt-1 text-xl font-bold text-sky-500 tabular-nums">{kpi.readyToShip}</p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">{tt("Kargoda")}</p>
          <p className="mt-1 text-xl font-bold text-violet-500 tabular-nums">{kpi.inTransit}</p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">{tt("Teslim Edildi")}</p>
          <p className="mt-1 text-xl font-bold text-emerald-500 tabular-nums">{kpi.delivered}</p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">{tt("İade / Sorun")}</p>
          <p className="mt-1 text-xl font-bold text-rose-500 tabular-nums">{kpi.returned}</p>
        </Card>
      </div>

      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("Kargo Takibi Aktif Kampanyalar")}</CardTitle>
        {campaigns.length === 0 ? (
          <EmptyState message={tt("Henüz ürün gönderimi / kargo takibi açılmış kampanya yok.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-passive">
                  <th className="py-2.5 pr-3">{tt("Kampanya")}</th>
                  <th className="py-2.5 pr-3">{tt("Marka")}</th>
                  <th className="py-2.5 pr-3">{tt("Gönderim Modu")}</th>
                  <th className="py-2.5 pr-3">{tt("Kargo Sayısı")}</th>
                  <th className="py-2.5 text-right">{tt("Yönet")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-surface/40">
                    <td className="py-2.5 pr-3 font-medium text-fg">
                      <Link href={`/admin/kampanyalar/${c.id}#kargo`} className="underline underline-offset-4">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-fg-muted">{c.brand.name}</td>
                    <td className="py-2.5 pr-3 text-fg-muted">
                      {c.shippingConfig?.shippingMode === "INTEGRATED_CARGO"
                        ? tt("Entegre Kargo")
                        : tt("Manuel Takip")}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums text-fg">{c._count.shipments}</td>
                    <td className="py-2.5 text-right">
                      <Link
                        href={`/admin/kampanyalar/${c.id}#kargo`}
                        className="text-fg underline underline-offset-4"
                      >
                        {tt("Kargo Modülünü Aç →")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("Son Gönderiler")}</CardTitle>
        {shipments.length === 0 ? (
          <EmptyState message={tt("Henüz kargo kaydı oluşturulmamış.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-passive">
                  <th className="py-2.5 pr-3">{tt("Influencer")}</th>
                  <th className="py-2.5 pr-3">{tt("Marka / Kampanya")}</th>
                  <th className="py-2.5 pr-3">{tt("Kargo / Takip No")}</th>
                  <th className="py-2.5 pr-3">{tt("Durum")}</th>
                  <th className="py-2.5 pr-3">{tt("Güncelleme")}</th>
                  <th className="py-2.5 text-right">{tt("Detay")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {shipments.map((s) => (
                  <tr key={s.id} className="hover:bg-surface/40">
                    <td className="py-2.5 pr-3">
                      <p className="font-medium text-fg">{s.influencer.name}</p>
                      <p className="text-[11px] text-fg-muted">{s.recipientPhone ?? s.influencer.city ?? "—"}</p>
                    </td>
                    <td className="py-2.5 pr-3">
                      <p className="text-fg">{s.campaign.name}</p>
                      <p className="text-[11px] text-fg-muted">{s.brand.name}</p>
                    </td>
                    <td className="py-2.5 pr-3">
                      {s.trackingNumber ? (
                        <div>
                          <p className="font-mono text-[11px] text-fg">
                            {s.carrierName ?? s.provider ?? "Kargo"} · {s.trackingNumber}
                          </p>
                          {s.trackingUrl ? (
                            <a
                              href={s.trackingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] text-emerald-500 underline"
                            >
                              {tt("Takip Et ↗")}
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-fg-passive">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[s.status]}`}
                      >
                        {shipmentStatusLabels[s.status]}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-[11px] text-fg-muted tabular-nums">
                      {fmtDateTime(s.updatedAt)}
                    </td>
                    <td className="py-2.5 text-right">
                      <Link
                        href={`/admin/kampanyalar/${s.campaignId}#kargo`}
                        className="text-fg underline underline-offset-4"
                      >
                        {tt("Kampanyaya Git")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("Marka Kargo Entegrasyonları")}</CardTitle>
        {integrations.length === 0 ? (
          <EmptyState message={tt("Henüz marka kargo entegrasyonu tanımlanmamış.")} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-passive">
                  <th className="py-2.5 pr-3">{tt("Marka")}</th>
                  <th className="py-2.5 pr-3">{tt("Sağlayıcı")}</th>
                  <th className="py-2.5 pr-3">{tt("Durum")}</th>
                  <th className="py-2.5 pr-3">{tt("Son Test")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {integrations.map((i) => (
                  <tr key={i.id} className="hover:bg-surface/40">
                    <td className="py-2.5 pr-3 font-medium text-fg">{i.brand.name}</td>
                    <td className="py-2.5 pr-3 text-fg-muted">{i.provider}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          i.isActive
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                            : "bg-fg/10 text-fg-muted"
                        }`}
                      >
                        {i.isActive ? tt("Aktif") : tt("Pasif")}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-[11px] text-fg-muted">
                      {i.lastTestedAt
                        ? `${i.lastTestOk ? tt("Başarılı") : tt("Hata")} · ${fmtDateTime(i.lastTestedAt)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{tt("Marka Kargo Entegrasyon Ayarları (Admin)")}</CardTitle>
            <p className="mt-0.5 text-xs text-fg-muted">
              {tt("Markaların anlaşmalı kargo API anahtarlarını ve bağlantılarını buradan yapılandırın.")}
            </p>
          </div>
          {brands.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {brands.map((b) => (
                <Link
                  key={b.id}
                  href={`/admin/kargo?marka=${b.id}`}
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    b.id === selectedBrandId
                      ? "border-fg bg-fg text-bg"
                      : "border-line bg-bg text-fg-muted hover:text-fg"
                  }`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
        {selectedBrandId ? (
          <BrandShippingIntegrationsPanel items={selectedBrandIntegrations} brandId={selectedBrandId} />
        ) : (
          <EmptyState message={tt("Henüz marka kaydı bulunmuyor.")} />
        )}
      </Card>
    </div>
  );
}
