import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../db";
import { vault } from "../channels/vault";
import { decryptToken, encryptToken } from "./crypto";
import {
  TIKTOK_ALL_SCOPES,
  exchangeOAuthCode,
  fetchPublishStatus,
  getTikTokConfig,
  getUserInfo,
  initInboxVideoPublish,
  initVideoPublish,
  listAllVideos,
  queryCreatorInfo,
  refreshOAuthToken,
  revokeOAuthToken,
  uploadVideoChunks,
  withTokenRefreshRetry,
} from "./client";
import { TikTokApiError } from "./errors";

const ONE_HOUR_MS = 3_600_000;
const SIX_HOURS_MS = 6 * ONE_HOUR_MS;
const FIVE_MINUTES_SEC = 300;

function parseScopes(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function missingRequiredScopes(granted: string[], required: readonly string[]): string[] {
  const set = new Set(granted);
  return required.filter((s) => !set.has(s));
}

/** OAuth callback tamamlandıktan sonra token'ları şifreleyip DB'ye yazar ve ilk tam senkronu çalıştırır. */
export async function completeTikTokOAuth(params: {
  influencerId: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}) {
  const cfg = getTikTokConfig();
  if (!cfg.clientKey || !cfg.clientSecret) {
    throw new TikTokApiError({ code: "invalid_params", message: "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET tanımlı değil.", httpStatus: 500 });
  }
  const tok = await exchangeOAuthCode({
    clientKey: cfg.clientKey,
    clientSecret: cfg.clientSecret,
    code: params.code,
    redirectUri: params.redirectUri,
    codeVerifier: params.codeVerifier,
  });

  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + (tok.expires_in || 86400) * 1000);
  const refreshExpiresAt = new Date(now.getTime() + (tok.refresh_expires_in || 365 * 86400) * 1000);
  const scopes = parseScopes(tok.scope);

  const encAccess = encryptToken(tok.access_token);
  const encRefresh = encryptToken(tok.refresh_token);

  const account = await prisma.tikTokAccount.upsert({
    where: { openId: tok.open_id },
    create: {
      influencerId: params.influencerId,
      openId: tok.open_id,
      accessToken: encAccess,
      refreshToken: encRefresh,
      accessExpiresAt,
      refreshExpiresAt,
      scopes,
      connectedAt: now,
      status: "active",
      lastError: null,
    },
    update: {
      influencerId: params.influencerId,
      accessToken: encAccess,
      refreshToken: encRefresh,
      accessExpiresAt,
      refreshExpiresAt,
      scopes,
      status: "active",
      lastError: null,
    },
  });

  // Mevcut SocialAccount kaydını da senkronize tut
  const tokenRef = await vault().put(`inf_${params.influencerId}`, "tiktok", tok.access_token).catch(() => null);
  await prisma.socialAccount.upsert({
    where: { influencerId_platform: { influencerId: params.influencerId, platform: "TIKTOK" } },
    create: {
      influencerId: params.influencerId,
      platform: "TIKTOK",
      handle: "tiktok",
      followers: 0,
      engagementRate: 0,
      demographics: {},
      externalId: tok.open_id,
      tokenRef,
      syncSource: "tiktok_oauth",
    },
    update: {
      externalId: tok.open_id,
      ...(tokenRef ? { tokenRef } : {}),
      syncSource: "tiktok_oauth",
      syncError: null,
    },
  });

  // İlk tam senkron
  const sync = await syncTikTokAccount(account.id).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : String(err),
  }));

  return { accountId: account.id, openId: tok.open_id, scopes, sync };
}

