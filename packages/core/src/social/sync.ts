import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { envStr } from "../env";
import type { Platform } from "../generated/prisma/enums";
import { vault } from "../channels/vault";
import { GraphCallError, graphGetJson, PERMANENT_GRAPH_CLASSES, type GraphErrorClass } from "./graph-error";
import { isValidInstagramHandle, normalizeInstagramHandle, normalizeSocialHandle } from "./handles";
import { publicProfileFallback, type PublicApiReason, type StoredPublicProfile } from "./public-fallback";

/**
 * Sosyal hesap senkronu — yalnız resmî API'ler (kazıma yok).
 * - Instagram herkese açık işletme/içerik üreticisi: Business Discovery (ajans IG kimliği + sistem kullanıcısı belirteci).
 * - Kişisel, gizli, kısıtlı: Business Discovery zorlanmaz. İçerik üreticisi Instagram Login ile bağlanır.
 * - Graph yoksa ve kayıtta herkese açık alan varsa: INSTAGRAM_PUBLIC (ağ çağrısı yok).
 * - YouTube: Data API v3. TikTok: influencer OAuth.
 *
 * SOCIAL_SYNC_MODE (http | mock | off) sosyal senkronu yönetir. META_API_MODE yalnızca mesajlaşma istemcisidir;
 * sosyal senkron onu okumaz.
 *
 * Sayfa token'ı tek çözümleyiciyle okunur: META_SYSTEM_USER_TOKEN, IG_GRAPH_TOKEN, INSTAGRAM_ACCESS_TOKEN.
 * Üçü de aynı süresiz Sayfa token'ını taşır. İlk dolu olan kullanılır. Değerler farklıysa yalnız MISMATCH loglanır.
 * IG kullanıcı kimliği: INSTAGRAM_IG_USER_ID (eski IG_BUSINESS_ACCOUNT_ID yalnız yerel yedek).
 */
export const GRAPH_VERSION = "v24.0";
export const SOCIAL_SYNC_STALE_MS = 24 * 60 * 60 * 1000;
export const DISCOVERY_BLOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SocialDataSource = "META_API" | "INSTAGRAM_OAUTH" | "INSTAGRAM_PUBLIC" | "NONE";

export type IgMediaItem = {
  id: string;
  caption?: string | null;
  mediaProductType?: string | null;
  permalink?: string | null;
  timestamp?: string | null;
  likeCount?: number | null;
  commentsCount?: number | null;
};

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
  displayName?: string | null;
  bioSnippet?: string | null;
  source: SocialDataSource | "youtube_data" | "tiktok_oauth" | "mock" | "instagram_business_discovery";
  /** API sınıfı public yola düşürdüyse (ör. TOKEN_INVALID). Başarılı Meta/OAuth'ta boş. */
  syncReason?: string | null;
  media?: IgMediaItem[];
};

export const IG_PROFESSIONAL_HINT =
  "Kişisel hesaplar Business Discovery ile okunamaz. Hesabı Professional yapın veya Instagram ile bağlayın. Gizli profile istek atılmaz.";

export function instagramDiscoveryFailure(message: string): boolean {
  return /business_discovery|not a business|nonexisting field|cannot find user|invalid user id|unsupported get request/i.test(message);
}

export class SyncError extends Error {
  readonly graphClass?: GraphErrorClass;
  readonly attempts: number;
  constructor(
    message: string,
    readonly code: "NOT_CONFIGURED" | "NOT_FOUND" | "NOT_BUSINESS" | "NEEDS_OAUTH" | "API",
    graphClass?: GraphErrorClass,
    attempts = 1,
  ) {
    super(message);
    this.name = "SyncError";
    this.graphClass = graphClass;
    this.attempts = attempts;
  }
}

export interface SocialProvider {
  fetch(platform: Platform, handle: string, ctx: { tokenRef: string | null; stored?: StoredPublicProfile }): Promise<ProfileStats>;
}

function trimEnv(name: string): string {
  return envStr(name, "").trim();
}

