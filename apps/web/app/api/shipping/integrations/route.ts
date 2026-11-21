import { requireApiActor } from "@/lib/auth-guard";
import {
  listBrandShippingIntegrations,
  upsertBrandShippingIntegration,
} from "@infulancer/core/shipping/service";
import { brandShippingIntegrationSchema } from "@infulancer/core/shipping/types";

export async function GET() {
  const auth = await requireApiActor("BRAND");
  if (auth.response) return auth.response;
  const items = await listBrandShippingIntegrations(auth.actor.brandId!);
  return Response.json({ items });
}

export async function POST(req: Request) {
  const auth = await requireApiActor("BRAND");
  if (auth.response) return auth.response;
  const body = await req.json().catch(() => null);
  const parsed = brandShippingIntegrationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz kargo entegrasyon bilgisi." },
      { status: 400 },
    );
  }
  const saved = await upsertBrandShippingIntegration(auth.actor.brandId!, parsed.data);
  return Response.json({ id: saved.id, provider: saved.provider, isActive: saved.isActive });
}

