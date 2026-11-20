import { ModelAlias } from "./types";

/**
 * Nordvow Creative AI - Pricing & Cost Ledger Engine
 *
 * Rules:
 * - 1 Nordvow Credit = $0.01 USD
 * - Loaded Cost:
 *     Image & Audio = Official Cost × 1.15 (buffer for moderation, CDN, retries, payment fees)
 *     Video & Avatar = Official Cost × 1.30
 * - Retail Multiplier: 2.5x - 4.0x (Target Gross Margin: 55% - 70%)
 * - Agency Wholesale Margin: 40% - 55%
 */

export const CREDIT_VALUE_USD = 0.01;

export interface CostCalculationInput {
  alias: ModelAlias;
  officialCostUsd: number;
  isMediaVideoOrAvatar: boolean;
  units?: number; // e.g. seconds for video, chars for TTS, images for image
  agencyMultiplierOverride?: number; // Organization-specific margin
}

export interface CostCalculationResult {
  officialCostUsd: number;
  loadedMultiplier: number;
  loadedCostUsd: number;
  retailMultiplier: number;
  retailPriceUsd: number;
  requiredCredits: number;
  grossMarginPercentage: number;
}

export function calculateMediaCost(input: CostCalculationInput): CostCalculationResult {
  const units = input.units && input.units > 0 ? input.units : 1;
  const officialCostUsd = Number((input.officialCostUsd * units).toFixed(6));

  // Video and avatar have higher bandwidth, failed frame retry and transcoding overhead (1.30x)
  const loadedMultiplier = input.isMediaVideoOrAvatar ? 1.30 : 1.15;
  const loadedCostUsd = Number((officialCostUsd * loadedMultiplier).toFixed(6));

  // Determine retail multiplier (default: ~3.0x, Agency override if provided)
  const retailMultiplier = input.agencyMultiplierOverride ?? 3.0;
  const retailPriceUsd = Number((loadedCostUsd * retailMultiplier).toFixed(4));

  // 1 Credit = $0.01 USD -> Credits = retailPriceUsd / 0.01
  // Minimum credit charge is 0.5 credit
  const calculatedCredits = Math.max(0.5, Math.ceil((retailPriceUsd / CREDIT_VALUE_USD) * 10) / 10);

  // Gross margin = ((Retail Price - Official Cost) / Retail Price) * 100
  const grossMarginPercentage = retailPriceUsd > 0
    ? Number((((retailPriceUsd - officialCostUsd) / retailPriceUsd) * 100).toFixed(2))
    : 0;

  return {
    officialCostUsd,
    loadedMultiplier,
    loadedCostUsd,
    retailMultiplier,
    retailPriceUsd,
    requiredCredits: calculatedCredits,
    grossMarginPercentage,
  };
}

