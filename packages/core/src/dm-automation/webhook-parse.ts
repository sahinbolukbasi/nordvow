// Portions adapted from openreply (https://github.com/diwenne/openreply)
// Copyright (c) Anish Raj, Diwen Huang — MIT License. See THIRD_PARTY_NOTICES.md

export type ParsedInstagramCommentEvent = {
  igAccountId: string;
  commentId: string;
  text: string;
  commenterId: string;
  commenterUsername: string | null;
  mediaId: string | null;
  mediaProductType: string | null;
  originalMediaId: string | null;
  adId: string | null;
  parentId: string | null;
  timestamp: Date;
  isOwnComment: boolean;
};

export type ParsedInstagramMessageEvent = {
  igAccountId: string;
  mid: string;
  senderId: string;
  recipientId: string;
  text: string;
  timestamp: Date;
};

export type ParsedInstagramPostbackEvent = {
  igAccountId: string;
  mid: string | null;
  senderId: string;
  recipientId: string;
  title: string | null;
  payload: string;
  timestamp: Date;
};

export type ParsedInstagramWebhook = {
  supported: boolean;
  comments: ParsedInstagramCommentEvent[];
  messages: ParsedInstagramMessageEvent[];
  postbacks: ParsedInstagramPostbackEvent[];
  ignoredReadCount: number;
  ignoredEchoOrDeletedCount: number;
};

type AnyRec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function toDateFromWebhookTs(raw: unknown): Date {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return new Date(raw > 1e12 ? raw : raw * 1000);
  }
  if (typeof raw === "string") {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && raw.trim() !== "") {
      return new Date(asNum > 1e12 ? asNum : asNum * 1000);
    }
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return new Date();
}

/**
 * Instagram / Meta webhook gövdesinden yorum, DM mesajı ve postback olaylarını ayrıştırır.
 * Kurallar:
 * - Hesabın kendi yorumları (`isOwnComment`) işaretlenir (işlemci atlar).
 * - Echo, silinmiş, desteklenmeyen mesajlar ve `read` olayları mesaj tetiklemez.
 * - Reklam kopyası yorumlarında `original_media_id` korunur.
 */
export function parseInstagramWebhookPayload(payload: unknown): ParsedInstagramWebhook {
  const empty: ParsedInstagramWebhook = {
    supported: false,
    comments: [],
    messages: [],
    postbacks: [],
    ignoredReadCount: 0,
    ignoredEchoOrDeletedCount: 0,
  };

  if (!payload || typeof payload !== "object") return empty;
  const root = payload as AnyRec;
  if (root.object !== "instagram" && root.object !== "page") return empty;

  const result: ParsedInstagramWebhook = {
    supported: true,
    comments: [],
    messages: [],
    postbacks: [],
    ignoredReadCount: 0,
    ignoredEchoOrDeletedCount: 0,
  };

  const entries = Array.isArray(root.entry) ? (root.entry as AnyRec[]) : [];

  for (const entry of entries) {
    const igAccountId = String(entry.id ?? "").trim();
    if (!igAccountId) continue;
    const entryTs = toDateFromWebhookTs(entry.time);

    // 1. Yorum değişiklikleri (changes[].field === "comments")
    const changes = Array.isArray(entry.changes) ? (entry.changes as AnyRec[]) : [];
    for (const ch of changes) {
      if (ch.field === "comments" && ch.value && typeof ch.value === "object") {
        const v = ch.value as AnyRec;
        const commentId = String(v.id ?? v.comment_id ?? "").trim();
        const commenterId = String(v.from?.id ?? "").trim();
        if (!commentId) continue;

        const media = (v.media ?? {}) as AnyRec;
        const mediaId = media.id ? String(media.id) : v.media_id ? String(v.media_id) : null;
        const mediaProductType = media.media_product_type ? String(media.media_product_type) : null;
        const originalMediaId = media.original_media_id ? String(media.original_media_id) : null;
        const adId = media.ad_id ? String(media.ad_id) : null;

        result.comments.push({
          igAccountId,
          commentId,
          text: String(v.text ?? ""),
          commenterId,
          commenterUsername: v.from?.username ? String(v.from.username) : null,
          mediaId,
          mediaProductType,
          originalMediaId,
          adId,
          parentId: v.parent_id ? String(v.parent_id) : null,
          timestamp: v.timestamp ? toDateFromWebhookTs(v.timestamp) : entryTs,
          isOwnComment: Boolean(commenterId && commenterId === igAccountId),
        });
      } else if (ch.field === "messages" && ch.value && typeof ch.value === "object") {
        collectMessagingItem(igAccountId, entryTs, ch.value as AnyRec, result);
      }
    }

    // 2. Doğrudan messaging[] olayları
    const messagingList = Array.isArray(entry.messaging) ? (entry.messaging as AnyRec[]) : [];
    for (const item of messagingList) {
      collectMessagingItem(igAccountId, entryTs, item, result);
    }
  }

  return result;
}

function collectMessagingItem(
  igAccountId: string,
  entryTs: Date,
  item: AnyRec,
  result: ParsedInstagramWebhook,
): void {
  // Okundu bilgisi asla otomasyon mesajı tetiklemez (read-fallback yok)
  if (item.read && !item.message && !item.postback) {
    result.ignoredReadCount += 1;
    return;
  }

  const senderId = String(item.sender?.id ?? "").trim();
  const recipientId = String(item.recipient?.id ?? igAccountId).trim();
  const ts = item.timestamp ? toDateFromWebhookTs(item.timestamp) : entryTs;

  if (item.postback && typeof item.postback === "object") {
    const pb = item.postback as AnyRec;
    const payload = String(pb.payload ?? "").trim();
    if (!senderId || senderId === igAccountId || !payload) return;
    result.postbacks.push({
      igAccountId,
      mid: pb.mid ? String(pb.mid) : null,
      senderId,
      recipientId,
      title: pb.title ? String(pb.title) : null,
      payload,
      timestamp: ts,
    });
    return;
  }

  const msg = item.message as AnyRec | undefined;
  if (!msg) return;

  if (msg.is_echo || msg.is_deleted || msg.is_unsupported || item.message_deletes) {
    result.ignoredEchoOrDeletedCount += 1;
    return;
  }

  if (!senderId || senderId === igAccountId || senderId === recipientId) {
    result.ignoredEchoOrDeletedCount += 1;
    return;
  }

  const mid = String(msg.mid ?? "").trim();
  const text = typeof msg.text === "string" ? msg.text : "";
  if (!mid || !text.trim()) return;

  result.messages.push({
    igAccountId,
    mid,
    senderId,
    recipientId,
    text,
    timestamp: ts,
  });
}

