import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { envStr } from "../env";

/**
 * X-Hub-Signature-256 doğrulayıcı:
 * - "sha256=" + HMAC_SHA256(secret, rawBody)
 * - Birden fazla secret destekler (Instagram App Secret, Facebook App Secret, WhatsApp App Secret).
 * - Uzunluk kontrolü + sabit zamanlı karşılaştırma (timingSafeEqual).
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  header: string | null | undefined,
  secrets?: (string | null | undefined)[],
): boolean {
  if (!header || typeof header !== "string" || !header.startsWith("sha256=")) {
    return false;
  }
  const givenHex = header.slice(7).trim();
  if (givenHex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(givenHex)) {
    return false;
  }

  const candidateSecrets = (
    secrets && secrets.length > 0
      ? secrets
      : [
          envStr("META_APP_SECRET", ""),
          envStr("INSTAGRAM_APP_SECRET", ""),
          envStr("FACEBOOK_APP_SECRET", ""),
          envStr("WHATSAPP_APP_SECRET", ""),
        ]
  )
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);

  if (candidateSecrets.length === 0) return false;

  const givenBuf = Buffer.from(givenHex.toLowerCase(), "hex");
  for (const secret of candidateSecrets) {
    const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
    const expectedBuf = Buffer.from(expectedHex, "hex");
    if (givenBuf.length === expectedBuf.length && timingSafeEqual(givenBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}

/** Webhook GET hub.verify_token sabit zamanlı karşılaştırma. */
export function verifyMetaTokenConstantTime(
  given: string | null | undefined,
  expected?: string | null,
): boolean {
  const exp = (
    expected ??
    (envStr("META_WEBHOOK_VERIFY_TOKEN", "") || envStr("META_VERIFY_TOKEN", ""))
  ).trim();
  if (!given || !exp) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(exp, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function deriveAesKey(customSecret?: string): Buffer {
  const raw = (
    customSecret ??
    (envStr("META_TOKEN_ENC_KEY", "") || envStr("AUTH_SECRET", "nordvow-default-meta-key"))
  ).trim();
  if (/^[A-Za-z0-9+/=]{43,44}$/.test(raw)) {
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) return decoded;
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

/**
 * Meta erişim token'larını AES-256-GCM ile şifreler.
 * Biçim: `v1:<base64(iv(12) | authTag(16) | ciphertext)>`
 */
export function encryptMetaToken(plaintext: string, customSecret?: string): string {
  const key = deriveAesKey(customSecret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, enc]).toString("base64")}`;
}

export function decryptMetaToken(ciphertext: string, customSecret?: string): string {
  const raw = ciphertext.startsWith("v1:") ? ciphertext.slice(3) : ciphertext;
  const buf = Buffer.from(raw, "base64");
  if (buf.length < 28) {
    throw new Error("Geçersiz şifreli token verisi.");
  }
  const key = deriveAesKey(customSecret);
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export type OAuthStatePayload = {
  userId: string;
  tenantId: string;
  nonce: string;
  ts: number;
};

/** 10 dakika geçerli HMAC-SHA256 imzalı OAuth state üretir. */
export function createSignedOAuthState(
  input: { userId: string; tenantId: string; nonce?: string; ts?: number },
  secretOverride?: string,
): string {
  const secret = (secretOverride ?? (envStr("OAUTH_STATE_SECRET", "") || envStr("AUTH_SECRET", "oauth-state-key"))).trim();
  const payload: OAuthStatePayload = {
    userId: input.userId,
    tenantId: input.tenantId,
    nonce: input.nonce ?? randomBytes(12).toString("hex"),
    ts: input.ts ?? Date.now(),
  };
  const bodyB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(bodyB64).digest("base64url");
  return `${bodyB64}.${sig}`;
}

export function verifySignedOAuthState(
  state: string | null | undefined,
  opts: { maxAgeMs?: number; secretOverride?: string; now?: number } = {},
): OAuthStatePayload | null {
  if (!state || !state.includes(".")) return null;
  const [bodyB64, givenSig] = state.split(".");
  if (!bodyB64 || !givenSig) return null;
  const secret = (opts.secretOverride ?? (envStr("OAUTH_STATE_SECRET", "") || envStr("AUTH_SECRET", "oauth-state-key"))).trim();
  const expectedSig = createHmac("sha256", secret).update(bodyB64).digest("base64url");
  const a = Buffer.from(givenSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8")) as OAuthStatePayload;
    if (!parsed.userId || !parsed.tenantId || !parsed.nonce || typeof parsed.ts !== "number") return null;
    const maxAge = opts.maxAgeMs ?? 10 * 60 * 1000;
    const now = opts.now ?? Date.now();
    if (Math.abs(now - parsed.ts) > maxAge) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Meta Data Deletion & Deauthorize callback'lerinde gelen `signed_request` parametresini doğrular.
 * Format: `<base64url(signature)>.<base64url(payload)>`
 */
export function verifyMetaSignedRequest(
  signedRequest: string | null | undefined,
  secrets?: (string | null | undefined)[],
): { user_id?: string; algorithm?: string; issued_at?: number } | null {
  if (!signedRequest || !signedRequest.includes(".")) return null;
  const [encodedSig, encodedPayload] = signedRequest.split(".");
  if (!encodedSig || !encodedPayload) return null;

  const candidateSecrets = (
    secrets && secrets.length > 0
      ? secrets
      : [
          envStr("META_APP_SECRET", ""),
          envStr("INSTAGRAM_APP_SECRET", ""),
          envStr("FACEBOOK_APP_SECRET", ""),
          envStr("WHATSAPP_APP_SECRET", ""),
        ]
  )
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);

  if (candidateSecrets.length === 0) return null;

  let givenSig: Buffer;
  try {
    givenSig = Buffer.from(encodedSig.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  } catch {
    return null;
  }

  let matched = false;
  for (const secret of candidateSecrets) {
    const expectedSig = createHmac("sha256", secret).update(encodedPayload).digest();
    if (givenSig.length === expectedSig.length && timingSafeEqual(givenSig, expectedSig)) {
      matched = true;
      break;
    }
  }
  if (!matched) return null;

  try {
    const json = Buffer.from(encodedPayload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as { user_id?: string; algorithm?: string; issued_at?: number };
  } catch {
    return null;
  }
}

