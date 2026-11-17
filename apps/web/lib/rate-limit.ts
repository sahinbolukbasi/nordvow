type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

export function checkRateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  if (buckets.size >= MAX_BUCKETS) {
    for (const [k, v] of buckets) {
      if (v.resetAt <= now || buckets.size >= MAX_BUCKETS) buckets.delete(k);
      else break;
    }
  }
  const cur = buckets.get(key);
  if (!cur || cur.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (cur.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }
  cur.count += 1;
  return { ok: true, retryAfterSec: 0 };
}

export function rateLimitResponse(retryAfterSec: number, message = "Çok fazla istek gönderildi. Lütfen biraz bekleyin.") {
  return Response.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(retryAfterSec), "Cache-Control": "no-store" } },
  );
}

