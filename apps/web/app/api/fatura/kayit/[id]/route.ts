import { prisma } from "@infulancer/core/db";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiActor("BRAND", "ADMIN");
  if (auth.response) return auth.response;
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({ where: { id }, include: { brand: true, items: true } });
  if (!invoice || (auth.actor.role === "BRAND" && invoice.brandId !== auth.actor.brandId)) {
    return Response.json({ error: "Fatura bulunamadı." }, { status: 404 });
  }
  const seller = invoice.sellerSnapshot as Record<string, unknown>;
  const buyer = invoice.buyerSnapshot as Record<string, unknown>;
  const totals = invoice.totalsSnapshot as Record<string, unknown>;
  const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(invoice.invoiceNumber)}</title><style>
  body{font-family:Arial,sans-serif;color:#111;max-width:900px;margin:32px auto;padding:24px}header{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:16px}header img{display:block;width:126px;height:auto;margin-bottom:8px}.gib-logo{width:82px;height:82px;margin:0 auto 8px}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{border:1px solid #bbb;padding:8px;text-align:left}th{background:#eee}.totals{margin:24px 0 0 auto;width:320px}.row{display:flex;justify-content:space-between;padding:5px 0}.muted{color:#555;font-size:12px}
  </style></head><body><header><div><img src="/brand/nordvow-logo-dark.svg" alt="Nordvow"><h1>E-Arşiv Fatura</h1><p>${esc(seller.unvan)}</p><p>${esc(seller.adres)} ${esc(seller.ilce)} / ${esc(seller.il)}</p><p>VKN: ${esc(seller.vkn)}</p></div><div><img class="gib-logo" src="/brand/gib-logo.png" alt="GİB"><p>Fatura No: ${esc(invoice.invoiceNumber)}</p><p>ETTN: ${esc(invoice.ettn)}</p><p>Tarih: ${esc(invoice.issuedAt.toLocaleDateString("tr-TR"))}</p><p>Senaryo: ${esc(invoice.scenario)} · Tip: SATIS</p></div></header>
  <section><h2>Alıcı</h2><p>${esc(buyer.unvan)}</p><p>${esc(buyer.adres)} ${esc(buyer.ilce)} / ${esc(buyer.il)}</p><p>VKN/TCKN: ${esc(buyer.vergiNo)}</p><p>Vergi Dairesi: ${esc(buyer.vergiDairesi)}</p></section>
  <table><thead><tr><th>Sıra</th><th>Mal/Hizmet</th><th>Miktar</th><th>Birim Fiyat</th><th>KDV</th><th>Tutar</th></tr></thead><tbody>${invoice.items.map((item) => `<tr><td>${item.lineNumber}</td><td>${esc(item.description)}</td><td>${item.quantity}</td><td>${(item.unitPriceKurus / 100).toFixed(2)} TL</td><td>%${item.vatRate}</td><td>${(item.lineTotalKurus / 100).toFixed(2)} TL</td></tr>`).join("")}</tbody></table>
  <div class="totals"><div class="row"><span>Matrah</span><strong>${(Number(totals.matrahKurus) / 100).toFixed(2)} TL</strong></div><div class="row"><span>KDV</span><strong>${(Number(totals.vatKurus) / 100).toFixed(2)} TL</strong></div><div class="row"><span>Ödenecek</span><strong>${(Number(totals.totalKurus) / 100).toFixed(2)} TL</strong></div></div><p class="muted">Bu çıktı platform üzerinde oluşturulmuş e-Arşiv taslağıdır. GİB'e resmi gönderim için yetkili özel entegratör bağlantısı gerekir.</p></body></html>`;
  await prisma.invoice.update({ where: { id }, data: { status: "DOWNLOADED" } });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": download ? `attachment; filename="${invoice.invoiceNumber}.html"` : "inline",
      "Cache-Control": "private, no-store",
    },
  });
}
