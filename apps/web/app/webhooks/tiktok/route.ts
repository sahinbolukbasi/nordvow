import {
  type TikTokWebhookPayload,
  handleTikTokWebhookEvent,
  verifyTikTokWebhookSignature,
} from "@infulancer/core/tiktok/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * TikTok Webhook uç noktası (https://nordvow.com/webhooks/tiktok).
 * TikTok-Signature: t=<timestamp>,s=<hmac_sha256> doğrulaması (5dk replay korumalı).
 */
export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get("tiktok-signature");
  if (!verifyTikTokWebhookSignature(rawBody, sig)) {
    return Response.json({ error: "Geçersiz TikTok webhook imzası." }, { status: 401 });
  }

  try {
    const payload = JSON.parse(rawBody) as TikTokWebhookPayload;
    const result = await handleTikTokWebhookEvent(payload);
    return Response.json({ ok: true, ...result }, { status: 200 });
  } catch {
    return Response.json({ ok: false, error: "Geçersiz JSON gövdesi." }, { status: 400 });
  }
}
