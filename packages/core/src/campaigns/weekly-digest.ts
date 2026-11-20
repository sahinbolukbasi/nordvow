import { prisma } from "../db";
import { getCampaignQuickMeta, saveCampaignQuickMeta } from "../domain/campaign-draft";
import { computeCampaignScore } from "../domain/campaign-score";

/**
 * Haftalık otomatik kampanya özeti (Pazartesi 09:00 Europe/Istanbul):
 * Yalnızca markanın kendi ekibine gider; kapatılabilir (quickMeta.weeklyReportEnabled).
 * İçerik: 3 cümlelik özet, 6 temel KPI, "sıradaki iş".
 */
export interface WeeklyCampaignDigest {
  campaignId: string;
  campaignName: string;
  brandName: string;
  generatedAt: string;
  summarySentences: [string, string, string];
  kpis: {
    reach: number | null;
    impressions: number | null;
    engagementRate: number | null;
    clicks: number | null;
    sales: number | null;
    scorePct: number | null;
  };
  nextAction: string;
  recipientEmails: string[];
}

export async function setWeeklyReportEnabled(campaignId: string, enabled: boolean): Promise<void> {
  await saveCampaignQuickMeta(campaignId, { weeklyReportEnabled: enabled });
}

export async function buildWeeklyCampaignDigest(campaignId: string): Promise<WeeklyCampaignDigest | null> {
  const meta = await getCampaignQuickMeta(campaignId);
  if (meta.weeklyReportEnabled === false) return null;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      brand: {
        select: {
          name: true,
          contactEmail: true,
          users: { where: { role: "BRAND", status: "ACTIVE" }, select: { email: true } },
        },
      },
      assignments: {
        where: { contractStatus: { not: "RED" } },
        include: {
          deliverables: {
            include: { metricSnapshots: { orderBy: { measuredAt: "desc" }, take: 1 } },
          },
        },
      },
    },
  });
  if (!campaign) return null;

  const deliverables = campaign.assignments.flatMap((a) => a.deliverables);
  const pendingReview = deliverables.filter((d) => d.status === "ICERIK_YUKLENDI");
  const published = deliverables.filter((d) => d.status === "YAYINLANDI" || d.status === "TAMAMLANDI");
  const missing23a = deliverables.filter((d) => d.contractViolation);

  let reach = 0;
  let impressions = 0;
  let likes = 0;
  let comments = 0;
  let saves = 0;
  let clicks = 0;
  let sales = 0;
  let hasMetrics = false;

  for (const d of deliverables) {
    const snap = d.metricSnapshots[0];
    if (!snap) continue;
    hasMetrics = true;
    reach += snap.reach ?? 0;
    impressions += snap.impressions ?? 0;
    likes += snap.likes ?? 0;
    comments += snap.comments ?? 0;
    saves += snap.saves ?? 0;
    clicks += snap.clicks ?? 0;
    sales += snap.sales ?? 0;
  }

  const scoreDeliverables = deliverables.map((d) => ({
    platform: d.platform,
    status: d.status,
    publishedAt: d.publishedAt,
    snapshots: d.metricSnapshots.map((s) => ({
      measuredAt: s.measuredAt,
      reach: s.reach,
      impressions: s.impressions,
      likes: s.likes,
      comments: s.comments,
      saves: s.saves,
      shares: s.shares,
      clicks: s.clicks,
      sales: s.sales,
      revenueKurus: s.revenueKurus,
      platformMetrics: s.platformMetrics,
    })),
  }));
  const scoreObj = computeCampaignScore(
    { startsAt: campaign.startsAt, targets: campaign.targets },
    scoreDeliverables,
  );
  const erDenom = reach > 0 ? reach : impressions;
  const er = hasMetrics && erDenom > 0 ? (likes + comments + saves) / erDenom : null;

  let nextAction = "Tüm teslimatlar planlandığı gibi ilerliyor.";
  if (pendingReview.length > 0) {
    const oldest = pendingReview.reduce((min, d) => (d.updatedAt < min ? d.updatedAt : min), pendingReview[0]!.updatedAt);
    const daysWaiting = Math.max(1, Math.floor((Date.now() - oldest.getTime()) / 86_400_000));
    nextAction = `${pendingReview.length} taslak onayınızı bekliyor · en eskisi ${daysWaiting} gündür.`;
  } else if (missing23a.length > 0) {
    nextAction = `${missing23a.length} içerikte md. 23/A reklam ibaresi düzeltmesi bekleniyor.`;
  } else if (published.length < deliverables.length) {
    nextAction = `${deliverables.length - published.length} içerik yayın aşamasında takip ediliyor.`;
  }

  const recipientEmails = [
    ...new Set([
      ...campaign.brand.users.map((u) => u.email),
      ...(campaign.brand.contactEmail ? [campaign.brand.contactEmail] : []),
    ]),
  ];

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    brandName: campaign.brand.name,
    generatedAt: new Date().toISOString(),
    summarySentences: [
      `${campaign.name} kampanyasında ${published.length}/${deliverables.length} içerik yayına alındı.`,
      hasMetrics
        ? `Ölçülen toplam erişim ${reach.toLocaleString("tr-TR")} ve toplam gösterim ${impressions.toLocaleString("tr-TR")} olarak kaydedildi.`
        : "Henüz ilk yayın metrikleri toplanmadı; ilk yayın sonrası veriler otomatik güncellenecek.",
      `Sıradaki öncelikli adım: ${nextAction}`,
    ],
    kpis: {
      reach: hasMetrics ? reach : null,
      impressions: hasMetrics ? impressions : null,
      engagementRate: er,
      clicks: hasMetrics ? clicks : null,
      sales: hasMetrics ? sales : null,
      scorePct: hasMetrics && scoreObj?.score != null ? Math.round(scoreObj.score * 100) : null,
    },
    nextAction,
    recipientEmails,
  };
}
