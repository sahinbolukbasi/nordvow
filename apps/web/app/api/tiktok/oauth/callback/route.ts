import { handleTikTokOAuthCallback } from "@/lib/tiktok-oauth";

export const runtime = "nodejs";

/** Geriye dönük uyumluluk için /api/tiktok/oauth/callback. */
export async function GET(req: Request) {
  return handleTikTokOAuthCallback(req);
}
