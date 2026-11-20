"use client";

import { useMemo, useState, useTransition } from "react";
import {
  bulkDispatchShipmentsAction,
  updateShipmentStatusAction,
} from "@/lib/actions/shipping";
import { Button, Input, Select } from "@/components/ui/form";
import { Card } from "@/components/ui/card";
import type { ShipmentStatus, ShippingMode, ShippingProvider } from "@infulancer/core/enums";
import { buildCarrierTrackingUrl, shipmentStatusLabels } from "@infulancer/core/shipping/types";
import type { BrandIntegrationRow } from "./brand-integrations-panel";

export type DashboardShipmentRow = {
  id: string;
  collaborationId: string;
  influencerId: string;
  influencerName: string;
  influencerCity: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  shippingAddress: {
    addressLine?: string;
    city?: string;
    district?: string;
    postalCode?: string | null;
  } | null;
  selectedVariant: Record<string, string> | null;
  provider: ShippingProvider | null;
  carrierName: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  barcodeLabelUrl: string | null;
  status: ShipmentStatus;
  estimatedDeliveryDate: string | null;
  deliveredAt: string | null;
};

export type DashboardKpi = {
  total: number;
  pendingAddress: number;
  readyToShip: number;
  inTransit: number;
  delivered: number;
  returned: number;
};

