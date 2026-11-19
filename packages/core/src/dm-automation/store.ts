// Portions adapted from openreply (https://github.com/diwenne/openreply)
// Copyright (c) Anish Raj, Diwen Huang — MIT License. See THIRD_PARTY_NOTICES.md

import { randomUUID } from "node:crypto";
import type { Actor } from "../access/actor";
import { prisma, type Prisma } from "../db";
import { DomainError } from "../domain/errors";
import { envInt, envStr } from "../env";
import { vault } from "../channels/vault";
import { decryptMetaToken, encryptMetaToken } from "../inbox/meta-security";
import { detectOptOutKeyword } from "../inbox/rules";
import { publishInboxEvent } from "../inbox/store";
import {
  classifyDmDeliveryError,
  type ClassifiedDmDeliveryError,
} from "./delivery-errors";
import {
  matchKeyword,
  normalizeKeywordList,
  type KeywordMatchMode,
} from "./matcher";
import {
  dmMetaTransport,
  type DmButtonPayload,
  type IgMediaItem,
} from "./meta-api";
import {
  estimateQueueWait,
  getCircuitBreakerState,
  getHourlyRateLimitCap,
  getHourlyUsageCount,
  openCircuitBreaker,
  releaseDMSlot,
  reserveDMSlot,
} from "./rate-limiter";
import {
  appendCampaignUtm,
  buildTrackedShortUrl,
  createRecipientToken,
  DEFAULT_DM_FOOTER,
  formatDmMessage,
  generateTrackingSlug,
  hashClickIp,
  isBotUserAgent,
  isValidRecipientToken,
} from "./tracking";
import {
  parseInstagramWebhookPayload,
  type ParsedInstagramCommentEvent,
  type ParsedInstagramMessageEvent,
  type ParsedInstagramPostbackEvent,
} from "./webhook-parse";

export type DmTriggerMode = "SPECIFIC_POST" | "NEXT_REEL" | "ANY_POST";
export type DmCampaignStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ENDED" | "ACCOUNT_ISSUE";
export type DmRepeatPolicy = "NEVER" | "DAILY" | "ALWAYS";
export type DmTriggerSource = "WEBHOOK" | "POLLING" | "DM" | "POSTBACK";

export type DmLogStatus =
  | "PENDING"
  | "SENT"
  | "FAILED"
  | "UNCONFIRMED"
  | "SKIPPED_RATE_LIMIT"
  | "SKIPPED_EXPIRED"
  | "SKIPPED_NOT_ELIGIBLE"
  | "SKIPPED_DUPLICATE_RECIPIENT"
  | "SKIPPED_OPTED_OUT"
  | "SKIPPED_BLOCKED"
  | "SKIPPED_OWN_COMMENT"
  | "SKIPPED_CAMPAIGN_CAP"
  | "SKIPPED_PLAN_QUOTA"
  | "SKIPPED_OTHER_CAMPAIGN"
  | "SKIPPED_HUMAN_ACTIVE";

export const DM_LOG_STATUS_LABELS: Record<DmLogStatus, string> = {
  SENT: "Gönderildi",
  PENDING: "Sırada",
  FAILED: "Başarısız",
  UNCONFIRMED: "Belirsiz (tekrar denenmedi)",
  SKIPPED_RATE_LIMIT: "Saatlik limit, 3 deneme sonra atlandı",
  SKIPPED_EXPIRED: "7 gün geçti",
  SKIPPED_NOT_ELIGIBLE: "Instagram bu yoruma özel yanıta izin vermedi",
  SKIPPED_DUPLICATE_RECIPIENT: "Bu kişiye son 24 saatte gönderildi",
  SKIPPED_OPTED_OUT: "Kişi DUR yazdı",
  SKIPPED_BLOCKED: "Kişi Mesaj Kutusu'nda engelli",
  SKIPPED_OWN_COMMENT: "Hesabın kendi yorumu",
  SKIPPED_CAMPAIGN_CAP: "Kampanya gönderim tavanı doldu",
  SKIPPED_PLAN_QUOTA: "Aylık plan kotası doldu",
  SKIPPED_OTHER_CAMPAIGN: "Başka bir kampanya yanıtladı",
  SKIPPED_HUMAN_ACTIVE: "Son 24 saatte insan temsilci yanıtladı",
};

export type DmAccountRecord = {
  id: string; // ChannelConnection.id
  tenantId: string;
  igUserId: string;
  username: string;
  status: "CONNECTED" | "REAUTH_REQUIRED" | "WEBHOOK_MISSING" | "REVOKED";
  authMode: "OWN_OAUTH" | "PLATFORM_SYNCED" | "DEMO";
  autoLinked: boolean;
  scopes: string[];
  webhookSubscribed: boolean;
  tokenExpiresAt: string | null;
  breakerOpenUntil: string | null;
  pollPausedUntil: string | null;
  lastWebhookAt: string | null;
  lastError: string | null;
};

export type DmCampaignButton = {
  label: string;
  url: string;
  trackedLinkId: string;
  slug: string;
};

export type DmCampaignRecord = {
  id: string;
  tenantId: string;
  igAccountId: string; // DmAccountRecord.id
  igUserId: string;
  name: string;
  status: DmCampaignStatus;
  triggerMode: DmTriggerMode;
  mediaId: string | null;
  mediaPermalink: string | null;
  mediaThumbUrl: string | null;
  mediaCaption: string | null;
  pendingNextReel: boolean;
  dmTriggerEnabled: boolean;
  keywords: string[];
  matchMode: KeywordMatchMode;
  dmText: string;
  dmFooter: string;
  buttons: DmCampaignButton[];
  openingDmEnabled: boolean;
  openingDmText: string | null;
  openingDmButtonLabel: string | null;
  publicReplyEnabled: boolean;
  publicReplies: string[];
  nordvowCampaignId: string | null;
  couponId: string | null;
  couponCode: string | null;
  repeatPolicy: DmRepeatPolicy;
  sendCap: number | null;
  sentCount: number;
  startsAt: string | null;
  endsAt: string | null;
  complianceAckAt: string | null;
  complianceAckById: string | null;
  reportShareSlug: string | null;
  reportShareEnabled: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
};

export type DmCommentClaimRecord = {
  igAccountId: string;
  commentId: string;
  campaignId: string;
  createdAt: string;
};

export type DmLogRecord = {
  id: string;
  tenantId: string;
  campaignId: string;
  igAccountId: string;
  source: DmTriggerSource;
  commentId: string | null;
  triggerMessageId: string | null;
  recipientIgsid: string;
  recipientUsername: string | null;
  triggerText: string | null;
  matchedKeyword: string | null;
  commentCreatedAt: string | null;
  status: DmLogStatus;
  attempts: number;
  dmDeliveryUnconfirmed: boolean;
  dmMessageId: string | null;
  dmSentAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  publicReplyText: string | null;
  publicReplySentAt: string | null;
  publicReplyUnconfirmed: boolean;
  publicReplyError: string | null;
  requeueAttempt: number;
  createdAt: string;
  updatedAt: string;
};

export type DmOptOutRecord = {
  igAccountId: string;
  igsid: string;
  username?: string | null;
  keyword: string;
  createdAt: string;
};

export type DmTrackedLinkRecord = {
  id: string;
  tenantId: string;
  campaignId: string;
  slug: string;
  label: string | null;
  destination: string;
  position: number;
  createdAt: string;
};

export type DmLinkClickRecord = {
  id: string;
  tenantId: string;
  campaignId: string;
  linkId: string;
  recipientHash: string | null;
  ipHash: string | null;
  userAgent: string | null;
  referrer: string | null;
  isBot: boolean;
  createdAt: string;
};

export type DmDailyStatRecord = {
  campaignId: string;
  day: string; // YYYY-MM-DD
  triggers: number;
  sent: number;
  failed: number;
  skipped: number;
  clicks: number;
  uniqueClicks: number;
};

export type DmOperationalEvent = {
  id: string;
  level: "INFO" | "WARNING" | "ERROR";
  type: string;
  tenantId: string | null;
  details: Record<string, unknown>;
  bodyPreview?: string | null;
  createdAt: string;
};

export type DmWorkerHealth = {
  lastHeartbeatAt: string;
  queueDepth: number;
  lastProcessedAt: string | null;
  errorCountLastHour: number;
  healthy: boolean;
};

export type DmPlanTier = "starter" | "pro" | "agency";

export type DmPlanQuota = {
  tier: DmPlanTier;
  monthlyDmLimit: number;
  activeCampaignLimit: number;
  igAccountLimit: number;
};

export type DmRealtimeEvent = {
  id: string;
  tenantId: string;
  campaignId: string;
  type: "log.updated" | "campaign.updated" | "click.recorded";
  ts: number;
  payload: Record<string, unknown>;
};

const SEVEN_DAYS_MS = 7 * 24 * 3600_000;
const TWENTY_FOUR_HOURS_MS = 24 * 3600_000;

const tenantLocks = new Map<string, Promise<unknown>>();

async function withTenantLock<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  const prev = tenantLocks.get(tenantId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((r) => {
    release = r;
  });
  const chained = prev.then(() => current);
  tenantLocks.set(tenantId, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (tenantLocks.get(tenantId) === chained) {
      tenantLocks.delete(tenantId);
    }
  }
}

const dmEventBuffer = new Map<string, DmRealtimeEvent[]>();

export function publishDmRealtimeEvent(
  tenantId: string,
  campaignId: string,
  type: DmRealtimeEvent["type"],
  payload: Record<string, unknown> = {},
): DmRealtimeEvent {
  const ev: DmRealtimeEvent = {
    id: `dm_ev_${Date.now()}_${randomUUID().slice(0, 6)}`,
    tenantId,
    campaignId,
    type,
    ts: Date.now(),
    payload,
  };
  const key = `${tenantId}:${campaignId}`;
  const list = dmEventBuffer.get(key) ?? [];
  list.push(ev);
  if (list.length > 200) list.splice(0, list.length - 200);
  dmEventBuffer.set(key, list);
  return ev;
}

export function listDmRealtimeEventsAfter(
  tenantId: string,
  campaignId: string,
  afterTs: number,
): DmRealtimeEvent[] {
  const list = dmEventBuffer.get(`${tenantId}:${campaignId}`) ?? [];
  return list.filter((e) => e.ts > afterTs);
}

// ───────────── ConfigValue Anahtarları ─────────────

const keyAccountsMeta = (t: string) => `dm_auto:accounts:${t}`;
const keyCampaigns = (t: string) => `dm_auto:campaigns:${t}`;
const keyClaims = (t: string) => `dm_auto:claims:${t}`;
const keyLogs = (t: string) => `dm_auto:logs:${t}`;
const keyOptOuts = (t: string) => `dm_auto:optouts:${t}`;
const keyLinks = (t: string) => `dm_auto:links:${t}`;
const keyClicks = (t: string) => `dm_auto:clicks:${t}`;
const keyDaily = (t: string) => `dm_auto:daily:${t}`;
const keyUsage = (t: string) => `dm_auto:usage:${t}`;
const keyAudit = (t: string) => `dm_auto:audit:${t}`;
const keySlug = (slug: string) => `dm_auto:slug:${slug}`;
const keyShare = (shareSlug: string) => `dm_auto:share:${shareSlug}`;
const KEY_OPS_EVENTS = "dm_auto:ops_events";
const KEY_WORKER_HEALTH = "dm_auto:worker_health";
const KEY_ALLOWED_TENANTS_OVERRIDE = "dm_auto:allowed_tenants";

async function loadJson<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.configValue.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? fallback;
}

async function saveJson<T>(key: string, value: T, note?: string): Promise<void> {
  await prisma.configValue.upsert({
    where: { key },
    create: { key, value: value as unknown as Prisma.InputJsonValue, ...(note ? { note } : {}) },
    update: { value: value as unknown as Prisma.InputJsonValue },
  });
}

// ───────────── Özellik Bayrağı, Yetki ve Kotalar ─────────────

export function isDmAutomationEnabled(): boolean {
  return envStr("DM_AUTOMATION_ENABLED", "true") !== "false";
}

export async function isTenantAllowedForDmAutomation(tenantId: string): Promise<boolean> {
  if (!isDmAutomationEnabled()) return false;
  const rawList = envStr("DM_AUTOMATION_ALLOWED_TENANTS", "").trim();
  const overrides = await loadJson<Record<string, boolean>>(KEY_ALLOWED_TENANTS_OVERRIDE, {});
  if (typeof overrides[tenantId] === "boolean") {
    return overrides[tenantId]!;
  }
  if (!rawList) return true;
  const allowed = new Set(
    rawList
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return allowed.has(tenantId);
}

export async function setTenantDmAutomationOverride(tenantId: string, allowed: boolean): Promise<void> {
  const overrides = await loadJson<Record<string, boolean>>(KEY_ALLOWED_TENANTS_OVERRIDE, {});
  overrides[tenantId] = allowed;
  await saveJson(KEY_ALLOWED_TENANTS_OVERRIDE, overrides, "Tenant DM Automation override");
}

export async function getTenantDmQuota(tenantId: string): Promise<DmPlanQuota> {
  const custom = await loadJson<Partial<DmPlanQuota> | null>(`dm_auto:plan:${tenantId}`, null);
  const tier = (custom?.tier ?? envStr("DM_AUTOMATION_DEFAULT_TIER", "pro")) as DmPlanTier;
  const defaults: Record<DmPlanTier, DmPlanQuota> = {
    starter: {
      tier: "starter",
      monthlyDmLimit: envInt("DM_QUOTA_STARTER_MONTHLY", 1_000),
      activeCampaignLimit: envInt("DM_QUOTA_STARTER_CAMPAIGNS", 3),
      igAccountLimit: envInt("DM_QUOTA_STARTER_ACCOUNTS", 1),
    },
    pro: {
      tier: "pro",
      monthlyDmLimit: envInt("DM_QUOTA_PRO_MONTHLY", 10_000),
      activeCampaignLimit: envInt("DM_QUOTA_PRO_CAMPAIGNS", 20),
      igAccountLimit: envInt("DM_QUOTA_PRO_ACCOUNTS", 3),
    },
    agency: {
      tier: "agency",
      monthlyDmLimit: envInt("DM_QUOTA_AGENCY_MONTHLY", 50_000),
      activeCampaignLimit: envInt("DM_QUOTA_AGENCY_CAMPAIGNS", 100),
      igAccountLimit: envInt("DM_QUOTA_AGENCY_ACCOUNTS", 20),
    },
  };
  const base = defaults[tier] ?? defaults.pro;
  return {
    tier: base.tier,
    monthlyDmLimit: custom?.monthlyDmLimit ?? base.monthlyDmLimit,
    activeCampaignLimit: custom?.activeCampaignLimit ?? base.activeCampaignLimit,
    igAccountLimit: custom?.igAccountLimit ?? base.igAccountLimit,
  };
}

export type DmAccessAction = "view" | "edit" | "admin";

export async function assertDmAccess(
  actor: Actor,
  tenantId: string,
  action: DmAccessAction,
  target?: { campaignId?: string; igAccountId?: string },
): Promise<void> {
  if (!isDmAutomationEnabled()) {
    throw new DomainError("YETKISIZ", "DM Otomasyonu özelliği şu an devre dışı.");
  }
  if (!(await isTenantAllowedForDmAutomation(tenantId))) {
    throw new DomainError("YETKISIZ", "Bu özellik çalışma alanınızın mevcut planına dahil değil.");
  }
  if (actor.role === "BRAND" && actor.brandId !== tenantId) {
    throw new DomainError("BULUNAMADI", "Kayıt bulunamadı.");
  }
  if (actor.role === "INFLUENCER" && actor.influencerId !== tenantId) {
    throw new DomainError("BULUNAMADI", "Kayıt bulunamadı.");
  }
  if (action === "admin" && actor.role !== "ADMIN" && actor.role !== "BRAND" && actor.role !== "INFLUENCER") {
    throw new DomainError("YETKISIZ", "Bu işlem yalnızca çalışma alanı sahibi veya yönetici yetkisi gerektirir.");
  }
  if (action === "admin" && actor.staffRole === "AGENCY") {
    throw new DomainError("YETKISIZ", "Kişisel veri dışa aktarma veya hesap bağlantısı yalnızca yönetici/sahip içindir.");
  }

  if (target?.campaignId) {
    const campaigns = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
    if (!campaigns.some((c) => c.id === target.campaignId)) {
      throw new DomainError("BULUNAMADI", "DM Otomasyonu kampanyası bulunamadı.");
    }
  }
  if (target?.igAccountId) {
    const accounts = await listDmInstagramAccounts(tenantId);
    if (!accounts.some((a) => a.id === target.igAccountId)) {
      throw new DomainError("BULUNAMADI", "Instagram hesabı bulunamadı.");
    }
  }
}

export async function recordDmAudit(
  tenantId: string,
  actorId: string | null,
  action: string,
  targetId?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const prev = await loadJson<Record<string, unknown>[]>(keyAudit(tenantId), []);
  const entry = {
    id: `dm_aud_${randomUUID().slice(0, 8)}`,
    tenantId,
    actorId,
    action,
    targetId: targetId ?? null,
    meta: meta ?? {},
    createdAt: new Date().toISOString(),
  };
  await saveJson(keyAudit(tenantId), [entry, ...prev].slice(0, 300), "DM Automation audit log");
}

export async function recordOperationalEvent(input: {
  level: "INFO" | "WARNING" | "ERROR";
  type: string;
  tenantId?: string | null;
  details?: Record<string, unknown>;
  bodyPreview?: string | null;
}): Promise<void> {
  const prev = await loadJson<DmOperationalEvent[]>(KEY_OPS_EVENTS, []);
  const ev: DmOperationalEvent = {
    id: `ops_${randomUUID().slice(0, 8)}`,
    level: input.level,
    type: input.type,
    tenantId: input.tenantId ?? null,
    details: input.details ?? {},
    ...(input.bodyPreview ? { bodyPreview: input.bodyPreview.slice(0, 200) } : {}),
    createdAt: new Date().toISOString(),
  };
  await saveJson(KEY_OPS_EVENTS, [ev, ...prev].slice(0, 250), "DM Automation operational events");
}

export async function recordWorkerHeartbeat(stats?: Partial<Omit<DmWorkerHealth, "healthy" | "lastHeartbeatAt">>): Promise<DmWorkerHealth> {
  const prev = await loadJson<Omit<DmWorkerHealth, "healthy">>(KEY_WORKER_HEALTH, {
    lastHeartbeatAt: new Date().toISOString(),
    queueDepth: 0,
    lastProcessedAt: null,
    errorCountLastHour: 0,
  });
  const next = {
    lastHeartbeatAt: new Date().toISOString(),
    queueDepth: stats?.queueDepth ?? prev.queueDepth,
    lastProcessedAt: stats?.lastProcessedAt ?? prev.lastProcessedAt,
    errorCountLastHour: stats?.errorCountLastHour ?? prev.errorCountLastHour,
  };
  await saveJson(KEY_WORKER_HEALTH, next, "DM Automation worker heartbeat");
  return { ...next, healthy: true };
}

export async function getWorkerHealth(): Promise<DmWorkerHealth> {
  const raw = await loadJson<Omit<DmWorkerHealth, "healthy"> | null>(KEY_WORKER_HEALTH, null);
  if (!raw) {
    return {
      lastHeartbeatAt: new Date().toISOString(),
      queueDepth: 0,
      lastProcessedAt: null,
      errorCountLastHour: 0,
      healthy: true,
    };
  }
  const ageMs = Date.now() - new Date(raw.lastHeartbeatAt).getTime();
  return { ...raw, healthy: ageMs <= 120_000 };
}

// ───────────── Hesap Yönetimi (Mesaj Kutusu ile Paylaşımlı ChannelConnection) ─────────────

type AccountMetaMap = Record<
  string,
  {
    webhookSubscribed?: boolean;
    tokenExpiresAt?: string | null;
    tokenCiphertext?: string | null;
    breakerOpenUntil?: string | null;
    pollPausedUntil?: string | null;
    lastWebhookAt?: string | null;
    status?: DmAccountRecord["status"];
  }
>;

function slugifyInstagramFallback(name: string): string {
  const cleaned = name
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9._]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return cleaned || "nordvow.creator";
}