/** Hesabın token'ını refresh_token ile yeniler; yeni refresh_token gelirse günceller. */
export async function refreshTikTokAccountToken(accountId: string): Promise<string> {
  const acc = await prisma.tikTokAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.status === "revoked") {
    throw new TikTokApiError({ code: "access_token_invalid", message: "TikTok hesabı aktif değil.", httpStatus: 401 });
  }
  const cfg = getTikTokConfig();
  const currentRefresh = decryptToken(acc.refreshToken);

  try {
    const tok = await refreshOAuthToken({
      clientKey: cfg.clientKey,
      clientSecret: cfg.clientSecret,
      refreshToken: currentRefresh,
    });
    const now = new Date();
    const nextAccess = encryptToken(tok.access_token);
    const nextRefresh = tok.refresh_token ? encryptToken(tok.refresh_token) : acc.refreshToken;
    const scopes = tok.scope ? parseScopes(tok.scope) : acc.scopes;

    await prisma.tikTokAccount.update({
      where: { id: acc.id },
      data: {
        accessToken: nextAccess,
        refreshToken: nextRefresh,
        accessExpiresAt: new Date(now.getTime() + (tok.expires_in || 86400) * 1000),
        refreshExpiresAt: tok.refresh_expires_in
          ? new Date(now.getTime() + tok.refresh_expires_in * 1000)
          : acc.refreshExpiresAt,
        scopes,
        status: "active",
        lastError: null,
      },
    });
    return tok.access_token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.tikTokAccount.update({
      where: { id: acc.id },
      data: { status: "error", lastError: msg.slice(0, 300) },
    });
    throw err;
  }
}

/** Süresi 1 saatten az kalan token'ı otomatik yenileyip açık access_token döner. */
export async function getValidTikTokAccessToken(accountId: string, now = new Date()): Promise<string> {
  const acc = await prisma.tikTokAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.status === "revoked") {
    throw new TikTokApiError({ code: "access_token_invalid", message: "Bağlı TikTok hesabı bulunamadı.", httpStatus: 401 });
  }
  if (acc.accessExpiresAt.getTime() - now.getTime() <= ONE_HOUR_MS) {
    return refreshTikTokAccountToken(acc.id);
  }
  return decryptToken(acc.accessToken);
}

/** access_token_invalid durumunda otomatik refresh + tek tekrar uygular. */
export async function withAccountToken<T>(accountId: string, fn: (accessToken: string) => Promise<T>): Promise<T> {
  const token = await getValidTikTokAccessToken(accountId);
  return withTokenRefreshRetry(token, fn, () => refreshTikTokAccountToken(accountId));
}

/** Kullanıcı "bağlantıyı kes" dediğinde veya veri silme talebinde tüm TikTok verilerini siler. */
export async function disconnectTikTokAccount(influencerId: string): Promise<{ disconnected: boolean }> {
  const accounts = await prisma.tikTokAccount.findMany({ where: { influencerId } });
  const cfg = getTikTokConfig();

  for (const acc of accounts) {
    if (acc.status !== "revoked" && cfg.clientKey && cfg.clientSecret) {
      try {
        const token = decryptToken(acc.accessToken);
        await revokeOAuthToken({ clientKey: cfg.clientKey, clientSecret: cfg.clientSecret, token });
      } catch {
        // Revoke çağrısı başarısız olsa dahi yerel TikTok verileri TikTok politikası gereği silinir.
      }
    }
  }

  await prisma.tikTokAccount.deleteMany({ where: { influencerId } });

  const social = await prisma.socialAccount.findUnique({
    where: { influencerId_platform: { influencerId, platform: "TIKTOK" } },
  });
  if (social) {
    if (social.tokenRef) {
      await vault().remove(social.tokenRef).catch(() => undefined);
    }
    await prisma.socialAccount.delete({ where: { id: social.id } });
  }

  return { disconnected: accounts.length > 0 || Boolean(social) };
}