const STATUS_BADGE: Record<ShipmentStatus, string> = {
  PENDING_ADDRESS: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  READY_TO_SHIP: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  LABEL_CREATED: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  IN_TRANSIT: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  OUT_FOR_DELIVERY: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  DELIVERED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  RETURNED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export function CampaignShippingDashboard({
  shippingMode,
  kpi,
  shipments,
  integrations,
}: {
  shippingMode: ShippingMode;
  kpi: DashboardKpi;
  shipments: DashboardShipmentRow[];
  integrations: BrandIntegrationRow[];
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [provider, setProvider] = useState<ShippingProvider>(() => {
    const activeIntegrated = integrations.find(
      (i) => i.isActive && i.provider !== "CUSTOM_MANUAL",
    );
    if (activeIntegrated) {
      return activeIntegrated.provider;
    }
    return "CUSTOM_MANUAL";
  });
  const [manualCarrierName, setManualCarrierName] = useState("Yurtiçi Kargo");
  const [manualTrackingNumber, setManualTrackingNumber] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shipments.filter((s) => {
      if (statusFilter !== "ALL" && s.status !== statusFilter) return false;
      if (!q) return true;
      return (
        s.influencerName.toLowerCase().includes(q) ||
        (s.trackingNumber ?? "").toLowerCase().includes(q) ||
        (s.carrierName ?? "").toLowerCase().includes(q)
      );
    });
  }, [shipments, query, statusFilter]);

  const readyRows = filtered.filter((s) => s.status === "READY_TO_SHIP");
  const allReadySelected =
    readyRows.length > 0 && readyRows.every((s) => selectedIds.includes(s.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleSelectAllReady = () => {
    if (allReadySelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(readyRows.map((r) => r.id));
    }
  };

  const handleBulkDispatch = () => {
    if (!selectedIds.length) return;
    setFeedback(null);
    startTransition(async () => {
      const res = await bulkDispatchShipmentsAction({
        shipmentIds: selectedIds,
        provider,
        manualCarrierName: provider === "CUSTOM_MANUAL" ? manualCarrierName : null,
        manualTrackingNumber: provider === "CUSTOM_MANUAL" ? manualTrackingNumber : null,
      });
      if (res.ok) {
        setFeedback(`${res.succeeded} gönderi için kargo kaydı oluşturuldu.`);
        setSelectedIds([]);
        setManualTrackingNumber("");
      } else {
        setFeedback(res.failed[0]?.error ?? "Gönderi oluşturulamadı.");
      }
    });
  };

  const handleStatusChange = (
    id: string,
    next: "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "RETURNED",
  ) => {
    startTransition(async () => {
      const res = await updateShipmentStatusAction(id, next);
      if (res.message) setFeedback(res.message);
    });
  };

  return (
    <div className="flex flex-col gap-5" id="kargo">
      {/* Üst Özet Kartları (KPI) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card interactive={false} className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Toplam Gönderim</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-fg">{kpi.total}</p>
        </Card>
        <Card interactive={false} className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Adres Bekleyenler</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {kpi.pendingAddress}
          </p>
        </Card>
        <Card interactive={false} className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Kargolanacaklar</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-sky-600 dark:text-sky-400">
            {kpi.readyToShip}
          </p>
        </Card>
        <Card interactive={false} className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Yolda Olanlar</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-violet-600 dark:text-violet-400">
            {kpi.inTransit}
          </p>
        </Card>
        <Card interactive={false} className="p-4">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Teslim Edilenler</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {kpi.delivered}
          </p>
        </Card>
      </div>

      {/* Filtre, Arama ve Toplu İşlemler */}
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Influencer adı veya takip no ara…"
              className="max-w-xs"
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-auto"
            >
              <option value="ALL">Tüm Durumlar</option>
              {(Object.keys(shipmentStatusLabels) as ShipmentStatus[]).map((st) => (
                <option key={st} value={st}>
                  {shipmentStatusLabels[st]}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={provider}
              onChange={(e) => setProvider(e.target.value as ShippingProvider)}
              className="w-auto"
            >
              {integrations
                .filter((i) => i.isActive)
                .map((i) => (
                  <option key={i.provider} value={i.provider}>
                    {i.label}
                  </option>
                ))}
            </Select>
            {provider === "CUSTOM_MANUAL" ? (
              <>
                <Input
                  value={manualCarrierName}
                  onChange={(e) => setManualCarrierName(e.target.value)}
                  placeholder="Kargo firması"
                  className="w-36"
                />
                <Input
                  value={manualTrackingNumber}
                  onChange={(e) => setManualTrackingNumber(e.target.value)}
                  placeholder="Takip numarası"
                  className="w-40"
                />
              </>
            ) : null}
            <Button
              type="button"
              onClick={handleBulkDispatch}
              disabled={pending || selectedIds.length === 0}
            >
              {provider === "CUSTOM_MANUAL"
                ? `Takip Numarası Gir (${selectedIds.length})`
                : `Toplu Kargo Barkodu Oluştur (${selectedIds.length})`}
            </Button>
          </div>
        </div>

        {feedback ? (
          <p className="rounded-xl border border-line bg-bg px-3 py-2 text-[13px] text-fg">
            {feedback}
          </p>
        ) : null}

        {filtered.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-fg-muted">
            Bu filtreye uygun gönderi kaydı bulunamadı.
          </p>
        ) : (
          <>
            {/* Mobil Kart Görünümü */}
            <ul className="flex flex-col gap-3 md:hidden">
              {filtered.map((s) => {
                const variantStr = s.selectedVariant
                  ? Object.entries(s.selectedVariant)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(" · ")
                  : null;
                const trackHref = s.trackingNumber
                  ? s.trackingUrl || buildCarrierTrackingUrl(s.carrierName ?? s.provider, s.trackingNumber)
                  : "";
                return (
                  <li key={s.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-bg p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5">
                        {s.status === "READY_TO_SHIP" ? (
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(s.id)}
                            onChange={() => toggleSelect(s.id)}
                            aria-label={`${s.influencerName} seç`}
                            className="mt-1"
                          />
                        ) : null}
                        <div>
                          <div className="text-sm font-semibold text-fg">{s.influencerName}</div>
                          {s.recipientPhone ? (
                            <div className="text-[12px] text-fg-muted">{s.recipientPhone}</div>
                          ) : null}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[s.status]}`}>
                        {shipmentStatusLabels[s.status]}
                      </span>
                    </div>

                    <dl className="grid grid-cols-1 gap-2 rounded-xl border border-line/70 bg-surface p-3 text-[12px]">
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-[11px] uppercase tracking-wide text-fg-passive">Teslimat Adresi</dt>
                        <dd className="text-fg">
                          {s.shippingAddress
                            ? [s.shippingAddress.addressLine, s.shippingAddress.district, s.shippingAddress.city]
                                .filter(Boolean)
                                .join(", ")
                            : "Adres bekleniyor"}
                        </dd>
                      </div>
                      {variantStr ? (
                        <div className="flex flex-col gap-0.5 border-t border-line/60 pt-2">
                          <dt className="text-[11px] uppercase tracking-wide text-fg-passive">Varyant</dt>
                          <dd className="text-fg">{variantStr}</dd>
                        </div>
                      ) : null}
                      <div className="flex flex-col gap-1 border-t border-line/60 pt-2">
                        <dt className="text-[11px] uppercase tracking-wide text-fg-passive">Kargo Takip Bilgisi</dt>
                        <dd className="flex flex-wrap items-center justify-between gap-2">
                          {s.trackingNumber ? (
                            <>
                              <span className="font-mono text-[12px] font-medium text-fg">
                                {s.carrierName ?? "Kargo"} · {s.trackingNumber}
                              </span>
                              {trackHref ? (
                                <a
                                  href={trackHref}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-line-strong bg-bg px-2.5 py-0.5 text-[11px] font-medium text-fg hover:border-fg"
                                >
                                  Takip Et ↗
                                </a>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-fg-passive">Henüz takip numarası atanmadı</span>
                          )}
                        </dd>
                      </div>
                    </dl>

                    {["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(s.status) ? (
                      <Select
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleStatusChange(
                              s.id,
                              e.target.value as "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "RETURNED",
                            );
                          }
                        }}
                        className="w-full text-[12px]"
                      >
                        <option value="">Durum Güncelle…</option>
                        <option value="IN_TRANSIT">Yolda</option>
                        <option value="OUT_FOR_DELIVERY">Dağıtımda</option>
                        <option value="DELIVERED">Teslim Edildi</option>
                        <option value="RETURNED">İade / Teslim Edilemedi</option>
                      </Select>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/* Masaüstü Tablo Görünümü */}
            <div className="hidden overflow-x-auto rounded-2xl border border-line md:block">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className="bg-bg/80">
                  <tr className="border-b border-line text-[11px] uppercase tracking-wider text-fg-passive">
                    <th className="w-10 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={allReadySelected}
                        onChange={toggleSelectAllReady}
                        aria-label="Kargolanacakların tümünü seç"
                      />
                    </th>
                    <th className="px-4 py-3 font-medium">Influencer</th>
                    <th className="px-4 py-3 font-medium">Teslimat Adresi</th>
                    <th className="px-4 py-3 font-medium">Varyant</th>
                    <th className="px-4 py-3 font-medium">Kargo &amp; Takip</th>
                    <th className="px-4 py-3 font-medium">Durum</th>
                    <th className="px-4 py-3 text-right font-medium">İşlem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filtered.map((s) => {
                    const variantStr = s.selectedVariant
                      ? Object.entries(s.selectedVariant)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(" · ")
                      : "—";
                    const cityLine = s.shippingAddress
                      ? [s.shippingAddress.district, s.shippingAddress.city].filter(Boolean).join(" / ")
                      : "Adres bekleniyor";
                    const trackHref = s.trackingNumber
                      ? s.trackingUrl || buildCarrierTrackingUrl(s.carrierName ?? s.provider, s.trackingNumber)
                      : "";
                    return (
                      <tr key={s.id} className="align-middle transition-colors hover:bg-surface-hover/40">
                        <td className="px-4 py-3.5">
                          {s.status === "READY_TO_SHIP" ? (
                            <input
                              type="checkbox"
                              checked={selectedIds.includes(s.id)}
                              onChange={() => toggleSelect(s.id)}
                              aria-label={`${s.influencerName} seç`}
                            />
                          ) : null}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="font-medium text-fg">{s.influencerName}</div>
                          {s.recipientPhone ? (
                            <div className="text-[11px] text-fg-muted tabular-nums">{s.recipientPhone}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3.5 text-fg-muted">
                          <div className="font-medium text-fg">{cityLine}</div>
                          {s.shippingAddress?.addressLine ? (
                            <div className="max-w-[240px] truncate text-[11px] text-fg-passive" title={s.shippingAddress.addressLine}>
                              {s.shippingAddress.addressLine}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3.5 text-[12px] text-fg-muted">{variantStr}</td>
                        <td className="px-4 py-3.5">
                          {s.trackingNumber ? (
                            <div className="flex flex-col gap-1">
                              <span className="font-medium text-fg">
                                {s.carrierName ?? "Kargo"} · <span className="font-mono text-[12px]">{s.trackingNumber}</span>
                              </span>
                              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                                {trackHref ? (
                                  <a
                                    href={trackHref}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center rounded-full border border-line px-2 py-0.5 font-medium text-fg hover:border-fg"
                                  >
                                    Takip Et ↗
                                  </a>
                                ) : null}
                                {s.barcodeLabelUrl ? (
                                  <a
                                    href={s.barcodeLabelUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline underline-offset-2 text-fg-muted hover:text-fg"
                                  >
                                    Barkod Etiketi
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          ) : (
                            <span className="text-fg-passive">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE[s.status]}`}
                          >
                            {shipmentStatusLabels[s.status]}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right">
                          {["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(s.status) ? (
                            <Select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleStatusChange(
                                    s.id,
                                    e.target.value as
                                      | "IN_TRANSIT"
                                      | "OUT_FOR_DELIVERY"
                                      | "DELIVERED"
                                      | "RETURNED",
                                  );
                                }
                              }}
                              className="w-auto text-[12px]"
                            >
                              <option value="">Durum Güncelle…</option>
                              <option value="IN_TRANSIT">Yolda</option>
                              <option value="OUT_FOR_DELIVERY">Dağıtımda</option>
                              <option value="DELIVERED">Teslim Edildi</option>
                              <option value="RETURNED">İade / Teslim Edilemedi</option>
                            </Select>
                          ) : (
                            <span className="text-[11px] text-fg-passive">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

