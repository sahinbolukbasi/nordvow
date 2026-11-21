import { TikTokApiError, getCreatorPublishPreflight } from "@infulancer/core/tiktok/index";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Content Posting API öncesi creator_info ve scope/audit durumunu döner. */
export async function GET() {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  try {
    const info = await getCreatorPublishPreflight(guard.actor.influencerId!);
    return Response.json(info);
  } catch (err) {
    if (err instanceof TikTokApiError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    return Response.json({ error: err instanceof Error ? err.message : "TikTok hatası" }, { status: 500 });
  }
}
