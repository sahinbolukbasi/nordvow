import { envStr } from "../env";
import { metaClient } from "../channels/meta-client";

/**
 * Bildirim kanal adapterleri. Anahtar/konfig yoksa MOCK: gerçek gönderim yapılmaz, çağrı
 * başarılı sayılır ve log'a "MOCKED" yazılır. Anahtar eklenince gerçek gönderime geçilir.
 */
export type ChannelSendResult = { status: "SENT" | "MOCKED" | "FAILED"; error?: string };

export function emailConfigured(): boolean {
  // SES veya SMTP + doğrulanmış gönderen alan adı gerekir.
  return (envStr("EMAIL_PROVIDER", "mock") !== "mock") && envStr("EMAIL_FROM", "").includes("@");
}
export function whatsappNotifyConfigured(): boolean {
  return envStr("WHATSAPP_ACCESS_TOKEN", "").trim().length > 0 || envStr("META_WABA_TOKEN", "").trim().length > 0;
}
export function instagramNotifyConfigured(): boolean {
  return envStr("INSTAGRAM_ACCESS_TOKEN", "").trim().length > 0 || envStr("META_IG_TOKEN", "").trim().length > 0;
}

export async function sendEmail(to: string, subject: string, body: string, html?: string): Promise<ChannelSendResult> {
  if (!emailConfigured()) return { status: "MOCKED" };
  // Taşıyıcı (SES/SMTP) bağlanana kadar SENT denmez; aksi halde log sahte başarı yazar.
  void to; void subject; void body; void html;
  return { status: "FAILED", error: "E-posta taşıyıcısı (SES/SMTP) henüz bağlı değil." };
}

export async function sendWhatsAppNotify(toPhone: string, body: string): Promise<ChannelSendResult> {
  if (envStr("META_API_MODE", "mock") !== "http") return { status: "MOCKED" };
  const token = envStr("WHATSAPP_ACCESS_TOKEN", "").trim() || envStr("META_WABA_TOKEN", "").trim();
  const phoneNumberId = envStr("WHATSAPP_PHONE_NUMBER_ID", "").trim();
  if (!token || !phoneNumberId) return { status: "FAILED", error: "META_API_MODE=http ama WhatsApp token veya WHATSAPP_PHONE_NUMBER_ID eksik." };
  try {
    const to = toPhone.replace(/[^\d]/g, "");
    await metaClient().sendWhatsApp(phoneNumberId, token, { kind: "text", to, body });
    return { status: "SENT" };
  } catch (e) {
    return { status: "FAILED", error: (e as Error).message };
  }
}

export async function sendInstagramNotify(toHandle: string, body: string): Promise<ChannelSendResult> {
  if (envStr("META_API_MODE", "mock") !== "http") return { status: "MOCKED" };
  const token = envStr("INSTAGRAM_ACCESS_TOKEN", "").trim() || envStr("META_IG_TOKEN", "").trim();
  const igUserId = envStr("INSTAGRAM_IG_USER_ID", "").trim() || envStr("META_IG_USER_ID", "").trim();
  if (!token || !igUserId) return { status: "FAILED", error: "META_API_MODE=http ama Instagram token veya IG kullanıcı kimliği eksik." };
  try {
    await metaClient().sendInstagram(igUserId, token, toHandle, body);
    return { status: "SENT" };
  } catch (e) {
    return { status: "FAILED", error: (e as Error).message };
  }
}

/** Kanal yapılandırma özeti (admin paneli için). */
export function channelStatus() {
  return {
    EMAIL: emailConfigured(),
    WHATSAPP: whatsappNotifyConfigured(),
    INSTAGRAM: instagramNotifyConfigured(),
    INAPP: true,
  };
}
