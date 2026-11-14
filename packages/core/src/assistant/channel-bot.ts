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
import type { ChannelProvider } from "../generated/prisma/enums";

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

type LinkRecord = { userId: string; linkedAt: string };
type OtpRecord = { userId: string; code: string; expiresAt: number };

const APP_BASE = () => envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "");
const linkKey = (channel: ChannelProvider, extId: string) => `bot.link.${channel}.${extId}`;
const otpKey = (channel: ChannelProvider, extId: string) => `bot.otp.${channel}.${extId}`;

async function readJson<T>(key: string): Promise<T | null> {
  const row = await prisma.configValue.findUnique({ where: { key }, select: { value: true } });
  return (row?.value as T | undefined) ?? null;
}

async function writeJson(key: string, value: unknown) {
  await prisma.configValue.upsert({
    where: { key },
    create: { key, value: value as never },
    update: { value: value as never },
  });
}

async function reply(tenantId: string, convId: string, text: string) {
  await sendMessage({ tenantId, conversationId: convId, byUserId: null, text });
}

function norm(s: string): string {
  return s
    .trim()
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i");
}

function last10Digits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

async function resolveLinkedUser(contact: BotContact): Promise<LinkedUser | null> {
  const saved = await readJson<LinkRecord>(linkKey(contact.channel, contact.externalId));
  if (saved?.userId) {
    const u = await prisma.user.findFirst({
      where: { id: saved.userId, status: "ACTIVE" },
      select: { id: true, name: true, email: true, role: true, brandId: true, influencerId: true },
    });
    if (u) return u;
  }
  // WhatsApp için doğrulanmış telefon numarası üzerinden otomatik eşleşme
  if (contact.channel === "WHATSAPP") {
    const tail = last10Digits(contact.phoneE164);
    if (tail) {
      const candidates = await prisma.user.findMany({
        where: { status: "ACTIVE", phone: { endsWith: tail } },
        select: { id: true, name: true, email: true, role: true, brandId: true, influencerId: true },
        take: 2,
      });
      if (candidates.length === 1) {
        await writeJson(linkKey(contact.channel, contact.externalId), { userId: candidates[0]!.id, linkedAt: new Date().toISOString() });
        return candidates[0]!;
      }
    }
  }
  return null;
}

function creativeTenantOf(u: LinkedUser, fallbackTenantId: string): string {
  if (u.brandId) return u.brandId;
  if (u.influencerId) return `inf:${u.influencerId}`;
  return fallbackTenantId;
}

function menuText(u: LinkedUser | null): string {
  const base = APP_BASE();
  if (!u) {
    return [
      `Merhaba! *Nordvow* Influencer & Creative AI Platformuna hoş geldiniz.`,
      `• Web sitemiz: ${base}`,
      `• Giriş & Kayıt: ${base}/giris`,
      ``,
      `Hesabınız varsa bağlamak için:`,
      `👉 *bagla eposta@adresiniz.com*`,
      ``,
      `Platform hakkında sorunuzu veya marka/influencer talebinizi buraya yazabilirsiniz; ekibimize anında iletiriz.`,
    ].join("\n");
  }
  const lines = [
    `Merhaba *${u.name}* (${u.role === "BRAND" ? "Marka" : u.role === "INFLUENCER" ? "Influencer" : "Ajans"})!`,
    `Kullanabileceğiniz hızlı komutlar:`,
    `• *teklifler* — Bekleyen teklifleri gör${u.role === "INFLUENCER" ? " (kabul/red için: teklif kabul 1)" : ""}`,
    `• *isler* — Aktif kampanya ve işlerini gör`,
    `• *bakiye* — Creative kredi ve bakiye durumun`,
    `• *kisalt https://...* — Hızlı kısa link oluştur`,
    `• *resim uret: <istek>* — Creative Stüdyo ile görsel üret`,
    `• *video uret: <istek>* — Creative Stüdyo ile video üret`,
    `• *cikis* — Hesap bağlantısını kaldır`,
    `Panel: ${base}`,
  ];
  return lines.join("\n");
}