/** Süresiz Sayfa token'ı. Sıra: META_SYSTEM_USER_TOKEN, IG_GRAPH_TOKEN, INSTAGRAM_ACCESS_TOKEN. Değer loglanmaz. */
export const META_PAGE_TOKEN_KEYS = ["META_SYSTEM_USER_TOKEN", "IG_GRAPH_TOKEN", "INSTAGRAM_ACCESS_TOKEN"] as const;

export function resolveMetaPageToken(): string {
  const values = META_PAGE_TOKEN_KEYS.map((key) => trimEnv(key)).filter((value) => value.length > 0);
  const distinct = new Set(values);
  if (distinct.size > 1) console.warn("MISMATCH");
  return values[0] ?? "";
}

export function instagramBusinessCredentials(): { igUserId: string; token: string } {
  const igUserId = trimEnv("INSTAGRAM_IG_USER_ID") || trimEnv("IG_BUSINESS_ACCOUNT_ID");
  return { igUserId, token: resolveMetaPageToken() };
}

const BD_FIELDS =
  "id,username,name,biography,followers_count,media_count,profile_picture_url,media.limit(12){like_count,comments_count,media_product_type,timestamp,permalink}";

type BdMedia = { id?: string; like_count?: number; comments_count?: number; media_product_type?: string; timestamp?: string; permalink?: string; caption?: string };
type BdUser = {
  id?: string;
  username?: string;
  name?: string;
  biography?: string;
  followers_count?: number;
  media_count?: number;
  profile_picture_url?: string;
  media?: { data?: BdMedia[] };
};

function mediaFrom(list: BdMedia[] | undefined): IgMediaItem[] {
  return (list ?? []).map((m, i) => ({
    id: m.id ?? `media-${i}`,
    caption: m.caption ?? null,
    mediaProductType: m.media_product_type ?? null,
    permalink: m.permalink ?? null,
    timestamp: m.timestamp ?? null,
    likeCount: m.like_count ?? null,
    commentsCount: m.comments_count ?? null,
  }));
}

function averages(media: IgMediaItem[]): { avgLikes: number | null; avgComments: number | null } {
  const likes = media.map((m) => m.likeCount).filter((n): n is number => n != null);
  const comments = media.map((m) => m.commentsCount).filter((n): n is number => n != null);
  return {
    avgLikes: likes.length ? Math.round(likes.reduce((s, n) => s + n, 0) / likes.length) : null,
    avgComments: comments.length ? Math.round(comments.reduce((s, n) => s + n, 0) / comments.length) : null,
  };
}

function statsFromBd(handle: string, bd: BdUser, source: SocialDataSource): ProfileStats {
  const media = mediaFrom(bd.media?.data);
  const { avgLikes, avgComments } = averages(media);
  const followers = bd.followers_count ?? 0;
  const name = bd.username || handle;
  return {
    externalId: bd.id ?? null,
    followers,
    postsCount: bd.media_count ?? null,
    avgLikes,
    avgComments,
    avgViews: null,
    engagementRate: followers && avgLikes != null ? (avgLikes + (avgComments ?? 0)) / followers : null,
    profileUrl: `https://instagram.com/${name}`,
    avatarUrl: bd.profile_picture_url ?? null,
    verified: false,
    displayName: bd.name ?? null,
    bioSnippet: bd.biography?.slice(0, 300) ?? null,
    source,
    media,
  };
}

async function fetchInstagramOauth(token: string, handle: string): Promise<ProfileStats> {
  const fields = "user_id,username,name,biography,followers_count,media_count,profile_picture_url";
  const meUrl = `https://graph.instagram.com/${GRAPH_VERSION}/me?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  let me: { json: Record<string, unknown> };
  try {
    me = await graphGetJson(meUrl, { targetHandle: handle });
  } catch (e) {
    if (e instanceof GraphCallError) throw new SyncError(e.message, e.classified.errorClass === "TARGET_NOT_DISCOVERABLE" ? "NOT_BUSINESS" : "API", e.classified.errorClass, e.attempts);
    throw e;
  }
  const user = me.json as BdUser & { user_id?: string };
  const mediaFields = "id,like_count,comments_count,media_product_type,timestamp,permalink";
  const mediaUrl = `https://graph.instagram.com/${GRAPH_VERSION}/me/media?fields=${encodeURIComponent(mediaFields)}&limit=12&access_token=${encodeURIComponent(token)}`;
  let media: BdMedia[] = [];
  try {
    const mj = await graphGetJson(mediaUrl, { targetHandle: handle });
    media = (mj.json.data as BdMedia[] | undefined) ?? [];
  } catch (e) {
    if (e instanceof GraphCallError && e.classified.errorClass === "TOKEN_INVALID") throw new SyncError(e.message, "API", "TOKEN_INVALID", e.attempts);
    media = [];
  }
  return statsFromBd(handle, { ...user, id: user.id ?? user.user_id, media: { data: media } }, "INSTAGRAM_OAUTH");
}

