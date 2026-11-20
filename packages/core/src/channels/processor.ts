import { prisma } from "../db";
import { envStr } from "../env";
import { getConfig, setConfig } from "../config/store";
import { captureOptOut, OPT_OUT_RE } from "../compliance/iys";
import type { ChannelProvider } from "../generated/prisma/enums";
import { runAgentTurn } from "../assistant/runtime";
import { handleChannelBotTurn } from "../assistant/channel-bot";
import { prescreenCreator } from "../assistant/prescreen";
import { recordRun } from "../agents/common";
import { matchInstagramAutoReply } from "../messaging/instagram-auto-reply";
import { purgeMessage } from "../messaging/purge";
import { bumpDailyStat, sendMessage } from "../messaging/send";
import { applyTemplateQuality, applyTemplateStatus, mapQuality, mapStatusEvent } from "../messaging/templates";
import { readLimitFromEvent } from "../messaging/tiers";
import { onInbound } from "../messaging/windows";
import { fetchIgSenderProfile, showTyping } from "./meta-client";
import { vault } from "./vault";
import { firstSeen, rawBodies } from "./webhook";
import { applyInboundOptOutIfMatched, publishInboxEvent } from "../inbox/store";
import { processInstagramWebhookForDmAutomation } from "../dm-automation/store";

/**
 * Webhook işlemcisi: external_ids → tenant_id çözümleme, dedupe, olay türüne göre dağıtım.
 * Sıralama garantisi yoktur: durum güncellemeleri zaman damgasına göre last-write-wins.
 */
type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function processRawWebhook(rawId: string, bodyOverride?: string) {
  const raw = await prisma.rawWebhook.findUnique({ where: { id: rawId } });
  if (!raw || raw.processedAt) return { skipped: true };
  const body = bodyOverride ?? rawBodies.get(rawId);
  rawBodies.delete(rawId);
  if (!body) {
    await prisma.rawWebhook.update({ where: { id: rawId }, data: { error: "gövde bulunamadı (S3'ten yeniden okunmalı)" } });
    return { skipped: true };
  }
  let tenantId: string | null = null;
  try {
    const payload = JSON.parse(body) as Any;
    tenantId = await dispatch(payload);
    await prisma.rawWebhook.update({ where: { id: rawId }, data: { processedAt: new Date(), tenantId } });
    return { skipped: false, tenantId };
  } catch (err) {
    await prisma.rawWebhook.update({ where: { id: rawId }, data: { error: String((err as Error).message).slice(0, 500) } });
    throw err;
  }
}

async function defaultSystemTenant() {
  const explicit = envStr("DEFAULT_TENANT_ID", "");
  if (explicit) return explicit;
  const brand = await prisma.brand.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } });
  return brand?.id ?? null;
}

async function tenantByPhoneNumberId(id: string) {
  const n = await prisma.whatsAppNumber.findUnique({ where: { phoneNumberId: id } });
  if (n?.tenantId) return n.tenantId;
  const globalWaId = envStr("WHATSAPP_PHONE_NUMBER_ID", "");
  if (globalWaId && id === globalWaId) return defaultSystemTenant();
  return null;
}

async function tenantByExternal(provider: ChannelProvider, key: string, value: string) {
  const c = await prisma.channelConnection.findFirst({ where: { provider, externalIds: { path: [key], equals: value } } });
  if (c?.tenantId) return c.tenantId;
  const globalIgId = envStr("INSTAGRAM_IG_USER_ID", "");
  if (provider === "INSTAGRAM" && globalIgId && value === globalIgId) return defaultSystemTenant();
  return null;
}

