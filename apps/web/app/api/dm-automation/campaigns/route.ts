import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import {
  createDmCampaign,
  listDmCampaignsWithSummary,
  type DmCampaignStatus,
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

const createCampaignSchema = z.object({
  igAccountId: z.string().min(1).max(80),
  name: z.string().min(2).max(120),
  triggerMode: z.enum(["SPECIFIC_POST", "NEXT_REEL", "ANY_POST"]),
  mediaId: z.string().max(120).nullable().optional(),
  mediaPermalink: z.string().max(500).nullable().optional(),
  mediaThumbUrl: z.string().max(500).nullable().optional(),
  mediaCaption: z.string().max(600).nullable().optional(),
  dmTriggerEnabled: z.boolean().optional(),
  keywords: z.array(z.string().min(1).max(60)).max(20),
  matchMode: z.enum(["WHOLE_WORD", "CONTAINS", "ANY_COMMENT"]).default("WHOLE_WORD"),
  dmText: z.string().min(1).max(640),
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
  repeatPolicy: z.enum(["NEVER", "DAILY", "ALWAYS"]).default("DAILY"),
  sendCap: z.number().int().positive().max(1_000_000).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "view");
    if (denied) return denied;

    const statusParam = new URL(req.url).searchParams.get("status")?.trim() as DmCampaignStatus | undefined;
    const [summary, coupons, nordvowCampaigns] = await Promise.all([
      listDmCampaignsWithSummary(tenantId, statusParam),
      prisma.coupon
        .findMany({
          where: { tenantId, status: "YAYINDA" },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: { id: true, title: true, sharedCode: true, valueType: true, value: true },
        })
        .catch(() => []),
      prisma.campaign
        .findMany({
          where: { brandId: tenantId },
          orderBy: { createdAt: "desc" },
          take: 30,
          select: { id: true, name: true, slug: true, status: true },
        })
        .catch(() => []),
    ]);

    return Response.json(
      {
        ...summary,
        availableCoupons: coupons.map((c) => ({
          id: c.id,
          title: c.title,
          sharedCode: c.sharedCode,
          valueType: c.valueType,
          value: Number(c.value),
        })),
        availableNordvowCampaigns: nordvowCampaigns,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return dmErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  const limited = checkUserActionRateLimit(auth.actor.userId, "campaign_create", 25);
  if (limited) return limited;

  try {
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "edit");
    if (denied) return denied;

    const body = await readJson(req, createCampaignSchema);
    const campaign = await createDmCampaign({
      tenantId,
      actorId: auth.actor.userId,
      ...body,
    });
    return Response.json({ campaign }, { status: 201 });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

