import { renderBrandIconPng } from "@infulancer/core/wallet/png";

export const runtime = "nodejs";

/** Google Wallet pass logosu için keskin PNG (192x192). */
export async function GET() {
  const png = renderBrandIconPng(192);
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "content-length": String(png.byteLength),
      "cache-control": "public, max-age=86400, immutable",
    },
  });
}
