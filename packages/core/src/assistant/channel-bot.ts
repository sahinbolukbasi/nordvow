import { randomInt } from "node:crypto";
import { prisma } from "../db";
import { envStr } from "../env";
import { notifyAdmins } from "../agents/common";
import { formatKurus } from "../domain/labels";
import { respondOffer } from "../domain/offers";
import { computeBalances } from "../domain/ledger";
import { createShortLink } from "../notify/shortlink";
import { submitGeneration } from "../creative/generate";
import { sendMessage } from "../messaging/send";
import { converseChat, parseJsonObject, type ChatTurn } from "../llm/bedrock";
import type { ChannelProvider } from "../generated/prisma/enums";

/**
 * WhatsApp & Instagram akıllı bot katmanı.
 *  - Kimlik: kayıtlı hesap bağlantısı → WhatsApp telefon numarası (kullanıcı telefonu / marka iletişim telefonu)
 *    → Instagram kullanıcı adı (sistemdeki influencer Instagram hesabı) ile OTOMATİK tanıma.
 *  - Anlama: her mesaj ucuz bir Bedrock modeliyle (varsayılan Amazon Nova Lite) niyet + yanıt olarak çözümlenir;
 *    sabit komut ezberlemeye gerek yoktur, sohbet geçmişi bağlam olarak verilir.
 *  - Eylemler: teklifler (liste + kabul/red), işler/kampanyalar, bakiye/kredi, link kısaltma,
 *    Creative Stüdyo görsel/video üretimi, talep/başvuru iletme, insan temsilciye aktarma.
 *  - Güvenlik: e-posta ile bağlama yalnız platform bildirimine giden OTP ile; para/kart bilgisi istenmez.
 */

type BotContact = {
  id: string;
  tenantId: string;
  channel: ChannelProvider;
  externalId: string;
  phoneE164: string | null;
  name: string | null;
};

type LinkedUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENCY" | "BRAND" | "INFLUENCER";
  brandId: string | null;
  influencerId: string | null;
};

type LinkRecord = { userId: string; linkedAt: string; via?: string };
type OtpRecord = { userId: string; code: string; expiresAt: number };
export type BotTurnMeta = { username?: string | null };

const USER_SELECT = { id: true, name: true, email: true, role: true, brandId: true, influencerId: true } as const;
const APP_BASE = () => envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "");
const linkKey = (channel: ChannelProvider, extId: string) => `bot.link.${channel}.${extId}`;
const otpKey = (channel: ChannelProvider, extId: string) => `bot.otp.${channel}.${extId}`;
const ROLE_TR: Record<LinkedUser["role"], string> = { ADMIN: "Yönetici", AGENCY: "Ajans", BRAND: "Marka", INFLUENCER: "Influencer" };

async function readJson<T>(key: string): Promise<T | null> {
  const row = await prisma.configValue.findUnique({ where: { key }, select: { value: true } });
  return (row?.value as T | undefined) ?? null;
}

async function writeJson(key: string, value: unknown) {
  await prisma.configValue.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
}

/** İnsan gibi: yanıt uzunluğuyla orantılı kısa bir bekleme (en fazla ~2,5 sn). */
async function humanPause(text: string) {
  if (envStr("META_API_MODE", "mock") !== "http") return;
  const ms = Math.min(2500, 500 + text.length * 12);
  await new Promise((r) => setTimeout(r, ms));
}

async function reply(tenantId: string, convId: string, text: string) {
  await humanPause(text);
  await sendMessage({ tenantId, conversationId: convId, byUserId: null, text });
}

function norm(s: string): string {
  return s.trim().toLocaleLowerCase("tr").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i");
}

function last10(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] ?? "";
}

// ───────────── Kimlik çözümleme ─────────────

async function remember(contact: BotContact, userId: string, via: string) {
  await writeJson(linkKey(contact.channel, contact.externalId), { userId, linkedAt: new Date().toISOString(), via } satisfies LinkRecord);
}

