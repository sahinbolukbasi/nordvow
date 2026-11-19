// Portions adapted from openreply (https://github.com/diwenne/openreply)
// Copyright (c) Anish Raj, Diwen Huang — MIT License. See THIRD_PARTY_NOTICES.md

import { randomUUID } from "node:crypto";
import { envInt } from "../env";

export const DEFAULT_HOURLY_CAP = 700; // Meta limiti 750; %7 emniyet payı
export const DEFAULT_PER_SECOND_CAP = 5;
export const HOURLY_WINDOW_MS = 3600_000;
export const SECOND_WINDOW_MS = 1000;
export const DEFAULT_BREAKER_COOLDOWN_MS = 15 * 60_000;

/**
 * Redis Sorted Set kayan pencere Lua betiği.
 * Sabit penceredeki 2x patlama riskini ortadan kaldırır; kontrol + ekleme atomiktir.
 * KEYS[1] = pencere anahtarı (rate:dm:{igAccountId})
 * ARGV[1] = nowMs, ARGV[2] = windowMs, ARGV[3] = maxCount, ARGV[4] = memberId
 */
export const SLIDING_WINDOW_LUA = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local member = ARGV[4]
local cutoff = now - window
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", cutoff)
local current = tonumber(redis.call("ZCARD", KEYS[1]))
if current >= max then
  return {0, current, 0}
