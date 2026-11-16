import { prisma } from "../db";
import { notifyAdmins } from "../agents/common";
import { envStr } from "../env";
import type { ChannelProvider } from "../generated/prisma/enums";
import { detectBotLang } from "./menu";
import { suggestInstagramByIgsid } from "./link";

const ACK_TR = "Bilgilerinizi aldık, ekibimiz sizinle iletişime geçecek.";
const ACK_EN = "We received your details. Our team will contact you.";
const LIMIT_TR = "Çok fazla talep aldık. Bir süre sonra yeniden yazabilirsiniz.";
const LIMIT_EN = "Too many requests. Please try again later.";

export type GuestInput = {
  channel: ChannelProvider;
  externalId: string;
  phone?: string | null;
  text: string;
  now?: Date;
};

function signupUrl(): string {
  return `${envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "")}/kayit`;
}

function faq(text: string, lang: "tr" | "en"): string | null {
  const t = text.toLocaleLowerCase("tr");
  const url = signupUrl();
  if (/nedir|what is|who are|ne iş|ne is/.test(t)) {
    return lang === "en"
      ? `Nordvow connects brands and creators. Sign up: ${url}`
      : `Nordvow, markalar ile içerik üreticilerini buluşturan bir platformdur. Kayıt: ${url}`;
  }
  if (/influencer|içerik|icerik|creator/.test(t) && /marka|ajans|brand|agency/.test(t)) {
    return lang === "en"
      ? `Creators join to receive campaigns. Brands and agencies open an account to run them. Sign up: ${url}`
      : `İçerik üreticisi kampanya almak için kaydolur. Marka ve ajans hesap açıp kampanya yönetir. Kayıt: ${url}`;
  }
  if (/kayıt|kayit|signup|sign up|üye|uye|nasıl|nasil|how do i/.test(t)) {
    return lang === "en" ? `Create an account: ${url}` : `Hesap açmak için: ${url}`;
  }
  return null;
}

function wantsLead(text: string): boolean {
  return /talep|başvur|basvur|bırak|birak|katıl|katil|join|request|apply/.test(text.toLocaleLowerCase("tr"));
}

function intentOf(text: string): "INFLUENCER" | "BRAND" | "INFO" | "OTHER" | null {
  const t = text.toLocaleLowerCase("tr");
  if (/influencer|içerik|icerik|creator|üretici|uretici/.test(t)) return "INFLUENCER";
  if (/marka|ajans|brand|agency|şirket|sirket/.test(t)) return "BRAND";
  if (/bilgi|info|soru|question/.test(t)) return "INFO";
  if (/diğer|diger|other/.test(t)) return "OTHER";
  return null;
}

