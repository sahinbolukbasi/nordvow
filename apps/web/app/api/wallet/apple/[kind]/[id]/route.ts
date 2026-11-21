import { buildPkpass } from "@infulancer/core/wallet/apple-pass";
import { appleWalletConfigured } from "@infulancer/core/wallet/passes";
import { couponPassError, loadCouponPass } from "@/lib/coupon-pass";
import { loadWalletPassData } from "@/lib/wallet-pass-data";

export const runtime = "nodejs";

/**
 * Apple Wallet .pkpass indirme. Sertifika tanımlıysa imzalı dosya indirilir.
 * Anahtar yoksa veya kart üretilemezse web bilet/kupon görünümüne 307 ile döner.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const path = kind === "ticket" ? "bilet" : "kupon";
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const web = new URL(`/${path}/${id}`, base);

  if (!appleWalletConfigured()) {
    return Response.redirect(web, 307);
  }

  if (kind === "coupon") {
    const pass = await loadCouponPass(id);
    if (!pass.coupon || !pass.decision.allow) {
      const err = couponPassError(pass.decision);
      return new Response(err.message, { status: err.status, headers: { "Cache-Control": "no-store" } });
    }
  }

  const data = await loadWalletPassData(kind, id);
  if (!data) return new Response("Bulunamadı", { status: 404 });

  const pkpass = await buildPkpass(data, id);
  if (!pkpass) {
    console.error(`[apple-wallet] .pkpass üretilemedi (kind=${kind})`);
    return Response.redirect(web, 307);
  }

  return new Response(new Uint8Array(pkpass), {
    headers: {
      "content-type": "application/vnd.apple.pkpass",
      "content-disposition": `inline; filename="${kind}-${id}.pkpass"`,
      "content-length": String(pkpass.byteLength),
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });
}