/** Profil + tüm videoları çeker ve DB'yi günceller. */
export async function syncTikTokAccount(accountId: string, now = new Date()) {
  const acc = await prisma.tikTokAccount.findUnique({ where: { id: accountId } });
  if (!acc || acc.status === "revoked") {
    return { ok: false as const, error: "Hesap aktif değil." };
  }

  try {
    const profile = await withAccountToken(acc.id, (token) => getUserInfo(token));
    const canListVideos = acc.scopes.length === 0 || acc.scopes.includes("video.list");
    const videos = canListVideos ? await withAccountToken(acc.id, (token) => listAllVideos(token)) : [];

    await prisma.$transaction(async (tx) => {
      await tx.tikTokAccount.update({
        where: { id: acc.id },
        data: {
          unionId: profile.union_id ?? acc.unionId,
          displayName: profile.display_name ?? acc.displayName,
          username: profile.username ?? acc.username,
          avatarUrl: profile.avatar_url ?? acc.avatarUrl,
          bio: profile.bio_description ?? acc.bio,
          profileDeepLink: profile.profile_deep_link ?? acc.profileDeepLink,
          isVerified: profile.is_verified ?? acc.isVerified,
          followerCount: profile.follower_count ?? acc.followerCount,
          followingCount: profile.following_count ?? acc.followingCount,
          likesCount: profile.likes_count ?? acc.likesCount,
          videoCount: profile.video_count ?? acc.videoCount,
          lastSyncedAt: now,
          status: "active",
          lastError: null,
        },
      });

      for (const v of videos) {
        const createTime = v.create_time ? new Date(v.create_time * 1000) : now;
        await tx.tikTokVideo.upsert({
          where: { id: v.id },
          create: {
            id: v.id,
            accountId: acc.id,
            title: v.title ?? null,
            videoDescription: v.video_description ?? null,
            createTime,
            coverImageUrl: v.cover_image_url ?? null,
            shareUrl: v.share_url ?? null,
            embedLink: v.embed_link ?? null,
            duration: v.duration ?? null,
            width: v.width ?? null,
            height: v.height ?? null,
            viewCount: v.view_count ?? 0,
            likeCount: v.like_count ?? 0,
            commentCount: v.comment_count ?? 0,
            shareCount: v.share_count ?? 0,
            lastSyncedAt: now,
          },
          update: {
            title: v.title ?? null,
            videoDescription: v.video_description ?? null,
            coverImageUrl: v.cover_image_url ?? null,
            shareUrl: v.share_url ?? null,
            embedLink: v.embed_link ?? null,
            duration: v.duration ?? null,
            width: v.width ?? null,
            height: v.height ?? null,
            viewCount: v.view_count ?? 0,
            likeCount: v.like_count ?? 0,
            commentCount: v.comment_count ?? 0,
            shareCount: v.share_count ?? 0,
            lastSyncedAt: now,
          },
        });
      }

      // SocialAccount özetini güncelle
      const followers = profile.follower_count ?? 0;
      const totalViews = videos.reduce((s, v) => s + (v.view_count ?? 0), 0);
      const totalLikes = videos.reduce((s, v) => s + (v.like_count ?? 0), 0);
      const totalComments = videos.reduce((s, v) => s + (v.comment_count ?? 0), 0);
      const totalShares = videos.reduce((s, v) => s + (v.share_count ?? 0), 0);
      const avgViews = videos.length ? Math.round(totalViews / videos.length) : null;
      const avgLikes = videos.length ? Math.round(totalLikes / videos.length) : null;
      const avgComments = videos.length ? Math.round(totalComments / videos.length) : null;
      const er =
        totalViews > 0
          ? Math.min(9.9999, (totalLikes + totalComments + totalShares) / totalViews)
          : followers > 0 && (profile.video_count ?? 0) > 0
            ? Math.min(9.9999, (profile.likes_count ?? 0) / (profile.video_count ?? 1) / followers)
            : 0;

      const handle = profile.username ? `@${profile.username.replace(/^@/, "")}` : profile.display_name || "@tiktok";
      await tx.socialAccount.updateMany({
        where: { influencerId: acc.influencerId, platform: "TIKTOK" },
        data: {
          handle,
          followers,
          engagementRate: er,
          postsCount: profile.video_count ?? videos.length,
          avgLikes,
          avgComments,
          avgViews,
          profileUrl: profile.profile_deep_link ?? (profile.username ? `https://www.tiktok.com/@${profile.username}` : null),
          avatarUrl: profile.avatar_url ?? null,
          verified: Boolean(profile.is_verified),
          externalId: profile.open_id,
          syncSource: "tiktok_oauth",
          lastSyncedAt: now,
          syncError: null,
        },
      });
    });

    return { ok: true as const, videoCount: videos.length, followerCount: profile.follower_count ?? 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.tikTokAccount.update({
      where: { id: acc.id },
      data: { lastError: msg.slice(0, 300) },
    });
    return { ok: false as const, error: msg };
  }
}

/** Süresi 1 saatten az kalan aktif hesapların token'larını arka planda yeniler. */
export async function refreshExpiringTikTokTokensJob(now = new Date()) {
  const threshold = new Date(now.getTime() + ONE_HOUR_MS);
  const due = await prisma.tikTokAccount.findMany({
    where: { status: "active", accessExpiresAt: { lte: threshold } },
    select: { id: true },
    take: 50,
  });
  let refreshed = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await refreshTikTokAccountToken(row.id);
      refreshed++;
    } catch {
      failed++;
    }
  }
  return { checked: due.length, refreshed, failed };
}

