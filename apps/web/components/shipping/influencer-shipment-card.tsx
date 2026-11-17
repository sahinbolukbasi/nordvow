"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import { idleState } from "@/lib/action-state";
import {
  confirmShipmentAddressAction,
  markShipmentDeliveredAction,
} from "@/lib/actions/shipping";
import { Button } from "@/components/ui/form";
import { Card, CardTitle } from "@/components/ui/card";
import type { ContentTriggerRule, ShipmentStatus } from "@infulancer/core/enums";
import { buildCarrierTrackingUrl, type ProductDetails } from "@infulancer/core/shipping/types";
import type { SavedAddressRow } from "./offer-shipment-modal";

const STEPS: { key: ShipmentStatus; label: string }[] = [
  { key: "READY_TO_SHIP", label: "Adres Onaylandı" },
  { key: "LABEL_CREATED", label: "Hazırlanıyor" },
  { key: "IN_TRANSIT", label: "Kargoya Verildi" },
  { key: "OUT_FOR_DELIVERY", label: "Dağıtımda" },
  { key: "DELIVERED", label: "Teslim Edildi" },
];

const STEP_INDEX: Record<ShipmentStatus, number> = {
  PENDING_ADDRESS: -1,
  READY_TO_SHIP: 0,
  LABEL_CREATED: 1,
  IN_TRANSIT: 2,
  OUT_FOR_DELIVERY: 3,
  DELIVERED: 4,
  RETURNED: -2,
};

