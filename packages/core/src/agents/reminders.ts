import { prisma } from "../db";
import { dispatchNotification, recipientsFromUserIds } from "../notify/dispatch";

const HOUR_MS = 3_600_000;

/**
 * Etkinlik zamanı (24 saat içinde), kupon son kullanım (48 saat içinde) ve
 * yaklaşan yapılacak işler (24 saat içinde) için e-posta + panel hatırlatması gönderir.
 */
export async function runRemindersJob(now = new Date()): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;

  // 1. Yaklaşan Etkinlikler (24 saat içinde başlayacak)
  const in24h = new Date(now.getTime() + 24 * HOUR_MS);
  const events = await prisma.event.findMany({
    where: { startsAt: { gte: now, lte: in24h } },
    select: { id: true, title: true, startsAt: true, venueName: true, address: true, city: true },
  });
  const evInvites = events.length
    ? await prisma.eventInvite.findMany({
        where: { eventId: { in: events.map((e) => e.id) }, status: { in: ["DAVET_EDILDI", "KABUL"] } },
        select: { eventId: true, influencerId: true, userId: true },
      })
    : [];
  const evInfIds = evInvites.map((i) => i.influencerId).filter((x): x is string => !!x);
  const evUsers = evInfIds.length
    ? await prisma.user.findMany({ where: { influencerId: { in: evInfIds } }, select: { id: true, influencerId: true } })
    : [];
  const uidByInf = new Map(evUsers.map((u) => [u.influencerId!, u.id]));

  for (const ev of events) {
    const tarih = ev.startsAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
    const konum = [ev.venueName, ev.address, ev.city].filter(Boolean).join(", ") || "Online / Belirtilen adres";
    for (const inv of evInvites.filter((i) => i.eventId === ev.id)) {
      const uid = inv.userId ?? (inv.influencerId ? uidByInf.get(inv.influencerId) : undefined);
      if (!uid) continue;
      const already = await prisma.notificationLog.findFirst({
        where: { eventKey: "EVENT_REMINDER", userId: uid, subject: { contains: ev.title } },
        select: { id: true },
      });
      if (already) {
        skipped++;
        continue;
      }
      const recipients = await recipientsFromUserIds([uid]);
      if (recipients.length) {
        await dispatchNotification("EVENT_REMINDER", recipients, {
          baslik: ev.title,
          tarih,
          konum,
          link: "/influencer/davetlerim",
        }).catch(() => undefined);
        created++;
      }
    }
  }

  // 2. Yaklaşan Kupon Son Kullanımları (48 saat içinde)
  const in48h = new Date(now.getTime() + 48 * HOUR_MS);
  const grants = await prisma.couponGrant.findMany({
    where: {
      status: "GONDERILDI",
      coupon: { validUntil: { gte: now, lte: in48h } },
      influencerId: { not: null },
    },
    include: {
      coupon: { select: { title: true, validUntil: true } },
    },
    take: 100,
  });
  const grantInfIds = grants.map((g) => g.influencerId).filter((x): x is string => !!x);
  const grantUsers = grantInfIds.length
    ? await prisma.user.findMany({ where: { influencerId: { in: grantInfIds } }, select: { id: true, influencerId: true } })
    : [];
  const grantUidByInf = new Map(grantUsers.map((u) => [u.influencerId!, u.id]));

  for (const g of grants) {
    const uid = g.influencerId ? grantUidByInf.get(g.influencerId) : undefined;
    if (!uid || !g.coupon.validUntil) continue;
    const already = await prisma.notificationLog.findFirst({
      where: { eventKey: "COUPON_REMINDER", userId: uid, body: { contains: g.code } },
      select: { id: true },
    });
    if (already) {
      skipped++;
      continue;
    }
    const recipients = await recipientsFromUserIds([uid]);
    if (recipients.length) {
      await dispatchNotification("COUPON_REMINDER", recipients, {
        baslik: g.coupon.title,
        kod: g.code,
        tarih: g.coupon.validUntil.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }),
        link: `/kupon/${g.id}`,
      }).catch(() => undefined);
      created++;
    }
  }

  // 3. Yaklaşan Yapılacak İşler (24 saat içinde teslim)
  const tasks = await prisma.deliverable.findMany({
    where: {
      plannedAt: { gte: now, lte: in24h },
      status: { in: ["ATANDI", "BRIEF_GONDERILDI", "REVIZYON"] },
    },
    include: {
      assignment: {
        include: {
          campaign: { select: { name: true } },
          influencer: { select: { user: { select: { id: true } } } },
        },
      },
    },
    take: 100,
  });
  for (const d of tasks) {
    const uid = d.assignment.influencer?.user?.id;
    if (!uid) continue;
    const linkPath = `/influencer/isler/${d.id}`;
    const already = await prisma.notificationLog.findFirst({
      where: { eventKey: "TASK_REMINDER", userId: uid, body: { contains: d.id } },
      select: { id: true },
    });
    if (already) {
      skipped++;
      continue;
    }
    const recipients = await recipientsFromUserIds([uid]);
    if (recipients.length) {
      await dispatchNotification("TASK_REMINDER", recipients, {
        kampanya: d.assignment.campaign.name,
        gorev: `${d.platform} ${d.contentType} teslimi`,
        tarih: d.plannedAt.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" }),
        link: linkPath,
      }).catch(() => undefined);
      created++;
    }
  }

  return { created, skipped };
}
