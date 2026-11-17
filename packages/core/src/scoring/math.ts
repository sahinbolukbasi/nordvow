import {
  FOLLOWER_BANDS,
  GRADE_THRESHOLDS,
  MISSING_SIGNAL_MAX_WEIGHT_RATIO,
  WINDOW_LIMITS,
  type FollowerBandKey,
} from "./scoring.config";
import type { ScoreGrade } from "./types";

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function median(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const mid = Math.floor(clean.length / 2);
  if (clean.length % 2 === 1) return clean[mid]!;
  return (clean[mid - 1]! + clean[mid]!) / 2;
}

export function mean(values: number[]): number | null {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return null;
  return clean.reduce((s, v) => s + v, 0) / clean.length;
}

export function stdDev(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Değişkenlik katsayısı (CV = stdDev / mean). */
export function coefficientOfVariation(values: number[]): number | null {
  const m = mean(values);
  const sd = stdDev(values);
  if (m === null || sd === null || m <= 0) return null;
  return sd / m;
}

/** Değerin kıyas grubundaki yüzdelik dilimi (0–100). */
export function percentileRank(value: number, peerValues: number[]): number {
  if (!Number.isFinite(value)) return 50;
  const clean = peerValues.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const p of clean) {
    if (p < value) below++;
    else if (p === value) equal++;
  }
  return Math.round(clamp(((below + 0.5 * equal) / clean.length) * 100, 1, 99));
}

/**
 * Aykırı değer kuralı: değeri medyan × 5'ten büyük olan gönderiler "Viral"
 * işaretlenir ve ana medyan hesabına girmez.
 */
export function detectViralOutliers<T>(
  items: T[],
  getMetric: (item: T) => number | null,
): { normal: T[]; viral: T[]; medianValue: number | null } {
  const values = items.map(getMetric).filter((v): v is number => v !== null && Number.isFinite(v) && v >= 0);
  const med = median(values);
  if (med === null || med <= 0 || items.length < 4) {
    return { normal: items, viral: [], medianValue: med };
  }
  const threshold = med * WINDOW_LIMITS.viralMultiplier;
  const normal: T[] = [];
  const viral: T[] = [];
  for (const item of items) {
    const v = getMetric(item);
    if (v !== null && v > threshold) {
      viral.push(item);
    } else {
      normal.push(item);
    }
  }
  return { normal, viral, medianValue: med };
}

export function resolveFollowerBand(followers: number): { key: FollowerBandKey; label: string } {
  for (const band of FOLLOWER_BANDS) {
    if (band.max === null || followers < band.max) {
      return { key: band.key, label: band.label };
    }
  }
  return { key: "NANO", label: FOLLOWER_BANDS[0]!.label };
}

/**
 * Eksik sinyalin ağırlığını mevcut sinyallere oransal dağıtır.
 * Toplam ağırlığın %50'sinden fazlası eksikse skor null döner.
 */
export function weightedScoreWithRedistribution(
  signals: { value: number | null; weight: number }[],
): { score: number | null; missingWeightRatio: number } {
  const totalWeight = signals.reduce((s, x) => s + x.weight, 0);
  if (totalWeight <= 0) return { score: null, missingWeightRatio: 1 };

  let presentWeight = 0;
  let weightedSum = 0;
  for (const sig of signals) {
    if (sig.value !== null && Number.isFinite(sig.value)) {
      presentWeight += sig.weight;
      weightedSum += clamp(sig.value, 0, 100) * sig.weight;
    }
  }

  const missingWeightRatio = (totalWeight - presentWeight) / totalWeight;
  if (presentWeight <= 0 || missingWeightRatio > MISSING_SIGNAL_MAX_WEIGHT_RATIO) {
    return { score: null, missingWeightRatio };
  }

  return {
    score: Math.round(clamp(weightedSum / presentWeight, 0, 100)),
    missingWeightRatio,
  };
}

export function gradeForScore(score: number): { grade: ScoreGrade; label: string } {
  for (const row of GRADE_THRESHOLDS) {
    if (score >= row.min) return { grade: row.grade, label: row.label };
  }
  return { grade: "D", label: GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1]!.label };
}
