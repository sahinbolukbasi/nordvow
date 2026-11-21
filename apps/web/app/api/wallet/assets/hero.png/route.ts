import { renderBannerPng } from "@infulancer/core/wallet/png";

export const runtime = "nodejs";

/** Google Wallet pass hero görseli için 3:1 (1032x336) koyu editoryal banner PNG. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const accent = url.searchParams.get("accent");
  const kind = url.searchParams.get("kind");
  const defaultAccent = kind === "coupon" ? "#ff2bd6" : "#9d4dff";
  const png = renderBannerPng(1032, 336, accent || defaultAccent);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "content-length": String(png.byteLength),
      "cache-control": "public, max-age=86400",
    },
  });
}
