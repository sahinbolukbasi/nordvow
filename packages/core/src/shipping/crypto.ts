import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { envStr } from "../env";

function encryptionKey(): Buffer {
  const secret = envStr("SHIPPING_ENCRYPTION_KEY", envStr("AUTH_SECRET", "local-dev-shipping-key"));
  return createHash("sha256").update(secret).digest();
}

/** Encrypts a sensitive credential (API key/secret) using AES-256-GCM. */
export function encryptShippingSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `enc:v1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}

/** Decrypts a sensitive credential encrypted with `encryptShippingSecret`. */
export function decryptShippingSecret(ciphertext: string | null | undefined): string | null {
  if (!ciphertext) return null;
  if (!ciphertext.startsWith("enc:v1:")) return ciphertext;
  const raw = Buffer.from(ciphertext.slice("enc:v1:".length), "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Masks a secret for safe UI display (e.g. `••••1234`). */
export function maskShippingSecret(ciphertext: string | null | undefined): string | null {
  const plain = decryptShippingSecret(ciphertext);
  if (!plain) return null;
  if (plain.length <= 4) return "••••";
  return `••••${plain.slice(-4)}`;
}

