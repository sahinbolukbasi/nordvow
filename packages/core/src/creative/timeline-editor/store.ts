import { createHash, randomUUID } from "node:crypto";
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { ZodError } from "zod";
import { prisma, type Prisma } from "../../db";
import { DomainError } from "../../domain/errors";
import { bucket, s3 } from "../../storage/s3";
import { isAgencyTenant } from "../tenant";
import { getOwnedUpload } from "../uploads";
import { captionStyleForPreset } from "./captions";
import { secondsToTicks, ticksToSeconds, type SupportedFps, type Ticks } from "./time";
import {
  ASPECT_CANVAS,
  assertLockedBrandLayersIntact,
  createEmptyTimeline,
  studioTimelineSchema,
  timelineTotalDurationTicks,
  type AspectPreset,
  type StudioTimeline,
} from "./timeline-schema";

const PROJECT_KEY_PREFIX = "studio:project:";
const VERSIONS_KEY_PREFIX = "studio:versions:";
const CONSENT_KEY_PREFIX = "studio:consent:";
const MAX_VERSIONS_PER_PROJECT = 30;
export const CURRENT_CONSENT_VERSION = "fal_transfer_v1" as const;

export type StudioProject = {
  id: string;
  tenantId: string;
  ownerUserId: string;
  title: string;
  campaignId: string | null;
  deliverableId: string | null;
  templateId: string | null;
  revision: number;
  timeline: StudioTimeline;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  submittedAssetId: string | null;
};

export type StudioProjectSummary = {
  id: string;
  title: string;
  campaignId: string | null;
  deliverableId: string | null;
  templateId: string | null;
  revision: number;
  aspectPreset: AspectPreset;
  fps: SupportedFps;
  durationSec: number;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  submittedAssetId: string | null;
};

export type StudioProjectVersion = {
  id: string;
  revision: number;
  label: string;
  createdAt: string;
  createdBy: string;
  timeline: StudioTimeline;
};

export type StudioTemplate = {
  id: string;
  name: string;
  description: string;
  aspectPreset: Exclude<AspectPreset, "custom">;
  durationSec: number;
  category: "urun" | "kupon" | "donusum";
  buildTimeline: (vars: {
    brandName: string;
    couponCode: string;
    campaignUrl: string;
  }) => StudioTimeline;
};

export type StudioConsentRecord = {
  version: string;
  acceptedAt: string;
  tenantId: string;
  userId: string;
  ipHash: string | null;
  userAgent: string | null;
};

function projectKey(tenantId: string, projectId: string): string {
  return `${PROJECT_KEY_PREFIX}${tenantId}:${projectId}`;
}

function versionsKey(tenantId: string, projectId: string): string {
  return `${VERSIONS_KEY_PREFIX}${tenantId}:${projectId}`;
}

function consentKey(tenantId: string, userId: string): string {
  return `${CONSENT_KEY_PREFIX}${tenantId}:${userId}`;
}

function summarizeProject(p: StudioProject): StudioProjectSummary {
  return {
    id: p.id,
    title: p.title,
    campaignId: p.campaignId,
    deliverableId: p.deliverableId,
    templateId: p.templateId,
    revision: p.revision,
    aspectPreset: p.timeline.settings.aspectPreset,
    fps: p.timeline.settings.fps,
    durationSec: Number(ticksToSeconds(timelineTotalDurationTicks(p.timeline)).toFixed(2)),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    lockedAt: p.lockedAt,
    submittedAssetId: p.submittedAssetId,
  };
}

function defaultTransform() {
  return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
}

/**
 * 3 yerleşik kampanya şablonu.
 * Tüm şablonlar Ticaret Bakanlığı uyumlu kilitli `#reklam · İşbirliği` katmanı içerir
 * (`locked: true, lockedBy: "brand"`).
 */