const HYBRID_PUBLIC = new Set<string>(["TOKEN_INVALID", "MISSING_PERMISSION", "RATE_LIMITED", "TARGET_NOT_DISCOVERABLE", "NOT_CONFIGURED"]);

function emptyStored(handle: string): StoredPublicProfile {
  return { handle, followers: 0, postsCount: null, avgLikes: null, avgComments: null, engagementRate: null, avatarUrl: null, displayName: null, bioSnippet: null, profileUrl: null };
}

/** API sınıfından sonra public yol. Kazıma yok. Gizli/kişisel hesap OAuth ile durur. */
function continueWithPublic(handle: string, stored: StoredPublicProfile | undefined, apiClass: PublicApiReason, attempts = 1): ProfileStats {
  const result = publicProfileFallback({ ...(stored ?? emptyStored(handle)), handle, apiClass });
  if (result.ok) {
    return {
      externalId: null,
      followers: result.followers,
      postsCount: result.postsCount,
      avgLikes: result.avgLikes,
      avgComments: result.avgComments,
      avgViews: null,
      engagementRate: result.engagementRate,
      profileUrl: result.profileUrl,
      avatarUrl: result.avatarUrl,
      verified: false,
      displayName: result.displayName,
      bioSnippet: result.bioSnippet,
      source: "INSTAGRAM_PUBLIC",
      syncReason: result.reason,
    };
  }
  const code = result.oauthRequired ? "NEEDS_OAUTH" : apiClass === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "API";
  const graphClass = apiClass === "NOT_CONFIGURED" ? undefined : (apiClass as GraphErrorClass);
  const detail = syncReasonNotes[apiClass] ?? result.message;
  throw new SyncError(result.oauthRequired ? result.message : `${detail} ${result.message}`, code, graphClass, attempts);
}

