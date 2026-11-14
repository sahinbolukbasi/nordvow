import { prisma } from "../db";
import { getLlm } from "../llm";
import { envStr } from "../env";
import { handoff } from "../assistant/runtime";
import { SendBlockedError, sendMessage } from "../messaging/send";
import { activeLink, autoLinkSender, consumeLinkCode, magicLinkUrl } from "./link";
import { detectBotLang, matchMenu, menuText } from "./menu";
import { planOutbound, type BotTemplateKey } from "./window-plan";
import { BOT_TOOLS, toolByMenu } from "./registry";
import { canonicalPhone, rateAllows, SENSITIVE_TOOL_LIMIT } from "./tokens";
import type { BotChannel, BotUser, ToolName } from "./types";

const PUBLIC_TR = "Nordvow, marka ve içerik üreticilerini buluşturan bir platformdur. Herkese açık etkinlikler için “etkinlikler” yazın. Kayıt: /kayit. Hesabınızı bağlamak için profilinizdeki 6 haneli kodu gönderin. Ayrıntı: /gizlilik";
const PUBLIC_EN = "Nordvow connects brands and creators. Reply “events” for public events. Sign up: /kayit. To link your account, send the 6-digit code from your profile. Details: /gizlilik";

async function loadUser(userId: string): Promise<BotUser | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, brandId: true, influencerId: true, name: true, email: true, phone: true, status: true },
  });
  if (!u || u.status !== "ACTIVE") return null;
  if (u.role !== "ADMIN" && u.role !== "AGENCY" && u.role !== "BRAND" && u.role !== "INFLUENCER") return null;
  return u;
}

async function ensureLinked(channel: BotChannel, externalId: string, phone: string | null): Promise<BotUser | null> {
  const key = channel === "WHATSAPP" ? canonicalPhone(phone || externalId) : externalId;
  const link = await activeLink(channel, key);
  if (link?.user) return loadUser(link.userId);
  if (channel === "MESSENGER") return null;
  const linked = await autoLinkSender(channel, key, phone);
  if (linked.ok) return loadUser(linked.userId);
  return null;
}

export async function getBotSettings() {
  return (await prisma.botSettings.findUnique({ where: { id: "default" } })) ?? {
    whatsappEnabled: false,
    instagramEnabled: false,
    messengerEnabled: false,
    whatsappPhoneNumberId: null as string | null,
    igUserId: null as string | null,
    pageId: null as string | null,
    welcomeTr: "Merhaba, ben Nordvow asistanıyım. Ayrıntı: /gizlilik",
    welcomeEn: "Hi, I am the Nordvow assistant. Details: /gizlilik",
  };
}

export async function isPlatformBot(channel: BotChannel, businessId: string): Promise<boolean> {
  const s = await getBotSettings();
  if (channel === "WHATSAPP") {
    const id = s.whatsappPhoneNumberId || envStr("NORDVOW_WA_PHONE_NUMBER_ID", "");
    return s.whatsappEnabled && !!id && id === businessId;
  }
  if (channel === "INSTAGRAM") {
    const id = s.igUserId || envStr("NORDVOW_IG_USER_ID", "");
    return s.instagramEnabled && !!id && id === businessId;
  }
  const id = s.pageId || envStr("NORDVOW_PAGE_ID", "");
  return s.messengerEnabled && !!id && id === businessId;
}

async function llmTool(text: string): Promise<ToolName | null> {
  if (envStr("LLM_PROVIDER", "mock") !== "bedrock") return null;
  const names = Object.keys(BOT_TOOLS).join(", ");
  const res = await getLlm().completeText({
    system: `Pick one tool name from: ${names}. Reply JSON {"tool":"name"} or {"tool":null}.`,
    promptVersion: "bot-tool@1",
    prompt: text.slice(0, 500),
  });
  const m = res.text.match(/"tool"\s*:\s*"([a-z_]+)"/);
  const name = m?.[1];
  return name && name in BOT_TOOLS ? (name as ToolName) : null;
}

