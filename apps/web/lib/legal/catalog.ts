import type { LegalDocId } from "./types";

export const LEGAL_NAV: { id: LegalDocId; href: string; tr: string; en: string }[] = [
  { id: "terms", href: "/kullanim-sartlari", tr: "Kullanım Şartları", en: "Terms of use" },
  { id: "privacy", href: "/gizlilik", tr: "Gizlilik Politikası", en: "Privacy" },
  { id: "kvkk", href: "/kvkk-aydinlatma", tr: "KVKK Aydınlatma", en: "KVKK notice" },
  { id: "consent", href: "/acik-riza", tr: "Açık Rıza", en: "Explicit consent" },
  { id: "cookies", href: "/cerez-politikasi", tr: "Çerez Politikası", en: "Cookies" },
  { id: "deletion", href: "/veri-silme", tr: "Veri silme", en: "Data deletion" },
  { id: "influencer", href: "/influencer-sozlesmesi", tr: "Influencer sözleşmesi", en: "Influencer terms" },
  { id: "brand", href: "/marka-sozlesmesi", tr: "Marka sözleşmesi", en: "Brand terms" },
  { id: "distance", href: "/mesafeli-satis", tr: "Mesafeli satış", en: "Distance sales" },
  { id: "refund", href: "/iade-iptal", tr: "İade ve iptal", en: "Returns" },
  { id: "iys", href: "/ileti-izni", tr: "İleti izni", en: "Message consent" },
];
