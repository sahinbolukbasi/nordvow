type BreakerState = { failures: number; openUntil: number };
const breakers = new Map<string, BreakerState>();

/**
 * 3. parti servislerde (fal.ai, Bedrock vb.) ardışık hatalarda devreyi geçici olarak açar,
 * böylece yanıt vermeyen dış API sunucu worker'larını kilitlemez.
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  opts: { threshold?: number; cooldownMs?: number } = {},
): Promise<T> {
  const threshold = opts.threshold ?? 5;
  const cooldownMs = opts.cooldownMs ?? 30_000;
  const cur = breakers.get(name) ?? { failures: 0, openUntil: 0 };
  if (Date.now() < cur.openUntil) {
    throw new Error(`${name} servisi geçici olarak yoğun veya erişilemiyor; lütfen kısa süre sonra tekrar deneyin.`);
  }
  try {
    const res = await fn();
    if (cur.failures > 0) breakers.set(name, { failures: 0, openUntil: 0 });
    return res;
  } catch (e) {
    const nextFailures = cur.failures + 1;
    breakers.set(name, {
      failures: nextFailures,
      openUntil: nextFailures >= threshold ? Date.now() + cooldownMs : 0,
    });
    throw e;
  }
}