async function matchByPhone(phone: string | null): Promise<LinkedUser | null> {
  const tail = last10(phone);
  if (!tail) return null;
  const users = await prisma.user.findMany({ where: { status: "ACTIVE", phone: { not: null } }, select: { ...USER_SELECT, phone: true }, take: 5000 });
  const hits = users.filter((u) => last10(u.phone) === tail);
  if (hits.length === 1) return hits[0]!;
  // Marka iletişim telefonu → o markanın aktif marka kullanıcısı
  const brands = await prisma.brand.findMany({ select: { id: true, contactPhone: true }, take: 5000 });
  const brandIds = brands.filter((b) => last10(b.contactPhone) === tail).map((b) => b.id);
  if (brandIds.length === 1) {
    const u = await prisma.user.findFirst({ where: { brandId: brandIds[0], status: "ACTIVE", role: "BRAND" }, orderBy: { createdAt: "asc" }, select: USER_SELECT });
    if (u) return u;
  }
  return null;
}

async function matchByInstagram(username: string | null | undefined): Promise<LinkedUser | null> {
  const u = username?.replace(/^@/, "").trim();
  if (!u) return null;
  const accounts = await prisma.socialAccount.findMany({
    where: {
      platform: "INSTAGRAM",
      OR: [
        { handle: { equals: u, mode: "insensitive" } },
        { handle: { equals: `@${u}`, mode: "insensitive" } },
        { profileUrl: { contains: `instagram.com/${u}`, mode: "insensitive" } },
      ],
    },
    select: { influencerId: true },
    take: 2,
  });
  if (accounts.length !== 1) return null;
  return prisma.user.findFirst({ where: { influencerId: accounts[0]!.influencerId, status: "ACTIVE" }, select: USER_SELECT });
}

async function resolveLinkedUser(contact: BotContact, meta: BotTurnMeta): Promise<{ user: LinkedUser | null; justMatched: boolean }> {
  const saved = await readJson<LinkRecord>(linkKey(contact.channel, contact.externalId));
  if (saved?.userId) {
    const u = await prisma.user.findFirst({ where: { id: saved.userId, status: "ACTIVE" }, select: USER_SELECT });
    if (u) return { user: u, justMatched: false };
  }
  if (contact.channel === "WHATSAPP") {
    const u = await matchByPhone(contact.phoneE164);
    if (u) {
      await remember(contact, u.id, "phone");
      return { user: u, justMatched: true };
    }
  }
  if (contact.channel === "INSTAGRAM") {
    const u = await matchByInstagram(meta.username);
    if (u) {
      await remember(contact, u.id, "instagram");
      return { user: u, justMatched: true };
    }
  }
  return { user: null, justMatched: false };
}

function creativeTenantOf(u: LinkedUser, fallbackTenantId: string): string {
  if (u.brandId) return u.brandId;
  if (u.influencerId) return `inf:${u.influencerId}`;
  return fallbackTenantId;
}

// ───────────── Veri yardımcıları ─────────────

