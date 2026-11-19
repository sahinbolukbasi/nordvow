import { z } from "zod";

/**
 * Bölüm 7.9: Opt-out kelimeleri.
 * Gelen metin Türkçe yerel ayarla (`tr-TR`, `İ` -> `i`) küçük harfe çevrilip
 * baş/sondaki noktalama işaretlerinden arındırıldıktan sonra tam eşleşirse opt-out tetiklenir.
 */
const OPT_OUT_EXACT_WORDS = new Set(["dur", "iptal", "stop", "abonelikten çık", "abonelikten cik"]);

export function detectOptOutKeyword(rawText: string | null | undefined): {
  isOptOut: boolean;
  matchedKeyword: string | null;
} {
  if (!rawText) return { isOptOut: false, matchedKeyword: null };
  const normalized = rawText
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/^[.,!?;:'"()[\]{}\s]+|[.,!?;:'"()[\]{}\s]+$/g, "")
    .replace(/\s+/g, " ");
  if (OPT_OUT_EXACT_WORDS.has(normalized)) {
    return { isOptOut: true, matchedKeyword: normalized };
  }
  return { isOptOut: false, matchedKeyword: null };
}

export type CannedResponseItem = {
  id: string;
  shortCode: string;
  content: string;
  updatedAt?: string;
};

/**
 * Bölüm 6.1 & 7.5: Hazır yanıt arama sıralaması:
 * - `shortCode` öneki eşleşirse: 1.0
 * - `shortCode` içerirse: 0.5
 * - `content` içerirse: 0.2
 */
export function searchCannedResponses(
  items: CannedResponseItem[],
  rawQuery: string,
): (CannedResponseItem & { score: number })[] {
  const q = rawQuery.replace(/^\//, "").trim().toLocaleLowerCase("tr-TR");
  if (!q) {
    return items.map((item) => ({ ...item, score: 1 }));
  }

  const scored: (CannedResponseItem & { score: number })[] = [];
  for (const item of items) {
    const code = item.shortCode.toLocaleLowerCase("tr-TR");
    const content = item.content.toLocaleLowerCase("tr-TR");
    let score = 0;
    if (code.startsWith(q)) score = 1.0;
    else if (code.includes(q)) score = 0.5;
    else if (content.includes(q)) score = 0.2;
    if (score > 0) scored.push({ ...item, score });
  }

  scored.sort((a, b) => b.score - a.score || a.shortCode.localeCompare(b.shortCode, "tr"));
  return scored;
}

export function interpolateCannedResponse(
  template: string,
  vars: { kisiAd?: string | null; temsilciAd?: string | null; markaAd?: string | null },
): string {
  return template
    .replace(/\{\{\s*kisi\.ad\s*\}\}/gi, vars.kisiAd?.trim() || "Merhaba")
    .replace(/\{\{\s*temsilci\.ad\s*\}\}/gi, vars.temsilciAd?.trim() || "Ekibimiz")
    .replace(/\{\{\s*marka\.ad\s*\}\}/gi, vars.markaAd?.trim() || "NordVow");
}

export type InboxUiStatus = "open" | "pending" | "snoozed" | "resolved";

/**
 * Bölüm 6.2: Konuşma çözümleyici kuralı.
 * - Açık / Beklemede / Ertelenmiş konuşma varsa aynı konuşmayı kullanır (ve `open` durumuna çeker).
 * - Çözülmüş konuşma varsa: `reopenOnNewMessage === true` (varsayılan) ise yeniden açar; `false` ise yeni konuşma açar.
 */
export function resolveConversationAction(input: {
  existingStatus: InboxUiStatus | null;
  reopenOnNewMessage?: boolean;
}): { action: "reuse_open" | "reopen_existing" | "create_new"; nextStatus: "open" } {
  const reopen = input.reopenOnNewMessage ?? true;
  if (!input.existingStatus) {
    return { action: "create_new", nextStatus: "open" };
  }
  if (input.existingStatus === "resolved") {
    return reopen
      ? { action: "reopen_existing", nextStatus: "open" }
      : { action: "create_new", nextStatus: "open" };
  }
  return { action: "reuse_open", nextStatus: "open" };
}

export type ClassifiedMetaError = {
  category: "reauth" | "permanent" | "transient";
  retryable: boolean;
  code: number;
  userMessageTr: string;
};

const PERMANENT_CODES = new Set([10, 100, 200, 551, 131026, 131047, 131051, 131056]);
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 613, 80007, 130429, 131000, 131016]);
const REAUTH_CODES = new Set([102, 190, 463, 467]);

