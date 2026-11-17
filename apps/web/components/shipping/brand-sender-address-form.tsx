"use client";

import { useActionState } from "react";
import { idleState } from "@/lib/action-state";
import { saveBrandSenderAddressAction } from "@/lib/actions/shipping";
import { Button, Field, Input } from "@/components/ui/form";
import type { SenderAddress } from "@infulancer/core/shipping/types";

export function BrandSenderAddressForm({
  initial,
}: {
  initial: SenderAddress | null;
}) {
  const [state, action, pending] = useActionState(
    saveBrandSenderAddressAction,
    idleState,
  );

  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Gönderici Adı / Firma Ünvanı">
        {(p) => (
          <Input
            {...p}
            name="senderName"
            defaultValue={initial?.senderName ?? ""}
            placeholder="Örn. Nordvow Kozmetik A.Ş."
            required
          />
        )}
      </Field>
      <Field label="Gönderici Telefon">
        {(p) => (
          <Input
            {...p}
            name="senderPhone"
            defaultValue={initial?.senderPhone ?? ""}
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
            placeholder="Beşiktaş"
            required
          />
        )}
      </Field>
      <Field label="Açık Gönderici Adresi" className="sm:col-span-2">
        {(p) => (
          <Input
            {...p}
            name="addressLine"
            defaultValue={initial?.addressLine ?? ""}
            placeholder="Mahalle, cadde, sokak, bina/daire no"
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
            placeholder="34353"
          />
        )}
      </Field>
      <div className="flex items-end justify-end sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Kaydediliyor…" : "Gönderici Adresini Kaydet"}
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
