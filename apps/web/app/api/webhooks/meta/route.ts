import { envStr } from "@infulancer/core/env";
import { receiveWebhook } from "@infulancer/core/channels/webhook";
import { recordOperationalEvent } from "@infulancer/core/dm-automation/store";
import { verifyMetaSignature, verifyMetaTokenConstantTime } from "@infulancer/core/inbox/meta-security";
import { handleUserWhatsAppInbound } from "@infulancer/core/messaging/user-whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta webhook uç noktası (WhatsApp / Instagram / Messenger fan-in). Kimlik doğrulama oturumla değil
 * X-Hub-Signature-256 imzasıyla yapılır; prod'da önerilen ek katman API Gateway mTLS veya AS32934 allowlist.
 * Her koşulda 200 döner (Meta 200 dışında 7 güne kadar retry eder).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (
    u.searchParams.get("hub.mode") === "subscribe" &&
    verifyMetaTokenConstantTime(u.searchParams.get("hub.verify_token"))
  ) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  const requireSig =
    process.env.NODE_ENV === "production"
      ? true
      : envStr("WEBHOOK_REQUIRE_SIGNATURE", "true") !== "false";
  if (requireSig && !verifyMetaSignature(body, sig)) {
    console.warn(`[webhook:meta] bad_signature (hasHeader=${Boolean(sig)})`);
    await recordOperationalEvent({
      level: "WARNING",
      type: "webhook.meta.bad_signature",
      details: { hadSignatureHeader: Boolean(sig), bodyLength: body.length },
      bodyPreview: body.slice(0, 200),
    }).catch(() => undefined);
    return new Response(null, { status: 401 });
  }
  let handledByPersonalAi = false;
  try {
    const parsed = JSON.parse(body) as unknown;
    handledByPersonalAi = await handleUserWhatsAppInbound(parsed).catch(() => false);
  } catch {
    /* ignore */
  }
  if (!handledByPersonalAi) {
    await receiveWebhook("meta", body, sig);
  }
  return new Response(null, { status: 200 });
}