async function watchCreativeAndNotify(tenantId: string, convId: string, jobId: string, userId: string) {
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const job = await prisma.creativeJob.findUnique({
      where: { id: jobId },
      select: { status: true, rejectReason: true },
    });
    if (!job) return;
    if (job.status === "COMPLETED") {
      const asset = await prisma.generatedAsset.findFirst({ where: { jobId }, select: { id: true } });
      if (!asset) continue;
      const fileUrl = `${APP_BASE()}/api/creative/file/${asset.id}?t=asset`;
      const short = await createShortLink(fileUrl, { label: "creative-bot", createdByUserId: userId }).catch(() => null);
      await reply(tenantId, convId, `✅ Creative üretiminiz hazır!\nGörüntüle/İndir: ${short?.shortUrl ?? fileUrl}\nStüdyo: ${APP_BASE()}/creative?sekme=galeri`);
      return;
    }
    if (job.status === "FAILED" || job.status === "REJECTED") {
      await reply(tenantId, convId, `❌ Üretim tamamlanamadı: ${job.rejectReason ?? "Politika veya sağlayıcı hatası (kredi iade edildi)."}`);
      return;
    }
  }
  await reply(tenantId, convId, `⏳ Üretiminiz devam ediyor. Hazır olduğunda Creative Galeri'den görebilirsiniz: ${APP_BASE()}/creative?sekme=galeri`);
}

/**
 * WhatsApp & Instagram akıllı bot katmanı:
 *  - Kayıtlı marka/influencer bağlama (OTP / telefon eşleşme)
 *  - Teklifler (listeleme + kabul/red), işler, bakiye, kısa link, Creative Stüdyo (resim/video)
 *  - Kayıtsız kullanıcılar için bilgilendirme, web sitesi yönlendirme ve talep dinleme
 */
