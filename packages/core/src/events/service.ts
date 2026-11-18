import { prisma } from "../db";
import { DomainError } from "../domain/errors";
import { uniqueCode } from "../wallet/maps";

/**
 * Etkinlik yönetimi: oluşturma, davet, katılım talebi ve biletleme.
 * Bilet oluşturulurken benzersiz QR jetonu üretilir; kapasite aşımı engellenir.
 */
export type CreateEventInput = {
  tenantId?: string | null;
  title: string;
  description: string;
  coverImageKey?: string | null;
  imageKeys?: string[];
  venueName?: string | null;
  address?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  startsAt: Date;
  endsAt?: Date | null;
  visibility: "HERKESE_ACIK" | "KAPALI";
  capacity?: number | null;
  createdByUserId?: string | null;
};

export async function createEvent(input: CreateEventInput) {
  if (input.endsAt && input.endsAt < input.startsAt) throw new DomainError("DOGRULAMA", "Bitiş tarihi başlangıçtan önce olamaz.");
  return prisma.event.create({
    data: {
      tenantId: input.tenantId ?? null,
      title: input.title,
      description: input.description,
      coverImageKey: input.coverImageKey ?? null,
      imageKeys: input.imageKeys ?? [],
      venueName: input.venueName ?? null,
      address: input.address ?? null,
      city: input.city ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      visibility: input.visibility,
      capacity: input.capacity ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
}

const EVENT_TRANSITIONS: Record<string, string[]> = {
  TASLAK: ["YAYINDA", "IPTAL"],
  YAYINDA: ["IPTAL", "TAMAMLANDI"],
  IPTAL: [],
  TAMAMLANDI: [],
};

export async function setEventStatus(id: string, to: "TASLAK" | "YAYINDA" | "IPTAL" | "TAMAMLANDI") {
  const e = await prisma.event.findUnique({ where: { id }, select: { status: true } });
  if (!e) throw new DomainError("BULUNAMADI", "Etkinlik bulunamadı.");
  if (!EVENT_TRANSITIONS[e.status]!.includes(to)) throw new DomainError("KURAL_IHLALI", `'${e.status}' durumundan '${to}' durumuna geçilemez.`);
  return prisma.event.update({ where: { id }, data: { status: to } });
}

/** Etkinliğe davet (marka/ajans) veya katılım talebi (kullanıcı) oluşturur. */
export async function inviteToEvent(input: { eventId: string; influencerId?: string | null; userId?: string | null; guestName?: string | null; guestEmail?: string | null; isRequest?: boolean }) {
  const event = await prisma.event.findUnique({ where: { id: input.eventId }, select: { id: true, status: true, visibility: true } });
  if (!event) throw new DomainError("BULUNAMADI", "Etkinlik bulunamadı.");
  if (input.isRequest && event.visibility === "KAPALI") throw new DomainError("KURAL_IHLALI", "Bu etkinlik kapalı; davet olmadan katılım talebi oluşturulamaz.");
  // Aynı influencer'a tekrar davet engellenir.
  if (input.influencerId) {
    const dup = await prisma.eventInvite.findFirst({ where: { eventId: input.eventId, influencerId: input.influencerId }, select: { id: true } });
    if (dup) throw new DomainError("CAKISMA", "Bu kişi zaten davet edilmiş.");
  }
  return prisma.eventInvite.create({
    data: {
      eventId: input.eventId,
      influencerId: input.influencerId ?? null,
      userId: input.userId ?? null,
      guestName: input.guestName ?? null,
      guestEmail: input.guestEmail ?? null,
      isRequest: input.isRequest ?? false,
      status: input.isRequest ? "KATILIM_TALEBI" : "DAVET_EDILDI",
    },
  });
}

/** Toplu davet: birden çok influencer'a tek seferde. */
export async function inviteManyToEvent(eventId: string, influencerIds: string[]) {
  const results = [];
  for (const influencerId of [...new Set(influencerIds)]) {
    try {
      results.push(await inviteToEvent({ eventId, influencerId }));
    } catch (e) {
      if (!(e instanceof DomainError && e.code === "CAKISMA")) throw e;
    }
  }
  return results;
}

/**
 * Daveti/talebi kabul eder ve bilet üretir (benzersiz QR kodu). Kapasite dolu ise engeller.
 * Ret durumunda bilet üretilmez.
 */
export async function respondInvite(inviteId: string, accept: boolean, holderName?: string) {
  const invite = await prisma.eventInvite.findUnique({
    where: { id: inviteId },
    include: { event: { select: { id: true, title: true, capacity: true, status: true } }, ticket: true },
  });
  const influencerName = invite?.influencerId ? (await prisma.influencer.findUnique({ where: { id: invite.influencerId }, select: { name: true } }))?.name : null;
  if (!invite) throw new DomainError("BULUNAMADI", "Davet bulunamadı.");

  // Katılmıyorum: varsa bileti iptal et, daveti RED yap. (Fikir değiştirmeye izin verilir.)
  if (!accept) {
    return prisma.$transaction(async (tx) => {
      if (invite.ticket && invite.ticket.status !== "IPTAL") {
        await tx.eventTicket.update({ where: { id: invite.ticket.id }, data: { status: "IPTAL" } });
      }
      return tx.eventInvite.update({ where: { id: inviteId }, data: { status: "RED", respondedAt: new Date() } });
    });
  }

  // Katılıyorum: zaten geçerli bileti varsa onu döndür (tekrar üretme).
  if (invite.ticket && invite.ticket.status !== "IPTAL") return invite.ticket;
  if (invite.event.status === "IPTAL") throw new DomainError("KURAL_IHLALI", "İptal edilmiş etkinliğe katılınamaz.");
  // Kapasite kontrolü (iptal olmayan biletler).
  if (invite.event.capacity != null) {
    const issued = await prisma.eventTicket.count({ where: { eventId: invite.event.id, status: { not: "IPTAL" } } });
    if (issued >= invite.event.capacity) throw new DomainError("KURAL_IHLALI", "Etkinlik kapasitesi doldu.");
  }
  const name = holderName?.trim() || influencerName?.trim() || invite.guestName?.trim() || "Katılımcı";
  return prisma.$transaction(async (tx) => {
    await tx.eventInvite.update({ where: { id: inviteId }, data: { status: "KABUL", respondedAt: new Date() } });
    // Daha önce iptal edilmiş bir bilet varsa yeniden geçerli kıl; yoksa yeni üret.
    if (invite.ticket) {
      return tx.eventTicket.update({ where: { id: invite.ticket.id }, data: { status: "GECERLI", holderName: name } });
    }
    return tx.eventTicket.create({ data: { eventId: invite.event.id, inviteId, holderName: name, code: uniqueCode("TKT") } });
  });
}

/** QR jetonuyla bileti doğrular ve giriş yapar (idempotent: ikinci kez KULLANILDI döner). */
export async function checkInTicket(codeOrUrl: string, eventId?: string) {
  const raw = codeOrUrl.trim();
  const tktMatch = raw.match(/TKT-[A-Z0-9]+/i);
  const normalizedCode = (tktMatch ? tktMatch[0] : raw).toUpperCase();
  const biletIdMatch = raw.match(/\/bilet\/([a-z0-9]+)/i);
  const ticket =
    (await prisma.eventTicket.findUnique({
      where: { code: normalizedCode },
      include: { event: { select: { id: true, title: true, status: true } } },
    })) ??
    (biletIdMatch
      ? await prisma.eventTicket.findUnique({
          where: { id: biletIdMatch[1] },
          include: { event: { select: { id: true, title: true, status: true } } },
        })
      : null);
  if (!ticket) throw new DomainError("BULUNAMADI", "Bilet bulunamadı.");
  if (eventId && ticket.eventId !== eventId) {
    throw new DomainError("KURAL_IHLALI", `Bu bilet farklı bir etkinliğe ait (${ticket.event.title}).`);
  }
  if (ticket.status === "IPTAL") throw new DomainError("KURAL_IHLALI", "Bilet iptal edilmiş.");
  if (ticket.status === "KULLANILDI") return { ok: false as const, alreadyUsed: true, ticket };
  const updated = await prisma.eventTicket.update({ where: { id: ticket.id }, data: { status: "KULLANILDI", checkedInAt: new Date() } });
  return { ok: true as const, alreadyUsed: false, ticket: { ...ticket, ...updated } };
}

/** Kapıdan / yönetim panelinden tek adımda misafir + geçerli bilet ekler. */
export async function issueQuickTicket(input: { eventId: string; holderName: string; guestEmail?: string | null }) {
  const name = input.holderName.trim();
  if (name.length < 2) throw new DomainError("DOGRULAMA", "Katılımcı adı en az 2 karakter olmalı.");
  const event = await prisma.event.findUnique({ where: { id: input.eventId }, select: { id: true, status: true, capacity: true } });
  if (!event) throw new DomainError("BULUNAMADI", "Etkinlik bulunamadı.");
  if (event.status === "IPTAL") throw new DomainError("KURAL_IHLALI", "İptal edilmiş etkinliğe bilet eklenemez.");
  if (event.capacity != null) {
    const issued = await prisma.eventTicket.count({ where: { eventId: event.id, status: { not: "IPTAL" } } });
    if (issued >= event.capacity) throw new DomainError("KURAL_IHLALI", "Etkinlik kapasitesi doldu.");
  }
  return prisma.$transaction(async (tx) => {
    const invite = await tx.eventInvite.create({
      data: {
        eventId: event.id,
        guestName: name,
        guestEmail: input.guestEmail?.trim() || null,
        status: "KABUL",
        respondedAt: new Date(),
      },
    });
    return tx.eventTicket.create({
      data: {
        eventId: event.id,
        inviteId: invite.id,
        holderName: name,
        code: uniqueCode("TKT"),
      },
    });
  });
}

/** Yanlışlıkla okutulan bileti tekrar geçerli (bekleniyor) durumuna alır. */
export async function undoCheckInTicket(ticketId: string) {
  const ticket = await prisma.eventTicket.findUnique({ where: { id: ticketId }, select: { id: true, status: true } });
  if (!ticket) throw new DomainError("BULUNAMADI", "Bilet bulunamadı.");
  if (ticket.status === "IPTAL") throw new DomainError("KURAL_IHLALI", "İptal edilmiş bilet geri alınamaz.");
  return prisma.eventTicket.update({ where: { id: ticketId }, data: { status: "GECERLI", checkedInAt: null } });
}

/** Bileti iptal eder. */
export async function cancelEventTicket(ticketId: string) {
  const ticket = await prisma.eventTicket.findUnique({ where: { id: ticketId }, select: { id: true, inviteId: true } });
  if (!ticket) throw new DomainError("BULUNAMADI", "Bilet bulunamadı.");
  return prisma.$transaction(async (tx) => {
    if (ticket.inviteId) {
      await tx.eventInvite.update({ where: { id: ticket.inviteId }, data: { status: "IPTAL" } });
    }
    return tx.eventTicket.update({ where: { id: ticketId }, data: { status: "IPTAL" } });
  });
}
