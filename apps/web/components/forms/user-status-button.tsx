"use client";
import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Field, Input, Select } from "@/components/ui/form";
import { createDirectUserAction, createStaffUserAction, setStaffRoleAction, setUserStatusAction } from "@/lib/actions/users";

/** Satır içi askıya al / etkinleştir düğmesi. */
export function UserStatusButton({ userId, status, name }: { userId: string; status: "ACTIVE" | "SUSPENDED"; name: string }) {
  const tt = useTT();
  const next = status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  return (
    <ActionForm
      action={setUserStatusAction}
      submitLabel={next === "SUSPENDED" ? tt("Askıya al") : tt("Etkinleştir")}
      submitVariant={next === "SUSPENDED" ? "ghost" : "secondary"}
      submitSize="sm"
      aria-label={`${name}: ${next === "SUSPENDED" ? "askıya al" : "etkinleştir"}`}
      className="gap-1"
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="status" value={next} />
    </ActionForm>
  );
}

/** Ajans ekibi rol değiştirici (Admin ↔ Ajans). */
export function StaffRoleButton({ userId, role, name }: { userId: string; role: "ADMIN" | "AGENCY"; name: string }) {
  const tt = useTT();
  const next = role === "ADMIN" ? "AGENCY" : "ADMIN";
  return (
    <ActionForm action={setStaffRoleAction} submitLabel={next === "ADMIN" ? tt("Admin yap") : tt("Ajans yap")} submitVariant="ghost" submitSize="sm" aria-label={`${name}: rolü değiştir`} className="gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={next} />
    </ActionForm>
  );
}

/** Ajans ekibine kullanıcı ekleme formu. */
export function StaffUserForm() {
  const tt = useTT();
  return (
    <ActionForm action={createStaffUserAction} submitLabel={tt("Ekip üyesi ekle")} resetOnSuccess aria-label={tt("Ajans ekibine kullanıcı ekle")}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Field label={tt("Ad soyad")}>{(p) => <Input {...p} name="name" required />}</Field>
        <Field label={tt("E-posta")}>{(p) => <Input {...p} name="email" type="email" required autoComplete="off" />}</Field>
        <Field label={tt("Geçici şifre")}>{(p) => <Input {...p} name="password" type="text" required minLength={10} autoComplete="new-password" />}</Field>
        <Field label={tt("Rol")}>
          {(p) => (
            <Select {...p} name="role" defaultValue="AGENCY">
              <option value="AGENCY">{tt("Ajans (operasyon)")}</option>
              <option value="ADMIN">{tt("Admin (tam yetki)")}</option>
            </Select>
          )}
        </Field>
      </div>
    </ActionForm>
  );
}

/** Admin: davet linki olmadan doğrudan Influencer, Marka, Ajans veya Admin ekleme formu. */
export function DirectUserForm({ brands = [] }: { brands?: { id: string; name: string }[] }) {
  const tt = useTT();
  const [role, setRole] = useState<"INFLUENCER" | "BRAND" | "AGENCY" | "ADMIN">("INFLUENCER");
  return (
    <ActionForm action={createDirectUserAction} submitLabel={tt("Kullanıcıyı Doğrudan Ekle")} resetOnSuccess aria-label={tt("Doğrudan kullanıcı ekle")}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={tt("Rol")}>
          {(p) => (
            <Select {...p} name="role" value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
              <option value="INFLUENCER">{tt("Influencer")}</option>
              <option value="BRAND">{tt("Marka")}</option>
              <option value="AGENCY">{tt("Ajans (operasyon)")}</option>
              <option value="ADMIN">{tt("Admin (tam yetki)")}</option>
            </Select>
          )}
        </Field>
        <Field label={tt("Ad soyad")}>{(p) => <Input {...p} name="name" required placeholder={tt("Örn. Ayşe Yılmaz")} />}</Field>
        <Field label={tt("E-posta")}>{(p) => <Input {...p} name="email" type="email" required autoComplete="off" placeholder="ornek@alan.com" />}</Field>
        <Field label={tt("Telefon (opsiyonel)")}>{(p) => <Input {...p} name="phone" type="tel" placeholder="+90 5XX XXX XX XX" />}</Field>
        <Field label={tt("Geçici şifre")}>{(p) => <Input {...p} name="password" type="text" required minLength={8} autoComplete="new-password" placeholder={tt("En az 8 karakter")} />}</Field>
        {role === "INFLUENCER" ? (
          <Field label={tt("Kategori (opsiyonel)")}>{(p) => <Input {...p} name="category" placeholder={tt("Örn. Moda, Teknoloji, Yaşam")} />}</Field>
        ) : null}
        {role === "BRAND" ? (
          <>
            <Field label={tt("Mevcut markaya bağla (opsiyonel)")}>
              {(p) => (
                <Select {...p} name="brandId" defaultValue="">
                  <option value="">{tt("Yeni marka oluştur")}</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={tt("Yeni marka adı (yeni oluşturulacaksa)")}>{(p) => <Input {...p} name="companyName" placeholder={tt("Marka / Şirket adı")} />}</Field>
          </>
        ) : null}
      </div>
    </ActionForm>
  );
}
