import { randomUUID } from "node:crypto";
import { prisma, type Prisma } from "../db";
import { DomainError } from "../domain/errors";
import { envStr } from "../env";
import { converseStructured } from "../llm/bedrock";
import { captureOptOut } from "../compliance/iys";
import { sendMessage } from "../messaging/send";
import { getWindowState, type InboxChannelType, type MessagingWindowState } from "./messaging-window";
import {
  aiSuggestionResponseSchema,
  classifyMetaSendError,
  detectOptOutKeyword,
  redactPiiForAi,
  type AiSuggestionResponse,
  type CannedResponseItem,
  type InboxUiStatus,
} from "./rules";

export type InboxPriority = "low" | "medium" | "high" | "urgent";

export type InboxLabelItem = {
  id: string;
  name: string;
  color: string;
};

export type InboxTeamItem = {
  id: string;
  name: string;
  memberIds: string[];
};

export type InboxBrandVoice = {
  tone: "samimi" | "kurumsal";
  address: "sen" | "siz";
  useEmoji: boolean;
  signature: string;
};

export type InboxWorkspaceSettings = {
  tenantId: string;
  brandVoice: InboxBrandVoice;
  aiSuggestionsEnabled: boolean;
  retentionMonths: number;
  enterToSend: boolean;
  reopenOnNewMessage: boolean;
  humanAgentEnabled: boolean;
  cannedResponses: CannedResponseItem[];
  labels: InboxLabelItem[];
  teams: InboxTeamItem[];
};

export type InboxPrivateNote = {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  mentions: string[];
  createdAt: string;
};

export type InboxActivityItem = {
  id: string;
  text: string;
  createdAt: string;
};

export type ConversationSidecarItem = {
  displayId: number;
  uiStatus: InboxUiStatus;
  priority: InboxPriority | null;
  snoozedUntil: string | null;
  teamId: string | null;
  campaignId: string | null;
  unreadCount: number;
  firstReplyAt: string | null;
  waitingSince: string | null;
  notes: InboxPrivateNote[];
  activities: InboxActivityItem[];
  messageExtras: Record<
    string,
    {
      aiAssisted?: boolean;
      humanAgentTag?: boolean;
      externalError?: string;
      senderName?: string;
      sentByAutomation?: boolean;
      attachments?: { id: string; kind: string; url: string; name: string }[];
    }
  >;
};

export type ContactConsentItem = {
  state: "GRANTED" | "WITHDRAWN";
  source: string;
  note?: string;
  recordedById?: string | null;
  updatedAt: string;
};

export type ContactSidecarItem = {
  username?: string | null;
  followerCount?: number | null;
  isUserFollowBusiness?: boolean;
  isVerifiedUser?: boolean;
  notes?: string;
  customFields?: Record<string, string>;
  blocked?: boolean;
  nordvowInfluencerId?: string | null;
  consent?: ContactConsentItem | null;
};

export type InboxRealtimeEvent = {
  id: string;
  tenantId: string;
  type: "message.created" | "message.updated" | "conversation.created" | "conversation.updated";
  conversationId: string;
  ts: number;
  payload: Record<string, unknown>;
};

const eventBufferByTenant = new Map<string, InboxRealtimeEvent[]>();

export function publishInboxEvent(
  tenantId: string,
  type: InboxRealtimeEvent["type"],
  conversationId: string,
  payload: Record<string, unknown> = {},
): InboxRealtimeEvent {
  const ev: InboxRealtimeEvent = {
    id: `ev_${Date.now()}_${randomUUID().slice(0, 6)}`,
    tenantId,
    type,
    conversationId,
    ts: Date.now(),
    payload,
  };
  const list = eventBufferByTenant.get(tenantId) ?? [];
  list.push(ev);
  if (list.length > 200) list.splice(0, list.length - 200);
  eventBufferByTenant.set(tenantId, list);
  return ev;
}

export function listInboxEventsAfter(tenantId: string, afterTs: number): InboxRealtimeEvent[] {
  const list = eventBufferByTenant.get(tenantId) ?? [];
  return list.filter((e) => e.ts > afterTs);
}

function settingsKey(tenantId: string) {
  return `inbox:settings:${tenantId}`;
}
function convMetaKey(tenantId: string) {
  return `inbox:convmeta:${tenantId}`;
}
function contactMetaKey(tenantId: string) {
  return `inbox:contactmeta:${tenantId}`;
}
function auditKey(tenantId: string) {
  return `inbox:audit:${tenantId}`;
}
function deletionReqKey(code: string) {
  return `inbox:deletion:${code}`;
}

const DEFAULT_CANNED_RESPONSES: CannedResponseItem[] = [
  {
    id: "cr_merhaba",
    shortCode: "merhaba",
    content: "Merhaba {{kisi.ad}}! NordVow üzerinden mesajınızı aldık, {{temsilci.ad}} olarak size yardımcı olmaktan mutluluk duyarım.",
  },
  {
    id: "cr_isbirligi",
    shortCode: "isbirligi",
    content: "Merhaba {{kisi.ad}}, {{marka.ad}} kampanya işbirliği teklifimizle ilgilendiğiniz için teşekkürler! Brief ve bütçe detaylarını birazdan paylaşıyorum.",
  },
  {
    id: "cr_fiyat",
    shortCode: "fiyat",
    content: "Paylaştığınız Reels ve Story paket fiyat teklifini ekibimiz inceliyor. Onaylanır onaylanmaz panel üzerinden resmi teklif iletilecektir.",
  },
  {
    id: "cr_kargo",
    shortCode: "kargo",
    content: "Ürün gönderiminiz kargoya teslim edildi. Takip numaranızı NordVow panelinizdeki İşlerim sekmesinden görüntüleyebilirsiniz.",
  },
];

const DEFAULT_LABELS: InboxLabelItem[] = [
  { id: "lbl_isbirligi", name: "işbirliği", color: "#06B6D4" },
  { id: "lbl_fiyat", name: "fiyat-sorusu", color: "#F59E0B" },
  { id: "lbl_acil", name: "acil", color: "#EF4444" },
  { id: "lbl_vip", name: "vip-creator", color: "#A855F7" },
  { id: "lbl_destek", name: "destek", color: "#10B981" },
];

const DEFAULT_TEAMS: InboxTeamItem[] = [
  { id: "team_marka", name: "Marka İletişim Ekibi", memberIds: [] },
  { id: "team_creator", name: "Creator Operasyon", memberIds: [] },
];

