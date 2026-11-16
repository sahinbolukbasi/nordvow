import { prisma } from "../db";
import { DomainError } from "../domain/errors";
import type { ChannelProvider } from "../generated/prisma/enums";
import { normalizeSocialHandle } from "../social/handles";
import { igIdentity } from "./ig-identity";
import { audit } from "../audit";
import { canonicalPhone, hashEquals, hashLinkCode, LINK_CODE_TTL_MS, LINK_FAIL_LIMIT, LINK_FAIL_WINDOW_MS, phonesMatch, randomLinkCode, signAccountLink } from "./tokens";

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
  const rows = await prisma.channelAccountLink.findMany({ where: { userId, channel, revokedAt: null }, select: { externalId: true } });
  await prisma.channelAccountLink.updateMany({ where: { userId, channel, revokedAt: null }, data: { revokedAt: new Date() } });
  for (const row of rows) await recordLinkEvent({ channel, externalId: row.externalId, userId, action: "UNLINK" });
}

const GENERIC_CODE = "Kod geçersiz veya süresi dolmuş.";

async function recordLinkEvent(input: { channel: ChannelProvider; externalId: string; userId?: string | null; action: "LINK" | "UNLINK" | "FAIL" | "LOCKOUT" }) {
  await prisma.botLinkEvent.create({ data: { channel: input.channel, externalId: input.externalId, userId: input.userId ?? null, action: input.action } });
  try {
    await audit.append({
      actor: { id: input.userId ?? null, role: "BOT" },
      action: `BOT_LINK_${input.action}`,
      entityType: "ChannelAccountLink",
      entityId: input.externalId,
      data: { channel: input.channel },
    });
  } catch {
    // Denetim veritabanı yoksa bağlama yine de tamamlanır. Olay satırı durur.
  }
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

async function instagramUserIds(handle: string): Promise<string[]> {
  const [accounts, users] = await Promise.all([
    prisma.socialAccount.findMany({
      where: { platform: "INSTAGRAM" },
      select: { handle: true, influencer: { select: { user: { select: { id: true, status: true } } } } },
    }),
    prisma.user.findMany({ where: { instagramHandle: { not: null }, status: "ACTIVE" }, select: { id: true, instagramHandle: true } }),
  ]);
  const ids = new Set<string>();
  for (const account of accounts) {
    if (normalizeSocialHandle(account.handle) === handle && account.influencer.user?.status === "ACTIVE") ids.add(account.influencer.user.id);
  }
  for (const user of users) {
    if (normalizeSocialHandle(user.instagramHandle) === handle) ids.add(user.id);
  }
  return [...ids];
}

/**
 * Instagram kullanıcı adı bağlama yapmaz. Tek eşleşmede kod istenir.
 * Birden fazla profilde aynı ad varsa işaret düşer, tahmin edilmez.
 */
export async function suggestInstagramByIgsid(igsid: string): Promise<{ suggest: boolean }> {
  const profile = await igIdentity().username(igsid);
  const handle = normalizeSocialHandle(profile?.username);
  if (!handle) return { suggest: false };
  const ids = await instagramUserIds(handle);
  if (ids.length > 1) {
    await flagHandleConflict("INSTAGRAM", igsid, handle, ids);
    return { suggest: false };
  }
  return { suggest: ids.length === 1 };
}

export async function autoLinkSender(channel: ChannelProvider, externalId: string, phone?: string | null): Promise<{ ok: true; userId: string } | { ok: false; reason: string; suggest?: boolean }> {
  if (channel === "WHATSAPP") {
    const linked = await linkWhatsAppByPhone(phone || externalId);
    if (linked.ok) await recordLinkEvent({ channel, externalId: canonicalPhone(phone || externalId), userId: linked.userId, action: "LINK" });
    return linked;
  }
  if (channel === "INSTAGRAM") {
    const hint = await suggestInstagramByIgsid(externalId);
    return { ok: false, reason: "kod gerekli", suggest: hint.suggest };
  }
  return { ok: false, reason: "messenger kod veya bağlantı" };
}

export async function issueLinkCode(userId: string, now = new Date()): Promise<string> {
  const code = randomLinkCode();
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  await prisma.botLinkCode.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  await prisma.botLinkCode.create({ data: { userId, codeHash: hashLinkCode(code), expiresAt } });
  return code;
}

async function failCount(channel: ChannelProvider, externalId: string, now: Date) {
  return prisma.botLinkAttempt.count({
    where: { channel, externalId, createdAt: { gt: new Date(now.getTime() - LINK_FAIL_WINDOW_MS) } },
  });
}

export async function consumeLinkCode(code: string, channel: ChannelProvider, externalId: string, now = new Date()) {
  if ((await failCount(channel, externalId, now)) >= LINK_FAIL_LIMIT) {
    await recordLinkEvent({ channel, externalId, action: "LOCKOUT" });
    throw new DomainError("BULUNAMADI", GENERIC_CODE);
  }
  const candidates = await prisma.botLinkCode.findMany({ where: { usedAt: null, expiresAt: { gt: now } }, select: { id: true, userId: true, codeHash: true } });
  const digest = hashLinkCode(code);
  let match: { id: string; userId: string } | null = null;
  for (const row of candidates) {
    if (hashEquals(digest, row.codeHash)) match = { id: row.id, userId: row.userId };
  }
  if (!match) {
    await prisma.botLinkAttempt.create({ data: { channel, externalId, createdAt: now } });
    await recordLinkEvent({ channel, externalId, action: "FAIL" });
    throw new DomainError("BULUNAMADI", GENERIC_CODE);
  }
  await prisma.botLinkCode.update({ where: { id: match.id }, data: { usedAt: now } });
  await prisma.botLinkCode.updateMany({ where: { userId: match.userId, usedAt: null }, data: { usedAt: now } });
  await linkChannel({ channel, externalId, userId: match.userId });
  await recordLinkEvent({ channel, externalId, userId: match.userId, action: "LINK" });
  return match.userId;
}

export function magicLinkUrl(input: { externalId: string; channel: "INSTAGRAM" | "MESSENGER" }, appUrl: string): string {
  const token = signAccountLink(input);
  const base = appUrl.replace(/\/$/, "");
  return `${base}/hesap-bagla?token=${encodeURIComponent(token)}`;
}
