// Portions adapted from openreply (https://github.com/diwenne/openreply)
// Copyright (c) Anish Raj, Diwen Huang — MIT License. See THIRD_PARTY_NOTICES.md

export type DmDeliveryErrorCategory =
  | "REAUTH_REQUIRED"
  | "RATE_LIMITED"
  | "SKIPPED_NOT_ELIGIBLE"
  | "DEFINITE_REJECTION"
  | "UNCERTAIN";

export type ClassifiedDmDeliveryError = {
  category: DmDeliveryErrorCategory;
  code: number | null;
  subcode: number | null;
  httpStatus: number | null;
  message: string;
  shouldRetry: boolean;
  /** Belirsiz durumda (`true`) tekrar gönderim ASLA yapılmaz. */
  leaveUnconfirmed: boolean;
  templateRejected: boolean;
};

const REAUTH_CODES = new Set([102, 190, 463, 467]);
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80007]);
const DEFINITE_REJECTION_CODES = new Set([10, 100, 200, 551]);
const UNCERTAIN_META_CODES = new Set([1, 2]);
const NOT_ELIGIBLE_SUBCODE = 2534025;

export function extractMetaErrorFields(err: unknown): {
  code: number | null;
  subcode: number | null;
  httpStatus: number | null;
  message: string;
  isTimeoutOrNetwork: boolean;
} {
  if (!err || typeof err !== "object") {
    return {
      code: null,
      subcode: null,
      httpStatus: null,
      message: String(err ?? "Bilinmeyen hata"),
      isTimeoutOrNetwork: false,
    };
  }
  const e = err as Record<string, unknown>;
  const code = typeof e.code === "number" && Number.isFinite(e.code) ? e.code : null;
  const subcode = typeof e.subcode === "number" && Number.isFinite(e.subcode) ? e.subcode : null;
  const httpStatus = typeof e.httpStatus === "number" && Number.isFinite(e.httpStatus) ? e.httpStatus : null;
  const name = typeof e.name === "string" ? e.name : "";
  const message = typeof e.message === "string" ? e.message : String(err);
  const lower = message.toLowerCase();
  const isTimeoutOrNetwork =
    name === "TimeoutError" ||
    name === "AbortError" ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnreset") ||
    lower.includes("fetch failed") ||
    lower.includes("network");

  return { code, subcode, httpStatus, message, isTimeoutOrNetwork };
}

/**
 * Meta şablon reddi kontrolü: yalnızca kod 100 ve mesajda şablon/buton ifadesi varken
 * ve yorum penceresi / kullanıcı bulunamama hatası DEĞİLSE tek seferlik düz metin geri dönüşüne izin verir.
 */
export function isTemplateRejection(err: unknown): boolean {
  const { code, message } = extractMetaErrorFields(err);
  if (code !== 100) return false;
  const lower = message.toLowerCase();
  if (
    lower.includes("outside of allowed window") ||
    lower.includes("invalid for a private reply") ||
    lower.includes("requested user cannot be found")
  ) {
    return false;
  }
  return lower.includes("template") || lower.includes("button") || lower.includes("attachment");
}

/**
 * Meta Graph API gönderim hatalarını kesin red / belirsiz / hız sınırı / yetki iptali olarak sınıflandırır.
 * - Alt kod 2534025 → SKIPPED_NOT_ELIGIBLE (yorum silinmiş veya kısıtlı)
 * - 190 / 401 → REAUTH_REQUIRED
 * - 4 / 17 / 32 / 613 / 429 → RATE_LIMITED (devre kesici + yeniden kuyruk)
 * - 10 / 100 / 200 / 551 veya 4xx → DEFINITE_REJECTION (FAILED, tekrar yok)
 * - 1 / 2 / 5xx / timeout → UNCERTAIN (dmDeliveryUnconfirmed=true kalır, ASLA tekrar gönderilmez)
 */
export function classifyDmDeliveryError(err: unknown): ClassifiedDmDeliveryError {
  const { code, subcode, httpStatus, message, isTimeoutOrNetwork } = extractMetaErrorFields(err);
  const lower = message.toLowerCase();

  if (subcode === NOT_ELIGIBLE_SUBCODE || lower.includes("not eligible for a private reply")) {
    return {
      category: "SKIPPED_NOT_ELIGIBLE",
      code,
      subcode: subcode ?? NOT_ELIGIBLE_SUBCODE,
      httpStatus,
      message,
      shouldRetry: false,
      leaveUnconfirmed: false,
      templateRejected: false,
    };
  }

  if ((code !== null && REAUTH_CODES.has(code)) || httpStatus === 401) {
    return {
      category: "REAUTH_REQUIRED",
      code: code ?? 190,
      subcode,
      httpStatus,
      message,
      shouldRetry: false,
      leaveUnconfirmed: false,
      templateRejected: false,
    };
  }

  if ((code !== null && RATE_LIMIT_CODES.has(code)) || httpStatus === 429) {
    return {
      category: "RATE_LIMITED",
      code: code ?? 429,
      subcode,
      httpStatus,
      message,
      shouldRetry: true,
      leaveUnconfirmed: false,
      templateRejected: false,
    };
  }

  if (isTimeoutOrNetwork || (code !== null && UNCERTAIN_META_CODES.has(code)) || (httpStatus !== null && httpStatus >= 500)) {
    return {
      category: "UNCERTAIN",
      code,
      subcode,
      httpStatus,
      message,
      shouldRetry: false,
      leaveUnconfirmed: true,
      templateRejected: false,
    };
  }

  if (
    (code !== null && DEFINITE_REJECTION_CODES.has(code)) ||
    (httpStatus !== null && httpStatus >= 400 && httpStatus < 500)
  ) {
    return {
      category: "DEFINITE_REJECTION",
      code,
      subcode,
      httpStatus,
      message,
      shouldRetry: false,
      leaveUnconfirmed: false,
      templateRejected: isTemplateRejection(err),
    };
  }

  return {
    category: "UNCERTAIN",
    code,
    subcode,
    httpStatus,
    message,
    shouldRetry: false,
    leaveUnconfirmed: true,
    templateRejected: false,
  };
}

