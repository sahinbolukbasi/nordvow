import { toggleCampaignShareReport } from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "admin", { campaignId: id });
    if (denied) return denied;

    const res = await toggleCampaignShareReport(tenantId, id, auth.actor.userId, true);
    return Response.json(res);
  } catch (err) {
    return dmErrorResponse(err);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "admin", { campaignId: id });
    if (denied) return denied;

    const res = await toggleCampaignShareReport(tenantId, id, auth.actor.userId, false);
    return Response.json(res);
  } catch (err) {
    return dmErrorResponse(err);
  }
}

