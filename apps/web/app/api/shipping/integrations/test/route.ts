import { z } from "zod";
import { requireApiActor } from "@/lib/auth-guard";
import { testBrandShippingIntegration } from "@infulancer/core/shipping/service";

const schema = z.object({
  provider: z.enum(["NAVLUNGO", "YURTICI", "ARAS", "MNG", "UPS", "HEPSIJET", "KOLAY_GELSIN", "CUSTOM_MANUAL"]),
});

export async function POST(req: Request) {
  const auth = await requireApiActor("BRAND");
  if (auth.response) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Geçersiz kargo firması." }, { status: 400 });
  }
  const result = await testBrandShippingIntegration(auth.actor.brandId!, parsed.data.provider);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}

