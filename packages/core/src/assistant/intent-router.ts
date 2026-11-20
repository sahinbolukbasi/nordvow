/**
 * Metin ve Sesli AI Asistan ortak niyet yönlendiricisi (Intent Router).
 * Türkçeye özgü büyük-küçük İ/ı dönüşümü, yazım hataları ("kargom nrde"), argo ve STT hatalarına dayanıklıdır.
 */

export type AssistantIntent =
  | "fiyat"
  | "kargo"
  | "basvuru"
  | "kampanya_durumu"
  | "iade"
  | "sikayet"
  | "diger";

export interface IntentClassification {
  intent: AssistantIntent;
  confidence: number;
  reason: string;
  /** Şikâyet veya özel fiyat gibi durumlarda doğrudan insana aktarma işareti. */
  alwaysHandoff: boolean;
  /** Kargo niyetinde sipariş/takip numarası eksikse sorulmalı. */
  needsOrderNumber: boolean;
  /** Mesaj içinden yakalanan sipariş veya takip kodu. */
  extractedOrderCode: string | null;
  /** Kampanya/ödeme durumunda kimlik doğrulaması gerekliliği. */
  needsIdentityVerification: boolean;
  /** Kişiye özel fiyat / kurumsal teklif isteniyorsa temsilciye yönlendir. */
  needsCustomQuote: boolean;
}

const TR_FOLD: Record<string, string> = {
  İ: "i",
  I: "i",
  ı: "i",
  Ğ: "g",
  ğ: "g",
  Ü: "u",
  ü: "u",
  Ş: "s",
  ş: "s",
  Ö: "o",
  ö: "o",
  Ç: "c",
  ç: "c",
};

