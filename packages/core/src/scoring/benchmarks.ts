import type { Platform } from "../generated/prisma/enums";
import { prisma } from "../db";
import { BENCHMARK_MIN_ACCOUNTS, type FollowerBandKey } from "./scoring.config";
import { median, resolveFollowerBand } from "./math";
import type { PeerBenchmarkGroup } from "./types";

/**
 * Veritabanındaki gerçek SocialAccount popülasyonu küçükse kıyaslamalı yüzdelik
 * dilimlerin dejenere olmaması için sektörel başlangıç referans dağılımları.
 */
const BASELINE_DISTRIBUTIONS: Record<
  FollowerBandKey,
  {
    er: number[];
    vr: number[];
    erv: number[];
    saveShare: number[];
    weeklyFreq: number[];
    consistency: number[];
    growth30d: number[];
  }
> = {
  NANO: {
    er: [1.2, 2.1, 3.4, 4.8, 6.5, 8.9, 11.5],
    vr: [12, 22, 35, 48, 65, 90, 130],
    erv: [2.5, 4.0, 5.5, 7.2, 9.0, 12.0, 15.0],
    saveShare: [0.4, 0.8, 1.2, 1.8, 2.5, 3.4, 4.5],
    weeklyFreq: [1.0, 1.8, 2.5, 3.2, 4.0, 5.2, 7.0],
    consistency: [35, 48, 60, 70, 78, 86, 94],
    growth30d: [-1.0, 0.5, 1.8, 3.2, 5.5, 9.0, 16.0],
  },
  MIKRO: {
    er: [0.9, 1.6, 2.4, 3.5, 4.9, 6.8, 9.2],
    vr: [10, 18, 26, 38, 52, 74, 105],
    erv: [2.0, 3.2, 4.6, 6.1, 7.8, 10.2, 13.0],
    saveShare: [0.35, 0.7, 1.1, 1.6, 2.2, 3.0, 4.1],
    weeklyFreq: [1.2, 2.0, 2.8, 3.5, 4.5, 5.8, 7.2],
    consistency: [40, 52, 64, 73, 81, 88, 95],
    growth30d: [-0.8, 0.4, 1.5, 2.8, 4.8, 8.0, 14.0],
  },
  ORTA: {
    er: [0.7, 1.2, 1.9, 2.7, 3.8, 5.2, 7.4],
    vr: [8, 14, 22, 32, 44, 62, 88],
    erv: [1.8, 2.8, 4.0, 5.4, 7.0, 9.0, 11.5],
    saveShare: [0.3, 0.6, 0.95, 1.4, 1.9, 2.6, 3.6],
    weeklyFreq: [1.5, 2.3, 3.1, 4.0, 5.0, 6.2, 7.5],
    consistency: [45, 56, 67, 75, 83, 90, 96],
    growth30d: [-0.5, 0.5, 1.4, 2.5, 4.2, 7.0, 12.0],
  },
  MAKRO: {
    er: [0.5, 0.9, 1.4, 2.1, 3.0, 4.2, 6.0],
    vr: [6, 11, 18, 26, 36, 50, 72],
    erv: [1.5, 2.4, 3.5, 4.8, 6.2, 8.0, 10.5],
    saveShare: [0.25, 0.5, 0.8, 1.2, 1.7, 2.3, 3.1],
    weeklyFreq: [1.8, 2.6, 3.5, 4.4, 5.4, 6.6, 8.0],
    consistency: [48, 58, 69, 77, 85, 91, 96],
    growth30d: [-0.4, 0.4, 1.2, 2.2, 3.8, 6.2, 10.5],
  },
  MEGA: {
    er: [0.4, 0.7, 1.1, 1.7, 2.5, 3.6, 5.2],
    vr: [5, 9, 14, 22, 31, 44, 65],
    erv: [1.2, 2.0, 3.0, 4.2, 5.5, 7.2, 9.5],
    saveShare: [0.2, 0.45, 0.75, 1.1, 1.5, 2.0, 2.8],
    weeklyFreq: [2.0, 2.8, 3.8, 4.8, 5.8, 7.0, 8.5],
    consistency: [50, 60, 70, 78, 86, 92, 97],
    growth30d: [-0.3, 0.3, 1.0, 1.8, 3.2, 5.5, 9.0],
  },
};

