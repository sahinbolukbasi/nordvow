import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
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

/** Tanıtım istatistikleri, içerik ve ziyaretçi duyuruları 60 sn önbelleklenir (her ziyarette 6 DB sorgusu yerine <20ms). */
const getCachedLandingPayload = unstable_cache(
  async () => {
    const [influencers, f, campaigns, published, content, popupRow] = await Promise.all([
      prisma.influencer.count().catch(() => 0),
      prisma.socialAccount.aggregate({ _sum: { followers: true } }).catch(() => ({ _sum: { followers: 0 } })),
      prisma.campaign.count({ where: { status: { not: "IPTAL" } } }).catch(() => 0),
      prisma.deliverable.count({ where: { publishedAt: { not: null } } }).catch(() => 0),
      getLandingContent(),
      prisma.configValue.findUnique({ where: { key: "system.popups" }, select: { value: true } }).catch(() => null),
    ]);
    const stats: LandingStats = {
      influencers,
      followers: f._sum.followers ?? 0,
      campaigns,
      published,
    };
    const allPopups = Array.isArray(popupRow?.value) ? (popupRow.value as SystemPopup[]) : [];
    const visitorPopups = allPopups.filter((p) => p.audience === "visitors" || p.audience === "all");
    return { stats, content, visitorPopups };
  },
  ["landing-page-payload-v1"],
  { revalidate: 60, tags: ["landing-content", "system-popups"] },
);

/** Girişli kullanıcı rol ana sayfasına gider; ziyaretçi tanıtım sayfasını görür. */
export default async function RootPage({
  searchParams,
}: {
  searchParams: Promise<{ onizleme?: string }>;
}) {
  const sp = await searchParams;
  const preview = sp.onizleme === "1";
  const actor = await getActor();
  if (actor && !preview) {
    const st = await getUserStatus(actor.userId);
    if (!st) redirect("/api/auth/clear-session?hata=oturum");
    if (st.status !== "ACTIVE") redirect("/onay-bekliyor");
    if ((actor.role === "BRAND" && !st.brandId) || (actor.role === "INFLUENCER" && !st.influencerId)) {
      redirect("/api/auth/clear-session?hata=hesap");
    }
    redirect(roleHome[actor.role]);
  }
  const { stats, content, visitorPopups } = await getCachedLandingPayload();
  return (
    <>
      <LandingPage stats={stats} data={{ videos: toVideos(content), references: toReferences(content), creators: content.creators }} />
      <AnnouncementPopup items={visitorPopups} userId="visitor" />
    </>
  );
}