export function InfluencerShipmentCard({
  shipment,
  productDetails,
  contentTriggerRule,
  savedAddresses,
}: {
  shipment: {
    id: string;
    status: ShipmentStatus;
    carrierName: string | null;
    trackingNumber: string | null;
    trackingUrl: string | null;
    selectedVariant: Record<string, string> | null;
    recipientName: string | null;
    recipientPhone: string | null;
    shippingAddress: {
      addressLine?: string;
      city?: string;
      district?: string;
      postalCode?: string | null;
    } | null;
  };
  productDetails: ProductDetails;
  contentTriggerRule: ContentTriggerRule;
  savedAddresses: SavedAddressRow[];
}) {
  const [copied, setCopied] = useState(false);
  const [delivering, startDeliver] = useTransition();
  const [deliverMsg, setDeliverMsg] = useState<string | null>(null);
  const [addrState, addrAction, addrPending] = useActionState(
    confirmShipmentAddressAction,
    idleState,
  );
  const defaultAddr = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0] ?? null;
  const currentIdx = STEP_INDEX[shipment.status];
  const trackingHref =
    shipment.trackingUrl || buildCarrierTrackingUrl(shipment.carrierName, shipment.trackingNumber);

  const handleCopy = async () => {
    if (!shipment.trackingNumber) return;
    await navigator.clipboard.writeText(shipment.trackingNumber).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleMarkDelivered = () => {
    startDeliver(async () => {
      const res = await markShipmentDeliveredAction(shipment.id);
      setDeliverMsg(res.message ?? null);
    });
  };

  return (
    <Card interactive={false} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CardTitle>Ürün Gönderim & Kargo Takibi</CardTitle>
          <span className="rounded-full bg-fg/10 px-2.5 py-0.5 text-[11px] font-medium text-fg">
            {productDetails.name || "Kampanya Ürünü"}
          </span>
        </div>
        {shipment.status !== "PENDING_ADDRESS" && shipment.status !== "DELIVERED" ? (
          <Button
            type="button"
            variant="secondary"
            onClick={handleMarkDelivered}
            disabled={delivering}
          >
            {delivering ? "İşaretleniyor…" : "Ürünü Teslim Aldım"}
          </Button>
        ) : null}
      </div>

      {/* Kargo Durum Çubuğu (Stepper) */}
      {shipment.status === "RETURNED" ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-[13px] text-rose-700 dark:text-rose-300">
          Kargo teslim edilemedi / iade sürecinde. Lütfen marka ile iletişime geçin.
        </div>
      ) : (
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {STEPS.map((st, idx) => {
            const done = currentIdx >= idx;
            const active = currentIdx === idx;
            return (
              <li
                key={st.key}
                className={
                  done
                    ? "flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-[12px] font-medium text-emerald-700 dark:text-emerald-300"
                    : "flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2 text-[12px] text-fg-passive"
                }
              >
                <span
                  className={
                    active
                      ? "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] text-white"
                      : done
                        ? "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px]"
                        : "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line text-[10px]"
                  }
                >
                  {done ? "✓" : idx + 1}
                </span>
                <span>{st.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Kargo takip bilgileri */}
      {shipment.trackingNumber ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-bg px-4 py-3 text-[13px]">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-fg-muted">Kargo Firması:</span>
            <strong className="text-fg">{shipment.carrierName ?? "Kargo"}</strong>
            <span className="text-fg-muted">Takip No:</span>
            <code className="rounded bg-surface px-2 py-0.5 font-mono text-[12px] text-fg">
              {shipment.trackingNumber}
            </code>
            <Button type="button" variant="ghost" onClick={handleCopy}>
              {copied ? "Kopyalandı ✓" : "Kopyala"}
            </Button>
          </div>
          {trackingHref ? (
            <a
              href={trackingHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-xl border border-line bg-surface px-3 py-1.5 text-[12px] font-medium text-fg hover:border-fg/40"
            >
              Kargoyu Takip Et ↗
            </a>
          ) : null}
        </div>
      ) : null}

      {/* Adres yoksa Profil Ayarlarına yönlendir, varsa tek tıkla profil adresini onayla */}
      {shipment.status === "PENDING_ADDRESS" ? (
        !defaultAddr ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[13px] text-amber-800 dark:text-amber-300">
            <span>
              Kargo çıkışının yapılabilmesi için lütfen Profil Ayarları sayfasından teslimat adresinizi ekleyin.
            </span>
            <Link
              href="/profil?sekme=kargo"
              className="rounded-full bg-fg px-4 py-1.5 text-xs font-medium text-bg hover:opacity-90"
            >
              Profil Ayarlarından Adres Ekle →
            </Link>
          </div>
        ) : (
          <form action={addrAction} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <input type="hidden" name="shipmentId" value={shipment.id} />
            <input type="hidden" name="recipientName" value={defaultAddr.recipientName} />
            <input type="hidden" name="recipientPhone" value={defaultAddr.recipientPhone} />
            <input type="hidden" name="addressLine" value={defaultAddr.addressLine} />
            <input type="hidden" name="city" value={defaultAddr.city} />
            <input type="hidden" name="district" value={defaultAddr.district} />
            <input type="hidden" name="postalCode" value={defaultAddr.postalCode ?? ""} />
            <div className="text-[13px]">
              <p className="font-medium text-fg">
                Kayıtlı Adresiniz ({defaultAddr.label})
              </p>
              <p className="text-fg-muted">
                {defaultAddr.addressLine}, {defaultAddr.district}/{defaultAddr.city}
              </p>
              {addrState.message ? <p className="mt-1 text-xs text-fg">{addrState.message}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <Link href="/profil?sekme=kargo" className="text-xs text-fg-muted underline">
                Adresi Değiştir
              </Link>
              <Button type="submit" disabled={addrPending}>
                {addrPending ? "Onaylanıyor…" : "Profil Adresimle Onayla"}
              </Button>
            </div>
          </form>
        )
      ) : null}

      {/* İçerik Yükleme Kilidi / Bilgilendirmesi */}
      {contentTriggerRule === "AFTER_DELIVERY" && shipment.status !== "DELIVERED" ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-800 dark:text-amber-200">
          Ürününüz kargo aşamasındadır. Ürün elinize ulaştıktan sonra çekim yaparak içeriğinizi bu alandan yükleyebilirsiniz.
        </div>
      ) : null}

      {deliverMsg ? (
        <p className="text-[13px] text-emerald-600 dark:text-emerald-400">{deliverMsg}</p>
      ) : null}
    </Card>
  );
}
