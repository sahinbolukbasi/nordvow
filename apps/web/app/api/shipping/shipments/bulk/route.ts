import { z } from "zod";
import { requireApiActor } from "@/lib/auth-guard";
import { bulkDispatchShipments } from "@infulancer/core/shipping/service";

const bulkSchema = z.object({
  shipmentIds: z.array(z.string().min(1)).min(1).max(100),
  provider: z.enum(["NAVLUNGO", "YURTICI", "ARAS", "MNG", "UPS", "HEPSIJET", "KOLAY_GELSIN", "CUSTOM_MANUAL"]),
  manualCarrierName: z.string().trim().max(100).optional().nullable(),
  manualTrackingNumber: z.string().trim().max(120).optional().nullable(),
});

export async function POST(req: Request) {
  const auth = await requireApiActor("BRAND");
  if (auth.response) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz toplu gönderim isteği." },
      { status: 400 },
    );
  }
  const result = await bulkDispatchShipments({
    brandId: auth.actor.brandId!,
    ...parsed.data,
  });
  return Response.json(result);
}