/**
 * Bölüm 8.3 & 18: Meta hata sınıflandırma:
 * - 190 (ve OAuth token hataları) -> `reauth` (kanal `reauth_required`, tekrar deneme yok)
 * - 10 / 100 / 200 / 551 -> `permanent` (kalıcı hata, tekrar deneme yok)
 * - 1 / 2 / 4 / 17 / 32 / 613 / 5xx -> `transient` (geçici hata, backoff ile tekrar denenebilir)
 */
export function classifyMetaSendError(err: {
  code?: number;
  subcode?: number;
  httpStatus?: number;
  message?: string;
}): ClassifiedMetaError {
  const code = Number(err.code ?? 0);
  const httpStatus = Number(err.httpStatus ?? 0);

  if (REAUTH_CODES.has(code) || httpStatus === 401) {
    return {
      category: "reauth",
      retryable: false,
      code: code || 190,
      userMessageTr: "Kanal bağlantısının süresi dolmuş (Kod 190). Lütfen kanalı yeniden yetkilendirin.",
    };
  }

  if (PERMANENT_CODES.has(code)) {
    const msg =
      code === 551
        ? "Kişi şu an mesaj kabul etmiyor veya mesajlaşma penceresi kapalı."
        : code === 10 || code === 200
          ? "Bu işlem için Meta kanal izni veya 24 saat penceresi geçerli değil."
          : "Mesaj alıcıya iletilemedi (geçersiz parametre veya şablon).";
    return {
      category: "permanent",
      retryable: false,
      code,
      userMessageTr: msg,
    };
  }

  if (TRANSIENT_CODES.has(code) || httpStatus === 429 || httpStatus >= 500) {
    return {
      category: "transient",
      retryable: true,
      code: code || httpStatus || 500,
      userMessageTr: "Meta servis yoğunluğu veya hız sınırı nedeniyle gönderim sıraya alındı.",
    };
  }

  if (httpStatus >= 400 && httpStatus < 500) {
    return {
      category: "permanent",
      retryable: false,
      code: code || httpStatus,
      userMessageTr: err.message || "Mesaj gönderilemedi.",
    };
  }

  return {
    category: "transient",
    retryable: true,
    code: code || 500,
    userMessageTr: "Geçici bağlantı hatası; tekrar denenecek.",
  };
}

export const aiSuggestionResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        text: z.string().min(2).max(1000),
        tone: z.enum(["kisa", "detayli", "resmi"]),
      }),
    )
    .min(1)
    .max(3),
  warnings: z.array(z.string().max(240)).optional(),
});

export type AiSuggestionResponse = z.infer<typeof aiSuggestionResponseSchema>;

export function redactPiiForAi(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[gizli-eposta]")
    .replace(/(?:\+?\d[\d\s()-]{8,16}\d)/g, "[gizli-telefon]");
}

export type ParsedWhatsAppMessage = {
  sourceId: string;
  from: string;
  contactName: string | null;
  timestamp: Date;
  kind: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "FILE" | "STICKER" | "LOCATION" | "REACTION" | "UNSUPPORTED";
  text: string | null;
  mediaId?: string;
  mimeType?: string;
  isUnsupported?: boolean;
};

export type ParsedWhatsAppStatus = {
  sourceId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: Date;
  externalError?: string;
};

/**
 * Bölüm 6.5 & 18: WhatsApp webhook `value` ayrıştırıcısı.
 * Yalnızca `tracking_events` içeren payload'ları yok sayar (`ignoredTrackingOnly: true`).
 */
