import type { Metadata } from "next";
import { getTT } from "@/lib/i18n/tt-server";
import { prisma } from "@infulancer/core/db";
import { couponValueLabel } from "@infulancer/core/coupons/service";
import { getEventsPartnerMap } from "@infulancer/core/events/partners";
import { InfluencerInvitesView, type CouponCardItem, type InviteCardItem } from "@/components/events/influencer-invites-view";
import type { PillTone } from "@/components/luma/primitives";
import { requireActor } from "@/lib/auth-guard";
import { BRAND_NAME } from "@/lib/brand";
import { rangeLabel } from "@/lib/event-format";
import { mediaSrc } from "@/lib/media";
import { fmtDate } from "@/lib/time";

export const metadata: Metadata = { title: "Davetlerim" };
export const dynamic = "force-dynamic";

const inviteView: Record<string, { label: string; tone: PillTone }> = {
  DAVET_EDILDI: { label: "Yanıt bekliyor", tone: "amber" },
  KATILIM_TALEBI: { label: "Talebiniz iletildi", tone: "violet" },
  KABUL: { label: "Katılıyorsunuz", tone: "green" },
  RED: { label: "Katılmıyorsunuz", tone: "gray" },
  IPTAL: { label: "İptal", tone: "red" },
};
const grantView: Record<string, { label: string; tone: PillTone }> = {
  GONDERILDI: { label: "Kullanılabilir", tone: "green" },
  GORULDU: { label: "Kullanılabilir", tone: "green" },
  KULLANILDI: { label: "Kullanıldı", tone: "gray" },
  IPTAL: { label: "İptal", tone: "red" },
};

/** İçerik üreticisinin davetleri, sağ panelde bilet/kupon gösterimi ve yeni sekmede etkinlik sitesi. */
export default async function InfluencerInvitesPage({ searchParams }: { searchParams: Promise<{ sekme?: string }> }) {
  const tt = await getTT();
  const actor = await requireActor("INFLUENCER");
  const { sekme } = await searchParams;
  const id = actor.influencerId!;
  const [invites, grants] = await Promise.all([
    prisma.eventInvite.findMany({ where: { influencerId: id }, include: { event: true, ticket: true } }),
    prisma.couponGrant.findMany({ where: { influencerId: id }, orderBy: { createdAt: "desc" }, include: { coupon: true } }),
  ]);

  const partnerMap = await getEventsPartnerMap(invites.map((i) => i.event.id));
  const tenantIds = [
    ...new Set([
      ...invites.map((i) => i.event.tenantId).filter((x): x is string => !!x),
      ...grants.map((g) => g.coupon.tenantId),
      ...[...partnerMap.values()].flat(),
    ]),
  ];
  const brands = new Map((await prisma.brand.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]));

  const now = new Date();
  const visible = invites.filter((i) => i.event.status !== "TASLAK");
  const toCard = (inv: (typeof visible)[number]): InviteCardItem => {
    const e = inv.event;
    const ticket = inv.ticket && inv.ticket.status !== "IPTAL" ? inv.ticket : null;
    const v = inviteView[inv.status] ?? { label: inv.status, tone: "gray" as PillTone };
    const isPast = (e.endsAt ?? e.startsAt) < now;
    const mainOrg = e.tenantId ? (brands.get(e.tenantId) ?? "Marka") : BRAND_NAME;
    const partnerNames = (partnerMap.get(e.id) ?? []).map((pid) => brands.get(pid)).filter((x): x is string => !!x);
    return {
      id: inv.id,
      status: inv.status,
      statusLabel: v.label,
      statusTone: v.tone,
      canRespond: !isPast && e.status !== "IPTAL" && inv.status !== "IPTAL",
      eventId: e.id,
      eventTitle: e.title,
      eventStatus: e.status,
      startsAtIso: e.startsAt.toISOString(),
      dateRangeLabel: rangeLabel(e.startsAt, e.endsAt),
      organizerLabel: partnerNames.length ? [mainOrg, ...partnerNames].join(" × ") : mainOrg,
      venueLabel: [e.venueName, e.city].filter(Boolean).join(", "),
      coverSrc: mediaSrc(e.coverImageKey),
      ticketId: ticket?.id ?? null,
    };
  };

  const upcoming = visible
    .filter((i) => (i.event.endsAt ?? i.event.startsAt) >= now)
    .sort((a, b) => +a.event.startsAt - +b.event.startsAt)
    .map(toCard);
  const past = visible
    .filter((i) => (i.event.endsAt ?? i.event.startsAt) < now)
    .sort((a, b) => +b.event.startsAt - +a.event.startsAt)
    .map(toCard);

  const coupons: CouponCardItem[] = grants.map((g) => {
    const c = g.coupon;
    const expired = !!c.validUntil && c.validUntil < now;
    const gv = grantView[g.status] ?? { label: g.status, tone: "gray" as PillTone };
    return {
      id: g.id,
      title: c.title,
      brandName: brands.get(c.tenantId) ?? "Marka",
      kindLabel: c.kind === "HEDIYE_CEKI" ? "Hediye çeki" : "Kupon",
      valueLabel: couponValueLabel(c.valueType, c.value),
      statusLabel: gv.label,
      statusTone: gv.tone,
      accent: c.brandColor ?? "#ff2bd6",
      logoSrc: mediaSrc(c.logoKey),
      validLabel: c.validUntil ? `Son kullanım ${fmtDate(c.validUntil)}` : "Süresiz",
      expired,
    };
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-title text-fg">{tt("Davetlerim")}</h1>
        <p className="text-[14px] text-fg-muted">{tt("Etkinlik davetleriniz, biletleriniz ve markalardan gelen kupon ve hediye çekleriniz.")}</p>
      </div>
      <InfluencerInvitesView defaultTab={sekme} upcoming={upcoming} past={past} coupons={coupons} />
    </div>
  );
}