async function fetchInstagramDiscovery(handle: string, stored?: StoredPublicProfile): Promise<ProfileStats> {
  if (!isValidInstagramHandle(handle)) {
    throw new SyncError("Geçerli bir Instagram kullanıcı adı girin (harf, rakam, nokta ve alt çizgi; en fazla 30 karakter).", "NOT_FOUND");
  }
  const { igUserId, token } = instagramBusinessCredentials();
  if (!igUserId || !token) return continueWithPublic(handle, stored, "NOT_CONFIGURED");
  const fields = `business_discovery.username(${handle}){${BD_FIELDS}}`;
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igUserId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(token)}`;
  try {
    const { json } = await graphGetJson(url, { agencyIgUserId: igUserId, targetHandle: handle });
    const bd = (json.business_discovery ?? null) as BdUser | null;
    if (!bd) return continueWithPublic(handle, stored, "TARGET_NOT_DISCOVERABLE");
    return { ...statsFromBd(handle, bd, "META_API"), syncReason: null };
  } catch (e) {
    const graphClass = e instanceof GraphCallError ? e.classified.errorClass : e instanceof SyncError ? e.graphClass : undefined;
    const attempts = e instanceof GraphCallError ? e.attempts : e instanceof SyncError ? e.attempts : 1;
    if (graphClass && HYBRID_PUBLIC.has(graphClass)) return continueWithPublic(handle, stored, graphClass as PublicApiReason, attempts);
    if (e instanceof GraphCallError) throw new SyncError(e.message, "API", e.classified.errorClass, attempts);
    if (e instanceof SyncError) throw e;
    throw new SyncError("Instagram verisi alınamadı. Ayrıntı gösterilmez.", "API", "UNKNOWN");
  }
}

/** Deterministik mock: aynı handle her zaman aynı değerleri üretir; 'yok' içeren handle → bulunamadı. */
export const mockSocial: SocialProvider = {
  async fetch(platform, rawHandle) {
    const handle = platform === "INSTAGRAM" ? normalizeInstagramHandle(rawHandle) : normalizeSocialHandle(rawHandle);
    if (platform === "INSTAGRAM" && !isValidInstagramHandle(handle)) {
      throw new SyncError("Geçerli bir Instagram kullanıcı adı girin (harf, rakam, nokta ve alt çizgi; en fazla 30 karakter).", "NOT_FOUND");
    }
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

export const httpSocial: SocialProvider = {
  async fetch(platform, rawHandle, ctx) {
    if (platform === "INSTAGRAM") {
      const handle = normalizeInstagramHandle(rawHandle);
      if (ctx.tokenRef) {
        const token = await vault().get(ctx.tokenRef);
        return fetchInstagramOauth(token, handle);
      }
      return fetchInstagramDiscovery(handle, ctx.stored);
    }
    const handle = normalizeSocialHandle(rawHandle);
    if (platform === "YOUTUBE") {
      const key = trimEnv("YOUTUBE_API_KEY");
      if (!key) throw new SyncError("YouTube senkronu yapılandırılmadı (YOUTUBE_API_KEY).", "NOT_CONFIGURED");
      const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&forHandle=${encodeURIComponent(`@${handle}`)}&key=${encodeURIComponent(key)}`;
      const j = (await readJson(url)) as { items?: { id: string; statistics: { subscriberCount?: string; videoCount?: string; viewCount?: string }; snippet: { thumbnails?: { default?: { url: string }; medium?: { url: string }; high?: { url: string } } } }[] };
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
    if (!ctx.tokenRef) throw new SyncError("TikTok verisi için influencer'ın hesabını bağlaması gerekiyor (bağlantı linki gönderin).", "NEEDS_OAUTH");
    const token = await vault().get(ctx.tokenRef);
    const body = (await readJson("https://open.tiktokapis.com/v2/user/info/?fields=open_id,follower_count,video_count,likes_count,avatar_url,is_verified,profile_deep_link", {
      headers: { authorization: `Bearer ${token}` },
    })) as { data?: { user?: { open_id: string; follower_count: number; video_count: number; likes_count: number; avatar_url?: string; is_verified?: boolean; profile_deep_link?: string } } };
    const u = body.data?.user;
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

async function readJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string }; items?: unknown };
  if (!res.ok || json.error) {
    const raw = json.error?.message ?? "";
    const safe = /access_token|api[_-]?key|secret/i.test(raw) ? "" : raw.slice(0, 180);
    throw new SyncError(safe || `İstek başarısız (HTTP ${res.status}).`, res.status === 404 ? "NOT_FOUND" : "API");
  }
  return json;
}

const notConfigured: SocialProvider = {
  async fetch() {
    throw new SyncError("Otomatik senkron kapalı: API anahtarları tanımlanmadı (SOCIAL_SYNC_MODE=http). Elle girilen değerler korunuyor.", "NOT_CONFIGURED");
  },
};