export const BUILTIN_STUDIO_TEMPLATES: StudioTemplate[] = [
  {
    id: "tmpl_product_15s",
    name: "Ürün Tanıtım Kancası (15 sn)",
    description: "İlk 3 saniye kanca başlığı, özellik callout ve sabit #reklam rozeti ile 9:16 dikey şablon.",
    aspectPreset: "9:16",
    durationSec: 15,
    category: "urun",
    buildTimeline: ({ brandName, couponCode, campaignUrl }) => {
      const base = createEmptyTimeline("9:16", 30);
      const t0 = base.tracks.overlay[0];
      if (t0?.type === "text") {
        t0.elements.push(
          {
            id: "brand-ad-badge",
            type: "text",
            name: "Reklam İbaresi (Zorunlu)",
            startTime: 0 as Ticks,
            duration: secondsToTicks(15),
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            transform: { x: -0.22, y: -0.38, scale: 0.65, rotation: 0, opacity: 0.95 },
            locked: true,
            lockedBy: "brand",
            slotId: "disclosure",
            text: `#reklam · ${brandName} İşbirliği`,
            style: {
              ...captionStyleForPreset("box"),
              fontSize: 34,
              align: "left",
              background: "rgba(9,9,11,0.72)",
            },
          },
          {
            id: "tmpl_hook_1",
            type: "text",
            name: "Kanca Başlık (0–3 sn)",
            startTime: 0 as Ticks,
            duration: secondsToTicks(3),
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            transform: { x: 0, y: -0.18, scale: 1, rotation: 0, opacity: 1 },
            slotId: "hook",
            text: "Bunu denemeden geçme ✨",
            style: captionStyleForPreset("bold-yellow"),
          },
          {
            id: "tmpl_benefit_1",
            type: "text",
            name: "Özellik Vurgusu",
            startTime: secondsToTicks(3.5),
            duration: secondsToTicks(5.5),
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            transform: { x: 0, y: 0.16, scale: 0.9, rotation: 0, opacity: 1 },
            slotId: "benefit",
            text: `${brandName} ile ilk günden farkı hisset`,
            style: captionStyleForPreset("classic"),
          },
        );
      }
      const g2 = base.tracks.overlay[2];
      if (g2?.type === "graphic") {
        g2.elements.push({
          id: "tmpl_cta_1",
          type: "cta",
          name: "Kampanya CTA Kartı",
          startTime: secondsToTicks(9.5),
          duration: secondsToTicks(5.5),
          trimStart: 0 as Ticks,
          trimEnd: 0 as Ticks,
          transform: { x: 0, y: 0.25, scale: 1, rotation: 0, opacity: 1 },
          slotId: "cta",
          label: couponCode ? `Kodu Kullan: ${couponCode}` : `${brandName} İncele`,
          couponCode: couponCode || undefined,
          url: campaignUrl,
          style: {
            bgColor: "#111827",
            textColor: "#FFFFFF",
            accentColor: "#FF2BD6",
            borderRadius: 24,
          },
        });
      }
      return base;
    },
  },
  {
    id: "tmpl_coupon_announce",
    name: "İndirim & Kupon Duyurusu (15 sn)",
    description: "Net kupon kartı, yüksek kontrast kanca ve UTM bağlantısı ile dönüşüm odaklı akış.",
    aspectPreset: "9:16",
    durationSec: 15,
    category: "kupon",
    buildTimeline: ({ brandName, couponCode, campaignUrl }) => {
      const base = createEmptyTimeline("9:16", 30);
      const t0 = base.tracks.overlay[0];
      if (t0?.type === "text") {
        t0.elements.push(
          {
            id: "brand-ad-badge",
            type: "text",
            name: "Reklam İbaresi (Zorunlu)",
            startTime: 0 as Ticks,
            duration: secondsToTicks(15),
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            transform: { x: -0.22, y: -0.38, scale: 0.65, rotation: 0, opacity: 0.95 },
            locked: true,
            lockedBy: "brand",
            slotId: "disclosure",
            text: `#reklam · ${brandName} İşbirliği`,
            style: {
              ...captionStyleForPreset("box"),
              fontSize: 34,
              align: "left",
              background: "rgba(9,9,11,0.72)",
            },
          },
          {
            id: "tmpl_coupon_hook",
            type: "text",
            name: "Fırsat Kancası",
            startTime: 0 as Ticks,
            duration: secondsToTicks(2.5),
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            transform: { x: 0, y: -0.2, scale: 1, rotation: 0, opacity: 1 },
            slotId: "hook",
            text: "Sadece takipçilerime özel fırsat ⚡",
            style: captionStyleForPreset("bold-yellow"),
          },
        );
      }
      const g2 = base.tracks.overlay[2];
      if (g2?.type === "graphic") {
        g2.elements.push({
          id: "tmpl_coupon_card",
          type: "cta",
          name: "Kupon Kartı",
          startTime: secondsToTicks(3),
          duration: secondsToTicks(12),
          trimStart: 0 as Ticks,
          trimEnd: 0 as Ticks,
          transform: { x: 0, y: 0.24, scale: 1.05, rotation: 0, opacity: 1 },
          slotId: "cta",
          label: couponCode ? `İndirim Kodu: ${couponCode}` : `${brandName} Fırsatı`,
          couponCode: couponCode || undefined,
          url: campaignUrl,
          style: {
            bgColor: "#0F172A",
            textColor: "#FFFFFF",
            accentColor: "#F59E0B",
            borderRadius: 28,
          },
        });
      }
      return base;
    },
  },
  {
    id: "tmpl_before_after",
    name: "Öncesi / Sonrası Dönüşüm (20 sn)",
    description: "Önce (0–7 sn), Sonra (7–14 sn) ve Kapanış CTA (14–20 sn) bölmeli UGC kurgusu.",
    aspectPreset: "9:16",
    durationSec: 20,
    category: "donusum",
    buildTimeline: ({ brandName, couponCode, campaignUrl }) => {
      const base = createEmptyTimeline("9:16", 30);
      const t0 = base.tracks.overlay[0];
      if (t0?.type === "text") {
        t0.elements.push(
          {
            id: "brand-ad-badge",
            type: "text",
            name: "Reklam İbaresi (Zorunlu)",
            startTime: 0 as Ticks,
            duration: secondsToTicks(20),
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            transform: { x: -0.22, y: -0.38, scale: 0.65, rotation: 0, opacity: 0.95 },
            locked: true,
            lockedBy: "brand",
            slotId: "disclosure",
            text: `#reklam · ${brandName} İşbirliği`,
            style: {
              ...captionStyleForPreset("box"),
              fontSize: 34,
              align: "left",
              background: "rgba(9,9,11,0.72)",
            },
          },
          {
            id: "tmpl_ba_before",
            type: "text",
            name: "Önce Rozeti",
            startTime: secondsToTicks(0.3),
            duration: secondsToTicks(6.5),
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            transform: { x: 0, y: -0.2, scale: 0.95, rotation: 0, opacity: 1 },
            slotId: "before",
            text: "ÖNCE • Başlangıç durumu",
            style: captionStyleForPreset("box"),
          },
          {
            id: "tmpl_ba_after",
            type: "text",
            name: "Sonra Rozeti",
            startTime: secondsToTicks(7),
            duration: secondsToTicks(7),
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            transform: { x: 0, y: -0.2, scale: 1, rotation: 0, opacity: 1 },
            slotId: "after",
            text: `SONRA ✨ ${brandName} farkı`,
            style: captionStyleForPreset("bold-yellow"),
          },
        );
      }
      const g2 = base.tracks.overlay[2];
      if (g2?.type === "graphic") {
        g2.elements.push({
          id: "tmpl_ba_cta",
          type: "cta",
          name: "Sonuç CTA",
          startTime: secondsToTicks(14),
          duration: secondsToTicks(6),
          trimStart: 0 as Ticks,
          trimEnd: 0 as Ticks,
          transform: { x: 0, y: 0.25, scale: 1, rotation: 0, opacity: 1 },
          slotId: "cta",
          label: couponCode ? `${couponCode} ile Deneyin` : `${brandName} Keşfet`,
          couponCode: couponCode || undefined,
          url: campaignUrl,
          style: {
            bgColor: "#18181B",
            textColor: "#FFFFFF",
            accentColor: "#10B981",
            borderRadius: 24,
          },
        });
      }
      return base;
    },
  },
];

