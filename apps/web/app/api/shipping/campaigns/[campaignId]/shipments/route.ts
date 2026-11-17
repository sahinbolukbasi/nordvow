import { prisma } from "@infulancer/core/db";
import { requireApiActor } from "@/lib/auth-guard";
import { getCampaignShipmentsDashboard } from "@infulancer/core/shipping/service";

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
  const data = await getCampaignShipmentsDashboard(campaignId);
  return Response.json(data);
}