async function dispatch(p: Any): Promise<string | null> {
  if (p.object === "whatsapp_business_account") {
    let tenant: string | null = null;
    for (const entry of p.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        const t = v.metadata?.phone_number_id ? await tenantByPhoneNumberId(String(v.metadata.phone_number_id)) : await tenantByExternal("WHATSAPP", "waba_id", String(entry.id));
        tenant ??= t;
        if (!t) {
          console.warn(`[processor] WhatsApp tenant bulunamadı (phone_number_id=${v.metadata?.phone_number_id}, waba_id=${entry.id})`);
          continue;
        }
        await handleWhatsAppChange(t, change.field, v);
      }
    }
    return tenant;
  }
  if (p.object === "instagram" || p.object === "page") {
    const provider: ChannelProvider = p.object === "instagram" ? "INSTAGRAM" : "MESSENGER";
    const dmOutcome =
      provider === "INSTAGRAM"
        ? await processInstagramWebhookForDmAutomation(p).catch(() => ({
          commentsHandled: 0,
          messagesHandled: 0,
          postbacksHandled: 0,
          optOutsCaptured: 0,
          handledMessageIds: [] as string[],
        }))
        : { commentsHandled: 0, messagesHandled: 0, postbacksHandled: 0, optOutsCaptured: 0, handledMessageIds: [] as string[] };
    const dmHandledMids = new Set(dmOutcome.handledMessageIds);
    const hasGlobalIgToken = Boolean(envStr("INSTAGRAM_ACCESS_TOKEN", "") || envStr("META_IG_TOKEN", "") || envStr("META_SYSTEM_USER_TOKEN", ""));
    let tenant: string | null = null;
    for (const entry of p.entry ?? []) {
      let t = await tenantByExternal(provider, provider === "INSTAGRAM" ? "ig_user_id" : "page_id", String(entry.id));
      if (!t && provider === "INSTAGRAM") {
        t = await tenantByExternal("INSTAGRAM", "page_id", String(entry.id));
        if (!t) {
          const recId = entry.messaging?.[0]?.recipient?.id ?? entry.changes?.[0]?.value?.recipient?.id;
          if (recId) t = await tenantByExternal("INSTAGRAM", "ig_user_id", String(recId));
        }
        if (!t && hasGlobalIgToken) {
          t = await defaultSystemTenant();
        }
      }
      tenant ??= t;
      if (!t) {
        console.warn(`[processor] ${provider} tenant bulunamadı (entry.id=${entry.id})`);
        continue;
      }
      for (const m of entry.messaging ?? []) await handleMetaMessaging(t, provider, m, dmHandledMids);
      for (const change of entry.changes ?? []) {
        if (change.field === "messages" && change.value) {
          await handleMetaMessaging(t, provider, change.value, dmHandledMids);
        } else if (provider === "INSTAGRAM" && (change.field === "comments" || change.field === "mentions") && change.value) {
          await handleInstagramEngagementEvent(t, String(change.field), change.value).catch(() => undefined);
        }
      }
    }
    return tenant;
  }
  return null;
}

async function handleWhatsAppChange(tenantId: string, field: string, v: Any) {
  if (field === "messages") {
    const contacts = new Map<string, string>((v.contacts ?? []).map((c: Any) => [c.wa_id, c.profile?.name]));
    for (const m of v.messages ?? []) {
      if (!(await firstSeen(m.id, "whatsapp"))) continue;
      const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? null;
      await handleInbound(tenantId, "WHATSAPP", {
        externalMessageId: m.id,
        from: m.from,
        phoneE164: `+${m.from}`,
        name: contacts.get(m.from) ?? null,
        text,
        at: new Date(Number(m.timestamp) * 1000),
        fromAd: m.referral?.source_type === "ad" || !!m.referral?.ctwa_clid,
      });
    }
    for (const s of v.statuses ?? []) await applyMessageStatus(tenantId, s.id, s.status, new Date(Number(s.timestamp) * 1000));
    return;
  }
  if (field === "message_template_status_update" || field === "template_category_update") {
    const t = await prisma.messageTemplate.findFirst({ where: { tenantId, OR: [{ externalId: String(v.message_template_id) }, { name: v.message_template_name }] } });
    const st = mapStatusEvent(String(v.event ?? ""));
    if (t && st) await applyTemplateStatus(t.id, st, new Date());
    return;
  }
  if (field === "message_template_quality_update") {
    const t = await prisma.messageTemplate.findFirst({ where: { tenantId, OR: [{ externalId: String(v.message_template_id) }, { name: v.message_template_name }] } });
    if (t) await applyTemplateQuality(t.id, mapQuality(String(v.new_quality_score ?? "")));
    return;
  }
  if (field === "phone_number_quality_update") {
    const limit = readLimitFromEvent(v);
    const num = await prisma.whatsAppNumber.findUnique({ where: { tenantId } });
    if (num) {
      await prisma.whatsAppNumber.update({
        where: { id: num.id },
        data: { ...(limit ? { messagingLimit: limit } : {}), qualityRating: v.event ?? num.qualityRating, throughputLevel: v.throughput?.level ?? num.throughputLevel },
      });
    }
    // Throughput doğrulanmadı: ölçülen seviyeyi config'e yaz, hard-code etme.
    if (v.throughput?.level) {
      const map = await getConfig("whatsapp.throughputByLevel");
      if (typeof v.throughput.mps === "number") await setConfig("whatsapp.throughputByLevel", { ...map, [v.throughput.level]: v.throughput.mps });
    }
    return;
  }
  if (field === "business_capability_update" || field === "account_update" || field === "account_alerts") {
    if (String(v.event ?? v.alert_type ?? "").includes("INCREASED_CAPABILITIES_ELIGIBILITY_NEED_MORE_INFO")) {
      await prisma.whatsAppNumber.updateMany({ where: { tenantId }, data: { onboardingStep: "identity_verification" } });
    }
  }
}