export async function handlePlatformBot(input: {
  tenantId: string;
  conversationId: string;
  channel: BotChannel;
  externalId: string;
  phone?: string | null;
  text: string;
  windowOpen: boolean;
  now?: Date;
}): Promise<{ sent: boolean }> {
  const now = input.now ?? new Date();
  const lang = detectBotLang(input.text);
  const menu = matchMenu(input.text);
  const settings = await getBotSettings();
  const conv = await prisma.conversation.findFirst({ where: { id: input.conversationId, tenantId: input.tenantId }, select: { status: true } });
  if (conv?.status === "awaiting_human" || conv?.status === "assigned") return { sent: false };

  if (menu === "handoff") {
    await handoff(input.tenantId, input.conversationId, "insan_istedi", now);
    return { sent: true };
  }

  const code = input.text.trim();
  if (/^\d{6}$/.test(code)) {
    try {
      await consumeLinkCode(code, input.channel, input.externalId, now);
      return deliver(input, windowText(input, lang === "en" ? "Account linked. Reply menu." : "Hesap bağlandı. menü yazın."), "account_link", [code]);
    } catch {
      return deliver(input, lang === "en" ? "Code is invalid. See /gizlilik" : "Kod geçersiz. Ayrıntı: /gizlilik");
    }
  }

  const user = await ensureLinked(input.channel, input.externalId, input.phone ?? null);
  if (!user) {
    if (menu === "events") return deliver(input, await toolPublic(lang));
    const welcome = lang === "en" ? settings.welcomeEn : settings.welcomeTr;
    let extra = "";
    if (input.channel !== "WHATSAPP") {
      const url = magicLinkUrl({ externalId: input.externalId, channel: input.channel }, envStr("APP_URL", "http://localhost:3000"));
      extra = lang === "en" ? `\nOpen this link while logged in (15 min): ${url}\nOr send the 6-digit code from your profile.` : `\nGiriş yapmışken bu bağlantıyı açın (15 dk): ${url}\nYa da profildeki 6 haneli kodu yazın.`;
    }
    return deliver(input, `${welcome}\n${lang === "en" ? PUBLIC_EN : PUBLIC_TR}${extra}\n${menuText(lang)}`);
  }

  const pending = await prisma.botPendingAction.findUnique({ where: { channel_externalId: { channel: input.channel, externalId: input.externalId } } });
  if (menu === "yes" && pending && pending.expiresAt > now && pending.userId === user.id) {
    await prisma.botPendingAction.delete({ where: { id: pending.id } });
    const text = await runTool(user, pending.tool as ToolName, String((pending.args as { text?: string }).text ?? ""), lang, input);
    return deliver(input, text, pending.tool === "claim_coupon" ? "coupon_delivered" : pending.tool === "reserve_ticket" ? "ticket_confirmation" : undefined, [text.slice(0, 80)]);
  }
  if (menu === "no" && pending) {
    await prisma.botPendingAction.delete({ where: { id: pending.id } });
    return deliver(input, lang === "en" ? "Cancelled." : "İptal edildi.");
  }
  if (menu === "yes") return deliver(input, lang === "en" ? "Nothing to confirm." : "Onaylanacak işlem yok.");

  let tool = toolByMenu(menu, input.text);
  if (!tool) tool = await llmTool(input.text);
  if (!tool || tool === "account" && menu === "menu") {
    return deliver(input, `${lang === "en" ? settings.welcomeEn : settings.welcomeTr}\n${menuText(lang)}`);
  }
  const def = BOT_TOOLS[tool];
  if (def.confirm) {
    const since = new Date(now.getTime() - 3_600_000);
    const n = await prisma.botToolCall.count({ where: { userId: user.id, tool, createdAt: { gt: since } } });
    if (!rateAllows(n)) return deliver(input, lang === "en" ? `Limit reached (${SENSITIVE_TOOL_LIMIT}/hour).` : `Saatlik sınır doldu (${SENSITIVE_TOOL_LIMIT}).`);
    await prisma.botPendingAction.upsert({
      where: { channel_externalId: { channel: input.channel, externalId: input.externalId } },
      create: { channel: input.channel, externalId: input.externalId, userId: user.id, tool, args: { text: input.text }, expiresAt: new Date(now.getTime() + 10 * 60_000) },
      update: { userId: user.id, tool, args: { text: input.text }, expiresAt: new Date(now.getTime() + 10 * 60_000) },
    });
    return deliver(input, lang === "en" ? "Reply EVET to confirm. Card details are never collected here. /gizlilik" : "Onaylamak için EVET yazın. Kart bilgisi burada alınmaz. /gizlilik");
  }
  const text = await runTool(user, tool, input.text, lang, input);
  if (input.channel !== "WHATSAPP" && !input.windowOpen) {
    return deliver(input, text);
  }
  return deliver(input, text);
}

