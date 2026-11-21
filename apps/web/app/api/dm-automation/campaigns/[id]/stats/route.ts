import { getDmCampaignStats } from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "view", { campaignId: id });
    if (denied) return denied;

    const stats = await getDmCampaignStats(tenantId, id);
    return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

