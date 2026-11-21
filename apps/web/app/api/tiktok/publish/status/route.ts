import { prisma } from "@infulancer/core/db";
import { TikTokApiError, refreshTikTokPostStatus } from "@infulancer/core/tiktok/index";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Belirli bir publish_id'nin TikTok yayın durumunu sorgular. */
export async function GET(req: Request) {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  const publishId = new URL(req.url).searchParams.get("publishId");
  if (!publishId) {
    return Response.json({ error: "publishId parametresi zorunludur." }, { status: 400 });
  }

  const existing = await prisma.tikTokPost.findUnique({
    where: { publishId },
    include: { account: { select: { influencerId: true } } },
  });
  if (!existing || existing.account.influencerId !== guard.actor.influencerId) {
    return Response.json({ error: "Kayıt bulunamadı." }, { status: 404 });
  }

  try {
    const updated = await refreshTikTokPostStatus(publishId);
    return Response.json({ ok: true, post: updated });
  } catch (err) {
    if (err instanceof TikTokApiError) {
      return Response.json({ error: err.message, code: err.code }, { status: err.httpStatus });
    }
    return Response.json({ error: err instanceof Error ? err.message : "Durum sorgulanamadı." }, { status: 500 });
  }
}