async function toolPublic(lang: "tr" | "en") {
  const { toolEvents } = await import("./tools");
  return toolEvents(lang);
}

async function runTool(user: BotUser, tool: ToolName, text: string, lang: "tr" | "en", input: { channel: BotChannel; externalId: string }) {
  const def = BOT_TOOLS[tool];
  try {
    const out = await def.run(user, { text, lang });
    await prisma.botToolCall.create({ data: { channel: input.channel, externalId: input.externalId, userId: user.id, tool, ok: true } });
    return out;
  } catch (e) {
    await prisma.botToolCall.create({ data: { channel: input.channel, externalId: input.externalId, userId: user.id, tool, ok: false } });
    return lang === "en" ? `Could not complete that. ${(e as Error).message}` : `İşlem tamamlanamadı. ${(e as Error).message}`;
  }
}

function windowText(input: { channel: BotChannel; windowOpen: boolean }, body: string, templateKey?: BotTemplateKey, params?: string[]) {
  return planOutbound({ channel: input.channel, windowOpen: input.windowOpen, body, templateKey, params });
}

async function deliver(input: { tenantId: string; conversationId: string; channel: BotChannel; windowOpen: boolean; now?: Date }, bodyOrPlan: string | ReturnType<typeof planOutbound>, templateKey?: BotTemplateKey, params?: string[]) {
  const plan = typeof bodyOrPlan === "string" ? planOutbound({ channel: input.channel, windowOpen: input.windowOpen, body: bodyOrPlan, templateKey, params }) : bodyOrPlan;
  if (plan.mode === "blocked") return { sent: false };
  try {
    if (plan.mode === "template") {
      const tpl = await prisma.messageTemplate.findFirst({ where: { tenantId: input.tenantId, name: templateName(plan.templateKey), status: "ACTIVE" } });
      if (!tpl) return { sent: false };
      await sendMessage({ tenantId: input.tenantId, conversationId: input.conversationId, byUserId: null, templateId: tpl.id, params: plan.params, text: plan.params.join(" "), now: input.now });
      return { sent: true };
    }
    await sendMessage({ tenantId: input.tenantId, conversationId: input.conversationId, byUserId: null, text: plan.body, now: input.now });
    return { sent: true };
  } catch (e) {
    if (e instanceof SendBlockedError) return { sent: false };
    throw e;
  }
}

function templateName(key: BotTemplateKey): string {
  const map: Record<BotTemplateKey, string> = {
    account_link: "nordvow_hesap_bagla",
    ticket_confirmation: "nordvow_bilet_onay",
    coupon_delivered: "nordvow_kupon_kodu",
    window_closed: "nordvow_pencere_kapali",
  };
  return map[key];
}

export function instagramBindHint(externalId: string): string {
  return magicLinkUrl({ externalId, channel: "INSTAGRAM" }, envStr("APP_URL", "http://localhost:3000"));
}
