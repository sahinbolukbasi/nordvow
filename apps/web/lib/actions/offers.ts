"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { prisma, type ContentType, type Platform } from "@infulancer/core/db";
import { DomainError } from "@infulancer/core/domain/errors";
import { formatKurus } from "@infulancer/core/domain/labels";
import { acceptCounterByBrand, counterOffer, offerItemsSchema, respondOffer, saveRateCard, sendOffers, withdrawOffer, type OfferItem } from "@infulancer/core/domain/offers";
import { platformRules } from "@infulancer/core/domain/platform-rules";
import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, parseInput, revalidateAll, str, tlToKurus } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";
import { notifyAdmins, notifyInfluencer } from "@/lib/notify";
import { isDay, zonedToUtc, AGENCY_TZ } from "@/lib/time";

/** İçerik üreticisinin fiyat listesi: form alanları `p_<PLATFORM>_<TÜR>` (TL). */
export async function saveRateCardAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("INFLUENCER");
  return attempt(async () => {
    const rows: { platform: Platform; contentType: ContentType; priceKurus: number | null }[] = [];
    for (const [platform, rule] of Object.entries(platformRules) as [Platform, { contentTypes: readonly ContentType[] }][]) {
      for (const ct of rule.contentTypes) {
        const raw = str(fd, `p_${platform}_${ct}`);
        const k = raw ? tlToKurus(raw) : null;
        if (k != null && (!Number.isFinite(k) || k < 0)) throw new DomainError("DOGRULAMA", "Fiyatlar geçerli bir tutar olmalı.");
        rows.push({ platform, contentType: ct, priceKurus: k });
      }
    }
    await saveRateCard(actor.influencerId!, rows);
    await audit.append({ actor: toAuditActor(actor), action: "RATE_CARD_UPDATED", entityType: "Influencer", entityId: actor.influencerId!, data: { priced: rows.filter((r) => r.priceKurus).length } });
    revalidateAll();
    return { ok: true, message: "Fiyat listeniz kaydedildi; markalar artık görebilir." };
  });
}

const sendSchema = z.object({
  influencerIds: z.array(z.string().min(1).max(64)).min(1, { error: "En az bir içerik üreticisi seçin." }).max(50),
  title: z.string().trim().min(3, { error: "Teklif başlığı en az 3 karakter." }).max(140),
  message: z.string().trim().min(10, { error: "Mesaj en az 10 karakter." }).max(3000),
  publishBy: z.string().nullable().refine((v) => !v || isDay(v), { error: "Geçerli bir tarih girin." }),
  campaignId: z.string().max(64).nullable(),
  perInfluencerPricing: z.boolean(),
});

/** Marka seçtiği içerik üreticilerine teklif gönderir; her birine bildirim (mesaj) gider. */
export async function sendOffersAction(input: {
  influencerIds: string[];
  title: string;
  message: string;
  publishBy: string | null;
  campaignId: string | null;
  perInfluencerPricing: boolean;
  items: OfferItem[];
}): Promise<{ ok: boolean; error?: string; sent: number; skipped: { name: string; reason: string }[] }> {
  const actor = await requireActor("BRAND");
  const parsed = sendSchema.safeParse(input);
  const items = offerItemsSchema.safeParse(input.items);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message, sent: 0, skipped: [] };
  if (!items.success) return { ok: false, error: items.error.issues[0]?.message, sent: 0, skipped: [] };
  try {
    const d = parsed.data;
    const brand = await prisma.brand.findUniqueOrThrow({ where: { id: actor.brandId! }, select: { name: true } });
    const r = await sendOffers({
      brandId: actor.brandId!,
      createdById: actor.userId,
      influencerIds: d.influencerIds,
      title: d.title,
      message: d.message,
      publishBy: d.publishBy ? zonedToUtc(d.publishBy, "23:59", AGENCY_TZ) : null,
      campaignId: d.campaignId,
      perInfluencerPricing: d.perInfluencerPricing,
      items: items.data,
    });
    await prisma.$transaction(async (tx) => {
      for (const c of r.created) {
        const o = await tx.offer.findUniqueOrThrow({ where: { id: c.id }, select: { totalKurus: true } });
        await notifyInfluencer(tx, c.influencerId, { title: `Yeni teklif: ${brand.name}`, body: `“${d.title}” · ${formatKurus(o.totalKurus)}. ${d.message.slice(0, 160)}`, href: "/influencer/teklifler" });
      }
      if (r.created.length) await notifyAdmins(tx, { title: `${brand.name} ${r.created.length} teklif gönderdi`, body: d.title, href: "/admin/teklifler" });
    });
    for (const c of r.created) await audit.append({ actor: toAuditActor(actor), action: "OFFER_SENT", entityType: "Offer", entityId: c.id, data: { influencerId: c.influencerId } });
    const names = new Map((await prisma.influencer.findMany({ where: { id: { in: r.skipped.map((s) => s.influencerId) } }, select: { id: true, name: true } })).map((i) => [i.id, i.name]));
    revalidateAll();
    return { ok: r.created.length > 0, sent: r.created.length, skipped: r.skipped.map((s) => ({ name: names.get(s.influencerId) ?? s.influencerId, reason: s.reason })), error: r.created.length ? undefined : "Hiçbir teklif gönderilemedi." };
  } catch (e) {
    return { ok: false, error: e instanceof DomainError ? e.message : "Beklenmeyen hata.", sent: 0, skipped: [] };
  }
}

