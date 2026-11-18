export type Compliance23AStatus = "UYUMLU" | "EKSIK" | "SUPHELI" | "BEKLIYOR";

export type Compliance23AResult = {
  status: Compliance23AStatus;
  detectedLabel: string | null;
  reason: string;
};

const DISCLOSURE_RE = /(?:^|[\s#(])(reklam|tanıtım|tanitim|ücretli\s+ortaklık|ucretli\s+ortaklik)/i;
const ONLY_COLLAB_RE = /(?:^|[\s#])(işbirliği|isbirligi|hediye|ortaklık|ortaklik)\b/i;

/**
 * 2026 Yönetmelik md. 23/A uyum kontrolü:
 * - "Reklam" veya "Tanıtım" ibaresi marka adıyla birlikte ve diğer etiketlerden önce yer almalıdır.
 * - Yalnız "#işbirliği" veya benzeri muğlak ifadeler yetersiz kabul edilir.
 */
export function evaluate23ACompliance(opts: {
  caption?: string | null;
  brandName?: string | null;
  isPublished?: boolean;
}): Compliance23AResult {
  const { caption, brandName, isPublished = true } = opts;

  if (!isPublished) {
    return {
      status: "BEKLIYOR",
      detectedLabel: null,
      reason: "İçerik henüz yayınlanmadı.",
    };
  }

  const text = (caption ?? "").trim();
  if (!text) {
    return {
      status: "EKSIK",
      detectedLabel: null,
      reason: "Açıklama metni bulunamadı; 'Reklam' veya 'Tanıtım' ibaresi doğrulanamadı.",
    };
  }

  const discMatch = DISCLOSURE_RE.exec(text);
  const hasBrand = brandName
    ? text.toLocaleLowerCase("tr-TR").includes(brandName.trim().toLocaleLowerCase("tr-TR"))
    : true;

  if (discMatch) {
    const label = discMatch[1] ?? discMatch[0].trim();
    const firstHashIdx = text.indexOf("#");
    const discIdx = discMatch.index;
    const isAfterOtherTags = firstHashIdx !== -1 && discIdx > firstHashIdx + 2;

    if (!hasBrand) {
      return {
        status: "SUPHELI",
        detectedLabel: label,
        reason: `'${label}' ibaresi var ancak marka adı metinde tespit edilemedi.`,
      };
    }
    if (isAfterOtherTags) {
      return {
        status: "SUPHELI",
        detectedLabel: label,
        reason: `'${label}' ibaresi diğer etiketlerden sonra yer alıyor; başta olmalıdır.`,
      };
    }
    return {
      status: "UYUMLU",
      detectedLabel: label,
      reason: `'${label}' ibaresi ve marka adı md. 23/A ile uyumlu konumda.`,
    };
  }

  if (ONLY_COLLAB_RE.test(text)) {
    return {
      status: "SUPHELI",
      detectedLabel: "#işbirliği",
      reason: "Yalnız '#işbirliği' yetersizdir; 'Reklam' veya 'Tanıtım' ibaresi gerekir.",
    };
  }

  return {
    status: "EKSIK",
    detectedLabel: null,
    reason: "Zorunlu 'Reklam' veya 'Tanıtım' ibaresi tespit edilemedi.",
  };
}

