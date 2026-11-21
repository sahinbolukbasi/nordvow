/**
 * İletişim Merkezi tek etiket sözlüğü ve değişken çipi dönüştürücüsü.
 * Markalara ham kod/İngilizce durum değeri ASLA gösterilmez.
 */

export const ILETISIM_ETIKETLERI: Record<string, string> = {
  // Konuşma durumları
  open: "Açık",
  awaiting_human: "Temsilci bekliyor",
  assigned: "Atandı",
  resolved: "Çözüldü",
  closed: "Çözüldü",

  // Kanal / bağlantı durumları
  ACTIVE: "Bağlı",
  CONNECTED: "Bağlı",
  REVOKED: "Bağlantı koptu",
  REAUTH_REQUIRED: "Bağlantı koptu",
  WEBHOOK_MISSING: "Bağlantı eksik",
  PENDING: "Beklemede",
  DISCONNECTED: "Bağlı değil",
  ERROR: "Hata",

  // DM Otomasyonu politikaları & tetikleyiciler
  NEVER: "Aynı kişiye yalnız 1 kez",
  DAILY: "Aynı kişiye günde en fazla 1 kez",
  ALWAYS: "Her yorumda yanıtla",
  ONCE_PER_USER: "Kişi başına 1 kez",
  ONCE_PER_POST: "Gönderi başına 1 kez",
  UNLIMITED: "Sınırsız",
  SPECIFIC_POST: "Belirli gönderi",
  ALL_POSTS: "Tüm gönderiler",
  NEXT_POST: "Sonraki gönderi",
  STORY_REPLY: "Hikâye yanıtı",

  // DM Otomasyonu durumları
  DRAFT: "Taslak",
  PAUSED: "Duraklatıldı",
  ENDED: "Bitti",
  COMPLETED: "Bitti",

  // WhatsApp limit & şablon türleri
  TIER_250: "Günde 250 yeni kişiye kadar",
  TIER_1K: "Günde 1.000 yeni kişiye kadar",
  TIER_10K: "Günde 10.000 yeni kişiye kadar",
  TIER_100K: "Günde 100.000 yeni kişiye kadar",
  TIER_UNLIMITED: "Sınırsız",
  UTILITY: "Bilgilendirme",
  MARKETING: "Pazarlama",
  AUTHENTICATION: "Doğrulama",

  // Asistan şablonları
  brand_faq: "Marka müşteri asistanı (SSS)",
  influencer_assistant: "Influencer kampanya asistanı",
  creator_prescreen: "Creator ön değerlendirme asistanı",
  campaign_welcome: "Kampanya karşılama asistanı",
  order_status: "Sipariş ve kargo asistanı",
  booking: "Randevu asistanı",
  deliverable_reminder: "Teslimat hatırlatma asistanı",

  // Niyetler (metin + sesli asistan)
  fiyat: "Fiyat ve paket bilgisi",
  kargo: "Kargo ve teslimat",
  basvuru: "Influencer başvurusu",
  kampanya_durumu: "Kampanya ve ödeme durumu",
  iade: "İade ve değişim",
  sikayet: "Şikâyet (temsilci aktarımı)",
  diger: "Genel soru",
  info_question: "Bilgi talebi",
  transfer: "Temsilciye aktarma",
  callback: "Geri arama talebi",
  goodbye: "Görüşme sonu",

  // Aktarma nedenleri
  kaynak_yok: "Bilgi tabanında kaynak yok",
  dusuk_guven: "Güven eşiği altında",
  kisisel_veri: "Kişisel veri / güvenlik",
  tur_siniri: "Maksimum tur sınırı aşıldı",
  tool_hatasi: "Sistem sorgusu yapılamadı",
  kullanici_talebi: "Kullanıcı temsilci istedi",
  mesai_disi: "Mesai saatleri dışı",

  // Ajan kontrol türleri
  STORY_HATIRLATMA: "Story hatırlatması",
  INFLUENCER_ONERI: "Influencer önerisi",
  BRIEF_UYUM: "Brief ve 23/A uyumu",
  SAHTE_ETKILESIM: "Sahte etkileşim analizi",
  LINK_KONTROL: "Yayın linki kontrolü",
  SILME_KONTROL: "İçerik silinme kontrolü",
  YAYIN_KONTROL: "Yayın durumu kontrolü",
  METRIK_TUTARLILIK: "Metrik tutarlılığı",
  KAMPANYA_OZET: "Kampanya özeti",
  HEDEF_PROJEKSIYON: "Hedef projeksiyonu",
  ICERIK_TAKIP: "İçerik takibi",

  // Sistem / Admin kaynakları
  POLLING: "Periyodik kontrol",
  WEBHOOK: "Anlık",
  CTR: "Tıklama oranı",
  Templates: "Şablonlar",
  Worker: "İşleyici",
};