async function resolveCampaignTemplateVars(ctx?: {
  campaignId?: string | null;
  deliverableId?: string | null;
}): Promise<{ brandName: string; couponCode: string; campaignUrl: string; resolvedCampaignId: string | null }> {
  let brandName = "NordVow Partner";
  let couponCode = "INDIRIM15";
  let campaignSlug = "nordvow-kampanya";
  let platform = "instagram";
  let resolvedCampaignId: string | null = ctx?.campaignId ?? null;

  if (ctx?.deliverableId) {
    const deliv = await prisma.deliverable.findUnique({
      where: { id: ctx.deliverableId },
      include: {
        assignment: {
          include: {
            campaign: { include: { brand: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (deliv) {
      resolvedCampaignId = deliv.assignment.campaignId;
      brandName = deliv.assignment.campaign.brand.name;
      campaignSlug = deliv.assignment.campaign.slug;
      platform = deliv.platform.toLowerCase();
      if (deliv.assignment.couponCode) {
        couponCode = deliv.assignment.couponCode;
      } else {
        const activeCoupon = await prisma.coupon.findFirst({
          where: { tenantId: deliv.assignment.campaign.brandId, status: "YAYINDA" },
          orderBy: { createdAt: "desc" },
          select: { sharedCode: true },
        });
        if (activeCoupon?.sharedCode) couponCode = activeCoupon.sharedCode;
      }
    }
  } else if (ctx?.campaignId) {
    const camp = await prisma.campaign.findUnique({
      where: { id: ctx.campaignId },
      include: { brand: { select: { id: true, name: true } } },
    });
    if (camp) {
      resolvedCampaignId = camp.id;
      brandName = camp.brand.name;
      campaignSlug = camp.slug;
      const activeCoupon = await prisma.coupon.findFirst({
        where: { tenantId: camp.brandId, status: "YAYINDA" },
        orderBy: { createdAt: "desc" },
        select: { sharedCode: true },
      });
      if (activeCoupon?.sharedCode) couponCode = activeCoupon.sharedCode;
    }
  }

  const campaignUrl = `https://nordvow.com/k/${encodeURIComponent(campaignSlug)}?utm_source=influencer&utm_medium=${encodeURIComponent(platform)}&utm_campaign=${encodeURIComponent(campaignSlug)}`;
  return { brandName, couponCode, campaignUrl, resolvedCampaignId };
}

export async function hydrateTemplateForCampaign(
  templateId: string,
  ctx?: { campaignId?: string | null; deliverableId?: string | null },
): Promise<{ timeline: StudioTimeline; template: StudioTemplate; resolvedCampaignId: string | null }> {
  const tmpl = BUILTIN_STUDIO_TEMPLATES.find((t) => t.id === templateId);
  if (!tmpl) {
    throw new DomainError("BULUNAMADI", "Seçilen video şablonu bulunamadı.");
  }
  const vars = await resolveCampaignTemplateVars(ctx);
  return {
    timeline: tmpl.buildTimeline({
      brandName: vars.brandName,
      couponCode: vars.couponCode,
      campaignUrl: vars.campaignUrl,
    }),
    template: tmpl,
    resolvedCampaignId: vars.resolvedCampaignId,
  };
}

export async function listStudioProjects(tenantId: string): Promise<StudioProjectSummary[]> {
  const rows = await prisma.configValue.findMany({
    where: { key: { startsWith: `${PROJECT_KEY_PREFIX}${tenantId}:` } },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });
  const list: StudioProjectSummary[] = [];
  for (const row of rows) {
    const raw = row.value as unknown as StudioProject | null;
    if (!raw || raw.tenantId !== tenantId) continue;
    list.push(summarizeProject(raw));
  }
  list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return list;
}

export async function getStudioProject(tenantId: string, projectId: string): Promise<StudioProject> {
  const row = await prisma.configValue.findUnique({ where: { key: projectKey(tenantId, projectId) } });
  if (!row) {
    throw new DomainError("BULUNAMADI", "Video editör projesi bulunamadı.");
  }
  const proj = row.value as unknown as StudioProject;
  if (!proj || proj.tenantId !== tenantId) {
    throw new DomainError("YETKISIZ", "Bu projeye erişim yetkiniz yok.");
  }
  return proj;
}

export async function createStudioProject(input: {
  tenantId: string;
  ownerUserId: string;
  title?: string;
  aspectPreset?: AspectPreset;
  fps?: SupportedFps;
  templateId?: string | null;
  campaignId?: string | null;
  deliverableId?: string | null;
  initialAssetId?: string | null;
}): Promise<StudioProject> {
  const projectId = `proj_${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();
  let timeline: StudioTimeline;
  let resolvedCampaignId = input.campaignId ?? null;
  let defaultTitle = input.title?.trim() || "Yeni Video Projesi";

  if (input.templateId) {
    const hydrated = await hydrateTemplateForCampaign(input.templateId, {
      campaignId: input.campaignId,
      deliverableId: input.deliverableId,
    });
    timeline = hydrated.timeline;
    resolvedCampaignId = hydrated.resolvedCampaignId ?? resolvedCampaignId;
    if (!input.title?.trim()) defaultTitle = hydrated.template.name;
  } else {
    timeline = createEmptyTimeline(input.aspectPreset ?? "9:16", input.fps ?? 30);
    if (input.aspectPreset && input.aspectPreset !== "custom") {
      timeline.settings.canvas = ASPECT_CANVAS[input.aspectPreset];
    }
  }

  if (input.initialAssetId) {
    const u = await getOwnedUpload(input.tenantId, input.initialAssetId);
    const durSec = u.kind === "video" ? Math.min(Math.max(u.durationSec ?? 6, 1), 60) : 5;
    const durTicks = secondsToTicks(durSec);
    if (u.kind === "video") {
      timeline.tracks.main.elements.push({
        id: `el_${randomUUID().slice(0, 8)}`,
        type: "video",
        name: (u.name || "Klip 1").slice(0, 120),
        assetId: u.id,
        startTime: 0 as Ticks,
        duration: durTicks,
        trimStart: 0 as Ticks,
        trimEnd: 0 as Ticks,
        sourceDuration: durTicks,
        transform: defaultTransform(),
        volume: 1,
        sourceAudio: true,
        speed: 1,
      });
    } else if (u.kind === "image") {
      timeline.tracks.main.elements.push({
        id: `el_${randomUUID().slice(0, 8)}`,
        type: "image",
        name: (u.name || "Görsel 1").slice(0, 120),
        assetId: u.id,
        startTime: 0 as Ticks,
        duration: durTicks,
        trimStart: 0 as Ticks,
        trimEnd: 0 as Ticks,
        transform: defaultTransform(),
      });
    }
    if (!input.title?.trim() && u.name) {
      defaultTitle = u.name.slice(0, 80);
    }
  }

  const project: StudioProject = {
    id: projectId,
    tenantId: input.tenantId,
    ownerUserId: input.ownerUserId,
    title: defaultTitle.slice(0, 120),
    campaignId: resolvedCampaignId,
    deliverableId: input.deliverableId ?? null,
    templateId: input.templateId ?? null,
    revision: 1,
    timeline,
    createdAt: now,
    updatedAt: now,
    lockedAt: null,
    submittedAssetId: null,
  };

  await prisma.$transaction([
    prisma.configValue.create({
      data: {
        key: projectKey(input.tenantId, projectId),
        value: project as unknown as Prisma.InputJsonValue,
        note: `Studio project (${input.tenantId})`,
      },
    }),
    prisma.configValue.create({
      data: {
        key: versionsKey(input.tenantId, projectId),
        value: [
          {
            id: `ver_${randomUUID().slice(0, 8)}`,
            revision: 1,
            label: input.templateId ? "Şablondan oluşturuldu" : "Başlangıç",
            createdAt: now,
            createdBy: input.ownerUserId,
            timeline,
          } satisfies StudioProjectVersion,
        ] as unknown as Prisma.InputJsonValue,
        note: `Studio versions (${input.tenantId})`,
      },
    }),
  ]);

  return project;
}

export async function updateStudioProjectMeta(
  tenantId: string,
  projectId: string,
  patch: { title?: string; campaignId?: string | null; deliverableId?: string | null },
): Promise<StudioProject> {
  const existing = await getStudioProject(tenantId, projectId);
  if (existing.lockedAt) {
    throw new DomainError("KURAL_IHLALI", "Teslim edilmiş proje üzerinde değişiklik yapılamaz.");
  }
  const updated: StudioProject = {
    ...existing,
    title: patch.title !== undefined ? patch.title.trim().slice(0, 120) || existing.title : existing.title,
    campaignId: patch.campaignId !== undefined ? patch.campaignId : existing.campaignId,
    deliverableId: patch.deliverableId !== undefined ? patch.deliverableId : existing.deliverableId,
    updatedAt: new Date().toISOString(),
  };
  await prisma.configValue.update({
    where: { key: projectKey(tenantId, projectId) },
    data: { value: updated as unknown as Prisma.InputJsonValue },
  });
  return updated;
}

export async function deleteStudioProject(tenantId: string, projectId: string): Promise<void> {
  await getStudioProject(tenantId, projectId);
  await prisma.configValue.deleteMany({
    where: { key: { in: [projectKey(tenantId, projectId), versionsKey(tenantId, projectId)] } },
  });
}

async function appendProjectVersion(
  tenantId: string,
  projectId: string,
  version: StudioProjectVersion,
): Promise<void> {
  const key = versionsKey(tenantId, projectId);
  const row = await prisma.configValue.findUnique({ where: { key } });
  const prev = Array.isArray(row?.value) ? (row.value as unknown as StudioProjectVersion[]) : [];
  const next = [version, ...prev].slice(0, MAX_VERSIONS_PER_PROJECT);
  await prisma.configValue.upsert({
    where: { key },
    create: { key, value: next as unknown as Prisma.InputJsonValue, note: `Studio versions (${tenantId})` },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
}

export async function saveStudioProjectTimeline(input: {
  tenantId: string;
  projectId: string;
  userId: string;
  expectedRevision: number;
  timeline: unknown;
  versionLabel?: string;
  createSnapshot?: boolean;
}): Promise<StudioProject> {
  const existing = await getStudioProject(input.tenantId, input.projectId);
  if (existing.lockedAt) {
    throw new DomainError("KURAL_IHLALI", "Bu proje teslim edildiği için düzenlemeye kapatıldı.");
  }
  if (existing.revision !== input.expectedRevision) {
    throw new DomainError("CAKISMA", "Proje başka bir sekmede veya oturumda güncellenmiş.", {
      currentRevision: existing.revision,
      updatedAt: existing.updatedAt,
    });
  }

  let parsed: StudioTimeline;
  try {
    parsed = studioTimelineSchema.parse(input.timeline);
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      throw new DomainError("DOGRULAMA", `Geçersiz zaman çizelgesi: ${issue?.path.join(".") || ""} ${issue?.message ?? ""}`.trim());
    }
    throw err;
  }

  assertLockedBrandLayersIntact(existing.timeline, parsed);

  const now = new Date().toISOString();
  const nextRevision = existing.revision + 1;
  const updated: StudioProject = {
    ...existing,
    revision: nextRevision,
    timeline: parsed,
    updatedAt: now,
  };

  await prisma.configValue.update({
    where: { key: projectKey(input.tenantId, input.projectId) },
    data: { value: updated as unknown as Prisma.InputJsonValue },
  });

  if (input.createSnapshot || input.versionLabel || nextRevision % 5 === 0) {
    await appendProjectVersion(input.tenantId, input.projectId, {
      id: `ver_${randomUUID().slice(0, 8)}`,
      revision: nextRevision,
      label: input.versionLabel?.trim().slice(0, 80) || `Revizyon #${nextRevision}`,
      createdAt: now,
      createdBy: input.userId,
      timeline: parsed,
    });
  }

  return updated;
}

export async function listStudioProjectVersions(tenantId: string, projectId: string): Promise<StudioProjectVersion[]> {
  await getStudioProject(tenantId, projectId);
  const row = await prisma.configValue.findUnique({ where: { key: versionsKey(tenantId, projectId) } });
  const list = Array.isArray(row?.value) ? (row.value as unknown as StudioProjectVersion[]) : [];
  return list;
}

export async function restoreStudioProjectVersion(input: {
  tenantId: string;
  projectId: string;
  userId: string;
  versionId: string;
}): Promise<StudioProject> {
  const existing = await getStudioProject(input.tenantId, input.projectId);
  if (existing.lockedAt) {
    throw new DomainError("KURAL_IHLALI", "Teslim edilmiş projede sürüm geri yüklenemez.");
  }
  const versions = await listStudioProjectVersions(input.tenantId, input.projectId);
  const target = versions.find((v) => v.id === input.versionId);
  if (!target) {
    throw new DomainError("BULUNAMADI", "Geri yüklenecek sürüm bulunamadı.");
  }
  const parsed = studioTimelineSchema.parse(target.timeline);
  assertLockedBrandLayersIntact(existing.timeline, parsed);

  const now = new Date().toISOString();
  const nextRevision = existing.revision + 1;
  const updated: StudioProject = {
    ...existing,
    revision: nextRevision,
    timeline: parsed,
    updatedAt: now,
  };

  await prisma.configValue.update({
    where: { key: projectKey(input.tenantId, input.projectId) },
    data: { value: updated as unknown as Prisma.InputJsonValue },
  });

  await appendProjectVersion(input.tenantId, input.projectId, {
    id: `ver_${randomUUID().slice(0, 8)}`,
    revision: nextRevision,
    label: `Geri yüklendi: ${target.label}`,
    createdAt: now,
    createdBy: input.userId,
    timeline: parsed,
  });

  return updated;
}

export async function getStudioConsent(tenantId: string, userId: string): Promise<StudioConsentRecord | null> {
  const row = await prisma.configValue.findUnique({ where: { key: consentKey(tenantId, userId) } });
  if (!row) return null;
  const rec = row.value as unknown as StudioConsentRecord;
  return rec && rec.version === CURRENT_CONSENT_VERSION ? rec : null;
}

export async function acceptStudioConsent(input: {
  tenantId: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<StudioConsentRecord> {
  const ipHash = input.ip ? createHash("sha256").update(input.ip).digest("hex").slice(0, 24) : null;
  const rec: StudioConsentRecord = {
    version: CURRENT_CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
    tenantId: input.tenantId,
    userId: input.userId,
    ipHash,
    userAgent: input.userAgent?.slice(0, 240) ?? null,
  };
  await prisma.configValue.upsert({
    where: { key: consentKey(input.tenantId, input.userId) },
    create: {
      key: consentKey(input.tenantId, input.userId),
      value: rec as unknown as Prisma.InputJsonValue,
      note: "KVKK m.9 yurt dışı aktarım onayı (fal.ai)",
    },
    update: { value: rec as unknown as Prisma.InputJsonValue },
  });
  return rec;
}

/**
 * Editörde dışa aktarılan videoyu kampanya / teslimat taslağı olarak gönderir (`Asset` oluşturur)
 * ve projeyi tekrar değişikliğe kapatır (`lockedAt`).
 */
export async function submitProjectRenderToCampaign(input: {
  tenantId: string;
  userId: string;
  projectId: string;
  uploadId: string;
  campaignId?: string | null;
  deliverableId?: string | null;
}): Promise<{ assetId: string; deliverableId: string | null; campaignId: string | null; lockedAt: string }> {
  const project = await getStudioProject(input.tenantId, input.projectId);
  if (project.lockedAt && project.submittedAssetId) {
    throw new DomainError("KURAL_IHLALI", "Bu proje zaten kampanyaya teslim edildi.");
  }

  const upload = await getOwnedUpload(input.tenantId, input.uploadId);
  const targetDeliverableId = input.deliverableId ?? project.deliverableId ?? null;
  let targetCampaignId = input.campaignId ?? project.campaignId ?? null;

  if (!targetDeliverableId && !targetCampaignId) {
    throw new DomainError("DOGRULAMA", "Teslim için kampanya veya teslimat seçilmelidir.");
  }

  if (targetDeliverableId) {
    const deliv = await prisma.deliverable.findUnique({
      where: { id: targetDeliverableId },
      include: { assignment: { include: { campaign: { select: { id: true, brandId: true } } } } },
    });
    if (!deliv) throw new DomainError("BULUNAMADI", "Teslimat bulunamadı.");
    const ok =
      isAgencyTenant(input.tenantId) ||
      deliv.assignment.influencerId === input.tenantId ||
      deliv.assignment.campaign.brandId === input.tenantId;
    if (!ok) throw new DomainError("YETKISIZ", "Bu teslimata dosya yükleme yetkiniz yok.");
    targetCampaignId = deliv.assignment.campaignId;
  } else if (targetCampaignId) {
    const camp = await prisma.campaign.findUnique({
      where: { id: targetCampaignId },
      select: { id: true, brandId: true },
    });
    if (!camp) throw new DomainError("BULUNAMADI", "Kampanya bulunamadı.");
    if (!isAgencyTenant(input.tenantId) && camp.brandId !== input.tenantId) {
      const assigned = await prisma.assignment.findFirst({
        where: { campaignId: camp.id, influencerId: input.tenantId },
        select: { id: true },
      });
      if (!assigned) throw new DomainError("YETKISIZ", "Bu kampanyaya dosya gönderme yetkiniz yok.");
    }
  }

  const safeName = `${project.title.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "taslak"}_${project.revision}.mp4`;
  const nowIso = new Date().toISOString();

  // Asset.key @unique olduğundan ve presignGet doğrudan S3 nesnesini indirdiğinden çıktıyı kalıcı asset yoluna kopyalarız.
  const assetKey = `assets/${targetCampaignId ?? input.tenantId}/${randomUUID()}-${safeName}`;
  await s3().send(
    new CopyObjectCommand({
      Bucket: bucket(),
      CopySource: `${bucket()}/${upload.s3Key}`,
      Key: assetKey,
    }),
  );

  const asset = await prisma.asset.create({
    data: {
      deliverableId: targetDeliverableId,
      campaignId: targetCampaignId,
      key: assetKey,
      fileName: safeName,
      mime: upload.mime,
      size: upload.sizeBytes,
      kind: "TASLAK",
      direction: "INFLUENCER_TO_AJANS",
      uploadedById: input.userId,
      uploadStatus: "TAMAM",
    },
  });

  const lockedProject: StudioProject = {
    ...project,
    campaignId: targetCampaignId,
    deliverableId: targetDeliverableId,
    lockedAt: nowIso,
    submittedAssetId: asset.id,
    updatedAt: nowIso,
  };
  await prisma.configValue.update({
    where: { key: projectKey(input.tenantId, input.projectId) },
    data: { value: lockedProject as unknown as Prisma.InputJsonValue },
  });

  return {
    assetId: asset.id,
    deliverableId: targetDeliverableId,
    campaignId: targetCampaignId,
    lockedAt: nowIso,
  };
}
