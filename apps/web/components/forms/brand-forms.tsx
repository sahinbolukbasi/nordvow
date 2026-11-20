"use client";

import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select } from "@/components/ui/form";
import { assignBrandUserAction, createBrandUser, deleteBrandAction, detachBrandUserAction, saveBrand, toggleBrandActiveAction } from "@/lib/actions/brands";
import type { CategoryNode } from "@infulancer/core/domain/categories";
import { CategoryPicker } from "@/components/forms/category-picker";
import { REGIONS } from "@infulancer/core/i18n/regions";

export type BrandFormValues = {
  id: string;
  name: string;
  taxOffice: string;
  taxNumber: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  contractRef: string | null;
  contractStartsAt: string | null;
  category: string;
  country?: string;
  competitorBrandIds: string[];
  categoryIds?: string[];
  primaryCategoryId?: string | null;
};

/** Marka oluşturma/düzenleme formu. */
export function BrandForm({ brand, otherBrands, categories }: { brand?: BrandFormValues; otherBrands: { id: string; name: string; category: string }[]; categories: CategoryNode[] }) {
  const tt = useTT();
  return (
    <ActionForm action={saveBrand} submitLabel={brand ? tt("Değişiklikleri kaydet") : tt("Markayı oluştur")} aria-label={tt("Marka bilgileri")}>
      {brand ? <input type="hidden" name="id" value={brand.id} /> : null}
      <CategoryPicker tree={categories} selected={brand?.categoryIds ?? []} primaryId={brand?.primaryCategoryId} />
      <p className="-mt-2 text-[12px] text-fg-passive">{tt("Ana kategori rakip/münhasırlık tespitinde kullanılır.")}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={tt("Marka adı")}>{(p) => <Input {...p} name="name" required defaultValue={brand?.name} />}</Field>
        <Field label={tt("Ülke")} hint={tt("Kampanya para birimi ve varsayılan bölge (tutarlar çevrilmez).")}>
          {(p) => (
            <Select {...p} name="country" defaultValue={brand?.country ?? "TR"}>
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.name} · {r.currency}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={tt("Vergi dairesi")}>{(p) => <Input {...p} name="taxOffice" required defaultValue={brand?.taxOffice} />}</Field>
        <Field label={tt("Vergi numarası")}>
          {(p) => <Input {...p} name="taxNumber" required inputMode="numeric" defaultValue={brand?.taxNumber} />}
        </Field>
        <Field label={tt("Yetkili")}>{(p) => <Input {...p} name="contactName" required defaultValue={brand?.contactName} />}</Field>
        <Field label={tt("Yetkili e-postası")}>
          {(p) => <Input {...p} name="contactEmail" type="email" required defaultValue={brand?.contactEmail} />}
        </Field>
        <Field label={tt("Telefon")}>{(p) => <Input {...p} name="contactPhone" type="tel" required defaultValue={brand?.contactPhone} />}</Field>
        <Field label={tt("Sözleşme no")}>{(p) => <Input {...p} name="contractRef" defaultValue={brand?.contractRef ?? ""} />}</Field>
        <Field label={tt("Sözleşme başlangıcı")}>
          {(p) => <Input {...p} name="contractStartsAt" type="date" defaultValue={brand?.contractStartsAt ?? ""} />}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label text-fg-muted">{tt("Rakip markalar")}</legend>
        {otherBrands.length === 0 ? (
          <p className="text-[13px] text-fg-passive">{tt("Başka marka yok.")}</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {otherBrands.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-sm text-fg-muted">
                <input
                  type="checkbox"
                  name="competitorBrandIds"
                  value={b.id}
                  defaultChecked={brand?.competitorBrandIds.includes(b.id)}
                  className="h-4 w-4 accent-[var(--color-fg)]"
                />
                {b.name} <span className="text-fg-passive">· {b.category}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </ActionForm>
  );
}

/** Marka kullanıcısı: e-posta + geçici şifre. */
export function BrandUserForm({ brandId }: { brandId: string }) {
  const tt = useTT();
  return (
    <ActionForm action={createBrandUser} submitLabel={tt("Kullanıcı oluştur")} submitVariant="secondary" resetOnSuccess aria-label={tt("Marka kullanıcısı")}>
      <input type="hidden" name="brandId" value={brandId} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={tt("Ad soyad")}>{(p) => <Input {...p} name="name" required />}</Field>
        <Field label={tt("E-posta")}>{(p) => <Input {...p} name="email" type="email" required autoComplete="off" />}</Field>
        <Field label={tt("Geçici şifre")} hint={tt("En az 8 karakter; ilk girişte paylaşın.")}>
          {(p) => <Input {...p} name="password" type="text" required minLength={8} autoComplete="new-password" />}
        </Field>
      </div>
    </ActionForm>
  );
}

/** Markayı sistemden gizlemek için pasife çekme / yeniden aktifleştirme butonu. */
export function BrandToggleActiveButton({
  brandId,
  name,
  isActive,
}: {
  brandId: string;
  name: string;
  isActive: boolean;
}) {
  const tt = useTT();
  const [confirming, setConfirming] = useState(false);

  if (!isActive) {
    return (
      <ActionForm
        action={toggleBrandActiveAction}
        submitLabel={tt("Aktifleştir")}
        submitVariant="secondary"
        submitSize="sm"
        aria-label={`${name}: ${tt("Aktifleştir")}`}
        className="!flex-row items-center gap-1"
      >
        <input type="hidden" name="brandId" value={brandId} />
        <input type="hidden" name="active" value="true" />
      </ActionForm>
    );
  }

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={`${name}: ${tt("Pasife Çek")}`}
        className="text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
      >
        {tt("Pasife Çek")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5">
      <span className="text-[12px] font-medium text-amber-300">
        {name} {tt("sistemden gizlensin mi?")}
      </span>
      <ActionForm
        action={toggleBrandActiveAction}
        submitLabel={tt("Evet, Pasife Çek")}
        submitSize="sm"
        submitVariant="primary"
        className="gap-1"
      >
        <input type="hidden" name="brandId" value={brandId} />
        <input type="hidden" name="active" value="false" />
      </ActionForm>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        {tt("Vazgeç")}
      </Button>
    </div>
  );
}

/** 2 adımlı onaylı marka silme butonu. */
export function BrandDeleteButton({
  brandId,
  name,
  redirectToList = false,
}: {
  brandId: string;
  name: string;
  redirectToList?: boolean;
}) {
  const tt = useTT();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setConfirming(true)}
        aria-label={`${name}: ${tt("Sil")}`}
        className="text-critical hover:bg-critical/10 hover:text-critical"
      >
        {tt("Sil")}
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-critical/40 bg-critical/5 px-2.5 py-1.5">
      <span className="text-[12px] font-medium text-critical">
        {name} {tt("kalıcı olarak silinsin mi?")}
      </span>
      <ActionForm action={deleteBrandAction} submitLabel={tt("Evet, Sil")} submitSize="sm" submitVariant="primary" className="gap-1">
        <input type="hidden" name="brandId" value={brandId} />
        {redirectToList ? <input type="hidden" name="redirectTo" value="/admin/markalar" /> : null}
      </ActionForm>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        {tt("Vazgeç")}
      </Button>
    </div>
  );
}

/** Mevcut bir marka kullanıcısını bu markaya atar (tek marka hesabına çoklu kullanıcı girişi). */
export function AssignExistingBrandUserForm({
  brandId,
  candidates,
}: {
  brandId: string;
  candidates: { id: string; name: string; email: string; currentBrandName: string | null }[];
}) {
  const tt = useTT();
  if (!candidates.length) return null;
  return (
    <ActionForm action={assignBrandUserAction} submitLabel={tt("Mevcut kullanıcıyı ata")} submitVariant="secondary" submitSize="sm" resetOnSuccess aria-label={tt("Mevcut kullanıcıyı markaya ata")}>
      <input type="hidden" name="brandId" value={brandId} />
      <Field label={tt("Mevcut kullanıcıyı bu marka hesabına bağla")}>
        {(p) => (
          <Select {...p} name="userId" required defaultValue="">
            <option value="" disabled>{tt("Kullanıcı seçin…")}</option>
            {candidates.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email}){u.currentBrandName ? ` · şu an: ${u.currentBrandName}` : " · atanmamış"}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </ActionForm>
  );
}

/** Kullanıcıyı marka hesabından ayırma butonu. */
export function DetachBrandUserButton({ brandId, userId, name }: { brandId: string; userId: string; name: string }) {
  const tt = useTT();
  return (
    <ActionForm action={detachBrandUserAction} submitLabel={tt("Çıkar")} submitVariant="ghost" submitSize="sm" aria-label={`${name}: ${tt("Markadan çıkar")}`} className="!flex-row">
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="userId" value={userId} />
    </ActionForm>
  );
}