export async function respondOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("INFLUENCER");
  const res = await attempt(async () => {
    const input = parseInput(z.object({ id: z.string().min(1).max(64), decision: z.enum(["KABUL", "RED"]), note: z.string().max(1000).nullable() }), {
      id: str(fd, "id"),
      decision: str(fd, "decision"),
      note: optStr(fd, "note"),
    });
    const o = await respondOffer(input.id, actor.influencerId!, input.decision, input.note);
    const inf = await prisma.influencer.findUniqueOrThrow({ where: { id: actor.influencerId! }, select: { name: true } });
    const label = input.decision === "KABUL" ? "kabul etti" : "reddetti";
    await prisma.$transaction(async (tx) => {
      const users = await tx.user.findMany({ where: { brandId: o.brandId, status: "ACTIVE" }, select: { id: true } });
      if (users.length) await tx.notification.createMany({ data: users.map((u) => ({ userId: u.id, title: `${inf.name} teklifinizi ${label}`, body: input.note ?? o.title, href: "/marka/teklifler" })) });
      await notifyAdmins(tx, { title: `Teklif ${label}: ${inf.name}`, body: input.decision === "KABUL" ? "Kampanyaya eklemek için Teklifler sayfasına gidin." : (input.note ?? ""), href: "/admin/teklifler" });
    });
    await audit.append({ actor: toAuditActor(actor), action: input.decision === "KABUL" ? "OFFER_ACCEPTED" : "OFFER_DECLINED", entityType: "Offer", entityId: o.id, data: { note: input.note } });
    revalidateAll();
    return { ok: true, message: input.decision, data: { decision: input.decision } };
  });
  // Yanıtlanan teklif "bekleyen" listesinden düşer; sonuç sayfa üstünde gösterilsin diye yönlendirilir.
  if (res.ok) redirect(`/influencer/teklifler?sonuc=${res.data?.decision === "KABUL" ? "kabul" : "red"}&sekme=gecmis`);
  return res;
}

export async function withdrawOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("BRAND");
  return attempt(async () => {
    const o = await withdrawOffer(str(fd, "id"), actor.brandId!);
    await notifyInfluencer(prisma, o.influencerId, { title: "Teklif geri çekildi", body: o.title, href: "/influencer/teklifler" });
    await audit.append({ actor: toAuditActor(actor), action: "OFFER_WITHDRAWN", entityType: "Offer", entityId: o.id, data: {} });
    revalidateAll();
    return { ok: true, message: "Teklif geri çekildi." };
  });
}

/** Marka veya influencer: teklif için farklı fiyat talebinde bulunur. */
export async function counterOfferAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("BRAND", "INFLUENCER");
  return attempt(async () => {
    const id = str(fd, "id");
    const rawPrice = str(fd, "counterTl");
    const counterKurus = rawPrice ? tlToKurus(rawPrice) : 0;
    if (!Number.isInteger(counterKurus) || counterKurus <= 0) {
      throw new DomainError("DOGRULAMA", "Geçerli bir fiyat girin.");
    }
    const note = optStr(fd, "note");
    const role = actor.role === "BRAND" ? "BRAND" : "INFLUENCER";
    const o = await counterOffer(id, { role, brandId: actor.brandId, influencerId: actor.influencerId }, counterKurus, note);
    if (role === "BRAND") {
      await notifyInfluencer(prisma, o.influencerId, {
        title: `Karşı fiyat talebi: ${formatKurus(counterKurus)}`,
        body: note ? `${o.title} · ${note}` : o.title,
        href: "/influencer/teklifler",
      });
    } else {
      const users = await prisma.user.findMany({ where: { brandId: o.brandId, status: "ACTIVE" }, select: { id: true } });
      if (users.length) {
        await prisma.notification.createMany({
          data: users.map((u) => ({
            userId: u.id,
            title: `Influencer karşı fiyat önerdi: ${formatKurus(counterKurus)}`,
            body: note ? `${o.title} · ${note}` : o.title,
            href: "/marka/teklifler",
          })),
        });
      }
    }
    await audit.append({ actor: toAuditActor(actor), action: "OFFER_COUNTERED", entityType: "Offer", entityId: o.id, data: { role, counterKurus, note } });
    revalidateAll();
    return { ok: true, message: `Fiyat talebi gönderildi (${formatKurus(counterKurus)}).` };
  });
}

/** Marka: influencer'ın karşı fiyatını onaylar. */
export async function acceptCounterByBrandAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("BRAND");
  return attempt(async () => {
    const o = await acceptCounterByBrand(str(fd, "id"), actor.brandId!);
    await notifyInfluencer(prisma, o.influencerId, {
      title: `Karşı fiyatınız kabul edildi: ${formatKurus(o.totalKurus)}`,
      body: o.title,
      href: "/influencer/teklifler",
    });
    await notifyAdmins(prisma, { title: "Teklif karşı fiyatla kabul edildi", body: `${o.title} · ${formatKurus(o.totalKurus)}`, href: "/admin/teklifler" });
    await audit.append({ actor: toAuditActor(actor), action: "OFFER_ACCEPTED", entityType: "Offer", entityId: o.id, data: { counterAccepted: true } });
    revalidateAll();
    return { ok: true, message: `Fiyat onaylandı (${formatKurus(o.totalKurus)}).` };
  });
}
