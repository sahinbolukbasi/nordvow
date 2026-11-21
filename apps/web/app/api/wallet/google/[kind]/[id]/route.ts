import { buildGoogleWalletLink } from "@infulancer/core/wallet/google-pass";
import { googleWalletConfigured } from "@infulancer/core/wallet/passes";
import { couponPassError, loadCouponPass } from "@/lib/coupon-pass";
import { loadWalletPassData } from "@/lib/wallet-pass-data";

export const runtime = "nodejs";

/**
 * Google Wallet yönlendiricisi. Anahtar tanımlıysa imzalı JWT linkine 303 gider.
 * Anahtar yoksa web bilet/kupon görünümüne 307 ile döner.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const path = kind === "ticket" ? "bilet" : "kupon";
  const base = process.env.APP_URL ?? "http://localhost:3000";
  const web = new URL(`/${path}/${id}`, base);
  if (!googleWalletConfigured()) return Response.redirect(web, 307);

  if (kind === "coupon") {
    const pass = await loadCouponPass(id);
    if (!pass.coupon || !pass.decision.allow) {
      const err = couponPassError(pass.decision);
      return new Response(err.message, { status: err.status, headers: { "Cache-Control": "no-store" } });
    }
  }

  const data = await loadWalletPassData(kind, id);
  if (!data) return new Response("Bulunamadı", { status: 404 });

  const link = await buildGoogleWalletLink(data, id);
  if (!link) return Response.redirect(web, 307);
  return Response.redirect(link, 303);
}
