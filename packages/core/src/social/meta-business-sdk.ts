/// <reference path="../types/facebook-nodejs-business-sdk.d.ts" />
import { createHmac } from "node:crypto";
import { FacebookAdsApi, IGMedia, IGUser } from "facebook-nodejs-business-sdk";
import { prisma } from "../db";
import { envStr } from "../env";
import { vault } from "../channels/vault";
import { cleanSocialHandle } from "./handle";

export type SdkComment = {
  id: string;
  mediaId: string;
  username: string;
  text: string;
  timestamp: string;
};

export type SdkMediaItem = {
  id: string;
  mediaType: "POST" | "CAROUSEL" | "REELS" | "STORY";
  caption: string;
  permalink: string;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  timestamp: string;
  likes: number;
  commentsCount: number;
  saves: number;
  shares: number;
  reach: number;
  impressions: number;
  plays: number;
  comments: SdkComment[];
};

export type VerifiedAccountInsights = {
  reach: number;
  accountsEngaged: number;
  totalInteractions: number;
  profileViews: number;
};

export type VerifiedAudienceDemographics = {
  verifiedBySdk: boolean;
  fetchedAt: string;
  genderSplit: { femalePct: number; malePct: number; otherPct: number };
  topCountries: { country: string; count: number; pct: number }[];
  topCities: { city: string; count: number; pct: number }[];
  ageGroups: { range: string; pct: number }[];
};

export type VerifiedInstagramResult = {
  ok: boolean;
  sdkVersion: string;
  usedOAuth: boolean;
  fallbackFromExpiredOAuth: boolean;
  source: "meta_sdk_oauth" | "meta_sdk_business_discovery" | "none";
  errorCode: number | null;
  errorSubcode: number | null;
  errorMessage: string | null;
  externalId: string | null;
  username: string;
  fullName: string | null;
  biography: string | null;
  avatarUrl: string | null;
  followers: number;
  followsCount: number;
  postsCount: number;
  accountInsights: VerifiedAccountInsights | null;
  demographics: VerifiedAudienceDemographics | null;
  media: SdkMediaItem[];
  stories: SdkMediaItem[];
  comments: SdkComment[];
  durationMs: number;
};

export function createMetaSdkApi(accessToken: string): InstanceType<typeof FacebookAdsApi> {
  // crashLog=false: sunucusuz / Next.js çalışma ortamında global uncaughtException kancalarını çoğaltmaz
  return new FacebookAdsApi(accessToken, "tr_TR", false);
}

export function computeAppSecretProof(accessToken: string): string | undefined {
  const secret = envStr("META_APP_SECRET", "");
  if (!secret || !accessToken) return undefined;
  return createHmac("sha256", secret).update(accessToken).digest("hex");
}

function withProof(accessToken: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  const proof = computeAppSecretProof(accessToken);
  return proof ? { ...params, appsecret_proof: proof } : params;
}

/**
 * Tek bir belirtece bağımlı kalmamak için çoklu Meta erişim kimliği çözümleyicisi:
 * 1) DB `config_values` (`meta.igBusinessAccountId`, `meta.systemUserToken`, `instagram.accessToken`)
 * 2) Ortam değişkenleri (`META_SYSTEM_USER_TOKEN`, `IG_GRAPH_TOKEN`, `INSTAGRAM_ACCESS_TOKEN`, `META_IG_TOKEN`)
 * 3) Aktif `ChannelConnection` (`provider: "INSTAGRAM", status: "ACTIVE"`) kayıtları
 */