export async function handleChannelBotTurn(
  tenantId: string,
  convId: string,
  channel: ChannelProvider,
  contact: BotContact,
  rawText: string,
  now = new Date(),
): Promise<{ handled: boolean }> {
  const text = rawText.trim();
  if (!text) return { handled: false };
  const n = norm(text);

  // 1. Bağlantı kesme
  if (n === "cikis" || n === "baglantiyi kes") {
    await prisma.configValue.deleteMany({ where: { key: linkKey(channel, contact.externalId) } });
    await reply(tenantId, convId, "Hesap bağlantınız kaldırıldı. Yeniden bağlamak için `bagla eposta@adresiniz.com` yazabilirsiniz.");
    return { handled: true };
  }

  // 2. E-posta ile güvenli hesap bağlama (OTP)
  const baglaMatch = text.match(/^(?:bagla|bağla)\s+([^\s@]+@[^\s@]+\.[^\s@]+)$/i);
  if (baglaMatch) {
    const email = baglaMatch[1]!.toLowerCase();
    const u = await prisma.user.findFirst({ where: { email, status: "ACTIVE" }, select: { id: true, name: true } });
    if (!u) {
      await reply(tenantId, convId, `Bu e-posta ile aktif bir Nordvow hesabı bulunamadı. Kayıt veya giriş için: ${APP_BASE()}/giris`);
      return { handled: true };
    }
    const code = String(randomInt(100000, 999999));
    await writeJson(otpKey(channel, contact.externalId), { userId: u.id, code, expiresAt: Date.now() + 10 * 60_000 } satisfies OtpRecord);
    await prisma.notification.create({
      data: {
        userId: u.id,
        title: `${channel === "WHATSAPP" ? "WhatsApp" : "Instagram"} Bağlantı Kodu: ${code}`,
        body: `Hesabınızı bağlamak için sohbete "onayla ${code}" yazın (10 dakika geçerlidir).`,
        href: "/profil",
      },
    });
    await reply(
      tenantId,
      convId,
      `🔐 Güvenliğiniz için Nordvow hesabınızdaki bildirimlere (${APP_BASE()}) 6 haneli bir doğrulama kodu gönderdik.\nOnaylamak için: *onayla <kod>* yazın.`,
    );
    return { handled: true };
  }

  const onaylaMatch = text.match(/^onayla\s+(\d{6})$/i);
  if (onaylaMatch) {
    const otp = await readJson<OtpRecord>(otpKey(channel, contact.externalId));
    if (!otp || otp.expiresAt < Date.now() || otp.code !== onaylaMatch[1]) {
      await reply(tenantId, convId, "Kod geçersiz veya süresi dolmuş. Tekrar `bagla eposta@adresiniz.com` yazın.");
      return { handled: true };
    }
    await writeJson(linkKey(channel, contact.externalId), { userId: otp.userId, linkedAt: new Date().toISOString() } satisfies LinkRecord);
    await prisma.configValue.deleteMany({ where: { key: otpKey(channel, contact.externalId) } });
    const u = await resolveLinkedUser(contact);
    await reply(tenantId, convId, `✅ Hesabınız güvenli şekilde bağlandı!\n\n${menuText(u)}`);
    return { handled: true };
  }

  const user = await resolveLinkedUser(contact);

  // 3. Menü / Yardım / Bilgilendirme
  if (n === "menu" || n === "yardim" || n === "komutlar" || n === "merhaba" || n === "selam" || n === "hi" || n === "hello") {
    await reply(tenantId, convId, menuText(user));
    return { handled: true };
  }

  // 4. Kayıtsız kullanıcı için bilgilendirme, web yönlendirme ve talep dinleme
  if (!user) {
    if (n.includes("fiyat") || n.includes("nedir") || n.includes("bilgi") || n.includes("nasil") || n.includes("site") || n.includes("kayit")) {
      await reply(tenantId, convId, menuText(null));
      return { handled: true };
    }
    if (n.startsWith("talep") || n.startsWith("basvuru") || text.length >= 12) {
      await notifyAdmins(
        `${channel} üzerinden yeni talep`,
        `${contact.name ?? contact.phoneE164 ?? contact.externalId}: ${text.slice(0, 300)}`,
        "/marka/gelen-kutusu",
      ).catch(() => undefined);
      await reply(
        tenantId,
        convId,
        `📩 Talebiniz ekibimize iletildi!\nWeb sitemiz: ${APP_BASE()}\nKayıtlı kullanıcıysanız hesabınızı bağlamak için *bagla eposta@adresiniz.com* yazabilirsiniz.`,
      );
      return { handled: true };
    }
    return { handled: false };
  }

  // 5. Link Kısaltma
  const shortMatch = text.match(/^(?:kisalt|kısalt|link)\s+(https?:\/\/\S+)$/i);
  if (shortMatch) {
    const res = await createShortLink(shortMatch[1]!, { label: `${channel.toLowerCase()}-bot`, createdByUserId: user.id });
    await reply(tenantId, convId, `🔗 Kısa linkiniz hazır:\n${res.shortUrl}`);
    return { handled: true };
  }

  // 6. Creative Stüdyo (Resim / Video Üretimi)
  const creativeMatch = text.match(/^(resim|gorsel|görsel|video)\s+(?:uret|üret|olustur|oluştur|yap)\s*[:\-]?\s+([\s\S]+)$/i);
  if (creativeMatch) {
    const wantVideo = norm(creativeMatch[1]!) === "video";
    const prompt = creativeMatch[2]!.trim();
    if (prompt.length < 10) {
      await reply(tenantId, convId, "Lütfen en az 10 karakterlik bir açıklama yazın. Örn: `resim üret: pastel stüdyoda minimalist kahve bardağı`");
      return { handled: true };
    }
    const cTenant = creativeTenantOf(user, tenantId);
    const kind = wantVideo ? "video" : "image";
    const models = await prisma.modelRegistry.findMany({ where: { status: "active", kind }, orderBy: { creditsPerUnit: "asc" }, take: 5 });
    const chosen = models[0];
    if (!chosen) {
      await reply(tenantId, convId, `Şu an aktif ${wantVideo ? "video" : "görsel"} üretim modeli bulunamadı.`);
      return { handled: true };
    }
    const aspect = text.includes("16:9") ? "16:9" : text.includes("4:5") ? "4:5" : text.includes("1:1") ? "1:1" : "9:16";
    try {
      const sub = await submitGeneration({
        tenantId: cTenant,
        modelKey: chosen.key,
        prompt,
        aspect,
        seconds: wantVideo ? 5 : undefined,
      });
      await reply(tenantId, convId, `🎨 ${wantVideo ? "Video" : "Görsel"} üretimi başlatıldı (${chosen.key}, ${aspect}). Hazır olduğunda linki buraya göndereceğim…`);
      void watchCreativeAndNotify(tenantId, convId, sub.id, user.id).catch(() => undefined);
    } catch (e) {
      await reply(tenantId, convId, `❌ Üretim başlatılamadı: ${(e as Error).message}`);
    }
    return { handled: true };
  }

  // 7. Teklifler (Listeleme + Kabul / Red)
  if (n === "teklifler" || n === "tekliflerim") {
    if (user.role === "INFLUENCER" && user.influencerId) {
      const offers = await prisma.offer.findMany({
        where: { influencerId: user.influencerId, status: { in: ["GONDERILDI", "KARSI_TEKLIF"] }, expiresAt: { gt: now } },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      if (!offers.length) {
        await reply(tenantId, convId, `Bekleyen yeni teklifiniz yok. Tüm teklifler: ${APP_BASE()}/influencer/teklifler`);
        return { handled: true };
      }
      const lines = offers.map((o, i) => `${i + 1}. *${o.title}* — ${formatKurus(o.counterKurus ?? o.totalKurus)}`);
      await reply(
        tenantId,
        convId,
        `📩 Bekleyen Teklifleriniz:\n${lines.join("\n")}\n\nYanıtlamak için:\n• *teklif kabul 1*\n• *teklif red 1 <neden>*\nDetay: ${APP_BASE()}/influencer/teklifler`,
      );
      return { handled: true };
    }
    if (user.role === "BRAND" && user.brandId) {
      const offers = await prisma.offer.findMany({ where: { brandId: user.brandId }, orderBy: { createdAt: "desc" }, take: 5 });
      if (!offers.length) {
        await reply(tenantId, convId, `Henüz teklif göndermediniz. Keşfet: ${APP_BASE()}/marka/kesfet`);
        return { handled: true };
      }
      const lines = offers.map((o, i) => `${i + 1}. *${o.title}* (${o.status}) — ${formatKurus(o.counterKurus ?? o.totalKurus)}`);
      await reply(tenantId, convId, `📤 Son Teklifleriniz:\n${lines.join("\n")}\nDetay: ${APP_BASE()}/marka/teklifler`);
      return { handled: true };
    }
  }

  const offerActionMatch = n.match(/^teklif\s+(kabul|red)\s+(\d+)(?:\s+([\s\S]+))?$/);
  if (offerActionMatch && user.role === "INFLUENCER" && user.influencerId) {
    const decision = offerActionMatch[1] === "kabul" ? "KABUL" : "RED";
    const idx = Number(offerActionMatch[2]) - 1;
    const note = offerActionMatch[3]?.trim() || (decision === "RED" ? "Bot üzerinden reddedildi" : null);
    const offers = await prisma.offer.findMany({
      where: { influencerId: user.influencerId, status: { in: ["GONDERILDI", "KARSI_TEKLIF"] }, expiresAt: { gt: now } },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    const target = offers[idx];
    if (!target) {
      await reply(tenantId, convId, "Bu numarada bekleyen teklif bulunamadı. Önce `teklifler` yazın.");
      return { handled: true };
    }
    try {
      await respondOffer(target.id, user.influencerId, decision, note, now);
      await reply(tenantId, convId, decision === "KABUL" ? `✅ *${target.title}* teklifi kabul edildi!` : `Teklif reddedildi: *${target.title}*`);
    } catch (e) {
      await reply(tenantId, convId, `İşlem yapılamadı: ${(e as Error).message}`);
    }
    return { handled: true };
  }

  // 8. İşler / Kampanyalar
  if (n === "isler" || n === "islerim" || n === "kampanyalar" || n === "kampanyalarim") {
    if (user.role === "INFLUENCER" && user.influencerId) {
      const jobs = await prisma.deliverable.findMany({
        where: { assignment: { influencerId: user.influencerId }, status: { notIn: ["TAMAMLANDI", "IPTAL"] } },
        orderBy: { plannedAt: "asc" },
        take: 5,
        select: { platform: true, contentType: true, status: true, assignment: { select: { campaign: { select: { name: true } } } } },
      });
      if (!jobs.length) {
        await reply(tenantId, convId, `Aktif işiniz bulunmuyor. Panel: ${APP_BASE()}/influencer`);
        return { handled: true };
      }
      const lines = jobs.map((j, i) => `${i + 1}. *${j.assignment.campaign.name}* (${j.platform} ${j.contentType}) — ${j.status}`);
      await reply(tenantId, convId, `🎬 Aktif İşleriniz:\n${lines.join("\n")}\nDetay: ${APP_BASE()}/influencer`);
      return { handled: true };
    }
    if (user.role === "BRAND" && user.brandId) {
      const camps = await prisma.campaign.findMany({
        where: { brandId: user.brandId, status: { in: ["TASLAK", "AKTIF"] } },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { name: true, status: true, executionMode: true },
      });
      if (!camps.length) {
        await reply(tenantId, convId, `Açık kampanyanız yok. Yeni kampanya: ${APP_BASE()}/marka/kampanyalar/yeni`);
        return { handled: true };
      }
      const lines = camps.map((c, i) => `${i + 1}. *${c.name}* (${c.status} · ${c.executionMode})`);
      await reply(tenantId, convId, `📊 Kampanyalarınız:\n${lines.join("\n")}\nPanel: ${APP_BASE()}/marka/kampanyalar`);
      return { handled: true };
    }
  }

  // 9. Bakiye / Kredi
  if (n === "bakiye" || n === "kredi") {
    const cTenant = creativeTenantOf(user, tenantId);
    const acc = await prisma.creditAccount.findUnique({ where: { tenantId: cTenant }, select: { balanceCredits: true } });
    const credits = Number(acc?.balanceCredits ?? 0);
    let extra = "";
    if (user.role === "INFLUENCER" && user.influencerId) {
      const bal = await computeBalances(user.influencerId);
      extra = `\n💰 Çekilebilir Bakiye: ${formatKurus(bal.cekilebilir)}`;
    }
    await reply(tenantId, convId, `🎨 Creative Stüdyo Krediniz: *${credits.toLocaleString("tr-TR")} Kredi*${extra}\nPanel: ${APP_BASE()}/creative`);
    return { handled: true };
  }

  return { handled: false };
}
