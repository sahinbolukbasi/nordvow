import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@infulancer/core/db";
import { vault } from "@infulancer/core/channels/vault";
import { exchangeInstagramCode } from "@infulancer/core/social/instagram-login";
import { normalizeInstagramHandle } from "@infulancer/core/social/handles";
import { syncSocialAccount } from "@infulancer/core/social/sync";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Kod kasaya yazılır, Business Discovery zorlanmaz; senkron kullanıcının kendi belirteciyle yapılır. */
export async function GET(req: Request) {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;
  const actor = guard.actor;
  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const back = (r: string) => Response.redirect(`${appUrl}/profil?sekme=hesaplar&instagram=${r}`, 302);
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state") ?? "";
  const jar = await cookies();
  const expected = jar.get("ig_oauth_state")?.value ?? "";
  jar.delete({ name: "ig_oauth_state", path: "/api/instagram/oauth" });
  if (!code || !expected || state.length !== expected.length || !timingSafeEqual(Buffer.from(state), Buffer.from(expected))) return back("hata");
  const exchanged = await exchangeInstagramCode({ code, redirectUri: `${appUrl}/api/instagram/oauth/callback` }).catch(() => null);
  if (!exchanged) return back("hata");
  const influencerId = actor.influencerId;
  if (!influencerId) return back("hata");
  const tokenRef = await vault().put(`inf_${influencerId}`, "instagram", exchanged.accessToken);
  const existing = await prisma.socialAccount.findUnique({ where: { influencerId_platform: { influencerId, platform: "INSTAGRAM" } } });
  const handle = existing ? normalizeInstagramHandle(existing.handle) : "instagram";
  const acc = existing
    ? await prisma.socialAccount.update({
        where: { id: existing.id },
        data: { tokenRef, handle: handle || existing.handle, externalId: exchanged.userId, syncSource: "INSTAGRAM_OAUTH", syncError: null, lastErrorClass: null, retryCount: 0 },
      })
    : await prisma.socialAccount.create({
        data: {
          influencerId,
          platform: "INSTAGRAM",
          handle: "instagram",
          followers: 0,
          engagementRate: 0,
          demographics: {},
          tokenRef,
          externalId: exchanged.userId,
          syncSource: "INSTAGRAM_OAUTH",
        },
      });
  await syncSocialAccount(acc.id, new Date(), { force: true });
  return back("baglandi");
}