/** Durum güncellemesi: last-write-wins (sıralama garantisi yok). */
export async function applyMessageStatus(tenantId: string, externalId: string, status: string, at: Date) {
  await prisma.message.updateMany({
    where: { tenantId, externalId, OR: [{ statusAt: null }, { statusAt: { lt: at } }] },
    data: { status, statusAt: at },
  });
}

async function handleInstagramEngagementEvent(tenantId: string, field: string, val: Any) {
  const commentText = String(val.text ?? val.caption ?? "").trim();
  const fromUser = String(val.from?.username ?? val.from?.id ?? "bilinmeyen");
  const mediaId = String(val.media?.id ?? val.media_id ?? val.id ?? "unknown");
  const eventId = `ig:${field}:${val.id ?? mediaId}:${fromUser}`;
  if (!(await firstSeen(eventId, "instagram_engagement"))) return;
  await recordRun({
    checkType: "YAYIN_KONTROL",
    targetType: "Brand",
    targetId: tenantId,
    bucket: eventId,
    severity: "BILGI",
    summary: `Instagram ${field === "mentions" ? "bahsetme (@mention)" : "yorum"}: @${fromUser}${commentText ? ` — "${commentText.slice(0, 120)}"` : ""}`,
    findings: { field, mediaId, fromUser, text: commentText.slice(0, 300) },
    model: "webhook",
    promptVersion: "v1",
  }).catch(() => undefined);
}

async function handleMetaMessaging(
  tenantId: string,
  provider: ChannelProvider,
  m: Any,
  dmHandledMids?: Set<string>,
) {
  const msg = m.message ?? {};
  if (msg.is_deleted || m.message_deletes) {
    const mid = msg.mid ?? m.message_deletes?.mid;
    if (mid) await purgeMessage(tenantId, { externalId: mid });
    return;
  }
  if (msg.is_echo || (m.sender?.id && m.sender.id === m.recipient?.id)) return;
  const postbackText = m.postback ? String(m.postback.title || m.postback.payload || "").trim() : "";
  const mid = msg.mid ?? (postbackText && m.sender?.id ? `postback:${m.timestamp ?? Date.now()}:${m.sender.id}` : null);
  if (!mid || !m.sender?.id) return;
  if (!(await firstSeen(mid, provider.toLowerCase()))) return;
  const text = msg.text ?? (postbackText || (msg.attachments?.length ? "[Medya/Ek]" : null));
  await handleInbound(tenantId, provider, {
    externalMessageId: mid,
    from: String(m.sender.id),
    phoneE164: null,
    name: null,
    text,
    at: new Date(Number(m.timestamp ?? Date.now())),
    fromAd: !!m.referral?.ad_id || m.referral?.source === "ADS",
    mediaUrl: msg.attachments?.[0]?.payload?.url ?? null,
    skipAutoReply: Boolean(dmHandledMids?.has(mid)),
  });
}

export type InboundInput = {
  externalMessageId: string;
  from: string;
  phoneE164: string | null;
  name: string | null;
  text: string | null;
  at: Date;
  fromAd: boolean;
  mediaUrl?: string | null;
  skipAutoReply?: boolean;
};

