import { prisma } from "@infulancer/core/db";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

function csvCell(v: string | number | boolean | null | undefined): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Marka / Admin kampanya TikTok performans raporu (JSON veya ?format=csv). */
export async function GET(req: Request) {
  const guard = await requireApiActor("BRAND", "ADMIN");
  if (guard.response) return guard.response;

  const u = new URL(req.url);
  const campaignId = u.searchParams.get("campaignId");
  const format = u.searchParams.get("format") === "csv" ? "csv" : "json";
  if (!campaignId) {
    return Response.json({ error: "campaignId zorunludur." }, { status: 400 });
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, name: true, brandId: true },
  });
  if (!campaign) {
    return Response.json({ error: "Kampanya bulunamadı." }, { status: 404 });
  }
  if (guard.actor.role === "BRAND" && campaign.brandId !== guard.actor.brandId) {
    return Response.json({ error: "Bu kampanyaya erişim yetkiniz yok." }, { status: 403 });
  }

  const posts = await prisma.tikTokPost.findMany({
    where: { campaignId },
    include: {
      account: {
        select: {
          username: true,
          displayName: true,
          followerCount: true,
          influencer: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const videoIds = posts.map((p) => p.publishedVideoId).filter((id): id is string => Boolean(id));
  const videos = videoIds.length
    ? await prisma.tikTokVideo.findMany({ where: { id: { in: videoIds } } })
    : [];
  const videoMap = new Map(videos.map((v) => [v.id, v]));

  const rows = posts.map((p) => {
    const v = p.publishedVideoId ? videoMap.get(p.publishedVideoId) : undefined;
    const views = v?.viewCount ?? 0;
    const likes = v?.likeCount ?? 0;
    const comments = v?.commentCount ?? 0;
    const shares = v?.shareCount ?? 0;
    const engagementRate = views > 0 ? (likes + comments + shares) / views : 0;
    return {
      postId: p.id,
      publishId: p.publishId,
      creatorName: p.account.influencer.name,
      tiktokUsername: p.account.username ?? p.account.displayName ?? "",
      followers: p.account.followerCount,
      status: p.status,
      privacyLevel: p.privacyLevel,
      brandContentToggle: p.brandContentToggle,
      publishedVideoId: p.publishedVideoId,
      shareUrl: v?.shareUrl ?? null,
      views,
      likes,
      comments,
      shares,
      engagementRate,
      createdAt: p.createdAt.toISOString(),
    };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      totalPosts: acc.totalPosts + 1,
      totalViews: acc.totalViews + r.views,
      totalLikes: acc.totalLikes + r.likes,
      totalComments: acc.totalComments + r.comments,
      totalShares: acc.totalShares + r.shares,
    }),
    { totalPosts: 0, totalViews: 0, totalLikes: 0, totalComments: 0, totalShares: 0 },
  );

  if (format === "csv") {
    const header = [
      "Creator",
      "TikTok Kullanici",
      "Takipci",
      "Durum",
      "Gizlilik",
      "Reklam Ifsasi",
      "Izlenme",
      "Begeni",
      "Yorum",
      "Paylasim",
      "Etkilesim Orani",
      "Video URL",
      "Tarih",
    ].join(",");
    const lines = rows.map((r) =>
      [
        csvCell(r.creatorName),
        csvCell(r.tiktokUsername),
        r.followers,
        csvCell(r.status),
        csvCell(r.privacyLevel),
        r.brandContentToggle ? "Evet" : "Hayir",
        r.views,
        r.likes,
        r.comments,
        r.shares,
        `${(r.engagementRate * 100).toFixed(2)}%`,
        csvCell(r.shareUrl),
        csvCell(r.createdAt),
      ].join(","),
    );
    const csv = `\uFEFF${header}\n${lines.join("\n")}`;
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tiktok-rapor-${campaign.id}.csv"`,
      },
    });
  }

  return Response.json({ campaign, totals, rows });
}
