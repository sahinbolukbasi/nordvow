import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { envStr } from "../env";

export type LinkToken = { externalId: string; channel: "INSTAGRAM" | "MESSENGER"; exp: number };

function secret(): string {
  return envStr("AUTH_SECRET", "local-dev-vault-key");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** 15 dakikalık imzalı bağlama bağlantısı. Kart veya oturum taşımaz. */
export function signAccountLink(payload: Omit<LinkToken, "exp">, ttlMs = 15 * 60_000, now = Date.now()): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs })));
  const sig = createHmac("sha256", secret()).update(body).digest();
  return `${b64url(sig)}.${body}`;
}

export function verifyAccountLink(token: string, now = Date.now()): LinkToken | null {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const sigPart = token.slice(0, dot);
  const body = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(sigPart, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const json = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LinkToken;
    if (!json.externalId || !json.exp || json.exp < now) return null;
    if (json.channel !== "INSTAGRAM" && json.channel !== "MESSENGER") return null;
    return json;
  } catch {
    return null;
  }
}

export function randomLinkCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export const LINK_CODE_TTL_MS = 15 * 60_000;
export const LINK_FAIL_LIMIT = 5;
export const LINK_FAIL_WINDOW_MS = 15 * 60_000;

export function hashLinkCode(code: string): string {
  return createHmac("sha256", secret()).update(code).digest("hex");
}

export function hashEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Türkiye: 00, 90 ve baştaki 0 atılır. 0532…, +90 532… ve 90532… aynı anahtara iner. */
export function canonicalPhone(value: string | null | undefined): string {
  let d = phoneDigits(value);
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("90") && d.length > 10) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  return d;
}

/** Türkiye numaralarında 90 öneki ve baştaki 0 yok sayılarak eşleştirilir. */
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = canonicalPhone(a);
  const db = canonicalPhone(b);
  return da.length >= 10 && da === db;
}

export const SENSITIVE_TOOL_LIMIT = 5;

export function rateAllows(callsInLastHour: number, limit = SENSITIVE_TOOL_LIMIT): boolean {
  return callsInLastHour < limit;
}
