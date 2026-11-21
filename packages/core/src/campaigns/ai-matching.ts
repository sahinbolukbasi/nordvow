import type { Platform } from "../enums";

/**
 * Yapılandırılabilir AI influencer eşleştirme ağırlıkları (toplam = 100).
 * Tüm skorlar yalnızca veritabanındaki doğrulanmış veya yapılandırılmış veriden deterministik hesaplanır.
 * Kazıma (scraping) YAPILMAZ.
 */
export const MATCHING_WEIGHTS_CONFIG = {
  category: 30,
  audience: 20,
  platform: 15,
  verifiedEr: 15,
  budgetFit: 10,
  compliance23a: 10,
} as const;

export interface MatchCampaignInput {
  brandId: string;
  targetCountries: string[];
  platforms: Platform[];
  audienceInterests: string[];
  audienceGender?: string | null;
  audienceAgeMin?: number | null;
  audienceAgeMax?: number | null;
  budgetKurus: number;
  currency: string;
}

export interface MatchCandidateInput {
  id: string;
  name: string;
  handle: string | null;
  category: string;
  categories?: string[];
  country: string;
  city: string | null;
  avatarUrl: string | null;
  platforms: Platform[];
  followers: number;
  er: number | null;
  /** Yalnızca creator'ın kendi bağladığı resmi API hesabı varsa true. */
  hasVerifiedApiAccount: boolean;
  /** Bağlı hesaptan gelen demografi (ör. { kadin: 0.62, age18_34: 0.71 }). */
  demographics?: Record<string, unknown> | null;
  /** Ortalama rate card teklif tahmini (kuruş); yoksa null. */
  estimatedFeeKurus: number | null;
  /** Nordvow içi geçmiş 23/A uyum oranı (0..1); geçmiş yoksa null. */
  compliance23aRate?: number | null;
  /** Nordvow içi geçmiş 23/A ihlal sayısı. */
  past23aViolations?: number;
  /** Nordvow içi rakip marka iş birliği uyarısı. */
  competitorConflictBrand?: string | null;
  /** Aynı kategoride son 90 günde platform içi teslim sayısı. */
  recentCategoryPosts?: number;
}

export interface MatchedInfluencerResult {
  id: string;
  name: string;
  handle: string | null;
  category: string;
  city: string | null;
  avatarUrl: string | null;
  platforms: Platform[];
  followers: number;
  er: number | null;
  hasVerifiedApiAccount: boolean;
  matchScore: number;
  /** Bağlı hesap yoksa null ("Hesap bağlanmadı · doğrulanmamış veri"). */
  audienceQualityScore: number | null;
  /** En fazla 3 yapılandırılmış veri gerekçesi (uydurma rakam yok). */
  reasons: string[];
  brandSafetyWarnings: string[];
  estimatedFeeRangeKurus: { min: number; max: number; isEstimate: true };
  estimatedReachRange: { min: number; max: number; isEstimate: true; methodology: string };
  overBudget: boolean;
  breakdown: Record<keyof typeof MATCHING_WEIGHTS_CONFIG, number>;
}

function norm(s: string): string {
  return s.toLocaleLowerCase("tr").trim();
}

/**
 * Gerekçe cümlelerinin veritabanı/kaynak dışından sayı uydurmadığını doğrulayan şema koruyucusu.
 * Mock veya LLM gerekçeleri bu doğrulayıcıdan geçirilmeden arayüze gönderilmez.
 */
export function validateMatchReasons(reasons: string[], allowedNumbers: number[]): { valid: boolean; rejected: string[] } {
  const allowedSet = new Set(
    allowedNumbers
      .filter((n) => Number.isFinite(n))
      .flatMap((n) => [
        String(Math.round(n)),
        n.toFixed(1),
        n.toFixed(1).replace(".", ","),
        String(Math.round(n * 100)),
        (n * 100).toFixed(1),
        (n * 100).toFixed(1).replace(".", ","),
      ]),
  );

  const rejected: string[] = [];
  for (const r of reasons) {
    const nums = r.match(/\d+(?:[.,]\d+)?/g) ?? [];
    for (const token of nums) {
      // Sabit kural sayıları (90 gün, 23/A, yaş aralıkları) izinli sabitler:
      if (["90", "23", "18", "24", "25", "34", "35", "44", "45", "65"].includes(token)) continue;
      if (!allowedSet.has(token)) {
        rejected.push(`${token} (${r})`);
      }
    }
  }
  return { valid: rejected.length === 0, rejected };
}

