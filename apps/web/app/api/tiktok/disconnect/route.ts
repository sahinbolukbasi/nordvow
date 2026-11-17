import { disconnectTikTokAccount } from "@infulancer/core/tiktok/index";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Kullanıcının TikTok bağlantısını keser ve tüm TikTok verilerini siler. */
export async function POST() {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  const res = await disconnectTikTokAccount(guard.actor.influencerId!);
  return Response.json({ ok: true, ...res });
}