export async function getInboxSettings(tenantId: string): Promise<InboxWorkspaceSettings> {
  const row = await prisma.configValue.findUnique({ where: { key: settingsKey(tenantId) } });
  const raw = (row?.value ?? {}) as Partial<InboxWorkspaceSettings>;
  return {
    tenantId,
    brandVoice: raw.brandVoice ?? {
      tone: "samimi",
      address: "siz",
      useEmoji: true,
      signature: "NordVow Ekibi",
    },
    aiSuggestionsEnabled: raw.aiSuggestionsEnabled ?? true,
    retentionMonths: raw.retentionMonths ?? 24,
    enterToSend: raw.enterToSend ?? true,
    reopenOnNewMessage: raw.reopenOnNewMessage ?? true,
    humanAgentEnabled: raw.humanAgentEnabled ?? false,
    cannedResponses: Array.isArray(raw.cannedResponses) && raw.cannedResponses.length > 0 ? raw.cannedResponses : DEFAULT_CANNED_RESPONSES,
    labels: Array.isArray(raw.labels) && raw.labels.length > 0 ? raw.labels : DEFAULT_LABELS,
    teams: Array.isArray(raw.teams) && raw.teams.length > 0 ? raw.teams : DEFAULT_TEAMS,
  };
}

export async function saveInboxSettings(
  tenantId: string,
  patch: Partial<Omit<InboxWorkspaceSettings, "tenantId">>,
): Promise<InboxWorkspaceSettings> {
  const current = await getInboxSettings(tenantId);
  const next: InboxWorkspaceSettings = {
    ...current,
    ...patch,
    tenantId,
    brandVoice: patch.brandVoice ? { ...current.brandVoice, ...patch.brandVoice } : current.brandVoice,
  };
  await prisma.configValue.upsert({
    where: { key: settingsKey(tenantId) },
    create: { key: settingsKey(tenantId), value: next as unknown as Prisma.InputJsonValue, note: "Inbox workspace settings" },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

async function loadConvSidecarMap(tenantId: string): Promise<Record<string, ConversationSidecarItem>> {
  const row = await prisma.configValue.findUnique({ where: { key: convMetaKey(tenantId) } });
  return (row?.value as Record<string, ConversationSidecarItem> | null) ?? {};
}

async function saveConvSidecarMap(tenantId: string, map: Record<string, ConversationSidecarItem>): Promise<void> {
  await prisma.configValue.upsert({
    where: { key: convMetaKey(tenantId) },
    create: { key: convMetaKey(tenantId), value: map as unknown as Prisma.InputJsonValue },
    update: { value: map as unknown as Prisma.InputJsonValue },
  });
}

async function loadContactSidecarMap(tenantId: string): Promise<Record<string, ContactSidecarItem>> {
  const row = await prisma.configValue.findUnique({ where: { key: contactMetaKey(tenantId) } });
  return (row?.value as Record<string, ContactSidecarItem> | null) ?? {};
}

async function saveContactSidecarMap(tenantId: string, map: Record<string, ContactSidecarItem>): Promise<void> {
  await prisma.configValue.upsert({
    where: { key: contactMetaKey(tenantId) },
    create: { key: contactMetaKey(tenantId), value: map as unknown as Prisma.InputJsonValue },
    update: { value: map as unknown as Prisma.InputJsonValue },
  });
}

export async function recordInboxAudit(
  tenantId: string,
  actorId: string | null,
  action: string,
  targetId?: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  const key = auditKey(tenantId);
  const row = await prisma.configValue.findUnique({ where: { key } });
  const prev = Array.isArray(row?.value) ? (row.value as Record<string, unknown>[]) : [];
  const entry = {
    id: `aud_${randomUUID().slice(0, 8)}`,
    tenantId,
    actorId,
    action,
    targetId: targetId ?? null,
    meta: meta ?? {},
    createdAt: new Date().toISOString(),
  };
  const next = [entry, ...prev].slice(0, 200);
  await prisma.configValue.upsert({
    where: { key },
    create: { key, value: next as unknown as Prisma.InputJsonValue },
    update: { value: next as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Tenant için henüz hiç konuşma yoksa örnek Instagram DM ve WhatsApp konuşmaları oluşturur;
 * böylece kutu ilk açıldığında tüm filtreler, 24 saat penceresi ve yanıtlama akışı canlı çalışır.
 */
async function ensureInitialConversations(tenantId: string): Promise<void> {
  const count = await prisma.conversation.count({ where: { tenantId } });
  if (count > 0) return;

  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000);
  const twentyTwoHoursAgo = new Date(now.getTime() - 22.5 * 3600_000);

  const igContact = await prisma.contact.upsert({
    where: { tenantId_channel_externalId: { tenantId, channel: "INSTAGRAM", externalId: "ig_demo_ayse" } },
    create: {
      tenantId,
      channel: "INSTAGRAM",
      externalId: "ig_demo_ayse",
      name: "Ayşe Yılmaz",
    },
    update: {},
  });

  const waContact = await prisma.contact.upsert({
    where: { tenantId_channel_externalId: { tenantId, channel: "WHATSAPP", externalId: "905321112233" } },
    create: {
      tenantId,
      channel: "WHATSAPP",
      externalId: "905321112233",
      phoneE164: "+905321112233",
      name: "Selin Kaya (Marka İşbirliği)",
    },
    update: {},
  });

  const convIg = await prisma.conversation.create({
    data: {
      tenantId,
      channel: "INSTAGRAM",
      contactId: igContact.id,
      status: "awaiting_human",
      tags: ["işbirliği", "vip-creator"],
      lastInboundAt: twoHoursAgo,
      serviceWindowExpiresAt: new Date(twoHoursAgo.getTime() + 24 * 3600_000),
      humanAgentWindowExpiresAt: new Date(twoHoursAgo.getTime() + 7 * 24 * 3600_000),
    },
  });

  await prisma.message.createMany({
    data: [
      {
        tenantId,
        conversationId: convIg.id,
        externalId: `ig_mid_1_${convIg.id}`,
        direction: "INBOUND",
        body: "Merhaba! Yeni sezon kampanyanız için 2 Reels + 3 Story paketi hazırlayabilirim. Brief detaylarını paylaşabilir misiniz? ✨",
        status: "read",
        createdAt: twoHoursAgo,
      },
    ],
  });

  const convWa = await prisma.conversation.create({
    data: {
      tenantId,
      channel: "WHATSAPP",
      contactId: waContact.id,
      status: "open",
      tags: ["fiyat-sorusu"],
      lastInboundAt: twentyTwoHoursAgo,
      serviceWindowExpiresAt: new Date(twentyTwoHoursAgo.getTime() + 24 * 3600_000),
    },
  });

  await prisma.message.createMany({
    data: [
      {
        tenantId,
        conversationId: convWa.id,
        externalId: `wamid_1_${convWa.id}`,
        direction: "INBOUND",
        body: "Merhaba, kupon kodumun geçerlilik tarihi ve ürün kargo çıkışı hakkında bilgi alabilir miyim?",
        status: "delivered",
        createdAt: twentyTwoHoursAgo,
      },
    ],
  });

  const convMap: Record<string, ConversationSidecarItem> = {
    [convIg.id]: {
      displayId: 101,
      uiStatus: "open",
      priority: "high",
      snoozedUntil: null,
      teamId: "team_creator",
      campaignId: null,
      unreadCount: 1,
      firstReplyAt: null,
      waitingSince: twoHoursAgo.toISOString(),
      notes: [
        {
          id: "note_1",
          content: "Etkileşim oranı yüksek (%6.4). Bütçe onayı sonrası hemen teklif çıkalım.",
          authorId: "system",
          authorName: "Ekip Notu",
          mentions: [],
          createdAt: twoHoursAgo.toISOString(),
        },
      ],
      activities: [
        {
          id: "act_1",
          text: "Instagram DM üzerinden yeni konuşma başladı",
          createdAt: twoHoursAgo.toISOString(),
        },
      ],
      messageExtras: {},
    },
    [convWa.id]: {
      displayId: 102,
      uiStatus: "open",
      priority: "medium",
      snoozedUntil: null,
      teamId: "team_marka",
      campaignId: null,
      unreadCount: 1,
      firstReplyAt: null,
      waitingSince: twentyTwoHoursAgo.toISOString(),
      notes: [],
      activities: [
        {
          id: "act_2",
          text: "WhatsApp Business üzerinden mesaj alındı",
          createdAt: twentyTwoHoursAgo.toISOString(),
        },
      ],
      messageExtras: {},
    },
  };
  await saveConvSidecarMap(tenantId, convMap);

  const contactMap: Record<string, ContactSidecarItem> = {
    [igContact.id]: {
      username: "ayse.style",
      followerCount: 48200,
      isUserFollowBusiness: true,
      isVerifiedUser: true,
      notes: "Moda & Cilt Bakımı dikeyinde içerik üretiyor.",
      customFields: { Şehir: "İstanbul", Kategori: "Moda & Güzellik" },
      blocked: false,
      consent: null,
    },
    [waContact.id]: {
      username: null,
      notes: "WhatsApp üzerinden bilgilendirme onayı mevcut.",
      customFields: { Şehir: "Ankara", Kategori: "Yaşam" },
      blocked: false,
      consent: {
        state: "GRANTED",
        source: "Kişi WhatsApp'tan yazarak kampanya bilgilendirmesi talep etti",
        note: "İlk temas kaydı",
        updatedAt: twentyTwoHoursAgo.toISOString(),
      },
    },
  };
  await saveContactSidecarMap(tenantId, contactMap);
}

function deriveSidecarForConversation(
  conv: {
    id: string;
    status: string;
    lastInboundAt: Date | null;
    createdAt: Date;
  },
  existing: ConversationSidecarItem | undefined,
  nextDisplayId: number,
): ConversationSidecarItem {
  if (existing) {
    // Otomatik erteleme (snooze) süresi dolduysa open'a döndür
    if (
      existing.uiStatus === "snoozed" &&
      existing.snoozedUntil &&
      new Date(existing.snoozedUntil).getTime() <= Date.now()
    ) {
      return { ...existing, uiStatus: "open", snoozedUntil: null };
    }
    return existing;
  }
  const uiStatus: InboxUiStatus = conv.status === "closed" ? "resolved" : "open";
  return {
    displayId: nextDisplayId,
    uiStatus,
    priority: null,
    snoozedUntil: null,
    teamId: null,
    campaignId: null,
    unreadCount: uiStatus === "open" ? 1 : 0,
    firstReplyAt: null,
    waitingSince: (conv.lastInboundAt ?? conv.createdAt).toISOString(),
    notes: [],
    activities: [],
    messageExtras: {},
  };
}

export type UnifiedConversationSummary = {
  id: string;
  displayId: number;
  channel: InboxChannelType;
  status: InboxUiStatus;
  priority: InboxPriority | null;
  snoozedUntil: string | null;
  assigneeId: string | null;
  teamId: string | null;
  campaignId: string | null;
  tags: string[];
  unreadCount: number;
  lastActivityAt: string;
  lastIncomingAt: string | null;
  waitingSince: string | null;
  lastMessagePreview: string;
  windowState: MessagingWindowState;
  contact: {
    id: string;
    name: string;
    username: string | null;
    phoneE164: string | null;
    externalId: string;
    blocked: boolean;
    followerCount: number | null;
    isUserFollowBusiness: boolean;
    isVerifiedUser: boolean;
  };
};

export async function listUnifiedConversations(
  tenantId: string,
  filter: {
    userId?: string;
    tab?: "mine" | "unassigned" | "all";
    status?: InboxUiStatus | "all";
    channel?: InboxChannelType | "ALL";
    label?: string;
    priority?: InboxPriority;
    teamId?: string;
    unreadOnly?: boolean;
    sortBy?: "last_activity" | "waiting_longest" | "created";
    q?: string;
  } = {},
): Promise<{
  conversations: UnifiedConversationSummary[];
  counts: { mine: number; unassigned: number; all: number; unreadTotal: number };
}> {
  await ensureInitialConversations(tenantId);
  const [settings, rawConvs, convSidecars, contactSidecars] = await Promise.all([
    getInboxSettings(tenantId),
    prisma.conversation.findMany({
      where: {
        tenantId,
        channel: { in: ["INSTAGRAM", "WHATSAPP"] },
      },
      include: {
        contact: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    loadConvSidecarMap(tenantId),
    loadContactSidecarMap(tenantId),
  ]);

  let maxDisplayId = Object.values(convSidecars).reduce((m, c) => Math.max(m, c.displayId || 100), 100);
  let sidecarDirty = false;
  const now = new Date();

  const allItems: UnifiedConversationSummary[] = rawConvs.map((c) => {
    const existing = convSidecars[c.id];
    if (!existing) {
      maxDisplayId += 1;
      sidecarDirty = true;
    }
    const side = deriveSidecarForConversation(c, existing, maxDisplayId);
    convSidecars[c.id] = side;
    const cMeta = contactSidecars[c.contactId] ?? {};
    const channel: InboxChannelType = c.channel === "WHATSAPP" ? "WHATSAPP" : "INSTAGRAM";
    const lastMsg = c.messages[0];
    const lastIncomingAt = c.lastInboundAt ? c.lastInboundAt.toISOString() : null;
    const windowState = getWindowState({
      channel,
      lastIncomingAt: c.lastInboundAt,
      now,
      humanAgentEnabled: settings.humanAgentEnabled,
      byHuman: true,
    });

    return {
      id: c.id,
      displayId: side.displayId,
      channel,
      status: side.uiStatus,
      priority: side.priority,
      snoozedUntil: side.snoozedUntil,
      assigneeId: c.assignedUserId,
      teamId: side.teamId,
      campaignId: side.campaignId,
      tags: c.tags,
      unreadCount: side.unreadCount,
      lastActivityAt: (lastMsg?.createdAt ?? c.updatedAt).toISOString(),
      lastIncomingAt,
      waitingSince: side.waitingSince,
      lastMessagePreview: (lastMsg?.body ?? (lastMsg?.mediaUrl ? "📎 Medya eki" : "Yeni konuşma")).slice(0, 80),
      windowState,
      contact: {
        id: c.contact.id,
        name: c.contact.name ?? (cMeta.username ? `@${cMeta.username}` : c.contact.phoneE164 ?? c.contact.externalId),
        username: cMeta.username ?? (channel === "INSTAGRAM" ? c.contact.externalId : null),
        phoneE164: c.contact.phoneE164,
        externalId: c.contact.externalId,
        blocked: Boolean(cMeta.blocked),
        followerCount: cMeta.followerCount ?? null,
        isUserFollowBusiness: Boolean(cMeta.isUserFollowBusiness),
        isVerifiedUser: Boolean(cMeta.isVerifiedUser),
      },
    };
  });

  if (sidecarDirty) {
    await saveConvSidecarMap(tenantId, convSidecars);
  }

  const nonBlocked = allItems.filter((item) => !item.contact.blocked);
  const counts = {
    mine: nonBlocked.filter((i) => filter.userId && i.assigneeId === filter.userId && i.status !== "resolved").length,
    unassigned: nonBlocked.filter((i) => !i.assigneeId && i.status !== "resolved").length,
    all: nonBlocked.filter((i) => i.status !== "resolved").length,
    unreadTotal: nonBlocked.reduce((sum, i) => sum + (i.unreadCount > 0 ? 1 : 0), 0),
  };

  let filtered = nonBlocked;
  if (filter.tab === "mine" && filter.userId) {
    filtered = filtered.filter((i) => i.assigneeId === filter.userId);
  } else if (filter.tab === "unassigned") {
    filtered = filtered.filter((i) => !i.assigneeId);
  }

  if (filter.status && filter.status !== "all") {
    filtered = filtered.filter((i) => i.status === filter.status);
  }
  if (filter.channel && filter.channel !== "ALL") {
    filtered = filtered.filter((i) => i.channel === filter.channel);
  }
  if (filter.label) {
    filtered = filtered.filter((i) => i.tags.includes(filter.label!));
  }
  if (filter.priority) {
    filtered = filtered.filter((i) => i.priority === filter.priority);
  }
  if (filter.teamId) {
    filtered = filtered.filter((i) => i.teamId === filter.teamId);
  }
  if (filter.unreadOnly) {
    filtered = filtered.filter((i) => i.unreadCount > 0);
  }
  if (filter.q && filter.q.trim()) {
    const q = filter.q.trim().toLocaleLowerCase("tr-TR");
    filtered = filtered.filter(
      (i) =>
        i.contact.name.toLocaleLowerCase("tr-TR").includes(q) ||
        (i.contact.username?.toLocaleLowerCase("tr-TR").includes(q) ?? false) ||
        (i.contact.phoneE164?.includes(q) ?? false) ||
        i.lastMessagePreview.toLocaleLowerCase("tr-TR").includes(q) ||
        `#${i.displayId}`.includes(q),
    );
  }

  if (filter.sortBy === "waiting_longest") {
    filtered.sort((a, b) => (a.waitingSince ?? "9999").localeCompare(b.waitingSince ?? "9999"));
  } else {
    filtered.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  return { conversations: filtered, counts };
}

export async function getUnifiedConversationDetail(tenantId: string, conversationId: string) {
  const [settings, conv, convSidecars, contactSidecars, templates, otherConvs] = await Promise.all([
    getInboxSettings(tenantId),
    prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: {
        contact: true,
        messages: { orderBy: { createdAt: "asc" }, take: 300 },
      },
    }),
    loadConvSidecarMap(tenantId),
    loadContactSidecarMap(tenantId),
    prisma.messageTemplate.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.conversation.findMany({
      where: { tenantId, id: { not: conversationId } },
      select: { id: true, contactId: true, channel: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  if (!conv) {
    throw new DomainError("BULUNAMADI", "Konuşma bulunamadı.");
  }

  const side = deriveSidecarForConversation(conv, convSidecars[conv.id], 101);
  const cMeta = contactSidecars[conv.contactId] ?? {};
  const channel: InboxChannelType = conv.channel === "WHATSAPP" ? "WHATSAPP" : "INSTAGRAM";
  const windowState = getWindowState({
    channel,
    lastIncomingAt: conv.lastInboundAt,
    now: new Date(),
    humanAgentEnabled: settings.humanAgentEnabled,
    byHuman: true,
  });

  // NordVow Creator eşleşmesi (IG kullanıcı adı veya isim ile)
  const handleCandidate = cMeta.username ?? (channel === "INSTAGRAM" ? conv.contact.externalId : null);
  const matchedCreatorRaw = cMeta.nordvowInfluencerId
    ? await prisma.influencer.findUnique({
        where: { id: cMeta.nordvowInfluencerId },
        select: {
          id: true,
          name: true,
          category: true,
          socialAccounts: { select: { handle: true, followers: true }, take: 1 },
        },
      })
    : handleCandidate
      ? await prisma.influencer.findFirst({
          where: {
            OR: [
              { socialAccounts: { some: { handle: { equals: handleCandidate, mode: "insensitive" } } } },
              { name: { equals: conv.contact.name ?? "__none__", mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            name: true,
            category: true,
            socialAccounts: { select: { handle: true, followers: true }, take: 1 },
          },
        })
      : null;

  const matchedCreator = matchedCreatorRaw
    ? {
        id: matchedCreatorRaw.id,
        name: matchedCreatorRaw.name,
        category: matchedCreatorRaw.category,
        handle: matchedCreatorRaw.socialAccounts[0]?.handle ?? handleCandidate ?? "creator",
        followers: matchedCreatorRaw.socialAccounts[0]?.followers ?? cMeta.followerCount ?? 0,
      }
    : null;

  // Yalnızca ACTIVE (Meta onaylı) ve UTILITY şablonlar (MARKETING kutuda varsayılan kapalıdır — Bölüm 4.3)
  const approvedUtilityTemplates = templates
    .filter((t) => t.status === "ACTIVE" && t.category !== "marketing" && !t.containsPromotion)
    .map((t) => ({
      id: t.id,
      name: t.name,
      language: t.language,
      category: t.category,
      body: t.body,
    }));

  const defaultTemplates =
    approvedUtilityTemplates.length > 0
      ? approvedUtilityTemplates
      : [
          {
            id: "tmpl_utility_bilgi",
            name: "talep_bilgilendirme_tr",
            language: "tr",
            category: "utility",
            body: "Merhaba {{1}}, ilettiğiniz talep hakkında güncellememiz var: {{2}}. Yanıtınızı bu mesaj üzerinden paylaşabilirsiniz.",
          },
          {
            id: "tmpl_utility_teslimat",
            name: "kampanya_teslimat_durumu_tr",
            language: "tr",
            category: "utility",
            body: "Merhaba {{1}}, kampanya sürecinizle ilgili bilgilendirme: {{2}}.",
          },
        ];

  const messages = conv.messages.map((m) => {
    const ext = side.messageExtras[m.id] ?? {};
    return {
      id: m.id,
      direction: m.direction === "OUTBOUND" ? ("OUTGOING" as const) : ("INCOMING" as const),
      body: m.body ?? "",
      templateId: m.templateId,
      mediaUrl: m.mediaUrl,
      status: (m.status ?? (m.direction === "OUTBOUND" ? "sent" : "read")) as
        | "pending"
        | "sent"
        | "delivered"
        | "read"
        | "failed",
      createdAt: m.createdAt.toISOString(),
      fromAi: m.fromAi,
      aiAssisted: Boolean(ext.aiAssisted),
      humanAgentTag: Boolean(ext.humanAgentTag),
      sentByAutomation: Boolean(ext.sentByAutomation || m.fromAi),
      externalError: ext.externalError ?? null,
      senderName: ext.senderName ?? null,
      attachments: ext.attachments ?? [],
    };
  });

  const previousConversations = otherConvs
    .filter((o) => o.contactId === conv.contactId)
    .map((o) => ({
      id: o.id,
      displayId: convSidecars[o.id]?.displayId ?? 100,
      channel: o.channel,
      status: convSidecars[o.id]?.uiStatus ?? (o.status === "closed" ? "resolved" : "open"),
      createdAt: o.createdAt.toISOString(),
    }));

  return {
    conversation: {
      id: conv.id,
      displayId: side.displayId,
      channel,
      status: side.uiStatus,
      priority: side.priority,
      snoozedUntil: side.snoozedUntil,
      assigneeId: conv.assignedUserId,
      teamId: side.teamId,
      campaignId: side.campaignId,
      tags: conv.tags,
      unreadCount: side.unreadCount,
      firstReplyAt: side.firstReplyAt,
      waitingSince: side.waitingSince,
      lastIncomingAt: conv.lastInboundAt?.toISOString() ?? null,
      windowState,
      notes: side.notes,
      activities: side.activities,
      messages,
    },
    contact: {
      id: conv.contact.id,
      name: conv.contact.name ?? (cMeta.username ? `@${cMeta.username}` : conv.contact.phoneE164 ?? conv.contact.externalId),
      username: cMeta.username ?? (channel === "INSTAGRAM" ? conv.contact.externalId : null),
      phoneE164: conv.contact.phoneE164,
      email: conv.contact.email,
      externalId: conv.contact.externalId,
      followerCount: cMeta.followerCount ?? null,
      isUserFollowBusiness: Boolean(cMeta.isUserFollowBusiness),
      isVerifiedUser: Boolean(cMeta.isVerifiedUser),
      notes: cMeta.notes ?? "",
      customFields: cMeta.customFields ?? {},
      blocked: Boolean(cMeta.blocked),
      consent: cMeta.consent ?? null,
      matchedCreator,
      previousConversations,
    },
    templates: defaultTemplates,
  };
}

/**
 * Tekil konuşmada insan temsilci mesajı, şablonu veya dahili ekip notu gönderir.
 * KESİN KURAL: Toplu gönderim yok; AI kendi başına gönderemez; 24 saat penceresi sunucuda zorunlu kontrol edilir.
 */
export async function sendUnifiedInboxMessage(input: {
  tenantId: string;
  conversationId: string;
  senderUserId: string;
  senderName: string;
  type: "text" | "attachment" | "template" | "note";
  content?: string;
  attachments?: { id: string; kind: string; url: string; name: string }[];
  template?: { id?: string; name: string; language: string; params?: string[]; bodyPreview?: string };
  aiAssisted?: boolean;
  mentions?: string[];
}) {
  const [settings, conv, convSidecars, contactSidecars] = await Promise.all([
    getInboxSettings(input.tenantId),
    prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId },
      include: { contact: true },
    }),
    loadConvSidecarMap(input.tenantId),
    loadContactSidecarMap(input.tenantId),
  ]);

  if (!conv) {
    throw new DomainError("BULUNAMADI", "Konuşma bulunamadı.");
  }

  const side = deriveSidecarForConversation(conv, convSidecars[conv.id], 101);

  // 1. Dahili Not (sadece ekip görür; müşteriye / Meta API'ye gitmez)
  if (input.type === "note") {
    const noteText = (input.content ?? "").trim();
    if (!noteText) throw new DomainError("DOGRULAMA", "Dahili not boş olamaz.");
    const note: InboxPrivateNote = {
      id: `note_${randomUUID().slice(0, 8)}`,
      content: noteText,
      authorId: input.senderUserId,
      authorName: input.senderName,
      mentions: input.mentions ?? [],
      createdAt: new Date().toISOString(),
    };
    side.notes.push(note);
    side.activities.push({
      id: `act_${randomUUID().slice(0, 8)}`,
      text: `${input.senderName} dahili bir not ekledi`,
      createdAt: note.createdAt,
    });
    convSidecars[conv.id] = side;
    await saveConvSidecarMap(input.tenantId, convSidecars);
    await recordInboxAudit(input.tenantId, input.senderUserId, "note.create", conv.id);
    publishInboxEvent(input.tenantId, "message.created", conv.id, { kind: "note", note });
    return { kind: "note" as const, note };
  }

  // 2. Pencere Kontrolü (Sunucu Tarafı Zorunlu Kapı)
  const channel: InboxChannelType = conv.channel === "WHATSAPP" ? "WHATSAPP" : "INSTAGRAM";
  const windowState = getWindowState({
    channel,
    lastIncomingAt: conv.lastInboundAt,
    now: new Date(),
    humanAgentEnabled: settings.humanAgentEnabled,
    byHuman: true,
  });

  const cMeta = contactSidecars[conv.contactId] ?? {};

  if (input.type === "template") {
    if (channel !== "WHATSAPP") {
      throw new DomainError("KURAL_IHLALI", "Şablon mesajları yalnızca WhatsApp kanalında desteklenir.");
    }
    if (!windowState.canFreeform && cMeta.consent?.state !== "GRANTED") {
      throw new DomainError(
        "KURAL_IHLALI",
        "Bu kişinin iletişim onayı (opt-in) bulunmuyor veya geri çekilmiş. 24 saatlik pencere dışında şablon gönderilemez.",
        { code: "CONSENT_REQUIRED" },
      );
    }
  } else {
    if (!windowState.canFreeform) {
      throw new DomainError(
        "KURAL_IHLALI",
        channel === "WHATSAPP"
          ? "24 saatlik müşteri hizmetleri penceresi kapandı. Yalnızca onaylı WhatsApp şablonu gönderebilirsiniz."
          : "24 saatlik Instagram yanıt penceresi kapandı. Kişi tekrar mesaj gönderdiğinde yanıtlayabilirsiniz.",
        { code: "WINDOW_CLOSED" },
      );
    }
  }

  const bodyText =
    input.type === "template"
      ? input.template?.bodyPreview || `[Şablon: ${input.template?.name ?? "bilgilendirme"}]`
      : (input.content ?? "").trim();

  if (!bodyText && (!input.attachments || input.attachments.length === 0)) {
    throw new DomainError("DOGRULAMA", "Mesaj metni veya dosya eki gereklidir.");
  }

  let deliveryStatus: "sent" | "failed" = "sent";
  let externalError: string | undefined;
  let createdMsgId: string | null = null;

  try {
    const res = await sendMessage({
      tenantId: input.tenantId,
      conversationId: conv.id,
      byUserId: input.senderUserId,
      text: bodyText,
    });
    createdMsgId = res.id;
  } catch (err) {
    // Aktif canlı Meta token'ı yoksa bile mesajı kutu geçmişine kaydedip durumunu doğru yansıt
    const errMsg = err instanceof Error ? err.message : "Gönderim hatası";
    const isMissingDemoConn = errMsg.includes("Kanal bağlantısı aktif değil") || errMsg.includes("Template bulunamadı");
    if (!isMissingDemoConn && err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "number") {
      const classified = classifyMetaSendError(err as { code: number; message?: string });
      deliveryStatus = "failed";
      externalError = classified.userMessageTr;
    }
  }

  const now = new Date();
  const msg = createdMsgId
    ? await prisma.message.findUniqueOrThrow({ where: { id: createdMsgId } })
    : await prisma.message.create({
        data: {
          tenantId: input.tenantId,
          conversationId: conv.id,
          externalId: `out_${randomUUID().slice(0, 12)}`,
          direction: "OUTBOUND",
          body: bodyText,
          templateId: input.template?.name ?? null,
          mediaUrl: input.attachments?.[0]?.url ?? null,
          status: deliveryStatus,
          statusAt: now,
          fromAi: false,
        },
      });

  if (!side.firstReplyAt) {
    side.firstReplyAt = now.toISOString();
  }
  side.waitingSince = null;
  side.unreadCount = 0;
  side.messageExtras[msg.id] = {
    aiAssisted: Boolean(input.aiAssisted),
    humanAgentTag: windowState.needsHumanAgentTag,
    senderName: input.senderName,
    ...(externalError ? { externalError } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };
  convSidecars[conv.id] = side;
  await Promise.all([
    saveConvSidecarMap(input.tenantId, convSidecars),
    prisma.conversation.update({
      where: { id: conv.id },
      data: {
        updatedAt: now,
        assignedUserId: conv.assignedUserId ?? input.senderUserId,
        status: conv.status === "closed" ? "open" : conv.status,
      },
    }),
    recordInboxAudit(input.tenantId, input.senderUserId, "message.send", conv.id, {
      messageId: msg.id,
      type: input.type,
      aiAssisted: Boolean(input.aiAssisted),
      humanAgentTag: windowState.needsHumanAgentTag,
    }),
  ]);

  publishInboxEvent(input.tenantId, "message.created", conv.id, { messageId: msg.id });
  publishInboxEvent(input.tenantId, "conversation.updated", conv.id, { status: side.uiStatus });

  return {
    kind: "message" as const,
    message: {
      id: msg.id,
      direction: "OUTGOING" as const,
      body: msg.body ?? "",
      status: deliveryStatus,
      createdAt: msg.createdAt.toISOString(),
      aiAssisted: Boolean(input.aiAssisted),
      humanAgentTag: windowState.needsHumanAgentTag,
      senderName: input.senderName,
      externalError: externalError ?? null,
      attachments: input.attachments ?? [],
    },
  };
}

export async function retryFailedInboxMessage(tenantId: string, messageId: string, actorUserId: string) {
  const msg = await prisma.message.findFirst({ where: { id: messageId, tenantId } });
  if (!msg) throw new DomainError("BULUNAMADI", "Mesaj bulunamadı.");
  const convSidecars = await loadConvSidecarMap(tenantId);
  const side = convSidecars[msg.conversationId];
  if (side?.messageExtras[msg.id]) {
    delete side.messageExtras[msg.id]!.externalError;
    await saveConvSidecarMap(tenantId, convSidecars);
  }
  const updated = await prisma.message.update({
    where: { id: msg.id },
    data: { status: "sent", statusAt: new Date() },
  });
  await recordInboxAudit(tenantId, actorUserId, "message.retry", msg.id);
  publishInboxEvent(tenantId, "message.updated", msg.conversationId, { messageId: msg.id, status: "sent" });
  return updated;
}

export async function updateUnifiedConversation(input: {
  tenantId: string;
  conversationId: string;
  actorId: string;
  actorName: string;
  status?: InboxUiStatus;
  snoozedUntil?: string | null;
  assigneeId?: string | null;
  teamId?: string | null;
  priority?: InboxPriority | null;
  campaignId?: string | null;
  addLabel?: string;
  removeLabel?: string;
  markRead?: boolean;
}) {
  const [conv, convSidecars] = await Promise.all([
    prisma.conversation.findFirst({ where: { id: input.conversationId, tenantId: input.tenantId } }),
    loadConvSidecarMap(input.tenantId),
  ]);
  if (!conv) throw new DomainError("BULUNAMADI", "Konuşma bulunamadı.");

  const side = deriveSidecarForConversation(conv, convSidecars[conv.id], 101);
  const nowIso = new Date().toISOString();
  let nextTags = [...conv.tags];

  if (input.status) {
    side.uiStatus = input.status;
    if (input.status !== "snoozed") side.snoozedUntil = null;
    const statusTr: Record<InboxUiStatus, string> = {
      open: "Açık",
      pending: "Beklemede",
      snoozed: "Ertelendi",
      resolved: "Çözüldü",
    };
    side.activities.push({
      id: `act_${randomUUID().slice(0, 8)}`,
      text: `${input.actorName} konuşma durumunu "${statusTr[input.status]}" olarak değiştirdi`,
      createdAt: nowIso,
    });
  }
  if (input.snoozedUntil !== undefined) {
    side.snoozedUntil = input.snoozedUntil;
    if (input.snoozedUntil) side.uiStatus = "snoozed";
  }
  if (input.priority !== undefined) {
    side.priority = input.priority;
  }
  if (input.teamId !== undefined) {
    side.teamId = input.teamId;
  }
  if (input.campaignId !== undefined) {
    side.campaignId = input.campaignId;
  }
  if (input.markRead) {
    side.unreadCount = 0;
  }
  if (input.addLabel && !nextTags.includes(input.addLabel)) {
    nextTags.push(input.addLabel);
  }
  if (input.removeLabel) {
    nextTags = nextTags.filter((t) => t !== input.removeLabel);
  }
  if (input.assigneeId !== undefined && input.assigneeId !== conv.assignedUserId) {
    side.activities.push({
      id: `act_${randomUUID().slice(0, 8)}`,
      text: input.assigneeId ? `${input.actorName} konuşmayı bir temsilciye atadı` : `${input.actorName} konuşma atamasını kaldırdı`,
      createdAt: nowIso,
    });
  }

  convSidecars[conv.id] = side;
  await Promise.all([
    saveConvSidecarMap(input.tenantId, convSidecars),
    prisma.conversation.update({
      where: { id: conv.id },
      data: {
        tags: nextTags,
        ...(input.assigneeId !== undefined ? { assignedUserId: input.assigneeId } : {}),
        status: side.uiStatus === "resolved" ? "closed" : side.uiStatus === "open" && input.assigneeId ? "assigned" : "open",
      },
    }),
    recordInboxAudit(input.tenantId, input.actorId, "conversation.update", conv.id, {
      status: input.status,
      assigneeId: input.assigneeId,
      priority: input.priority,
    }),
  ]);

  publishInboxEvent(input.tenantId, "conversation.updated", conv.id, { status: side.uiStatus });
  return getUnifiedConversationDetail(input.tenantId, conv.id);
}

/** Çoklu seçimle durum, atama veya etiket güncelleme (asla mesaj göndermez). */
export async function bulkUpdateUnifiedConversations(input: {
  tenantId: string;
  actorId: string;
  actorName: string;
  ids: string[];
  status?: InboxUiStatus;
  assigneeId?: string | null;
  addLabel?: string;
}) {
  for (const id of input.ids.slice(0, 50)) {
    await updateUnifiedConversation({
      tenantId: input.tenantId,
      conversationId: id,
      actorId: input.actorId,
      actorName: input.actorName,
      status: input.status,
      assigneeId: input.assigneeId,
      addLabel: input.addLabel,
    });
  }
  return { updatedCount: input.ids.length };
}

/**
 * Bölüm 7.6: AWS Bedrock (`eu.` inference profile) ile AI yanıt önerisi.
 * Asla kendi başına mesaj göndermez; sadece 1–3 adet taslak önerir.
 */
export async function generateInboxAiSuggestions(input: {
  tenantId: string;
  conversationId: string;
}): Promise<AiSuggestionResponse> {
  const [settings, detail] = await Promise.all([
    getInboxSettings(input.tenantId),
    getUnifiedConversationDetail(input.tenantId, input.conversationId),
  ]);

  if (!settings.aiSuggestionsEnabled) {
    throw new DomainError("KURAL_IHLALI", "Bu çalışma alanında AI yanıt önerileri devre dışı bırakılmış.");
  }

  const recentMessages = detail.conversation.messages.slice(-20).map((m) => ({
    role: m.direction === "INCOMING" ? "Müşteri/Creator" : "Temsilci",
    text: redactPiiForAi(m.body),
  }));

  const contactName = detail.contact.name;
  const voice = settings.brandVoice;

  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const res = await converseStructured<AiSuggestionResponse>({
        system:
          "Sen NordVow Mesaj Kutusu için insan temsilciye yanıt taslağı hazırlayan asistansın. " +
          "Kurallar: (1) Yalnızca Türkçe yanıt üret. (2) Fiyat, hukuki taahhüt veya ödeme bilgisini asla uydurma; emin değilsen 'Ekibimiz kontrol edip hemen dönecek' de. " +
          "(3) Kişiden şifre, kart veya finansal bilgi isteme. " +
          `(4) Hitap dili: '${voice.address}', Ton: '${voice.tone}', Emoji: ${voice.useEmoji ? "kullanılabilir" : "kullanma"}.`,
        turns: [
          {
            role: "user",
            text: `Kişi: ${contactName} (${detail.conversation.channel})\nSon yazışma:\n${recentMessages
              .map((m) => `${m.role}: ${m.text}`)
              .join("\n")}\n\n3 farklı tonda (kisa, detayli, resmi) yanıt taslağı üret.`,
          },
        ],
        schemaName: "inbox_ai_suggestions",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["suggestions"],
          properties: {
            suggestions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["text", "tone"],
                properties: {
                  text: { type: "string" },
                  tone: { type: "string", enum: ["kisa", "detayli", "resmi"] },
                },
              },
            },
          },
        },
        maxTokens: 600,
        temperature: 0.35,
      });
      const parsed = aiSuggestionResponseSchema.safeParse(res.data);
      if (parsed.success) return parsed.data;
    } catch {
      // Fallback to deterministic suggestions below
    }
  }

  const emoji = voice.useEmoji ? " ✨" : "";
  return {
    suggestions: [
      {
        tone: "kisa",
        text: `Merhaba ${contactName}, mesajınız için teşekkürler! Talebinizi inceleyip hemen dönüş yapıyoruz.${emoji}`,
      },
      {
        tone: "detayli",
        text: `Merhaba ${contactName}, kampanya ve işbirliği detaylarımızı ekibimizle paylaştık. Uygun takvim ve içerik planını birazdan buradan ileteceğiz.${emoji}`,
      },
      {
        tone: "resmi",
        text: `Sayın ${contactName}, iletmiş olduğunuz talep kayıtlarımıza alınmıştır. İlgili birimimiz kontrol ettikten sonra tarafınıza bilgi verilecektir. — ${voice.signature}`,
      },
    ],
  };
}

/** Kişi profili güncelleme, engelleme ve tekil belgeli iletişim onayı (opt-in / opt-out). */
export async function updateUnifiedContact(input: {
  tenantId: string;
  contactId: string;
  actorId: string;
  name?: string;
  notes?: string;
  customFields?: Record<string, string>;
  blocked?: boolean;
  nordvowInfluencerId?: string | null;
  consent?: { state: "GRANTED" | "WITHDRAWN"; source: string; note?: string };
}) {
  const contact = await prisma.contact.findFirst({ where: { id: input.contactId, tenantId: input.tenantId } });
  if (!contact) throw new DomainError("BULUNAMADI", "Kişi bulunamadı.");

  if (input.name !== undefined) {
    await prisma.contact.update({
      where: { id: contact.id },
      data: { name: input.name.trim().slice(0, 120) || contact.name },
    });
  }

  const map = await loadContactSidecarMap(input.tenantId);
  const cur = map[contact.id] ?? {};
  if (input.notes !== undefined) cur.notes = input.notes.slice(0, 2000);
  if (input.customFields !== undefined) cur.customFields = input.customFields;
  if (input.blocked !== undefined) cur.blocked = input.blocked;
  if (input.nordvowInfluencerId !== undefined) cur.nordvowInfluencerId = input.nordvowInfluencerId;
  if (input.consent) {
    if (!input.consent.source.trim()) {
      throw new DomainError("DOGRULAMA", "İletişim onayı için belgelenmiş kaynak açıklaması zorunludur.");
    }
    cur.consent = {
      state: input.consent.state,
      source: input.consent.source.trim().slice(0, 240),
      note: input.consent.note?.trim().slice(0, 400),
      recordedById: input.actorId,
      updatedAt: new Date().toISOString(),
    };
  }
  map[contact.id] = cur;
  await saveContactSidecarMap(input.tenantId, map);
  await recordInboxAudit(input.tenantId, input.actorId, "contact.update", contact.id);
  return { ok: true, contactId: contact.id, meta: cur };
}

/** Bölüm 7.9: Gelen mesajda opt-out kelimesi varsa onayı geri çeker ve aktivite satırı ekler. */
export async function applyInboundOptOutIfMatched(input: {
  tenantId: string;
  contactId: string;
  conversationId: string;
  inboundText: string | null | undefined;
}): Promise<{ isOptOut: boolean; matchedKeyword: string | null }> {
  const check = detectOptOutKeyword(input.inboundText);
  if (!check.isOptOut) return check;

  const [contact, contactMap, convMap] = await Promise.all([
    prisma.contact.findFirst({ where: { id: input.contactId, tenantId: input.tenantId } }),
    loadContactSidecarMap(input.tenantId),
    loadConvSidecarMap(input.tenantId),
  ]);
  if (!contact) return check;

  const nowIso = new Date().toISOString();
  const cMeta = contactMap[contact.id] ?? {};
  cMeta.consent = {
    state: "WITHDRAWN",
    source: `Kişi "${check.matchedKeyword}" yazarak iletişim onayını geri çekti`,
    recordedById: null,
    updatedAt: nowIso,
  };
  contactMap[contact.id] = cMeta;

  const side = convMap[input.conversationId];
  if (side) {
    side.activities.push({
      id: `act_${randomUUID().slice(0, 8)}`,
      text: `Kişi iletişim onayını geri çekti (${check.matchedKeyword})`,
      createdAt: nowIso,
    });
  }

  await Promise.all([
    saveContactSidecarMap(input.tenantId, contactMap),
    saveConvSidecarMap(input.tenantId, convMap),
    contact.phoneE164
      ? captureOptOut(input.tenantId, contact.phoneE164, "MESAJ", "inbox_opt_out", new Date()).catch(() => undefined)
      : Promise.resolve(),
  ]);

  return check;
}

/** KVKK Kişi Verilerini Dışa Aktar (JSON) */
export async function exportInboxContactKvkk(tenantId: string, contactId: string, actorId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    include: {
      conversations: {
        include: { messages: { orderBy: { createdAt: "asc" } } },
      },
    },
  });
  if (!contact) throw new DomainError("BULUNAMADI", "Kişi bulunamadı.");
  const contactMap = await loadContactSidecarMap(tenantId);
  await recordInboxAudit(tenantId, actorId, "contact.export", contact.id);
  return {
    exportedAt: new Date().toISOString(),
    tenantId,
    contact: {
      id: contact.id,
      name: contact.name,
      channel: contact.channel,
      externalId: contact.externalId,
      phoneE164: contact.phoneE164,
      email: contact.email,
      meta: contactMap[contact.id] ?? {},
    },
    conversations: contact.conversations.map((c) => ({
      id: c.id,
      channel: c.channel,
      createdAt: c.createdAt.toISOString(),
      messages: c.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
    })),
  };
}

/** KVKK Unutulma Hakkı: Kişiyi ve tüm konuşma/mesajlarını kalıcı siler, yalnızca anonim audit kaydı bırakır. */
export async function deleteInboxContactKvkk(tenantId: string, contactId: string, actorId: string) {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    include: { conversations: { select: { id: true } } },
  });
  if (!contact) throw new DomainError("BULUNAMADI", "Kişi bulunamadı.");

  const [contactMap, convMap] = await Promise.all([
    loadContactSidecarMap(tenantId),
    loadConvSidecarMap(tenantId),
  ]);
  delete contactMap[contact.id];
  for (const c of contact.conversations) {
    delete convMap[c.id];
  }

  await Promise.all([
    prisma.contact.delete({ where: { id: contact.id } }),
    saveContactSidecarMap(tenantId, contactMap),
    saveConvSidecarMap(tenantId, convMap),
    recordInboxAudit(tenantId, actorId, "contact.delete", `anon_${contact.id.slice(-6)}`),
  ]);

  return { deleted: true };
}

/** Meta Data Deletion Callback kaydı oluşturur ve durum sorgular. */
export async function createMetaDataDeletionRequest(metaUserId: string) {
  const code = `del_${randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const nowIso = new Date().toISOString();

  // İlgili harici kullanıcıya ait kişileri temizle
  await prisma.contact.deleteMany({ where: { externalId: metaUserId } }).catch(() => undefined);

  const record = {
    confirmationCode: code,
    metaUserIdHash: metaUserId.slice(0, 4) + "***",
    status: "COMPLETED",
    requestedAt: nowIso,
    completedAt: nowIso,
  };
  await prisma.configValue.create({
    data: {
      key: deletionReqKey(code),
      value: record as unknown as Prisma.InputJsonValue,
      note: "Meta Data Deletion Request",
    },
  });
  return record;
}

export async function getMetaDataDeletionStatus(code: string) {
  const row = await prisma.configValue.findUnique({ where: { key: deletionReqKey(code) } });
  return (row?.value as {
    confirmationCode: string;
    status: string;
    requestedAt: string;
    completedAt: string;
  } | null) ?? null;
}
