import { prisma } from "../db";
import { envStr } from "../env";
import { assertSafeOutboundUrl } from "../security/outbound-url";
import { cleanSocialHandle } from "./handle";
import type { SdkMediaItem } from "./meta-business-sdk";

export type PublicInstagramProfile = {
  username: string;
  fullName: string | null;
  biography: string | null;
  avatarUrl: string | null;
  followers: number;
  followsCount: number;
  postsCount: number;
  media: SdkMediaItem[];
};

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  bull: "•",
};

function decodeHtmlEntities(raw: string): string {
  return raw.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) {
      const cp = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
    }
    if (lower.startsWith("#")) {
      const cp = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
    }
    return NAMED_HTML_ENTITIES[lower] ?? full;
  });
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Instagram OpenGraph ve Türkçe/İngilizce kısa sayı gösterimlerini tam sayıya çevirir.
 * Örn: "466K" -> 466000, "686M" -> 686000000, "1.2B" -> 1200000000, "3,837" -> 3837, "1,5 Mn" -> 1500000.
 */
export function parseCompactCount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\u00a0/g, " ");
  if (!cleaned) return null;

  const m = cleaned.match(/^([\d.,]+)\s*(Bin|Mn|Mr|[KMB])?$/i);
  if (!m?.[1]) return null;

  const numToken = m[1];
  const suffix = (m[2] ?? "").toLowerCase();

  let multiplier = 1;
  if (suffix === "k" || suffix === "bin") multiplier = 1_000;
  else if (suffix === "m" || suffix === "mn") multiplier = 1_000_000;
  else if (suffix === "mr") multiplier = 1_000_000_000;
  else if (suffix === "b") {
    // İngilizce OpenGraph etiketlerinde "B" milyar (Billion), Türkçe bağlamda "Bin" (1_000) olabilir.
    // "466 B" gibi boşluklu gösterimlerde Türkçe binlik kısaltması, "1.2B" formatında milyar kabul edilir.
    multiplier = /\s+b$/i.test(cleaned) ? 1_000 : 1_000_000_000;
  }

  let numeric: number;
  if (multiplier > 1) {
    // Çarpan varsa son ayraç ondalıktır ("1,5 Mn" veya "1.2M"), önceki binlik ayraçları temizle.
    const normalized = numToken.replace(/,(?=\d{1,2}$)/, ".").replace(/,(?=\d{3})/g, "");
    numeric = Number.parseFloat(normalized);
  } else if (/^\d{1,3}(?:[.,]\d{3})+$/.test(numToken)) {
    // Binlik ayraçlı tam sayı: "3,837", "1,531", "12.450"
    numeric = Number.parseInt(numToken.replace(/[.,]/g, ""), 10);
  } else {
    numeric = Number.parseFloat(numToken.replace(/,/g, ""));
  }

  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * multiplier);
}