export function syncMode(): "http" | "mock" | "off" {
  const m = trimEnv("SOCIAL_SYNC_MODE") || "off";
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

export type SyncResult = {
  accountId: string;
  ok: boolean;
  message: string;
  followersBefore?: number;
  followersAfter?: number;
  source?: ProfileStats["source"];
  errorClass?: GraphErrorClass | null;
  media?: IgMediaItem[];
};

const NO_AUTO_RETRY = new Set<string>(["TOKEN_INVALID", "MISSING_PERMISSION", "UNKNOWN"]);

function storedOf(acc: {
  handle: string;
  followers: number;
  postsCount: number | null;
  avgLikes: number | null;
  avgComments: number | null;
  engagementRate: { toString(): string } | number;
  avatarUrl: string | null;
  displayName: string | null;
  bioSnippet: string | null;
  profileUrl: string | null;
}): StoredPublicProfile {
  return {
    handle: acc.handle,
    followers: acc.followers,
    postsCount: acc.postsCount,
    avgLikes: acc.avgLikes,
    avgComments: acc.avgComments,
    engagementRate: Number(acc.engagementRate),
    avatarUrl: acc.avatarUrl,
    displayName: acc.displayName,
    bioSnippet: acc.bioSnippet,
    profileUrl: acc.profileUrl,
  };
}

async function writeTelemetry(socialAccountId: string, row: { durationMs: number; errorClass: string | null; source: string; ok: boolean; reason?: string | null }) {
  await prisma.socialSyncEvent.create({ data: { socialAccountId, reason: row.reason ?? null, durationMs: row.durationMs, errorClass: row.errorClass, source: row.source, ok: row.ok } }).catch(() => undefined);
}

/** Tek hesabı senkronlar. Kalıcı Graph sınıfı force olmadan yeniden çağrılmaz. Başarıda hata alanları temizlenir. */
export async function syncSocialAccount(accountId: string, now = new Date(), opts: { force?: boolean } = {}): Promise<SyncResult> {
  const acc = await prisma.socialAccount.findUnique({ where: { id: accountId } });
  if (!acc) return { accountId, ok: false, message: "Hesap bulunamadı." };
  const started = Date.now();
  if (!opts.force && acc.lastErrorClass && NO_AUTO_RETRY.has(acc.lastErrorClass)) {
    return { accountId, ok: false, message: acc.syncError ?? "Kalıcı hata nedeniyle otomatik senkron atlandı.", errorClass: acc.lastErrorClass as GraphErrorClass };
  }
  if (!opts.force && acc.lastErrorClass === "TARGET_NOT_DISCOVERABLE" && acc.lastSyncedAt && now.getTime() - acc.lastSyncedAt.getTime() < DISCOVERY_BLOCK_TTL_MS) {
    return { accountId, ok: false, message: acc.syncError ?? "Bu hesap Business Discovery ile okunamıyor. Instagram bağlantısı bekleniyor.", errorClass: "TARGET_NOT_DISCOVERABLE" };
  }
  try {
    const s = await socialProvider().fetch(acc.platform, acc.handle, { tokenRef: acc.tokenRef, stored: storedOf(acc) });
    const er = s.engagementRate ?? Number(acc.engagementRate);
    const oauthHandle = s.source === "INSTAGRAM_OAUTH" && s.profileUrl ? normalizeInstagramHandle(s.profileUrl) : "";
    await prisma.$transaction(async (tx) => {
      await tx.socialAccount.update({
        where: { id: acc.id },
        data: {
          ...(oauthHandle && isValidInstagramHandle(oauthHandle) ? { handle: oauthHandle } : {}),
          followers: s.followers,
          engagementRate: Math.min(9.9999, Math.max(0, er)),
          externalId: s.externalId,
          postsCount: s.postsCount,
          avgLikes: s.avgLikes,
          avgComments: s.avgComments,
          avgViews: s.avgViews,
          profileUrl: s.profileUrl,
          avatarUrl: s.avatarUrl,
          verified: s.verified,
          displayName: s.displayName ?? null,
          bioSnippet: s.bioSnippet ?? null,
          syncSource: s.source,
          lastSyncedAt: now,
          syncError: null,
          lastErrorClass: null,
          syncReason: s.source === "INSTAGRAM_PUBLIC" ? s.syncReason ?? null : null,
          retryCount: 0,
        },
      });
      if (s.followers !== acc.followers || Math.abs(er - Number(acc.engagementRate)) > 0.0001) {
        await tx.socialAccountSnapshot.create({
          data: { socialAccountId: acc.id, followers: s.followers, engagementRate: Math.min(9.9999, Math.max(0, er)), demographics: acc.demographics as object, takenAt: now },
        });
      }
    });
    await writeTelemetry(acc.id, { durationMs: Date.now() - started, errorClass: s.syncReason ?? null, source: s.source, ok: true, reason: s.syncReason ?? null });
    return {
      accountId,
      ok: true,
      message: `Güncellendi: ${s.followers.toLocaleString("tr-TR")} takipçi.`,
      followersBefore: acc.followers,
      followersAfter: s.followers,
      source: s.source,
      errorClass: null,
      media: s.media,
    };
  } catch (e) {
    const graphClass = e instanceof SyncError ? e.graphClass ?? (e.code === "NOT_FOUND" ? null : "UNKNOWN") : "UNKNOWN";
    const msg = e instanceof SyncError ? e.message : "Senkron hatası.";
    const configured = e instanceof SyncError && e.code === "NOT_CONFIGURED";
    const rateRetries = e instanceof SyncError && e.graphClass === "RATE_LIMITED" ? Math.max(0, e.attempts - 1) : 0;
    if (!configured) {
      await prisma.socialAccount.update({
        where: { id: acc.id },
        data: {
          syncError: msg.slice(0, 500),
          lastErrorClass: graphClass,
          syncReason: graphClass,
          retryCount: graphClass === "RATE_LIMITED" ? rateRetries : 0,
          lastSyncedAt: now,
          ...(graphClass === "TARGET_NOT_DISCOVERABLE" ? { syncSource: "NONE" } : graphClass === "UNKNOWN" ? { syncSource: acc.followers > 0 ? acc.syncSource : "NONE" } : {}),
        },
      });
    }
    await writeTelemetry(acc.id, {
      durationMs: Date.now() - started,
      errorClass: graphClass,
      source: graphClass === "TARGET_NOT_DISCOVERABLE" || configured ? "NONE" : acc.syncSource || "NONE",
      ok: false,
      reason: graphClass,
    });
    return { accountId, ok: false, message: msg, errorClass: graphClass };
  }
}

export async function syncInfluencer(influencerId: string, onlyPlatform?: Platform, opts: { force?: boolean } = {}) {
  const accounts = await prisma.socialAccount.findMany({
    where: { influencerId, ...(onlyPlatform ? { platform: onlyPlatform } : {}) },
    select: { id: true },
  });
  const out: SyncResult[] = [];
  for (const a of accounts) out.push(await syncSocialAccount(a.id, new Date(), opts));
  return out;
}

/** Nordvow Meta belirteciyle herhangi bir Instagram işletme hesabını anlık inceler (DB yazmadan). */
export async function inspectInstagramHandle(rawHandle: string): Promise<ProfileStats & { handle: string }> {
  const handle = normalizeInstagramHandle(rawHandle);
  if (!isValidInstagramHandle(handle)) throw new SyncError("Geçerli bir Instagram kullanıcı adı girin.", "NOT_FOUND");
  const data = await socialProvider().fetch("INSTAGRAM", handle, { tokenRef: null });
  return { ...data, handle };
}

const LOCK_ID = "social-sync";

async function acquireSocialSyncLock(now: Date): Promise<boolean> {
  const owner = randomBytes(8).toString("hex");
  const expiresAt = new Date(now.getTime() + 30 * 60_000);
  const taken = await prisma.socialSyncLock.updateMany({ where: { id: LOCK_ID, expiresAt: { lt: now } }, data: { owner, expiresAt } });
  if (taken.count === 1) return true;
  try {
    await prisma.socialSyncLock.create({ data: { id: LOCK_ID, owner, expiresAt } });
    return true;
  } catch {
    return false;
  }
}

async function releaseSocialSyncLock(now: Date) {
  await prisma.socialSyncLock.updateMany({ where: { id: LOCK_ID }, data: { expiresAt: now } }).catch(() => undefined);
}

/** Günde bir. Çakışan tetik (EventBridge ve yerel zamanlayıcı) kilitte düşer. Kalıcı hatalar atlanır. */
export async function syncStaleAccounts(limit = 50, now = new Date()) {
  if (!override && syncMode() === "off") return { checked: 0, ok: 0 };
  const locked = await acquireSocialSyncLock(now);
  if (!locked) return { checked: 0, ok: 0, skipped: limit };
  try {
    const staleBefore = new Date(now.getTime() - SOCIAL_SYNC_STALE_MS);
    const rows = await prisma.socialAccount.findMany({
      where: { OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: staleBefore } }] },
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
      take: Math.max(limit * 4, limit),
      select: { id: true, lastErrorClass: true, lastSyncedAt: true, syncSource: true },
    });
    const picked = rows.filter((a) => {
      if (a.lastErrorClass && NO_AUTO_RETRY.has(a.lastErrorClass)) return false;
      if (a.lastErrorClass === "TARGET_NOT_DISCOVERABLE" || a.syncSource === "INSTAGRAM_PUBLIC") {
        return !a.lastSyncedAt || now.getTime() - a.lastSyncedAt.getTime() >= DISCOVERY_BLOCK_TTL_MS;
      }
      return true;
    }).slice(0, limit);
    let ok = 0;
    for (const a of picked) if ((await syncSocialAccount(a.id, now)).ok) ok++;
    return { checked: picked.length, ok, skipped: rows.length - picked.length };
  } finally {
    await releaseSocialSyncLock(new Date());
  }
}

