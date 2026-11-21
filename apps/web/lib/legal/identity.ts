import type { LegalEntity } from "@/lib/legal";
import type { LegalLang } from "./types";

/** Boş şirket alanı köşeli parantezle durur; dolu alan hem belirteci hem değeri gösterir. */
export function field(value: string | null | undefined, token: string): string {
  const v = (value ?? "").trim();
  return v ? `${token}: ${v}` : token;
}

export function identityLines(e: LegalEntity): string[] {
  return [
    field(e.title, "[Şirket unvanı]"),
    field(e.mersis, "[MERSİS numarası]"),
    field(e.taxOffice, "[Vergi dairesi]"),
    field(e.taxNumber, "[Vergi kimlik numarası]"),
    "[Ticaret sicil numarası]",
    field(e.address, "[Merkez adresi]"),
    field(e.kep, "[KEP adresi]"),
    field(e.kvkkEmail, "[KVKK başvuru e-postası]"),
    field(e.email, "[Destek e-postası]"),
    "[Telefon]",
  ];
}

export function identityTitle(lang: LegalLang): string {
  return lang === "tr" ? "Şirket bilgileri (yayımlamadan önce doldurulacak)" : "Company details (fill before publication)";
}

export function identityIntro(lang: LegalLang): string {
  return lang === "tr"
    ? "İşbu metinde “Nordvow”, aşağıda kimliği yazılı şirketi ifade eder. Köşeli parantez içindeki alanlar şirket bilgisi girilene kadar yer tutucudur. Bağlayıcı metin Türkçe metindir. Bu sürüm taslaktır ve bir Türk avukatının incelemesi olmadan yayımlanmamalıdır."
    : "In these texts “Nordvow” means the company identified below. Items in square brackets are placeholders until the company details are completed. The Turkish text is the binding version. This draft must be reviewed by a Turkish lawyer before publication.";
}
