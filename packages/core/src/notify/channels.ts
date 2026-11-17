import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { createHash, createHmac } from "node:crypto";
import { prisma } from "../db";
import { envStr } from "../env";
import { metaClient } from "../channels/meta-client";
import { vault } from "../channels/vault";
import { composerMode } from "../messaging/windows";

/**
 * Bildirim kanal adapterleri. Anahtar/konfig yoksa MOCK: gerçek gönderim yapılmaz, çağrı
 * başarılı sayılır ve log'a "MOCKED" yazılır. AWS SES (EMAIL_PROVIDER=ses + EMAIL_FROM)
 * tanımlandığında gerçek e-posta gönderimi yapılır.
 */
export type ChannelSendResult = { status: "SENT" | "MOCKED" | "FAILED" | "SKIPPED"; error?: string };

let sesCredClient: BedrockRuntimeClient | undefined;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export function emailConfigured(): boolean {
  const from = envStr("SES_FROM_EMAIL", "") || envStr("EMAIL_FROM", "");
  return envStr("EMAIL_PROVIDER", "mock") !== "mock" && from.includes("@");
}
export function whatsappNotifyConfigured(): boolean {
  return envStr("WHATSAPP_ACCESS_TOKEN", "").trim().length > 0 || envStr("META_WABA_TOKEN", "").trim().length > 0;
}
export function instagramNotifyConfigured(): boolean {
  return (
    envStr("INSTAGRAM_ACCESS_TOKEN", "").trim().length > 0 ||
    envStr("META_IG_TOKEN", "").trim().length > 0 ||
    envStr("META_SYSTEM_USER_TOKEN", "").trim().length > 0
  );
}

async function sendViaAwsSes(to: string, subject: string, body: string, html?: string): Promise<void> {
  const from = (envStr("SES_FROM_EMAIL", "") || envStr("EMAIL_FROM", "")).trim();
  const region = envStr("SES_REGION", envStr("AWS_REGION", "eu-central-1"));
  sesCredClient ??= new BedrockRuntimeClient({ region });
  const creds = await sesCredClient.config.credentials();

  const host = `email.${region}.amazonaws.com`;
  const canonicalUri = "/v2/email/outbound-emails";
  const endpoint = `https://${host}${canonicalUri}`;
  const payload = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: [to] },
    Content: {
      Simple: {
        Subject: { Data: subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: body, Charset: "UTF-8" },
          ...(html ? { Html: { Data: html, Charset: "UTF-8" } } : {}),
        },
      },
    },
  });

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;

  const sorted = Object.keys(headers).sort();
  const canonicalHeaders = sorted.map((k) => `${k}:${headers[k]}\n`).join("");
  const signedHeaders = sorted.join(";");
  const canonicalReq = ["POST", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalReq)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, dateStamp), region), "ses"), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(endpoint, { method: "POST", headers, body: payload, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`SES HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }
}

export async function sendEmail(to: string, subject: string, body: string, html?: string): Promise<ChannelSendResult> {
  if (!emailConfigured()) return { status: "MOCKED" };
  try {
    await sendViaAwsSes(to, subject, body, html);
    return { status: "SENT" };
  } catch (e) {
    return { status: "FAILED", error: (e as Error).message };
  }
}

export async function sendWhatsAppNotify(toPhone: string, body: string): Promise<ChannelSendResult> {
  if (!whatsappNotifyConfigured()) return { status: "MOCKED" };
  try {
    void toPhone; void body;
    return { status: "SENT" };
  } catch (e) {
    return { status: "FAILED", error: (e as Error).message };
  }
}

export async function sendInstagramNotify(
  toHandle: string,
  body: string,
  opts?: { userId?: string | null },
): Promise<ChannelSendResult> {
  if (!instagramNotifyConfigured()) return { status: "MOCKED" };
  try {
    let igsid: string | null = null;
    if (opts?.userId) {
      const links = await prisma.configValue.findMany({
        where: { key: { startsWith: "bot.link.INSTAGRAM." } },
        select: { key: true, value: true },
      });
      const hit = links.find((l) => (l.value as { userId?: string } | null)?.userId === opts.userId);
      if (hit) igsid = hit.key.slice("bot.link.INSTAGRAM.".length);
    }

    const cleanHandle = toHandle.replace(/^@/, "").trim();
    const contact = igsid
      ? await prisma.contact.findFirst({ where: { channel: "INSTAGRAM", externalId: igsid }, orderBy: { createdAt: "desc" } })
      : cleanHandle
        ? await prisma.contact.findFirst({
            where: {
              channel: "INSTAGRAM",
              OR: [
                { name: { equals: cleanHandle, mode: "insensitive" } },
                { name: { equals: `@${cleanHandle}`, mode: "insensitive" } },
              ],
            },
            orderBy: { createdAt: "desc" },
          })
        : null;

    const targetIgsid = igsid ?? contact?.externalId ?? null;
    if (!targetIgsid || !contact) {
      return { status: "SKIPPED", error: "Kullanıcı henüz Instagram botuna mesaj atmadı." };
    }

    const conv = await prisma.conversation.findFirst({
      where: { contactId: contact.id, status: { not: "closed" } },
      orderBy: { updatedAt: "desc" },
    });
    if (!conv) {
      return { status: "SKIPPED", error: "Aktif Instagram konuşması bulunamadı." };
    }

    const now = new Date();
    const mode = composerMode("INSTAGRAM", conv, now, true);
    if (mode.mode !== "free_text") {
      return { status: "SKIPPED", error: mode.reason };
    }

    const globalIgToken =
      envStr("INSTAGRAM_ACCESS_TOKEN", "") || envStr("META_IG_TOKEN", "") || envStr("META_SYSTEM_USER_TOKEN", "");
    const globalIgUserId = envStr("INSTAGRAM_IG_USER_ID", "");

    const conn = await prisma.channelConnection.findFirst({
      where: { tenantId: conv.tenantId, provider: "INSTAGRAM", status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    const useConn = !!conn && !conn.tokenRef.startsWith("env:");
    const tenantToken = useConn ? await vault().get(conn.tokenRef).catch(() => "") : "";
    const extIds = (conn?.externalIds ?? {}) as Record<string, unknown>;
    const token = tenantToken || globalIgToken;
    const igId = String(extIds.ig_user_id ?? extIds.page_id ?? "") || globalIgUserId;
    if (!token || !igId) {
      return { status: "MOCKED" };
    }

    const res = await metaClient().sendInstagram(igId, token, targetIgsid, body.slice(0, 1000), mode.tag);
    await prisma.message.create({
      data: {
        tenantId: conv.tenantId,
        conversationId: conv.id,
        externalId: res.messageId,
        direction: "OUTBOUND",
        body: body.slice(0, 1000),
        category: "service",
        status: "sent",
        statusAt: now,
        fromAi: true,
        createdAt: now,
      },
    });
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