export const syncSourceLabels: Record<string, string> = {
  META_API: "Meta API doğrulandı",
  INSTAGRAM_OAUTH: "Instagram OAuth",
  INSTAGRAM_PUBLIC: "Public profil verisi",
  NONE: "Veri yok",
  instagram_business_discovery: "Meta API doğrulandı",
  manual: "Elle girildi",
  youtube_data: "YouTube API",
  tiktok_oauth: "TikTok (influencer bağlantısı)",
  mock: "Demo veri (API anahtarı yok)",
};

const CLASS_MESSAGES: Record<string, string> = Object.fromEntries(
  PERMANENT_GRAPH_CLASSES.map((c) => [c, ""]),
);
CLASS_MESSAGES.TOKEN_INVALID = "Meta bağlantısı yenilenmeli. Bu, hesabın bulunamadığı anlamına gelmez.";
CLASS_MESSAGES.MISSING_PERMISSION = "Meta uygulamasının izni yok (10/200). Uygulama yayında değil veya izinler henüz Ready for testing aşamasında.";
CLASS_MESSAGES.TARGET_NOT_DISCOVERABLE = "Bu hesap Business Discovery ile okunamıyor. Kişisel, gizli veya kısıtlı olabilir. Instagram ile bağlayın.";
CLASS_MESSAGES.RATE_LIMITED = "Meta istek limiti. Bir sonraki günlük senkronda yeniden denenecek.";
CLASS_MESSAGES.UNKNOWN = "Instagram verisi alınamadı.";

