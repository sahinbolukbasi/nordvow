/**
 * Asistan çıktı doğrulayıcısı:
 * 1) Geliştirici metni / iç terim sızıntısını engeller (örn. "link_account intent", "{{", ham enum).
 * 2) Bilgi tabanında veya doğrulanmış kaynakta bulunmayan fiyat, tarih ve kupon kodu üretimini yakalar.
 */

const INTERNAL_LEAK_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "link_account", re: /\blink_account\b/i },
  { label: "offer_respond", re: /\boffer_respond\b/i },
  { label: "create_image", re: /\bcreate_image\b/i },
  { label: "create_video", re: /\bcreate_video\b/i },
  { label: "intent_jargon", re: /\bintent(?:'ini|'i|'ler|\s+kullanarak|\s+ile)\b/i },
  { label: "template_braces", re: /\{\{[^}]*\}\}/ },
  { label: "raw_status_enum", re: /\b(?:awaiting_human|ICERIK_YUKLENDI|METRIK_BEKLIYOR|KARSI_TEKLIF|GERI_CEKILDI)\b/ },
  { label: "system_prompt_leak", re: /\b(?:systemPrompt|tool_hatasi|dusuk_guven|brand_faq|creator_prescreen)\b/ },
];

export interface OutputValidationResult {
  ok: boolean;
  leaks: string[];
  fabricatedValues: string[];
}

export function detectInternalLeaks(text: string): string[] {
  const leaks: string[] = [];
  for (const p of INTERNAL_LEAK_PATTERNS) {
    if (p.re.test(text)) leaks.push(p.label);
  }
  return leaks;
}

/**
 * Yanıttaki para tutarlarını, tarihleri ve kupon kodlarını çıkarır;
 * izin verilen kaynak metinlerde geçmeyen uydurma değerleri döndürür.
 */
export function findFabricatedFacts(replyText: string, allowedContext: string): string[] {
  const fabricated: string[] = [];
  const ctxNorm = allowedContext.toLocaleLowerCase("tr").replace(/\s+/g, " ");

  // 1) Para tutarları (ör. ₺15.000, 1.500 TL, $50, €200, 500 USD)
  const moneyRe = /(?:₺|\$|€)\s*\d[\d.,]*|\b\d[\d.,]*\s*(?:tl|try|usd|eur|dolar|euro|lira)\b/gi;
  for (const m of replyText.matchAll(moneyRe)) {
    const raw = m[0].trim();
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) continue;
    const rawLower = raw.toLocaleLowerCase("tr");
    const digitsInCtx = new RegExp(`(?<!\\d)${digits}(?!\\d)`).test(ctxNorm.replace(/[.,]/g, ""));
    if (!ctxNorm.includes(rawLower) && !digitsInCtx) {
      fabricated.push(`fiyat:${raw}`);
    }
  }

  // 2) Tarihler (ör. 15.12.2026, 2026-12-15, 15/12/2026)
  const dateRe = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g;
  for (const m of replyText.matchAll(dateRe)) {
    const raw = m[0].trim();
    if (!ctxNorm.includes(raw.toLocaleLowerCase("tr"))) {
      fabricated.push(`tarih:${raw}`);
    }
  }

  // 3) Büyük harfli kupon kodları (en az 1 harf ve 1 rakam içeren 5-16 karakterlik kodlar, ör. KIS20, NORDVOW15)
  const couponRe = /\b(?=[A-Z0-9]{5,16}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]+\b/g;
  for (const m of replyText.matchAll(couponRe)) {
    const code = m[0];
    // 23A veya 20B gibi yasal atıfları kupon sayma
    if (/^(?:20B|23A|KDV18|KDV20|TR90|TL100)$/i.test(code)) continue;
    if (!ctxNorm.includes(code.toLocaleLowerCase("tr"))) {
      fabricated.push(`kod:${code}`);
    }
  }

  return [...new Set(fabricated)];
}

/**
 * Asistan yanıtını sızıntı ve uydurma rakam açısından doğrular.
 */
export function validateAssistantOutput(replyText: string, allowedContext: string): OutputValidationResult {
  const leaks = detectInternalLeaks(replyText);
  const fabricatedValues = findFabricatedFacts(replyText, allowedContext);
  return {
    ok: leaks.length === 0 && fabricatedValues.length === 0,
    leaks,
    fabricatedValues,
  };
}

/** İç terim sızıntısı içeren metni temizler (son savunma hattı). */
export function stripInternalLeaks(text: string): string {
  if (detectInternalLeaks(text).length === 0) return text;
  return "Size en doğru bilgiyi verebilmek için sorunuzu ilgili ekibimize aktarıyorum.";
}

