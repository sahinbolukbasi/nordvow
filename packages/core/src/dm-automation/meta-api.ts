// Portions adapted from openreply (https://github.com/diwenne/openreply)
// Copyright (c) Anish Raj, Diwen Huang — MIT License. See THIRD_PARTY_NOTICES.md

import { envStr } from "../env";
import { MetaApiError } from "../channels/meta-client";

export type IgMediaItem = {
  id: string;
  caption: string | null;
  mediaType: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM" | "REELS";
  mediaProductType: "FEED" | "REELS" | "STORY" | "AD" | string;
  thumbnailUrl: string | null;
  mediaUrl: string | null;
  permalink: string | null;
  timestamp: string;
};

export type IgCommentItem = {
  id: string;
  text: string;
  timestamp: string;
  from: { id: string; username?: string | null } | null;
  repliedByOwner: boolean;
};

export type DmButtonPayload = {
  type: "web_url" | "postback";
  title: string;
  url?: string;
  payload?: string;
};

export interface DmMetaTransport {
  sendPrivateReplyText(input: {
    igUserId: string;
    token: string;
    commentId: string;
    text: string;
  }): Promise<{ messageId: string; recipientId?: string }>;

  sendPrivateReplyTemplate(input: {
    igUserId: string;
    token: string;
    commentId: string;
    text: string;
    buttons: DmButtonPayload[];
  }): Promise<{ messageId: string; recipientId?: string }>;

  sendDirectMessage(input: {
    igUserId: string;
    token: string;
    recipientIgsid: string;
    text: string;
    buttons?: DmButtonPayload[];
  }): Promise<{ messageId: string; recipientId?: string }>;

  replyToCommentPublicly(input: {
    commentId: string;
    token: string;
    message: string;
  }): Promise<{ id: string }>;

  listMedia(input: {
    igUserId: string;
    token: string;
    limit?: number;
    after?: string;
  }): Promise<{ items: IgMediaItem[]; nextCursor: string | null }>;

  listMediaComments(input: {
    mediaId: string;
    igUserId: string;
    token: string;
    limit?: number;
  }): Promise<IgCommentItem[]>;

  subscribeAppFields(input: {
    igUserId: string;
    token: string;
    fields: string[];
  }): Promise<{ success: boolean }>;

  refreshLongLivedToken(input: {
    token: string;
  }): Promise<{ accessToken: string; expiresInSeconds: number }>;

  exchangeInstagramLoginCode(input: {
    code: string;
    redirectUri: string;
  }): Promise<{
    accessToken: string;
    userId: string;
    username?: string;
    accountType?: "BUSINESS" | "CREATOR" | "PERSONAL";
    expiresInSeconds: number;
  }>;
}

let mockSeq = 1000;

function nextMockId(prefix: string) {
  mockSeq += 1;
  return `${prefix}_${Date.now()}_${mockSeq}`;
}

export function getGraphApiVersion(): string {
  return envStr("META_GRAPH_API_VERSION", "v27.0");
}

function getInstagramGraphBase(): string {
  return `https://graph.instagram.com/${getGraphApiVersion()}`;
}

async function graphJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => ({}))) as T & {
    error?: {
      message?: string;
      code?: number;
      error_subcode?: number;
      type?: string;
    };
  };
  if (!res.ok || json.error) {
    const e = json.error;
    throw new MetaApiError(
      e?.message ?? `Instagram Graph HTTP ${res.status}`,
      e?.code ?? res.status,
      e?.error_subcode,
      e?.type,
      res.status,
    );
  }
  return json;
}

