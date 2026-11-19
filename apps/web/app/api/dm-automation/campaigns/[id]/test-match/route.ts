import { randomUUID } from "node:crypto";
import { z } from "zod";
import { matchKeyword } from "@infulancer/core/dm-automation/matcher";
import {
  getDmCampaignStats,
  processCommentEvent,
} from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  checkUserActionRateLimit,
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testMatchSchema = z.object({
  text: z.string().max(1000),
  simulateWebhook: z.boolean().optional(),
  username: z.string().max(60).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  const limited = checkUserActionRateLimit(auth.actor.userId, "test_match", 60);
  if (limited) return limited;

  try {
    const { id } = await params;
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "view", { campaignId: id });
    if (denied) return denied;

    const body = await readJson(req, testMatchSchema);
    const { campaign } = await getDmCampaignStats(tenantId, id);
    const result = matchKeyword(body.text, campaign.keywords, campaign.matchMode);

    let simulated: Awaited<ReturnType<typeof processCommentEvent>> | null = null;
    if (body.simulateWebhook && result.matched && campaign.status === "ACTIVE") {
      simulated = await processCommentEvent(
        tenantId,
        {
          igAccountId: campaign.igUserId,
          commentId: `sim_cm_${randomUUID().slice(0, 8)}`,
          text: body.text,
          commenterId: `sim_igsid_${randomUUID().slice(0, 6)}`,
          commenterUsername: (body.username || "ornek.takipci").replace(/^@/, ""),
          mediaId: campaign.mediaId,
          mediaProductType: "REELS",
          originalMediaId: null,
          adId: null,
          parentId: null,
          timestamp: new Date(),
          isOwnComment: false,
        },
        { source: "WEBHOOK" },
      );
    }

    return Response.json({
      matched: result.matched,
      keyword: result.matchedKeyword,
      simulated,
    });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

