import { prisma } from "@infulancer/core/db";
import { TIKTOK_ALL_SCOPES, missingRequiredScopes } from "@infulancer/core/tiktok/index";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Creator paneli için TikTok profil, takipçi büyüme grafiği, video performansı ve yayınlanan postlar. */
export async function GET() {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  const account = await prisma.tikTokAccount.findFirst({
    where: { influencerId: guard.actor.influencerId! },
    orderBy: { connectedAt: "desc" },
    include: {
      videos: {
        orderBy: { createTime: "desc" },
        take: 50,
      },
      dailyStats: {
        orderBy: { date: "asc" },
        take: 60,
      },
      posts: {
        orderBy: { createdAt: "desc" },
        take: 25,
      },
    },
  });

  if (!account) {
    return Response.json({ connected: false, account: null });
  }

  const videos = account.videos.map((v) => {
    const interactions = v.likeCount + v.commentCount + v.shareCount;
    const engagementRate = v.viewCount > 0 ? interactions / v.viewCount : 0;
    return {
      id: v.id,
      title: v.title,
      videoDescription: v.videoDescription,
      createTime: v.createTime,
      coverImageUrl: v.coverImageUrl,
      shareUrl: v.shareUrl,
      duration: v.duration,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      shareCount: v.shareCount,
      engagementRate,
    };
  });

  return Response.json({
    connected: true,
    account: {
      id: account.id,
      openId: account.openId,
      displayName: account.displayName,
      username: account.username,
      avatarUrl: account.avatarUrl,
      bio: account.bio,
      profileDeepLink: account.profileDeepLink,
      isVerified: account.isVerified,
      followerCount: account.followerCount,
      followingCount: account.followingCount,
      likesCount: account.likesCount,
      videoCount: account.videoCount,
      status: account.status,
      lastSyncedAt: account.lastSyncedAt,
      lastError: account.lastError,
      scopes: account.scopes,
      missingScopes: missingRequiredScopes(account.scopes, TIKTOK_ALL_SCOPES),
    },
    dailyStats: account.dailyStats,
    videos,
    posts: account.posts,
  });
}