export const httpDmMetaTransport: DmMetaTransport = {
  async sendPrivateReplyText({ igUserId, token, commentId, text }) {
    const r = await graphJson<{ message_id: string; recipient_id?: string }>(
      `${getInstagramGraphBase()}/${encodeURIComponent(igUserId)}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipient: { comment_id: commentId },
          message: { text },
        }),
      },
    );
    return { messageId: r.message_id, recipientId: r.recipient_id };
  },

  async sendPrivateReplyTemplate({ igUserId, token, commentId, text, buttons }) {
    const r = await graphJson<{ message_id: string; recipient_id?: string }>(
      `${getInstagramGraphBase()}/${encodeURIComponent(igUserId)}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipient: { comment_id: commentId },
          message: {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: text.slice(0, 640),
                buttons: buttons.slice(0, 3).map((b) =>
                  b.type === "postback"
                    ? { type: "postback", title: b.title.slice(0, 20), payload: b.payload ?? "reveal" }
                    : { type: "web_url", title: b.title.slice(0, 20), url: b.url },
                ),
              },
            },
          },
        }),
      },
    );
    return { messageId: r.message_id, recipientId: r.recipient_id };
  },

  async sendDirectMessage({ igUserId, token, recipientIgsid, text, buttons }) {
    const message =
      buttons && buttons.length > 0
        ? {
            attachment: {
              type: "template",
              payload: {
                template_type: "button",
                text: text.slice(0, 640),
                buttons: buttons.slice(0, 3).map((b) =>
                  b.type === "postback"
                    ? { type: "postback", title: b.title.slice(0, 20), payload: b.payload ?? "reveal" }
                    : { type: "web_url", title: b.title.slice(0, 20), url: b.url },
                ),
              },
            },
          }
        : { text };

    const r = await graphJson<{ message_id: string; recipient_id?: string }>(
      `${getInstagramGraphBase()}/${encodeURIComponent(igUserId)}/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipient: { id: recipientIgsid },
          message,
        }),
      },
    );
    return { messageId: r.message_id, recipientId: r.recipient_id };
  },

  async replyToCommentPublicly({ commentId, token, message }) {
    const r = await graphJson<{ id: string }>(
      `${getInstagramGraphBase()}/${encodeURIComponent(commentId)}/replies`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message }),
      },
    );
    return { id: r.id };
  },

  async listMedia({ igUserId, token, limit = 25, after }) {
    const qs = new URLSearchParams({
      fields: "id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp",
      limit: String(limit),
    });
    if (after) qs.set("after", after);
    const r = await graphJson<{
      data?: {
        id: string;
        caption?: string;
        media_type?: string;
        media_product_type?: string;
        thumbnail_url?: string;
        media_url?: string;
        permalink?: string;
        timestamp?: string;
      }[];
      paging?: { cursors?: { after?: string } };
    }>(`${getInstagramGraphBase()}/${encodeURIComponent(igUserId)}/media?${qs.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    return {
      items: (r.data ?? []).map((m) => ({
        id: m.id,
        caption: m.caption ?? null,
        mediaType: (m.media_product_type === "REELS" ? "REELS" : (m.media_type as IgMediaItem["mediaType"]) ?? "IMAGE"),
        mediaProductType: m.media_product_type ?? "FEED",
        thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
        mediaUrl: m.media_url ?? null,
        permalink: m.permalink ?? null,
        timestamp: m.timestamp ?? new Date().toISOString(),
      })),
      nextCursor: r.paging?.cursors?.after ?? null,
    };
  },

  async listMediaComments({ mediaId, igUserId, token, limit = 30 }) {
    const qs = new URLSearchParams({
      fields: "id,text,timestamp,from,replies{from}",
      limit: String(limit),
    });
    const r = await graphJson<{
      data?: {
        id: string;
        text?: string;
        timestamp?: string;
        from?: { id?: string; username?: string };
        replies?: { data?: { from?: { id?: string } }[] };
      }[];
    }>(`${getInstagramGraphBase()}/${encodeURIComponent(mediaId)}/comments?${qs.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });

    return (r.data ?? []).map((c) => ({
      id: c.id,
      text: c.text ?? "",
      timestamp: c.timestamp ?? new Date().toISOString(),
      from: c.from?.id ? { id: String(c.from.id), username: c.from.username ?? null } : null,
      repliedByOwner: Boolean(c.replies?.data?.some((rep) => rep.from?.id === igUserId)),
    }));
  },

  async subscribeAppFields({ igUserId, token, fields }) {
    const r = await graphJson<{ success?: boolean }>(
      `${getInstagramGraphBase()}/${encodeURIComponent(igUserId)}/subscribed_apps`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subscribed_fields: fields }),
      },
    );
    return { success: r.success ?? true };
  },

  async refreshLongLivedToken({ token }) {
    const qs = new URLSearchParams({
      grant_type: "ig_refresh_token",
      access_token: token,
    });
    const r = await graphJson<{ access_token: string; expires_in?: number }>(
      `https://graph.instagram.com/refresh_access_token?${qs.toString()}`,
      { method: "GET" },
    );
    return {
      accessToken: r.access_token,
      expiresInSeconds: r.expires_in ?? 5_184_000,
    };
  },

  async exchangeInstagramLoginCode({ code, redirectUri }) {
    const form = new URLSearchParams({
      client_id: envStr("INSTAGRAM_APP_ID", ""),
      client_secret: envStr("INSTAGRAM_APP_SECRET", ""),
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    });
    const shortRes = await graphJson<{ access_token: string; user_id: string | number }>(
      "https://api.instagram.com/oauth/access_token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
    );
    const qs = new URLSearchParams({
      grant_type: "ig_exchange_token",
      client_secret: envStr("INSTAGRAM_APP_SECRET", ""),
      access_token: shortRes.access_token,
    });
    const longRes = await graphJson<{ access_token: string; expires_in?: number }>(
      `https://graph.instagram.com/access_token?${qs.toString()}`,
      { method: "GET" },
    );

    let username: string | undefined;
    let accountType: "BUSINESS" | "CREATOR" | "PERSONAL" | undefined;
    try {
      const meQs = new URLSearchParams({
        fields: "id,username,account_type",
        access_token: longRes.access_token,
      });
      const me = await graphJson<{ id?: string; username?: string; account_type?: string }>(
        `https://graph.instagram.com/me?${meQs.toString()}`,
        { method: "GET" },
      );
      if (me.username) username = me.username.replace(/^@/, "");
      const rawType = (me.account_type ?? "").toUpperCase();
      if (rawType === "BUSINESS") accountType = "BUSINESS";
      else if (rawType === "MEDIA_CREATOR" || rawType === "CREATOR") accountType = "CREATOR";
      else if (rawType === "PERSONAL") accountType = "PERSONAL";
    } catch {
      /* profil adı alınamazsa user_id ile devam edilir */
    }

    return {
      accessToken: longRes.access_token,
      userId: String(shortRes.user_id),
      username,
      accountType,
      expiresInSeconds: longRes.expires_in ?? 5_184_000,
    };
  },
};

export const DEMO_IG_MEDIA: IgMediaItem[] = [
  {
    id: "ig_media_reel_sonbahar",
    caption: "Yeni sezon kapsül koleksiyonu yayında! %25 indirim kodunu DM ile almak için yoruma KOD yaz ✨ #reklam",
    mediaType: "REELS",
    mediaProductType: "REELS",
    thumbnailUrl: null,
    mediaUrl: null,
    permalink: "https://www.instagram.com/reel/C_NordvowSonbahar/",
    timestamp: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  },
  {
    id: "ig_media_post_rehber",
    caption: "Creator kiti ve kampanya takvimi PDF bağlantısı için yoruma LİNK yazabilirsin 👇",
    mediaType: "CAROUSEL_ALBUM",
    mediaProductType: "FEED",
    thumbnailUrl: null,
    mediaUrl: null,
    permalink: "https://www.instagram.com/p/C_NordvowRehber/",
    timestamp: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  },
  {
    id: "ig_media_reel_lancman",
    caption: "İstanbul lansman etkinliğimizden kareler! Bilet ve sürpriz kod için yoruma İNDİRİM yaz 🔥",
    mediaType: "REELS",
    mediaProductType: "REELS",
    thumbnailUrl: null,
    mediaUrl: null,
    permalink: "https://www.instagram.com/reel/C_NordvowLancman/",
    timestamp: new Date(Date.now() - 9 * 86_400_000).toISOString(),
  },
  {
    id: "ig_media_post_bakim",
    caption: "Cilt bakım rutinimde en sevdiğim 3 ürün — özel set fiyatı için DETAY yazman yeterli 💌 #işbirliği",
    mediaType: "IMAGE",
    mediaProductType: "FEED",
    thumbnailUrl: null,
    mediaUrl: null,
    permalink: "https://www.instagram.com/p/C_NordvowBakim/",
    timestamp: new Date(Date.now() - 14 * 86_400_000).toISOString(),
  },
];

export const mockDmMetaTransport: DmMetaTransport = {
  async sendPrivateReplyText({ token }) {
    if (token.includes("revoked")) {
      throw new MetaApiError("Error validating access token", 190, 460, "OAuthException", 401);
    }
    return { messageId: nextMockId("ig_pr_txt"), recipientId: "mock_igsid" };
  },
  async sendPrivateReplyTemplate({ token }) {
    if (token.includes("revoked")) {
      throw new MetaApiError("Error validating access token", 190, 460, "OAuthException", 401);
    }
    return { messageId: nextMockId("ig_pr_tpl"), recipientId: "mock_igsid" };
  },
  async sendDirectMessage({ token }) {
    if (token.includes("revoked")) {
      throw new MetaApiError("Error validating access token", 190, 460, "OAuthException", 401);
    }
    return { messageId: nextMockId("ig_dm"), recipientId: "mock_igsid" };
  },
  async replyToCommentPublicly({ token }) {
    if (token.includes("revoked")) {
      throw new MetaApiError("Error validating access token", 190, 460, "OAuthException", 401);
    }
    return { id: nextMockId("ig_rep") };
  },
  async listMedia() {
    return { items: DEMO_IG_MEDIA, nextCursor: null };
  },
  async listMediaComments() {
    return [];
  },
  async subscribeAppFields() {
    return { success: true };
  },
  async refreshLongLivedToken({ token }) {
    return { accessToken: `${token}_refreshed`, expiresInSeconds: 5_184_000 };
  },
  async exchangeInstagramLoginCode({ code }) {
    return {
      accessToken: `ig_mock_long_${code}`,
      userId: "17841400999888",
      expiresInSeconds: 5_184_000,
    };
  },
};

let dmMetaTransportOverride: DmMetaTransport | null = null;

export function dmMetaTransport(): DmMetaTransport {
  if (dmMetaTransportOverride) return dmMetaTransportOverride;
  return envStr("META_API_MODE", "mock") === "http" ? httpDmMetaTransport : mockDmMetaTransport;
}

export function setDmMetaTransport(transport: DmMetaTransport | null): void {
  dmMetaTransportOverride = transport;
}