/**
 * Marka (/marka/kanallar & Mesaj Kutusu ChannelConnection) ve Influencer (SocialAccount)
 * üzerinde halihazırda bağlı olan Instagram hesabını DM Otomasyonu ile otomatik eşleştirir.
 */
async function syncConnectedInstagramAccountForDm(tenantId: string): Promise<void> {
  const [conns, socialIg, brand] = await Promise.all([
    prisma.channelConnection.findMany({
      where: { tenantId, provider: "INSTAGRAM", status: { not: "REVOKED" } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.socialAccount
      .findUnique({
        where: { influencerId_platform: { influencerId: tenantId, platform: "INSTAGRAM" } },
        select: { id: true, handle: true, externalId: true, tokenRef: true },
      })
      .catch(() => null),
    prisma.brand
      .findUnique({ where: { id: tenantId }, select: { name: true } })
      .catch(() => null),
  ]);

  // 1) Influencer'ın bağlı SocialAccount (INSTAGRAM) hesabı varsa otomatik ChannelConnection'a senkronize et.
  if (socialIg?.handle) {
    const cleanHandle = socialIg.handle.replace(/^@/, "").trim();
    const targetIgUserId = socialIg.externalId?.trim() || `ig_social_${socialIg.id}`;
    const hasOwnOAuth = conns.some((c) => {
      const ext = (c.externalIds ?? {}) as Record<string, unknown>;
      return !c.tokenRef.startsWith("demo:") && ext.source !== "social_account";
    });

    if (!hasOwnOAuth && cleanHandle) {
      const syncedOrDemo = conns.find((c) => {
        const ext = (c.externalIds ?? {}) as Record<string, unknown>;
        return c.tokenRef.startsWith("demo:") || ext.source === "social_account";
      });

      const nextExternalIds = {
        ig_user_id: targetIgUserId,
        ig_username: cleanHandle,
        account_type: "CREATOR",
        source: "social_account",
        social_account_id: socialIg.id,
      };
      const nextTokenRef = socialIg.tokenRef || "env:INSTAGRAM_ACCESS_TOKEN";

      if (syncedOrDemo) {
        const ext = (syncedOrDemo.externalIds ?? {}) as Record<string, unknown>;
        if (
          String(ext.ig_username ?? "") !== cleanHandle ||
          String(ext.ig_user_id ?? "") !== targetIgUserId ||
          syncedOrDemo.tokenRef.startsWith("demo:")
        ) {
          await prisma.channelConnection.update({
            where: { id: syncedOrDemo.id },
            data: {
              externalIds: nextExternalIds,
              tokenRef: nextTokenRef,
              status: "ACTIVE",
              lastVerifiedAt: new Date(),
            },
          });
        }
      } else {
        const created = await prisma.channelConnection.create({
          data: {
            tenantId,
            provider: "INSTAGRAM",
            externalIds: nextExternalIds,
            tokenRef: nextTokenRef,
            scopes: [
              "instagram_business_basic",
              "instagram_business_manage_messages",
              "instagram_business_manage_comments",
            ],
            status: "ACTIVE",
            connectedAt: new Date(),
            lastVerifiedAt: new Date(),
          },
        });
        const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(tenantId), {});
        if (!metaMap[created.id]) {
          metaMap[created.id] = { webhookSubscribed: true, status: "CONNECTED" };
          await saveJson(keyAccountsMeta(tenantId), metaMap);
        }
      }
    }
    return;
  }

  // 2) Marka: /marka/kanallar veya Mesaj Kutusu üzerinden bağlı ChannelConnection varsa kullanıcı adı + meta otomatik tamamlanır.
  if (brand && conns.length > 0) {
    const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(tenantId), {});
    let metaDirty = false;
    for (const c of conns) {
      const ext = (c.externalIds ?? {}) as Record<string, unknown>;
      const existingName = String(ext.ig_username ?? ext.username ?? ext.handle ?? "").trim();
      if (!existingName || existingName === "nordvow.creator") {
        await prisma.channelConnection.update({
          where: { id: c.id },
          data: {
            externalIds: {
              ...ext,
              ig_username: slugifyInstagramFallback(brand.name),
            },
          },
        });
      }
      if (!metaMap[c.id]) {
        metaMap[c.id] = { webhookSubscribed: true, status: "CONNECTED" };
        metaDirty = true;
      }
    }
    if (metaDirty) await saveJson(keyAccountsMeta(tenantId), metaMap);
  }
}

export async function listDmInstagramAccounts(tenantId: string): Promise<DmAccountRecord[]> {
  await syncConnectedInstagramAccountForDm(tenantId);
  await ensureInitialDmAutomationData(tenantId);
  const [conns, metaMap] = await Promise.all([
    prisma.channelConnection.findMany({
      where: { tenantId, provider: "INSTAGRAM" },
      orderBy: { createdAt: "desc" },
    }),
    loadJson<AccountMetaMap>(keyAccountsMeta(tenantId), {}),
  ]);

  return conns.map((c) => {
    const ext = (c.externalIds ?? {}) as Record<string, unknown>;
    const meta = metaMap[c.id] ?? {};
    const igUserId = String(ext.ig_user_id ?? ext.page_id ?? c.id);
    const username = String(ext.ig_username ?? ext.username ?? ext.handle ?? "nordvow.creator").replace(/^@/, "");
    const breaker = getCircuitBreakerState(igUserId);
    const status: DmAccountRecord["status"] =
      c.status === "REVOKED"
        ? "REVOKED"
        : meta.status === "REAUTH_REQUIRED" || c.status === "ERROR"
          ? "REAUTH_REQUIRED"
          : meta.webhookSubscribed === false
            ? "WEBHOOK_MISSING"
            : "CONNECTED";

    const isDemo = c.tokenRef.startsWith("demo:");
    const isSocialSynced = ext.source === "social_account" || c.tokenRef.startsWith("env:");
    const authMode: DmAccountRecord["authMode"] = isDemo
      ? "DEMO"
      : isSocialSynced
        ? "PLATFORM_SYNCED"
        : "OWN_OAUTH";
    const autoLinked = ext.source === "social_account" || (!isDemo && !meta.tokenCiphertext);

    return {
      id: c.id,
      tenantId,
      igUserId,
      username,
      status,
      authMode,
      autoLinked,
      scopes: c.scopes,
      webhookSubscribed: meta.webhookSubscribed ?? true,
      tokenExpiresAt: meta.tokenExpiresAt ?? null,
      breakerOpenUntil: breaker.openUntilMs ? new Date(breaker.openUntilMs).toISOString() : meta.breakerOpenUntil ?? null,
      pollPausedUntil: meta.pollPausedUntil ?? null,
      lastWebhookAt: meta.lastWebhookAt ?? null,
      lastError: c.lastError ?? null,
    };
  });
}

async function resolveAccountToken(tenantId: string, account: DmAccountRecord): Promise<string> {
  const conn = await prisma.channelConnection.findFirst({ where: { id: account.id, tenantId } });
  const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(tenantId), {});
  const meta = metaMap[account.id];
  if (meta?.tokenCiphertext) {
    try {
      return decryptMetaToken(meta.tokenCiphertext);
    } catch {
      /* fallback to vault */
    }
  }
  if (conn && !conn.tokenRef.startsWith("env:") && !conn.tokenRef.startsWith("demo:")) {
    const val = await vault().get(conn.tokenRef).catch(() => "");
    if (val) return val;
  }
  return (
    envStr("INSTAGRAM_ACCESS_TOKEN", "") ||
    envStr("META_IG_TOKEN", "") ||
    `demo_ig_token_${account.igUserId}`
  );
}

export async function connectDmInstagramAccount(input: {
  tenantId: string;
  actorId: string;
  code?: string;
  redirectUri?: string;
  igUserId?: string;
  igUsername?: string;
  accountType?: "BUSINESS" | "CREATOR" | "PERSONAL";
  accessToken?: string;
}): Promise<DmAccountRecord> {
  if (input.accountType === "PERSONAL") {
    throw new DomainError(
      "KURAL_IHLALI",
      "Bu özellik için profesyonel (İşletme/İçerik üretici) hesap gerekir. Instagram uygulamasında Ayarlar → Hesap türü → Profesyonel hesaba geçebilirsiniz.",
    );
  }

  const quota = await getTenantDmQuota(input.tenantId);
  const existing = await prisma.channelConnection.findMany({
    where: { tenantId: input.tenantId, provider: "INSTAGRAM", status: "ACTIVE" },
  });

  let token = input.accessToken ?? "";
  let igUserId = input.igUserId?.trim() ?? "";
  let resolvedUsername = input.igUsername?.trim() ?? "";
  let resolvedAccountType: "BUSINESS" | "CREATOR" | "PERSONAL" = input.accountType ?? "CREATOR";
  let expiresInSec = 5_184_000;

  if (input.code && !token) {
    const baseUrl = (envStr("APP_URL", "") || envStr("NEXT_PUBLIC_APP_URL", "https://nordvow.com")).replace(/\/$/, "");
    const exchanged = await dmMetaTransport().exchangeInstagramLoginCode({
      code: input.code,
      redirectUri: input.redirectUri ?? `${baseUrl}/dashboard/dm-otomasyonu`,
    });
    token = exchanged.accessToken;
    igUserId ||= exchanged.userId;
    if (exchanged.username) resolvedUsername ||= exchanged.username;
    if (exchanged.accountType) resolvedAccountType = exchanged.accountType;
    expiresInSec = exchanged.expiresInSeconds;
  }

  if (resolvedAccountType === "PERSONAL") {
    throw new DomainError(
      "KURAL_IHLALI",
      "Bu özellik için profesyonel (İşletme/İçerik üretici) hesap gerekir. Instagram uygulamasında Ayarlar → Hesap türü → Profesyonel hesaba geçebilirsiniz.",
    );
  }

  if (!igUserId) {
    throw new DomainError("DOGRULAMA", "Instagram profesyonel hesap ID'si gereklidir.");
  }

  const sameConn = existing.find((c) => {
    const ext = (c.externalIds ?? {}) as Record<string, unknown>;
    return (
      String(ext.ig_user_id ?? "") === igUserId ||
      c.tokenRef.startsWith("demo:") ||
      ext.source === "social_account"
    );
  });

  if (!sameConn && existing.length >= quota.igAccountLimit) {
    throw new DomainError("KURAL_IHLALI", `Mevcut planınızda en fazla ${quota.igAccountLimit} Instagram hesabı bağlayabilirsiniz.`);
  }

  const finalToken = token || `ig_token_${randomUUID().slice(0, 10)}`;
  const tokenRef = await vault().put(input.tenantId, "instagram", finalToken);
  const encryptedToken = encryptMetaToken(finalToken);
  const combinedScopes = [
    "instagram_business_basic",
    "instagram_business_manage_messages",
    "instagram_business_manage_comments",
  ];
  const username = (resolvedUsername || `ig_${igUserId.slice(-6)}`).replace(/^@/, "");

  // Ortak webhook abonelik alanları (Mesaj Kutusu ile birleşik)
  let webhookSubscribed = true;
  try {
    await dmMetaTransport().subscribeAppFields({
      igUserId,
      token: finalToken,
      fields: ["comments", "messages", "messaging_postbacks", "message_reactions", "messaging_seen"],
    });
  } catch {
    webhookSubscribed = false;
  }

  const conn = sameConn
    ? await prisma.channelConnection.update({
        where: { id: sameConn.id },
        data: {
          externalIds: { ig_user_id: igUserId, ig_username: username, account_type: input.accountType ?? "CREATOR" },
          tokenRef,
          scopes: [...new Set([...sameConn.scopes, ...combinedScopes])],
          status: "ACTIVE",
          lastVerifiedAt: new Date(),
          lastError: null,
        },
      })
    : await prisma.channelConnection.create({
        data: {
          tenantId: input.tenantId,
          provider: "INSTAGRAM",
          externalIds: { ig_user_id: igUserId, ig_username: username, account_type: input.accountType ?? "CREATOR" },
          tokenRef,
          scopes: combinedScopes,
          status: "ACTIVE",
          connectedAt: new Date(),
          lastVerifiedAt: new Date(),
        },
      });

  const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(input.tenantId), {});
  metaMap[conn.id] = {
    webhookSubscribed,
    tokenExpiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    tokenCiphertext: encryptedToken,
    status: webhookSubscribed ? "CONNECTED" : "WEBHOOK_MISSING",
  };
  await saveJson(keyAccountsMeta(input.tenantId), metaMap, "DM Automation IG accounts meta");
  await recordDmAudit(input.tenantId, input.actorId, "account.connect", conn.id, { igUserId, username });

  const accounts = await listDmInstagramAccounts(input.tenantId);
  return accounts.find((a) => a.id === conn.id)!;
}