/** 6 saatten eski aktif TikTok hesaplarını senkronlar. */
export async function syncStaleTikTokAccountsJob(limit = 50, now = new Date()) {
  const threshold = new Date(now.getTime() - SIX_HOURS_MS);
  const stale = await prisma.tikTokAccount.findMany({
    where: {
      status: "active",
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: threshold } }],
    },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true },
  });
  let ok = 0;
  for (const row of stale) {
    const res = await syncTikTokAccount(row.id, now);
    if (res.ok) ok++;
  }
  return { checked: stale.length, ok };
}

/** Günde 1 kez hesap + video performans snapshot'ı yazar. */
export async function snapshotTikTokDailyStatsJob(now = new Date()) {
  const dateOnly = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const accounts = await prisma.tikTokAccount.findMany({
    where: { status: "active" },
    include: { videos: true },
  });

  let accountSnapshots = 0;
  let videoSnapshots = 0;

  for (const acc of accounts) {
    await prisma.tikTokAccountStatsDaily.upsert({
      where: { accountId_date: { accountId: acc.id, date: dateOnly } },
      create: {
        accountId: acc.id,
        date: dateOnly,
        followerCount: acc.followerCount,
        likesCount: acc.likesCount,
        videoCount: acc.videoCount,
      },
      update: {
        followerCount: acc.followerCount,
        likesCount: acc.likesCount,
        videoCount: acc.videoCount,
      },
    });
    accountSnapshots++;

    for (const v of acc.videos) {
      await prisma.tikTokVideoStatsDaily.upsert({
        where: { videoId_date: { videoId: v.id, date: dateOnly } },
        create: {
          videoId: v.id,
          date: dateOnly,
          viewCount: v.viewCount,
          likeCount: v.likeCount,
          commentCount: v.commentCount,
          shareCount: v.shareCount,
        },
        update: {
          viewCount: v.viewCount,
          likeCount: v.likeCount,
          commentCount: v.commentCount,
          shareCount: v.shareCount,
        },
      });
      videoSnapshots++;
    }
  }

  return { accountSnapshots, videoSnapshots };
}

/** Content Posting API öncesi creator_info ve scope/audit durumu döner. */
export async function getCreatorPublishPreflight(influencerId: string) {
  const acc = await prisma.tikTokAccount.findFirst({
    where: { influencerId, status: "active" },
    orderBy: { connectedAt: "desc" },
  });
  if (!acc) {
    throw new TikTokApiError({ code: "access_token_invalid", message: "Aktif TikTok hesabı bağlı değil.", httpStatus: 404 });
  }
  const missing = missingRequiredScopes(acc.scopes, ["video.publish"]);
  const cfg = getTikTokConfig();
  const info = await withAccountToken(acc.id, (token) => queryCreatorInfo(token));

  return {
    accountId: acc.id,
    openId: acc.openId,
    audited: cfg.audited,
    missingPublishScopes: missing,
    creatorNickname: info.creator_nickname ?? acc.displayName ?? acc.username ?? "Creator",
    creatorUsername: info.creator_username ?? acc.username ?? "",
    creatorAvatarUrl: info.creator_avatar_url ?? acc.avatarUrl ?? null,
    privacyLevelOptions: info.privacy_level_options ?? ["SELF_ONLY"],
    duetDisabled: Boolean(info.duet_disabled),
    commentDisabled: Boolean(info.comment_disabled),
    stitchDisabled: Boolean(info.stitch_disabled),
    maxVideoPostDurationSec: info.max_video_post_duration_sec ?? 600,
  };
}

