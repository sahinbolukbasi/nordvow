import type { ShippingProvider } from "@infulancer/core/enums";
import { handleCargoWebhook } from "@infulancer/core/shipping/service";
import { SHIPPING_PROVIDERS } from "@infulancer/core/shipping/types";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ provider: string }> },
) {
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