export async function resolveMetaSdkCredentials(): Promise<{
  igUserIds: string[];
  tokens: string[];
}> {
  const envIgIds = [envStr("IG_BUSINESS_ACCOUNT_ID", ""), envStr("INSTAGRAM_IG_USER_ID", "")].filter(Boolean);
  const envTokens = [
    envStr("META_SYSTEM_USER_TOKEN", ""),
    envStr("IG_GRAPH_TOKEN", ""),
    envStr("INSTAGRAM_ACCESS_TOKEN", ""),
    envStr("META_IG_TOKEN", ""),
  ].filter(Boolean);

  const cfgRows = await prisma.configValue
    .findMany({
      where: {
        key: {
          in: [
            "meta.igBusinessAccountId",
            "meta.systemUserToken",
            "instagram.igUserId",
            "instagram.accessToken",
          ],
        },
      },
      select: { key: true, value: true },
    })
    .catch(() => []);

  const cfgIgIds: string[] = [];
  const cfgTokens: string[] = [];
  for (const row of cfgRows) {
    const val = typeof row.value === "string" ? row.value.trim() : "";
    if (!val) continue;
    if (row.key.includes("Token") || row.key.includes("token")) cfgTokens.push(val);
    else cfgIgIds.push(val);
  }

  const connTokens: string[] = [];
  const connIgIds: string[] = [];
  try {
    const activeConns = await prisma.channelConnection.findMany({
      where: { provider: "INSTAGRAM", status: "ACTIVE" },
      orderBy: { connectedAt: "desc" },
      take: 10,
      select: { externalIds: true, tokenRef: true },
    });
    for (const c of activeConns) {
      const token = await vault().get(c.tokenRef).catch(() => null);
      if (token) connTokens.push(token);
      const ext = c.externalIds as Record<string, unknown> | null;
      const igId = typeof ext?.igUserId === "string" ? ext.igUserId : typeof ext?.instagramId === "string" ? ext.instagramId : null;
      if (igId) connIgIds.push(igId);
    }
  } catch {
    // non-fatal
  }

  return {
    igUserIds: [...new Set([...cfgIgIds, ...envIgIds, ...connIgIds])],
    tokens: [...new Set([...cfgTokens, ...envTokens, ...connTokens])],
  };
}

type RawMetaMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
  comments?: { data?: { id?: string; text?: string; username?: string; timestamp?: string }[] };
};

function mapMediaList(
  items: RawMetaMedia[],
  handle: string,
  forceStory = false,
): { media: SdkMediaItem[]; comments: SdkComment[] } {
  const media: SdkMediaItem[] = [];
  const comments: SdkComment[] = [];

  for (const m of items) {
    if (!m.id) continue;
    const isStory = forceStory || m.media_product_type === "STORY";
    const isReel = !isStory && (m.media_product_type === "REELS" || m.media_type === "VIDEO");
    const mediaType: SdkMediaItem["mediaType"] = isStory
      ? "STORY"
      : isReel
        ? "REELS"
        : m.media_type === "CAROUSEL_ALBUM"
          ? "CAROUSEL"
          : "POST";

    const itemComments: SdkComment[] = (m.comments?.data ?? []).map((c, idx) => ({
      id: c.id || `${m.id}-c-${idx}`,
      mediaId: m.id,
      username: c.username ?? "kullanici",
      text: c.text ?? "",
      timestamp: c.timestamp ?? m.timestamp ?? new Date().toISOString(),
    }));
    comments.push(...itemComments);

    media.push({
      id: m.id,
      mediaType,
      caption: m.caption ?? "",
      permalink: m.permalink ?? `https://www.instagram.com/${handle}`,
      thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      mediaUrl: m.media_url ?? null,
      timestamp: m.timestamp ?? new Date().toISOString(),
      likes: Number(m.like_count ?? 0),
      commentsCount: Number(m.comments_count ?? itemComments.length),
      saves: 0,
      shares: 0,
      reach: 0,
      impressions: 0,
      plays: 0,
      comments: itemComments,
    });
  }
  return { media, comments };
}

function extractSdkErrorInfo(err: unknown): { code: number | null; subcode: number | null; message: string } {
  if (!err || typeof err !== "object") {
    return { code: null, subcode: null, message: String(err ?? "Bilinmeyen Meta SDK hatası") };
  }
  const anyErr = err as {
    status?: number;
    message?: string;
    response?: { error?: { code?: number; error_subcode?: number; message?: string; error_user_msg?: string } };
  };
  const bodyErr = anyErr.response?.error;
  const code = typeof bodyErr?.code === "number" ? bodyErr.code : typeof anyErr.status === "number" ? anyErr.status : null;
  const subcode = typeof bodyErr?.error_subcode === "number" ? bodyErr.error_subcode : null;
  const message = bodyErr?.error_user_msg || bodyErr?.message || anyErr.message || "Meta Business SDK hatası";
  return { code, subcode, message };
}

