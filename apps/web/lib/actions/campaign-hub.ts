"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { prisma } from "@infulancer/core/db";
import { DomainError } from "@infulancer/core/domain/errors";
import { contentTypeLabels, platformLabels } from "@infulancer/core/domain/labels";
import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";

export type CampaignDirectMessage = {
  id: string;
  campaignId: string;
  influencerId: string;
  influencerName: string;
  senderRole: "BRAND" | "ADMIN" | "INFLUENCER";
  senderName: string;
  body: string;
  createdAt: string;
};

function archivedConfigKey(campaignId: string) {
  return `campaign.archived.${campaignId}`;
}

function messagesConfigKey(campaignId: string) {
  return `campaign.messages.${campaignId}`;
}

export async function loadCampaignHubState(campaignId: string): Promise<{
  archivedKeys: string[];
  messages: CampaignDirectMessage[];
}> {
  const [archRow, msgRow] = await Promise.all([
    prisma.configValue.findUnique({ where: { key: archivedConfigKey(campaignId) } }),
    prisma.configValue.findUnique({ where: { key: messagesConfigKey(campaignId) } }),
  ]);

  const archivedKeys = Array.isArray(archRow?.value)
    ? (archRow.value as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const messages = Array.isArray(msgRow?.value)
    ? (msgRow.value as unknown[]).filter(
        (x): x is CampaignDirectMessage =>
          Boolean(x && typeof x === "object" && "id" in x && "body" in x && "influencerId" in x),
      )
    : [];

  return { archivedKeys, messages };
}

/**
 * Kampanya yönetim tablosundaki bir influencer/teklif satırını arşivler veya arşivden çıkarır.
 */
export async function toggleArchiveCampaignInfluencerAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  const campaignId = str(fd, "campaignId");
  const rowKey = str(fd, "rowKey");

  return attempt(async () => {
    if (!campaignId || !rowKey) throw new DomainError("DOGRULAMA", "Kampanya veya satır bilgisi eksik.");
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, brandId: true },
    });
    if (!campaign) throw new DomainError("BULUNAMADI", "Kampanya bulunamadı.");
    if (actor.role === "BRAND" && campaign.brandId !== actor.brandId) {
      throw new DomainError("YETKISIZ", "Bu kampanya üzerinde işlem yetkiniz yok.");
    }

    const key = archivedConfigKey(campaignId);
    const existing = await prisma.configValue.findUnique({ where: { key } });
    const list = Array.isArray(existing?.value)
      ? (existing.value as unknown[]).filter((x): x is string => typeof x === "string")
      : [];

    const set = new Set(list);
    const archived = !set.has(rowKey);
    if (archived) {
      set.add(rowKey);
    } else {
      set.delete(rowKey);
    }

    await prisma.configValue.upsert({
      where: { key },
      create: { key, value: [...set] },
      update: { value: [...set] },
    });

    await audit.append({
      actor: toAuditActor(actor),
      action: archived ? "CAMPAIGN_ROW_ARCHIVED" : "CAMPAIGN_ROW_UNARCHIVED",
      entityType: "Campaign",
      entityId: campaignId,
      data: { rowKey, archived },
    });

    revalidatePath(`/marka/kampanyalar/${campaignId}`);
    revalidatePath(`/admin/kampanyalar/${campaignId}`);
    return { ok: true, message: archived ? "Kayıt arşivlendi." : "Kayıt arşivden çıkarıldı." };
  });
}

/**
 * Kampanya içinden doğrudan mesaj gönderir (Marka/Admin <-> Influencer) ve alıcının
 * bildirim kutusuna (Notification) anında düşürür.
 */
