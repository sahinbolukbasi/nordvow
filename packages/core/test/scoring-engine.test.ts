import { describe, expect, it } from "vitest";
import { computeCampaignRoiMetrics, computePlatformScore } from "../src/scoring/engine";
import { weightedScoreWithRedistribution } from "../src/scoring/math";
import type { MediaSample, PlatformMeasurementInput, SnapshotSample } from "../src/scoring/types";

const NOW = new Date("2026-11-18T12:00:00Z");

function makePosts(count: number, overrides: Partial<MediaSample> = {}): MediaSample[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p-${i}`,
    mediaType: i % 3 === 0 ? "REELS" : i % 3 === 1 ? "CAROUSEL" : "POST",
    publishedAt: new Date(NOW.getTime() - i * 2 * 86_400_000),
    likes: 800,
    comments: 40,
    shares: 15,
    saves: 25,
    views: 12_000,
    reach: 9_500,
    meaningfulCommentRatio: 0.72,
    botCommentRatio: 0.04,
    ...overrides,
  }));
}

function makeSnapshots(days: number, startFollowers = 25_000, endFollowers = 27_000): SnapshotSample[] {
  return Array.from({ length: days }, (_, i) => {
    const ratio = days <= 1 ? 1 : i / (days - 1);
    return {
      takenAt: new Date(NOW.getTime() - (days - 1 - i) * 86_400_000),
      followers: Math.round(startFollowers + (endFollowers - startFollowers) * ratio),
      engagementRate: 0.035,
    };
  });
}

function baseInput(overrides: Partial<PlatformMeasurementInput> = {}): PlatformMeasurementInput {
  return {
    platform: "INSTAGRAM",
    handle: "@testcreator",
    categoryKey: "guzellik",
    categoryLabel: "Güzellik",
    followers: 27_000,
    hasOAuth: true,
    sourceLabel: "Meta Graph API",
    lastSyncedAt: NOW,
    posts: makePosts(30),
    snapshots: makeSnapshots(35),
    demographicConsistencyScore: 88,
    audienceMatchPct: 78,
    campaignHistoryScore: 84,
    ...overrides,
  };
}

describe("Nordvow Ölçüm ve Skorlama Motoru", () => {
  it("OAuth + 30 gönderi + 30+ gün snapshot ile Yüksek güven üretir", () => {
    const res = computePlatformScore(baseInput(), undefined, NOW);
    expect(res.confidence).toBe("YUKSEK");
    expect(res.isEstimated).toBe(false);
    expect(res.overallScore).not.toBeNull();
    expect(res.overallScore!).toBeGreaterThanOrEqual(65);
    expect(res.grade).toMatch(/^(A\+|A|B)$/);
    expect(res.tags).toContain("Doğrulanmış Veri");
  });

  it("OAuth'suz açık hesapta 15+ gönderi ile Orta güven, az gönderide Düşük güven verir", () => {
    const medium = computePlatformScore(
      baseInput({
        hasOAuth: false,
        sourceLabel: "Açık Profil Verisi",
        posts: makePosts(16, { views: null, saves: null, shares: null, reach: null, meaningfulCommentRatio: null, botCommentRatio: null }),
        snapshots: makeSnapshots(10),
        demographicConsistencyScore: null,
        audienceMatchPct: null,
      }),
      undefined,
      NOW,
    );
    expect(medium.confidence).toBe("ORTA");
    expect(medium.rawMetrics.vrPct.status).toBe("baglanti_gerekli");

    const low = computePlatformScore(
      baseInput({
        hasOAuth: false,
        posts: makePosts(5),
        snapshots: makeSnapshots(3),
      }),
      undefined,
      NOW,
    );
    expect(low.confidence).toBe("DUSUK");
    expect(low.isEstimated).toBe(true);
  });

  it("Gizli beğenileri ER hesabından hariç tutar; tümü gizliyse status='gizli' döner", () => {
    const allHidden = computePlatformScore(
      baseInput({
        posts: makePosts(20, { likesHidden: true, likes: null }),
      }),
      undefined,
      NOW,
    );
    expect(allHidden.rawMetrics.erPct.value).toBeNull();
    expect(allHidden.rawMetrics.erPct.status).toBe("gizli");
  });

  it("Medyan x 5 üstü viral gönderileri ayırır ve medyana dahil etmez", () => {
    const posts = makePosts(12, { views: 10_000, likes: 500 });
    // 2 adet viral gönderi (10.000 * 5 = 50.000'in çok üstünde)
    posts[0] = { ...posts[0]!, id: "viral-1", views: 450_000, likes: 22_000 };
    posts[1] = { ...posts[1]!, id: "viral-2", views: 380_000, likes: 18_000 };

    const res = computePlatformScore(baseInput({ posts }), undefined, NOW);
    expect(res.rawMetrics.viralCount).toBe(2);
    // Medyan 10.000 civarında kalmalı (viral gönderiler ortalamayı/medyanı bozmamalı)
    expect(res.rawMetrics.medianViews).toBe(10_000);
  });

  it("Eksik sinyallerde ağırlığı dağıtır ve >%50 eksikse skor null döner", () => {
    const partial = weightedScoreWithRedistribution([
      { value: 80, weight: 0.4 },
      { value: 60, weight: 0.3 },
      { value: null, weight: 0.3 },
    ]);
    expect(partial.score).toBe(71);

    const tooMissing = weightedScoreWithRedistribution([
      { value: 80, weight: 0.4 },
      { value: null, weight: 0.6 },
    ]);
    expect(tooMissing.score).toBeNull();

    // Ticari performans verisi yoksa skor null olmalı
    const noCommerce = computePlatformScore(
      baseInput({
        posts: makePosts(20, { isSponsored: false, purchaseIntentRatio: null }),
        campaignHistoryScore: null,
      }),
      undefined,
      NOW,
    );
    const commDim = noCommerce.dimensions.find((d) => d.key === "commercialPerformance");
    expect(commDim?.score).toBeNull();
    expect(commDim?.status).toBe("eksik");
  });

  it("Kampanya ROI metriklerini (CPM, CPE, EMV, Performans Endeksi) doğru hesaplar", () => {
    const roi = computeCampaignRoiMetrics({
      costTry: 14_000,
      views: 100_000,
      interactions: 3_500,
      categoryKey: "guzellik",
      predictedViews: 80_000,
    });
    expect(roi.cpmTry).toBe(140);
    expect(roi.cpeTry).toBe(4);
    expect(roi.emvTry).toBe(14_000);
    expect(roi.performanceIndex).toBe(1.25);
  });
});
