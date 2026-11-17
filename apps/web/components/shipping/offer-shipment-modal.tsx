"use client";

import { useActionState, useState } from "react";
import { idleState } from "@/lib/action-state";
import { respondOfferAction } from "@/lib/actions/offers";
import { Button, Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import type { ProductDetails } from "@infulancer/core/shipping/types";

export type SavedAddressRow = {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  city: string;
  district: string;
  postalCode: string | null;
  isDefault: boolean;
};

export function OfferAcceptWithShipment({
  offerId,
  productDetails,
  savedAddresses,
}: {
  offerId: string;
  productDetails: ProductDetails;
  savedAddresses: SavedAddressRow[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(respondOfferAction, idleState);

  const defaultAddr = savedAddresses.find((a) => a.isDefault) ?? savedAddresses[0] ?? null;
  const [selectedAddrId, setSelectedAddrId] = useState<string>(defaultAddr?.id ?? "NEW");
  const [recipientName, setRecipientName] = useState(defaultAddr?.recipientName ?? "");
  const [recipientPhone, setRecipientPhone] = useState(defaultAddr?.recipientPhone ?? "");
  const [addressLine, setAddressLine] = useState(defaultAddr?.addressLine ?? "");
  const [city, setCity] = useState(defaultAddr?.city ?? "");
  const [district, setDistrict] = useState(defaultAddr?.district ?? "");
  const [postalCode, setPostalCode] = useState(defaultAddr?.postalCode ?? "");
  const [saveAddress, setSaveAddress] = useState(!defaultAddr);
  const [variants, setVariants] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const v of productDetails.variants ?? []) {
      if (v.options[0]) init[v.label] = v.options[0];
    }
    return init;
  });

  const handleSelectSaved = (id: string) => {
    setSelectedAddrId(id);
    if (id === "NEW") {
      setRecipientName("");
      setRecipientPhone("");
      setAddressLine("");
      setCity("");
      setDistrict("");
      setPostalCode("");
      setSaveAddress(true);
      return;
    }
    const found = savedAddresses.find((a) => a.id === id);
    if (found) {
      setRecipientName(found.recipientName);
      setRecipientPhone(found.recipientPhone);
      setAddressLine(found.addressLine);
      setCity(found.city);
      setDistrict(found.district);
      setPostalCode(found.postalCode ?? "");
      setSaveAddress(false);
    }
  };

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Kabul Et ve Adres Seç
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ürün Gönderimi & Teklif Onayı"
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="id" value={offerId} />
          <input type="hidden" name="decision" value="KABUL" />
          <input type="hidden" name="selectedVariant" value={JSON.stringify(variants)} />
          <input type="hidden" name="saveAddress" value={saveAddress ? "1" : "0"} />

          <div className="rounded-xl border border-line bg-bg p-3 text-[13px]">
            <p className="font-medium text-fg">
              {productDetails.name || "Kampanya Ürünü"}
            </p>
            {productDetails.description ? (
              <p className="mt-0.5 text-[12px] text-fg-muted">{productDetails.description}</p>
            ) : null}
          </div>

          {(productDetails.variants ?? []).length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {productDetails.variants.map((v) => (
                <Field key={v.label} label={v.label}>
                  {(p) => (
                    <Select
                      {...p}
                      value={variants[v.label] ?? v.options[0] ?? ""}
                      onChange={(e) =>
                        setVariants((prev) => ({ ...prev, [v.label]: e.target.value }))
                      }
                    >
                      {v.options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ))}
            </div>
          ) : null}

          {savedAddresses.length > 0 ? (
            <Field label="Kayıtlı Teslimat Adreslerim">
              {(p) => (
                <Select
                  {...p}
                  value={selectedAddrId}
                  onChange={(e) => handleSelectSaved(e.target.value)}
                >
                  {savedAddresses.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.district}/{a.city} ({a.recipientName})
                    </option>
                  ))}
                  <option value="NEW">+ Yeni Adres Gir</option>
                </Select>
              )}
            </Field>
          ) : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Alıcı Adı Soyadı">
              {(p) => (
                <Input
                  {...p}
                  name="recipientName"
                  required
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder="Ad Soyad"
                />
              )}
            </Field>
            <Field label="Telefon">
              {(p) => (
                <Input
                  {...p}
                  name="recipientPhone"
                  required
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="05XX XXX XX XX"
                />
              )}
            </Field>
            <Field label="İl">
              {(p) => (
                <Input
                  {...p}
                  name="city"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="İstanbul"
                />
              )}
            </Field>
            <Field label="İlçe">
              {(p) => (
                <Input
                  {...p}
                  name="district"
                  required
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                  placeholder="Kadıköy"
                />
              )}
            </Field>
            <Field label="Açık Adres" className="sm:col-span-2">
              {(p) => (
                <Input
                  {...p}
                  name="addressLine"
                  required
                  value={addressLine}
                  onChange={(e) => setAddressLine(e.target.value)}
                  placeholder="Mahalle, sokak, bina ve daire no"
                />
              )}
            </Field>
            <Field label="Posta Kodu (İsteğe bağlı)">
              {(p) => (
                <Input
                  {...p}
                  name="postalCode"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  placeholder="34000"
                />
              )}
            </Field>
          </div>

          <label className="flex items-center gap-2 text-[12px] text-fg-muted">
            <input
              type="checkbox"
              checked={saveAddress}
              onChange={(e) => setSaveAddress(e.target.checked)}
            />
            Bu adresi sonraki iş birliklerim için kaydet
          </label>

          {state.message && !state.ok ? (
            <p className="text-[13px] text-rose-600 dark:text-rose-400">{state.message}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Onaylanıyor…" : "Teklifi Kabul Et ve Adresi Onayla"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
