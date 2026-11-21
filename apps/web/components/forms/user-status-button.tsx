"use client";
import { useState } from "react";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select } from "@/components/ui/form";
import { createDirectUserAction, createStaffUserAction, deleteUserAction, setStaffRoleAction, setUserStatusAction, updateUserAction } from "@/lib/actions/users";

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
        {role === "INFLUENCER" || role === "BRAND" ? (
          <Field label={tt("Başlangıç kredisi (TL, opsiyonel)")}>
            {(p) => <Input {...p} name="initialCredits" type="number" min="0" step="1" placeholder={tt("Boş bırakılırsa varsayılan")} />}
          </Field>
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

/** 2 adımlı onaylı kullanıcı silme butonu. */
export function UserDeleteButton({ userId, name, email }: { userId: string; name: string; email: string }) {
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
        {name} ({email}) {tt("kalıcı olarak silinsin mi?")}
      </span>
      <ActionForm action={deleteUserAction} submitLabel={tt("Evet, Sil")} submitSize="sm" submitVariant="primary" className="gap-1">
        <input type="hidden" name="userId" value={userId} />
      </ActionForm>
      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
        {tt("Vazgeç")}
      </Button>
    </div>
  );
}

/** Satır içi kullanıcı bilgisi düzenleme (ad, e-posta, telefon, bağlı marka, opsiyonel şifre). */
export function UserEditButton({
  userId,
  name,
  email,
  phone,
  role,
  brandId,
  brands = [],
}: {
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  role: "ADMIN" | "AGENCY" | "BRAND" | "INFLUENCER";
  brandId: string | null;
  brands?: { id: string; name: string }[];
}) {
  const tt = useTT();
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)} aria-label={`${name}: ${tt("Düzenle")}`}>
        {tt("Düzenle")}
      </Button>
    );
  }

  return (
    <ActionForm
      action={updateUserAction}
      submitLabel={tt("Kaydet")}
      submitSize="sm"
      onSuccess={() => setEditing(false)}
      className="min-w-[280px] gap-2 rounded-xl border border-line bg-surface p-3"
      aria-label={`${name}: ${tt("Bilgileri düzenle")}`}
      footer={
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {tt("İptal")}
        </Button>
      }
    >
      <input type="hidden" name="userId" value={userId} />
      <Input name="name" defaultValue={name} required placeholder={tt("Ad soyad")} aria-label={tt("Ad soyad")} />
      <Input name="email" type="email" defaultValue={email} required placeholder={tt("E-posta")} aria-label={tt("E-posta")} />
      <Input name="phone" type="tel" defaultValue={phone ?? ""} placeholder={tt("Telefon (opsiyonel)")} aria-label={tt("Telefon")} />
      {role === "BRAND" ? (
        <Select name="brandId" defaultValue={brandId ?? ""} aria-label={tt("Bağlı marka")}>
          <option value="">{tt("Marka atanmamış")}</option>
          {brands.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
      ) : null}
      <Input name="password" type="text" minLength={8} autoComplete="new-password" placeholder={tt("Yeni şifre (boş = değişmez)")} aria-label={tt("Yeni şifre")} />
    </ActionForm>
  );
}
