import { handleTikTokOAuthCallback } from "@/lib/tiktok-oauth";

export const runtime = "nodejs";

/** TikTok Login Kit v2 OAuth callback (/auth/tiktok/callback). */
export async function GET(req: Request) {
  return handleTikTokOAuthCallback(req);
}
