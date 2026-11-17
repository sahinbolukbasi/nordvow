import { handleTikTokOAuthStart } from "@/lib/tiktok-oauth";

export const runtime = "nodejs";

/** TikTok Login Kit v2 OAuth başlatma (CSRF state + PKCE S256). */
export async function GET(req: Request) {
  return handleTikTokOAuthStart(req);
}
