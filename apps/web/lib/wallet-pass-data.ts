import { prisma } from "@infulancer/core/db";
import { BRAND_NAME } from "@infulancer/core/brand";
import { couponValueLabel } from "@infulancer/core/coupons/service";
import type { PassData } from "@infulancer/core/wallet/passes";
import { fmtDateTime } from "@/lib/time";

const ticketStatusLabel: Record<string, string> = {
  GECERLI: "Geçerli",
  KULLANILDI: "Giriş yapıldı",
  IPTAL: "İptal",
};

const grantStatusLabel: Record<string, string> = {
  GONDERILDI: "Kullanılabilir",
  GORULDU: "Kullanılabilir",
  KULLANILDI: "Kullanıldı",
  IPTAL: "İptal",
};

/** Bilet veya kupon için Apple/Google Wallet PassData yükler. */
export async function loadWalletPassData(kind: string, id: string): Promise<PassData | null> {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  if (kind === "ticket") {
    const t = await prisma.eventTicket.findUnique({
      where: { id },
      include: { event: true, invite: { select: { influencerId: true } } },
    });
    if (!t) return null;
    const e = t.event;
    const [brand, influencer] = await Promise.all([
      e.tenantId ? prisma.brand.findUnique({ where: { id: e.tenantId }, select: { name: true } }) : null,
      t.invite?.influencerId
        ? prisma.influencer.findUnique({ where: { id: t.invite.influencerId }, select: { name: true } })
        : null,
    ]);
    const locationText = [e.venueName, e.address, e.city].filter(Boolean).join(", ") || "-";
    return {
      kind: "ticket",
      title: e.title,
      subtitle: influencer?.name ?? t.holderName,
      code: t.code,
      organizer: brand?.name ?? BRAND_NAME,
      statusLabel: ticketStatusLabel[t.status] ?? t.status,
      description: e.description ?? undefined,
      accentColor: "#9d4dff",
      relevantDate: e.startsAt,
      expirationDate: e.endsAt ?? undefined,
      location:
        e.latitude != null && e.longitude != null
          ? { latitude: e.latitude, longitude: e.longitude, relevantText: e.venueName ?? e.title }
          : null,
      webUrl: `${base}/bilet/${id}`,
      fields: [
        { label: "Tarih", value: fmtDateTime(e.startsAt) },
        { label: "Mekan", value: locationText },
      ],
    };
  }

  const g = await prisma.couponGrant.findUnique({ where: { id }, include: { coupon: true } });
  const c = g?.coupon ?? (await prisma.coupon.findUnique({ where: { id } }));
  if (!c) return null;
  const brand = await prisma.brand.findUnique({ where: { id: c.tenantId }, select: { name: true } });
  const expired = !!c.validUntil && c.validUntil < new Date();
  const status = expired ? "Süresi doldu" : g ? (grantStatusLabel[g.status] ?? g.status) : "Önizleme";

  return {
    kind: "coupon",
    title: c.title,
    subtitle: couponValueLabel(c.valueType, c.value),
    code: c.sharedCode ?? g?.code ?? id,
    organizer: brand?.name ?? BRAND_NAME,
    statusLabel: status,
    description: c.description ?? undefined,
    terms: c.terms ?? undefined,
    accentColor: c.brandColor ?? "#ff2bd6",
    expirationDate: c.validUntil ?? undefined,
    webUrl: `${base}/kupon/${id}`,
    fields: [
      {
        label: "Son kullanım",
        value: c.validUntil ? c.validUntil.toLocaleDateString("tr-TR") : "Süresiz",
      },
    ],
  };
}