export async function disconnectDmInstagramAccount(
  tenantId: string,
  accountId: string,
  actorId: string,
  wipeAllData = false,
): Promise<{ disconnected: true; wiped: boolean }> {
  const conn = await prisma.channelConnection.findFirst({ where: { id: accountId, tenantId, provider: "INSTAGRAM" } });
  if (!conn) throw new DomainError("BULUNAMADI", "Instagram hesabı bulunamadı.");

  await vault().remove(conn.tokenRef).catch(() => undefined);
  await prisma.channelConnection.update({
    where: { id: conn.id },
    data: { status: "REVOKED", revokedAt: new Date(), lastError: "Kullanıcı bağlantıyı kesti." },
  });

  await withTenantLock(tenantId, async () => {
    const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(tenantId), {});
    if (metaMap[conn.id]) {
      metaMap[conn.id] = { ...metaMap[conn.id], tokenCiphertext: null, status: "REVOKED", webhookSubscribed: false };
      await saveJson(keyAccountsMeta(tenantId), metaMap);
    }

    const campaigns = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
    let changed = false;
    for (const c of campaigns) {
      if (c.igAccountId === conn.id && c.status !== "ENDED") {
        c.status = "ENDED";
        c.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await saveJson(keyCampaigns(tenantId), campaigns);

    if (wipeAllData) {
      const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
      await saveJson(keyLogs(tenantId), logs.filter((l) => l.igAccountId !== conn.id));
    }
  });

  await recordDmAudit(tenantId, actorId, "account.disconnect", conn.id, { wipeAllData });
  return { disconnected: true, wiped: wipeAllData };
}

export async function listIgAccountMedia(
  tenantId: string,
  accountId: string,
  cursor?: string,
): Promise<{ items: IgMediaItem[]; nextCursor: string | null }> {
  const accounts = await listDmInstagramAccounts(tenantId);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new DomainError("BULUNAMADI", "Instagram hesabı bulunamadı.");
  const token = await resolveAccountToken(tenantId, account);
  return dmMetaTransport().listMedia({
    igUserId: account.igUserId,
    token,
    limit: 25,
    after: cursor,
  });
}

// ───────────── Kampanya CRUD & Aktivasyon ─────────────

function makeCampaignSlug(name: string): string {
  const base = name
    .toLocaleLowerCase("tr-TR")
    .replace(/[ışğüöç]/g, (ch) => ({ ı: "i", ş: "s", ğ: "g", ü: "u", ö: "o", ç: "c" })[ch] ?? ch)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
  return base || "dm-kampanya";
}

async function syncCampaignTrackedLinks(
  tenantId: string,
  campaignId: string,
  campaignName: string,
  rawButtons: { label: string; url: string }[],
): Promise<DmCampaignButton[]> {
  if (rawButtons.length > 3) {
    throw new DomainError("DOGRULAMA", "En fazla 3 link butonu ekleyebilirsiniz.");
  }

  const allLinks = await loadJson<DmTrackedLinkRecord[]>(keyLinks(tenantId), []);
  const existingForCampaign = allLinks.filter((l) => l.campaignId === campaignId);
  const remaining = allLinks.filter((l) => l.campaignId !== campaignId);

  const campaignSlug = makeCampaignSlug(campaignName);
  const newCampaignLinks: DmTrackedLinkRecord[] = [];
  const resultButtons: DmCampaignButton[] = [];

  for (let i = 0; i < rawButtons.length; i++) {
    const b = rawButtons[i]!;
    const label = b.label.trim().slice(0, 20);
    if (!label) throw new DomainError("DOGRULAMA", "Buton etiketi boş olamaz.");
    let finalDest: string;
    try {
      finalDest = appendCampaignUtm(b.url, campaignSlug, campaignId);
    } catch (e) {
      throw new DomainError("DOGRULAMA", (e as Error).message);
    }

    const prev = existingForCampaign[i];
    const slug = prev?.slug ?? generateTrackingSlug(9);
    const id = prev?.id ?? `dml_${randomUUID().slice(0, 10)}`;
    const linkRec: DmTrackedLinkRecord = {
      id,
      tenantId,
      campaignId,
      slug,
      label,
      destination: finalDest,
      position: i,
      createdAt: prev?.createdAt ?? new Date().toISOString(),
    };
    newCampaignLinks.push(linkRec);
    await saveJson(
      keySlug(slug),
      { tenantId, campaignId, linkId: id, destination: finalDest, position: i },
      "DM Automation tracked link index",
    );
    resultButtons.push({
      label,
      url: finalDest,
      trackedLinkId: id,
      slug,
    });
  }

  await saveJson(keyLinks(tenantId), [...remaining, ...newCampaignLinks]);
  return resultButtons;
}

export type CreateDmCampaignInput = {
  tenantId: string;
  actorId: string;
  igAccountId: string;
  name: string;
  triggerMode: DmTriggerMode;
  mediaId?: string | null;
  mediaPermalink?: string | null;
  mediaThumbUrl?: string | null;
  mediaCaption?: string | null;
  dmTriggerEnabled?: boolean;
  keywords: string[];
  matchMode: KeywordMatchMode;
  dmText: string;
  dmFooter?: string | null;
  buttons?: { label: string; url: string }[];
  openingDmEnabled?: boolean;
  openingDmText?: string | null;
  openingDmButtonLabel?: string | null;
  publicReplyEnabled?: boolean;
  publicReplies?: string[];
  nordvowCampaignId?: string | null;
  couponId?: string | null;
  couponCode?: string | null;
  repeatPolicy?: DmRepeatPolicy;
  sendCap?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
};

export async function createDmCampaign(input: CreateDmCampaignInput): Promise<DmCampaignRecord> {
  const accounts = await listDmInstagramAccounts(input.tenantId);
  const account =
    accounts.find((a) => a.id === input.igAccountId) ??
    accounts.find((a) => a.status === "CONNECTED") ??
    accounts[0];
  if (!account) throw new DomainError("BULUNAMADI", "Bağlı Instagram hesabı bulunamadı.");

  const dmText = input.dmText.trim();
  if (!dmText || dmText.length > 640) {
    throw new DomainError("DOGRULAMA", "DM metni 1 ile 640 karakter arasında olmalıdır.");
  }

  const dmFooter = (input.dmFooter?.trim() || DEFAULT_DM_FOOTER).trim();
  if (!dmFooter.toLocaleLowerCase("tr-TR").includes("dur")) {
    throw new DomainError("DOGRULAMA", "Zorunlu bilgilendirme satırı 'DUR' opt-out talimatını içermelidir.");
  }

  const keywords = normalizeKeywordList(input.keywords);
  if (input.matchMode !== "ANY_COMMENT" && keywords.length === 0) {
    throw new DomainError("DOGRULAMA", "En az 1 anahtar kelime ekleyin veya 'Her yorum' modunu seçin.");
  }

  let couponCode = input.couponCode?.trim() || null;
  if (input.couponId && !couponCode) {
    const coupon = await prisma.coupon.findFirst({
      where: { id: input.couponId, tenantId: input.tenantId },
      select: { sharedCode: true, title: true },
    });
    if (coupon?.sharedCode) couponCode = coupon.sharedCode;
  }

  const id = `dmc_${randomUUID().slice(0, 12)}`;
  const nowIso = new Date().toISOString();

  return withTenantLock(input.tenantId, async () => {
    const buttons = await syncCampaignTrackedLinks(input.tenantId, id, input.name, input.buttons ?? []);
    const record: DmCampaignRecord = {
      id,
      tenantId: input.tenantId,
      igAccountId: account.id,
      igUserId: account.igUserId,
      name: input.name.trim(),
      status: "DRAFT",
      triggerMode: input.triggerMode,
      mediaId: input.triggerMode === "SPECIFIC_POST" ? input.mediaId ?? null : null,
      mediaPermalink: input.triggerMode === "SPECIFIC_POST" ? input.mediaPermalink ?? null : null,
      mediaThumbUrl: input.triggerMode === "SPECIFIC_POST" ? input.mediaThumbUrl ?? null : null,
      mediaCaption: input.triggerMode === "SPECIFIC_POST" ? input.mediaCaption ?? null : null,
      pendingNextReel: input.triggerMode === "NEXT_REEL",
      dmTriggerEnabled: Boolean(input.dmTriggerEnabled),
      keywords,
      matchMode: input.matchMode,
      dmText,
      dmFooter,
      buttons,
      openingDmEnabled: Boolean(input.openingDmEnabled),
      openingDmText: input.openingDmText?.trim() || null,
      openingDmButtonLabel: input.openingDmButtonLabel?.trim().slice(0, 20) || "Kodu göster",
      publicReplyEnabled: Boolean(input.publicReplyEnabled),
      publicReplies: (input.publicReplies ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 10),
      nordvowCampaignId: input.nordvowCampaignId ?? null,
      couponId: input.couponId ?? null,
      couponCode,
      repeatPolicy: input.repeatPolicy ?? "DAILY",
      sendCap: input.sendCap && input.sendCap > 0 ? input.sendCap : null,
      sentCount: 0,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      complianceAckAt: null,
      complianceAckById: null,
      reportShareSlug: null,
      reportShareEnabled: false,
      createdById: input.actorId,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    const all = await loadJson<DmCampaignRecord[]>(keyCampaigns(input.tenantId), []);
    await saveJson(keyCampaigns(input.tenantId), [record, ...all], "DM Automation campaigns");
    await recordDmAudit(input.tenantId, input.actorId, "campaign.create", record.id, { name: record.name });
    return record;
  });
}

export async function updateDmCampaign(
  tenantId: string,
  campaignId: string,
  actorId: string,
  patch: Partial<Omit<CreateDmCampaignInput, "tenantId" | "actorId" | "igAccountId">>,
): Promise<DmCampaignRecord> {
  return withTenantLock(tenantId, async () => {
    const all = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
    const idx = all.findIndex((c) => c.id === campaignId);
    if (idx === -1) throw new DomainError("BULUNAMADI", "DM Otomasyonu kampanyası bulunamadı.");
    const cur = all[idx]!;

    const nextName = patch.name?.trim() || cur.name;
    const nextDmText = patch.dmText !== undefined ? patch.dmText.trim() : cur.dmText;
    if (!nextDmText || nextDmText.length > 640) {
      throw new DomainError("DOGRULAMA", "DM metni 1 ile 640 karakter arasında olmalıdır.");
    }
    const nextFooter = patch.dmFooter !== undefined ? patch.dmFooter?.trim() || DEFAULT_DM_FOOTER : cur.dmFooter;
    if (!nextFooter.toLocaleLowerCase("tr-TR").includes("dur")) {
      throw new DomainError("DOGRULAMA", "Bilgilendirme satırı 'DUR' opt-out talimatını içermelidir.");
    }

    const nextButtons =
      patch.buttons !== undefined
        ? await syncCampaignTrackedLinks(tenantId, cur.id, nextName, patch.buttons)
        : cur.buttons;

    const updated: DmCampaignRecord = {
      ...cur,
      name: nextName,
      triggerMode: patch.triggerMode ?? cur.triggerMode,
      mediaId: patch.mediaId !== undefined ? patch.mediaId : cur.mediaId,
      mediaPermalink: patch.mediaPermalink !== undefined ? patch.mediaPermalink : cur.mediaPermalink,
      mediaThumbUrl: patch.mediaThumbUrl !== undefined ? patch.mediaThumbUrl : cur.mediaThumbUrl,
      mediaCaption: patch.mediaCaption !== undefined ? patch.mediaCaption : cur.mediaCaption,
      pendingNextReel:
        patch.triggerMode === "NEXT_REEL"
          ? true
          : patch.triggerMode !== undefined
            ? false
            : cur.pendingNextReel,
      dmTriggerEnabled: patch.dmTriggerEnabled ?? cur.dmTriggerEnabled,
      keywords: patch.keywords !== undefined ? normalizeKeywordList(patch.keywords) : cur.keywords,
      matchMode: patch.matchMode ?? cur.matchMode,
      dmText: nextDmText,
      dmFooter: nextFooter,
      buttons: nextButtons,
      openingDmEnabled: patch.openingDmEnabled ?? cur.openingDmEnabled,
      openingDmText: patch.openingDmText !== undefined ? patch.openingDmText : cur.openingDmText,
      openingDmButtonLabel: patch.openingDmButtonLabel !== undefined ? patch.openingDmButtonLabel : cur.openingDmButtonLabel,
      publicReplyEnabled: patch.publicReplyEnabled ?? cur.publicReplyEnabled,
      publicReplies:
        patch.publicReplies !== undefined
          ? patch.publicReplies.map((r) => r.trim()).filter(Boolean).slice(0, 10)
          : cur.publicReplies,
      nordvowCampaignId: patch.nordvowCampaignId !== undefined ? patch.nordvowCampaignId : cur.nordvowCampaignId,
      couponId: patch.couponId !== undefined ? patch.couponId : cur.couponId,
      couponCode: patch.couponCode !== undefined ? patch.couponCode : cur.couponCode,
      repeatPolicy: patch.repeatPolicy ?? cur.repeatPolicy,
      sendCap: patch.sendCap !== undefined ? patch.sendCap : cur.sendCap,
      startsAt: patch.startsAt !== undefined ? patch.startsAt : cur.startsAt,
      endsAt: patch.endsAt !== undefined ? patch.endsAt : cur.endsAt,
      updatedAt: new Date().toISOString(),
    };

    all[idx] = updated;
    await saveJson(keyCampaigns(tenantId), all);
    await recordDmAudit(tenantId, actorId, "campaign.update", cur.id);
    publishDmRealtimeEvent(tenantId, cur.id, "campaign.updated", { status: updated.status });
    return updated;
  });
}

export async function activateDmCampaign(
  tenantId: string,
  campaignId: string,
  actorId: string,
  compliance: { instructionAck: boolean; adDisclosureAck: boolean; contentMatchAck: boolean },
): Promise<DmCampaignRecord> {
  if (!compliance.instructionAck || !compliance.adDisclosureAck || !compliance.contentMatchAck) {
    throw new DomainError("DOGRULAMA", "Kampanyayı başlatmak için tüm uyum kontrol kutularını onaylamalısınız.");
  }

  return withTenantLock(tenantId, async () => {
    const all = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
    const idx = all.findIndex((c) => c.id === campaignId);
    if (idx === -1) throw new DomainError("BULUNAMADI", "DM Otomasyonu kampanyası bulunamadı.");
    const cur = all[idx]!;

    const accounts = await listDmInstagramAccounts(tenantId);
    const account = accounts.find((a) => a.id === cur.igAccountId);
    if (!account || account.status === "REVOKED" || account.status === "REAUTH_REQUIRED") {
      throw new DomainError("KURAL_IHLALI", "Instagram hesabı bağlı değil veya yeniden yetkilendirme gerekiyor.");
    }
    if (!account.webhookSubscribed) {
      throw new DomainError("KURAL_IHLALI", "Instagram bildirimlerine abone olunamadı, bağlantıyı yenileyip tekrar deneyin.");
    }

    const quota = await getTenantDmQuota(tenantId);
    const activeCount = all.filter((c) => c.status === "ACTIVE" && c.id !== cur.id).length;
    if (activeCount >= quota.activeCampaignLimit) {
      throw new DomainError("KURAL_IHLALI", `Mevcut planınızda en fazla ${quota.activeCampaignLimit} aktif otomasyon çalıştırabilirsiniz.`);
    }

    if (cur.triggerMode === "SPECIFIC_POST" && !cur.mediaId) {
      throw new DomainError("DOGRULAMA", "Belirli bir gönderi veya Reel seçmelisiniz.");
    }
    if (cur.matchMode !== "ANY_COMMENT" && cur.keywords.length === 0) {
      throw new DomainError("DOGRULAMA", "En az 1 anahtar kelime eklemelisiniz.");
    }

    const nowIso = new Date().toISOString();
    const updated: DmCampaignRecord = {
      ...cur,
      status: "ACTIVE",
      complianceAckAt: nowIso,
      complianceAckById: actorId,
      updatedAt: nowIso,
    };
    all[idx] = updated;
    await saveJson(keyCampaigns(tenantId), all);
    await recordDmAudit(tenantId, actorId, "campaign.activate", cur.id);
    publishDmRealtimeEvent(tenantId, cur.id, "campaign.updated", { status: "ACTIVE" });
    return updated;
  });
}

export async function pauseDmCampaign(tenantId: string, campaignId: string, actorId: string): Promise<DmCampaignRecord> {
  return withTenantLock(tenantId, async () => {
    const all = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
    const idx = all.findIndex((c) => c.id === campaignId);
    if (idx === -1) throw new DomainError("BULUNAMADI", "DM Otomasyonu kampanyası bulunamadı.");
    const cur = all[idx]!;
    const updated: DmCampaignRecord = { ...cur, status: "PAUSED", updatedAt: new Date().toISOString() };
    all[idx] = updated;
    await saveJson(keyCampaigns(tenantId), all);
    await recordDmAudit(tenantId, actorId, "campaign.pause", cur.id);
    publishDmRealtimeEvent(tenantId, cur.id, "campaign.updated", { status: "PAUSED" });
    return updated;
  });
}

export async function duplicateDmCampaign(tenantId: string, campaignId: string, actorId: string): Promise<DmCampaignRecord> {
  const all = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
  const src = all.find((c) => c.id === campaignId);
  if (!src) throw new DomainError("BULUNAMADI", "DM Otomasyonu kampanyası bulunamadı.");
  return createDmCampaign({
    tenantId,
    actorId,
    igAccountId: src.igAccountId,
    name: `${src.name} (Kopya)`,
    triggerMode: src.triggerMode,
    mediaId: src.mediaId,
    mediaPermalink: src.mediaPermalink,
    mediaThumbUrl: src.mediaThumbUrl,
    mediaCaption: src.mediaCaption,
    dmTriggerEnabled: src.dmTriggerEnabled,
    keywords: src.keywords,
    matchMode: src.matchMode,
    dmText: src.dmText,
    dmFooter: src.dmFooter,
    buttons: src.buttons.map((b) => ({ label: b.label, url: b.url })),
    openingDmEnabled: src.openingDmEnabled,
    openingDmText: src.openingDmText,
    openingDmButtonLabel: src.openingDmButtonLabel,
    publicReplyEnabled: src.publicReplyEnabled,
    publicReplies: src.publicReplies,
    nordvowCampaignId: src.nordvowCampaignId,
    couponId: src.couponId,
    couponCode: src.couponCode,
    repeatPolicy: src.repeatPolicy,
    sendCap: src.sendCap,
  });
}

export async function deleteDmCampaign(tenantId: string, campaignId: string, actorId: string): Promise<{ deleted: true }> {
  return withTenantLock(tenantId, async () => {
    const all = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
    const target = all.find((c) => c.id === campaignId);
    if (!target) throw new DomainError("BULUNAMADI", "DM Otomasyonu kampanyası bulunamadı.");
    await saveJson(keyCampaigns(tenantId), all.filter((c) => c.id !== campaignId));
    await recordDmAudit(tenantId, actorId, "campaign.delete", campaignId, { name: target.name });
    return { deleted: true };
  });
}

export async function toggleCampaignShareReport(
  tenantId: string,
  campaignId: string,
  actorId: string,
  enabled: boolean,
): Promise<{ reportShareSlug: string | null; reportShareEnabled: boolean }> {
  return withTenantLock(tenantId, async () => {
    const all = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
    const idx = all.findIndex((c) => c.id === campaignId);
    if (idx === -1) throw new DomainError("BULUNAMADI", "Kampanya bulunamadı.");
    const cur = all[idx]!;
    const shareSlug = enabled ? cur.reportShareSlug ?? generateTrackingSlug(10) : cur.reportShareSlug;
    all[idx] = { ...cur, reportShareSlug: shareSlug, reportShareEnabled: enabled, updatedAt: new Date().toISOString() };
    await saveJson(keyCampaigns(tenantId), all);
    if (shareSlug) {
      await saveJson(keyShare(shareSlug), enabled ? { tenantId, campaignId } : null);
    }
    await recordDmAudit(tenantId, actorId, enabled ? "campaign.share.enable" : "campaign.share.disable", campaignId);
    return { reportShareSlug: shareSlug, reportShareEnabled: enabled };
  });
}

// ───────────── Sayım, Huni İstatistikleri ve Kampanya Listeleme ─────────────

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

async function bumpDailyStat(
  tenantId: string,
  campaignId: string,
  d: Date,
  delta: Partial<Record<"triggers" | "sent" | "failed" | "skipped" | "clicks" | "uniqueClicks", number>>,
) {
  const daily = await loadJson<Record<string, DmDailyStatRecord>>(keyDaily(tenantId), {});
  const day = dayKey(d);
  const k = `${campaignId}:${day}`;
  const cur = daily[k] ?? {
    campaignId,
    day,
    triggers: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    clicks: 0,
    uniqueClicks: 0,
  };
  daily[k] = {
    ...cur,
    triggers: cur.triggers + (delta.triggers ?? 0),
    sent: cur.sent + (delta.sent ?? 0),
    failed: cur.failed + (delta.failed ?? 0),
    skipped: cur.skipped + (delta.skipped ?? 0),
    clicks: cur.clicks + (delta.clicks ?? 0),
    uniqueClicks: cur.uniqueClicks + (delta.uniqueClicks ?? 0),
  };
  await saveJson(keyDaily(tenantId), daily);
}

async function incrementMonthlyUsage(tenantId: string, d = new Date()): Promise<number> {
  const usage = await loadJson<Record<string, number>>(keyUsage(tenantId), {});
  const mk = monthKey(d);
  const next = (usage[mk] ?? 0) + 1;
  usage[mk] = next;
  await saveJson(keyUsage(tenantId), usage);
  return next;
}

export async function getMonthlyUsage(tenantId: string, d = new Date()): Promise<number> {
  const usage = await loadJson<Record<string, number>>(keyUsage(tenantId), {});
  return usage[monthKey(d)] ?? 0;
}

export async function listDmCampaignsWithSummary(tenantId: string, statusFilter?: DmCampaignStatus) {
  await ensureInitialDmAutomationData(tenantId);
  const [campaigns, logs, clicks, accounts, quota, monthlyUsed, workerHealth] = await Promise.all([
    loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []),
    loadJson<DmLogRecord[]>(keyLogs(tenantId), []),
    loadJson<DmLinkClickRecord[]>(keyClicks(tenantId), []),
    listDmInstagramAccounts(tenantId),
    getTenantDmQuota(tenantId),
    getMonthlyUsage(tenantId),
    getWorkerHealth(),
  ]);

  const cutoff24h = Date.now() - TWENTY_FOUR_HOURS_MS;
  const enriched = campaigns
    .filter((c) => !statusFilter || c.status === statusFilter)
    .map((c) => {
      const cLogs = logs.filter((l) => l.campaignId === c.id);
      const logs24h = cLogs.filter((l) => new Date(l.createdAt).getTime() >= cutoff24h);
      const clicks24h = clicks.filter((cl) => cl.campaignId === c.id && !cl.isBot && new Date(cl.createdAt).getTime() >= cutoff24h);
      const sent24h = logs24h.filter((l) => l.status === "SENT").length;
      const queuedCount = cLogs.filter((l) => l.status === "PENDING").length;
      const uniqueClickKeys = new Set(clicks24h.map((cl) => cl.recipientHash ?? cl.ipHash ?? cl.id));
      const ctr = sent24h > 0 ? Math.round((uniqueClickKeys.size / sent24h) * 100) : 0;

      return {
        ...c,
        metrics24h: {
          triggers: logs24h.length,
          sent: sent24h,
          queued: queuedCount,
          clicks: clicks24h.length,
          uniqueClicks: uniqueClickKeys.size,
          ctrPercent: ctr,
        },
      };
    });

  const totalQueued = logs.filter((l) => l.status === "PENDING").length;
  const hourlyCap = getHourlyRateLimitCap();
  const hourlyUsed = accounts.reduce((sum, a) => sum + getHourlyUsageCount(a.igUserId), 0);

  return {
    campaigns: enriched,
    accounts,
    quota,
    monthlyUsed,
    hourlyCap,
    hourlyUsed,
    queueStatus: {
      queuedCount: totalQueued,
      estimate: estimateQueueWait(totalQueued, hourlyCap),
    },
    workerHealth,
  };
}

export async function getDmCampaignStats(tenantId: string, campaignId: string) {
  const [campaigns, logs, clicks, links, dailyMap] = await Promise.all([
    loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []),
    loadJson<DmLogRecord[]>(keyLogs(tenantId), []),
    loadJson<DmLinkClickRecord[]>(keyClicks(tenantId), []),
    loadJson<DmTrackedLinkRecord[]>(keyLinks(tenantId), []),
    loadJson<Record<string, DmDailyStatRecord>>(keyDaily(tenantId), {}),
  ]);
  const campaign = campaigns.find((c) => c.id === campaignId);
  if (!campaign) throw new DomainError("BULUNAMADI", "Kampanya bulunamadı.");

  const cLogs = logs.filter((l) => l.campaignId === campaignId);
  const cClicks = clicks.filter((cl) => cl.campaignId === campaignId && !cl.isBot);
  const cLinks = links.filter((l) => l.campaignId === campaignId).sort((a, b) => a.position - b.position);

  const sentCount = cLogs.filter((l) => l.status === "SENT").length;
  const failedCount = cLogs.filter((l) => l.status === "FAILED" || l.status === "UNCONFIRMED").length;
  const pendingCount = cLogs.filter((l) => l.status === "PENDING").length;
  const uniqueKeys = new Set(cClicks.map((cl) => cl.recipientHash ?? cl.ipHash ?? cl.id));

  let couponRedeemedCount = 0;
  if (campaign.couponId) {
    couponRedeemedCount = await prisma.couponGrant.count({
      where: { couponId: campaign.couponId, status: "KULLANILDI" },
    }).catch(() => 0);
  }

  const skipReasonsMap = new Map<string, number>();
  for (const l of cLogs) {
    if (l.status.startsWith("SKIPPED_") || l.status === "FAILED" || l.status === "UNCONFIRMED") {
      skipReasonsMap.set(l.status, (skipReasonsMap.get(l.status) ?? 0) + 1);
    }
  }
  const reasonBreakdown = [...skipReasonsMap.entries()].map(([status, count]) => ({
    status: status as DmLogStatus,
    label: DM_LOG_STATUS_LABELS[status as DmLogStatus] ?? status,
    count,
  }));

  // Son 24 saat saatlik seri
  const now = new Date();
  const hourlySeries: { hourLabel: string; triggers: number; sent: number; clicks: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const start = new Date(now.getTime() - i * 3600_000);
    start.setMinutes(0, 0, 0);
    const endMs = start.getTime() + 3600_000;
    const hLogs = cLogs.filter((l) => {
      const ts = new Date(l.createdAt).getTime();
      return ts >= start.getTime() && ts < endMs;
    });
    const hClicks = cClicks.filter((cl) => {
      const ts = new Date(cl.createdAt).getTime();
      return ts >= start.getTime() && ts < endMs;
    });
    hourlySeries.push({
      hourLabel: `${String(start.getHours()).padStart(2, "0")}:00`,
      triggers: hLogs.length,
      sent: hLogs.filter((l) => l.status === "SENT").length,
      clicks: hClicks.length,
    });
  }

  const linkStats = cLinks.map((lnk) => {
    const lc = cClicks.filter((cl) => cl.linkId === lnk.id);
    const lu = new Set(lc.map((cl) => cl.recipientHash ?? cl.ipHash ?? cl.id));
    return {
      ...lnk,
      clicks: lc.length,
      uniqueClicks: lu.size,
    };
  });

  const dailyTotals = Object.values(dailyMap).filter((d) => d.campaignId === campaignId);
  const totalTriggers = Math.max(cLogs.length, dailyTotals.reduce((s, d) => s + d.triggers, 0));
  const totalSent = Math.max(sentCount, dailyTotals.reduce((s, d) => s + d.sent, 0));

  return {
    campaign,
    funnel: {
      triggers: totalTriggers,
      sent: totalSent,
      uniqueClicks: uniqueKeys.size,
      totalClicks: cClicks.length,
      couponRedeemed: couponRedeemedCount,
      deliveryRatePercent: totalTriggers > 0 ? Math.round((totalSent / totalTriggers) * 100) : 0,
      ctrPercent: totalSent > 0 ? Math.round((uniqueKeys.size / totalSent) * 100) : 0,
    },
    counts: {
      sent: totalSent,
      pending: pendingCount,
      failed: failedCount,
      skipped: cLogs.filter((l) => l.status.startsWith("SKIPPED_")).length,
    },
    hourlySeries,
    reasonBreakdown,
    linkStats,
  };
}

