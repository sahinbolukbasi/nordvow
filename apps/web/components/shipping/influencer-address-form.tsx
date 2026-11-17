"use client";

import { useActionState } from "react";
import { idleState } from "@/lib/action-state";
import { saveInfluencerAddressAction } from "@/lib/actions/shipping";
import { Button, Field, Input } from "@/components/ui/form";
import type { SavedAddressRow } from "./offer-shipment-modal";

export function InfluencerAddressForm({
  initial,
}: {
  initial: SavedAddressRow | null;
}) {
  const [state, action, pending] = useActionState(
    saveInfluencerAddressAction,
    idleState,
  );

  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Adres Başlığı">
        {(p) => (
          <Input
            {...p}
            name="label"
            defaultValue={initial?.label ?? "Ev / Stüdyo"}
            placeholder="Örn. Ev / Ajans"
          />
        )}
      </Field>
      <Field label="Alıcı Adı Soyadı">
        {(p) => (
          <Input
            {...p}
            name="recipientName"
            defaultValue={initial?.recipientName ?? ""}
            placeholder="Ad Soyad"
            required
          />
        )}
      </Field>
      <Field label="Telefon Numarası">
        {(p) => (
          <Input
            {...p}
            name="recipientPhone"
            defaultValue={initial?.recipientPhone ?? ""}
            placeholder="05XX XXX XX XX"
            required
          />
        )}
      </Field>
      <Field label="İl">
        {(p) => (
          <Input
            {...p}
            name="city"
            defaultValue={initial?.city ?? ""}
            placeholder="İstanbul"
            required
          />
        )}
      </Field>
      <Field label="İlçe">
        {(p) => (
          <Input
            {...p}
            name="district"
            defaultValue={initial?.district ?? ""}
            placeholder="Kadıköy"
            required
          />
        )}
      </Field>
      <Field label="Posta Kodu (Opsiyonel)">
        {(p) => (
          <Input
            {...p}
            name="postalCode"
            defaultValue={initial?.postalCode ?? ""}
            placeholder="34710"
          />
        )}
      </Field>
      <Field label="Açık Teslimat Adresi" className="sm:col-span-2">
        {(p) => (
          <Input
            {...p}
            name="addressLine"
            defaultValue={initial?.addressLine ?? ""}
            placeholder="Mahalle, sokak, bina ve daire no"
            required
          />
        )}
      </Field>
      <div className="flex items-center justify-end sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Teslimat Adresini Kaydet"}
        </Button>
      </div>
      {state.message ? (
        <p
          role="status"
          className={`sm:col-span-2 text-xs ${
            state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-critical"
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
