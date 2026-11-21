// Portions adapted from openreply (https://github.com/diwenne/openreply)
// Copyright (c) Anish Raj, Diwen Huang — MIT License. See THIRD_PARTY_NOTICES.md

import { createHash, createHmac, randomBytes } from "node:crypto";
import { envStr, requireEnv } from "../env";

const RECIPIENT_TOKEN_RE = /^[A-Za-z0-9_-]{22}$/;
const BOT_UA_RE =
  /bot|crawler|spider|facebookexternalhit|facebot|instagram|whatsapp|slackbot|discordbot|telegrambot|twitterbot|linkedinbot|preview|curl|wget|python-requests|headless/i;

export const DEFAULT_DM_FOOTER =
  "Bu mesajı yorumundaki talebin üzerine gönderdik. Bir daha mesaj almak istemezsen DUR yaz.";

/**
 * Üretimde DM_TRACKING_SECRET zorunludur (zayıf varsayılan tuz asla kullanılmaz).
 */
export function requireDmTrackingSecret(): string {
  return requireEnv("DM_TRACKING_SECRET").trim();
}

export function getDmTrackingSecret(secretOverride?: string): string {
  if (secretOverride !== undefined) {
    const trimmed = secretOverride.trim();
    if (!trimmed) throw new Error("DM_TRACKING_SECRET boş olamaz.");
    return trimmed;
  }
  const envSecret = envStr("DM_TRACKING_SECRET", "").trim();
  if (envSecret) return envSecret;

  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("DM_TRACKING_SECRET ortam değişkeni üretimde zorunludur.");
  }
  const authFallback = envStr("AUTH_SECRET", "").trim();
  if (authFallback) return authFallback;
  throw new Error("DM_TRACKING_SECRET ortam değişkeni eksik.");
}

/** Alıcı IGSID bilgisini linkte gizleyen 22 karakterlik HMAC token'ı üretir. */
export function createRecipientToken(igsid: string, secretOverride?: string): string {
  const secret = getDmTrackingSecret(secretOverride);
  return createHmac("sha256", secret).update(`recipient:${igsid}`).digest("base64url").slice(0, 22);
}

export function isValidRecipientToken(token: string | null | undefined): boolean {
  return Boolean(token && RECIPIENT_TOKEN_RE.test(token));
}

/** KVKK uyumu: Ham IP saklanmaz, yalnızca tuzlu SHA-256 özeti tutulur. */
export function hashClickIp(ip: string | null | undefined, secretOverride?: string): string | null {
  const cleaned = (ip ?? "").trim();
  if (!cleaned) return null;
  const secret = getDmTrackingSecret(secretOverride);
  return createHash("sha256").update(`${secret}:ip:${cleaned}`).digest("hex").slice(0, 32);
}

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return BOT_UA_RE.test(userAgent);
}

/** Tahmin edilemeyen URL-güvenli takip slug'ı üretir (en az 8 karakter). */
export function generateTrackingSlug(length = 9): string {
  const raw = randomBytes(Math.max(8, length)).toString("base64url").replace(/[^A-Za-z0-9]/g, "");
  return raw.slice(0, Math.max(8, length)) || randomBytes(6).toString("hex");
}

/**
 * Hedef URL'yi doğrular (`https:` zorunlu, `javascript:`/`data:` yasak) ve
 * mevcut UTM parametrelerini ezmeden kampanya UTM etiketlerini ekler.
 */
export function appendCampaignUtm(
  rawUrl: string,
  campaignSlug: string,
  campaignId: string,
): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Geçersiz hedef URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Hedef URL yalnızca https:// protokolünü kullanabilir.");
  }
  if (!parsed.searchParams.has("utm_source")) parsed.searchParams.set("utm_source", "instagram");
  if (!parsed.searchParams.has("utm_medium")) parsed.searchParams.set("utm_medium", "dm");
  if (!parsed.searchParams.has("utm_campaign")) {
    parsed.searchParams.set("utm_campaign", campaignSlug || campaignId);
  }
  if (!parsed.searchParams.has("utm_content")) parsed.searchParams.set("utm_content", campaignId);
  return parsed.toString();
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https:\/\/[^\s<>"{}|\\^`[\]]+/i);
  return match ? match[0] : null;
}

export function replaceUrlWithTrackedPlaceholder(text: string): string {
  const url = extractFirstUrl(text);
  if (!url) return text;
  return text.replace(url, "{link}");
}

export function buildTrackedShortUrl(slug: string, recipientToken?: string | null): string {
  const base = envStr("DM_SHORT_LINK_BASE", `${envStr("NEXT_PUBLIC_APP_URL", "https://nordvow.com").replace(/\/$/, "")}/r`).replace(/\/$/, "");
  const url = `${base}/${encodeURIComponent(slug)}`;
  if (recipientToken && isValidRecipientToken(recipientToken)) {
    return `${url}?r=${encodeURIComponent(recipientToken)}`;
  }
  return url;
}

/**
 * DM metnini `{username}`, `{link}` ve `{kupon}` değişkenleriyle derler;
 * çıplak URL içeriyorsa ilk URL'yi takip linkiyle değiştirir ve zorunlu DUR satırını ekler.
 */
export function formatDmMessage(input: {
  dmText: string;
  dmFooter?: string | null;
  username?: string | null;
  linkUrl?: string | null;
  couponCode?: string | null;
}): string {
  const usernameDisplay = input.username?.trim()
    ? input.username.trim().replace(/^@/, "")
    : "merhaba";
  const linkDisplay = input.linkUrl?.trim() ?? "";
  const couponDisplay = input.couponCode?.trim() ?? "";

  let body = input.dmText.trim();
  if (linkDisplay && !body.includes("{link}") && extractFirstUrl(body)) {
    body = replaceUrlWithTrackedPlaceholder(body);
  }

  body = body
    .replace(/\{username\}/gi, usernameDisplay)
    .replace(/\{link\}/gi, linkDisplay)
    .replace(/\{kupon\}/gi, couponDisplay)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const footer = (input.dmFooter?.trim() || DEFAULT_DM_FOOTER).trim();
  if (!footer) return body;
  if (body.includes(footer)) return body;
  return `${body}\n\n${footer}`.trim();
}