export async function listDmCampaignLogs(
  tenantId: string,
  campaignId: string,
  opts: { status?: DmLogStatus | "ALL"; q?: string; limit?: number } = {},
) {
  const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
  let list = logs.filter((l) => l.campaignId === campaignId);
  if (opts.status && opts.status !== "ALL") {
    list = list.filter((l) => l.status === opts.status);
  }
  if (opts.q?.trim()) {
    const q = opts.q.trim().toLocaleLowerCase("tr-TR");
    list = list.filter(
      (l) =>
        (l.recipientUsername ?? "").toLocaleLowerCase("tr-TR").includes(q) ||
        (l.triggerText ?? "").toLocaleLowerCase("tr-TR").includes(q) ||
        (l.matchedKeyword ?? "").toLocaleLowerCase("tr-TR").includes(q),
    );
  }
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return list.slice(0, opts.limit ?? 200);
}

// ───────────── Atomik Claim Deseni (Bölüm 6.5) ─────────────

export async function claimCommentDelivery(
  tenantId: string,
  logId: string,
  maxAttempts = 3,
): Promise<{ claimed: boolean; log: DmLogRecord | null }> {
  return withTenantLock(tenantId, async () => {
    const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
    const idx = logs.findIndex((l) => l.id === logId);
    if (idx === -1) return { claimed: false, log: null };
    const cur = logs[idx]!;
    if (cur.status === "SENT" || cur.dmDeliveryUnconfirmed || cur.attempts >= maxAttempts) {
      return { claimed: false, log: cur };
    }
    const updated: DmLogRecord = {
      ...cur,
      dmDeliveryUnconfirmed: true,
      attempts: cur.attempts + 1,
      updatedAt: new Date().toISOString(),
    };
    logs[idx] = updated;
    await saveJson(keyLogs(tenantId), logs);
    return { claimed: true, log: updated };
  });
}

export async function claimPublicReplyDelivery(
  tenantId: string,
  logId: string,
): Promise<{ claimed: boolean; log: DmLogRecord | null }> {
  return withTenantLock(tenantId, async () => {
    const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
    const idx = logs.findIndex((l) => l.id === logId);
    if (idx === -1) return { claimed: false, log: null };
    const cur = logs[idx]!;
    if (cur.publicReplySentAt || cur.publicReplyUnconfirmed) {
      return { claimed: false, log: cur };
    }
    const updated: DmLogRecord = {
      ...cur,
      publicReplyUnconfirmed: true,
      updatedAt: new Date().toISOString(),
    };
    logs[idx] = updated;
    await saveJson(keyLogs(tenantId), logs);
    return { claimed: true, log: updated };
  });
}

// ───────────── Mesaj Kutusu Ortak Durum Yardımcıları ─────────────

async function isContactBlockedInInbox(tenantId: string, igsid: string): Promise<boolean> {
  const contact = await prisma.contact.findUnique({
    where: { tenantId_channel_externalId: { tenantId, channel: "INSTAGRAM", externalId: igsid } },
    select: { id: true },
  });
  if (!contact) return false;
  const map = await loadJson<Record<string, { blocked?: boolean }>>(`inbox:contactmeta:${tenantId}`, {});
  return Boolean(map[contact.id]?.blocked);
}

