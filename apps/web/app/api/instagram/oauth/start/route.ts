import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { instagramAuthorizeUrl, instagramOAuthApp, instagramOAuthConfigured } from "@infulancer/core/social/instagram-login";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Instagram API with Instagram Login. Uygulama kimliği yoksa açıklamayla geri döner. */
export async function GET(req: Request) {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;
  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  if (!instagramOAuthConfigured()) return Response.redirect(`${appUrl}/profil?sekme=hesaplar&instagram=yapilandirilmadi`, 302);
  const { appId } = instagramOAuthApp();
  const state = randomBytes(24).toString("hex");
  (await cookies()).set("ig_oauth_state", state, { httpOnly: true, secure: appUrl.startsWith("https"), sameSite: "lax", path: "/api/instagram/oauth", maxAge: 600 });
  return Response.redirect(instagramAuthorizeUrl({ appId, redirectUri: `${appUrl}/api/instagram/oauth/callback`, state }), 302);
}
