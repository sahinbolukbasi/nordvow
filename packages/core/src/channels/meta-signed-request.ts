import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaSignedPayload = { algorithm?: string; user_id?: string; issued_at?: number };

function b64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Meta `signed_request`: HMAC-SHA256(payload, app_secret). İmza tutmazsa null. */
export function parseMetaSignedRequest(signed: string, appSecret: string): MetaSignedPayload | null {
  if (!appSecret || !signed.includes(".")) return null;
  const dot = signed.indexOf(".");
  const encodedSig = signed.slice(0, dot);
  const payload = signed.slice(dot + 1);
  if (!encodedSig || !payload) return null;
  let sig: Buffer;
  try {
    sig = b64url(encodedSig);
  } catch {
    return null;
  }
  const expected = createHmac("sha256", appSecret).update(payload).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  try {
    const json = JSON.parse(b64url(payload).toString("utf8")) as MetaSignedPayload;
    if (String(json.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null;
    return json;
  } catch {
    return null;
  }
}

/** Test ve callback için imza üretir. */
export function signMetaRequest(payload: Record<string, unknown>, appSecret: string): string {
  const body = Buffer.from(JSON.stringify({ ...payload, algorithm: "HMAC-SHA256" })).toString("base64url");
  const sig = createHmac("sha256", appSecret).update(body).digest("base64url");
  return `${sig}.${body}`;
}