export function estimateFeeRangeForCandidate(candidate: MatchCandidateInput, currency: string): { min: number; max: number; isEstimate: true } {
  if (candidate.estimatedFeeKurus && candidate.estimatedFeeKurus > 0) {
    return {
      min: Math.round(candidate.estimatedFeeKurus * 0.9),
      max: Math.round(candidate.estimatedFeeKurus * 1.15),
      isEstimate: true,
    };
  }
  // Rate card yoksa takipçi bandından muhafazakâr aralık tahmini (kuruş)
  const f = Math.max(0, candidate.followers);
  const multiplier = currency === "TRY" ? 1 : 0.03;
  if (f >= 250_000) return { min: Math.round(1_200_000 * multiplier), max: Math.round(2_000_000 * multiplier), isEstimate: true };
  if (f >= 100_000) return { min: Math.round(650_000 * multiplier), max: Math.round(1_100_000 * multiplier), isEstimate: true };
  if (f >= 30_000) return { min: Math.round(350_000 * multiplier), max: Math.round(600_000 * multiplier), isEstimate: true };
  return { min: Math.round(200_000 * multiplier), max: Math.round(400_000 * multiplier), isEstimate: true };
}

export function estimateReachRangeForCandidate(candidate: MatchCandidateInput): {
  min: number;
  max: number;
  isEstimate: true;
  methodology: string;
} {
  if (candidate.followers <= 0) {
    return {
      min: 0,
      max: 0,
      isEstimate: true,
      methodology: "Takipçi verisi bağlı hesapla doğrulandığında geçmiş ortalama erişim oranlarından hesaplanır.",
    };
  }
  // Sektör ortalama organik erişim bandı: takipçinin %18–%35'i (ER yüksekse yukarı ayarlanır)
  const erBoost = candidate.er && candidate.er > 0.03 ? 1.25 : 1;
  const min = Math.round(candidate.followers * 0.18 * erBoost);
  const max = Math.round(candidate.followers * 0.35 * erBoost);
  return {
    min,
    max,
    isEstimate: true,
    methodology: "Tahmin: bağlı hesap takipçi sayısı ve geçmiş kategori erişim oranlarından (%18–%35) hesaplanmıştır.",
  };
}

