import { createHash } from "node:crypto";
import { prisma } from "../db";
import { cleanSocialHandle } from "./handle";
import { envStr } from "../env";
import type { Platform } from "../generated/prisma/enums";
import { vault } from "../channels/vault";
import {
  fetchVerifiedInstagramViaSdk,
  type VerifiedAudienceDemographics,
} from "./meta-business-sdk";

/**
 * Sosyal hesap senkronu — yalnız RESMÎ API'ler (scraping YOK; platform kurallarına aykırı).
 * - Instagram: Business Discovery (Graph API) — ajansın kendi IG Business hesabı + token'ı ile, Business/Creator
 *   olan herkese açık hesapların takipçi, medya sayısı ve son gönderi etkileşimleri. Erişilemeyen (kişisel/kısıtlı)
 *   herkese açık profiller için ikincil mekanizma olarak OpenGraph profil önizlemesi ve opsiyonel yedek sağlayıcı kullanılır.
 * - YouTube: Data API v3 channels/search — herkese açık kanal istatistikleri (API anahtarı).
 * - TikTok: Display API — influencer'ın kendi OAuth bağlantısı (Login Kit) gerekir; yoksa açık profil önizlemesi.
 * - Kitle demografisi hiçbir public API'de yok → influencer'ın yüklediği ekran görüntüsünden (metrik akışı).
 * SOCIAL_SYNC_MODE: http (gerçek API'ler) | mock (yalnız geliştirme/test: deterministik sahte veri) |
 * off (varsayılan: hiçbir veri değiştirilmez; elle girilen değerler korunur).
 */
export type ProfileStats = {
  externalId: string | null;
  followers: number;
  postsCount: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  avgViews: number | null;
  engagementRate: number | null;
  profileUrl: string | null;
  avatarUrl: string | null;
  verified: boolean;
  demographics?: VerifiedAudienceDemographics | null;
  source: "instagram_business_discovery" | "instagram_oauth" | "instagram_public" | "youtube_data" | "tiktok_oauth" | "tiktok_public" | "mock";
};

export class SyncError extends Error {
  constructor(message: string, readonly code: "NOT_CONFIGURED" | "NOT_FOUND" | "NOT_BUSINESS" | "NEEDS_OAUTH" | "API") {
    super(message);
  }
}

export interface SocialProvider {
  fetch(platform: Platform, handle: string, ctx: { tokenRef: string | null; externalId?: string | null }): Promise<ProfileStats>;
}

function cleanHandle(h: string, platform?: Platform) {
  return cleanSocialHandle(h, platform);
}

/** Deterministik mock: aynı handle her zaman aynı değerleri üretir; 'yok' içeren handle → bulunamadı. */
export const mockSocial: SocialProvider = {
  async fetch(platform, rawHandle) {
    const handle = cleanHandle(rawHandle, platform);
    if (handle.includes("yok")) throw new SyncError(`@${handle} hesabı bulunamadı.`, "NOT_FOUND");
    const h = createHash("sha256").update(`${platform}:${handle}`).digest();
    const followers = 20_000 + (h.readUInt32BE(0) % 900_000);
    const er = 0.015 + (h[4]! % 60) / 1000;
    const avgLikes = Math.round(followers * er * 0.9);
    const avgComments = Math.round(followers * er * 0.1);
    return {
      externalId: `mock-${h.toString("hex").slice(0, 12)}`,
      followers,
      postsCount: 100 + (h[5]! % 900),
      avgLikes,
      avgComments,
      avgViews: platform === "INSTAGRAM" ? null : Math.round(followers * (0.3 + (h[6]! % 50) / 100)),
      engagementRate: er,
      profileUrl: platform === "INSTAGRAM" ? `https://instagram.com/${handle}` : platform === "TIKTOK" ? `https://tiktok.com/@${handle}` : `https://youtube.com/@${handle}`,
      avatarUrl: null,
      verified: h[7]! % 5 === 0,
      source: "mock",
    };
  },
};

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
  };
  if (!res.ok || json.error) {
    if (json.error?.error_subcode === 2207013 || json.error?.code === 110) {
      throw new SyncError(
        json.error.error_user_msg ||
          "Hesap herkese açık Profesyonel (Business/Creator) hesabı değil veya kullanıcı adı bulunamadı (kişisel/gizli hesaplar için Instagram OAuth gerekir).",
        "NOT_BUSINESS",
      );
    }
    throw new SyncError(json.error?.message ?? `HTTP ${res.status}`, res.status === 404 ? "NOT_FOUND" : "API");
  }
  return json;
}

