import { requireApiActor } from "@/lib/auth-guard";
import { isDomainError } from "@infulancer/core/domain/errors";
import { confirmShipmentAddress } from "@infulancer/core/shipping/service";
import { confirmAddressSchema } from "@infulancer/core/shipping/types";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor("INFLUENCER");
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = confirmAddressSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz adres bilgisi." },
      { status: 400 },
    );
  }
  try {
    const updated = await confirmShipmentAddress(id, auth.actor.influencerId!, parsed.data);
    return Response.json(updated);
  } catch (err) {
    if (isDomainError(err)) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

