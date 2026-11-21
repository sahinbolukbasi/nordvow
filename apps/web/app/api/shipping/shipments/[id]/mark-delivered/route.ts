import { requireApiActor } from "@/lib/auth-guard";
import { isDomainError } from "@infulancer/core/domain/errors";
import { markShipmentDeliveredByInfluencer } from "@infulancer/core/shipping/service";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor("INFLUENCER");
  if (auth.response) return auth.response;
  const { id } = await ctx.params;
  try {
    const updated = await markShipmentDeliveredByInfluencer(id, auth.actor.influencerId!);
    return Response.json(updated);
  } catch (err) {
    if (isDomainError(err)) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

