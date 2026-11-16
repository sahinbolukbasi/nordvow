import type { Metadata } from "next";
import { BRAND_NAME } from "@/lib/brand";
import { redirect } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { LandingPage, type LandingStats } from "@/components/landing/landing-page";
import { getActor, getUserStatus } from "@/lib/auth-guard";
import { getLandingContent, toReferences, toVideos } from "@/lib/landing-store";
import { roleHome } from "@/lib/roles";
import { AnnouncementPopup, type SystemPopup } from "@/components/notify/announcement-popup";
export const metadata: Metadata = {
  title: { absolute: `${BRAND_NAME} · Influencer marketing platformu` },
  description: "Influencer kampanyalarını brief'ten ödemeye kadar tek panelden yönetin: doğru içerik üreticisi, ölçülebilir sonuç.",
};
export const dynamic = "force-dynamic";
/** Girişli kullanıcı rol ana sayfasına gider; ziyaretçi tanıtım sayfasını görür. */
export default async function RootPage() {
  const actor = await getActor();
  if (actor) {
    const st = await getUserStatus(actor.userId);
    if (!st) redirect("/api/auth/clear-session?hata=oturum");
    if (st.status !== "ACTIVE") redirect("/onay-bekliyor");
    if ((actor.role === "BRAND" && !st.brandId) || (actor.role === "INFLUENCER" && !st.influencerId)) {
      redirect("/api/auth/clear-session?hata=hesap");
    }
    redirect(roleHome[actor.role]);
  }
  const stats: LandingStats = await Promise.all([
    prisma.influencer.count(),
    prisma.socialAccount.aggregate({ _sum: { followers: true } }),
    prisma.campaign.count({ where: { status: { not: "IPTAL" } } }),
    prisma.deliverable.count({ where: { publishedAt: { not: null } } }),
  ])
    .then(([influencers, f, campaigns, published]) => ({ influencers, followers: f._sum.followers ?? 0, campaigns, published }))
    .catch(() => ({ influencers: 0, followers: 0, campaigns: 0, published: 0 }));
  const [content, popupRow] = await Promise.all([
    getLandingContent(),
    prisma.configValue.findUnique({ where: { key: "system.popups" }, select: { value: true } }).catch(() => null),
  ]);
  const allPopups = Array.isArray(popupRow?.value) ? (popupRow.value as SystemPopup[]) : [];
  const visitorPopups = allPopups.filter((p) => p.audience === "visitors" || p.audience === "all");
  return (
    <>
      <LandingPage stats={stats} data={{ videos: toVideos(content), references: toReferences(content), creators: content.creators }} />
      <AnnouncementPopup items={visitorPopups} userId="visitor" />
    </>
  );
}