export const httpSocial: SocialProvider = {
  async fetch(platform, rawHandle, ctx) {
    const handle = cleanHandle(rawHandle, platform);
    if (platform === "INSTAGRAM") {
      const sdk = await fetchVerifiedInstagramViaSdk({
        handle,
        oauthTokenRef: ctx.tokenRef,
        oauthExternalId: ctx.externalId,
      });
      if (!sdk.ok) {
        const msg = sdk.errorMessage ?? "Instagram SDK senkronu başarısız.";
        if (msg.includes("yapılandırılmadı")) throw new SyncError(msg, "NOT_CONFIGURED");
        if (sdk.errorSubcode === 2207013 || sdk.errorCode === 110) {
          throw new SyncError(
            `@${handle} Meta Business Discovery'de bulunamadı; herkese açık profil/agent yedeği de sonuç vermedi (Kişisel/Gizli hesap, yaş/bölge kısıtı veya değişmiş kullanıcı adı olabilir; herkese açık Business/Creator veya Instagram OAuth gerekir).`,
            "NOT_BUSINESS",
          );
        }
        throw new SyncError(msg, "API");
      }
      const media = sdk.media.slice(0, 12);
      const likedMedia = media.filter((m) => m.likes > 0);
      const commentedMedia = media.filter((m) => m.commentsCount > 0);
      const avgLikes = likedMedia.length ? Math.round(likedMedia.reduce((s, m) => s + m.likes, 0) / likedMedia.length) : null;
      const avgComments = commentedMedia.length ? Math.round(commentedMedia.reduce((s, m) => s + m.commentsCount, 0) / commentedMedia.length) : null;
      const viewList = media.map((m) => m.plays || m.reach).filter((v) => v > 0);
      const avgViews = viewList.length
        ? Math.round(viewList.reduce((s, v) => s + v, 0) / viewList.length)
        : sdk.accountInsights?.reach && sdk.postsCount
          ? Math.round(sdk.accountInsights.reach)
          : null;
      return {
        externalId: sdk.externalId,
        followers: sdk.followers,
        postsCount: sdk.postsCount,
        avgLikes,
        avgComments,
        avgViews,
        engagementRate:
          sdk.followers && avgLikes != null
            ? (avgLikes + (avgComments ?? 0)) / sdk.followers
            : sdk.accountInsights?.accountsEngaged && sdk.followers
              ? sdk.accountInsights.accountsEngaged / sdk.followers
              : null,
        profileUrl: `https://instagram.com/${sdk.username || handle}`,
        avatarUrl: sdk.avatarUrl,
        verified: false,
        demographics: sdk.demographics,
        source: sdk.usedOAuth ? "instagram_oauth" : sdk.source === "instagram_public" ? "instagram_public" : "instagram_business_discovery",
      };
    }
    if (platform === "YOUTUBE") {
      const key = envStr("YOUTUBE_API_KEY", "");
      if (!key) throw new SyncError("YouTube senkronu yapılandırılmadı (YOUTUBE_API_KEY).", "NOT_CONFIGURED");
      const j = (await getJson(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&forHandle=${encodeURIComponent(`@${handle}`)}&key=${key}`)) as {
        items?: { id: string; statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string }; snippet: { thumbnails?: { default?: { url: string }; medium?: { url: string }; high?: { url: string } } } }[];
      };
      const ch = j.items?.[0];
      if (!ch) throw new SyncError(`@${handle} YouTube kanalı bulunamadı.`, "NOT_FOUND");
      const subs = Number(ch.statistics.subscriberCount ?? 0);
      const videos = Number(ch.statistics.videoCount ?? 0);
      const views = Number(ch.statistics.viewCount ?? 0);
      return {
        externalId: ch.id,
        followers: subs,
        postsCount: videos,
        avgLikes: null,
        avgComments: null,
        avgViews: videos ? Math.round(views / videos) : null,
        engagementRate: null,
        profileUrl: `https://youtube.com/@${handle}`,
        avatarUrl: ch.snippet.thumbnails?.medium?.url ?? ch.snippet.thumbnails?.high?.url ?? ch.snippet.thumbnails?.default?.url ?? null,
        verified: false,
        source: "youtube_data",
      };
    }
    // TikTok: OAuth varsa Display API, yoksa herkese açık profil meta verisi fallback'i
    if (!ctx.tokenRef) {
      if (!handle) throw new SyncError("Geçerli bir TikTok kullanıcı adı girin.", "NOT_FOUND");
      const pub = await fetchPublicTikTokProfile(handle);
      if (pub) return pub;
      throw new SyncError("TikTok verisi için influencer'ın hesabını bağlaması gerekiyor (bağlantı linki gönderin).", "NEEDS_OAUTH");
    }
    const token = await vault().get(ctx.tokenRef);
    const j = (await getJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,follower_count,video_count,likes_count,avatar_url,is_verified,profile_deep_link", {
      headers: { authorization: `Bearer ${token}` },
    })) as { data?: { user?: { open_id: string; follower_count: number; video_count: number; likes_count: number; avatar_url?: string; is_verified?: boolean; profile_deep_link?: string } } };
    const u = j.data?.user;
    if (!u) throw new SyncError("TikTok kullanıcı bilgisi alınamadı.", "API");
    return {
      externalId: u.open_id,
      followers: u.follower_count,
      postsCount: u.video_count,
      avgLikes: u.video_count ? Math.round(u.likes_count / u.video_count) : null,
      avgComments: null,
      avgViews: null,
      engagementRate: u.follower_count && u.video_count ? u.likes_count / u.video_count / u.follower_count : null,
      profileUrl: u.profile_deep_link ?? `https://tiktok.com/@${handle}`,
      avatarUrl: u.avatar_url ?? null,
      verified: !!u.is_verified,
      source: "tiktok_oauth",
    };
  },
};