/** Türkçe karakterleri ve birleşik aksanları kararlı ASCII küçük harfe indirger. */
export function normalizeTurkishForIntent(raw: string): string {
  return raw
    .replace(/[İIıĞğÜüŞşÖöÇç]/g, (ch) => TR_FOLD[ch] ?? ch)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractOrderOrTrackingCode(raw: string): string | null {
  // Örn: SIP-123456, ORD12345, #987654, 1234567890
  const prefixed = /\b(?:sip|ord|krg|trk|takip|siparis)[-\s#:]*([a-z0-9]{5,18})\b/i.exec(raw);
  if (prefixed?.[1]) return prefixed[1].toUpperCase();
  const hashNum = /#(\d{5,14})\b/.exec(raw);
  if (hashNum?.[1]) return hashNum[1];
  const longDigits = /\b(\d{8,16})\b/.exec(raw);
  if (longDigits?.[1]) return longDigits[1];
  return null;
}

const COMPLAINT_PATTERNS = [
  /\brezalet\b/,
  /\bberbat\b/,
  /\bsikayet/,
  /\bdolandir/,
  /\bsahtekar/,
  /\bbozuk\s+gel/,
  /\bkirik\s+gel/,
  /\bhasarli\s+gel/,
  /\bmagdur/,
  /\btuketici\s+hakem/,
  /\bavukat\b/,
  /\bsavcilik\b/,
  /\bcimer\b/,
  /\bkepazelik\b/,
  /\bhic\s+memnun\s+degil/,
  /\bbiktim\b/,
  /\bsacmalik\b/,
  /\bterbiyesiz/,
  /\byaziklar\s+olsun/,
  /\bcalismiyor\b.*\bsinir/,
  /\burun\s+bozuk\b/,
  /\bparami\s+geri\s+ver/,
];

const APPLICATION_PATTERNS = [
  /\binfluencer\b.*\bbasvur/,
  /\binfluencer\s+olarak\b/,
  /\binfulancer\b.*\bbasvur/,
  /\bcreator\b.*\bbasvur/,
  /\bicerik\s+ureticisi\b.*\bbasvur/,
  /\bnasil\s+basvur/,
  /\bbasvuru\s+nasil/,
  /\bis\s*birligi\s+yapmak\s+ist/,
  /\bkayit\s+olmak\s+ist.*\binfluencer/,
  /\binfluencer\s+kayit/,
  /\bcreator\s+kayit/,
  /\bpr\s+paketi\b/,
  /\bmarka\s+is\s*birligi\s+basvur/,
];

const CAMPAIGN_STATUS_PATTERNS = [
  /\bbasvurum\s+ne\s+durumda/,
  /\bteklifim\w*\s+ne\s+zaman/,
  /\bteklif\s+durum/,
  /\bodeme\s+ne\s+zaman/,
  /\bodemem\s+ne\s+zaman/,
  /\bhakedis/,
  /\bhesabima\s+ne\s+zaman\s+yatar/,
  /\bkampanya\s+durum/,
  /\btaslak\s+onay/,
  /\bicerigim\s+onaylandi\s+mi/,
  /\b20\s*\/?\s*b\b/,
  /\bistisna\s+belgesi\b/,
  /\bstopaj\b/,
  /\bfatura\s+kes/,
];

const RETURN_PATTERNS = [
  /\biade\b/,
  /\bdegisim\b/,
  /\bgeri\s+gonder/,
  /\biptal\s+etmek\s+ist/,
  /\bcayma\s+hakki/,
  /\bucret\s+iadesi/,
  /\bpara\s+iadesi/,
];

const SHIPPING_PATTERNS = [
  /\bkargo\w*\b/,
  /\bkargm\b/,
  /\bkrgo\b/,
  /\bsiparis\w*\s+(nerede|nrde|durum|takip|gelmedi|ulasmadi|ne\s+zaman)/,
  /\btakip\s+no\b/,
  /\btakip\s+numara/,
  /\bteslimat\s+(durum|ne\s+zaman|nerede|nrde|gecik)/,
  /\bpaketim\s+(nerede|nrde|gelmedi)/,
  /\bnrde\b.*\bgelmedi/,
  /\bgelmedi\b.*\bgun/,
];

const PRICE_PATTERNS = [
  /\bfiyat\w*\b/,
  /\bucret\w*\b/,
  /\bpaket\w*\s+(ne\s+kadar|kac|fiyat|ucret)/,
  /\bne\s+kadar\b/,
  /\bne\s+kdr\b/,
  /\bkac\s+(tl|lira|para|dolar|euro)\b/,
  /\btarife\b/,
  /\bbutce\s+(ne\s+kadar|araligi|minimum)/,
  /\bkomisyon\s+oran/,
  /\babonelik\s+ucret/,
  /\bkampanya\s+fiyat/,
  /\bozel\s+teklif\b/,
];

const CUSTOM_QUOTE_PATTERNS = [
  /\bozel\s+(fiyat|teklif|indirim|paket)/,
  /\bkurumsal\s+(fiyat|teklif|anlasma)/,
  /\btoplu\s+(alim|fiyat|kampanya)/,
  /\bbize\s+ozel\b/,
];

export const INTENT_LABELS: Record<AssistantIntent, string> = {
  fiyat: "Fiyat ve paket bilgisi",
  kargo: "Kargo ve teslimat",
  basvuru: "Influencer başvurusu",
  kampanya_durumu: "Kampanya ve ödeme durumu",
  iade: "İade ve değişim",
  sikayet: "Şikâyet (temsilci aktarımı)",
  diger: "Genel soru",
};

/**
 * Gelen Türkçe mesajı (metin veya sesli STT çıktısı) 7 standart niyetten birine sınıflandırır.
 * Deterministik, sıfır gecikmeli ve test edilebilir.
 */
export function classifyAssistantIntent(rawText: string): IntentClassification {
  const norm = normalizeTurkishForIntent(rawText);
  const extractedOrderCode = extractOrderOrTrackingCode(rawText);
  const needsCustomQuote = CUSTOM_QUOTE_PATTERNS.some((re) => re.test(norm));

  // 1) Şikâyet her zaman en yüksek önceliktedir -> anında insana aktar.
  if (COMPLAINT_PATTERNS.some((re) => re.test(norm))) {
    return {
      intent: "sikayet",
      confidence: 0.96,
      reason: "Olumsuz deneyim / şikâyet ifadesi tespit edildi",
      alwaysHandoff: true,
      needsOrderNumber: false,
      extractedOrderCode,
      needsIdentityVerification: false,
      needsCustomQuote: false,
    };
  }

  // 2) Influencer / creator başvuru soruları
  if (APPLICATION_PATTERNS.some((re) => re.test(norm))) {
    return {
      intent: "basvuru",
      confidence: 0.94,
      reason: "Influencer / içerik üreticisi başvuru niyeti",
      alwaysHandoff: false,
      needsOrderNumber: false,
      extractedOrderCode: null,
      needsIdentityVerification: false,
      needsCustomQuote: false,
    };
  }

  // 3) Kampanya / teklif / ödeme / 20-B durumu
  if (CAMPAIGN_STATUS_PATTERNS.some((re) => re.test(norm))) {
    return {
      intent: "kampanya_durumu",
      confidence: 0.92,
      reason: "Kampanya, teklif veya ödeme durumu sorgusu",
      alwaysHandoff: false,
      needsOrderNumber: false,
      extractedOrderCode: null,
      needsIdentityVerification: true,
      needsCustomQuote: false,
    };
  }

  // 4) İade / değişim / iptal
  if (RETURN_PATTERNS.some((re) => re.test(norm))) {
    return {
      intent: "iade",
      confidence: 0.93,
      reason: "İade veya değişim politikası sorusu",
      alwaysHandoff: false,
      needsOrderNumber: false,
      extractedOrderCode,
      needsIdentityVerification: false,
      needsCustomQuote: false,
    };
  }

  // 5) Kargo / sipariş takibi (yazım hataları dâhil: "kargom nrde")
  if (SHIPPING_PATTERNS.some((re) => re.test(norm))) {
    return {
      intent: "kargo",
      confidence: 0.93,
      reason: "Kargo veya teslimat durumu sorusu",
      alwaysHandoff: false,
      needsOrderNumber: !extractedOrderCode,
      extractedOrderCode,
      needsIdentityVerification: false,
      needsCustomQuote: false,
    };
  }

  // 6) Fiyat / paket / ücret
  if (PRICE_PATTERNS.some((re) => re.test(norm))) {
    return {
      intent: "fiyat",
      confidence: 0.92,
      reason: needsCustomQuote ? "Kişiye özel fiyat talebi" : "Fiyat ve paket sorusu",
      alwaysHandoff: needsCustomQuote,
      needsOrderNumber: false,
      extractedOrderCode: null,
      needsIdentityVerification: false,
      needsCustomQuote,
    };
  }

  return {
    intent: "diger",
    confidence: 0.65,
    reason: "Genel bilgi tabanı sorgusu",
    alwaysHandoff: false,
    needsOrderNumber: false,
    extractedOrderCode,
    needsIdentityVerification: false,
    needsCustomQuote: false,
  };
}

