import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { envStr } from "../env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

/**
 * 32-byte TOKEN_ENCRYPTION_KEY'i çözer (hex 64 karakter, base64 veya 32-byte UTF-8).
 * Production'da TOKEN_ENCRYPTION_KEY zorunludur.
 */
export function resolveEncryptionKey(explicitKey?: string): Buffer {
  const raw = explicitKey ?? envStr("TOKEN_ENCRYPTION_KEY", "");
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOKEN_ENCRYPTION_KEY ortam değişkeni production ortamında zorunludur.");
    }
    const devSecret = envStr("AUTH_SECRET", "nordvow-dev-tiktok-token-key");
    return createHash("sha256").update(devSecret).digest();
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  const asUtf8 = Buffer.from(raw, "utf8");
  if (asUtf8.length === 32) {
    return asUtf8;
  }
  const asBase64 = Buffer.from(raw, "base64");
  if (asBase64.length === 32) {
    return asBase64;
  }
  throw new Error("TOKEN_ENCRYPTION_KEY tam olarak 32 byte olmalıdır (64 hex karakteri, 32 ASCII karakteri veya 32-byte base64).");
}

/** Token metnini AES-256-GCM ile şifreler (`v1:<iv>:<tag>:<cipher>` base64 formatında). */
export function encryptToken(plaintext: string, explicitKey?: string): string {
  const key = resolveEncryptionKey(explicitKey);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

/** Şifreli token'ı çözer. */
export function decryptToken(payload: string, explicitKey?: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Geçersiz şifreli token formatı.");
  }
  const key = resolveEncryptionKey(explicitKey);
  const iv = Buffer.from(parts[1]!, "base64");
  const tag = Buffer.from(parts[2]!, "base64");
  const encrypted = Buffer.from(parts[3]!, "base64");
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error("Geçersiz şifreli token IV veya AuthTag uzunluğu.");
  }
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

/** Loglarda token/secret sızıntısını önlemek için değeri maskeler. */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "[EMPTY]";
  if (value.length <= 8) return "****";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

const SENSITIVE_KEY_RE = /(token|secret|authorization|password|key|code_verifier|code)/i;

/** Nesnelerdeki hassas anahtarları loglama öncesi maskeler. */
export function redactSecrets<T>(input: T): T {
  if (input == null || typeof input !== "object") return input;
  if (Array.isArray(input)) return input.map((item) => redactSecrets(item)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_RE.test(k) && typeof v === "string") {
      out[k] = maskSecret(v);
    } else if (v && typeof v === "object") {
      out[k] = redactSecrets(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}