/**
 * Ham kodu Türkçe kullanıcı etiketine çevirir.
 * Sözlükte yoksa ham kodu ASLA göstermez; "Bilinmeyen durum" döner ve konsola uyarı yazar.
 */
export function etiketle(kod: string | null | undefined, fallback = "Bilinmeyen durum"): string {
  if (!kod) return fallback;
  const trimmed = kod.trim();
  if (trimmed in ILETISIM_ETIKETLERI) {
    return ILETISIM_ETIKETLERI[trimmed]!;
  }
  const lower = trimmed.toLowerCase();
  if (lower in ILETISIM_ETIKETLERI) {
    return ILETISIM_ETIKETLERI[lower]!;
  }
  const upper = trimmed.toUpperCase();
  if (upper in ILETISIM_ETIKETLERI) {
    return ILETISIM_ETIKETLERI[upper]!;
  }
  if (typeof console !== "undefined") {
    console.warn(`[iletisim/etiketler] Bilinmeyen kod: "${trimmed}"`);
  }
  return fallback;
}

/**
 * Birleşik değişken çipi tanımları.
 * UI'da tek tip çip ([Kişi adı], [Kupon], [Link], [Temsilci adı], [Marka adı]) gösterilir;
 * backend'in beklediği format ({username} / {{kisi.ad}} / {{1}}) bozulmadan dönüştürülür.
 */
export type DegiskenTuru = "dm_otomasyon" | "kisayol" | "sablon";

export type DegiskenCipi = {
  id: "kisi_adi" | "kupon" | "link" | "temsilci_adi" | "marka_adi";
  label: string;
  formats: Partial<Record<DegiskenTuru, string>>;
};

export const DEGISKEN_CIPLERI: DegiskenCipi[] = [
  {
    id: "kisi_adi",
    label: "Kişi adı",
    formats: { dm_otomasyon: "{username}", kisayol: "{{kisi.ad}}", sablon: "{{1}}" },
  },
  {
    id: "kupon",
    label: "Kupon",
    formats: { dm_otomasyon: "{kupon}", kisayol: "{{kupon}}", sablon: "{{2}}" },
  },
  {
    id: "link",
    label: "Link",
    formats: { dm_otomasyon: "{link}", kisayol: "{{link}}", sablon: "{{3}}" },
  },
  {
    id: "temsilci_adi",
    label: "Temsilci adı",
    formats: { kisayol: "{{temsilci.ad}}" },
  },
  {
    id: "marka_adi",
    label: "Marka adı",
    formats: { kisayol: "{{marka.ad}}" },
  },
];

/** Seçili alan türü için kullanılabilir değişken çiplerini döndürür. */
export function ciplerFor(tur: DegiskenTuru): { id: DegiskenCipi["id"]; label: string; token: string }[] {
  return DEGISKEN_CIPLERI.filter((c) => Boolean(c.formats[tur])).map((c) => ({
    id: c.id,
    label: c.label,
    token: c.formats[tur]!,
  }));
}

/** Backend formatındaki değişkenleri UI önizleme çip etiketine çevirir (`{username}` → `[Kişi adı]`). */
export function tokenlariEtiketeCevir(metin: string, tur: DegiskenTuru): string {
  let out = metin;
  for (const c of DEGISKEN_CIPLERI) {
    const token = c.formats[tur];
    if (token) {
      out = out.split(token).join(`[${c.label}]`);
    }
  }
  return out;
}

/** UI çip etiketlerini (`[Kişi adı]`) backend'in beklediği formata geri çevirir. */
export function etiketleriTokenaCevir(metin: string, tur: DegiskenTuru): string {
  let out = metin;
  for (const c of DEGISKEN_CIPLERI) {
    const token = c.formats[tur];
    if (token) {
      out = out.split(`[${c.label}]`).join(token);
    }
  }
  return out;
}

