"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { idleState } from "@/lib/action-state";
import { respondOfferAction } from "@/lib/actions/offers";
import { Button } from "@/components/ui/form";
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

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Kabul Et
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Ürün Gönderimli Teklifi Kabul Et"
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-line bg-bg p-3 text-[13px]">
            <p className="font-medium text-fg">
              {productDetails.name || "Kampanya Ürünü"}
            </p>
            {productDetails.description ? (
              <p className="mt-1 text-fg-muted">{productDetails.description}</p>
            ) : null}
          </div>

          {!defaultAddr ? (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-[13px] text-amber-800 dark:text-amber-300">
              <p>
                Bu kampanyada tarafınıza fiziksel ürün gönderimi yapılacaktır. Devam edebilmek için lütfen önce Profil Ayarları sayfasından teslimat adresinizi ekleyin.
              </p>
              <Link
                href="/profil?sekme=kargo"
                className="inline-flex w-fit items-center rounded-full bg-fg px-4 py-2 text-xs font-medium text-bg hover:opacity-90"
              >
                Profil Ayarlarından Adres Ekle →
              </Link>
            </div>
          ) : (
            <form action={action} className="flex flex-col gap-4">
              <input type="hidden" name="id" value={offerId} />
              <input type="hidden" name="decision" value="KABUL" />
              <input type="hidden" name="recipientName" value={defaultAddr.recipientName} />
              <input type="hidden" name="recipientPhone" value={defaultAddr.recipientPhone} />
              <input type="hidden" name="addressLine" value={defaultAddr.addressLine} />
              <input type="hidden" name="city" value={defaultAddr.city} />
              <input type="hidden" name="district" value={defaultAddr.district} />
              <input type="hidden" name="postalCode" value={defaultAddr.postalCode ?? ""} />

              <div className="rounded-xl border border-line bg-surface p-3 text-[13px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-fg">Kayıtlı Teslimat Adresiniz ({defaultAddr.label})</span>
                  <Link href="/profil?sekme=kargo" className="text-xs text-fg-muted underline">
                    Profilden Düzenle
                  </Link>
                </div>
                <p className="mt-1 text-fg-muted">
                  {defaultAddr.recipientName} · {defaultAddr.recipientPhone}
                </p>
                <p className="text-fg-muted">
                  {defaultAddr.addressLine}, {defaultAddr.district}/{defaultAddr.city}
                </p>
              </div>

              {state.message ? (
                <p className={state.ok ? "text-[13px] text-emerald-600" : "text-[13px] text-rose-600"}>
                  {state.message}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Vazgeç
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Onaylanıyor…" : "Teklifi Kabul Et ve Kampanyaya Git"}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </>
  );
}
