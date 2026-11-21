import { envStr } from "@infulancer/core/env";
import { metaSubscriptionChallenge } from "@infulancer/core/channels/meta-hub";
import { receiveWebhook, warnMetaSignature } from "@infulancer/core/channels/webhook";
import { recordOperationalEvent } from "@infulancer/core/dm-automation/store";
import { verifyMetaSignature, verifyMetaTokenConstantTime } from "@infulancer/core/inbox/meta-security";
import { handleUserWhatsAppInbound } from "@infulancer/core/messaging/user-whatsapp-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta webhook uç noktası (WhatsApp / Instagram / Messenger fan-in). Kimlik doğrulama oturumla değil
 * X-Hub-Signature-256 imzasıyla yapılır. Kişisel WhatsApp asistanı önce bakar; kalanı platform botu
 * aynı istek içinde işler. İmza reddi 401 döner ve gövde loglanmaz.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge");
  if (mode === "subscribe" && verifyMetaTokenConstantTime(token)) {
    return new Response(challenge ?? "", { status: 200 });
  }
  const fallback = metaSubscriptionChallenge({ mode, verifyToken: token, challenge }, process.env.META_VERIFY_TOKEN);
  if (fallback !== null) return new Response(fallback, { status: 200 });
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  const requireSig = process.env.NODE_ENV === "production" ? true : envStr("WEBHOOK_REQUIRE_SIGNATURE", "true") !== "false";
  if (requireSig && !verifyMetaSignature(body, sig)) {
    const result = { accepted: false, reason: "mismatch" as const };
    console.info("[meta-bot]", { step: "received", accepted: result.accepted, reason: result.reason });
    warnMetaSignature(result.reason);
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
    const result = await receiveWebhook("meta", body, sig, { awaitProcessing: true });
    console.info("[meta-bot]", { step: "received", accepted: result.accepted, reason: result.reason ?? "ok" });
    warnMetaSignature(result.reason);
  }
  return new Response(null, { status: 200 });
}
