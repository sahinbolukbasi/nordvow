import { z } from "zod";
import {
  deleteDmCampaign,
  getDmCampaignStats,
  updateDmCampaign,
} from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  triggerMode: z.enum(["SPECIFIC_POST", "NEXT_REEL", "ANY_POST"]).optional(),
  mediaId: z.string().max(120).nullable().optional(),
  mediaPermalink: z.string().max(500).nullable().optional(),
  mediaThumbUrl: z.string().max(500).nullable().optional(),
  mediaCaption: z.string().max(600).nullable().optional(),
  dmTriggerEnabled: z.boolean().optional(),
  keywords: z.array(z.string().min(1).max(60)).max(20).optional(),
  matchMode: z.enum(["WHOLE_WORD", "CONTAINS", "ANY_COMMENT"]).optional(),
  dmText: z.string().min(1).max(640).optional(),
  dmFooter: z.string().max(260).nullable().optional(),
  buttons: z
    .array(
      z.object({
        label: z.string().min(1).max(20),
        url: z.string().url().max(600),
      }),
    )
    .max(3)
    .optional(),
  openingDmEnabled: z.boolean().optional(),
  openingDmText: z.string().max(400).nullable().optional(),
  openingDmButtonLabel: z.string().max(20).nullable().optional(),
  publicReplyEnabled: z.boolean().optional(),
  publicReplies: z.array(z.string().min(1).max(300)).max(10).optional(),
  nordvowCampaignId: z.string().max(80).nullable().optional(),
  couponId: z.string().max(80).nullable().optional(),
  couponCode: z.string().max(60).nullable().optional(),
  repeatPolicy: z.enum(["NEVER", "DAILY", "ALWAYS"]).optional(),
  sendCap: z.number().int().positive().max(1_000_000).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

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

export async function PATCH(
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

    const body = await readJson(req, updateSchema);
    const campaign = await updateDmCampaign(tenantId, id, auth.actor.userId, body);
    return Response.json({ campaign });
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
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "edit", { campaignId: id });
    if (denied) return denied;

    const res = await deleteDmCampaign(tenantId, id, auth.actor.userId);
    return Response.json(res);
  } catch (err) {
    return dmErrorResponse(err);
  }
}