async function pendingOffersFor(u: LinkedUser, now: Date) {
  if (u.role === "INFLUENCER" && u.influencerId) {
    return prisma.offer.findMany({
      where: { influencerId: u.influencerId, status: { in: ["GONDERILDI", "KARSI_TEKLIF"] }, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
  }
  if (u.role === "BRAND" && u.brandId) return prisma.offer.findMany({ where: { brandId: u.brandId }, orderBy: { createdAt: "desc" }, take: 5 });
  return prisma.offer.findMany({ where: { status: { in: ["GONDERILDI", "KARSI_TEKLIF"] } }, orderBy: { createdAt: "desc" }, take: 5 });
}

async function offersData(u: LinkedUser, now: Date): Promise<string> {
  const offers = await pendingOffersFor(u, now);
  const link = u.role === "INFLUENCER" ? `${APP_BASE()}/influencer/teklifler` : u.role === "BRAND" ? `${APP_BASE()}/marka/teklifler` : `${APP_BASE()}/admin/teklifler`;
  if (!offers.length) return `Bekleyen teklif yok. Tüm teklifler: ${link}`;
  const lines = offers.map((o, i) => `${i + 1}. ${o.title} — ${formatKurus(o.counterKurus ?? o.totalKurus)} (durum: ${o.status})`);
  const hint = u.role === "INFLUENCER" ? "Kullanıcı numara vererek kabul/red edebilir (örn. '1. teklifi kabul ediyorum')." : "";
  return `Teklifler:\n${lines.join("\n")}\n${hint}\nDetay: ${link}`;
}

async function jobsData(u: LinkedUser, question: string = ""): Promise<string> {
  if (u.role === "INFLUENCER" && u.influencerId) {
    const jobs = await prisma.deliverable.findMany({
      where: { assignment: { influencerId: u.influencerId }, status: { notIn: ["TAMAMLANDI", "IPTAL"] } },
      orderBy: { plannedAt: "asc" },
      take: 5,
      select: { platform: true, contentType: true, status: true, plannedAt: true, assignment: { select: { campaign: { select: { name: true } } } } },
    });
    if (!jobs.length) return `Aktif iş yok. Panel: ${APP_BASE()}/influencer`;
    const lines = jobs.map((j, i) => `${i + 1}. ${j.assignment.campaign.name} — ${j.platform} ${j.contentType}, durum ${j.status}${j.plannedAt ? `, plan ${j.plannedAt.toLocaleDateString("tr-TR")}` : ""}`);
    return `Aktif işler:\n${lines.join("\n")}\nDetay: ${APP_BASE()}/influencer`;
  }
  const where = u.role === "BRAND" && u.brandId ? { brandId: u.brandId, status: { not: "IPTAL" as const } } : { status: { not: "IPTAL" as const } };
  const camps = await prisma.campaign.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 8,
    include: {
      assignments: {
        where: { contractStatus: { not: "RED" } },
        include: { deliverables: { select: { status: true } }, influencer: { select: { name: true } } },
      },
    },
  });
  const link = u.role === "BRAND" ? `${APP_BASE()}/marka/kampanyalar` : `${APP_BASE()}/admin/kampanyalar`;
  if (!camps.length) return `Açık kampanya yok. Panel: ${link}`;

  const qNorm = norm(question);
  const matched = camps.find((c) => qNorm.includes(norm(c.name)));
  if (matched) {
    const delivs = matched.assignments.flatMap((a) => a.deliverables);
    const done = delivs.filter((d) => ["YAYINLANDI", "TAMAMLANDI"].includes(d.status)).length;
    const trackers = await prisma.trackerAgent.findMany({
      where: { scope: "CAMPAIGN", targetId: matched.id },
      select: { name: true, lastFindings: true },
    });
    const infNames = matched.assignments.map((a) => a.influencer.name).join(", ") || "Henüz yok";
    const trackerTxt = trackers.map((t) => `${t.name} (${Array.isArray(t.lastFindings) ? t.lastFindings.length : 0} bulgu)`).join(", ") || "Aktif";
    return `Kampanya Detayı — ${matched.name}:\nDurum: ${matched.status}\nTarih: ${matched.startsAt.toLocaleDateString("tr-TR")} - ${matched.endsAt.toLocaleDateString("tr-TR")}\nInfluencerlar: ${infNames}\nGörevler: ${done}/${delivs.length} tamamlandı\nTakip Botları: ${trackerTxt}\nDetay: ${link}/${matched.id}`;
  }

  if (/\b(genel|ozet|hepsi|tumu)\b/.test(qNorm)) {
    const lines = camps.map((c, i) => {
      const delivs = c.assignments.flatMap((a) => a.deliverables);
      const done = delivs.filter((d) => ["YAYINLANDI", "TAMAMLANDI"].includes(d.status)).length;
      return `${i + 1}. ${c.name} — ${c.status}, ${c.assignments.length} influencer, ${done}/${delivs.length} içerik tamam`;
    });
    return `Genel Kampanya Özeti:\n${lines.join("\n")}\nBelirli bir kampanyanın adını yazarsan detayını da paylaşabilirim. Panel: ${link}`;
  }

  const names = camps.map((c, i) => `${i + 1}. ${c.name} (${c.status})`).join("\n");
  return `Nasıl bir bilgi istersin? Genel özet mi paylaşayım, yoksa belirli bir kampanya hakkında detaylı bilgi mi? Kampanyaların:\n${names}\n(Yanıt olarak "genel" veya kampanya adını yazabilirsin.)`;
}

async function balanceData(u: LinkedUser, tenantId: string): Promise<string> {
  const acc = await prisma.creditAccount.findUnique({ where: { tenantId: creativeTenantOf(u, tenantId) }, select: { balanceCredits: true } });
  let s = `Creative Stüdyo kredisi: ${Number(acc?.balanceCredits ?? 0).toLocaleString("tr-TR")} kredi.`;
  if (u.role === "INFLUENCER" && u.influencerId) {
    const bal = await computeBalances(u.influencerId);
    s += ` Çekilebilir bakiye: ${formatKurus(bal.cekilebilir)}.`;
  }
  return `${s} Panel: ${APP_BASE()}/creative`;
}

async function watchCreativeAndNotify(tenantId: string, convId: string, jobId: string, userId: string) {
  for (let i = 0; i < 36; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const job = await prisma.creativeJob.findUnique({ where: { id: jobId }, select: { status: true, rejectReason: true } });
    if (!job) return;
    if (job.status === "COMPLETED") {
      const asset = await prisma.generatedAsset.findFirst({ where: { jobId }, select: { id: true } });
      if (!asset) continue;
      const fileUrl = `${APP_BASE()}/api/creative/file/${asset.id}?t=asset`;
      const short = await createShortLink(fileUrl, { label: "creative-bot", createdByUserId: userId }).catch(() => null);
      await reply(tenantId, convId, `Hazır! 🎉 Buradan bakabilirsin: ${short?.shortUrl ?? fileUrl}\nTümü galeride: ${APP_BASE()}/creative`);
      return;
    }
    if (job.status === "FAILED" || job.status === "REJECTED") {
      await reply(tenantId, convId, `Maalesef bu üretim tamamlanamadı (${job.rejectReason ?? "sağlayıcı hatası"}). Kredin iade edildi; istersen farklı bir açıklamayla tekrar deneyelim.`);
      return;
    }
  }
  await reply(tenantId, convId, `Üretim hâlâ sürüyor, biraz uzun sürdü. Hazır olunca galeride göreceksin: ${APP_BASE()}/creative`);
}

// ───────────── AI ─────────────

type Intent =
  | "chat"
  | "offers"
  | "offer_respond"
  | "jobs"
  | "balance"
  | "shorten"
  | "create_image"
  | "create_video"
  | "link_account"
  | "lead"
  | "human"
  | "unlink";

type AiDecision = { intent: Intent; args: Record<string, unknown>; reply: string };

function systemPrompt(user: LinkedUser | null, channel: ChannelProvider, contactName: string | null, justMatched: boolean): string {
  const base = APP_BASE();
  const who = user
    ? `Konuştuğun kişi TANINDI: ${user.name} (${ROLE_TR[user.role]}). ${justMatched ? "Bu ilk tanıma; ona adıyla sıcak bir şekilde hitap et ve hesabını tanıdığını kısaca belirt." : "Ona adıyla hitap edebilirsin."}`
    : `Konuştuğun kişi sistemde henüz tanınmadı${contactName ? ` (görünen adı: ${contactName})` : ""}. Kayıtlıysa e-postasını yazarak hesabını bağlayabileceğini doğal bir dille söyle; değilse platformu kısaca tanıt ve ${base}/giris adresine yönlendir.`;
  return [
    `Sen Nordvow'un ${channel === "WHATSAPP" ? "WhatsApp" : "Instagram"} hattındaki asistanısın. Nordvow; markaları, ajansları ve influencerları buluşturan, kampanya/teklif yönetimi ve AI Creative Stüdyo (görsel/video üretimi) sunan bir platformdur. Site: ${base}.`,
    who,
    `ÜSLUP: Karşında gerçek bir müşteri temsilcisi varmış gibi samimi, doğal, kısa ve akıcı Türkçe yaz. Robotik liste/menü dökme, madde işaretlerini yalnız gerçekten gerekirse kullan. 1-3 cümle yeterli. Emoji ölçülü (en fazla 1). Kullanıcının dilinde yanıt ver. Doğrudan "bot musun" diye sorulursa dürüstçe Nordvow'un dijital asistanı olduğunu söyle. Asla kart/şifre/IBAN isteme. Bilmediğin konuda uydurma; ekibe ileteceğini söyle.`,
    `Kullanıcının mesajından NİYETİ çıkar ve SADECE şu JSON'u döndür (başka metin yok):`,
    `{"intent":"<niyet>","args":{...},"reply":"<kullanıcıya gidecek doğal yanıt>"}`,
    `Niyetler:`,
    `- chat: selamlaşma, sohbet, genel soru, platform hakkında bilgi (reply'ı sen yaz)`,
    `- offers: teklifleri görmek istiyor`,
    `- offer_respond: bir teklifi kabul/red ediyor. args: {"index": <1'den başlayan sıra>, "decision": "KABUL"|"RED", "note": "<varsa neden>"}`,
    `- jobs: işlerini / kampanyalarını soruyor`,
    `- balance: bakiye, kredi, ödeme durumunu soruyor`,
    `- shorten: link kısaltmak istiyor. args: {"url": "<https://...>"}`,
    `- create_image: görsel/resim üretmek istiyor. args: {"prompt": "<ayrıntılı üretim açıklaması>", "aspect": "9:16"|"1:1"|"4:5"|"16:9"}`,
    `- create_video: video üretmek istiyor. args: {"prompt": "...", "aspect": "..."}`,
    `- link_account: hesabını bağlamak istiyor ve e-posta verdi. args: {"email": "<eposta>"}  (e-posta yoksa intent=chat ve e-postasını iste)`,
    `- lead: marka/influencer başvurusu, iş birliği talebi, şikayet veya ekibin ilgilenmesi gereken talep. args: {"summary": "<kısa özet>"}`,
    `- human: açıkça bir yetkiliyle/insanla görüşmek istiyor`,
    `- unlink: hesap bağlantısını kaldırmak istiyor`,
    user ? `Tanınan kullanıcı için offers/jobs/balance/shorten/create_* kullanılabilir.` : `Tanınmayan kullanıcı için offers/jobs/balance/shorten/create_* yerine intent=chat seç ve önce hesabını bağlamasını iste.`,
    `Bilgi gerektiren niyetlerde (offers, jobs, balance) reply kısa bir geçiş cümlesi olsun; verileri sistem ekleyecek.`,
  ].join("\n");
}

async function history(convId: string): Promise<ChatTurn[]> {
  const rows = await prisma.message.findMany({ where: { conversationId: convId }, orderBy: { createdAt: "desc" }, take: 12, select: { direction: true, body: true } });
  return rows
    .reverse()
    .filter((r) => r.body?.trim())
    .map((r) => ({ role: r.direction === "INBOUND" ? ("user" as const) : ("assistant" as const), text: r.body!.slice(0, 600) }));
}

async function decide(user: LinkedUser | null, channel: ChannelProvider, contact: BotContact, convId: string, text: string, justMatched: boolean): Promise<AiDecision | null> {
  if (envStr("LLM_PROVIDER", "mock") !== "bedrock") return null;
  try {
    const turns = await history(convId);
    if (!turns.length || turns[turns.length - 1]!.role !== "user") turns.push({ role: "user", text });
    const out = await converseChat({ system: systemPrompt(user, channel, contact.name, justMatched), turns, maxTokens: 350, temperature: 0.4 });
    const j = parseJsonObject(out.text);
    if (!j || typeof j.intent !== "string") return out.text.trim() ? { intent: "chat", args: {}, reply: out.text.trim().slice(0, 900) } : null;
    return { intent: j.intent as Intent, args: (j.args as Record<string, unknown>) ?? {}, reply: String(j.reply ?? "").trim() };
  } catch (e) {
    console.warn("[channel-bot] AI kararı alınamadı:", (e as Error).message);
    return null;
  }
}

/** Ham veriyi kısa ve insansı bir mesaja çevirir (ucuz model). Hata olursa ham veriyi döndürür. */
async function phrase(user: LinkedUser | null, question: string, data: string): Promise<string> {
  if (envStr("LLM_PROVIDER", "mock") !== "bedrock") return data;
  try {
    const out = await converseChat({
      system: `Sen Nordvow müşteri temsilcisisin. Aşağıdaki sistem verisini kullanıcıya WhatsApp/Instagram mesajı olarak, samimi ve doğal Türkçe ile aktar. Verideki rakamları, adları ve linkleri DEĞİŞTİRME, uydurma ekleme. Kısa tut; liste gerekiyorsa sade numaralı satırlar kullan.${user ? ` Kullanıcının adı: ${firstName(user.name)}.` : ""}`,
      turns: [{ role: "user", text: `Kullanıcının sorusu: ${question}\n\nSistem verisi:\n${data}` }],
      maxTokens: 450,
      temperature: 0.3,
    });
    return out.text.trim() || data;
  } catch {
    return data;
  }
}

// ───────────── Deterministik yedek (AI kapalı/hatalı) ─────────────

function fallbackDecision(text: string, user: LinkedUser | null): AiDecision {
  const n = norm(text);
  const url = text.match(/https?:\/\/\S+/i)?.[0];
  const email = text.match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0];
  if (email) return { intent: "link_account", args: { email }, reply: "" };
  if (/^(cikis|baglantiyi kes)$/.test(n)) return { intent: "unlink", args: {}, reply: "" };
  if (user) {
    const offer = n.match(/teklif\w*\s+(kabul|red)\w*\s+(\d+)\s*(.*)$/);
    if (offer) return { intent: "offer_respond", args: { decision: offer[1] === "kabul" ? "KABUL" : "RED", index: Number(offer[2]), note: offer[3] }, reply: "" };
    if (n.includes("teklif")) return { intent: "offers", args: {}, reply: "" };
    if (/(isler|islerim|kampanya)/.test(n)) return { intent: "jobs", args: {}, reply: "" };
    if (/(bakiye|kredi)/.test(n)) return { intent: "balance", args: {}, reply: "" };
    if (url && /(kisalt|link)/.test(n)) return { intent: "shorten", args: { url }, reply: "" };
    const cr = text.match(/^(resim|gorsel|görsel|video)\s+(?:uret|üret|olustur|oluştur|yap)\s*[:-]?\s+([\s\S]+)$/i);
    if (cr) return { intent: norm(cr[1]!) === "video" ? "create_video" : "create_image", args: { prompt: cr[2] }, reply: "" };
  }
  if (/(yetkili|insan|temsilci|canli destek)/.test(n)) return { intent: "human", args: {}, reply: "" };
  if (text.length >= 25) return { intent: "lead", args: { summary: text.slice(0, 300) }, reply: "" };
  const hi = user ? `Merhaba ${firstName(user.name)}! Nasıl yardımcı olabilirim? Tekliflerini, işlerini, kredini sorabilir ya da görsel/video üretmemi isteyebilirsin.` : `Merhaba, Nordvow'a hoş geldiniz! Size nasıl yardımcı olabilirim? Kayıtlıysanız e-posta adresinizi yazarak hesabınızı bağlayabilirsiniz; değilseniz ${APP_BASE()}/giris adresinden başlayabilirsiniz.`;
  return { intent: "chat", args: {}, reply: hi };
}