export function scoreInfluencerForCampaign(
  campaign: MatchCampaignInput,
  candidate: MatchCandidateInput,
): MatchedInfluencerResult {
  const W = MATCHING_WEIGHTS_CONFIG;
  const interests = new Set(campaign.audienceInterests.map(norm).filter(Boolean));
  const candCats = [candidate.category, ...(candidate.categories ?? [])].map(norm).filter(Boolean);
  const targetCountries = new Set(campaign.targetCountries.map((c) => c.toUpperCase()));
  const targetPlatforms = new Set(campaign.platforms);

  const reasons: string[] = [];
  const brandSafetyWarnings: string[] = [];

  // 1) Kategori uyumu (0..30)
  let catScore = 0;
  const matchedCat = candCats.find((c) => interests.has(c));
  if (matchedCat) {
    catScore = W.category;
    reasons.push(`Kategori doğrudan eşleşiyor (${candidate.category})`);
  } else if (interests.size === 0) {
    catScore = Math.round(W.category * 0.5);
  } else {
    catScore = Math.round(W.category * 0.15);
  }

  // 2) Kitle & ülke uyumu (0..20) — demografi YALNIZCA bağlı API hesabından okunur!
  let audienceScore = 0;
  let audienceQualityScore: number | null = null;
  if (targetCountries.has(candidate.country.toUpperCase())) {
    audienceScore += Math.round(W.audience * 0.45);
  }
  if (candidate.hasVerifiedApiAccount) {
    const demo = candidate.demographics ?? {};
    let demoBonus = Math.round(W.audience * 0.35);
    if (campaign.audienceGender === "kadin" && typeof demo.kadin === "number" && demo.kadin > 0) {
      const pct = Math.round(demo.kadin * 100);
      if (pct >= 50) {
        demoBonus = Math.round(W.audience * 0.55);
        reasons.push(`Kitlesinin %${pct}'i kadın (bağlı hesap verisi)`);
      }
    } else if (campaign.audienceGender === "erkek" && typeof demo.erkek === "number" && demo.erkek > 0) {
      const pct = Math.round(demo.erkek * 100);
      if (pct >= 50) {
        demoBonus = Math.round(W.audience * 0.55);
        reasons.push(`Kitlesinin %${pct}'i erkek (bağlı hesap verisi)`);
      }
    } else {
      reasons.push("Bağlı resmi hesap verisi doğrulandı");
    }
    audienceScore = Math.min(W.audience, audienceScore + demoBonus);
    const erComponent = candidate.er && candidate.er > 0 ? Math.min(40, Math.round(candidate.er * 900)) : 15;
    audienceQualityScore = Math.min(100, 45 + erComponent);
  }

  // 3) Platform uyumu (0..15)
  const matchingPlatforms = candidate.platforms.filter((p) => targetPlatforms.has(p));
  const platformScore =
    targetPlatforms.size === 0
      ? Math.round(W.platform * 0.6)
      : Math.round((matchingPlatforms.length / targetPlatforms.size) * W.platform);

  // 4) Doğrulanmış ER (0..15)
  let erScore = 0;
  if (candidate.er != null && candidate.er > 0) {
    const ratio = Math.min(1, candidate.er / 0.045);
    erScore = Math.round(ratio * W.verifiedEr * (candidate.hasVerifiedApiAccount ? 1 : 0.65));
    if (candidate.er >= 0.025) {
      reasons.push(`Yüksek etkileşim oranı (ER %${(candidate.er * 100).toFixed(1).replace(".", ",")})`);
    }
  }

  // 5) Bütçe uyumu (0..10)
  const feeRange = estimateFeeRangeForCandidate(candidate, campaign.currency);
  const overBudget = campaign.budgetKurus > 0 && feeRange.min > campaign.budgetKurus;
  let budgetScore = Math.round(W.budgetFit * 0.6);
  if (campaign.budgetKurus > 0) {
    if (!overBudget && feeRange.max <= campaign.budgetKurus) {
      budgetScore = W.budgetFit;
      reasons.push("Tahmini teklif ücreti bütçeye uyuyor");
    } else if (!overBudget) {
      budgetScore = Math.round(W.budgetFit * 0.7);
    } else {
      budgetScore = 0;
    }
  }

  // 6) Geçmiş md. 23/A uyumu (0..10)
  let complianceScore = Math.round(W.compliance23a * 0.6);
  if (candidate.compliance23aRate != null) {
    complianceScore = Math.round(candidate.compliance23aRate * W.compliance23a);
  }
  if ((candidate.past23aViolations ?? 0) > 0) {
    complianceScore = Math.max(0, complianceScore - 5);
    brandSafetyWarnings.push(`Geçmişte ${candidate.past23aViolations} adet md. 23/A reklam ibaresi uyarısı`);
  }
  if (candidate.competitorConflictBrand) {
    brandSafetyWarnings.push(`Son dönemde rakip marka iş birliği (${candidate.competitorConflictBrand})`);
  }

  const totalScore = Math.max(0, Math.min(100, catScore + audienceScore + platformScore + erScore + budgetScore + complianceScore));
  const finalReasons = reasons.slice(0, 3);

  return {
    id: candidate.id,
    name: candidate.name,
    handle: candidate.handle ? candidate.handle.replace(/^@+/, "") : null,
    category: candidate.category,
    city: candidate.city,
    avatarUrl: candidate.avatarUrl,
    platforms: candidate.platforms,
    followers: candidate.followers,
    er: candidate.er != null && candidate.er > 0 ? candidate.er : null,
    hasVerifiedApiAccount: candidate.hasVerifiedApiAccount,
    matchScore: totalScore,
    audienceQualityScore,
    reasons: finalReasons,
    brandSafetyWarnings,
    estimatedFeeRangeKurus: feeRange,
    estimatedReachRange: estimateReachRangeForCandidate(candidate),
    overBudget,
    breakdown: {
      category: catScore,
      audience: audienceScore,
      platform: platformScore,
      verifiedEr: erScore,
      budgetFit: budgetScore,
      compliance23a: complianceScore,
    },
  };
}

/**
 * Varsayılan sıralama: uyum puanı azalan; eşitlikte doğrulanmış (bağlı API) hesap önce; sonra ad.
 */
export function rankInfluencersForCampaign(
  campaign: MatchCampaignInput,
  candidates: MatchCandidateInput[],
): MatchedInfluencerResult[] {
  return candidates
    .map((c) => scoreInfluencerForCampaign(campaign, c))
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      if (b.hasVerifiedApiAccount !== a.hasVerifiedApiAccount) {
        return Number(b.hasVerifiedApiAccount) - Number(a.hasVerifiedApiAccount);
      }
      return a.name.localeCompare(b.name, "tr");
    });
}

