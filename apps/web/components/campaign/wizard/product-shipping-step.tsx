"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { idleState } from "@/lib/action-state";
import { wizardProductShippingAction } from "@/lib/actions/campaign-wizard";
import { Button, Field, Input } from "@/components/ui/form";
import type { ContentTriggerRule, ShippingMode } from "@infulancer/core/enums";
import type { ProductDetails, ProductVariantDef } from "@infulancer/core/shipping/types";

export function ProductShippingStep({
  id,
  backHref,
  initial,
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
}) {
  const [state, action, pending] = useActionState(
    wizardProductShippingAction,
    idleState,
  );
  const [enabled, setEnabled] = useState(initial.requiresProductShipment);
  const [shippingMode, setShippingMode] = useState<ShippingMode>(initial.shippingMode);
  const [contentTriggerRule, setContentTriggerRule] = useState<ContentTriggerRule>(
    initial.contentTriggerRule,
  );
  const [name, setName] = useState(initial.productDetails.name ?? "");
  const [description, setDescription] = useState(initial.productDetails.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial.productDetails.imageUrl ?? "");
  const [estimatedValueTry, setEstimatedValueTry] = useState(
    initial.productDetails.estimatedValueTry != null
      ? String(initial.productDetails.estimatedValueTry)
      : "",
  );
  const [deadlineDays, setDeadlineDays] = useState(
    initial.contentDeadlineDays != null ? String(initial.contentDeadlineDays) : "7",
  );
  const [variants, setVariants] = useState<ProductVariantDef[]>(
    initial.productDetails.variants ?? [],
  );
  const [newVariantLabel, setNewVariantLabel] = useState("");
  const [newVariantOptions, setNewVariantOptions] = useState("");

  const addVariant = () => {
    const label = newVariantLabel.trim();
    const opts = newVariantOptions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!label || opts.length === 0) return;
    setVariants((prev) => [...prev, { label, options: opts }]);
    setNewVariantLabel("");
    setNewVariantOptions("");
  };

  const removeVariant = (idx: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  };

  const payload = JSON.stringify({
    requiresProductShipment: enabled,
    shippingMode,
    productDetails: {
      name,
      description,
      imageUrl: imageUrl || null,
      estimatedValueTry: estimatedValueTry ? Number(estimatedValueTry) : null,
      variants,
    },
    contentTriggerRule,
    contentDeadlineDays: deadlineDays ? Number(deadlineDays) : 7,
  });

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="configJson" value={payload} />

      <label className="flex items-start gap-3 rounded-xl border border-line bg-bg p-4">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-line"
        />
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-medium text-fg">
            Bu kampanyada influencer&apos;lara fiziksel ürün gönderimi yapılacak
          </span>
          <span className="text-[12px] text-fg-muted">
            Aktif edildiğinde influencer&apos;lar teklifi kabul ederken teslimat adresi ve ürün varyantı seçer.
          </span>
        </div>
      </label>

      {enabled ? (
        <div className="flex flex-col gap-5 rounded-xl border border-line bg-surface p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Ürün Adı">
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Örn: Hydra Glow Serum 30ml"
                />
              )}
            </Field>
            <Field label="Tahmini Ürün Değeri (TL)">
              {(p) => (
                <Input
                  {...p}
                  type="number"
                  min={0}
                  value={estimatedValueTry}
                  onChange={(e) => setEstimatedValueTry(e.target.value)}
                  placeholder="Örn: 1250"
                />
              )}
            </Field>
            <Field label="Ürün Açıklaması" className="sm:col-span-2">
              {(p) => (
                <Input
                  {...p}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Influencer'a gönderilecek ürün paketi hakkında kısa bilgi"
                />
              )}
            </Field>
            <Field label="Ürün Görsel URL (İsteğe bağlı)" className="sm:col-span-2">
              {(p) => (
                <Input
                  {...p}
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://..."
                />
              )}
            </Field>
          </div>

          {/* Varyant Tanımları */}
          <div className="flex flex-col gap-2 border-t border-line pt-4">
            <p className="text-[13px] font-medium text-fg">
              İstenecek Varyant Bilgileri (Beden, Renk, Cilt Tipi vb.)
            </p>
            {variants.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {variants.map((v, i) => (
                  <li
                    key={`${v.label}-${i}`}
                    className="flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-1 text-[12px]"
                  >
                    <span className="font-medium text-fg">{v.label}:</span>
                    <span className="text-fg-muted">{v.options.join(" / ")}</span>
                    <button
                      type="button"
                      onClick={() => removeVariant(i)}
                      className="text-rose-500 hover:underline"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Input
                value={newVariantLabel}
                onChange={(e) => setNewVariantLabel(e.target.value)}
                placeholder="Özellik (Örn: Beden)"
              />
              <Input
                value={newVariantOptions}
                onChange={(e) => setNewVariantOptions(e.target.value)}
                placeholder="Seçenekler virgülle (Örn: S, M, L)"
              />
              <Button type="button" variant="secondary" onClick={addVariant}>
                Varyant Ekle
              </Button>
            </div>
          </div>

          {/* Gönderim Yöntemi */}
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
                    Nordvow Kargo Entegrasyonu ile Gönder
                  </div>
                  <div className="text-[11px] text-fg-muted">
                    Tek tıkla barkod/etiket oluşturun, teslimat durumunu otomatik izleyin.
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
                    Kendi Kargomla Gönderip Takip Bilgisi Gireceğim
                  </div>
                  <div className="text-[11px] text-fg-muted">
                    Mevcut kargo anlaşmanızla gönderip takip numarasını panele girin.
                  </div>
                </div>
              </label>
            </div>
          </div>

          {/* İçerik Tetikleme Kuralı */}
          <div className="flex flex-col gap-3 border-t border-line pt-4">
            <label className="flex items-start gap-2.5 text-[13px] text-fg">
              <input
                type="checkbox"
                checked={contentTriggerRule === "AFTER_DELIVERY"}
                onChange={(e) =>
                  setContentTriggerRule(e.target.checked ? "AFTER_DELIVERY" : "ANYTIME")
                }
                className="mt-0.5 h-4 w-4 rounded border-line"
              />
              <span>
                İçerik çekim süresi, ürün influencer&apos;a teslim edildikten sonra başlasın
              </span>
            </label>
            {contentTriggerRule === "AFTER_DELIVERY" ? (
              <Field label="Teslimat sonrası içerik yükleme süresi (Gün)" className="max-w-xs">
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    min={1}
                    max={90}
                    value={deadlineDays}
                    onChange={(e) => setDeadlineDays(e.target.value)}
                  />
                )}
              </Field>
            ) : null}
          </div>
        </div>
      ) : null}

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
