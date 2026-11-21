"use client";

import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select } from "@/components/ui/form";
import { manageCreditAction, saveStarterCreditsAction } from "@/lib/actions/operations";

/** Yönetici: Yeni gelen kullanıcılara verilen varsayılan hoş geldin kredisi formu. */
export function StarterCreditsForm({ defaultValue }: { defaultValue: number }) {
  const tt = useTT();
  return (
    <ActionForm
      action={saveStarterCreditsAction}
      submitLabel={tt("Kaydet")}
      submitSize="sm"
      className="flex-col gap-3"
      aria-label={tt("Yeni kullanıcı hoş geldin kredisi")}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label={tt("Yeni kullanıcı hoş geldin kredisi (TL)")} className="min-w-[220px] flex-1 max-w-xs">
          {(p) => <Input {...p} name="starterCreditsTry" type="number" min="0" step="1" required defaultValue={defaultValue} />}
        </Field>
      </div>
      <p className="text-[12px] text-fg-muted">
        {tt("Yeni gelen her marka ve influencer ilk girişte bu tutarda hoş geldin kredisi alır. 0 girerseniz otomatik ücretsiz kredi tanımlanmaz.")}
      </p>
    </ActionForm>
  );
}

/** Tablo satırı içi kredi ekleme / düşme / bakiye belirleme kontrolü. */
export function CreditRowManager({ tenantId, name, currentBalance }: { tenantId: string; name: string; currentBalance: number }) {
  const tt = useTT();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"add" | "deduct" | "set">("add");

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label={`${name}: ${tt("Krediyi yönet")}`}>
        {tt("Krediyi yönet")}
      </Button>
    );
  }

  return (
    <ActionForm
      action={manageCreditAction}
      submitLabel={tt("Uygula")}
      submitSize="sm"
      resetOnSuccess
      onSuccess={() => setOpen(false)}
      className="min-w-[260px] gap-2 rounded-xl border border-line bg-surface p-2.5"
      aria-label={`${name}: ${tt("Kredi güncelle")}`}
      footer={
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {tt("İptal")}
        </Button>
      }
    >
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="grid grid-cols-2 gap-2">
        <Select name="mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label={tt("İşlem türü")}>
          <option value="add">{tt("Ekle (+)")}</option>
          <option value="deduct">{tt("Düş (-)")}</option>
          <option value="set">{tt("Belirle (=)")}</option>
        </Select>
        <Input
          name="amount"
          type="number"
          min={mode === "set" ? "0" : "1"}
          step="1"
          required
          defaultValue={mode === "set" ? Math.floor(currentBalance) : undefined}
          placeholder={tt("Tutar")}
          aria-label={tt("Tutar")}
        />
      </div>
      <Input name="note" type="text" maxLength={200} placeholder={tt("Not (opsiyonel)")} aria-label={tt("Not")} />
    </ActionForm>
  );
}

