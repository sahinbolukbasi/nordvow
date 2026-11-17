import { createHash, randomBytes } from "node:crypto";
import { envStr } from "../env";
import { redactSecrets } from "./crypto";
import { TikTokApiError, isTokenInvalidError } from "./errors";

export const TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/";
export const TIKTOK_API_BASE = "https://open.tiktokapis.com/v2";

export const TIKTOK_ALL_SCOPES = [
  "user.info.basic",
  "user.info.profile",
  "user.info.stats",
  "video.list",
  "video.publish",
  "video.upload",
] as const;

export type TikTokScope = (typeof TIKTOK_ALL_SCOPES)[number];

export type TikTokTokenResponse = {
  access_token: string;
  refresh_token: string;
  open_id: string;
  scope: string;
  expires_in: number;
  refresh_expires_in: number;
  token_type?: string;
};

export type TikTokUserProfile = {
  open_id: string;
  union_id?: string;
  avatar_url?: string;
  display_name?: string;
  username?: string;
  bio_description?: string;
  profile_deep_link?: string;
  is_verified?: boolean;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
};

export type TikTokVideoItem = {
  id: string;
  title?: string;
  video_description?: string;
  create_time?: number;
  cover_image_url?: string;
  share_url?: string;
  embed_link?: string;
  duration?: number;
  width?: number;
  height?: number;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

export type TikTokCreatorInfoRaw = {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options?: string[];
  stitch_disabled?: boolean;
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

export type TikTokPublishInitPayload = {
  post_info: {
    title?: string;
    privacy_level: string;
    disable_duet?: boolean;
    disable_comment?: boolean;
    disable_stitch?: boolean;
    video_cover_timestamp_ms?: number;
    brand_content_toggle?: boolean;
    brand_organic_toggle?: boolean;
  };
  source_info:
    | {
        source: "FILE_UPLOAD";
        video_size: number;
        chunk_size: number;
        total_chunk_count: number;
      }
    | {
        source: "PULL_FROM_URL";
        video_url: string;
      };
};

export type TikTokPublishInitResult = {
  publish_id: string;
  upload_url?: string;
};

export type TikTokPublishStatusResult = {
  status: "PROCESSING_UPLOAD" | "PROCESSING_DOWNLOAD" | "SEND_TO_USER_INBOX" | "PUBLISH_COMPLETE" | "FAILED";
  fail_reason?: string;
  publicaly_available_post_id?: number[] | string[];
  uploaded_bytes?: number;
};

export type FetchLike = typeof fetch;

let customFetch: FetchLike | undefined;
export function setTikTokFetch(fn: FetchLike | undefined) {
  customFetch = fn;
}
function getFetch(): FetchLike {
  return customFetch ?? fetch;
}

export function getTikTokConfig() {
  return {
    clientKey: envStr("TIKTOK_CLIENT_KEY", ""),
    clientSecret: envStr("TIKTOK_CLIENT_SECRET", ""),
    redirectUri: envStr("TIKTOK_REDIRECT_URI", ""),
    audited: envStr("TIKTOK_APP_AUDITED", "false") === "true",
  };
}

/** PKCE S256 üretir (web OAuth için önerilen ek güvenlik). */
export function generatePkcePair(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

/** TikTok Login Kit v2 Authorize URL'sini oluşturur. */
export function buildAuthorizeUrl(params: {
  clientKey: string;
  redirectUri: string;
  state: string;
  scopes?: readonly string[];
  codeChallenge?: string;
}): string {
  const q = new URLSearchParams({
    client_key: params.clientKey,
    scope: (params.scopes ?? TIKTOK_ALL_SCOPES).join(","),
    response_type: "code",
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  if (params.codeChallenge) {
    q.set("code_challenge", params.codeChallenge);
    q.set("code_challenge_method", "S256");
  }
  return `${TIKTOK_AUTH_URL}?${q.toString()}`;
}

function logTikTok(level: "info" | "warn" | "error", msg: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "test" && level === "info") return;
  const safe = meta ? redactSecrets(meta) : undefined;
  const line = safe ? `[TikTok] ${msg} ${JSON.stringify(safe)}` : `[TikTok] ${msg}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffWithJitterMs(attempt: number, baseMs = 400): number {
  const exp = baseMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * Math.max(100, exp * 0.3));
  return Math.min(15_000, exp + jitter);
}

type TikTokEnvelope<T> = {
  data?: T;
  error?: {
    code?: string;
    message?: string;
    log_id?: string;
  };
  // OAuth endpoint'leri düz JSON döner
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  scope?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  error_description?: string;
};

/**
 * TikTok API HTTP çağrısı: 429/503 için exponential backoff + jitter uygular,
 * hata kodlarını TikTokApiError'a çevirir, loglarda token/secret maskeler.
 */
export async function tiktokFetchJson<T>(
  url: string,
  init: RequestInit,
  opts?: { maxRetries?: number; baseDelayMs?: number },
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const baseDelayMs = opts?.baseDelayMs ?? 400;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await getFetch()(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(20_000),
    });

    const json = (await res.json().catch(() => ({}))) as TikTokEnvelope<T> & { error?: string | { code?: string; message?: string; log_id?: string } };

    // OAuth endpoint hata formatı: { error: "invalid_grant", error_description: "..." }
    if (typeof json.error === "string") {
      const code = json.error;
      const err = new TikTokApiError({
        code,
        message: json.error_description ?? code,
        httpStatus: res.status,
      });
      if (err.retryable && attempt < maxRetries) {
        const delay = backoffWithJitterMs(attempt, baseDelayMs);
        logTikTok("warn", "Retryable OAuth error", { url, code, attempt, delay });
        await sleep(delay);
        continue;
      }
      throw err;
    }

    const apiErr = json.error;
    if (apiErr && apiErr.code && apiErr.code !== "ok") {
      const err = new TikTokApiError({
        code: apiErr.code,
        message: apiErr.message,
        httpStatus: res.status,
        logId: apiErr.log_id,
      });
      if (err.retryable && attempt < maxRetries) {
        const delay = backoffWithJitterMs(attempt, baseDelayMs);
        logTikTok("warn", "Retryable TikTok API error", { url, code: apiErr.code, logId: apiErr.log_id, attempt, delay });
        await sleep(delay);
        continue;
      }
      throw err;
    }

    if (!res.ok) {
      const err = new TikTokApiError({
        code: res.status === 429 ? "rate_limit_exceeded" : "internal_error",
        message: `HTTP ${res.status}`,
        httpStatus: res.status,
      });
      if (err.retryable && attempt < maxRetries) {
        const delay = backoffWithJitterMs(attempt, baseDelayMs);
        logTikTok("warn", "Retryable HTTP status", { url, status: res.status, attempt, delay });
        await sleep(delay);
        continue;
      }
      throw err;
    }

    return (json.data !== undefined ? json.data : json) as T;
  }

  throw new TikTokApiError({ code: "internal_error", message: "Maksimum yeniden deneme aşıldı.", httpStatus: 503 });
}

/** Token geçersizse bir kez yenileyip isteği tekrarlar. */
export async function withTokenRefreshRetry<T>(
  accessToken: string,
  fn: (token: string) => Promise<T>,
  onTokenInvalid?: () => Promise<string | null>,
): Promise<T> {
  try {
    return await fn(accessToken);
  } catch (err) {
    if (isTokenInvalidError(err) && onTokenInvalid) {
      const freshToken = await onTokenInvalid();
      if (freshToken) {
        return await fn(freshToken);
      }
    }
    throw err;
  }
}

export async function exchangeOAuthCode(params: {
  clientKey: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<TikTokTokenResponse> {
  const body = new URLSearchParams({
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: "authorization_code",
    redirect_uri: params.redirectUri,
  });
  if (params.codeVerifier) body.set("code_verifier", params.codeVerifier);

  const res = await tiktokFetchJson<TikTokTokenResponse>(`${TIKTOK_API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.access_token || !res.refresh_token) {
    throw new TikTokApiError({ code: "internal_error", message: "TikTok token yanıtı eksik.", httpStatus: 502 });
  }
  logTikTok("info", "OAuth code exchanged", { open_id: res.open_id, access_token: res.access_token });
  return res;
}

export async function refreshOAuthToken(params: {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TikTokTokenResponse> {
  const body = new URLSearchParams({
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
  });
  const res = await tiktokFetchJson<TikTokTokenResponse>(`${TIKTOK_API_BASE}/oauth/token/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.access_token) {
    throw new TikTokApiError({ code: "access_token_invalid", message: "Token yenilenemedi.", httpStatus: 401 });
  }
  logTikTok("info", "OAuth token refreshed", { open_id: res.open_id, access_token: res.access_token });
  return res;
}

export async function revokeOAuthToken(params: {
  clientKey: string;
  clientSecret: string;
  token: string;
}): Promise<void> {
  const body = new URLSearchParams({
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    token: params.token,
  });
  await tiktokFetchJson<Record<string, unknown>>(`${TIKTOK_API_BASE}/oauth/revoke/`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  logTikTok("info", "OAuth token revoked", { token: params.token });
}

const USER_FIELDS = [
  "open_id",
  "union_id",
  "avatar_url",
  "display_name",
  "username",
  "bio_description",
  "profile_deep_link",
  "is_verified",
  "follower_count",
  "following_count",
  "likes_count",
  "video_count",
].join(",");

export async function getUserInfo(accessToken: string): Promise<TikTokUserProfile> {
  const data = await tiktokFetchJson<{ user?: TikTokUserProfile }>(`${TIKTOK_API_BASE}/user/info/?fields=${USER_FIELDS}`, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!data.user) {
    throw new TikTokApiError({ code: "internal_error", message: "TikTok kullanıcı profili boş döndü.", httpStatus: 502 });
  }
  return data.user;
}

const VIDEO_FIELDS = [
  "id",
  "title",
  "video_description",
  "create_time",
  "cover_image_url",
  "share_url",
  "embed_link",
  "duration",
  "width",
  "height",
  "view_count",
  "like_count",
  "comment_count",
  "share_count",
].join(",");

export async function listAllVideos(accessToken: string, maxPages = 25): Promise<TikTokVideoItem[]> {
  const all: TikTokVideoItem[] = [];
  let cursor: number | undefined;
  let hasMore = true;

  for (let page = 0; page < maxPages && hasMore; page++) {
    const body: { max_count: number; cursor?: number } = { max_count: 20 };
    if (cursor !== undefined) body.cursor = cursor;

    const data = await tiktokFetchJson<{ videos?: TikTokVideoItem[]; cursor?: number; has_more?: boolean }>(
      `${TIKTOK_API_BASE}/video/list/?fields=${VIDEO_FIELDS}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(body),
      },
    );

    if (data.videos?.length) {
      all.push(...data.videos);
    }
    hasMore = Boolean(data.has_more);
    cursor = data.cursor;
    if (hasMore && cursor === undefined) break;
  }

  return all;
}

export async function queryVideosByIds(accessToken: string, videoIds: string[]): Promise<TikTokVideoItem[]> {
  const out: TikTokVideoItem[] = [];
  for (let i = 0; i < videoIds.length; i += 20) {
    const batch = videoIds.slice(i, i + 20);
    const data = await tiktokFetchJson<{ videos?: TikTokVideoItem[] }>(
      `${TIKTOK_API_BASE}/video/query/?fields=${VIDEO_FIELDS}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ filters: { video_ids: batch } }),
      },
    );
    if (data.videos?.length) out.push(...data.videos);
  }
  return out;
}

export async function queryCreatorInfo(accessToken: string): Promise<TikTokCreatorInfoRaw> {
  return tiktokFetchJson<TikTokCreatorInfoRaw>(`${TIKTOK_API_BASE}/post/publish/creator_info/query/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: "{}",
  });
}

export async function initVideoPublish(accessToken: string, payload: TikTokPublishInitPayload): Promise<TikTokPublishInitResult> {
  return tiktokFetchJson<TikTokPublishInitResult>(`${TIKTOK_API_BASE}/post/publish/video/init/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
}

export async function initInboxVideoPublish(
  accessToken: string,
  sourceInfo: TikTokPublishInitPayload["source_info"],
): Promise<TikTokPublishInitResult> {
  return tiktokFetchJson<TikTokPublishInitResult>(`${TIKTOK_API_BASE}/post/publish/inbox/video/init/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ source_info: sourceInfo }),
  });
}

/** FILE_UPLOAD modunda upload_url'e parçalı PUT yüklemesi yapar (Content-Range zorunlu). */
export async function uploadVideoChunks(params: {
  uploadUrl: string;
  buffer: Buffer;
  chunkSize: number;
  mimeType?: string;
}): Promise<void> {
  const total = params.buffer.length;
  const mime = params.mimeType ?? "video/mp4";
  const chunkSize = Math.max(1, params.chunkSize);

  for (let start = 0; start < total; start += chunkSize) {
    const endExclusive = Math.min(total, start + chunkSize);
    const chunk = params.buffer.subarray(start, endExclusive);
    const res = await getFetch()(params.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": mime,
        "content-length": String(chunk.length),
        "content-range": `bytes ${start}-${endExclusive - 1}/${total}`,
      },
      body: new Uint8Array(chunk),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok && res.status !== 206 && res.status !== 201) {
      throw new TikTokApiError({
        code: "internal_error",
        message: `TikTok chunk yükleme hatası (HTTP ${res.status})`,
        httpStatus: res.status,
      });
    }
  }
}

export async function fetchPublishStatus(accessToken: string, publishId: string): Promise<TikTokPublishStatusResult> {
  return tiktokFetchJson<TikTokPublishStatusResult>(`${TIKTOK_API_BASE}/post/publish/status/fetch/`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
}