export function parseWhatsAppWebhookValue(value: Record<string, unknown>): {
  ignoredTrackingOnly: boolean;
  phoneNumberId: string | null;
  messages: ParsedWhatsAppMessage[];
  statuses: ParsedWhatsAppStatus[];
} {
  const hasMessages = Array.isArray(value.messages) && value.messages.length > 0;
  const hasStatuses = Array.isArray(value.statuses) && value.statuses.length > 0;
  const hasTracking = Array.isArray(value.tracking_events) && value.tracking_events.length > 0;

  if (hasTracking && !hasMessages && !hasStatuses) {
    return { ignoredTrackingOnly: true, phoneNumberId: null, messages: [], statuses: [] };
  }

  const meta = (value.metadata ?? {}) as Record<string, unknown>;
  const phoneNumberId = meta.phone_number_id ? String(meta.phone_number_id) : null;

  const contactMap = new Map<string, string>();
  if (Array.isArray(value.contacts)) {
    for (const c of value.contacts as Record<string, unknown>[]) {
      const waId = c.wa_id ? String(c.wa_id) : "";
      const profile = (c.profile ?? {}) as Record<string, unknown>;
      if (waId && typeof profile.name === "string") contactMap.set(waId, profile.name);
    }
  }

  const statuses: ParsedWhatsAppStatus[] = [];
  if (Array.isArray(value.statuses)) {
    for (const s of value.statuses as Record<string, unknown>[]) {
      const id = s.id ? String(s.id) : "";
      const st = String(s.status ?? "").toLowerCase();
      if (!id || !["sent", "delivered", "read", "failed"].includes(st)) continue;
      const errs = Array.isArray(s.errors) ? (s.errors as Record<string, unknown>[]) : [];
      const firstErr = errs[0];
      const errText = firstErr
        ? `${firstErr.code ?? ""}: ${firstErr.title ?? firstErr.message ?? "Gönderim hatası"}`.trim()
        : undefined;
      statuses.push({
        sourceId: id,
        status: st as ParsedWhatsAppStatus["status"],
        timestamp: new Date(Number(s.timestamp ?? Date.now() / 1000) * 1000),
        ...(errText ? { externalError: errText } : {}),
      });
    }
  }

  const messages: ParsedWhatsAppMessage[] = [];
  if (Array.isArray(value.messages)) {
    for (const m of value.messages as Record<string, unknown>[]) {
      const id = m.id ? String(m.id) : "";
      const from = m.from ? String(m.from) : "";
      if (!id || !from) continue;
      const ts = new Date(Number(m.timestamp ?? Date.now() / 1000) * 1000);
      const type = String(m.type ?? "text").toLowerCase();
      const contactName = contactMap.get(from) ?? null;

      if (type === "text" || type === "button" || type === "interactive") {
        const textObj = (m.text ?? {}) as Record<string, unknown>;
        const btnObj = (m.button ?? {}) as Record<string, unknown>;
        const interObj = (m.interactive ?? {}) as Record<string, unknown>;
        const br = (interObj.button_reply ?? interObj.list_reply ?? {}) as Record<string, unknown>;
        const body = String(textObj.body ?? btnObj.text ?? br.title ?? "");
        messages.push({ sourceId: id, from, contactName, timestamp: ts, kind: "TEXT", text: body });
      } else if (type === "image" || type === "video" || type === "audio" || type === "document" || type === "sticker") {
        const mediaObj = (m[type] ?? {}) as Record<string, unknown>;
        const kindMap: Record<string, ParsedWhatsAppMessage["kind"]> = {
          image: "IMAGE",
          video: "VIDEO",
          audio: "AUDIO",
          document: "FILE",
          sticker: "STICKER",
        };
        messages.push({
          sourceId: id,
          from,
          contactName,
          timestamp: ts,
          kind: kindMap[type] ?? "FILE",
          text: typeof mediaObj.caption === "string" ? mediaObj.caption : null,
          mediaId: mediaObj.id ? String(mediaObj.id) : undefined,
          mimeType: typeof mediaObj.mime_type === "string" ? mediaObj.mime_type : undefined,
        });
      } else if (type === "location") {
        const loc = (m.location ?? {}) as Record<string, unknown>;
        messages.push({
          sourceId: id,
          from,
          contactName,
          timestamp: ts,
          kind: "LOCATION",
          text: `Konum: ${loc.latitude ?? ""}, ${loc.longitude ?? ""}`,
        });
      } else if (type === "reaction") {
        const react = (m.reaction ?? {}) as Record<string, unknown>;
        messages.push({
          sourceId: id,
          from,
          contactName,
          timestamp: ts,
          kind: "REACTION",
          text: typeof react.emoji === "string" ? react.emoji : "👍",
        });
      } else {
        messages.push({
          sourceId: id,
          from,
          contactName,
          timestamp: ts,
          kind: "UNSUPPORTED",
          text: "Bu mesaj türü desteklenmiyor. Uygulamadan görüntüle.",
          isUnsupported: true,
        });
      }
    }
  }

  return { ignoredTrackingOnly: false, phoneNumberId, messages, statuses };
}