export async function handleInbound(tenantId: string, channel: ChannelProvider, input: InboundInput) {
  const cfg = {
    serviceWindowHours: await getConfig("whatsapp.serviceWindowHours"),
    fepWindowDays: await getConfig("whatsapp.fepWindowDays"),
    humanAgentWindowDays: await getConfig("whatsapp.humanAgentWindowDays"),
  };

  let igUsername: string | null = null;
  let resolvedName = input.name;
  const globalWaToken = envStr("WHATSAPP_ACCESS_TOKEN", "") || envStr("META_WABA_TOKEN", "") || envStr("META_SYSTEM_USER_TOKEN", "");
  const globalWaPhoneId = envStr("WHATSAPP_PHONE_NUMBER_ID", "");
  const globalIgToken = envStr("INSTAGRAM_ACCESS_TOKEN", "") || envStr("META_IG_TOKEN", "") || envStr("META_SYSTEM_USER_TOKEN", "");
  const globalIgUserId = envStr("INSTAGRAM_IG_USER_ID", "");

  const conn = await prisma.channelConnection.findFirst({
    where: { tenantId, provider: channel, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: { phoneNumbers: true },
  });
  const useTenantConn = !!conn && !conn.tokenRef.startsWith("env:");
  const tenantToken = useTenantConn ? await vault().get(conn.tokenRef).catch(() => "") : "";
  const extIds = (conn?.externalIds ?? {}) as Record<string, unknown>;
  const waToken = tenantToken || globalWaToken;
  const waPhoneId = (useTenantConn ? conn?.phoneNumbers[0]?.phoneNumberId : undefined) ?? globalWaPhoneId;
  const igToken = tenantToken || globalIgToken;
  const igUserId = String(extIds.ig_user_id ?? extIds.page_id ?? "") || globalIgUserId;

  if (channel === "INSTAGRAM" && input.from && igToken && igUserId) {
    const prof = await fetchIgSenderProfile(input.from, igUserId, igToken).catch(() => null);
    if (prof) {
      igUsername = prof.username;
      resolvedName ??= prof.name ?? (prof.username ? `@${prof.username}` : null);
    }
  }

  const contact = await prisma.contact.upsert({
    where: { tenantId_channel_externalId: { tenantId, channel, externalId: input.from } },
    create: { tenantId, channel, externalId: input.from, phoneE164: input.phoneE164, name: resolvedName },
    update: resolvedName ? { name: resolvedName } : {},
  });
  let conv = await prisma.conversation.findFirst({ where: { tenantId, contactId: contact.id, status: { not: "closed" } }, orderBy: { createdAt: "desc" } });
  const isFirst = !conv;
  conv ??= await prisma.conversation.create({ data: { tenantId, channel, contactId: contact.id, agentKey: input.fromAd ? "campaign_welcome" : null } });
  const w = onInbound(conv, input.at, channel, { fromAd: input.fromAd, isFirstMessage: isFirst }, cfg);
  conv = await prisma.conversation.update({ where: { id: conv.id }, data: { ...w, lastInboundAt: input.at } });
  await prisma.message.create({
    data: { tenantId, conversationId: conv.id, externalId: input.externalMessageId, direction: "INBOUND", body: input.text, mediaUrl: input.mediaUrl ?? null, createdAt: input.at },
  });
  await bumpDailyStat(prisma, tenantId, channel, "INBOUND", input.at, 1);
  publishInboxEvent(tenantId, "message.created", conv.id, { channel, externalId: input.externalMessageId });

  const optOutCheck = await applyInboundOptOutIfMatched({
    tenantId,
    contactId: contact.id,
    conversationId: conv.id,
    inboundText: input.text,
  }).catch(() => ({ isOptOut: false, matchedKeyword: null }));

  if (optOutCheck.isOptOut || (input.text && OPT_OUT_RE.test(input.text))) {
    if (contact.phoneE164) {
      await captureOptOut(tenantId, contact.phoneE164, "MESAJ", `${channel.toLowerCase()}_opt_out`, input.at).catch(() => undefined);
    }
    return { conversationId: conv.id, optOut: true };
  }
  if (input.text && !input.skipAutoReply) {
    if (channel === "WHATSAPP" && waToken && waPhoneId) {
      void showTyping({ channel: "WHATSAPP", token: waToken, phoneNumberId: waPhoneId, inboundMessageId: input.externalMessageId });
    } else if (channel === "INSTAGRAM" && igToken && igUserId) {
      void showTyping({ channel: "INSTAGRAM", token: igToken, igId: igUserId, recipientId: input.from });
    }
    if (channel === "INSTAGRAM") {
      const autoReply = await matchInstagramAutoReply(tenantId, input.text).catch(() => null);
      if (autoReply) {
        await sendMessage({
          tenantId,
          conversationId: conv.id,
          byUserId: null,
          text: autoReply.reply,
        }).catch(() => undefined);
        return { conversationId: conv.id, optOut: false };
      }
    }
    const agentRows = await prisma.agentConfig.findMany({ where: { tenantId }, select: { agentId: true, enabled: true } });
    const hasEnabledBrandAssistant = agentRows.some((a) => a.enabled);
    if (hasEnabledBrandAssistant) {
      void prescreenCreator(tenantId, conv.id, input.text).catch(() => undefined);
      // Markanın kendi aktif asistanı (RAG + niyet yönlendirici + güven eşiği) önce çalışır.
      const decision = await runAgentTurn(tenantId, conv.id, input.text, input.at);
      if (decision.kind === "silent" && tenantId === "ajans") {
        await handleChannelBotTurn(tenantId, conv.id, channel, contact, input.text, input.at, { username: igUsername, isFirst });
      }
    } else if (tenantId === "ajans") {
      // Platform ajans hattı için genel kanal botu
      await handleChannelBotTurn(tenantId, conv.id, channel, contact, input.text, input.at, { username: igUsername, isFirst });
    }
  }
  return { conversationId: conv.id, optOut: false };
}
