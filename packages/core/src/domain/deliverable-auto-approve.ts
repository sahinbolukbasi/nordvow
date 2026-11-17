import { prisma } from "../db";
import type { Actor } from "../access/actor";
import { transitionDeliverable } from "./deliverable-status";

const AUTO_APPROVE_WINDOW_MS = 24 * 3_600_000;
const SYSTEM_ACTOR: Actor = { userId: "system-auto-approve", role: "ADMIN" };

/**
 * Influencer işi "Yapıldı" (ICERIK_YUKLENDI / YAYINLANDI / METRIK_BEKLIYOR)
 * olarak işaretledikten sonra marka 24 saat içinde onay veya revizyon talebi
 * vermezse teslimatı otomatik olarak TAMAMLANDI yapar, hak edişi Ledger'a
 * (HAKEDIS) yansıtır ve influencer'a bildirim gönderir.
 */
export async function autoApproveStaleDeliverables(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUTO_APPROVE_WINDOW_MS);

  const stale = await prisma.deliverable.findMany({
    where: {
      status: { in: ["ICERIK_YUKLENDI", "YAYINLANDI", "METRIK_BEKLIYOR"] },
      assignment: { contractStatus: "KABUL" },
      OR: [
        { publishedAt: { lte: cutoff } },
        { publishedAt: null, updatedAt: { lte: cutoff } },
      ],
    },
    select: {
      id: true,
      assignment: {
        select: {
          campaignId: true,
          campaign: { select: { name: true } },
          influencer: { select: { user: { select: { id: true } } } },
        },
      },
    },
    take: 100,
  });

  let approved = 0;

  for (const item of stale) {
    try {
      await prisma.$transaction(async (tx) => {
        await transitionDeliverable(tx, {
          deliverableId: item.id,
          to: "TAMAMLANDI",
          actor: SYSTEM_ACTOR,
          asSystem: true,
          note: "24 saat içinde marka yanıt vermediği için otomatik onaylandı ve hak edişe aktarıldı.",
        });

        const influencerUserId = item.assignment.influencer.user?.id;
        if (influencerUserId) {
          await tx.notification.create({
            data: {
              userId: influencerUserId,
              title: "Hak ediş yansıdı",
              body: `${item.assignment.campaign.name} kampanyasındaki işiniz 24 saatlik inceleme süresi dolduğu için otomatik onaylandı ve kazancınız Ödemeler sayfasına Hak Ediş olarak yansıtıldı.`,
              href: "/influencer/odemeler",
            },
          });
        }
      });
      approved++;
    } catch {
      // Başka bir işlem tarafından eşzamanlı olarak güncellendiyse atla.
    }
  }

  return approved;
}
