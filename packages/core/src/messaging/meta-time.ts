/**
 * Meta webhook zamanı: 10 hane (ve daha kısa) Unix saniye, 13 hane milisaniye.
 * WhatsApp saniye, Instagram/Messenger belgelerde her ikisini de gönderebiliyor.
 */
export function metaEventDate(raw: unknown, fallbackMs = Date.now()): Date {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return new Date(fallbackMs);
  const digits = String(Math.trunc(Math.abs(n))).length;
  return new Date(digits <= 10 ? n * 1000 : n);
}
