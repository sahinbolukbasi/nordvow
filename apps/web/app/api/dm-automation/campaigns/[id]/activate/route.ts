import { z } from "zod";
import { activateDmCampaign } from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const activateSchema = z.object({
  instructionAck: z.boolean(),
  adDisclosureAck: z.boolean(),
  contentMatchAck: z.boolean(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "edit", { campaignId: id });
    if (denied) return denied;

    const body = await readJson(req, activateSchema);
    const campaign = await activateDmCampaign(tenantId, id, auth.actor.userId, body);
    return Response.json({ campaign });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

