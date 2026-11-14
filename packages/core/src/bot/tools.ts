import { audit } from "../audit";
import { prisma } from "../db";
import { formatKurus } from "../domain/labels";
import { computeBalances } from "../domain/ledger";
import { inviteToEvent, respondInvite } from "../events/service";
import { envStr } from "../env";
import { createShortLink } from "../notify/shortlink";
import type { BotUser } from "./types";

function maskIban(iban: string | null | undefined): string {
  const d = (iban ?? "").replace(/\s/g, "");
  if (d.length < 4) return "kayıtlı değil";
  return `****${d.slice(-4)}`;
}

/** Araçlar yalnız ctx içindeki kullanıcıyı okur. Argümandaki userId yok sayılır. */
export async function toolAccount(ctx: BotUser, lang: "tr" | "en"): Promise<string> {
  const role = ctx.role;
  if (lang === "en") return `Account: ${ctx.name} (${role}). Details: /gizlilik`;
  return `Hesap: ${ctx.name} (${role}). Ayrıntı: /gizlilik`;
}

export async function toolCampaigns(ctx: BotUser, lang: "tr" | "en"): Promise<string> {
  if (ctx.role === "INFLUENCER" && ctx.influencerId) {
    const [offers, jobs] = await Promise.all([
      prisma.offer.findMany({ where: { influencerId: ctx.influencerId, status: "GONDERILDI" }, take: 5, select: { id: true } }),
      prisma.deliverable.findMany({
        where: { assignment: { influencerId: ctx.influencerId, contractStatus: "KABUL" }, status: { notIn: ["TAMAMLANDI", "IPTAL"] } },
        orderBy: { plannedAt: "asc" },
        take: 5,
        select: { plannedAt: true, assignment: { select: { campaign: { select: { name: true } } } } },
      }),
    ]);
    const lines = jobs.map((j) => `${j.assignment.campaign.name}: ${j.plannedAt.toISOString().slice(0, 16)}`);
    const head = lang === "en" ? `${offers.length} open offer(s). Upcoming:` : `${offers.length} açık teklif. Yaklaşan işler:`;
    return lines.length ? `${head}\n${lines.join("\n")}` : head;
  }
  if (ctx.role === "BRAND" && ctx.brandId) {
    const rows = await prisma.campaign.findMany({
      where: { brandId: ctx.brandId },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { name: true, status: true, budgetKurus: true },
    });
    if (!rows.length) return lang === "en" ? "No campaigns." : "Kampanya yok.";
    return rows.map((c) => `${c.name} · ${c.status} · ${formatKurus(Number(c.budgetKurus))}`).join("\n");
  }
  return lang === "en" ? "This role has no campaign list." : "Bu rol için kampanya listesi yok.";
}

export async function toolBalance(ctx: BotUser, lang: "tr" | "en"): Promise<string> {
  if (ctx.role !== "INFLUENCER" || !ctx.influencerId) {
    return lang === "en" ? "Balance is available for influencer accounts." : "Bakiye yalnız içerik üreticisi hesabında görünür.";
  }
  const b = await computeBalances(ctx.influencerId);
  const inf = await prisma.influencer.findUnique({ where: { id: ctx.influencerId }, select: { iban: true } });
  const open = await prisma.payoutRequest.findMany({
    where: { influencerId: ctx.influencerId, status: { in: ["TALEP_EDILDI", "ONAYLANDI", "ODEME_LISTESINDE"] } },
    take: 3,
    select: { status: true, amountKurus: true },
  });
  const withdrawable = Math.max(b.cekilebilir, 0);
  const payouts = open.map((p) => `${p.status} ${formatKurus(p.amountKurus)}`).join(", ") || (lang === "en" ? "none" : "yok");
  if (lang === "en") return `Withdrawable ${formatKurus(withdrawable)}. Pending ${formatKurus(b.hakedilen)}. IBAN ${maskIban(inf?.iban)}. Payouts: ${payouts}. /gizlilik`;
  return `Çekilebilir ${formatKurus(withdrawable)}. Bekleyen hakediş ${formatKurus(b.hakedilen)}. IBAN ${maskIban(inf?.iban)}. Çekim: ${payouts}. Ayrıntı: /gizlilik`;
}

export async function toolCoupons(ctx: BotUser, lang: "tr" | "en"): Promise<string> {
  if (!ctx.influencerId) return lang === "en" ? "No coupons on this account." : "Bu hesapta kupon yok.";
  const grants = await prisma.couponGrant.findMany({
    where: { influencerId: ctx.influencerId, status: { in: ["GONDERILDI", "GORULDU"] } },
    take: 5,
    include: { coupon: { select: { title: true, tenantId: true } } },
  });
  if (!grants.length) return lang === "en" ? "No coupon waiting." : "Bekleyen kupon yok.";
  return grants.map((g) => `${g.coupon.title}`).join("\n") + (lang === "en" ? "\nReply EVET to reveal a code." : "\nKodu görmek için EVET yazın.");
}

export async function claimCoupon(ctx: BotUser, lang: "tr" | "en"): Promise<string> {
  if (!ctx.influencerId) throw new Error("scope");
  const grant = await prisma.couponGrant.findFirst({
    where: { influencerId: ctx.influencerId, status: { in: ["GONDERILDI", "GORULDU"] } },
    orderBy: { createdAt: "asc" },
    include: { coupon: { select: { title: true, sharedCode: true } } },
  });
  if (!grant) return lang === "en" ? "No coupon to claim." : "Alınacak kupon yok.";
  await prisma.couponGrant.update({ where: { id: grant.id }, data: { status: "GORULDU" } });
  const code = grant.coupon.sharedCode ?? grant.code;
  await audit.append({ actor: { id: ctx.id, role: ctx.role }, action: "BOT_COUPON_CLAIM", entityType: "CouponGrant", entityId: grant.id, data: {} });
  return lang === "en" ? `Coupon ${grant.coupon.title}: ${code}` : `Kupon ${grant.coupon.title}: ${code}`;
}