export const syncReasonNotes: Record<string, string> = {
  TOKEN_INVALID: "API sınıfı TOKEN_INVALID olduğu için public profil verisi kullanıldı.",
  MISSING_PERMISSION: "API sınıfı MISSING_PERMISSION (10/200) olduğu için public profil verisi kullanıldı.",
  RATE_LIMITED: "API sınıfı RATE_LIMITED olduğu için public profil verisi kullanıldı.",
  TARGET_NOT_DISCOVERABLE: "API sınıfı TARGET_NOT_DISCOVERABLE (110/2207013). Hesap gizli veya kişisel; Instagram ile bağlayın.",
  NOT_CONFIGURED: "API yapılandırılmadığı için public profil verisi kullanıldı.",
};

/** Ham UNKNOWN_ERROR ve eski önbellek metinleri arayüze çıkmaz. Public yolda neden not olarak durur. */
export function syncStatusView(account: { syncSource: string | null; syncError: string | null; lastErrorClass: string | null; syncReason?: string | null }): { label: string; error: string | null; note: string | null } {
  const label = syncSourceLabels[account.syncSource ?? ""] ?? syncSourceLabels.NONE!;
  const note = account.syncReason ? syncReasonNotes[account.syncReason] ?? null : null;
  if (account.syncSource === "INSTAGRAM_PUBLIC") return { label, error: null, note };
  if (!account.lastErrorClass) return { label, error: null, note };
  const mapped = CLASS_MESSAGES[account.lastErrorClass];
  if (mapped) return { label, error: mapped, note };
  return { label, error: null, note };
}
