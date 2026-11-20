import { prisma } from "@infulancer/core/db";
import { creativePricing } from "@infulancer/core/creative/pricing";
import {
  contentTypeLabels,
  contractStatusLabels,
  deliverableStatusLabels,
  platformLabels,
} from "@infulancer/core/domain/labels";
import { countryLabel, currencyOf, DEFAULT_FX_RATES } from "@infulancer/core/i18n/regions";
import { loadCampaignHubState } from "@/lib/actions/campaign-hub";
import type { StoryTrackingRow, UnifiedCampaignRow } from "@/components/campaign/campaign-hub";

export async function loadCampaignHubData(campaignId: string) {
  const [campaign, hubState, pricing] = await Promise.all([
    prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: {
        brand: { select: { id: true, name: true, country: true, defaultExecutionMode: true } },
        assignments: {
          orderBy: { createdAt: "desc" },
          include: {
            influencer: {
              select: {
                id: true,
                name: true,
                country: true,
                socialAccounts: {
                  select: {
                    platform: true,
                    handle: true,
                    verified: true,
                  },
                },
              },
            },
            deliverables: {
              orderBy: { plannedAt: "asc" },
              include: {
                metricSnapshots: { orderBy: { measuredAt: "desc" }, take: 1 },
              },
            },
          },
        },
      },
    }),
    loadCampaignHubState(campaignId),
    creativePricing(),
  ]);

  const assignedInfluencerIds = new Set(campaign.assignments.map((a) => a.influencerId));
  const offers = await prisma.offer.findMany({
    where: {
      brandId: campaign.brandId,
      OR: [
        { campaignId },
        ...(campaign.shortlistInfluencerIds.length
          ? [{ influencerId: { in: campaign.shortlistInfluencerIds } }]
          : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const offerInfluencerIds = offers
    .map((o) => o.influencerId)
    .filter((id) => !assignedInfluencerIds.has(id));
  const offerInfluencers = offerInfluencerIds.length
    ? await prisma.influencer.findMany({
        where: { id: { in: offerInfluencerIds } },
        select: {
          id: true,
          name: true,
          country: true,
          socialAccounts: { select: { platform: true, handle: true } },
        },
      })
    : [];
  const offerInfMap = new Map(offerInfluencers.map((i) => [i.id, i]));

  const rows: UnifiedCampaignRow[] = [];

  for (const a of campaign.assignments) {
    const igAcc =
      a.influencer.socialAccounts.find((s) => s.platform === "INSTAGRAM") ??
      a.influencer.socialAccounts[0];
    const hasRevision = a.deliverables.some((d) => d.status === "REVIZYON");
    const statusCategory: UnifiedCampaignRow["statusCategory"] =
      a.contractStatus === "RED"
        ? "RED"
        : hasRevision
          ? "REVIZE"
          : a.contractStatus === "KABUL"
            ? "KABUL"
            : "BEKLIYOR";

    const statusLabel = hasRevision
      ? "Revize İstendi"
      : contractStatusLabels[a.contractStatus] ?? a.contractStatus;

    const deliverableItems = a.deliverables.map((d) => {
      const isDone =
        d.status === "YAYINLANDI" ||
        d.status === "TAMAMLANDI" ||
        Boolean(d.publishedAt) ||
        Boolean(d.postUrl);
      return {
        id: d.id,
        label: `${platformLabels[d.platform]} ${contentTypeLabels[d.contentType]}`,
        status: deliverableStatusLabels[d.status] ?? d.status,
        isDone,
        postUrl: d.postUrl,
        publishedAt: d.publishedAt ? d.publishedAt.toISOString() : null,
      };
    });

    rows.push({
      rowKey: `assignment:${a.id}`,
      kind: "ASSIGNMENT",
      influencerId: a.influencer.id,
      influencerName: a.influencer.name,
      influencerHandle: igAcc?.handle ?? null,
      influencerCountry: countryLabel(a.influencer.country),
      influencerCurrency: currencyOf(a.influencer.country),
      statusCategory,
      statusLabel,
      feeMinor: Number(a.feeKurus),
      feeCurrency: campaign.currency,
      counterFeeMinor: null,
      note: null,
      deliverablesTotal: deliverableItems.length,
      deliverablesDone: deliverableItems.filter((d) => d.isDone).length,
      deliverableItems,
      updatedAt: a.createdAt.toISOString(),
    });
  }

  for (const o of offers) {
    if (o.assignmentId && campaign.assignments.some((a) => a.id === o.assignmentId)) {
      continue;
    }
    const inf =
      campaign.assignments.find((a) => a.influencerId === o.influencerId)?.influencer ??
      offerInfMap.get(o.influencerId);
    if (!inf) continue;
    const igAcc = inf.socialAccounts.find((s) => s.platform === "INSTAGRAM") ?? inf.socialAccounts[0];

    const statusCategory: UnifiedCampaignRow["statusCategory"] =
      o.status === "KABUL" || o.status === "KAMPANYAYA_EKLENDI"
        ? "KABUL"
        : o.status === "RED" || o.status === "GERI_CEKILDI" || o.status === "SURESI_DOLDU"
          ? "RED"
          : o.status === "KARSI_TEKLIF"
            ? "REVIZE"
            : "BEKLIYOR";

    const statusLabel =
      o.status === "KARSI_TEKLIF"
        ? "Karşı Teklif / Revize"
        : o.status === "KABUL" || o.status === "KAMPANYAYA_EKLENDI"
          ? "Kabul Edildi"
          : o.status === "RED"
            ? "Reddedildi"
            : "Teklif Bekliyor";

    rows.push({
      rowKey: `offer:${o.id}`,
      kind: "OFFER",
      influencerId: inf.id,
      influencerName: inf.name,
      influencerHandle: igAcc?.handle ?? null,
      influencerCountry: countryLabel(inf.country),
      influencerCurrency: currencyOf(inf.country),
      statusCategory,
      statusLabel,
      feeMinor: o.totalKurus,
      feeCurrency: currencyOf(campaign.brand.country),
      counterFeeMinor: o.counterKurus,
      note: o.counterNote ?? o.responseNote ?? o.title,
      deliverablesTotal: 0,
      deliverablesDone: 0,
      deliverableItems: [],
      updatedAt: o.updatedAt.toISOString(),
    });
  }

  const now = new Date();
  const storyRows: StoryTrackingRow[] = [];

  for (const a of campaign.assignments) {
    if (a.contractStatus === "RED") continue;
    const igAcc = a.influencer.socialAccounts.find((s) => s.platform === "INSTAGRAM");
    for (const d of a.deliverables) {
      if (d.platform !== "INSTAGRAM") continue;
      const latestMetric = d.metricSnapshots[0];
      const pm =
        latestMetric?.platformMetrics && typeof latestMetric.platformMetrics === "object"
          ? (latestMetric.platformMetrics as Record<string, unknown>)
          : {};
      const isPublished =
        d.status === "YAYINLANDI" ||
        d.status === "TAMAMLANDI" ||
        Boolean(d.publishedAt) ||
        Boolean(d.postUrl);

      let retentionText = "Henüz yayınlanmadı";
      if (isPublished) {
        const pubTime = (d.publishedAt ?? d.plannedAt).getTime();
        const elapsedHours = Math.max(1, Math.round((now.getTime() - pubTime) / 3_600_000));
        if (d.contentType === "STORY") {
          retentionText =
            elapsedHours >= 24
              ? "24 saat tamamlandı (Arşivde)"
              : `${elapsedHours} saat yayında (Aktif Story)`;
        } else {
          const days = Math.floor(elapsedHours / 24);
          retentionText = days > 0 ? `${days} gün ${elapsedHours % 24}s yayında` : `${elapsedHours} saat yayında`;
        }
      }

      storyRows.push({
        deliverableId: d.id,
        influencerId: a.influencer.id,
        influencerName: a.influencer.name,
        igHandle: igAcc?.handle ?? null,
        oauthConnected: Boolean(igAcc?.verified),
        contentType: `${contentTypeLabels[d.contentType]}${d.contentType === "STORY" ? ` (${d.frameCount} kare)` : ""}`,
        status: deliverableStatusLabels[d.status] ?? d.status,
        isPublished,
        publishedAt: d.publishedAt ? d.publishedAt.toISOString() : null,
        plannedAt: d.plannedAt.toISOString(),
        postUrl: d.postUrl,
        shortLinkUrl: d.link,
        reach: latestMetric?.reach ?? 0,
        views: typeof pm.views === "number" ? pm.views : (latestMetric?.reach ?? 0),
        clicks: latestMetric?.clicks ?? 0,
        likes: latestMetric?.likes ?? 0,
        retentionText,
        lastCapturedAt: latestMetric?.measuredAt ? latestMetric.measuredAt.toISOString() : null,
      });
    }
  }

  return {
    rows,
    storyRows,
    archivedKeys: hubState.archivedKeys,
    messages: hubState.messages,
    fx: (pricing.fx ?? DEFAULT_FX_RATES) as Record<string, number>,
  };
}
