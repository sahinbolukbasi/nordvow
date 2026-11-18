import { timingSafeEqual } from "node:crypto";
import type { ShippingProvider } from "@infulancer/core/enums";
import { envStr } from "@infulancer/core/env";
import { handleCargoWebhook } from "@infulancer/core/shipping/service";
import { SHIPPING_PROVIDERS } from "@infulancer/core/shipping/types";

function verifyOptionalSecret(req: Request): boolean {
  const expected = envStr("SHIPPING_WEBHOOK_SECRET", "").trim();
  if (!expected) return true;
  const provided =
    req.headers.get("x-webhook-secret")?.trim() ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ||
    "";
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
  if (!verifyOptionalSecret(req)) {
    return Response.json({ error: "Yetkisiz webhook isteği." }, { status: 401 });
  }
  const { provider: rawProvider } = await ctx.params;
  const upper = rawProvider.toUpperCase().replace(/-/g, "_") as ShippingProvider;
  if (!SHIPPING_PROVIDERS.includes(upper)) {
    return Response.json({ error: "Desteklenmeyen kargo sağlayıcısı." }, { status: 400 });
  }
  const payload = await req.json().catch(() => null);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const res = await handleCargoWebhook(upper, payload, headers);
  return Response.json(res, { status: res.processed ? 200 : 202 });
}