const notConfigured: SocialProvider = {
  async fetch() {
    throw new SyncError("Otomatik senkron kapalı: API anahtarları tanımlanmadı (SOCIAL_SYNC_MODE=http). Elle girilen değerler korunuyor.", "NOT_CONFIGURED");
  },
};

export function syncMode(): "http" | "mock" | "off" {
  const m = envStr("SOCIAL_SYNC_MODE", "off");
  return m === "http" || m === "mock" ? m : "off";
}

let override: SocialProvider | undefined;
export function socialProvider(): SocialProvider {
  if (override) return override;
  const m = syncMode();
  return m === "http" ? httpSocial : m === "mock" ? mockSocial : notConfigured;
}
export function setSocialProvider(p: SocialProvider | undefined) {
  override = p;
}

export type SyncResult = { accountId: string; ok: boolean; message: string; followersBefore?: number; followersAfter?: number };

/** Tek hesabı senkronlar; değişiklik varsa trend için snapshot yazar. Hata hesabın syncError alanına düşer. */
export async function syncSocialAccount(accountId: string, now = new Date()): Promise<SyncResult> {
  const acc = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!acc) return { accountId, ok: false, message: "Hesap bulunamadı." };
  if (acc.platform === "TIKTOK" && !override && syncMode() === "http") {
    const ttAcc = await prisma.tikTokAccount.findFirst({
      where: { influencerId: acc.influencerId, status: "active" },
      select: { id: true },
    });
    if (ttAcc) {
      const { syncTikTokAccount } = await import("../tiktok/service");
      const res = await syncTikTokAccount(ttAcc.id, now);
      if (res.ok) {
        const refreshed = await prisma.socialAccount.findUnique({ where: { id: acc.id } });
        if (refreshed && refreshed.followers !== acc.followers) {
          await prisma.socialAccountSnapshot.create({
            data: {
              socialAccountId: acc.id,
              followers: refreshed.followers,
              engagementRate: refreshed.engagementRate,
              demographics: acc.demographics as object,
              takenAt: now,
            },
          });
        }
        return {
          accountId,
          ok: true,
          message: `TikTok güncellendi: ${res.followerCount.toLocaleString("tr-TR")} takipçi, ${res.videoCount} video.`,
          followersBefore: acc.followers,
          followersAfter: res.followerCount,
        };
      }
      await prisma.socialAccount.update({ where: { id: acc.id }, data: { syncError: res.error.slice(0, 300), lastSyncedAt: now } });
      return { accountId, ok: false, message: res.error };
    }
  }
  try {
    const s = await socialProvider().fetch(acc.platform, acc.handle, { tokenRef: acc.tokenRef, externalId: acc.externalId });
    const er = s.engagementRate ?? Number(acc.engagementRate);
    const nextDemo = s.demographics ? (s.demographics as object) : (acc.demographics as object);
    await prisma.$transaction(async (tx) => {
      await tx.socialAccount.update({
        where: { id: acc.id },
        data: {
          followers: s.followers,
          engagementRate: Math.min(9.9999, Math.max(0, er)),
          externalId: s.externalId ?? acc.externalId,
          postsCount: s.postsCount ?? acc.postsCount,
          avgLikes: s.avgLikes ?? acc.avgLikes,
          avgComments: s.avgComments ?? acc.avgComments,
          avgViews: s.avgViews ?? acc.avgViews,
          profileUrl: s.profileUrl,
          avatarUrl: s.avatarUrl ?? acc.avatarUrl,
          verified: s.verified,
          ...(s.demographics ? { demographics: s.demographics as object } : {}),
          syncSource: s.source,
          lastSyncedAt: now,
          syncError: null,
        },
      });
      if (s.followers !== acc.followers || Math.abs(er - Number(acc.engagementRate)) > 0.0001 || s.demographics) {
        await tx.socialAccountSnapshot.create({
          data: { socialAccountId: acc.id, followers: s.followers, engagementRate: Math.min(9.9999, Math.max(0, er)), demographics: nextDemo, takenAt: now },
        });
      }
    });
    return { accountId, ok: true, message: `Güncellendi: ${s.followers.toLocaleString("tr-TR")} takipçi.`, followersBefore: acc.followers, followersAfter: s.followers };
  } catch (e) {
    const msg = e instanceof SyncError ? e.message : `Senkron hatası: ${(e as Error).message}`.slice(0, 300);
    // Yapılandırma eksikse hesap verisine dokunulmaz (son senkron zamanı da değişmez).
    if (!(e instanceof SyncError && e.code === "NOT_CONFIGURED")) {
      await prisma.socialAccount.update({ where: { id: acc.id }, data: { syncError: msg, lastSyncedAt: now } });
    }
    return { accountId, ok: false, message: msg };
  }
}

