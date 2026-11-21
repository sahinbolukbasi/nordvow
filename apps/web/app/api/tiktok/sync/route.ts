import { prisma } from "@infulancer/core/db";
import { syncTikTokAccount } from "@infulancer/core/tiktok/index";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Aktif TikTok hesabının profil ve videolarını manuel senkronlar. */
export async function POST() {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  const acc = await prisma.tikTokAccount.findFirst({
    where: { influencerId: guard.actor.influencerId!, status: "active" },
    orderBy: { connectedAt: "desc" },
  });
  if (!acc) {
    return Response.json({ ok: false, error: "Bağlı aktif TikTok hesabı bulunamadı." }, { status: 404 });
  }

  const res = await syncTikTokAccount(acc.id);
  return Response.json(res, { status: res.ok ? 200 : 502 });
}
