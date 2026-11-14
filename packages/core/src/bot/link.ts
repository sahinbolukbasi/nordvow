import { prisma } from "../db";
import { DomainError } from "../domain/errors";
import type { ChannelProvider } from "../generated/prisma/enums";
import { phonesMatch, randomLinkCode, signAccountLink } from "./tokens";

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
  await linkChannel({ channel: "WHATSAPP", externalId: externalPhone.replace(/\D/g, ""), userId: hits[0]!.id });
  return { ok: true, userId: hits[0]!.id };
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
