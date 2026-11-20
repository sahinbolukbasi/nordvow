import { prisma } from "@infulancer/core/db";
import { buildPkpass } from "@infulancer/core/wallet/apple-pass";
import { appleWalletConfigured, type PassData } from "@infulancer/core/wallet/passes";
import { couponValueLabel } from "@infulancer/core/coupons/service";
import { couponPassError, loadCouponPass } from "@/lib/coupon-pass";
import { fmtDateTime } from "@/lib/time";

export const runtime = "nodejs";

/**
 * Apple Wallet .pkpass indirme. Sertifika tanımlıysa imzalı dosya indirilir (telefonda
 * doğrudan cüzdana eklenir). Tanımlı değilse şık web bilet/kupon görünümüne yönlendirir.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if (!appleWalletConfigured()) {
    const path = kind === "ticket" ? "bilet" : "kupon";
    return Response.redirect(new URL(`/${path}/${id}`, process.env.APP_URL ?? "http://localhost:3000"), 307);
  }
  let data: PassData | null = null;
  if (kind === "ticket") {
    const t = await prisma.eventTicket.findUnique({ where: { id }, include: { event: true } });
    if (t) data = { kind: "ticket", title: t.event.title, subtitle: t.holderName, code: t.code, accentColor: "#ff2bd6", relevantDate: t.event.startsAt, fields: [{ label: "Tarih", value: fmtDateTime(t.event.startsAt) }, { label: "Mekan", value: t.event.venueName ?? "-" }] };
  } else if (kind === "coupon") {
    const pass = await loadCouponPass(id);
    if (!pass.coupon || !pass.decision.allow) {
      const err = couponPassError(pass.decision);
      return new Response(err.message, { status: err.status, headers: { "Cache-Control": "no-store" } });
    }
    const c = pass.coupon;
    data = { kind: "coupon", title: c.title, subtitle: couponValueLabel(c.valueType, c.value), code: pass.grant?.code ?? pass.sharedCode ?? id, accentColor: c.brandColor ?? "#ff2bd6", expirationDate: c.validUntil, fields: c.validUntil ? [{ label: "Son kullanım", value: c.validUntil.toLocaleDateString("tr-TR") }] : [] };
  }
  if (!data) return new Response("Bulunamadı", { status: 404 });
  const pkpass = await buildPkpass(data, id);
  if (!pkpass) {
    const path = kind === "ticket" ? "bilet" : "kupon";
    return Response.redirect(new URL(`/${path}/${id}`, process.env.APP_URL ?? "http://localhost:3000"), 307);
  }
  return new Response(new Uint8Array(pkpass), {
    headers: { "content-type": "application/vnd.apple.pkpass", "content-disposition": `attachment; filename="${kind}-${id}.pkpass"`, "cache-control": "no-store" },
  });
}
