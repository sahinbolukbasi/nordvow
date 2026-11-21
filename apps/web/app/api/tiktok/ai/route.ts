import { generateTikTokAiInsights } from "@infulancer/core/tiktok/index";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** AI katmanı: TikTok video açıklama/hashtag önerisi, en iyi paylaşım saati, performans özeti. */
export async function POST(req: Request) {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  const body = (await req.json().catch(() => ({}))) as { topic?: string; campaignName?: string };
  const result = await generateTikTokAiInsights({
    influencerId: guard.actor.influencerId!,
    topic: body.topic,
    campaignName: body.campaignName,
  });
  return Response.json(result);
}