export async function syncInfluencer(influencerId: string, onlyPlatform?: Platform) {
  const accounts = await prisma.socialAccount.findMany({
    where: { influencerId, ...(onlyPlatform ? { platform: onlyPlatform } : {}) },
    select: { id: true },
  });
  const out: SyncResult[] = [];
  for (const a of accounts) out.push(await syncSocialAccount(a.id));
  return out;
}

/** Nordvow Meta token'larıyla herhangi bir Instagram Business/Creator hesabını anlık inceler (DB yazmadan). */
export async function inspectInstagramHandle(rawHandle: string): Promise<ProfileStats & { handle: string }> {
  const handle = cleanHandle(rawHandle);
  if (!handle) throw new SyncError("Geçerli bir Instagram kullanıcı adı girin.", "NOT_FOUND");
  const data = await socialProvider().fetch("INSTAGRAM", handle, { tokenRef: null });
  return { ...data, handle };
}

/** Zamanlanmış job: 12 saatten eski hesaplar (en fazla `limit` hesap; API kotası için). */
export async function syncStaleAccounts(limit = 50, now = new Date()) {
  if (!override && syncMode() === "off") return { checked: 0, ok: 0 };
  const stale = await prisma.socialAccount.findMany({
    where: { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - 12 * 3_600_000) } }] },
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: limit,
    select: { id: true },
  });
  let ok = 0;
  for (const a of stale) if ((await syncSocialAccount(a.id, now)).ok) ok++;
  return { checked: stale.length, ok };
}

export const syncSourceLabels: Record<string, string> = {
  manual: "Elle girildi",
  instagram_business_discovery: "Meta Business SDK (Business Discovery)",
  instagram_oauth: "Meta Business SDK (Doğrulanmış OAuth + Insights)",
  instagram_public: "Instagram (açık profil önizleme)",
  youtube_data: "YouTube API",
  tiktok_oauth: "TikTok (influencer bağlantısı)",
  tiktok_public: "TikTok (açık profil)",
  mock: "Demo veri (API anahtarı yok)",
};

async function fetchPublicTikTokProfile(handle: string): Promise<ProfileStats | null> {
  try {
    const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(handle)}`, {
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "accept-language": "tr-TR,tr;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
    if (!m?.[1]) return null;
    const parsed = JSON.parse(m[1]) as {
      __DEFAULT_SCOPE__?: {
        "webapp.user-detail"?: {
          userInfo?: {
            user?: { id?: string; uniqueId?: string; avatarLarger?: string; avatarMedium?: string; verified?: boolean };
            stats?: { followerCount?: number; videoCount?: number; heartCount?: number; heart?: number };
          };
        };
      };
    };
    const info = parsed.__DEFAULT_SCOPE__?.["webapp.user-detail"]?.userInfo;
    if (!info?.user || !info?.stats) return null;
    const followers = Number(info.stats.followerCount ?? 0);
    const videos = Number(info.stats.videoCount ?? 0);
    const hearts = Number(info.stats.heartCount ?? info.stats.heart ?? 0);
    return {
      externalId: info.user.id ?? null,
      followers,
      postsCount: videos,
      avgLikes: videos > 0 ? Math.round(hearts / videos) : null,
      avgComments: null,
      avgViews: null,
      engagementRate: followers > 0 && videos > 0 ? hearts / videos / followers : null,
      profileUrl: `https://www.tiktok.com/@${info.user.uniqueId ?? handle}`,
      avatarUrl: info.user.avatarLarger ?? info.user.avatarMedium ?? null,
      verified: !!info.user.verified,
      source: "tiktok_public",
    };
  } catch {
    return null;
  }
}