// ───────────── Ana akış ─────────────

export async function handleChannelBotTurn(
  tenantId: string,
  convId: string,
  channel: ChannelProvider,
  contact: BotContact,
  rawText: string,
  now = new Date(),
  meta: BotTurnMeta = {},
): Promise<{ handled: boolean }> {
  const text = rawText.trim();
  if (!text) return { handled: false };

  // İnsan temsilci konuşmayı devraldıysa bot araya girmez.
  const conv = await prisma.conversation.findUnique({ where: { id: convId }, select: { status: true } });
  if (conv?.status === "assigned") return { handled: false };

  // OTP onayı her zaman deterministik (güvenlik).
  const code = text.match(/^(?:onayla\s+)?(\d{6})$/i)?.[1];
  if (code) {
    const otp = await readJson<OtpRecord>(otpKey(channel, contact.externalId));
    if (otp) {
      if (otp.expiresAt < Date.now() || otp.code !== code) {
        await reply(tenantId, convId, "Bu kod geçersiz ya da süresi dolmuş görünüyor. E-posta adresini tekrar yazarsan yeni kod gönderebilirim.");
        return { handled: true };
      }
      await remember(contact, otp.userId, "otp");
      await prisma.configValue.deleteMany({ where: { key: otpKey(channel, contact.externalId) } });
      const u = await prisma.user.findFirst({ where: { id: otp.userId }, select: { name: true } });
      await reply(tenantId, convId, `Harika, hesabın bağlandı ${firstName(u?.name)}! ✅ Artık tekliflerini, işlerini, kredini buradan sorabilir, görsel ya da video ürettirebilirsin.`);
      return { handled: true };
    }
  }

  const { user, justMatched } = await resolveLinkedUser(contact, meta);
  const d = (await decide(user, channel, contact, convId, text, justMatched)) ?? fallbackDecision(text, user);
  const lead = d.reply;

  // Tanınmayan kullanıcı veri/eylem isterse önce bağlama
  const needsUser: Intent[] = ["offers", "offer_respond", "jobs", "balance", "shorten", "create_image", "create_video"];
  if (!user && needsUser.includes(d.intent)) {
    await reply(tenantId, convId, lead || `Bunu yapabilmem için önce hesabını tanımam gerekiyor. Nordvow'a kayıtlı e-posta adresini yazar mısın? Hesabın yoksa ${APP_BASE()}/giris adresinden hemen oluşturabilirsin.`);
    return { handled: true };
  }

  switch (d.intent) {
    case "unlink": {
      await prisma.configValue.deleteMany({ where: { key: linkKey(channel, contact.externalId) } });
      await reply(tenantId, convId, "Tamamdır, hesap bağlantını kaldırdım. İstediğin zaman e-postanı yazarak yeniden bağlayabilirsin.");
      return { handled: true };
    }
    case "link_account": {
      const email = String(d.args.email ?? "").trim().toLowerCase();
      const u = email ? await prisma.user.findFirst({ where: { email, status: "ACTIVE" }, select: { id: true } }) : null;
      if (!u) {
        await reply(tenantId, convId, `Bu e-postayla aktif bir Nordvow hesabı bulamadım. Adresi kontrol eder misin? Hesabın yoksa ${APP_BASE()}/giris üzerinden kaydolabilirsin.`);
        return { handled: true };
      }
      const otp = String(randomInt(100000, 999999));
      await writeJson(otpKey(channel, contact.externalId), { userId: u.id, code: otp, expiresAt: Date.now() + 10 * 60_000 } satisfies OtpRecord);
      await prisma.notification.create({
        data: { userId: u.id, title: `${channel === "WHATSAPP" ? "WhatsApp" : "Instagram"} bağlantı kodu: ${otp}`, body: `Hesabını bağlamak için bu kodu sohbete yaz (10 dk geçerli).`, href: "/profil" },
      });
      await reply(tenantId, convId, `Güvenliğin için Nordvow panelindeki bildirimlerine 6 haneli bir kod gönderdim (${APP_BASE()}). Kodu buraya yazman yeterli 🔐`);
      return { handled: true };
    }
    case "offers": {
      await reply(tenantId, convId, await phrase(user, text, await offersData(user!, now)));
      return { handled: true };
    }
    case "offer_respond": {
      if (user!.role !== "INFLUENCER" || !user!.influencerId) {
        await reply(tenantId, convId, await phrase(user, text, await offersData(user!, now)));
        return { handled: true };
      }
      const decision = String(d.args.decision ?? "").toUpperCase() === "RED" ? "RED" : "KABUL";
      const idx = Number(d.args.index ?? 1) - 1;
      const offers = await pendingOffersFor(user!, now);
      const target = offers[idx];
      if (!target) {
        await reply(tenantId, convId, await phrase(user, text, `Bu sırada bekleyen teklif bulunamadı.\n${await offersData(user!, now)}`));
        return { handled: true };
      }
      try {
        const note = String(d.args.note ?? "").trim() || (decision === "RED" ? "WhatsApp/Instagram üzerinden reddedildi" : null);
        await respondOffer(target.id, user!.influencerId!, decision, note, now);
        await reply(tenantId, convId, decision === "KABUL" ? `Süper, "${target.title}" teklifini kabul ettim ✅ Detaylar panelinde: ${APP_BASE()}/influencer/teklifler` : `Anlaşıldı, "${target.title}" teklifini reddettim. Markaya iletildi.`);
      } catch (e) {
        await reply(tenantId, convId, `Bu teklifte işlem yapamadım: ${(e as Error).message}`);
      }
      return { handled: true };
    }
    case "jobs": {
      await reply(tenantId, convId, await phrase(user, text, await jobsData(user!, text)));
      return { handled: true };
    }
    case "balance": {
      await reply(tenantId, convId, await phrase(user, text, await balanceData(user!, tenantId)));
      return { handled: true };
    }
    case "shorten": {
      const url = String(d.args.url ?? text.match(/https?:\/\/\S+/i)?.[0] ?? "");
      if (!/^https?:\/\//i.test(url)) {
        await reply(tenantId, convId, lead || "Kısaltmamı istediğin linki gönderir misin?");
        return { handled: true };
      }
      const res = await createShortLink(url, { label: `${channel.toLowerCase()}-bot`, createdByUserId: user!.id });
      await reply(tenantId, convId, `Buyur, kısa linkin hazır: ${res.shortUrl}`);
      return { handled: true };
    }
    case "create_image":
    case "create_video": {
      const wantVideo = d.intent === "create_video";
      const prompt = String(d.args.prompt ?? "").trim();
      if (prompt.length < 10) {
        await reply(tenantId, convId, lead || `Ne tür bir ${wantVideo ? "video" : "görsel"} istediğini biraz anlatır mısın? Örneğin ürün, ortam, renkler ve format (dikey/kare).`);
        return { handled: true };
      }
      const kind = wantVideo ? "video" : "image";
      const chosen = await prisma.modelRegistry.findFirst({ where: { status: "active", kind }, orderBy: { creditsPerUnit: "asc" } });
      if (!chosen) {
        await reply(tenantId, convId, `Şu an ${wantVideo ? "video" : "görsel"} üretimi geçici olarak kapalı, kısa süre içinde açılacak.`);
        return { handled: true };
      }
      const a = String(d.args.aspect ?? "");
      const aspect = (a === "1:1" || a === "4:5" || a === "16:9" ? a : "9:16") as "9:16" | "1:1" | "4:5" | "16:9";
      try {
        const sub = await submitGeneration({ tenantId: creativeTenantOf(user!, tenantId), modelKey: chosen.key, prompt, aspect, seconds: wantVideo ? 5 : undefined });
        await reply(tenantId, convId, lead || `Tamam, ${wantVideo ? "videonu" : "görselini"} hazırlamaya başladım 🎨 Bitince linkini buraya atacağım.`);
        void watchCreativeAndNotify(tenantId, convId, sub.id, user!.id).catch(() => undefined);
      } catch (e) {
        await reply(tenantId, convId, `Üretimi başlatamadım: ${(e as Error).message}`);
      }
      return { handled: true };
    }
    case "lead":
    case "human": {
      const who = user ? `${user.name} (${ROLE_TR[user.role]})` : contact.name ?? contact.phoneE164 ?? contact.externalId;
      await notifyAdmins(
        d.intent === "human" ? `${channel}: yetkili talebi` : `${channel}: yeni talep`,
        `${who}: ${String(d.args.summary ?? text).slice(0, 300)}`,
        "/marka/gelen-kutusu",
      ).catch(() => undefined);
      if (d.intent === "human") await prisma.conversation.update({ where: { id: convId }, data: { status: "awaiting_human" } }).catch(() => undefined);
      await reply(
        tenantId,
        convId,
        lead || (d.intent === "human" ? "Hemen ekibimizden bir arkadaşa aktarıyorum, en kısa sürede buradan dönüş yapacak 🙏" : "Talebini aldım ve ekibimize ilettim, en kısa sürede dönüş yapacağız."),
      );
      return { handled: true };
    }
    default: {
      await reply(tenantId, convId, lead || fallbackDecision(text, user).reply || "Nasıl yardımcı olabilirim?");
      return { handled: true };
    }
  }
}
