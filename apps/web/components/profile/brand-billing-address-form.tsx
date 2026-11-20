"use client";

import { useActionState } from "react";
import { saveBrandAddressAction } from "@/lib/actions/brand-wallet";

const initial = { ok: false, message: "" };

export function BrandBillingAddressForm({ initialAddress }: { initialAddress?: { companyName: string | null; phone: string; addressLine: string; neighborhood: string | null; city: string; district: string; postalCode: string | null; taxOffice: string | null; taxNumber: string | null } | null }) {
  const [state, action, pending] = useActionState(saveBrandAddressAction, initial);
  return (
    <form action={action} className="grid gap-3 md:grid-cols-2">
      <input name="companyName" defaultValue={initialAddress?.companyName ?? ""} placeholder="Şirket unvanı / Ad Soyad" required className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="phone" defaultValue={initialAddress?.phone ?? ""} placeholder="İletişim telefonu" required className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="taxOffice" defaultValue={initialAddress?.taxOffice ?? ""} placeholder="Vergi dairesi" required className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="taxNumber" defaultValue={initialAddress?.taxNumber ?? ""} placeholder="VKN / TCKN" required className="h-10 rounded-lg border border-line bg-bg px-3" />
      <select name="taxpayerType" defaultValue="Şahıs Şirketi" className="h-10 rounded-lg border border-line bg-bg px-3">
        <option>Şahıs Şirketi</option>
        <option>Limited/Anonim Şirket</option>
      </select>
      <select name="eInvoiceType" defaultValue="e-Arşiv" className="h-10 rounded-lg border border-line bg-bg px-3">
        <option>e-Arşiv</option>
        <option>e-Fatura</option>
      </select>
      <input name="mersisNumber" placeholder="MERSİS No (opsiyonel)" className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="tradeRegistryNumber" placeholder="Ticaret sicil no (opsiyonel)" className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="billingEmail" type="email" placeholder="Fatura e-posta" className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="billingPhone" placeholder="Fatura telefonu" className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="city" defaultValue={initialAddress?.city ?? ""} placeholder="İl" required className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="district" defaultValue={initialAddress?.district ?? ""} placeholder="İlçe" required className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="neighborhood" defaultValue={initialAddress?.neighborhood ?? ""} placeholder="Mahalle" className="h-10 rounded-lg border border-line bg-bg px-3" />
      <input name="postalCode" defaultValue={initialAddress?.postalCode ?? ""} placeholder="Posta kodu" className="h-10 rounded-lg border border-line bg-bg px-3" />
      <textarea name="addressLine" defaultValue={initialAddress?.addressLine ?? ""} placeholder="Açık adres" required className="min-h-24 rounded-lg border border-line bg-bg px-3 py-2 md:col-span-2" />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isBilling" defaultChecked /> Fatura adresi</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isShipping" defaultChecked /> Gönderici adresi</label>
      {state.message ? <p className={state.ok ? "text-sm text-emerald-500 md:col-span-2" : "text-sm text-red-400 md:col-span-2"}>{state.message}</p> : null}
      <button disabled={pending} className="h-10 rounded-lg bg-fg px-4 text-sm font-semibold text-bg md:col-span-2">{pending ? "Kaydediliyor..." : "Adres ve fatura bilgilerini kaydet"}</button>
    </form>
  );
}