export function buildBaselineBenchmarkGroup(
  platform: Platform,
  followers: number,
  categoryLabel: string,
): PeerBenchmarkGroup {
  const band = resolveFollowerBand(followers);
  const base = BASELINE_DISTRIBUTIONS[band.key];
  const medianVr = median(base.vr) ?? 22;
  const medianViewsValues = base.vr.map((vr) => Math.round((followers * vr) / 100));
  return {
    label: `${categoryLabel} · ${band.label.split(" ")[0]} (${platform})`,
    sampleSize: base.er.length,
    usedFallbackBandOnly: true,
    erValues: base.er,
    vrValues: base.vr,
    ervValues: base.erv,
    saveShareValues: base.saveShare,
    weeklyFreqValues: base.weeklyFreq,
    consistencyValues: base.consistency,
    growth30dValues: base.growth30d,
    medianViewsValues,
    followerValues: [
      Math.max(1_000, Math.round(followers * 0.5)),
      Math.max(1_500, Math.round(followers * 0.8)),
      followers,
      Math.round(followers * 1.3),
      Math.round(followers * 1.8),
    ],
    medianEr: median(base.er) ?? 2.5,
    medianVr,
  };
}

/**
 * Veritabanından kategori × bant × platform kıyas grubunu yükler.
 * Grupta < 30 hesap varsa bant × platform grubuna genişler; yine azsa sektörel bazla birleştirir.
 */
export async function loadPeerBenchmarkGroup(input: {
  platform: Platform;
  followers: number;
  categoryKey: string;
  categoryLabel: string;
}): Promise<PeerBenchmarkGroup> {
  const band = resolveFollowerBand(input.followers);
  const baseline = buildBaselineBenchmarkGroup(input.platform, input.followers, input.categoryLabel);

  const accounts = await prisma.socialAccount.findMany({
    where: { platform: input.platform, followers: { gt: 0 } },
    select: {
      followers: true,
      engagementRate: true,
      avgViews: true,
      influencer: {
        select: {
          category: true,
        },
      },
    },
    take: 500,
  });

  const inBand = accounts.filter((a) => resolveFollowerBand(a.followers).key === band.key);
  const inCatAndBand = inBand.filter(
    (a) => (a.influencer.category ?? "").toLowerCase() === input.categoryKey.toLowerCase(),
  );

  const useCatGroup = inCatAndBand.length >= BENCHMARK_MIN_ACCOUNTS;
  const peers = useCatGroup ? inCatAndBand : inBand;

  const dbErs = peers.map((p) => Number(p.engagementRate) * 100).filter((v) => v > 0 && v < 100);
  const dbVrs = peers
    .map((p) => (p.avgViews && p.followers > 0 ? (p.avgViews / p.followers) * 100 : null))
    .filter((v): v is number => v !== null && v > 0);
  const dbViews = peers.map((p) => p.avgViews).filter((v): v is number => v != null && v > 0);
  const dbFollowers = peers.map((p) => p.followers).filter((v) => v > 0);

  const erValues = dbErs.length >= 10 ? dbErs : [...baseline.erValues, ...dbErs];
  const vrValues = dbVrs.length >= 10 ? dbVrs : [...baseline.vrValues, ...dbVrs];
  const medianViewsValues = dbViews.length >= 10 ? dbViews : [...baseline.medianViewsValues, ...dbViews];
  const followerValues = dbFollowers.length >= 10 ? dbFollowers : [...baseline.followerValues, ...dbFollowers];

  const bandShort = band.label.split(" ")[0]!;
  return {
    ...baseline,
    label: useCatGroup
      ? `${input.categoryLabel} · ${bandShort}`
      : `${bandShort} (${input.platform} · tüm kategoriler)`,
    sampleSize: Math.max(peers.length, erValues.length),
    usedFallbackBandOnly: !useCatGroup,
    erValues,
    vrValues,
    medianViewsValues,
    followerValues,
    medianEr: median(erValues) ?? baseline.medianEr,
    medianVr: median(vrValues) ?? baseline.medianVr,
  };
}

