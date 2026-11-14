import { couponValueLabel } from "@infulancer/core/coupons/service";
import { buildWalletLinks } from "@infulancer/core/wallet/passes";
import { dateLong } from "@/lib/event-format";
import { couponPassError, loadCouponPass } from "@/lib/coupon-pass";
import { renderPassPdf } from "@/lib/pdf/pass-pdf";
import { jsonError } from "@/lib/uploads";
import { prisma } from "@infulancer/core/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kupon PDF. Gönderim bağlantısı herkese açıktır. Şablon kimliği paylaşılan kodu yalnız marka/yöneticiye verir. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pass = await loadCouponPass(id);
  if (!pass.coupon || !pass.decision.allow) {
    const err = couponPassError(pass.decision);
    return jsonError(err.status, err.message);
  }
  const { coupon, grant, sharedCode } = pass;
  const brand = await prisma.brand.findUnique({ where: { id: coupon.tenantId }, select: { name: true } });
  const code = sharedCode ?? grant?.code ?? "ÖNİZLEME";
  const qrContent = grant?.code ?? sharedCode ?? id;
  const links = await buildWalletLinks("coupon", id, qrContent);
  const expired = !!coupon.validUntil && coupon.validUntil < new Date();
  const kind = coupon.kind === "HEDIYE_CEKI" ? "Hediye çeki" : "Kupon";

  const fields = [
    { label: "Marka", value: brand?.name ?? "Marka" },
    { label: "Değer", value: couponValueLabel(coupon.valueType, coupon.value) },
    { label: "Geçerlilik", value: coupon.validUntil ? `Son kullanım: ${dateLong(coupon.validUntil)}` : "Süresiz" },
  ];
  const sections: { title: string; body: string }[] = [];
  if (coupon.description) sections.push({ title: "Açıklama", body: coupon.description.slice(0, 500) });
  if (coupon.terms) sections.push({ title: "Kullanım koşulları", body: coupon.terms.slice(0, 800) });

  const pdf = await renderPassPdf({
    kicker: kind,
    title: coupon.title,
    org: brand?.name ?? "Marka",
    fields,
    code,
    codeHint: grant ? "Ödeme sırasında bu kodu girin veya QR'ı okutun" : "Önizleme: alıcılar kendi kodunu görür",
    qrDataUrl: links.qrDataUrl,
    statusLabel: expired ? "Süresi doldu" : grant ? "Kullanılabilir" : "Önizleme",
    statusColor: expired ? "#dc2626" : "#16a34a",
    sections,
  });
  const day = new Date().toISOString().slice(0, 10);
  const fileName = `kupon-${code}-${day}.pdf`.replace(/[^\w.-]/g, "_");
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": String(pdf.length),
      "Cache-Control": "private, no-store",
    },
  });
}
