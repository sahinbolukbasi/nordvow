import { prisma } from "@infulancer/core/db";
import { requireApiActor } from "@/lib/auth-guard";
import {
  getCampaignShippingConfig,
  upsertCampaignShippingConfig,
} from "@infulancer/core/shipping/service";
import { campaignShippingConfigSchema } from "@infulancer/core/shipping/types";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  const auth = await requireApiActor("BRAND", "ADMIN");
  if (auth.response) return auth.response;
  const { campaignId } = await ctx.params;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, brandId: true },
  });
  if (!campaign || (auth.actor.role === "BRAND" && campaign.brandId !== auth.actor.brandId)) {
    return Response.json({ error: "Kampanya bulunamadı." }, { status: 404 });
  }
  const config = await getCampaignShippingConfig(campaignId);
  return Response.json(config);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ campaignId: string }> },
) {
  const auth = await requireApiActor("BRAND", "ADMIN");
  if (auth.response) return auth.response;
  const { campaignId } = await ctx.params;
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { id: true, brandId: true },
  });
  if (!campaign || (auth.actor.role === "BRAND" && campaign.brandId !== auth.actor.brandId)) {
    return Response.json({ error: "Kampanya bulunamadı." }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = campaignShippingConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz gönderim kuralı." },
      { status: 400 },
    );
  }
  const saved = await upsertCampaignShippingConfig(campaignId, parsed.data);
  return Response.json(saved);
}

