import { prisma } from "@infulancer/core/db";
import { getNavlungoBarcode } from "@infulancer/core/shipping/service";
import { parseShippingAddress } from "@infulancer/core/shipping/types";
import { requireApiActor } from "@/lib/auth-guard";

function esc(str: string | null | undefined): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(req: Request) {
  const auth = await requireApiActor("BRAND", "ADMIN");
  if (auth.response) return auth.response;

  const url = new URL(req.url);
  const postNumber = url.searchParams.get("postNumber")?.trim();
  const barcodeType = (url.searchParams.get("type") ?? "pdf") as "pdf" | "html" | "zpl";
  const format = url.searchParams.get("format");
  if (!postNumber) {
    return Response.json({ error: "postNumber parametresi zorunludur." }, { status: 400 });
  }

  const shipment = await prisma.shipment.findFirst({
    where: {
      OR: [{ trackingNumber: postNumber }, { externalShipmentId: postNumber }],
    },
    include: {
      brand: { select: { id: true, name: true } },
      campaign: { select: { name: true } },
      influencer: { select: { name: true } },
    },
  });

  const targetBrandId = auth.actor.brandId ?? shipment?.brandId ?? null;

  try {
    const data = await getNavlungoBarcode(targetBrandId, postNumber, barcodeType);
    if (format === "json") {
      return Response.json(data);
    }
    const nested = (data.data as Record<string, unknown> | undefined) ?? data;
    const directUrl =
      (typeof nested.barcode_url === "string" && nested.barcode_url) ||
      (typeof nested.url === "string" && nested.url) ||
      null;
    if (directUrl && directUrl.startsWith("http")) {
      return Response.redirect(directUrl, 302);
    }
    const htmlContent = typeof nested.html === "string" ? nested.html : null;
    if (htmlContent) {
      return new Response(htmlContent, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  } catch (err) {
    if (format === "json") {
      return Response.json(
        { error: err instanceof Error ? err.message : "Barkod alınamadı." },
        { status: 502 },
      );
    }
  }

  const addr = parseShippingAddress(shipment?.shippingAddress);
  const html = `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <title>Navlungo Kargo Barkodu - ${esc(postNumber)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f4f4f5; margin: 0; padding: 24px; color: #111827; }
    .sheet { max-width: 520px; margin: 0 auto; background: #fff; border: 2px solid #111827; border-radius: 12px; padding: 24px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); }
    .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #111827; padding-bottom: 14px; margin-bottom: 16px; }
    .brand { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; }
    .badge { font-size: 11px; font-weight: 700; text-transform: uppercase; background: #111827; color: #fff; padding: 4px 10px; border-radius: 999px; }
    .section { border-bottom: 1px dashed #d4d4d8; padding: 12px 0; }
    .label { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #71717a; letter-spacing: 0.06em; margin-bottom: 4px; }
    .val { font-size: 14px; font-weight: 600; line-height: 1.4; }
    .barcode-box { text-align: center; padding: 20px 0 8px; }
    .bars { font-family: "Libre Barcode 128", monospace; font-size: 36px; letter-spacing: 3px; font-weight: 900; border: 1px solid #e4e4e7; padding: 14px; border-radius: 8px; background: repeating-linear-gradient(90deg, #111 0 2px, #fff 2px 5px, #111 5px 9px, #fff 9px 12px); height: 48px; }
    .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 20px; font-weight: 800; letter-spacing: 0.12em; margin-top: 10px; }
    .actions { text-align: center; margin-top: 16px; }
    .btn { background: #111827; color: #fff; border: 0; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; }
    @media print { body { background: #fff; padding: 0; } .sheet { box-shadow: none; } .actions { display: none; } }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="head">
      <div>
        <div class="brand">NAVLUNGO × NORDVOW</div>
        <div style="font-size:12px;color:#52525b;">${esc(shipment?.carrierName ?? "Navlungo Domestic v2.1")}</div>
      </div>
      <span class="badge">Standart Gönderi</span>
    </div>
    <div class="section">
      <div class="label">Gönderici (Marka)</div>
      <div class="val">${esc(shipment?.brand.name ?? "Nordvow Lojistik")}</div>
      <div style="font-size:12px;color:#52525b;">Kampanya: ${esc(shipment?.campaign.name ?? "Ürün Gönderimi")}</div>
    </div>
    <div class="section">
      <div class="label">Alıcı (Influencer)</div>
      <div class="val">${esc(shipment?.recipientName ?? shipment?.influencer.name ?? "Alıcı")}</div>
      <div style="font-size:13px;color:#3f3f46;">${esc(shipment?.recipientPhone ?? "")}</div>
      <div style="font-size:13px;color:#18181b;margin-top:4px;">
        ${esc(addr ? `${addr.addressLine} — ${addr.district} / ${addr.city} ${addr.postalCode ?? ""}` : "")}
      </div>
    </div>
    <div class="barcode-box">
      <div class="bars" aria-hidden="true"></div>
      <div class="code">${esc(postNumber)}</div>
    </div>
    <div class="actions">
      <button class="btn" onclick="window.print()">Barkodu Yazdır (A5)</button>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