function extractMetaMap(html: string): Map<string, string> {
  const map = new Map<string, string>();
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];

  for (const tag of tags) {
    const keyMatch = tag.match(/\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const valMatch = tag.match(/\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const key = (keyMatch?.[1] ?? keyMatch?.[2] ?? "").trim().toLowerCase();
    const val = valMatch?.[1] ?? valMatch?.[2] ?? "";
    if (!key || !val || map.has(key)) continue;
    map.set(key, decodeHtmlEntities(val));
  }

  return map;
}

function matchCount(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const parsed = parseCompactCount(m[1]);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

/**
 * Herkese açık Instagram profil HTML'indeki OpenGraph/meta etiketlerinden profil verisi çıkarır.
 * Giriş duvarı, 404 veya beklenen kullanıcı adıyla eşleşmeyen sayfalarda `null` döner.
 */
export function parsePublicInstagramHtml(html: string, expectedHandle: string): PublicInstagramProfile | null {
  const cleanHandle = cleanSocialHandle(expectedHandle, "INSTAGRAM");
  if (!html || !cleanHandle) return null;

  const meta = extractMetaMap(html);
  const ogTitle = meta.get("og:title") ?? "";
  const ogDesc = meta.get("og:description") ?? "";
  const desc = meta.get("description") ?? "";
  const ogImage = meta.get("og:image") ?? "";

  const handlePattern = new RegExp(`\\(@${escapeRegExp(cleanHandle)}\\)`, "i");
  const matchesHandle = handlePattern.test(ogTitle) || handlePattern.test(ogDesc) || handlePattern.test(desc);
  if (!matchesHandle) return null;

  const statsSource = `${ogDesc}\n${desc}`;
  const followers = matchCount(statsSource, [
    /([\d.,]+\s*[KMB]?)\s+Followers?\b/i,
    /([\d.,]+\s*(?:Bin|Mn|Mr|[BKM])?)\s+Takipçi\b/i,
  ]);
  const followsCount =
    matchCount(statsSource, [
      /([\d.,]+\s*[KMB]?)\s+Following\b/i,
      /([\d.,]+\s*(?:Bin|Mn|Mr|[BKM])?)\s+Takip(?!çi)\b/i,
    ]) ?? 0;
  const postsCount = matchCount(statsSource, [
    /([\d.,]+\s*[KMB]?)\s+Posts?\b/i,
    /([\d.,]+\s*(?:Bin|Mn|Mr|[BKM])?)\s+Gönderi\b/i,
  ]);

  if (followers == null && postsCount == null) return null;

  let fullName: string | null = null;
  const titleMatch = ogTitle.match(new RegExp(`^(.*?)\\s*\\(@${escapeRegExp(cleanHandle)}\\)`, "i"));
  const rawName = titleMatch?.[1]?.trim() ?? "";
  if (rawName && rawName.toLowerCase() !== cleanHandle.toLowerCase()) {
    fullName = rawName;
  }

  let biography: string | null = null;
  const bioMatch = desc.match(/on Instagram:\s*"([\s\S]*)"\s*$/i) ?? desc.match(/Instagram'da:\s*"([\s\S]*)"\s*$/i);
  if (bioMatch?.[1]) {
    const bio = bioMatch[1].trim();
    if (bio) biography = bio;
  }

  const avatarUrl = ogImage.startsWith("https://") ? ogImage : null;

  return {
    username: cleanHandle,
    fullName,
    biography,
    avatarUrl,
    followers: followers ?? 0,
    followsCount,
    postsCount: postsCount ?? 0,
    media: [],
  };
}

async function fetchInstagramOpenGraph(cleanHandle: string): Promise<PublicInstagramProfile | null> {
  try {
    const res = await fetch(`https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`, {
      headers: {
        "user-agent": "NordvowPlatform/1.0 (+https://nordvow.com)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return parsePublicInstagramHtml(html, cleanHandle);
  } catch {
    return null;
  }
}

async function resolveExternalFallbackConfig(): Promise<{ url: string; apiKey: string }> {
  let url = envStr("INSTAGRAM_PUBLIC_FALLBACK_URL", "").trim();
  let apiKey = envStr("INSTAGRAM_PUBLIC_FALLBACK_API_KEY", "").trim();
  if (url) return { url, apiKey };

  try {
    const rows = await prisma.configValue.findMany({
      where: { key: { in: ["instagram.publicFallbackUrl", "instagram.publicFallbackApiKey"] } },
      select: { key: true, value: true },
    });
    for (const r of rows) {
      const val = typeof r.value === "string" ? r.value.trim() : "";
      if (!val) continue;
      if (r.key === "instagram.publicFallbackUrl" && !url) url = val;
      if (r.key === "instagram.publicFallbackApiKey" && !apiKey) apiKey = val;
    }
  } catch {
    // non-fatal
  }
  return { url, apiKey };
}

type ExternalMediaPayload = {
  id?: string;
  caption?: string;
  mediaType?: string;
  media_type?: string;
  mediaUrl?: string;
  media_url?: string;
  thumbnailUrl?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
  likes?: number;
  like_count?: number;
  commentsCount?: number;
  comments_count?: number;
  saves?: number;
  shares?: number;
  reach?: number;
  impressions?: number;
  plays?: number;
};

type ExternalProfilePayload = {
  username?: string;
  fullName?: string;
  name?: string;
  biography?: string;
  avatarUrl?: string;
  profilePictureUrl?: string;
  profile_picture_url?: string;
  followers?: number;
  followersCount?: number;
  followers_count?: number;
  followsCount?: number;
  follows_count?: number;
  postsCount?: number;
  mediaCount?: number;
  media_count?: number;
  media?: ExternalMediaPayload[];
};

function mapExternalMedia(items: ExternalMediaPayload[] | undefined, handle: string): SdkMediaItem[] {
  if (!Array.isArray(items)) return [];
  const out: SdkMediaItem[] = [];
  for (const m of items) {
    if (!m?.id) continue;
    const rawType = (m.mediaType ?? m.media_type ?? "POST").toUpperCase();
    const mediaType: SdkMediaItem["mediaType"] =
      rawType === "STORY"
        ? "STORY"
        : rawType === "REELS" || rawType === "VIDEO"
          ? "REELS"
          : rawType === "CAROUSEL" || rawType === "CAROUSEL_ALBUM"
            ? "CAROUSEL"
            : "POST";
    out.push({
      id: String(m.id),
      mediaType,
      caption: m.caption ?? "",
      permalink: m.permalink ?? `https://www.instagram.com/${handle}`,
      thumbnailUrl: m.thumbnailUrl ?? m.thumbnail_url ?? m.mediaUrl ?? m.media_url ?? null,
      mediaUrl: m.mediaUrl ?? m.media_url ?? null,
      timestamp: m.timestamp ?? new Date().toISOString(),
      likes: Number(m.likes ?? m.like_count ?? 0),
      commentsCount: Number(m.commentsCount ?? m.comments_count ?? 0),
      saves: Number(m.saves ?? 0),
      shares: Number(m.shares ?? 0),
      reach: Number(m.reach ?? 0),
      impressions: Number(m.impressions ?? 0),
      plays: Number(m.plays ?? 0),
      comments: [],
    });
  }
  return out;
}

async function fetchExternalInstagramFallback(cleanHandle: string): Promise<PublicInstagramProfile | null> {
  try {
    const cfg = await resolveExternalFallbackConfig();
    if (!cfg.url) return null;

    const rawTarget = cfg.url.includes("{handle}")
      ? cfg.url.replace(/\{handle\}/g, encodeURIComponent(cleanHandle))
      : `${cfg.url}${cfg.url.includes("?") ? "&" : "?"}handle=${encodeURIComponent(cleanHandle)}`;

    const safeUrl = await assertSafeOutboundUrl(rawTarget);
    const headers: Record<string, string> = { accept: "application/json" };
    if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

    const res = await fetch(safeUrl.toString(), {
      headers,
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;

    const data = (await res.json().catch(() => null)) as ExternalProfilePayload | null;
    if (!data || typeof data !== "object") return null;

    const rawFollowers = data.followers ?? data.followersCount ?? data.followers_count;
    const rawPosts = data.postsCount ?? data.mediaCount ?? data.media_count;
    const followers = typeof rawFollowers === "number" && Number.isFinite(rawFollowers) && rawFollowers >= 0 ? Math.round(rawFollowers) : null;
    const postsCount = typeof rawPosts === "number" && Number.isFinite(rawPosts) && rawPosts >= 0 ? Math.round(rawPosts) : null;

    if (followers == null && postsCount == null) return null;

    const username = cleanSocialHandle(data.username ?? cleanHandle, "INSTAGRAM") || cleanHandle;
    const followsCountRaw = data.followsCount ?? data.follows_count ?? 0;
    const avatarRaw = data.avatarUrl ?? data.profilePictureUrl ?? data.profile_picture_url ?? null;

    return {
      username,
      fullName: data.fullName ?? data.name ?? null,
      biography: data.biography ?? null,
      avatarUrl: typeof avatarRaw === "string" && avatarRaw.startsWith("https://") ? avatarRaw : null,
      followers: followers ?? 0,
      followsCount: Number.isFinite(Number(followsCountRaw)) ? Math.max(0, Math.round(Number(followsCountRaw))) : 0,
      postsCount: postsCount ?? 0,
      media: mapExternalMedia(data.media, username),
    };
  } catch {
    return null;
  }
}

/**
 * Meta Business Discovery erişemediğinde ikincil mekanizma olarak herkese açık
 * Instagram profil önizlemesini (OpenGraph) ve varsa haricî yedek sağlayıcıyı dener.
 */
export async function fetchPublicInstagramProfile(rawHandle: string): Promise<PublicInstagramProfile | null> {
  const cleanHandle = cleanSocialHandle(rawHandle, "INSTAGRAM");
  if (!cleanHandle) return null;

  const og = await fetchInstagramOpenGraph(cleanHandle);
  if (og) return og;

  return fetchExternalInstagramFallback(cleanHandle);
}