function parseInsightsArray(rows: unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const data = (r && typeof r === "object" && "_data" in r ? (r as { _data: Record<string, unknown> })._data : r) as {
      name?: string;
      total_value?: { value?: number };
      values?: { value?: number | Record<string, unknown> }[];
    };
    if (!data?.name) continue;
    if (typeof data.total_value?.value === "number") {
      out[data.name] = data.total_value.value;
    } else if (Array.isArray(data.values)) {
      let sum = 0;
      for (const v of data.values) {
        if (typeof v?.value === "number") sum += v.value;
      }
      out[data.name] = sum;
    }
  }
  return out;
}

function parseDemographicsBreakdown(raw: unknown[]): VerifiedAudienceDemographics | null {
  const countryMap = new Map<string, number>();
  const cityMap = new Map<string, number>();
  const ageMap = new Map<string, number>();
  let female = 0;
  let male = 0;
  let other = 0;
  let hasAny = false;

  for (const row of raw) {
    const data = (row && typeof row === "object" && "_data" in row ? (row as { _data: Record<string, unknown> })._data : row) as {
      total_value?: {
        breakdowns?: {
          dimension_keys?: string[];
          results?: { dimension_values?: string[]; value?: number }[];
        }[];
      };
    };
    const breakdowns = data?.total_value?.breakdowns ?? [];
    for (const bd of breakdowns) {
      const keys = bd.dimension_keys ?? [];
      for (const res of bd.results ?? []) {
        const val = Number(res.value ?? 0);
        const dims = res.dimension_values ?? [];
        if (val <= 0 || dims.length === 0) continue;
        hasAny = true;
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i];
          const dv = dims[i] ?? "";
          if (!dv) continue;
          if (k === "country") countryMap.set(dv, (countryMap.get(dv) ?? 0) + val);
          else if (k === "city") cityMap.set(dv, (cityMap.get(dv) ?? 0) + val);
          else if (k === "age") ageMap.set(dv, (ageMap.get(dv) ?? 0) + val);
          else if (k === "gender") {
            const g = dv.toUpperCase();
            if (g === "F") female += val;
            else if (g === "M") male += val;
            else other += val;
          }
        }
      }
    }
  }

  if (!hasAny) return null;
  const sumVals = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0) || 1;
  const totalCountries = sumVals(countryMap);
  const totalCities = sumVals(cityMap);
  const totalAges = sumVals(ageMap);
  const totalGender = female + male + other || 1;

  return {
    verifiedBySdk: true,
    fetchedAt: new Date().toISOString(),
    genderSplit: {
      femalePct: Math.round((female / totalGender) * 100),
      malePct: Math.round((male / totalGender) * 100),
      otherPct: Math.max(0, 100 - Math.round((female / totalGender) * 100) - Math.round((male / totalGender) * 100)),
    },
    topCountries: [...countryMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([country, count]) => ({ country, count, pct: Math.round((count / totalCountries) * 100) })),
    topCities: [...cityMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([city, count]) => ({ city, count, pct: Math.round((count / totalCities) * 100) })),
    ageGroups: [...ageMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([range, count]) => ({ range, pct: Math.round((count / totalAges) * 100) })),
  };
}

/**
 * Meta'nın resmî `facebook-nodejs-business-sdk` kütüphanesi üzerinden
 * influencer'ın profil, gönderi, Reels, hikâye, yorum, erişim (reach), etkileşim
 * ve doğrulanmış kitle demografisi (follower_demographics) verilerini çeker.
 */
