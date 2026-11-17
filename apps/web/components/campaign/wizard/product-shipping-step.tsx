"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { idleState } from "@/lib/action-state";
import { wizardProductShippingAction } from "@/lib/actions/campaign-wizard";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { ContentTriggerRule, ShippingMode, ShippingProvider } from "@infulancer/core/enums";
import { shippingProviderLabels, type ProductDetails } from "@infulancer/core/shipping/types";

const CARRIER_OPTIONS: ShippingProvider[] = [
  "YURTICI",
  "ARAS",
  "MNG",
  "UPS",
  "HEPSIJET",
  "KOLAY_GELSIN",
  "NAVLUNGO",
  "CUSTOM_MANUAL",
];

export function ProductShippingStep({
  id,
  backHref,
  initial,
  hasBrandSenderAddress = true,
}: {
  id: string;
  backHref: string;
  initial: {
    requiresProductShipment: boolean;
    shippingMode: ShippingMode;
    productDetails: ProductDetails;
    contentTriggerRule: ContentTriggerRule;
    contentDeadlineDays: number | null;
  };
  hasBrandSenderAddress?: boolean;
}) {
  const [state, action, pending] = useActionState(
    wizardProductShippingAction,
    idleState,
  );
  const [productUrls, setProductUrls] = useState<string[]>(
    initial.productDetails.productUrls?.length ? initial.productDetails.productUrls : [""],
  );
  const [description, setDescription] = useState(initial.productDetails.description ?? "");
  const [shippingMode, setShippingMode] = useState<ShippingMode>(initial.shippingMode);
  const [preferredCarrier, setPreferredCarrier] = useState<ShippingProvider>(
    initial.productDetails.preferredCarrier ?? "YURTICI",
  );

  const updateUrl = (idx: number, val: string) => {
    setProductUrls((prev) => prev.map((u, i) => (i === idx ? val : u)));
  };
  const addUrl = () => {
    setProductUrls((prev) => [...prev, ""]);
  };
  const removeUrl = (idx: number) => {
    setProductUrls((prev) => (prev.length <= 1 ? [""] : prev.filter((_, i) => i !== idx)));
  };

  const cleanUrls = productUrls.map((u) => u.trim()).filter(Boolean);

  const payload = JSON.stringify({
    requiresProductShipment: true,
    shippingMode,
    productDetails: {
      name: initial.productDetails.name || "Kampanya Ürünü",
      description,
      imageUrl: null,
      estimatedValueTry: null,
      productUrls: cleanUrls,
      preferredCarrier,
      variants: [],
    },
    contentTriggerRule: initial.contentTriggerRule ?? "ANYTIME",
    contentDeadlineDays: initial.contentDeadlineDays ?? 7,
  });

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="configJson" value={payload} />

      {!hasBrandSenderAddress ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-800 dark:text-amber-300">
          <span>
            Profilinizde kayıtlı gönderici adresi bulunmuyor. Kargo çıkışında kullanılmak üzere adresinizi Profil Ayarları sayfasından ekleyin.
          </span>
          <Link
            href="/profil?sekme=kargo"
            className="shrink-0 rounded-full border border-amber-500/50 bg-bg px-3 py-1 text-xs font-medium text-fg hover:bg-surface"
          >
            Profil Ayarlarından Adres Ekle →
          </Link>
        </div>
      ) : null}

      <div className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-4 sm:p-5">
        {/* 1. Ürün Linkleri */}
        <div className="flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-fg">Ürün Linkleri</span>
            <Button type="button" variant="secondary" size="sm" onClick={addUrl}>
              + Yeni Link Ekle
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {productUrls.map((url, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Input
                  type="url"
                  value={url}
                  onChange={(e) => updateUrl(idx, e.target.value)}
                  placeholder="https://www.markaniz.com/urun-..."
                />
                {productUrls.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeUrl(idx)}
                    aria-label="Linki kaldır"
                  >
                    ✕
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        {/* 2. Ürün Açıklaması / Detayı */}
        <Field label="Ürün Açıklaması / Detayı">
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Influencer'a gönderilecek ürünlerin içeriğini, adetlerini ve önemli notları yazın…"
            />
          )}
        </Field>

        {/* 3. Gönderim Yöntemi */}
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-[13px] font-medium text-fg">Gönderim Yöntemi</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-bg p-3">
              <input
                type="radio"
                name="shippingModeRadio"
                checked={shippingMode === "INTEGRATED_CARGO"}
                onChange={() => setShippingMode("INTEGRATED_CARGO")}
                className="mt-1"
              />
              <div>
                <div className="text-[13px] font-medium text-fg">
                  Anlaşmalı Kargo Entegrasyonu
                </div>
                <div className="text-[11px] text-fg-muted">
                  Otomatik barkod ve kargo takip bağlantısı oluşturulur.
                </div>
              </div>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-bg p-3">
              <input
                type="radio"
                name="shippingModeRadio"
                checked={shippingMode === "MANUAL_TRACKING"}
                onChange={() => setShippingMode("MANUAL_TRACKING")}
                className="mt-1"
              />
              <div>
                <div className="text-[13px] font-medium text-fg">
                  Kendi Kargom / Manuel Takip
                </div>
                <div className="text-[11px] text-fg-muted">
                  Gönderimi kendiniz yapıp kargo takip numarasını kampanya sayfasından atayın.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* 4. Kargo Firması Seçimi */}
        <Field label="Kargo Firması Seçimi">
          {(p) => (
            <Select
              {...p}
              value={preferredCarrier}
              onChange={(e) => setPreferredCarrier(e.target.value as ShippingProvider)}
            >
              {CARRIER_OPTIONS.map((prov) => (
                <option key={prov} value={prov}>
                  {shippingProviderLabels[prov]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {state.message ? (
        <p className={state.ok ? "text-[13px] text-emerald-600" : "text-[13px] text-rose-600"}>
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <Link href={backHref} className="text-[13px] text-fg-muted hover:text-fg">
          ← Önceki adım
        </Link>
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="stay" variant="secondary" disabled={pending}>
            Taslağı kaydet
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Kaydediliyor…" : "Kaydet ve devam"}
          </Button>
        </div>
      </div>
    </form>
  );
}
