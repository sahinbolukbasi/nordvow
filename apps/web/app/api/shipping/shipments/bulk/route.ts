import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { requireApiActor } from "@/lib/auth-guard";
import { bulkDispatchShipments } from "@infulancer/core/shipping/service";

const bulkSchema = z.object({
  shipmentIds: z.array(z.string().min(1)).min(1).max(100),
  provider: z.enum(["NAVLUNGO", "YURTICI", "ARAS", "MNG", "UPS", "HEPSIJET", "KOLAY_GELSIN", "CUSTOM_MANUAL"]),
  manualCarrierName: z.string().trim().max(100).optional().nullable(),
  manualTrackingNumber: z.string().trim().max(120).optional().nullable(),
});

export async function POST(req: Request) {
  const auth = await requireApiActor("BRAND", "ADMIN");
  if (auth.response) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz toplu gönderim isteği." },
      { status: 400 },
    );
  }
  if (auth.actor.role === "ADMIN") {
    const rows = await prisma.shipment.findMany({
      where: { id: { in: parsed.data.shipmentIds } },
      select: { id: true, brandId: true },
    });
    const byBrand = new Map<string, string[]>();
    for (const r of rows) {
      const list = byBrand.get(r.brandId) ?? [];
      list.push(r.id);
      byBrand.set(r.brandId, list);
    }
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const [brandId, ids] of byBrand) {
      const res = await bulkDispatchShipments({
        brandId,
        shipmentIds: ids,
        provider: parsed.data.provider,
        manualCarrierName: parsed.data.manualCarrierName,
        manualTrackingNumber: parsed.data.manualTrackingNumber,
      });
      succeeded.push(...res.succeeded);
      failed.push(...res.failed);
    }
    return Response.json({ succeeded, failed });
  }
  const result = await bulkDispatchShipments({
    brandId: auth.actor.brandId!,
    ...parsed.data,
  });
  return Response.json(result);
}