export async function toolEvents(lang: "tr" | "en"): Promise<string> {
  const rows = await prisma.event.findMany({
    where: { visibility: "HERKESE_ACIK", status: "YAYINDA", startsAt: { gte: new Date() } },
    orderBy: { startsAt: "asc" },
    take: 5,
    select: { title: true, startsAt: true, city: true, priceKurus: true },
  });
  if (!rows.length) return lang === "en" ? "No upcoming public events. Sign up: /kayit" : "Yaklaşan herkese açık etkinlik yok. Kayıt: /kayit";
  return rows.map((e) => `${e.title} · ${e.startsAt.toISOString().slice(0, 10)} · ${e.city ?? ""} · ${e.priceKurus ? formatKurus(e.priceKurus) : lang === "en" ? "free" : "ücretsiz"}`).join("\n");
}

export async function reserveTicket(ctx: BotUser, titleQuery: string, lang: "tr" | "en"): Promise<string> {
  const event = await prisma.event.findFirst({
    where: { visibility: "HERKESE_ACIK", status: "YAYINDA", title: { contains: titleQuery || "", mode: "insensitive" } },
    orderBy: { startsAt: "asc" },
  });
  if (!event) return lang === "en" ? "Event not found." : "Etkinlik bulunamadı.";
  if ((event.priceKurus ?? 0) > 0) {
    const base = envStr("APP_URL", "http://localhost:3000").replace(/\/$/, "");
    return lang === "en"
      ? `Paid ticket. Pay on the site, never send card details here: ${base}/etkinlik/${event.id}`
      : `Ücretli bilet. Ödeme sitede yapılır, kart bilgisi burada yazılmasın: ${base}/etkinlik/${event.id}`;
  }
  const existing = await prisma.eventInvite.findFirst({
    where: { eventId: event.id, OR: [{ userId: ctx.id }, ...(ctx.influencerId ? [{ influencerId: ctx.influencerId }] : [])] },
    include: { ticket: true },
  });
  const invite = existing ?? (await inviteToEvent({ eventId: event.id, userId: ctx.id, influencerId: ctx.influencerId, guestName: ctx.name, isRequest: true }));
  const issued = existing?.ticket && existing.ticket.status !== "IPTAL" ? existing.ticket : await respondInvite(invite.id, true, ctx.name);
  const code = "code" in issued ? issued.code : "";
  await audit.append({ actor: { id: ctx.id, role: ctx.role }, action: "BOT_TICKET", entityType: "Event", entityId: event.id, data: {} });
  return lang === "en" ? `Ticket ${event.title}. Code ${code}` : `Bilet ${event.title}. Kod ${code}`;
}

export async function ticketStatus(ctx: BotUser, code: string, lang: "tr" | "en"): Promise<string> {
  const ticket = await prisma.eventTicket.findUnique({
    where: { code },
    include: { event: { select: { title: true } }, invite: { select: { userId: true, influencerId: true } } },
  });
  if (!ticket) return lang === "en" ? "Ticket not found." : "Bilet bulunamadı.";
  const mine = ticket.invite?.userId === ctx.id || (ctx.influencerId && ticket.invite?.influencerId === ctx.influencerId);
  if (!mine) return lang === "en" ? "This ticket is not on your account." : "Bu bilet hesabınıza ait değil.";
  return `${ticket.event.title}: ${ticket.status} ${ticket.code}`;
}

export async function listLinks(ctx: BotUser, lang: "tr" | "en"): Promise<string> {
  const where = ctx.role === "BRAND" && ctx.brandId ? { tenantId: ctx.brandId } : { createdByUserId: ctx.id };
  const rows = await prisma.shortLink.findMany({ where, orderBy: { createdAt: "desc" }, take: 5, select: { slug: true, clicks: true } });
  if (!rows.length) return lang === "en" ? "No short links." : "Kısa link yok.";
  return rows.map((r) => `/l/${r.slug} · ${r.clicks}`).join("\n");
}

export async function makeLink(ctx: BotUser, url: string): Promise<string> {
  const tenantId = ctx.role === "BRAND" ? ctx.brandId : ctx.role === "INFLUENCER" ? ctx.influencerId : null;
  const link = await createShortLink(url, { createdByUserId: ctx.id, tenantId });
  await audit.append({ actor: { id: ctx.id, role: ctx.role }, action: "BOT_SHORTLINK", entityType: "ShortLink", entityId: link.id, data: {} });
  return link.shortUrl;
}

export async function toolApprovals(ctx: BotUser, lang: "tr" | "en"): Promise<string> {
  if (ctx.role !== "BRAND" || !ctx.brandId) return lang === "en" ? "Approvals are for brand accounts." : "Onaylar marka hesabında.";
  const n = await prisma.deliverable.count({ where: { status: "ICERIK_YUKLENDI", assignment: { campaign: { brandId: ctx.brandId } } } });
  return lang === "en" ? `${n} content item(s) waiting for approval.` : `${n} içerik onay bekliyor.`;
}
