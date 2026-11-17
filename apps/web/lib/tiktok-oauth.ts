import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { TIKTOK_ALL_SCOPES, buildAuthorizeUrl, completeTikTokOAuth, generatePkcePair } from "@infulancer/core/tiktok/index";
import { requireApiActor } from "@/lib/auth-guard";

const STATE_COOKIE = "tt_oauth_state";
const VERIFIER_COOKIE = "tt_oauth_verifier";

export function resolveTikTokRedirectUri(req: Request): string {
  const explicit = process.env.TIKTOK_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  return `${appUrl}/auth/tiktok/callback`;
}

export async function handleTikTokOAuthStart(req: Request) {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) {
    return Response.redirect(`${appUrl}/profil?sekme=hesaplar&tiktok=yapilandirilmadi`, 302);
  }

  const u = new URL(req.url);
  const requestedScopes = u.searchParams.get("scopes")?.split(",").map((s) => s.trim()).filter(Boolean);
  const scopes = requestedScopes && requestedScopes.length > 0 ? requestedScopes : [...TIKTOK_ALL_SCOPES];

  const state = randomBytes(24).toString("hex");
  const { codeVerifier, codeChallenge } = generatePkcePair();
  const redirectUri = resolveTikTokRedirectUri(req);

  const jar = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: appUrl.startsWith("https"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  jar.set(STATE_COOKIE, state, cookieOpts);
  jar.set(VERIFIER_COOKIE, codeVerifier, cookieOpts);

  const authorizeUrl = buildAuthorizeUrl({
    clientKey,
    redirectUri,
    state,
    scopes,
    codeChallenge,
  });
  return Response.redirect(authorizeUrl, 302);
}

export async function handleTikTokOAuthCallback(req: Request) {
  const guard = await requireApiActor("INFLUENCER");
  if (guard.response) return guard.response;

  const actor = guard.actor;
  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const back = (status: string) => Response.redirect(`${appUrl}/profil?sekme=hesaplar&tiktok=${status}`, 302);

  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state") ?? "";
  const errorParam = u.searchParams.get("error");

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value ?? "";
  const codeVerifier = jar.get(VERIFIER_COOKIE)?.value;
  jar.delete({ name: STATE_COOKIE, path: "/" });
  jar.delete({ name: VERIFIER_COOKIE, path: "/" });

  if (errorParam || !code || !expectedState || state.length !== expectedState.length) {
    return back("hata");
  }
  if (!timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) {
    return back("hata");
  }

  try {
    await completeTikTokOAuth({
      influencerId: actor.influencerId!,
      code,
      redirectUri: resolveTikTokRedirectUri(req),
      codeVerifier,
    });
    return back("baglandi");
  } catch (err) {
    console.error("[TikTok OAuth Callback Error]", err instanceof Error ? err.message : String(err));
    return back("hata");
  }
}