export type PublishTikTokInput = {
  influencerId: string;
  campaignId?: string | null;
  deliverableId?: string | null;
  mode: "DIRECT" | "INBOX";
  source: "FILE_UPLOAD" | "PULL_FROM_URL";
  videoUrl?: string;
  fileBuffer?: Buffer;
  fileMimeType?: string;
  caption?: string;
  privacyLevel?: string;
  disableDuet?: boolean;
  disableComment?: boolean;
  disableStitch?: boolean;
  videoCoverTimestampMs?: number;
  brandContentToggle?: boolean;
  brandOrganicToggle?: boolean;
  userConfirmed: boolean;
};

/** TikTok UX kurallarına uygun içerik yayınlama / inbox taslak gönderimi. */
export async function publishTikTokContent(input: PublishTikTokInput) {
  if (!input.userConfirmed) {
    throw new TikTokApiError({
      code: "invalid_params",
      message: "TikTok içerik yayınlama için kullanıcının önizleme ve açık onayı zorunludur.",
      httpStatus: 400,
    });
  }

  const acc = await prisma.tikTokAccount.findFirst({
    where: { influencerId: input.influencerId, status: "active" },
    orderBy: { connectedAt: "desc" },
  });
  if (!acc) {
    throw new TikTokApiError({ code: "access_token_invalid", message: "Aktif TikTok hesabı bağlı değil.", httpStatus: 404 });
  }

  const neededScope = input.mode === "INBOX" ? "video.upload" : "video.publish";
  const missing = missingRequiredScopes(acc.scopes, [neededScope]);
  if (acc.scopes.length > 0 && missing.length > 0) {
    throw new TikTokApiError({
      code: "scope_not_authorized",
      message: `Eksik TikTok izni: ${missing.join(", ")}. Lütfen yeniden yetki verin.`,
      httpStatus: 403,
    });
  }

  const cfg = getTikTokConfig();
  const isBrandCampaign = Boolean(input.campaignId);
  const brandContentToggle = isBrandCampaign ? true : Boolean(input.brandContentToggle);

  if (input.mode === "DIRECT") {
    if (!input.privacyLevel) {
      throw new TikTokApiError({
        code: "invalid_params",
        message: "Gizlilik seviyesi (privacy_level) kullanıcı tarafından seçilmelidir.",
        httpStatus: 400,
      });
    }
    if (!cfg.audited && input.privacyLevel !== "SELF_ONLY") {
      throw new TikTokApiError({
        code: "unaudited_client_can_only_post_to_private_accounts",
        httpStatus: 403,
      });
    }
    if (!cfg.audited && brandContentToggle) {
      throw new TikTokApiError({
        code: "unaudited_client_can_only_post_to_private_accounts",
        message: "Denetlenmemiş (unaudited) uygulamalarda ücretli ortaklık (brand_content_toggle) içeren gönderiler yayınlanamaz.",
        httpStatus: 403,
      });
    }
  }

  const creatorInfo = await withAccountToken(acc.id, (token) => queryCreatorInfo(token));
  const privacy = input.mode === "INBOX" ? "SELF_ONLY" : input.privacyLevel!;
  if (input.mode === "DIRECT" && creatorInfo.privacy_level_options?.length && !creatorInfo.privacy_level_options.includes(privacy)) {
    throw new TikTokApiError({
      code: "invalid_params",
      message: `Seçilen gizlilik seviyesi (${privacy}) bu hesap için desteklenmiyor.`,
      httpStatus: 400,
    });
  }

  let sourceInfo:
    | { source: "FILE_UPLOAD"; video_size: number; chunk_size: number; total_chunk_count: number }
    | { source: "PULL_FROM_URL"; video_url: string };

  if (input.source === "FILE_UPLOAD") {
    if (!input.fileBuffer || input.fileBuffer.length === 0) {
      throw new TikTokApiError({ code: "invalid_params", message: "FILE_UPLOAD için video dosyası zorunludur.", httpStatus: 400 });
    }
    const videoSize = input.fileBuffer.length;
    const defaultChunk = 10 * 1024 * 1024; // 10 MB
    const chunkSize = videoSize <= defaultChunk ? videoSize : defaultChunk;
    const totalChunkCount = Math.ceil(videoSize / chunkSize);
    sourceInfo = {
      source: "FILE_UPLOAD",
      video_size: videoSize,
      chunk_size: chunkSize,
      total_chunk_count: totalChunkCount,
    };
  } else {
    if (!input.videoUrl) {
      throw new TikTokApiError({ code: "invalid_params", message: "PULL_FROM_URL için video_url zorunludur.", httpStatus: 400 });
    }
    sourceInfo = { source: "PULL_FROM_URL", video_url: input.videoUrl };
  }

  const initRes =
    input.mode === "INBOX"
      ? await withAccountToken(acc.id, (token) => initInboxVideoPublish(token, sourceInfo))
      : await withAccountToken(acc.id, (token) =>
          initVideoPublish(token, {
            post_info: {
              title: input.caption ?? "",
              privacy_level: privacy,
              disable_duet: creatorInfo.duet_disabled ? true : Boolean(input.disableDuet),
              disable_comment: creatorInfo.comment_disabled ? true : Boolean(input.disableComment),
              disable_stitch: creatorInfo.stitch_disabled ? true : Boolean(input.disableStitch),
              ...(input.videoCoverTimestampMs !== undefined ? { video_cover_timestamp_ms: input.videoCoverTimestampMs } : {}),
              brand_content_toggle: brandContentToggle,
              brand_organic_toggle: Boolean(input.brandOrganicToggle),
            },
            source_info: sourceInfo,
          }),
        );

  if (input.source === "FILE_UPLOAD" && initRes.upload_url && input.fileBuffer && sourceInfo.source === "FILE_UPLOAD") {
    await uploadVideoChunks({
      uploadUrl: initRes.upload_url,
      buffer: input.fileBuffer,
      chunkSize: sourceInfo.chunk_size,
      mimeType: input.fileMimeType,
    });
  }

  const post = await prisma.tikTokPost.create({
    data: {
      accountId: acc.id,
      campaignId: input.campaignId ?? null,
      deliverableId: input.deliverableId ?? null,
      publishId: initRes.publish_id,
      source: input.source,
      mode: input.mode,
      privacyLevel: privacy,
      caption: input.caption ?? null,
      brandContentToggle,
      brandOrganicToggle: Boolean(input.brandOrganicToggle),
      disableDuet: creatorInfo.duet_disabled ? true : Boolean(input.disableDuet),
      disableComment: creatorInfo.comment_disabled ? true : Boolean(input.disableComment),
      disableStitch: creatorInfo.stitch_disabled ? true : Boolean(input.disableStitch),
      status: input.source === "FILE_UPLOAD" ? "PROCESSING_UPLOAD" : "PROCESSING_DOWNLOAD",
    },
  });

  return post;
}