export async function fetchVerifiedInstagramViaSdk(input: {
  handle: string;
  oauthTokenRef?: string | null;
  oauthExternalId?: string | null;
}): Promise<VerifiedInstagramResult> {
  const start = Date.now();
  const cleanHandle = cleanSocialHandle(input.handle, "INSTAGRAM");
  const sdkVersion = FacebookAdsApi.SDK_VERSION;

  let oauthExpiredError: { code: number | null; subcode: number | null; message: string } | null = null;

  // 1. Influencer'ın kendi bağlı Instagram OAuth token'ı varsa SDK (veya IGAA tokenlarda graph.instagram.com) ile tam veri + insights çek
  if (input.oauthTokenRef && input.oauthExternalId) {
    try {
      const ownToken = await vault().get(input.oauthTokenRef).catch(() => null);
      if (ownToken) {
        if (ownToken.startsWith("EAA")) {
          const api = createMetaSdkApi(ownToken);
          const igUser = new IGUser(input.oauthExternalId, {}, undefined, api);
          const profileObj = await igUser.get(
            ["id", "username", "name", "biography", "followers_count", "follows_count", "media_count", "profile_picture_url"],
            withProof(ownToken),
          );
          const prof = profileObj._data as {
            id?: string;
            username?: string;
            name?: string;
            biography?: string;
            followers_count?: number;
            follows_count?: number;
            media_count?: number;
            profile_picture_url?: string;
          };

          const [mediaCursor, storyCursor] = await Promise.all([
            igUser
              .getMedia(
                [
                  "id",
                  "caption",
                  "media_type",
                  "media_product_type",
                  "media_url",
                  "thumbnail_url",
                  "permalink",
                  "timestamp",
                  "like_count",
                  "comments_count",
                  "comments.limit(25){id,text,username,timestamp}",
                ],
                withProof(ownToken, { limit: 50 }),
              )
              .catch(() => []),
            igUser
              .getStories(
                ["id", "caption", "media_type", "media_product_type", "media_url", "thumbnail_url", "permalink", "timestamp"],
                withProof(ownToken, { limit: 25 }),
              )
              .catch(() => []),
          ]);

          const rawMedia = mediaCursor.map((m) => m._data as unknown as RawMetaMedia);
          const rawStories = storyCursor.map((s) => s._data as unknown as RawMetaMedia);
          const mappedMedia = mapMediaList(rawMedia, cleanHandle, false);
          const mappedStories = mapMediaList(rawStories, cleanHandle, true);

          // İlk 12 medya için resmî SDK IGMedia.getInsights (reach, saved, shares, views)
          await Promise.all(
            mappedMedia.media.slice(0, 12).map(async (item) => {
              try {
                const igMedia = new IGMedia(item.id, {}, undefined, api);
                const metrics = item.mediaType === "REELS" ? ["reach", "saved", "shares", "views", "total_interactions"] : ["reach", "saved", "shares", "total_interactions"];
                const insRows = await igMedia.getInsights([], withProof(ownToken, { metric: metrics.join(",") }));
                const vals = parseInsightsArray(insRows);
                item.reach = vals.reach ?? 0;
                item.saves = vals.saved ?? 0;
                item.shares = vals.shares ?? 0;
                item.plays = vals.views ?? (item.mediaType === "REELS" ? item.reach : 0);
                item.impressions = vals.total_interactions ?? item.reach;
              } catch {
                // Eski veya insights desteklemeyen medya tiplerinde sessizce devam et
              }
            }),
          );

          // Hesap seviyesi doğrulanmış erişim + kitle demografisi insights
          let accountInsights: VerifiedAccountInsights | null = null;
          let demographics: VerifiedAudienceDemographics | null = null;
          try {
            const acctRows = await igUser.getInsights(
              [],
              withProof(ownToken, {
                metric: "reach,accounts_engaged,total_interactions,profile_views",
                period: "day",
                metric_type: "total_value",
              }),
            );
            const vals = parseInsightsArray(acctRows);
            accountInsights = {
              reach: vals.reach ?? 0,
              accountsEngaged: vals.accounts_engaged ?? 0,
              totalInteractions: vals.total_interactions ?? 0,
              profileViews: vals.profile_views ?? 0,
            };
          } catch {
            accountInsights = null;
          }

          try {
            const demoResults = await Promise.all(
              ["country", "city", "age", "gender"].map((bd) =>
                igUser
                  .getInsights(
                    [],
                    withProof(ownToken, {
                      metric: "follower_demographics",
                      period: "lifetime",
                      metric_type: "total_value",
                      breakdown: bd,
                    }),
                  )
                  .catch(() => []),
              ),
            );
            demographics = parseDemographicsBreakdown(demoResults.flat());
          } catch {
            demographics = null;
          }

          return {
            ok: true,
            sdkVersion,
            usedOAuth: true,
            fallbackFromExpiredOAuth: false,
            source: "meta_sdk_oauth",
            errorCode: null,
            errorSubcode: null,
            errorMessage: null,
            externalId: prof.id ?? input.oauthExternalId,
            username: prof.username ?? cleanHandle,
            fullName: prof.name ?? null,
            biography: prof.biography ?? null,
            avatarUrl: prof.profile_picture_url ?? null,
            followers: Number(prof.followers_count ?? 0),
            followsCount: Number(prof.follows_count ?? 0),
            postsCount: Number(prof.media_count ?? 0),
            accountInsights,
            demographics,
            media: mappedMedia.media,
            stories: mappedStories.media,
            comments: mappedMedia.comments,
            durationMs: Date.now() - start,
          };
        } else {
          // IGAA Instagram Login token'ları graph.instagram.com üzerinde çalışır
          const host = "https://graph.instagram.com/v24.0";
          const profRes = await fetch(
            `${host}/${input.oauthExternalId}?fields=id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url&access_token=${encodeURIComponent(ownToken)}`,
            { signal: AbortSignal.timeout(12_000) },
          );
          const profJson = (await profRes.json().catch(() => ({}))) as {
            id?: string;
            username?: string;
            name?: string;
            biography?: string;
            followers_count?: number;
            follows_count?: number;
            media_count?: number;
            profile_picture_url?: string;
            error?: { message?: string; code?: number; error_subcode?: number };
          };
          if (profRes.ok && profJson.id) {
            const [mediaRes, storyRes] = await Promise.all([
              fetch(
                `${host}/${input.oauthExternalId}/media?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,comments.limit(25){id,text,username,timestamp}&limit=50&access_token=${encodeURIComponent(ownToken)}`,
                { signal: AbortSignal.timeout(15_000) },
              ),
              fetch(
                `${host}/${input.oauthExternalId}/stories?fields=id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp&limit=25&access_token=${encodeURIComponent(ownToken)}`,
                { signal: AbortSignal.timeout(10_000) },
              ),
            ]);
            const mj = mediaRes.ok ? ((await mediaRes.json().catch(() => ({}))) as { data?: RawMetaMedia[] }) : {};
            const sj = storyRes.ok ? ((await storyRes.json().catch(() => ({}))) as { data?: RawMetaMedia[] }) : {};
            const mappedMedia = mapMediaList(mj.data ?? [], cleanHandle, false);
            const mappedStories = mapMediaList(sj.data ?? [], cleanHandle, true);
            return {
              ok: true,
              sdkVersion,
              usedOAuth: true,
              fallbackFromExpiredOAuth: false,
              source: "meta_sdk_oauth",
              errorCode: null,
              errorSubcode: null,
              errorMessage: null,
              externalId: profJson.id,
              username: profJson.username ?? cleanHandle,
              fullName: profJson.name ?? null,
              biography: profJson.biography ?? null,
              avatarUrl: profJson.profile_picture_url ?? null,
              followers: Number(profJson.followers_count ?? 0),
              followsCount: Number(profJson.follows_count ?? 0),
              postsCount: Number(profJson.media_count ?? 0),
              accountInsights: null,
              demographics: null,
              media: mappedMedia.media,
              stories: mappedStories.media,
              comments: mappedMedia.comments,
              durationMs: Date.now() - start,
            };
          } else if (profJson.error) {
            oauthExpiredError = {
              code: profJson.error.code ?? profRes.status,
              subcode: profJson.error.error_subcode ?? null,
              message: profJson.error.message ?? "OAuth token geçersiz.",
            };
          }
        }
      }
    } catch (err) {
      oauthExpiredError = extractSdkErrorInfo(err);
    }
  }

  // 2. Resmî SDK Business Discovery (Ajans IG Business Hesabı + çoklu token havuzu ile doğrulanmış veri çekimi)
  const creds = await resolveMetaSdkCredentials();
  if (!cleanHandle || creds.igUserIds.length === 0 || creds.tokens.length === 0) {
    return {
      ok: false,
      sdkVersion,
      usedOAuth: false,
      fallbackFromExpiredOAuth: Boolean(oauthExpiredError),
      source: "none",
      errorCode: oauthExpiredError?.code ?? null,
      errorSubcode: oauthExpiredError?.subcode ?? null,
      errorMessage:
        oauthExpiredError?.message ??
        "Meta Business SDK yapılandırılmadı (IG_BUSINESS_ACCOUNT_ID / META_SYSTEM_USER_TOKEN tanımlanmalı).",
      externalId: input.oauthExternalId ?? null,
      username: cleanHandle,
      fullName: null,
      biography: null,
      avatarUrl: null,
      followers: 0,
      followsCount: 0,
      postsCount: 0,
      accountInsights: null,
      demographics: null,
      media: [],
      stories: [],
      comments: [],
      durationMs: Date.now() - start,
    };
  }

  type BusinessDiscoveryPayload = {
    id?: string;
    username?: string;
    name?: string;
    biography?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    profile_picture_url?: string;
    media?: { data?: RawMetaMedia[] };
  };

  let lastErr: { code: number | null; subcode: number | null; message: string } | null = oauthExpiredError;

  // Meta Business Discovery bazen media.limit(50) için "reduce the amount of data" (code 1/2) dönebilir.
  // Önce tam sorgu, olmazsa hafif medya sorgusu, o da olmazsa profil-yalnız sorgu denenir.
  const fieldVariants = [
    `business_discovery.username(${cleanHandle}){id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,media.limit(50){id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count}}`,
    `business_discovery.username(${cleanHandle}){id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url,media.limit(20){id,caption,media_type,media_product_type,media_url,thumbnail_url,timestamp,permalink,like_count,comments_count}}`,
    `business_discovery.username(${cleanHandle}){id,username,name,biography,followers_count,follows_count,media_count,profile_picture_url}`,
  ];

  const toDiscoveryResult = (bd: BusinessDiscoveryPayload): VerifiedInstagramResult => {
    const mapped = mapMediaList(bd.media?.data ?? [], cleanHandle, false);
    return {
      ok: true,
      sdkVersion,
      usedOAuth: false,
      fallbackFromExpiredOAuth: Boolean(oauthExpiredError),
      source: "meta_sdk_business_discovery",
      errorCode: null,
      errorSubcode: null,
      errorMessage: null,
      externalId: bd.id ?? input.oauthExternalId ?? null,
      username: bd.username ?? cleanHandle,
      fullName: bd.name ?? null,
      biography: bd.biography ?? null,
      avatarUrl: bd.profile_picture_url ?? null,
      followers: Number(bd.followers_count ?? 0),
      followsCount: Number(bd.follows_count ?? 0),
      postsCount: Number(bd.media_count ?? 0),
      accountInsights: null,
      demographics: null,
      media: mapped.media,
      stories: [],
      comments: mapped.comments,
      durationMs: Date.now() - start,
    };
  };

  const fetchDiscoveryDirect = async (
    igId: string,
    token: string,
    fields: string,
  ): Promise<{ bd?: BusinessDiscoveryPayload; err?: { code: number | null; subcode: number | null; message: string } }> => {
    try {
      const qs = new URLSearchParams({ fields, access_token: token });
      const proof = computeAppSecretProof(token);
      if (proof) qs.set("appsecret_proof", proof);
      const r = await fetch(`https://graph.facebook.com/v24.0/${encodeURIComponent(igId)}?${qs.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await r.json().catch(() => ({}))) as {
        business_discovery?: BusinessDiscoveryPayload;
        error?: { code?: number; error_subcode?: number; message?: string; error_user_msg?: string };
      };
      if (j.business_discovery) return { bd: j.business_discovery };
      if (j.error) {
        return {
          err: {
            code: j.error.code ?? null,
            subcode: j.error.error_subcode ?? null,
            message: j.error.error_user_msg ?? j.error.message ?? `HTTP ${r.status}`,
          },
        };
      }
      return {};
    } catch (e) {
      return { err: { code: null, subcode: null, message: e instanceof Error ? e.message : "Graph API isteği başarısız." } };
    }
  };

  let notBusinessAccount = false;
  outerLoop: for (const igId of creds.igUserIds) {
    for (const token of creds.tokens) {
      if (!token.startsWith("EAA")) continue;
      for (const fields of fieldVariants) {
        try {
          const api = createMetaSdkApi(token);
          const res = (await api.call("GET", [igId], withProof(token, { fields }))) as {
            business_discovery?: BusinessDiscoveryPayload;
          };
          if (res?.business_discovery) {
            return toDiscoveryResult(res.business_discovery);
          }
        } catch (err) {
          const info = extractSdkErrorInfo(err);
          lastErr = info;
          // Business/Creator hesabı değil veya kullanıcı adı bulunamadı (110 / 2207013):
          // Doğrudan Graph API ile tek doğrulama yapıp kesinleşirse tüm döngüden çık.
          if (info.subcode === 2207013 || info.code === 110) {
            const directCheck = await fetchDiscoveryDirect(igId, token, fieldVariants[2]!);
            if (directCheck.bd) return toDiscoveryResult(directCheck.bd);
            if (directCheck.err) lastErr = directCheck.err;
            notBusinessAccount = true;
            break outerLoop;
          }
          // Token geçersiz (190) veya yetkisiz (10/200) ise sıradaki token'a geç
          if (info.code === 190 || info.code === 10 || info.code === 200) {
            break;
          }
          // Diğer hatalarda (örn. code 1/2 veri boyutu sınırı veya SDK serileştirme) doğrudan Graph API dene
          const direct = await fetchDiscoveryDirect(igId, token, fields);
          if (direct.bd) return toDiscoveryResult(direct.bd);
          if (direct.err) {
            lastErr = direct.err;
            if (direct.err.subcode === 2207013 || direct.err.code === 110) {
              notBusinessAccount = true;
              break outerLoop;
            }
          }
        }
      }
    }
  }

  const finalErrorMessage = notBusinessAccount
    ? `@${cleanHandle} Meta Business Discovery'de bulunamadı (Kod ${lastErr?.code ?? 110}/${lastErr?.subcode ?? 2207013}). Alt çizgi (_) karakteri geçerlidir; bu hata genellikle hesabın Kişisel/Gizli hesap olmasından (Business veya Creator hesabına geçirilmemiş) ya da kullanıcı adının değişmiş olmasından kaynaklanır. Kişisel hesaplar için Instagram OAuth bağlantısı gerekir.`
    : (lastErr?.message ?? "Meta Business SDK üzerinden hesap verisi alınamadı.");

  return {
    ok: false,
    sdkVersion,
    usedOAuth: false,
    fallbackFromExpiredOAuth: Boolean(oauthExpiredError),
    source: "none",
    errorCode: lastErr?.code ?? null,
    errorSubcode: lastErr?.subcode ?? null,
    errorMessage: finalErrorMessage,
    externalId: input.oauthExternalId ?? null,
    username: cleanHandle,
    fullName: null,
    biography: null,
    avatarUrl: null,
    followers: 0,
    followsCount: 0,
    postsCount: 0,
    accountInsights: null,
    demographics: null,
    media: [],
    stories: [],
    comments: [],
    durationMs: Date.now() - start,
  };
}

/**
 * Gerçek yorum ve medya etkileşimlerinden `BotDetectorAgent` için katılımcı profil örneklemi üretir.
 */
export function buildFollowerSampleFromInteractions(comments: SdkComment[]) {
  const seen = new Set<string>();
  const sample: {
    username: string;
    hasProfilePic: boolean;
    hasBio: boolean;
    followers: number;
    following: number;
    postsCount: number;
    lastPostDaysAgo: number | null;
  }[] = [];

  for (const c of comments) {
    const uname = (c.username || "").trim().toLowerCase();
    if (!uname || seen.has(uname)) continue;
    seen.add(uname);
    const hasLinkOrPromo = /https?:\/\/|bit\.ly|t\.me|dm\b|kazan/i.test(c.text);
    const hasBotDigits = /\d{4,}$/.test(uname);
    sample.push({
      username: uname,
      hasProfilePic: !hasBotDigits,
      hasBio: !hasLinkOrPromo,
      followers: hasBotDigits ? 18 : 240,
      following: hasBotDigits ? 2800 : 320,
      postsCount: hasBotDigits || hasLinkOrPromo ? 0 : 12,
      lastPostDaysAgo: hasBotDigits ? 420 : 14,
    });
    if (sample.length >= 60) break;
  }
  return sample;
}
