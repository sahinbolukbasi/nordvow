import { prisma } from "../db";
import { DomainError } from "../domain/errors";
import type { ChannelProvider } from "../generated/prisma/enums";
import { normalizeSocialHandle } from "../social/handles";
import { igIdentity } from "./ig-identity";
import { canonicalPhone, phonesMatch, randomLinkCode, signAccountLink } from "./tokens";

export async function activeLink(channel: ChannelProvider, externalId: string) {
  return prisma.channelAccountLink.findFirst({
    where: { channel, externalId, revokedAt: null },
    include: { user: { select: { id: true, role: true, brandId: true, influencerId: true, name: true, email: true, phone: true, status: true } } },
  });
}

export async function linkChannel(input: { channel: ChannelProvider; externalId: string; userId: string }) {
  const existing = await prisma.channelAccountLink.findUnique({ where: { channel_externalId: { channel: input.channel, externalId: input.externalId } } });
  if (existing && !existing.revokedAt && existing.userId !== input.userId) {
    throw new DomainError("CAKISMA", "Bu kanal kimliği başka bir hesaba bağlı.");
  }
  if (existing) {
    return prisma.channelAccountLink.update({
      where: { id: existing.id },
      data: { userId: input.userId, verifiedAt: new Date(), revokedAt: null },
    });
  }
  return prisma.channelAccountLink.create({
    data: { channel: input.channel, externalId: input.externalId, userId: input.userId },
  });
}

export async function unlinkChannel(userId: string, channel: ChannelProvider) {
  await prisma.channelAccountLink.updateMany({ where: { userId, channel, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** WhatsApp: profildeki telefonla tek eşleşme varsa bağlar. Birden fazla veya yoksa bağlanmaz. */
export async function linkWhatsAppByPhone(externalPhone: string): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  const users = await prisma.user.findMany({ where: { phone: { not: null }, status: "ACTIVE" }, select: { id: true, phone: true } });
  const hits = users.filter((u) => phonesMatch(u.phone, externalPhone));
  if (hits.length !== 1) return { ok: false, reason: hits.length === 0 ? "eşleşme yok" : "birden fazla hesap" };
  await linkChannel({ channel: "WHATSAPP", externalId: canonicalPhone(externalPhone), userId: hits[0]!.id });
  return { ok: true, userId: hits[0]!.id };
}

async function flagHandleConflict(channel: ChannelProvider, externalId: string, handle: string, userIds: string[]) {
  const open = await prisma.botLinkFlag.findFirst({ where: { channel, externalId, handle, reason: "duplicate_handle" } });
  if (open) return;
  await prisma.botLinkFlag.create({ data: { channel, externalId, handle, reason: "duplicate_handle", userIds } });
}

/**
 * Instagram: IGSID → Graph username, profildeki kullanıcı adıyla tek eşleşme.
 * İki profil aynı adı kullanıyorsa bağlanmaz ve /admin/bot için işaret düşer.
 * Messenger kullanıcı adı çözmez.
 */
export async function linkInstagramByIgsid(igsid: string): Promise<{ ok: true; userId: string } | { ok: false; reason: string }> {
  const profile = await igIdentity().username(igsid);
  const handle = normalizeSocialHandle(profile?.username);
  if (!handle) return { ok: false, reason: "kullanıcı adı yok" };
  const accounts = await prisma.socialAccount.findMany({
    where: { platform: "INSTAGRAM" },
    select: {
      handle: true,
      verified: true,
      tokenRef: true,
      syncSource: true,
      influencer: { select: { user: { select: { id: true, status: true } } } },
    },
  });
  const hits = accounts.filter((a) => normalizeSocialHandle(a.handle) === handle && a.influencer.user?.status === "ACTIVE");
  const byUser = new Map<string, typeof hits>();
  for (const hit of hits) {
    const userId = hit.influencer.user!.id;
    byUser.set(userId, [...(byUser.get(userId) ?? []), hit]);
  }
  if (byUser.size === 0) return { ok: false, reason: "eşleşme yok" };
  if (byUser.size > 1) {
    await flagHandleConflict("INSTAGRAM", igsid, handle, [...byUser.keys()]);
    return { ok: false, reason: "birden fazla hesap" };
  }
  const [userId, rows] = [...byUser.entries()][0]!;
  // Tek kullanıcıda OAuth/senkron satırı varsa bağlarız. İki farklı kullanıcı aynı adı paylaşırsa yukarıda durur.
  if (rows.length > 1) rows.sort((a, b) => Number(b.verified || !!b.tokenRef) - Number(a.verified || !!a.tokenRef));
  await linkChannel({ channel: "INSTAGRAM", externalId: igsid, userId });
  return { ok: true, userId };
}

export async function autoLinkSender(channel: ChannelProvider, externalId: string, phone?: string | null) {
  if (channel === "WHATSAPP") return linkWhatsAppByPhone(phone || externalId);
  if (channel === "INSTAGRAM") return linkInstagramByIgsid(externalId);
  return { ok: false as const, reason: "messenger kod veya bağlantı" };
}

export async function issueLinkCode(userId: string, now = new Date()): Promise<string> {
  const code = randomLinkCode();
  const expiresAt = new Date(now.getTime() + 15 * 60_000);
  await prisma.botLinkCode.create({ data: { userId, code, expiresAt } });
  return code;
}

export async function consumeLinkCode(code: string, channel: ChannelProvider, externalId: string, now = new Date()) {
  const row = await prisma.botLinkCode.findFirst({
    where: { code, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (!row) throw new DomainError("BULUNAMADI", "Kod geçersiz veya süresi dolmuş.");
  await prisma.botLinkCode.update({ where: { id: row.id }, data: { usedAt: now } });
  await linkChannel({ channel, externalId, userId: row.userId });
  return row.userId;
}

export function magicLinkUrl(input: { externalId: string; channel: "INSTAGRAM" | "MESSENGER" }, appUrl: string): string {
  const token = signAccountLink(input);
  const base = appUrl.replace(/\/$/, "");
  return `${base}/hesap-bagla?token=${encodeURIComponent(token)}`;
}
