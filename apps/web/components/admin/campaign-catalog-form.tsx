"use client";

import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select } from "@/components/ui/form";
import { deleteCampaignCatalogEntry, saveCampaignCatalogEntry } from "@/lib/actions/campaign-catalog";

export function CampaignCatalogForm({ entry }: { entry?: { id: string; kind: "sector" | "template"; name: string; sector?: string; active: boolean } }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <ActionForm action={saveCampaignCatalogEntry} submitLabel={entry ? "Kaydet" : "Ekle"} submitSize="sm" className="flex flex-wrap items-end gap-2">
        {entry ? <input type="hidden" name="id" value={entry.id} /> : null}
        <Field label="Tür">{(p) => <Select {...p} name="kind" defaultValue={entry?.kind ?? "sector"}><option value="sector">Sektör</option><option value="template">Hazır şablon</option></Select>}</Field>
        <Field label="Ad">{(p) => <Input {...p} name="name" required defaultValue={entry?.name} />}</Field>
        <Field label="Bağlı sektör">{(p) => <Input {...p} name="sector" defaultValue={entry?.sector ?? ""} placeholder="kozmetik" />}</Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={entry?.active ?? true} /> Aktif</label>
      </ActionForm>
      {entry ? <ActionForm action={deleteCampaignCatalogEntry} submitLabel="Sil" submitVariant="ghost" submitSize="sm"><input type="hidden" name="id" value={entry.id} /></ActionForm> : null}
    </div>
  );
}