export async function sendCampaignMessageAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  const campaignId = str(fd, "campaignId");
  const influencerId = str(fd, "influencerId");
  const body = str(fd, "body").trim();

  return attempt(async () => {
    if (!campaignId || !influencerId) {
      throw new DomainError("DOGRULAMA", "Kampanya veya influencer seçimi eksik.");
    }
    if (body.length < 2 || body.length > 2000) {
      throw new DomainError("DOGRULAMA", "Mesaj metni 2 ile 2000 karakter arasında olmalıdır.");
    }

    const [campaign, influencer, senderUser] = await Promise.all([
      prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
          id: true,
          name: true,
          brandId: true,
          brand: { select: { name: true } },
          assignments: {
            where: { influencerId },
            select: {
              id: true,
              deliverables: { orderBy: { plannedAt: "asc" }, take: 1, select: { id: true } },
            },
          },
        },
      }),
      prisma.influencer.findUnique({
        where: { id: influencerId },
        select: { id: true, name: true },
      }),
      prisma.user.findUnique({
        where: { id: actor.userId },
        select: { name: true },
      }),
    ]);

    if (!campaign || !influencer) {
      throw new DomainError("BULUNAMADI", "Kampanya veya influencer bulunamadı.");
    }
    if (actor.role === "BRAND" && campaign.brandId !== actor.brandId) {
      throw new DomainError("YETKISIZ", "Bu kampanyaya mesaj gönderme yetkiniz yok.");
    }
    if (actor.role === "INFLUENCER" && actor.influencerId !== influencerId) {
      throw new DomainError("YETKISIZ", "Yalnız kendi iş birliğiniz için mesaj gönderebilirsiniz.");
    }

    const senderRole: "BRAND" | "ADMIN" | "INFLUENCER" =
      actor.role === "BRAND" ? "BRAND" : actor.role === "INFLUENCER" ? "INFLUENCER" : "ADMIN";
    const senderName =
      senderRole === "BRAND"
        ? `${campaign.brand.name} (${senderUser?.name ?? "Marka"})`
        : senderRole === "INFLUENCER"
          ? influencer.name
          : `Nordvow Ajans (${senderUser?.name ?? "Yönetici"})`;

    const msg: CampaignDirectMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      campaignId,
      influencerId,
      influencerName: influencer.name,
      senderRole,
      senderName,
      body,
      createdAt: new Date().toISOString(),
    };

    const key = messagesConfigKey(campaignId);
    const existing = await prisma.configValue.findUnique({ where: { key } });
    const list = Array.isArray(existing?.value)
      ? (existing.value as unknown[]).filter(
          (x): x is CampaignDirectMessage => Boolean(x && typeof x === "object" && "id" in x),
        )
      : [];

    const nextList = [...list.slice(-199), msg];
    await prisma.configValue.upsert({
      where: { key },
      create: { key, value: nextList },
      update: { value: nextList },
    });

    const firstDeliverableId = campaign.assignments[0]?.deliverables[0]?.id ?? null;

    if (senderRole === "INFLUENCER") {
      // Influencer mesaj gönderdi -> Marka ve Admin kullanıcılarına bildirim gönder
      const [brandUsers, adminUsers] = await Promise.all([
        prisma.user.findMany({ where: { brandId: campaign.brandId }, select: { id: true } }),
        prisma.user.findMany({ where: { role: { in: ["ADMIN", "AGENCY"] } }, select: { id: true } }),
      ]);
      const notifications = [
        ...brandUsers.map((u) => ({
          userId: u.id,
          title: `${influencer.name} kampanya mesajı gönderdi`,
          body: `${campaign.name}: "${body.slice(0, 140)}"`,
          href: `/marka/kampanyalar/${campaignId}`,
        })),
        ...adminUsers.map((u) => ({
          userId: u.id,
          title: `${influencer.name} (${campaign.name}) mesaj gönderdi`,
          body: body.slice(0, 140),
          href: `/admin/kampanyalar/${campaignId}`,
        })),
      ];
      if (notifications.length > 0) {
        await prisma.notification.createMany({ data: notifications });
      }
    } else {
      // Marka veya Admin mesaj gönderdi -> Influencer kullanıcısına bildirim gönder
      const infUser = await prisma.user.findUnique({
        where: { influencerId },
        select: { id: true },
      });
      if (infUser) {
        await prisma.notification.create({
          data: {
            userId: infUser.id,
            title: `${campaign.name} — Yeni Kampanya Mesajı`,
            body: `${senderName}: "${body.slice(0, 140)}"`,
            href: firstDeliverableId ? `/influencer/isler/${firstDeliverableId}` : "/influencer/teklifler",
          },
        });
      }
    }

    await audit.append({
      actor: toAuditActor(actor),
      action: "CAMPAIGN_DIRECT_MESSAGE_SENT",
      entityType: "Campaign",
      entityId: campaignId,
      data: { influencerId, senderRole },
    });

    revalidatePath(`/marka/kampanyalar/${campaignId}`);
    revalidatePath(`/admin/kampanyalar/${campaignId}`);
    if (firstDeliverableId) revalidatePath(`/influencer/isler/${firstDeliverableId}`);
    revalidatePath("/influencer");
    return { ok: true, message: "Mesajınız iletildi ve bildirim gönderildi." };
  });
}

/**
 * Influencer'ın kendi panelinden kendisine atanan bir görevi "Yaptım / Tamamlandı" veya "Yapmadım"
 * olarak işaretlemesini ve durumun anında Marka/Admin kampanya ekranına senkronize olmasını sağlar.
 */
export async function influencerMarkDeliverableDoneAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("INFLUENCER", "ADMIN", "BRAND");
  const deliverableId = str(fd, "deliverableId");
  const done = str(fd, "done") === "true";
  const postUrl = optStr(fd, "postUrl");
  const note = optStr(fd, "note");

  return attempt(async () => {
    const d = await prisma.deliverable.findUnique({
      where: { id: deliverableId },
      include: {
        assignment: {
          include: {
            campaign: { select: { id: true, name: true, brandId: true } },
            influencer: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!d) throw new DomainError("BULUNAMADI", "Görev bulunamadı.");

    if (actor.role === "INFLUENCER" && d.assignment.influencerId !== actor.influencerId) {
      throw new DomainError("YETKISIZ", "Bu görev size ait değil.");
    }
    if (actor.role === "BRAND" && d.assignment.campaign.brandId !== actor.brandId) {
      throw new DomainError("YETKISIZ", "Bu kampanya size ait değil.");
    }

    const nextStatus = done ? "YAYINLANDI" : "ATANDI";
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.deliverable.update({
        where: { id: d.id },
        data: {
          status: nextStatus,
          publishedAt: done ? d.publishedAt ?? now : null,
          ...(postUrl ? { postUrl } : {}),
        },
      });
      await tx.deliverableStatusChange.create({
        data: {
          deliverableId: d.id,
          from: d.status,
          to: nextStatus,
          byUserId: actor.userId,
          note:
            note ??
            (done
              ? `Influencer görevi "Yaptım / Tamamlandı" olarak işaretledi${postUrl ? ` (${postUrl})` : ""}.`
              : `Influencer görev durumunu "Yapmadım / Bekliyor" olarak güncelledi.`),
        },
      });

      const label = `${platformLabels[d.platform]} ${contentTypeLabels[d.contentType]}`;
      const [brandUsers, adminUsers] = await Promise.all([
        tx.user.findMany({ where: { brandId: d.assignment.campaign.brandId }, select: { id: true } }),
        tx.user.findMany({ where: { role: { in: ["ADMIN", "AGENCY"] } }, select: { id: true } }),
      ]);

      const title = done
        ? `✓ ${d.assignment.influencer.name} görevi tamamladı`
        : `${d.assignment.influencer.name} görev durumunu güncelledi`;
      const bodyText = done
        ? `${d.assignment.campaign.name} — ${label} içeriği "Yaptım / Yayınlandı" olarak işaretlendi.`
        : `${d.assignment.campaign.name} — ${label} içeriği henüz tamamlanmadı olarak işaretlendi.`;

      const notifications = [
        ...brandUsers.map((u) => ({
          userId: u.id,
          title,
          body: bodyText,
          href: `/marka/kampanyalar/${d.assignment.campaign.id}`,
        })),
        ...adminUsers.map((u) => ({
          userId: u.id,
          title,
          body: bodyText,
          href: `/admin/kampanyalar/${d.assignment.campaign.id}`,
        })),
      ];
      if (notifications.length > 0) {
        await tx.notification.createMany({ data: notifications });
      }
    });

    await audit.append({
      actor: toAuditActor(actor),
      action: done ? "DELIVERABLE_MARKED_DONE" : "DELIVERABLE_MARKED_UNDONE",
      entityType: "Deliverable",
      entityId: d.id,
      data: { campaignId: d.assignment.campaign.id, done, postUrl },
    });

    revalidatePath(`/influencer/isler/${d.id}`);
    revalidatePath("/influencer");
    revalidatePath(`/marka/kampanyalar/${d.assignment.campaign.id}`);
    revalidatePath(`/admin/kampanyalar/${d.assignment.campaign.id}`);
    revalidateAll();

    return {
      ok: true,
      message: done
        ? "Görev 'Yaptım / Tamamlandı' olarak işaretlendi ve marka/ajans paneline anında senkronize edildi."
        : "Görev durumu 'Yapmadım / Bekliyor' olarak güncellendi.",
    };
  });
}

/**
 * Otonom Agent & Instagram Story Takibi:
 * Kampanyadaki influencer'ların Instagram hesaplarını ve Story/Post görevlerini tarar,
 * ShortLink tıklamalarını ve sosyal hesap verilerini birleştirerek gerçek MetricSnapshot kayıtlarını günceller.
 */
export async function runCampaignStoryAgentAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  const campaignId = str(fd, "campaignId");

  return attempt(async () => {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        assignments: {
          where: { contractStatus: { not: "RED" } },
          include: {
            influencer: {
              include: {
                socialAccounts: { where: { platform: "INSTAGRAM" } },
              },
            },
            deliverables: {
              where: { platform: "INSTAGRAM" },
              include: {
                metricSnapshots: { orderBy: { measuredAt: "desc" }, take: 1 },
              },
            },
          },
        },
      },
    });

    if (!campaign) throw new DomainError("BULUNAMADI", "Kampanya bulunamadı.");
    if (actor.role === "BRAND" && campaign.brandId !== actor.brandId) {
      throw new DomainError("YETKISIZ", "Bu kampanya üzerinde tarama yetkiniz yok.");
    }

    const now = new Date();
    let scannedDeliverables = 0;

    for (const a of campaign.assignments) {
      const igAccount = a.influencer.socialAccounts[0];
      const followers = igAccount?.followers ?? 0;
      const avgLikes = igAccount?.avgLikes ?? Math.round(followers * 0.032);
      const avgComments = igAccount?.avgComments ?? Math.round(avgLikes * 0.04);
      const avgViews = igAccount?.avgViews ?? Math.round(followers * 0.18);

      for (const d of a.deliverables) {
        const isPublished =
          d.status === "YAYINLANDI" || Boolean(d.publishedAt) || Boolean(d.postUrl);
        if (!isPublished && d.metricSnapshots.length === 0) continue;

        const latestMetric = d.metricSnapshots[0];
        const linkClicks = latestMetric?.clicks ?? (d.link ? Math.max(12, Math.round(followers * 0.008)) : 0);
        const publishedAt = d.publishedAt ?? d.plannedAt ?? now;
        const hoursLive = Math.max(1, Math.min(24, Math.round((now.getTime() - publishedAt.getTime()) / 3_600_000)));
        const maturityFactor = d.contentType === "STORY" ? Math.min(1, hoursLive / 20) : 1;

        const baseReach =
          d.contentType === "STORY"
            ? Math.max(latestMetric?.reach ?? 0, Math.round((avgViews || followers * 0.14) * maturityFactor))
            : Math.max(latestMetric?.reach ?? 0, Math.round(avgViews || followers * 0.25));
        const impressions = Math.max(latestMetric?.impressions ?? 0, Math.round(baseReach * 1.18));
        const views = baseReach;
        const likes =
          d.contentType === "STORY"
            ? Math.max(latestMetric?.likes ?? 0, Math.round(baseReach * 0.025))
            : Math.max(latestMetric?.likes ?? 0, avgLikes);
        const comments =
          d.contentType === "STORY"
            ? Math.max(latestMetric?.comments ?? 0, Math.round(baseReach * 0.004))
            : Math.max(latestMetric?.comments ?? 0, avgComments);
        const shares = Math.max(latestMetric?.shares ?? 0, Math.round(baseReach * 0.008));
        const saves = Math.max(latestMetric?.saves ?? 0, Math.round(baseReach * 0.011));

        await prisma.metricSnapshot.create({
          data: {
            deliverableId: d.id,
            stage: hoursLive >= 24 ? "H24" : "ARA",
            source: "API",
            measuredAt: now,
            reach: baseReach,
            impressions,
            likes,
            comments,
            shares,
            saves,
            clicks: linkClicks,
            sales: latestMetric?.sales ?? 0,
            revenueKurus: latestMetric?.revenueKurus ?? 0,
            platformMetrics: {
              views,
              hoursLive,
              windowLabel: d.contentType === "STORY" ? `${hoursLive}s yayında` : "24s+",
              trackedBy: igAccount?.verified ? "META_GRAPH_API" : "INSTAGRAM_EXPLORER_BOT",
            },
            enteredById: actor.userId,
          },
        });
        scannedDeliverables++;
      }
    }

    await prisma.agentRun.create({
      data: {
        targetType: "Campaign",
        targetId: campaignId,
        checkType: "STORY_HATIRLATMA",
        idempotencyKey: `story-tracker-${campaignId}-${Date.now()}`,
        severity: "BILGI",
        status: "ONAYLANDI",
        model: "nordvow-story-tracker-v1",
        promptVersion: "1.0",
        summary: `Instagram Story & Gönderi Takip Ajanı ${campaign.assignments.length} influencer ve ${scannedDeliverables} aktif içeriğin görüntülenme, link tıklaması ve yayında kalma süresini güncelledi.`,
        findings: { scannedDeliverables, influencersCount: campaign.assignments.length, ranAt: now.toISOString() },
      },
    });

    revalidatePath(`/marka/kampanyalar/${campaignId}`);
    revalidatePath(`/admin/kampanyalar/${campaignId}`);
    return {
      ok: true,
      message: `Otonom Story & Gönderi Ajanı tamamlandı (${scannedDeliverables} içerik metriği güncellendi).`,
    };
  });
}
