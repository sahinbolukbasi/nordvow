import { createHmac, timingSafeEqual } from "node:crypto";
import { envStr } from "@infulancer/core/env";
import { receiveWebhook } from "@infulancer/core/channels/webhook";
import { handleUserWhatsAppInbound } from "@infulancer/core/messaging/user-whatsapp-ai";

function verifyMetaSignature(raw: string, sigHeader: string | null): boolean {
  const secret = envStr("META_APP_SECRET", "");
  if (!secret) return envStr("WEBHOOK_REQUIRE_SIGNATURE", "false") !== "true";
  if (!sigHeader?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(sigHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Meta webhook uç noktası (WhatsApp / Instagram / Messenger fan-in). Kimlik doğrulama oturumla değil
 * X-Hub-Signature-256 imzasıyla yapılır; prod'da önerilen ek katman API Gateway mTLS veya AS32934 allowlist.
 * Her koşulda 200 döner (Meta 200 dışında 7 güne kadar retry eder).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.META_VERIFY_TOKEN;
  if (token && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token) {
    return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const body = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(body, sig)) {
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