/** Yayın durumunu TikTok'tan sorgular ve DB'yi günceller. */
export async function refreshTikTokPostStatus(publishId: string) {
  const post = await prisma.tikTokPost.findUnique({ where: { publishId } });
  if (!post) return null;

  const statusRes = await withAccountToken(post.accountId, (token) => fetchPublishStatus(token, publishId));
  const publishedId = statusRes.publicaly_available_post_id?.[0]
    ? String(statusRes.publicaly_available_post_id[0])
    : post.publishedVideoId;

  return prisma.tikTokPost.update({
    where: { id: post.id },
    data: {
      status: statusRes.status,
      failReason: statusRes.fail_reason ?? null,
      publishedVideoId: publishedId,
    },
  });
}

/** Bekleyen TikTok yayınlarının durumunu günceller. */
export async function pollPendingTikTokPostsJob(limit = 30) {
  const pending = await prisma.tikTokPost.findMany({
    where: { status: { in: ["PROCESSING_UPLOAD", "PROCESSING_DOWNLOAD"] } },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  let updated = 0;
  for (const p of pending) {
    try {
      await refreshTikTokPostStatus(p.publishId);
      updated++;
    } catch {
      // Bir sonraki poll'da tekrar denenir
    }
  }
  return { checked: pending.length, updated };
}

/**
 * TikTok Webhook `TikTok-Signature` header doğrulaması.
 * Format: `t=<unix_seconds>,s=<hex_hmac_sha256>`
 * 5 dakikadan eski istekleri replay saldırılarına karşı reddeder.
 */
export function verifyTikTokWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  clientSecret?: string,
  nowMs = Date.now(),
): boolean {
  const secret = clientSecret ?? getTikTokConfig().clientSecret;
  if (!secret || !signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader
      .split(",")
      .map((kv) => kv.trim().split("=", 2))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );
  const tStr = parts["t"];
  const sig = parts["s"];
  if (!tStr || !sig) return false;

  const tSec = Number(tStr);
  if (!Number.isFinite(tSec)) return false;
  const nowSec = Math.floor(nowMs / 1000);
  if (Math.abs(nowSec - tSec) > FIVE_MINUTES_SEC) return false;

  const expected = createHmac("sha256", secret).update(`${tStr}.${rawBody}`, "utf8").digest("hex");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export type TikTokWebhookPayload = {
  event?: string;
  user_openid?: string;
  content?: string | Record<string, unknown>;
};

/** TikTok Webhook olaylarını işler. */
export async function handleTikTokWebhookEvent(payload: TikTokWebhookPayload) {
  const event = payload.event ?? "";
  let content: Record<string, unknown> = {};
  if (typeof payload.content === "string") {
    try {
      content = JSON.parse(payload.content) as Record<string, unknown>;
    } catch {
      content = {};
    }
  } else if (payload.content && typeof payload.content === "object") {
    content = payload.content;
  }

  if (event === "authorization.removed" && payload.user_openid) {
    await prisma.tikTokAccount.updateMany({
      where: { openId: payload.user_openid },
      data: { status: "revoked", lastError: "Kullanıcı TikTok üzerinden yetkiyi kaldırdı." },
    });
    return { handled: true, event };
  }

  const publishId = typeof content.publish_id === "string" ? content.publish_id : undefined;
  if (publishId) {
    if (event === "post.publish.complete" || event === "post.publish.publicly_available") {
      const videoId =
        typeof content.post_id === "string" || typeof content.post_id === "number"
          ? String(content.post_id)
          : undefined;
      await prisma.tikTokPost.updateMany({
        where: { publishId },
        data: { status: "PUBLISH_COMPLETE", ...(videoId ? { publishedVideoId: videoId } : {}), failReason: null },
      });
      return { handled: true, event };
    }
    if (event === "post.publish.inbox_delivered") {
      await prisma.tikTokPost.updateMany({
        where: { publishId },
        data: { status: "SEND_TO_USER_INBOX", failReason: null },
      });
      return { handled: true, event };
    }
    if (event === "post.publish.failed" || event === "video.upload.failed") {
      const reason = typeof content.reason === "string" ? content.reason : "Yayınlama başarısız oldu.";
      await prisma.tikTokPost.updateMany({
        where: { publishId },
        data: { status: "FAILED", failReason: reason.slice(0, 300) },
      });
      return { handled: true, event };
    }
  }

  return { handled: false, event };
}

export { TIKTOK_ALL_SCOPES };