function emailOf(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function phoneOf(text: string): string | null {
  const d = text.replace(/\D/g, "");
  return d.length >= 10 ? d : null;
}

async function tooMany(channel: ChannelProvider, externalId: string, now: Date) {
  const n = await prisma.botLead.count({
    where: { channel, externalId, createdAt: { gt: new Date(now.getTime() - 24 * 3_600_000) } },
  });
  return n >= 3;
}

async function openLead(channel: ChannelProvider, externalId: string) {
  return prisma.botLead.findFirst({ where: { channel, externalId, status: "YENI" }, orderBy: { createdAt: "desc" } });
}

/**
 * Bağlı olmayan gönderici. Hesap verisi ve araç yok.
 * Talep alanları konuşarak toplanır; aynı gönderici için açık talep tekrarlanmaz.
 */
export async function handleGuest(input: GuestInput): Promise<string> {
  const now = input.now ?? new Date();
  const lang = detectBotLang(input.text);
  const ack = lang === "en" ? ACK_EN : ACK_TR;
  const text = input.text.trim();
  if (await tooMany(input.channel, input.externalId, now)) return lang === "en" ? LIMIT_EN : LIMIT_TR;
  if (await openLead(input.channel, input.externalId)) return ack;

  const info = faq(text, lang);
  const draft = await prisma.botGuestDraft.findUnique({ where: { channel_externalId: { channel: input.channel, externalId: input.externalId } } });
  const suggest = input.channel === "INSTAGRAM" ? (await suggestInstagramByIgsid(input.externalId)).suggest : false;
  const hint = suggest
    ? lang === "en"
      ? "\nYour Instagram name may match a profile. Send the 6-digit code from your profile to link. /gizlilik"
      : "\nInstagram adınız bir profille eşleşiyor olabilir. Bağlamak için profildeki 6 haneli kodu yazın. Ayrıntı: /gizlilik"
    : lang === "en"
      ? "\nIf you already have an account, send the 6-digit code from your profile. /gizlilik"
      : "\nHesabınız varsa profildeki 6 haneli kodu yazın. Ayrıntı: /gizlilik";

  if (!draft) {
    if (wantsLead(text)) {
      await prisma.botGuestDraft.create({ data: { channel: input.channel, externalId: input.externalId, step: "name" } });
      return (lang === "en" ? "What is your name?" : "Adınız nedir?") + hint;
    }
    const hello = lang === "en"
      ? `Hello, I am the Nordvow assistant. Nordvow connects brands and creators. Sign up: ${signupUrl()}\nReply "request" to leave your details.`
      : `Merhaba, ben Nordvow asistanıyım. Nordvow marka ve içerik üreticilerini buluşturur. Kayıt: ${signupUrl()}\nTalep bırakmak için "talep" yazın.`;
    return `${info ? `${info}\n` : ""}${hello}${hint}`;
  }

  if (info && draft.step === "name" && !wantsLead(text) && text.length > 40) return `${info}${hint}`;

  if (draft.step === "name") {
    if (text.length < 2) return lang === "en" ? "Please send your name." : "Lütfen adınızı yazın.";
    await prisma.botGuestDraft.update({ where: { id: draft.id }, data: { name: text.slice(0, 80), step: "intent" } });
    return lang === "en" ? "Are you a creator, a brand/agency, asking for info, or other?" : "İçerik üreticisi misiniz, marka/ajans mısınız, bilgi mi istiyorsunuz, yoksa diğer mi?";
  }
  if (draft.step === "intent") {
    const intent = intentOf(text);
    if (!intent) return lang === "en" ? "Reply creator, brand, info, or other." : "İçerik üreticisi, marka, bilgi veya diğer yazın.";
    await prisma.botGuestDraft.update({ where: { id: draft.id }, data: { intent, step: "contact" } });
    if (input.phone) return lang === "en" ? "We have this chat number. Send an email, or reply skip." : "Bu sohbetin numarası bizde. E-posta yazın ya da yok deyin.";
    return lang === "en" ? "Send an email or a phone number." : "E-posta ya da telefon yazın.";
  }
  if (draft.step === "contact") {
    const skip = /^(yok|skip|no|hayır|hayir)$/i.test(text);
    const email = emailOf(text);
    const phone = phoneOf(text) ?? (skip || input.phone ? input.phone ?? null : null);
    if (!email && !phone) return lang === "en" ? "Send an email or a phone number." : "E-posta ya da telefon yazın.";
    await prisma.botGuestDraft.update({ where: { id: draft.id }, data: { email, phone, step: "org" } });
    return lang === "en" ? "Company or social handle? Reply skip if none." : "Şirket ya da sosyal hesap? Yoksa yok yazın.";
  }
  if (draft.step === "org") {
    const org = /^(yok|skip|no)$/i.test(text) ? null : text.slice(0, 80);
    await prisma.botGuestDraft.update({ where: { id: draft.id }, data: { org, step: "note" } });
    return lang === "en" ? "A short note?" : "Kısa bir not yazar mısınız?";
  }
  const note = text.slice(0, 500);
  const fresh = await prisma.botGuestDraft.findUniqueOrThrow({ where: { id: draft.id } });
  if (await openLead(input.channel, input.externalId)) {
    await prisma.botGuestDraft.delete({ where: { id: draft.id } });
    return ack;
  }
  await prisma.botLead.create({
    data: {
      channel: input.channel,
      externalId: input.externalId,
      name: fresh.name ?? "—",
      intent: fresh.intent ?? "OTHER",
      email: fresh.email,
      phone: fresh.phone,
      org: fresh.org,
      note,
      status: "YENI",
    },
  });
  await prisma.botGuestDraft.delete({ where: { id: draft.id } });
  await notifyAdmins("Yeni müşteri talebi", `${fresh.name ?? "—"} · ${fresh.intent ?? "OTHER"}`, "/admin/bot").catch(() => undefined);
  return ack;
}
