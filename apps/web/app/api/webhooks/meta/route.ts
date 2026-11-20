import { metaSubscriptionChallenge } from "@infulancer/core/channels/meta-hub";
import { receiveWebhook, warnMetaSignature } from "@infulancer/core/channels/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta webhook uç noktası (WhatsApp / Instagram / Messenger fan-in). Kimlik doğrulama oturumla değil
 * X-Hub-Signature-256 imzasıyla yapılır; prod'da önerilen ek katman API Gateway mTLS veya AS32934 allowlist.
 * Her koşulda 200 döner (Meta 200 dışında 7 güne kadar retry eder).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const challenge = metaSubscriptionChallenge(
    { mode: u.searchParams.get("hub.mode"), verifyToken: u.searchParams.get("hub.verify_token"), challenge: u.searchParams.get("hub.challenge") },
    process.env.META_VERIFY_TOKEN,
  );
  if (challenge !== null) return new Response(challenge, { status: 200 });
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.text();
  const result = await receiveWebhook("meta", body, req.headers.get("x-hub-signature-256"), { awaitProcessing: true });
  console.info("[meta-bot]", { step: "received", accepted: result.accepted, reason: result.reason ?? "ok" });
  warnMetaSignature(result.reason);
  return new Response(null, { status: 200 });
}