async function hasHumanRepliedInInboxRecently(tenantId: string, igsid: string, nowMs: number): Promise<boolean> {
  const contact = await prisma.contact.findUnique({
    where: { tenantId_channel_externalId: { tenantId, channel: "INSTAGRAM", externalId: igsid } },
    select: { id: true },
  });
  if (!contact) return false;
  const conv = await prisma.conversation.findFirst({
    where: { tenantId, contactId: contact.id, channel: "INSTAGRAM" },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: {
        where: { direction: "OUTBOUND", createdAt: { gte: new Date(nowMs - TWENTY_FOUR_HOURS_MS) } },
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
  if (!conv || conv.messages.length === 0) return false;
  const sideMap = await loadJson<Record<string, { messageExtras?: Record<string, { sentByAutomation?: boolean }> }>>(
    `inbox:convmeta:${tenantId}`,
    {},
  );
  const extras = sideMap[conv.id]?.messageExtras ?? {};
  return conv.messages.some((m) => !m.fromAi && !extras[m.id]?.sentByAutomation);
}

async function syncAutomationMessageToInbox(input: {
  tenantId: string;
  recipientIgsid: string;
  recipientUsername?: string | null;
  messageBody: string;
  externalMessageId: string;
}): Promise<void> {
  if (!input.recipientIgsid || input.recipientIgsid === "unknown") return;
  try {
    const contact = await prisma.contact.upsert({
      where: {
        tenantId_channel_externalId: {
          tenantId: input.tenantId,
          channel: "INSTAGRAM",
          externalId: input.recipientIgsid,
        },
      },
      create: {
        tenantId: input.tenantId,
        channel: "INSTAGRAM",
        externalId: input.recipientIgsid,
        name: input.recipientUsername ? `@${input.recipientUsername}` : input.recipientIgsid,
      },
      update: input.recipientUsername ? { name: `@${input.recipientUsername}` } : {},
    });

    let conv = await prisma.conversation.findFirst({
      where: { tenantId: input.tenantId, contactId: contact.id, channel: "INSTAGRAM", status: { not: "closed" } },
      orderBy: { createdAt: "desc" },
    });
    conv ??= await prisma.conversation.create({
      data: {
        tenantId: input.tenantId,
        channel: "INSTAGRAM",
        contactId: contact.id,
        status: "open",
      },
    });

    const msg = await prisma.message.create({
      data: {
        tenantId: input.tenantId,
        conversationId: conv.id,
        externalId: input.externalMessageId,
        direction: "OUTBOUND",
        body: input.messageBody,
        status: "sent",
        statusAt: new Date(),
        fromAi: false,
      },
    });

    const convSidecars = await loadJson<
      Record<
        string,
        {
          displayId?: number;
          uiStatus?: string;
          priority?: string | null;
          snoozedUntil?: string | null;
          teamId?: string | null;
          campaignId?: string | null;
          unreadCount?: number;
          firstReplyAt?: string | null;
          waitingSince?: string | null;
          notes?: unknown[];
          activities?: { id: string; text: string; createdAt: string }[];
          messageExtras?: Record<string, { sentByAutomation?: boolean; senderName?: string }>;
        }
      >
    >(`inbox:convmeta:${input.tenantId}`, {});

    const side = convSidecars[conv.id] ?? {
      displayId: 200,
      uiStatus: "open",
      priority: null,
      snoozedUntil: null,
      teamId: null,
      campaignId: null,
      unreadCount: 0,
      firstReplyAt: null,
      waitingSince: null,
      notes: [],
      activities: [],
      messageExtras: {},
    };
    side.messageExtras ??= {};
    side.messageExtras[msg.id] = {
      sentByAutomation: true,
      senderName: "DM Otomasyonu",
    };
    convSidecars[conv.id] = side;
    await saveJson(`inbox:convmeta:${input.tenantId}`, convSidecars);
    publishInboxEvent(input.tenantId, "message.created", conv.id, {
      messageId: msg.id,
      sentByAutomation: true,
    });
  } catch {
    // Mesaj Kutusu senkron hatası DM teslimatını bozmaz
  }
}

// ───────────── Opt-Out Yönetimi ─────────────

export async function listDmOptOuts(tenantId: string, accountId?: string): Promise<DmOptOutRecord[]> {
  const map = await loadJson<Record<string, DmOptOutRecord>>(keyOptOuts(tenantId), {});
  return Object.values(map)
    .filter((o) => !accountId || o.igAccountId === accountId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function addDmOptOut(
  tenantId: string,
  igAccountId: string,
  igsid: string,
  keyword: string,
  username?: string | null,
): Promise<void> {
  await withTenantLock(tenantId, async () => {
    const map = await loadJson<Record<string, DmOptOutRecord>>(keyOptOuts(tenantId), {});
    map[`${igAccountId}:${igsid}`] = {
      igAccountId,
      igsid,
      username: username ?? map[`${igAccountId}:${igsid}`]?.username ?? null,
      keyword,
      createdAt: new Date().toISOString(),
    };
    await saveJson(keyOptOuts(tenantId), map);
  });
}

export async function removeDmOptOut(tenantId: string, igAccountId: string, igsid: string, actorId: string): Promise<void> {
  await withTenantLock(tenantId, async () => {
    const map = await loadJson<Record<string, DmOptOutRecord>>(keyOptOuts(tenantId), {});
    delete map[`${igAccountId}:${igsid}`];
    await saveJson(keyOptOuts(tenantId), map);
  });
  await recordDmAudit(tenantId, actorId, "optout.remove", igsid, { igAccountId });
}

// ───────────── Yorum İşleme Akışı (Bölüm 8.2) ─────────────

function campaignSpecificityRank(c: DmCampaignRecord): number {
  if (c.triggerMode === "SPECIFIC_POST") return 0;
  if (c.triggerMode === "NEXT_REEL") return 1;
  return 2;
}

function buildCampaignButtonsForRecipient(
  campaign: DmCampaignRecord,
  recipientIgsid: string,
): { buttons: DmButtonPayload[]; primaryTrackedUrl: string | null } {
  const token = createRecipientToken(recipientIgsid || "anon");
  if (campaign.openingDmEnabled) {
    return {
      buttons: [
        {
          type: "postback",
          title: (campaign.openingDmButtonLabel || "Kodu göster").slice(0, 20),
          payload: `reveal:${campaign.id}`,
        },
      ],
      primaryTrackedUrl: null,
    };
  }

  const buttons: DmButtonPayload[] = campaign.buttons.slice(0, 3).map((b) => ({
    type: "web_url",
    title: b.label.slice(0, 20),
    url: buildTrackedShortUrl(b.slug, token),
  }));
  const primaryTrackedUrl = buttons[0]?.url ?? null;
  return { buttons, primaryTrackedUrl };
}

async function appendOrUpdateLog(tenantId: string, log: DmLogRecord): Promise<void> {
  const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
  const idx = logs.findIndex((l) => l.id === log.id);
  if (idx === -1) {
    logs.unshift(log);
  } else {
    logs[idx] = log;
  }
  await saveJson(keyLogs(tenantId), logs.slice(0, 5000));
}

async function createSkippedLog(input: {
  tenantId: string;
  campaign: DmCampaignRecord;
  source: DmTriggerSource;
  commentId: string | null;
  triggerMessageId?: string | null;
  recipientIgsid: string;
  recipientUsername: string | null;
  triggerText: string;
  matchedKeyword: string | null;
  commentCreatedAt: Date | null;
  status: DmLogStatus;
  errorMessage?: string | null;
}): Promise<DmLogRecord> {
  const nowIso = new Date().toISOString();
  const log: DmLogRecord = {
    id: `dmlog_${randomUUID().slice(0, 12)}`,
    tenantId: input.tenantId,
    campaignId: input.campaign.id,
    igAccountId: input.campaign.igAccountId,
    source: input.source,
    commentId: input.commentId,
    triggerMessageId: input.triggerMessageId ?? null,
    recipientIgsid: input.recipientIgsid,
    recipientUsername: input.recipientUsername,
    triggerText: input.triggerText.slice(0, 500),
    matchedKeyword: input.matchedKeyword,
    commentCreatedAt: input.commentCreatedAt?.toISOString() ?? null,
    status: input.status,
    attempts: 0,
    dmDeliveryUnconfirmed: false,
    dmMessageId: null,
    dmSentAt: null,
    errorCode: null,
    errorMessage: input.errorMessage ?? null,
    publicReplyText: null,
    publicReplySentAt: null,
    publicReplyUnconfirmed: false,
    publicReplyError: null,
    requeueAttempt: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await withTenantLock(input.tenantId, async () => {
    await appendOrUpdateLog(input.tenantId, log);
    await bumpDailyStat(input.tenantId, input.campaign.id, new Date(), { triggers: 1, skipped: 1 });
  });
  publishDmRealtimeEvent(input.tenantId, input.campaign.id, "log.updated", { logId: log.id, status: log.status });
  return log;
}

export type ProcessCommentResult = {
  processed: boolean;
  winnerCampaignId: string | null;
  status: DmLogStatus | "NO_MATCH" | "ALREADY_CLAIMED" | "ACCOUNT_NOT_READY";
  logId?: string;
  requeueDelayMs?: number;
};

/**
 * Tek bir Instagram yorum olayını tüm güvenlik, dedupe, hız sınırı, claim ve
 * uyum kurallarıyla uçtan uca işler.
 */
export async function processCommentEvent(
  tenantId: string,
  event: ParsedInstagramCommentEvent,
  opts: {
    source?: DmTriggerSource;
    nowMs?: number;
    requeueAttempt?: number;
    existingLogId?: string;
  } = {},
): Promise<ProcessCommentResult> {
  const source = opts.source ?? "WEBHOOK";
  const nowMs = opts.nowMs ?? Date.now();
  const requeueAttempt = opts.requeueAttempt ?? 0;

  const accounts = await listDmInstagramAccounts(tenantId);
  const account = accounts.find((a) => a.igUserId === event.igAccountId);
  if (!account || account.status === "REVOKED" || account.status === "REAUTH_REQUIRED") {
    return { processed: false, winnerCampaignId: null, status: "ACCOUNT_NOT_READY" };
  }

  // Son webhook zamanını güncelle
  if (source === "WEBHOOK") {
    await withTenantLock(tenantId, async () => {
      const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(tenantId), {});
      metaMap[account.id] = { ...(metaMap[account.id] ?? {}), lastWebhookAt: new Date(nowMs).toISOString() };
      await saveJson(keyAccountsMeta(tenantId), metaMap);
    });
  }

  // Aday aktif kampanyaları bul ve spesifiklik + oluşturulma sırasına göre sırala
  const allCampaigns = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
  const nowDate = new Date(nowMs);
  const candidates = allCampaigns
    .filter((c) => {
      if (c.igAccountId !== account.id || c.status !== "ACTIVE") return false;
      if (c.startsAt && new Date(c.startsAt).getTime() > nowMs) return false;
      if (c.endsAt && new Date(c.endsAt).getTime() < nowMs) return false;
      if (c.triggerMode === "ANY_POST") return true;
      if (c.pendingNextReel && !c.mediaId) return false;
      if (!c.mediaId) return false;
      return c.mediaId === event.mediaId || (Boolean(event.originalMediaId) && c.mediaId === event.originalMediaId);
    })
    .sort((a, b) => campaignSpecificityRank(a) - campaignSpecificityRank(b) || a.createdAt.localeCompare(b.createdAt));

  if (candidates.length === 0) {
    return { processed: false, winnerCampaignId: null, status: "NO_MATCH" };
  }

  // Eşleşen kampanyaları sırayla belirle
  const matched: { campaign: DmCampaignRecord; matchedKeyword: string }[] = [];
  for (const c of candidates) {
    const res = matchKeyword(event.text, c.keywords, c.matchMode);
    if (res.matched) {
      matched.push({ campaign: c, matchedKeyword: res.matchedKeyword ?? "*" });
    }
  }

  if (matched.length === 0) {
    return { processed: false, winnerCampaignId: null, status: "NO_MATCH" };
  }

  const winner = matched[0]!;
  const losers = matched.slice(1);

  // Kendi yorumuna private reply gönderilemez
  if (event.isOwnComment) {
    const log = await createSkippedLog({
      tenantId,
      campaign: winner.campaign,
      source,
      commentId: event.commentId,
      recipientIgsid: event.commenterId || account.igUserId,
      recipientUsername: event.commenterUsername,
      triggerText: event.text,
      matchedKeyword: winner.matchedKeyword,
      commentCreatedAt: event.timestamp,
      status: "SKIPPED_OWN_COMMENT",
    });
    return { processed: true, winnerCampaignId: winner.campaign.id, status: "SKIPPED_OWN_COMMENT", logId: log.id };
  }

  // Yorum yaşı > 7 gün kontrolü (Meta Private Replies sınırı)
  if (nowMs - event.timestamp.getTime() > SEVEN_DAYS_MS) {
    const log = await createSkippedLog({
      tenantId,
      campaign: winner.campaign,
      source,
      commentId: event.commentId,
      recipientIgsid: event.commenterId,
      recipientUsername: event.commenterUsername,
      triggerText: event.text,
      matchedKeyword: winner.matchedKeyword,
      commentCreatedAt: event.timestamp,
      status: "SKIPPED_EXPIRED",
    });
    return { processed: true, winnerCampaignId: winner.campaign.id, status: "SKIPPED_EXPIRED", logId: log.id };
  }

  // Atomik yorum sahipliği (DmCommentClaim) ve mevcut DmLog dedupe kontrolü
  let targetLogId = opts.existingLogId ?? "";
  let claimDenied = false;

  await withTenantLock(tenantId, async () => {
    const claims = await loadJson<Record<string, DmCommentClaimRecord>>(keyClaims(tenantId), {});
    const claimKey = `${account.id}:${event.commentId}`;
    const existingClaim = claims[claimKey];

    if (existingClaim && existingClaim.campaignId !== winner.campaign.id) {
      claimDenied = true;
      return;
    }

    if (!existingClaim) {
      claims[claimKey] = {
        igAccountId: account.id,
        commentId: event.commentId,
        campaignId: winner.campaign.id,
        createdAt: nowDate.toISOString(),
      };
      await saveJson(keyClaims(tenantId), claims);

      // Diğer eşleşen kampanyalar için SKIPPED_OTHER_CAMPAIGN kaydı düş
      for (const loser of losers) {
        await appendOrUpdateLog(tenantId, {
          id: `dmlog_${randomUUID().slice(0, 12)}`,
          tenantId,
          campaignId: loser.campaign.id,
          igAccountId: account.id,
          source,
          commentId: event.commentId,
          triggerMessageId: null,
          recipientIgsid: event.commenterId,
          recipientUsername: event.commenterUsername,
          triggerText: event.text.slice(0, 500),
          matchedKeyword: loser.matchedKeyword,
          commentCreatedAt: event.timestamp.toISOString(),
          status: "SKIPPED_OTHER_CAMPAIGN",
          attempts: 0,
          dmDeliveryUnconfirmed: false,
          dmMessageId: null,
          dmSentAt: null,
          errorCode: null,
          errorMessage: null,
          publicReplyText: null,
          publicReplySentAt: null,
          publicReplyUnconfirmed: false,
          publicReplyError: null,
          requeueAttempt: 0,
          createdAt: nowDate.toISOString(),
          updatedAt: nowDate.toISOString(),
        });
      }
    }

    const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
    const existingLog = logs.find(
      (l) => l.campaignId === winner.campaign.id && l.commentId === event.commentId,
    );
    if (existingLog) {
      targetLogId = existingLog.id;
      if (existingLog.status === "SENT" || existingLog.dmDeliveryUnconfirmed) {
        claimDenied = true;
      }
      return;
    }

    const newLog: DmLogRecord = {
      id: `dmlog_${randomUUID().slice(0, 12)}`,
      tenantId,
      campaignId: winner.campaign.id,
      igAccountId: account.id,
      source,
      commentId: event.commentId,
      triggerMessageId: null,
      recipientIgsid: event.commenterId,
      recipientUsername: event.commenterUsername,
      triggerText: event.text.slice(0, 500),
      matchedKeyword: winner.matchedKeyword,
      commentCreatedAt: event.timestamp.toISOString(),
      status: "PENDING",
      attempts: 0,
      dmDeliveryUnconfirmed: false,
      dmMessageId: null,
      dmSentAt: null,
      errorCode: null,
      errorMessage: null,
      publicReplyText: null,
      publicReplySentAt: null,
      publicReplyUnconfirmed: false,
      publicReplyError: null,
      requeueAttempt,
      createdAt: nowDate.toISOString(),
      updatedAt: nowDate.toISOString(),
    };
    targetLogId = newLog.id;
    await appendOrUpdateLog(tenantId, newLog);
    await bumpDailyStat(tenantId, winner.campaign.id, nowDate, { triggers: 1 });
  });

  if (claimDenied) {
    return { processed: false, winnerCampaignId: winner.campaign.id, status: "ALREADY_CLAIMED", logId: targetLogId };
  }

  const updateLogStatus = async (patch: Partial<DmLogRecord>, dailyDelta?: Parameters<typeof bumpDailyStat>[3]) => {
    await withTenantLock(tenantId, async () => {
      const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
      const idx = logs.findIndex((l) => l.id === targetLogId);
      if (idx === -1) return;
      logs[idx] = { ...logs[idx]!, ...patch, updatedAt: new Date(nowMs).toISOString() };
      await saveJson(keyLogs(tenantId), logs);
      if (dailyDelta) {
        await bumpDailyStat(tenantId, winner.campaign.id, nowDate, dailyDelta);
      }
    });
    publishDmRealtimeEvent(tenantId, winner.campaign.id, "log.updated", {
      logId: targetLogId,
      status: patch.status,
    });
  };

  // Opt-out kontrolü
  const optOuts = await loadJson<Record<string, DmOptOutRecord>>(keyOptOuts(tenantId), {});
  if (event.commenterId && optOuts[`${account.id}:${event.commenterId}`]) {
    await updateLogStatus({ status: "SKIPPED_OPTED_OUT" }, { skipped: 1 });
    return { processed: true, winnerCampaignId: winner.campaign.id, status: "SKIPPED_OPTED_OUT", logId: targetLogId };
  }

  // Mesaj Kutusu engelleme kontrolü
  if (event.commenterId && (await isContactBlockedInInbox(tenantId, event.commenterId))) {
    await updateLogStatus({ status: "SKIPPED_BLOCKED" }, { skipped: 1 });
    return { processed: true, winnerCampaignId: winner.campaign.id, status: "SKIPPED_BLOCKED", logId: targetLogId };
  }

  // Aynı kişiye tekrar gönderim politikası (NEVER / DAILY / ALWAYS)
  if (winner.campaign.repeatPolicy !== "ALWAYS" && event.commenterId) {
    const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
    const duplicate = logs.find(
      (l) =>
        l.id !== targetLogId &&
        l.campaignId === winner.campaign.id &&
        l.recipientIgsid === event.commenterId &&
        l.status === "SENT" &&
        (winner.campaign.repeatPolicy === "NEVER" ||
          (l.dmSentAt && nowMs - new Date(l.dmSentAt).getTime() < TWENTY_FOUR_HOURS_MS)),
    );
    if (duplicate) {
      await updateLogStatus({ status: "SKIPPED_DUPLICATE_RECIPIENT" }, { skipped: 1 });
      return {
        processed: true,
        winnerCampaignId: winner.campaign.id,
        status: "SKIPPED_DUPLICATE_RECIPIENT",
        logId: targetLogId,
      };
    }
  }

  // Kampanya gönderim tavanı
  if (winner.campaign.sendCap !== null && winner.campaign.sentCount >= winner.campaign.sendCap) {
    await updateLogStatus({ status: "SKIPPED_CAMPAIGN_CAP" }, { skipped: 1 });
    await pauseDmCampaign(tenantId, winner.campaign.id, "system");
    return { processed: true, winnerCampaignId: winner.campaign.id, status: "SKIPPED_CAMPAIGN_CAP", logId: targetLogId };
  }

  // Aylık plan kotası
  const [quota, monthlyUsed] = await Promise.all([
    getTenantDmQuota(tenantId),
    getMonthlyUsage(tenantId, nowDate),
  ]);
  if (monthlyUsed >= quota.monthlyDmLimit) {
    await updateLogStatus({ status: "SKIPPED_PLAN_QUOTA" }, { skipped: 1 });
    return { processed: true, winnerCampaignId: winner.campaign.id, status: "SKIPPED_PLAN_QUOTA", logId: targetLogId };
  }

  const token = await resolveAccountToken(tenantId, account);

  // Bacak 1: Herkese açık yorum yanıtı (DM'den bağımsız, idempotent)
  if (winner.campaign.publicReplyEnabled && winner.campaign.publicReplies.length > 0) {
    const repClaim = await claimPublicReplyDelivery(tenantId, targetLogId);
    if (repClaim.claimed) {
      const variations = winner.campaign.publicReplies;
      const chosenReply = variations[Math.floor(Math.random() * variations.length)]!;
      try {
        await dmMetaTransport().replyToCommentPublicly({
          commentId: event.commentId,
          token,
          message: chosenReply,
        });
        await updateLogStatus({
          publicReplyText: chosenReply,
          publicReplySentAt: new Date(nowMs).toISOString(),
          publicReplyUnconfirmed: false,
          publicReplyError: null,
        });
      } catch (err) {
        const classified = classifyDmDeliveryError(err);
        await updateLogStatus({
          publicReplyUnconfirmed: classified.leaveUnconfirmed,
          publicReplyError: classified.message.slice(0, 240),
        });
      }
    }
  }

  // Bacak 2: Private Reply DM (Hız Sınırı → Claim → Gönderim)
  const maxRequeueAttempts = envInt("DM_MAX_REQUEUE_ATTEMPTS", 3);
  const slotRes = await reserveDMSlot(account.igUserId, { nowMs });
  if (!slotRes.allowed) {
    if (requeueAttempt >= maxRequeueAttempts) {
      await updateLogStatus(
        {
          status: "SKIPPED_RATE_LIMIT",
          errorMessage: "Saatlik Meta hız sınırı nedeniyle 3 yeniden denemeden sonra atlandı.",
          requeueAttempt,
        },
        { skipped: 1 },
      );
      return {
        processed: true,
        winnerCampaignId: winner.campaign.id,
        status: "SKIPPED_RATE_LIMIT",
        logId: targetLogId,
      };
    }
    await updateLogStatus({
      status: "PENDING",
      requeueAttempt: requeueAttempt + 1,
      errorMessage: `Hız sınırı/devre kesici: ${Math.ceil(slotRes.retryAfterMs / 60_000)} dk sonra tekrar denenecek.`,
    });
    return {
      processed: false,
      winnerCampaignId: winner.campaign.id,
      status: "PENDING",
      logId: targetLogId,
      requeueDelayMs: slotRes.retryAfterMs,
    };
  }

  const dmClaim = await claimCommentDelivery(tenantId, targetLogId);
  if (!dmClaim.claimed) {
    await releaseDMSlot(account.igUserId, slotRes.slotId);
    return {
      processed: false,
      winnerCampaignId: winner.campaign.id,
      status: dmClaim.log?.status ?? "ALREADY_CLAIMED",
      logId: targetLogId,
    };
  }

  const { buttons, primaryTrackedUrl } = buildCampaignButtonsForRecipient(
    winner.campaign,
    event.commenterId,
  );
  const messageText = winner.campaign.openingDmEnabled
    ? (winner.campaign.openingDmText?.trim() || "Merhaba! İstediğin bilgiyi göndermek için aşağıdaki butona dokunabilirsin ✨")
    : formatDmMessage({
        dmText: winner.campaign.dmText,
        dmFooter: winner.campaign.dmFooter,
        username: event.commenterUsername,
        linkUrl: primaryTrackedUrl,
        couponCode: winner.campaign.couponCode,
      });

  const markSent = async (messageId: string, recipientId?: string) => {
    const sentAtIso = new Date(nowMs).toISOString();
    await withTenantLock(tenantId, async () => {
      const campaigns = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
      const cIdx = campaigns.findIndex((c) => c.id === winner.campaign.id);
      if (cIdx !== -1) {
        campaigns[cIdx] = {
          ...campaigns[cIdx]!,
          sentCount: campaigns[cIdx]!.sentCount + 1,
          updatedAt: sentAtIso,
        };
        await saveJson(keyCampaigns(tenantId), campaigns);
      }
      await incrementMonthlyUsage(tenantId, nowDate);
    });

    await updateLogStatus(
      {
        status: "SENT",
        dmDeliveryUnconfirmed: false,
        dmMessageId: messageId,
        dmSentAt: sentAtIso,
        errorCode: null,
        errorMessage: null,
      },
      { sent: 1 },
    );

    await syncAutomationMessageToInbox({
      tenantId,
      recipientIgsid: recipientId || event.commenterId,
      recipientUsername: event.commenterUsername,
      messageBody: messageText,
      externalMessageId: messageId,
    });
  };

  const handleDeliveryFailure = async (classified: ClassifiedDmDeliveryError): Promise<ProcessCommentResult> => {
    if (classified.category === "RATE_LIMITED") {
      await releaseDMSlot(account.igUserId, slotRes.slotId);
      openCircuitBreaker(account.igUserId, undefined, classified.message, nowMs);
      if (requeueAttempt >= maxRequeueAttempts) {
        await updateLogStatus(
          {
            status: "SKIPPED_RATE_LIMIT",
            dmDeliveryUnconfirmed: false,
            errorCode: classified.code ? String(classified.code) : "429",
            errorMessage: classified.message.slice(0, 240),
          },
          { skipped: 1 },
        );
        return { processed: true, winnerCampaignId: winner.campaign.id, status: "SKIPPED_RATE_LIMIT", logId: targetLogId };
      }
      await updateLogStatus({
        status: "PENDING",
        dmDeliveryUnconfirmed: false,
        requeueAttempt: requeueAttempt + 1,
        errorCode: classified.code ? String(classified.code) : "429",
        errorMessage: classified.message.slice(0, 240),
      });
      return {
        processed: false,
        winnerCampaignId: winner.campaign.id,
        status: "PENDING",
        logId: targetLogId,
        requeueDelayMs: envInt("DM_REQUEUE_DELAY_MS", 1_800_000),
      };
    }

    if (classified.category === "REAUTH_REQUIRED") {
      await releaseDMSlot(account.igUserId, slotRes.slotId);
      await handleAccountReauthRequired(tenantId, account.id, classified.message);
      await updateLogStatus(
        {
          status: "FAILED",
          dmDeliveryUnconfirmed: false,
          errorCode: "190",
          errorMessage: classified.message.slice(0, 240),
        },
        { failed: 1 },
      );
      return { processed: true, winnerCampaignId: winner.campaign.id, status: "FAILED", logId: targetLogId };
    }

    if (classified.category === "SKIPPED_NOT_ELIGIBLE") {
      await releaseDMSlot(account.igUserId, slotRes.slotId);
      await updateLogStatus(
        {
          status: "SKIPPED_NOT_ELIGIBLE",
          dmDeliveryUnconfirmed: false,
          errorCode: String(classified.subcode ?? 2534025),
          errorMessage: classified.message.slice(0, 240),
        },
        { skipped: 1 },
      );
      return { processed: true, winnerCampaignId: winner.campaign.id, status: "SKIPPED_NOT_ELIGIBLE", logId: targetLogId };
    }

    if (classified.category === "UNCERTAIN") {
      // Belirsiz durumda dmDeliveryUnconfirmed = true KALIR ve ASLA tekrar gönderilmez
      await updateLogStatus(
        {
          status: "UNCONFIRMED",
          dmDeliveryUnconfirmed: true,
          errorCode: classified.code ? String(classified.code) : "5XX",
          errorMessage: classified.message.slice(0, 240),
        },
        { failed: 1 },
      );
      return { processed: true, winnerCampaignId: winner.campaign.id, status: "UNCONFIRMED", logId: targetLogId };
    }

    // Kesin red (DEFINITE_REJECTION)
    await releaseDMSlot(account.igUserId, slotRes.slotId);
    await updateLogStatus(
      {
        status: "FAILED",
        dmDeliveryUnconfirmed: false,
        errorCode: classified.code ? String(classified.code) : "400",
        errorMessage: classified.message.slice(0, 240),
      },
      { failed: 1 },
    );
    return { processed: true, winnerCampaignId: winner.campaign.id, status: "FAILED", logId: targetLogId };
  };

  try {
    const sent =
      buttons.length > 0
        ? await dmMetaTransport().sendPrivateReplyTemplate({
            igUserId: account.igUserId,
            token,
            commentId: event.commentId,
            text: messageText,
            buttons,
          })
        : await dmMetaTransport().sendPrivateReplyText({
            igUserId: account.igUserId,
            token,
            commentId: event.commentId,
            text: messageText,
          });
    await markSent(sent.messageId, sent.recipientId);
    return { processed: true, winnerCampaignId: winner.campaign.id, status: "SENT", logId: targetLogId };
  } catch (err) {
    const classified = classifyDmDeliveryError(err);

    // Yalnızca şablon/buton reddinde tek seferlik düz metin + link geri dönüşü
    if (buttons.length > 0 && classified.templateRejected && !winner.campaign.openingDmEnabled) {
      const fallbackText = formatDmMessage({
        dmText: primaryTrackedUrl && !winner.campaign.dmText.includes("{link}")
          ? `${winner.campaign.dmText}\n\n{link}`
          : winner.campaign.dmText,
        dmFooter: winner.campaign.dmFooter,
        username: event.commenterUsername,
        linkUrl: primaryTrackedUrl,
        couponCode: winner.campaign.couponCode,
      });
      try {
        const fallbackSent = await dmMetaTransport().sendPrivateReplyText({
          igUserId: account.igUserId,
          token,
          commentId: event.commentId,
          text: fallbackText,
        });
        await markSent(fallbackSent.messageId, fallbackSent.recipientId);
        return { processed: true, winnerCampaignId: winner.campaign.id, status: "SENT", logId: targetLogId };
      } catch (fallbackErr) {
        return handleDeliveryFailure(classifyDmDeliveryError(fallbackErr));
      }
    }

    return handleDeliveryFailure(classified);
  }
}

async function handleAccountReauthRequired(tenantId: string, accountId: string, errorMsg: string): Promise<void> {
  await prisma.channelConnection.update({
    where: { id: accountId },
    data: { status: "ERROR", lastError: errorMsg.slice(0, 300) },
  }).catch(() => undefined);

  await withTenantLock(tenantId, async () => {
    const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(tenantId), {});
    metaMap[accountId] = { ...(metaMap[accountId] ?? {}), status: "REAUTH_REQUIRED" };
    await saveJson(keyAccountsMeta(tenantId), metaMap);

    const campaigns = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
    let changed = false;
    for (const c of campaigns) {
      if (c.igAccountId === accountId && c.status === "ACTIVE") {
        c.status = "ACCOUNT_ISSUE";
        c.updatedAt = new Date().toISOString();
        changed = true;
      }
    }
    if (changed) await saveJson(keyCampaigns(tenantId), campaigns);
  });
}

// ───────────── DM Tetikleyicisi, Postback ve Opt-Out (Bölüm 7.4 & 7.5) ─────────────

export async function processDmInboundEvent(
  tenantId: string,
  event: ParsedInstagramMessageEvent,
  nowMs = Date.now(),
): Promise<{ handled: boolean; optOut: boolean; logStatus?: DmLogStatus }> {
  const accounts = await listDmInstagramAccounts(tenantId);
  const account = accounts.find((a) => a.igUserId === event.igAccountId);
  if (!account || account.status === "REVOKED" || account.status === "REAUTH_REQUIRED") {
    return { handled: false, optOut: false };
  }

  // 1. Opt-out kelimesi kontrolü (DUR / İPTAL / STOP / ABONELİKTEN ÇIK) — ek mesaj gönderilmez!
  const optCheck = detectOptOutKeyword(event.text);
  if (optCheck.isOptOut) {
    await addDmOptOut(tenantId, account.id, event.senderId, optCheck.matchedKeyword ?? "dur");
    return { handled: true, optOut: true };
  }

  // 2. DM tetikleyicisi açık aktif kampanyalar
  const campaigns = (await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []))
    .filter((c) => c.igAccountId === account.id && c.status === "ACTIVE" && c.dmTriggerEnabled)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (campaigns.length === 0) return { handled: false, optOut: false };

  let winner: { campaign: DmCampaignRecord; matchedKeyword: string } | null = null;
  for (const c of campaigns) {
    const m = matchKeyword(event.text, c.keywords, c.matchMode);
    if (m.matched) {
      winner = { campaign: c, matchedKeyword: m.matchedKeyword ?? "*" };
      break;
    }
  }
  if (!winner) return { handled: false, optOut: false };

  // Dedupe: triggerMessageId
  const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
  if (logs.some((l) => l.campaignId === winner.campaign.id && l.triggerMessageId === event.mid)) {
    return { handled: false, optOut: false };
  }

  // Mesaj Kutusu'nda insan son 24 saatte yanıt verdiyse sus
  if (await hasHumanRepliedInInboxRecently(tenantId, event.senderId, nowMs)) {
    await createSkippedLog({
      tenantId,
      campaign: winner.campaign,
      source: "DM",
      commentId: null,
      triggerMessageId: event.mid,
      recipientIgsid: event.senderId,
      recipientUsername: null,
      triggerText: event.text,
      matchedKeyword: winner.matchedKeyword,
      commentCreatedAt: event.timestamp,
      status: "SKIPPED_HUMAN_ACTIVE",
    });
    return { handled: true, optOut: false, logStatus: "SKIPPED_HUMAN_ACTIVE" };
  }

  const optOuts = await loadJson<Record<string, DmOptOutRecord>>(keyOptOuts(tenantId), {});
  if (optOuts[`${account.id}:${event.senderId}`]) {
    await createSkippedLog({
      tenantId,
      campaign: winner.campaign,
      source: "DM",
      commentId: null,
      triggerMessageId: event.mid,
      recipientIgsid: event.senderId,
      recipientUsername: null,
      triggerText: event.text,
      matchedKeyword: winner.matchedKeyword,
      commentCreatedAt: event.timestamp,
      status: "SKIPPED_OPTED_OUT",
    });
    return { handled: true, optOut: false, logStatus: "SKIPPED_OPTED_OUT" };
  }

  // Kişi başına 24 saat kuralı
  const recentDup = logs.some(
    (l) =>
      l.campaignId === winner.campaign.id &&
      l.recipientIgsid === event.senderId &&
      l.status === "SENT" &&
      l.dmSentAt &&
      nowMs - new Date(l.dmSentAt).getTime() < TWENTY_FOUR_HOURS_MS,
  );
  if (recentDup) {
    await createSkippedLog({
      tenantId,
      campaign: winner.campaign,
      source: "DM",
      commentId: null,
      triggerMessageId: event.mid,
      recipientIgsid: event.senderId,
      recipientUsername: null,
      triggerText: event.text,
      matchedKeyword: winner.matchedKeyword,
      commentCreatedAt: event.timestamp,
      status: "SKIPPED_DUPLICATE_RECIPIENT",
    });
    return { handled: true, optOut: false, logStatus: "SKIPPED_DUPLICATE_RECIPIENT" };
  }

  const token = await resolveAccountToken(tenantId, account);
  const { buttons, primaryTrackedUrl } = buildCampaignButtonsForRecipient(winner.campaign, event.senderId);
  const text = formatDmMessage({
    dmText: winner.campaign.dmText,
    dmFooter: winner.campaign.dmFooter,
    linkUrl: primaryTrackedUrl,
    couponCode: winner.campaign.couponCode,
  });

  const nowIso = new Date(nowMs).toISOString();
  try {
    const sent = await dmMetaTransport().sendDirectMessage({
      igUserId: account.igUserId,
      token,
      recipientIgsid: event.senderId,
      text,
      buttons: winner.campaign.openingDmEnabled ? undefined : buttons,
    });
    await withTenantLock(tenantId, async () => {
      await appendOrUpdateLog(tenantId, {
        id: `dmlog_${randomUUID().slice(0, 12)}`,
        tenantId,
        campaignId: winner.campaign.id,
        igAccountId: account.id,
        source: "DM",
        commentId: null,
        triggerMessageId: event.mid,
        recipientIgsid: event.senderId,
        recipientUsername: null,
        triggerText: event.text.slice(0, 500),
        matchedKeyword: winner.matchedKeyword,
        commentCreatedAt: event.timestamp.toISOString(),
        status: "SENT",
        attempts: 1,
        dmDeliveryUnconfirmed: false,
        dmMessageId: sent.messageId,
        dmSentAt: nowIso,
        errorCode: null,
        errorMessage: null,
        publicReplyText: null,
        publicReplySentAt: null,
        publicReplyUnconfirmed: false,
        publicReplyError: null,
        requeueAttempt: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      await bumpDailyStat(tenantId, winner.campaign.id, new Date(nowMs), { triggers: 1, sent: 1 });
      await incrementMonthlyUsage(tenantId, new Date(nowMs));
    });
    await syncAutomationMessageToInbox({
      tenantId,
      recipientIgsid: event.senderId,
      messageBody: text,
      externalMessageId: sent.messageId,
    });
    return { handled: true, optOut: false, logStatus: "SENT" };
  } catch (err) {
    const classified = classifyDmDeliveryError(err);
    const status: DmLogStatus = classified.leaveUnconfirmed ? "UNCONFIRMED" : "FAILED";
    await createSkippedLog({
      tenantId,
      campaign: winner.campaign,
      source: "DM",
      commentId: null,
      triggerMessageId: event.mid,
      recipientIgsid: event.senderId,
      recipientUsername: null,
      triggerText: event.text,
      matchedKeyword: winner.matchedKeyword,
      commentCreatedAt: event.timestamp,
      status,
      errorMessage: classified.message,
    });
    return { handled: true, optOut: false, logStatus: status };
  }
}

export async function processDmPostbackEvent(
  tenantId: string,
  event: ParsedInstagramPostbackEvent,
  nowMs = Date.now(),
): Promise<{ handled: boolean }> {
  if (!event.payload.startsWith("reveal:")) return { handled: false };
  const campaignId = event.payload.slice("reveal:".length).trim();
  const campaigns = await loadJson<DmCampaignRecord[]>(keyCampaigns(tenantId), []);
  const campaign = campaigns.find((c) => c.id === campaignId);
  if (!campaign) return { handled: false };

  const accounts = await listDmInstagramAccounts(tenantId);
  const account = accounts.find((a) => a.id === campaign.igAccountId);
  if (!account || account.status === "REVOKED") return { handled: false };

  const optOuts = await loadJson<Record<string, DmOptOutRecord>>(keyOptOuts(tenantId), {});
  if (optOuts[`${account.id}:${event.senderId}`]) return { handled: false };

  const dedupeKey = `reveal:${campaignId}:${event.senderId}`;
  const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
  if (logs.some((l) => l.campaignId === campaignId && l.triggerMessageId === dedupeKey && l.status === "SENT")) {
    return { handled: false };
  }

  const token = await resolveAccountToken(tenantId, account);
  const recipientToken = createRecipientToken(event.senderId);
  const buttons: DmButtonPayload[] = campaign.buttons.slice(0, 3).map((b) => ({
    type: "web_url",
    title: b.label.slice(0, 20),
    url: buildTrackedShortUrl(b.slug, recipientToken),
  }));
  const text = formatDmMessage({
    dmText: campaign.dmText,
    dmFooter: campaign.dmFooter,
    linkUrl: buttons[0]?.url ?? null,
    couponCode: campaign.couponCode,
  });

  const sent = await dmMetaTransport().sendDirectMessage({
    igUserId: account.igUserId,
    token,
    recipientIgsid: event.senderId,
    text,
    buttons,
  });

  const nowIso = new Date(nowMs).toISOString();
  await withTenantLock(tenantId, async () => {
    await appendOrUpdateLog(tenantId, {
      id: `dmlog_${randomUUID().slice(0, 12)}`,
      tenantId,
      campaignId: campaign.id,
      igAccountId: account.id,
      source: "POSTBACK",
      commentId: null,
      triggerMessageId: dedupeKey,
      recipientIgsid: event.senderId,
      recipientUsername: null,
      triggerText: event.title ?? event.payload,
      matchedKeyword: "postback",
      commentCreatedAt: event.timestamp.toISOString(),
      status: "SENT",
      attempts: 1,
      dmDeliveryUnconfirmed: false,
      dmMessageId: sent.messageId,
      dmSentAt: nowIso,
      errorCode: null,
      errorMessage: null,
      publicReplyText: null,
      publicReplySentAt: null,
      publicReplyUnconfirmed: false,
      publicReplyError: null,
      requeueAttempt: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  return { handled: true };
}

/** Ortak webhook işlemcisi (`channels/processor.ts` çağırır). */
export async function processInstagramWebhookForDmAutomation(payload: unknown): Promise<{
  commentsHandled: number;
  messagesHandled: number;
  postbacksHandled: number;
  optOutsCaptured: number;
  handledMessageIds: string[];
}> {
  if (!isDmAutomationEnabled()) {
    return { commentsHandled: 0, messagesHandled: 0, postbacksHandled: 0, optOutsCaptured: 0, handledMessageIds: [] };
  }
  const parsed = parseInstagramWebhookPayload(payload);
  if (!parsed.supported) {
    return { commentsHandled: 0, messagesHandled: 0, postbacksHandled: 0, optOutsCaptured: 0, handledMessageIds: [] };
  }

  // Bilinen IG hesaplarını eşleştir (bilinmeyen hesapların olayları işlenmez)
  const conns = await prisma.channelConnection.findMany({
    where: { provider: "INSTAGRAM", status: "ACTIVE" },
    select: { tenantId: true, externalIds: true },
  });
  const igToTenant = new Map<string, string>();
  for (const c of conns) {
    const ext = (c.externalIds ?? {}) as Record<string, unknown>;
    const igId = String(ext.ig_user_id ?? ext.page_id ?? "");
    if (igId) igToTenant.set(igId, c.tenantId);
  }

  let commentsHandled = 0;
  let messagesHandled = 0;
  let postbacksHandled = 0;
  let optOutsCaptured = 0;
  const handledMessageIds: string[] = [];

  for (const comment of parsed.comments) {
    const tenantId = igToTenant.get(comment.igAccountId);
    if (!tenantId) continue;
    if (!(await isTenantAllowedForDmAutomation(tenantId))) continue;
    const r = await processCommentEvent(tenantId, comment, { source: "WEBHOOK" });
    if (r.processed) commentsHandled += 1;
  }

  for (const msg of parsed.messages) {
    const tenantId = igToTenant.get(msg.igAccountId);
    if (!tenantId) continue;
    if (!(await isTenantAllowedForDmAutomation(tenantId))) continue;
    const r = await processDmInboundEvent(tenantId, msg);
    if (r.handled) {
      messagesHandled += 1;
      handledMessageIds.push(msg.mid);
    }
    if (r.optOut) optOutsCaptured += 1;
  }

  for (const pb of parsed.postbacks) {
    const tenantId = igToTenant.get(pb.igAccountId);
    if (!tenantId) continue;
    if (!(await isTenantAllowedForDmAutomation(tenantId))) continue;
    const r = await processDmPostbackEvent(tenantId, pb);
    if (r.handled) postbacksHandled += 1;
  }

  if (commentsHandled + messagesHandled + postbacksHandled > 0) {
    await recordWorkerHeartbeat({ lastProcessedAt: new Date().toISOString() }).catch(() => undefined);
  }

  return { commentsHandled, messagesHandled, postbacksHandled, optOutsCaptured, handledMessageIds };
}

// ───────────── Takip Linki Yönlendirme & Tıklama Kaydı ─────────────

export async function resolveDmTrackedLinkAndRecordClick(
  slug: string,
  meta: {
    recipientToken?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    referrer?: string | null;
  },
): Promise<string | null> {
  const index = await loadJson<{
    tenantId: string;
    campaignId: string;
    linkId: string;
    destination: string;
  } | null>(keySlug(slug), null);
  if (!index || !index.destination.startsWith("https://")) return null;

  const bot = isBotUserAgent(meta.userAgent);
  const recipientHash = isValidRecipientToken(meta.recipientToken) ? meta.recipientToken! : null;
  let ipHash: string | null = null;
  try {
    ipHash = hashClickIp(meta.ip);
  } catch {
    ipHash = null;
  }

  void (async () => {
    await withTenantLock(index.tenantId, async () => {
      const clicks = await loadJson<DmLinkClickRecord[]>(keyClicks(index.tenantId), []);
      const uniqueKey = recipientHash ?? ipHash;
      const alreadyClicked = Boolean(
        !bot &&
          uniqueKey &&
          clicks.some(
            (c) =>
              c.linkId === index.linkId &&
              !c.isBot &&
              (c.recipientHash === uniqueKey || c.ipHash === uniqueKey),
          ),
      );

      const rec: DmLinkClickRecord = {
        id: `dmc_clk_${randomUUID().slice(0, 10)}`,
        tenantId: index.tenantId,
        campaignId: index.campaignId,
        linkId: index.linkId,
        recipientHash,
        ipHash,
        userAgent: meta.userAgent?.slice(0, 200) ?? null,
        referrer: meta.referrer?.slice(0, 200) ?? null,
        isBot: bot,
        createdAt: new Date().toISOString(),
      };
      clicks.unshift(rec);
      await saveJson(keyClicks(index.tenantId), clicks.slice(0, 10_000));

      if (!bot) {
        await bumpDailyStat(index.tenantId, index.campaignId, new Date(), {
          clicks: 1,
          uniqueClicks: alreadyClicked ? 0 : 1,
        });
        publishDmRealtimeEvent(index.tenantId, index.campaignId, "click.recorded", {
          linkId: index.linkId,
          unique: !alreadyClicked,
        });
      }
    });
  })().catch(() => undefined);

  return index.destination;
}

export async function getSharedDmCampaignReport(shareSlug: string) {
  const ptr = await loadJson<{ tenantId: string; campaignId: string } | null>(keyShare(shareSlug), null);
  if (!ptr) return null;
  const stats = await getDmCampaignStats(ptr.tenantId, ptr.campaignId).catch(() => null);
  if (!stats || !stats.campaign.reportShareEnabled) return null;

  // Salt okunur toplu sayılar: kullanıcı adı veya yorum metni KESİNLİKLE döndürülmez
  return {
    campaignName: stats.campaign.name,
    status: stats.campaign.status,
    mediaThumbUrl: stats.campaign.mediaThumbUrl,
    mediaPermalink: stats.campaign.mediaPermalink,
    funnel: stats.funnel,
    hourlySeries: stats.hourlySeries,
    reasonBreakdown: stats.reasonBreakdown,
    links: stats.linkStats.map((l) => ({
      label: l.label,
      clicks: l.clicks,
      uniqueClicks: l.uniqueClicks,
    })),
  };
}

// ───────────── Arka Plan İşleri (Polling, Next Reel, Token Yenileme, KVKK) ─────────────

export async function reconcileAccountComments(now = new Date()): Promise<{ checked: number; processed: number }> {
  const lookbackHours = envInt("COMMENT_POLL_LOOKBACK_HOURS", 72);
  const maxPerSweep = envInt("COMMENT_POLL_MAX_PER_SWEEP", 30);
  const recentMediaLimit = 10;
  const lookbackCutoff = now.getTime() - lookbackHours * 3600_000;

  const conns = await prisma.channelConnection.findMany({
    where: { provider: "INSTAGRAM", status: "ACTIVE" },
    select: { id: true, tenantId: true, externalIds: true },
  });

  let checked = 0;
  let processed = 0;

  for (const conn of conns) {
    const ext = (conn.externalIds ?? {}) as Record<string, unknown>;
    const igUserId = String(ext.ig_user_id ?? "");
    if (!igUserId) continue;

    const accounts = await listDmInstagramAccounts(conn.tenantId);
    const account = accounts.find((a) => a.id === conn.id);
    if (!account) continue;
    if (account.pollPausedUntil && new Date(account.pollPausedUntil).getTime() > now.getTime()) {
      continue;
    }

    const campaigns = (await loadJson<DmCampaignRecord[]>(keyCampaigns(conn.tenantId), []))
      .filter((c) => c.igAccountId === account.id && c.status === "ACTIVE");
    if (campaigns.length === 0) continue;

    const token = await resolveAccountToken(conn.tenantId, account);
    const mediaIds = new Set<string>();
    for (const c of campaigns) {
      if (c.mediaId) mediaIds.add(c.mediaId);
    }

    if (campaigns.some((c) => c.triggerMode === "ANY_POST")) {
      const recent = await dmMetaTransport()
        .listMedia({ igUserId, token, limit: recentMediaLimit })
        .catch(() => ({ items: [], nextCursor: null }));
      for (const m of recent.items) mediaIds.add(m.id);
    }

    let sweepCount = 0;
    for (const mediaId of mediaIds) {
      if (sweepCount >= maxPerSweep) break;
      try {
        const comments = await dmMetaTransport().listMediaComments({
          mediaId,
          igUserId,
          token,
          limit: maxPerSweep - sweepCount,
        });
        checked += comments.length;
        for (const cm of comments) {
          if (sweepCount >= maxPerSweep) break;
          const ts = new Date(cm.timestamp);
          if (ts.getTime() < lookbackCutoff) continue;
          if (cm.repliedByOwner) continue;
          if (!cm.from?.id || cm.from.id === igUserId) continue;

          sweepCount += 1;
          const res = await processCommentEvent(
            conn.tenantId,
            {
              igAccountId: igUserId,
              commentId: cm.id,
              text: cm.text,
              commenterId: cm.from.id,
              commenterUsername: cm.from.username ?? null,
              mediaId,
              mediaProductType: null,
              originalMediaId: null,
              adId: null,
              parentId: null,
              timestamp: ts,
              isOwnComment: false,
            },
            { source: "POLLING", nowMs: now.getTime() },
          );
          if (res.processed) processed += 1;
        }
      } catch (err) {
        const { code } = classifyDmDeliveryError(err);
        if (code === 368) {
          await withTenantLock(conn.tenantId, async () => {
            const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(conn.tenantId), {});
            metaMap[account.id] = {
              ...(metaMap[account.id] ?? {}),
              pollPausedUntil: new Date(now.getTime() + 3600_000).toISOString(),
            };
            await saveJson(keyAccountsMeta(conn.tenantId), metaMap);
          });
          break;
        }
      }
    }
  }

  await recordWorkerHeartbeat().catch(() => undefined);
  return { checked, processed };
}

export async function attachNextReelJob(now = new Date()): Promise<{ attached: number }> {
  const conns = await prisma.channelConnection.findMany({
    where: { provider: "INSTAGRAM", status: "ACTIVE" },
    select: { id: true, tenantId: true, externalIds: true },
  });

  let attached = 0;
  for (const conn of conns) {
    const campaigns = await loadJson<DmCampaignRecord[]>(keyCampaigns(conn.tenantId), []);
    const pending = campaigns.filter(
      (c) => c.igAccountId === conn.id && c.pendingNextReel && c.status === "ACTIVE",
    );
    if (pending.length === 0) continue;

    const accounts = await listDmInstagramAccounts(conn.tenantId);
    const account = accounts.find((a) => a.id === conn.id);
    if (!account) continue;

    const token = await resolveAccountToken(conn.tenantId, account);
    const media = await dmMetaTransport().listMedia({ igUserId: account.igUserId, token, limit: 10 }).catch(() => null);
    if (!media) continue;

    for (const c of pending) {
      const createdAtMs = new Date(c.createdAt).getTime();
      const newestReel = media.items.find(
        (m) =>
          (m.mediaProductType === "REELS" || m.mediaType === "REELS") &&
          new Date(m.timestamp).getTime() > createdAtMs,
      );
      if (!newestReel) continue;
      await withTenantLock(conn.tenantId, async () => {
        const list = await loadJson<DmCampaignRecord[]>(keyCampaigns(conn.tenantId), []);
        const idx = list.findIndex((x) => x.id === c.id);
        if (idx === -1) return;
        list[idx] = {
          ...list[idx]!,
          mediaId: newestReel.id,
          mediaPermalink: newestReel.permalink,
          mediaThumbUrl: newestReel.thumbnailUrl,
          mediaCaption: newestReel.caption,
          pendingNextReel: false,
          updatedAt: now.toISOString(),
        };
        await saveJson(keyCampaigns(conn.tenantId), list);
        attached += 1;
      });
    }
  }
  return { attached };
}

export async function refreshIgTokensJob(now = new Date()): Promise<{ refreshed: number; failed: number }> {
  const conns = await prisma.channelConnection.findMany({
    where: { provider: "INSTAGRAM", status: "ACTIVE" },
    select: { id: true, tenantId: true },
  });

  let refreshed = 0;
  let failed = 0;
  const tenDaysMs = 10 * 86_400_000;

  for (const conn of conns) {
    const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(conn.tenantId), {});
    const meta = metaMap[conn.id];
    if (!meta?.tokenExpiresAt) continue;
    if (new Date(meta.tokenExpiresAt).getTime() - now.getTime() > tenDaysMs) continue;

    const accounts = await listDmInstagramAccounts(conn.tenantId);
    const account = accounts.find((a) => a.id === conn.id);
    if (!account) continue;

    try {
      const curToken = await resolveAccountToken(conn.tenantId, account);
      const next = await dmMetaTransport().refreshLongLivedToken({ token: curToken });
      await vault().put(conn.tenantId, "instagram", next.accessToken);
      metaMap[conn.id] = {
        ...meta,
        tokenCiphertext: encryptMetaToken(next.accessToken),
        tokenExpiresAt: new Date(now.getTime() + next.expiresInSeconds * 1000).toISOString(),
        status: "CONNECTED",
      };
      await saveJson(keyAccountsMeta(conn.tenantId), metaMap);
      refreshed += 1;
    } catch (err) {
      failed += 1;
      await handleAccountReauthRequired(conn.tenantId, conn.id, (err as Error).message);
    }
  }
  return { refreshed, failed };
}

export async function runDmRetentionJob(now = new Date()): Promise<{
  maskedLogs: number;
  purgedClicks: number;
  purgedOps: number;
}> {
  const textDays = envInt("DM_RETENTION_TEXT_DAYS", 90);
  const textCutoff = now.getTime() - textDays * 86_400_000;
  const opsCutoff = now.getTime() - 30 * 86_400_000;
  const clickCutoff = now.getTime() - 365 * 86_400_000;

  let maskedLogs = 0;
  let purgedClicks = 0;
  let purgedOps = 0;

  // 1. OperationalEvent bodyPreview 30 gün sonra silinir
  const ops = await loadJson<DmOperationalEvent[]>(KEY_OPS_EVENTS, []);
  const nextOps = ops.map((o) => {
    if (o.bodyPreview && new Date(o.createdAt).getTime() < opsCutoff) {
      purgedOps += 1;
      return { ...o, bodyPreview: null };
    }
    return o;
  });
  if (purgedOps > 0) await saveJson(KEY_OPS_EVENTS, nextOps);

  // 2. Tenant bazlı log ve tıklama temizliği
  const logKeys = await prisma.configValue.findMany({
    where: { key: { startsWith: "dm_auto:logs:" } },
    select: { key: true },
  });
  for (const row of logKeys) {
    const tenantId = row.key.slice("dm_auto:logs:".length);
    await withTenantLock(tenantId, async () => {
      const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
      let changed = false;
      const nextLogs = logs.map((l) => {
        const ts = new Date(l.createdAt).getTime();
        if (ts < textCutoff && (l.triggerText !== null || l.recipientUsername !== null)) {
          changed = true;
          maskedLogs += 1;
          return {
            ...l,
            triggerText: null,
            recipientUsername: null,
            ...(ts < clickCutoff && !l.recipientIgsid.startsWith("hash_")
              ? { recipientIgsid: `hash_${createRecipientToken(l.recipientIgsid)}` }
              : {}),
          };
        }
        return l;
      });
      if (changed) await saveJson(keyLogs(tenantId), nextLogs);

      const clicks = await loadJson<DmLinkClickRecord[]>(keyClicks(tenantId), []);
      const keptClicks = clicks.filter((c) => new Date(c.createdAt).getTime() >= clickCutoff);
      if (keptClicks.length !== clicks.length) {
        purgedClicks += clicks.length - keptClicks.length;
        await saveJson(keyClicks(tenantId), keptClicks);
      }
    });
  }

  return { maskedLogs, purgedClicks, purgedOps };
}

/** KVKK Unutulma Hakkı: Kişinin IGSID'sine ait DmLog ve tıklama kayıtlarını siler (opt-out kaydı meşru menfaatle korunur). */
export async function deleteRecipientDmDataKvkk(
  tenantId: string,
  igsid: string,
  actorId: string,
): Promise<{ deletedLogs: number; deletedClicks: number }> {
  let deletedLogs = 0;
  let deletedClicks = 0;
  const recipientHash = createRecipientToken(igsid);

  await withTenantLock(tenantId, async () => {
    const logs = await loadJson<DmLogRecord[]>(keyLogs(tenantId), []);
    const keptLogs = logs.filter((l) => l.recipientIgsid !== igsid);
    deletedLogs = logs.length - keptLogs.length;
    if (deletedLogs > 0) await saveJson(keyLogs(tenantId), keptLogs);

    const clicks = await loadJson<DmLinkClickRecord[]>(keyClicks(tenantId), []);
    const keptClicks = clicks.filter((c) => c.recipientHash !== recipientHash);
    deletedClicks = clicks.length - keptClicks.length;
    if (deletedClicks > 0) await saveJson(keyClicks(tenantId), keptClicks);
  });

  await recordDmAudit(tenantId, actorId, "kvkk.recipient.delete", `anon_${recipientHash.slice(0, 6)}`, {
    deletedLogs,
    deletedClicks,
  });
  return { deletedLogs, deletedClicks };
}

// ───────────── Başlangıç Örnek Verisi ─────────────

export async function ensureInitialDmAutomationData(tenantId: string): Promise<void> {
  const existingCampaigns = await loadJson<DmCampaignRecord[] | null>(keyCampaigns(tenantId), null);
  if (existingCampaigns !== null) return;

  await withTenantLock(tenantId, async () => {
    const recheck = await loadJson<DmCampaignRecord[] | null>(keyCampaigns(tenantId), null);
    if (recheck !== null) return;

    let igConn = await prisma.channelConnection.findFirst({
      where: { tenantId, provider: "INSTAGRAM" },
      orderBy: { createdAt: "desc" },
    });

    if (!igConn) {
      igConn = await prisma.channelConnection.create({
        data: {
          tenantId,
          provider: "INSTAGRAM",
          externalIds: {
            ig_user_id: `17841400_${tenantId.slice(-6)}`,
            ig_username: "nordvow.creator",
            account_type: "CREATOR",
          },
          tokenRef: `demo:ig:${tenantId}`,
          scopes: [
            "instagram_business_basic",
            "instagram_business_manage_messages",
            "instagram_business_manage_comments",
          ],
          status: "ACTIVE",
          connectedAt: new Date(Date.now() - 12 * 86_400_000),
          lastVerifiedAt: new Date(),
        },
      });
    }

    const ext = (igConn.externalIds ?? {}) as Record<string, unknown>;
    const igUserId = String(ext.ig_user_id ?? `17841400_${tenantId.slice(-6)}`);

    const metaMap = await loadJson<AccountMetaMap>(keyAccountsMeta(tenantId), {});
    if (!metaMap[igConn.id]) {
      metaMap[igConn.id] = {
        webhookSubscribed: true,
        tokenExpiresAt: new Date(Date.now() + 48 * 86_400_000).toISOString(),
        lastWebhookAt: new Date(Date.now() - 14 * 60_000).toISOString(),
        status: "CONNECTED",
      };
      await saveJson(keyAccountsMeta(tenantId), metaMap);
    }

    const now = Date.now();
    const camp1Id = `dmc_demo_kod_${tenantId.slice(-6)}`;
    const camp2Id = `dmc_demo_link_${tenantId.slice(-6)}`;

    const buttons1 = await syncCampaignTrackedLinks(tenantId, camp1Id, "Sonbahar Kupon Reel", [
      { label: "Kuponu Kullan", url: "https://nordvow.com/kampanya/sonbahar" },
    ]);
    const buttons2 = await syncCampaignTrackedLinks(tenantId, camp2Id, "Creator Rehber İndir", [
      { label: "Rehberi İndir", url: "https://nordvow.com/docs" },
    ]);

    const demoCampaigns: DmCampaignRecord[] = [
      {
        id: camp1Id,
        tenantId,
        igAccountId: igConn.id,
        igUserId,
        name: "Sonbahar %25 İndirim Kodu Reel",
        status: "ACTIVE",
        triggerMode: "SPECIFIC_POST",
        mediaId: "ig_media_reel_sonbahar",
        mediaPermalink: "https://www.instagram.com/reel/C_NordvowSonbahar/",
        mediaThumbUrl: null,
        mediaCaption: "Yeni sezon kapsül koleksiyonu yayında! %25 indirim kodunu DM ile almak için yoruma KOD yaz ✨ #reklam",
        pendingNextReel: false,
        dmTriggerEnabled: true,
        keywords: ["KOD", "İNDİRİM", "FIRSAT"],
        matchMode: "WHOLE_WORD",
        dmText: "Merhaba @{username}! ✨ Sonbahar koleksiyonunda geçerli %25 indirim kodun: {kupon}\n\nHemen kullanmak için aşağıdaki butona dokunabilirsin: {link}",
        dmFooter: DEFAULT_DM_FOOTER,
        buttons: buttons1,
        openingDmEnabled: false,
        openingDmText: null,
        openingDmButtonLabel: "Kodu göster",
        publicReplyEnabled: true,
        publicReplies: [
          "DM'den gönderdik 💌",
          "Mesaj kutunu kontrol et ✨",
          "Kodun DM olarak iletildi, keyfini çıkar!",
        ],
        nordvowCampaignId: null,
        couponId: null,
        couponCode: "NORDVOW25",
        repeatPolicy: "DAILY",
        sendCap: 500,
        sentCount: 38,
        startsAt: null,
        endsAt: null,
        complianceAckAt: new Date(now - 3 * 86_400_000).toISOString(),
        complianceAckById: "system",
        reportShareSlug: null,
        reportShareEnabled: false,
        createdById: "system",
        createdAt: new Date(now - 3 * 86_400_000).toISOString(),
        updatedAt: new Date(now - 3600_000).toISOString(),
      },
      {
        id: camp2Id,
        tenantId,
        igAccountId: igConn.id,
        igUserId,
        name: "Creator Kiti & İşbirliği Rehberi",
        status: "ACTIVE",
        triggerMode: "SPECIFIC_POST",
        mediaId: "ig_media_post_rehber",
        mediaPermalink: "https://www.instagram.com/p/C_NordvowRehber/",
        mediaThumbUrl: null,
        mediaCaption: "Creator kiti ve kampanya takvimi PDF bağlantısı için yoruma LİNK yazabilirsin 👇",
        pendingNextReel: false,
        dmTriggerEnabled: false,
        keywords: ["LİNK", "REHBER", "KİTAP"],
        matchMode: "WHOLE_WORD",
        dmText: "Selam @{username}, Creator işbirliği rehberini ve medya kitini senin için hazırladık: {link}",
        dmFooter: DEFAULT_DM_FOOTER,
        buttons: buttons2,
        openingDmEnabled: false,
        openingDmText: null,
        openingDmButtonLabel: "Rehberi aç",
        publicReplyEnabled: true,
        publicReplies: ["Bağlantıyı DM ile ilettik 👇", "Mesaj isteklerini kontrol edebilirsin ✨"],
        nordvowCampaignId: null,
        couponId: null,
        couponCode: null,
        repeatPolicy: "DAILY",
        sendCap: null,
        sentCount: 14,
        startsAt: null,
        endsAt: null,
        complianceAckAt: new Date(now - 5 * 86_400_000).toISOString(),
        complianceAckById: "system",
        reportShareSlug: null,
        reportShareEnabled: false,
        createdById: "system",
        createdAt: new Date(now - 5 * 86_400_000).toISOString(),
        updatedAt: new Date(now - 7200_000).toISOString(),
      },
    ];
    await saveJson(keyCampaigns(tenantId), demoCampaigns);

    const demoLogs: DmLogRecord[] = [
      {
        id: `dmlog_demo_1_${tenantId.slice(-4)}`,
        tenantId,
        campaignId: camp1Id,
        igAccountId: igConn.id,
        source: "WEBHOOK",
        commentId: "1799000111222",
        triggerMessageId: null,
        recipientIgsid: "igsid_demo_zeynep",
        recipientUsername: "zeynep.kaya",
        triggerText: "KOD lütfen 🙏",
        matchedKeyword: "KOD",
        commentCreatedAt: new Date(now - 2 * 3600_000).toISOString(),
        status: "SENT",
        attempts: 1,
        dmDeliveryUnconfirmed: false,
        dmMessageId: "ig_pr_demo_1",
        dmSentAt: new Date(now - 2 * 3600_000 + 2000).toISOString(),
        errorCode: null,
        errorMessage: null,
        publicReplyText: "DM'den gönderdik 💌",
        publicReplySentAt: new Date(now - 2 * 3600_000 + 1500).toISOString(),
        publicReplyUnconfirmed: false,
        publicReplyError: null,
        requeueAttempt: 0,
        createdAt: new Date(now - 2 * 3600_000).toISOString(),
        updatedAt: new Date(now - 2 * 3600_000 + 2000).toISOString(),
      },
      {
        id: `dmlog_demo_2_${tenantId.slice(-4)}`,
        tenantId,
        campaignId: camp1Id,
        igAccountId: igConn.id,
        source: "WEBHOOK",
        commentId: "1799000111223",
        triggerMessageId: null,
        recipientIgsid: "igsid_demo_mert",
        recipientUsername: "mert.demir",
        triggerText: "indirim kodu alabilir miyim",
        matchedKeyword: "İNDİRİM",
        commentCreatedAt: new Date(now - 5 * 3600_000).toISOString(),
        status: "SENT",
        attempts: 1,
        dmDeliveryUnconfirmed: false,
        dmMessageId: "ig_pr_demo_2",
        dmSentAt: new Date(now - 5 * 3600_000 + 3000).toISOString(),
        errorCode: null,
        errorMessage: null,
        publicReplyText: "Mesaj kutunu kontrol et ✨",
        publicReplySentAt: new Date(now - 5 * 3600_000 + 2000).toISOString(),
        publicReplyUnconfirmed: false,
        publicReplyError: null,
        requeueAttempt: 0,
        createdAt: new Date(now - 5 * 3600_000).toISOString(),
        updatedAt: new Date(now - 5 * 3600_000 + 3000).toISOString(),
      },
      {
        id: `dmlog_demo_3_${tenantId.slice(-4)}`,
        tenantId,
        campaignId: camp1Id,
        igAccountId: igConn.id,
        source: "POLLING",
        commentId: "1799000111224",
        triggerMessageId: null,
        recipientIgsid: "igsid_demo_zeynep",
        recipientUsername: "zeynep.kaya",
        triggerText: "KOD!!",
        matchedKeyword: "KOD",
        commentCreatedAt: new Date(now - 3600_000).toISOString(),
        status: "SKIPPED_DUPLICATE_RECIPIENT",
        attempts: 0,
        dmDeliveryUnconfirmed: false,
        dmMessageId: null,
        dmSentAt: null,
        errorCode: null,
        errorMessage: null,
        publicReplyText: null,
        publicReplySentAt: null,
        publicReplyUnconfirmed: false,
        publicReplyError: null,
        requeueAttempt: 0,
        createdAt: new Date(now - 3600_000).toISOString(),
        updatedAt: new Date(now - 3600_000).toISOString(),
      },
    ];
    await saveJson(keyLogs(tenantId), demoLogs);

    if (buttons1[0]) {
      let demoRecipientHash: string | null = null;
      try {
        demoRecipientHash = createRecipientToken("igsid_demo_zeynep");
      } catch {
        demoRecipientHash = null;
      }
      await saveJson(keyClicks(tenantId), [
        {
          id: `dmc_clk_demo1_${tenantId.slice(-4)}`,
          tenantId,
          campaignId: camp1Id,
          linkId: buttons1[0].trackedLinkId,
          recipientHash: demoRecipientHash,
          ipHash: null,
          userAgent: "Mozilla/5.0 (iPhone)",
          referrer: "https://l.instagram.com/",
          isBot: false,
          createdAt: new Date(now - 90 * 60_000).toISOString(),
        },
      ]);
    }
  });
}