end
redis.call("ZADD", KEYS[1], now, member)
redis.call("PEXPIRE", KEYS[1], window)
return {1, current + 1, max - current - 1}
`;

export type RedisSlidingClient = {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<[number, number, number]>;
  zrem(key: string, member: string): Promise<number>;
};

export type ReserveSlotResult =
  | {
      allowed: true;
      slotId: string;
      hourlyUsed: number;
      hourlyRemaining: number;
    }
  | {
      allowed: false;
      reason: "RATE_LIMIT" | "PER_SECOND_LIMIT" | "CIRCUIT_OPEN";
      hourlyUsed: number;
      hourlyRemaining: number;
      retryAfterMs: number;
    };

type BreakerState = { openUntilMs: number; reason: string | null };

const memoryHourly = new Map<string, { id: string; ts: number }[]>();
const memorySecond = new Map<string, { id: string; ts: number }[]>();
const memoryBreakers = new Map<string, BreakerState>();

let redisClientOverride: RedisSlidingClient | null = null;

export function setRateLimitRedisClient(client: RedisSlidingClient | null): void {
  redisClientOverride = client;
}

export function resetRateLimiterMemoryForTests(): void {
  memoryHourly.clear();
  memorySecond.clear();
  memoryBreakers.clear();
}

export function getHourlyRateLimitCap(): number {
  return Math.max(1, envInt("DM_PRIVATE_REPLY_HOURLY_CAP", DEFAULT_HOURLY_CAP));
}

export function getPerSecondRateLimitCap(): number {
  return Math.max(1, envInt("DM_MAX_SENDS_PER_SECOND", DEFAULT_PER_SECOND_CAP));
}

function pruneWindow(entries: { id: string; ts: number }[], cutoffMs: number) {
  let idx = 0;
  while (idx < entries.length && entries[idx]!.ts <= cutoffMs) {
    idx++;
  }
  if (idx > 0) entries.splice(0, idx);
}

/** Devre kesiciyi belirtilen süre boyunca açar (Meta 429 / 4 / 17 / 32 / 613). */
export function openCircuitBreaker(
  igAccountId: string,
  durationMs = envInt("DM_BREAKER_COOLDOWN_MS", DEFAULT_BREAKER_COOLDOWN_MS),
  reason = "Instagram hız sınırı nedeniyle geçici duraklatma",
  nowMs = Date.now(),
): BreakerState {
  const next: BreakerState = { openUntilMs: nowMs + Math.max(1000, durationMs), reason };
  memoryBreakers.set(igAccountId, next);
  return next;
}

export function clearCircuitBreaker(igAccountId: string): void {
  memoryBreakers.delete(igAccountId);
}

export function getCircuitBreakerState(
  igAccountId: string,
  nowMs = Date.now(),
): { open: boolean; openUntilMs: number | null; remainingMs: number; reason: string | null } {
  const st = memoryBreakers.get(igAccountId);
  if (!st || st.openUntilMs <= nowMs) {
    if (st) memoryBreakers.delete(igAccountId);
    return { open: false, openUntilMs: null, remainingMs: 0, reason: null };
  }
  return {
    open: true,
    openUntilMs: st.openUntilMs,
    remainingMs: st.openUntilMs - nowMs,
    reason: st.reason,
  };
}

/**
 * Kayan pencere hız sınırlayıcıdan atomik olarak 1 gönderim slotu rezerve eder.
 * Saatlik tavan (varsayılan 700) ve saniyelik yumuşak tavan (varsayılan 5) kontrol edilir.
 */
export async function reserveDMSlot(
  igAccountId: string,
  opts: {
    nowMs?: number;
    hourlyCap?: number;
    perSecondCap?: number;
    enforcePerSecond?: boolean;
  } = {},
): Promise<ReserveSlotResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const hourlyCap = opts.hourlyCap ?? getHourlyRateLimitCap();
  const perSecondCap = opts.perSecondCap ?? getPerSecondRateLimitCap();
  const enforcePerSecond = opts.enforcePerSecond ?? true;

  const breaker = getCircuitBreakerState(igAccountId, nowMs);
  if (breaker.open) {
    const used = getHourlyUsageCount(igAccountId, nowMs);
    return {
      allowed: false,
      reason: "CIRCUIT_OPEN",
      hourlyUsed: used,
      hourlyRemaining: Math.max(0, hourlyCap - used),
      retryAfterMs: breaker.remainingMs,
    };
  }

  const slotId = `${nowMs}:${randomUUID().slice(0, 8)}`;

  if (redisClientOverride) {
    if (enforcePerSecond) {
      const [secOk] = await redisClientOverride.eval(
        SLIDING_WINDOW_LUA,
        1,
        `rate:dm:sec:${igAccountId}`,
        nowMs,
        SECOND_WINDOW_MS,
        perSecondCap,
        slotId,
      );
      if (!secOk) {
        const used = getHourlyUsageCount(igAccountId, nowMs);
        return {
          allowed: false,
          reason: "PER_SECOND_LIMIT",
          hourlyUsed: used,
          hourlyRemaining: Math.max(0, hourlyCap - used),
          retryAfterMs: 1000,
        };
      }
    }
    const [ok, used, remaining] = await redisClientOverride.eval(
      SLIDING_WINDOW_LUA,
      1,
      `rate:dm:${igAccountId}`,
      nowMs,
      HOURLY_WINDOW_MS,
      hourlyCap,
      slotId,
    );
    if (!ok) {
      if (enforcePerSecond) {
        await redisClientOverride.zrem(`rate:dm:sec:${igAccountId}`, slotId).catch(() => 0);
      }
      return {
        allowed: false,
        reason: "RATE_LIMIT",
        hourlyUsed: used,
        hourlyRemaining: 0,
        retryAfterMs: envInt("DM_REQUEUE_DELAY_MS", 30 * 60_000),
      };
    }
    return { allowed: true, slotId, hourlyUsed: used, hourlyRemaining: remaining };
  }

  // Süreç içi atomik kayan pencere (Node tek iş parçacığı garantisi)
  const hList = memoryHourly.get(igAccountId) ?? [];
  pruneWindow(hList, nowMs - HOURLY_WINDOW_MS);
  memoryHourly.set(igAccountId, hList);

  if (enforcePerSecond) {
    const sList = memorySecond.get(igAccountId) ?? [];
    pruneWindow(sList, nowMs - SECOND_WINDOW_MS);
    memorySecond.set(igAccountId, sList);
    if (sList.length >= perSecondCap) {
      const oldest = sList[0]!.ts;
      return {
        allowed: false,
        reason: "PER_SECOND_LIMIT",
        hourlyUsed: hList.length,
        hourlyRemaining: Math.max(0, hourlyCap - hList.length),
        retryAfterMs: Math.max(100, oldest + SECOND_WINDOW_MS - nowMs),
      };
    }
  }

  if (hList.length >= hourlyCap) {
    const oldest = hList[0]!.ts;
    return {
      allowed: false,
      reason: "RATE_LIMIT",
      hourlyUsed: hList.length,
      hourlyRemaining: 0,
      retryAfterMs: Math.max(60_000, oldest + HOURLY_WINDOW_MS - nowMs),
    };
  }

  hList.push({ id: slotId, ts: nowMs });
  if (enforcePerSecond) {
    const sList = memorySecond.get(igAccountId) ?? [];
    sList.push({ id: slotId, ts: nowMs });
    memorySecond.set(igAccountId, sList);
  }

  return {
    allowed: true,
    slotId,
    hourlyUsed: hList.length,
    hourlyRemaining: Math.max(0, hourlyCap - hList.length),
  };
}

/** Başarısız veya reddedilen gönderim sonrası rezerve edilen slotu geri iade eder. */
export async function releaseDMSlot(igAccountId: string, slotId: string): Promise<void> {
  if (!slotId) return;
  if (redisClientOverride) {
    await Promise.all([
      redisClientOverride.zrem(`rate:dm:${igAccountId}`, slotId).catch(() => 0),
      redisClientOverride.zrem(`rate:dm:sec:${igAccountId}`, slotId).catch(() => 0),
    ]);
    return;
  }
  const hList = memoryHourly.get(igAccountId);
  if (hList) {
    const idx = hList.findIndex((x) => x.id === slotId);
    if (idx !== -1) hList.splice(idx, 1);
  }
  const sList = memorySecond.get(igAccountId);
  if (sList) {
    const idx = sList.findIndex((x) => x.id === slotId);
    if (idx !== -1) sList.splice(idx, 1);
  }
}

export function getHourlyUsageCount(igAccountId: string, nowMs = Date.now()): number {
  const hList = memoryHourly.get(igAccountId);
  if (!hList) return 0;
  pruneWindow(hList, nowMs - HOURLY_WINDOW_MS);
  return hList.length;
}

/** Sırada bekleyen yorumlar için tahmini bitiş süresini döndürür. */
export function estimateQueueWait(
  queuedCount: number,
  hourlyCap = getHourlyRateLimitCap(),
): { minutes: number; formattedTr: string } {
  if (queuedCount <= 0) return { minutes: 0, formattedTr: "0 dk" };
  const minutes = Math.max(1, Math.ceil((queuedCount / Math.max(1, hourlyCap)) * 60));
  const hours = Math.floor(minutes / 60);
  const remMins = minutes % 60;
  const formattedTr = hours > 0 ? `${hours} sa ${remMins} dk` : `${remMins} dk`;
  return { minutes, formattedTr };
}

