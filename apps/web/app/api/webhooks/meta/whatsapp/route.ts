import { receiveWebhook } from "@infulancer/core/channels/webhook";
import { envStr } from "@infulancer/core/env";
import {
  verifyMetaSignature,
  verifyMetaTokenConstantTime,
} from "@infulancer/core/inbox/meta-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const mode = u.searchParams.get("hub.mode");
  const token = u.searchParams.get("hub.verify_token");
  const challenge = u.searchParams.get("hub.challenge") ?? "";

  if (mode === "subscribe" && verifyMetaTokenConstantTime(token)) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const rawBody = await req.text();
  const sig = req.headers.get("x-hub-signature-256");
  const requireSig = envStr("WEBHOOK_REQUIRE_SIGNATURE", "true") !== "false";

  if (requireSig && !verifyMetaSignature(rawBody, sig)) {
    console.warn(`[webhook:whatsapp] bad_signature (len=${rawBody.length})`);
    return Response.json({ error: "Geçersiz webhook imzası." }, { status: 401 });
  }

  await receiveWebhook("meta", rawBody, sig);
  return Response.json({ received: true }, { status: 200 });
}

