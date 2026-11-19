import { prisma } from "@infulancer/core/db";
import { buildCouponTemplateCsv } from "@infulancer/core/coupons/spreadsheet";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Bir kuponun gönderim listesini CSV olarak indirir (kime hangi kod, durum). ?template=1 ile örnek şablon döner. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiActor("ADMIN", "AGENCY", "BRAND");
  if (guard.response) return new Response("Yetkisiz", { status: guard.response.status });
  const actor = guard.actor;
  const url = new URL(req.url);
  if (url.searchParams.get("template") === "1") {
    return new Response(buildCouponTemplateCsv(), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="kupon-kodlari-sablon.csv"`,
        "cache-control": "no-store",
      },
    });
  }
  const { id } = await params;
  const coupon = await prisma.coupon.findUnique({ where: { id }, select: { tenantId: true, title: true, sharedCode: true } });
  if (!coupon) return new Response("Bulunamadı", { status: 404 });
  const isAdmin = actor.role === "ADMIN" || actor.role === "AGENCY";
  if (!isAdmin && actor.brandId !== coupon.tenantId) return new Response("Yetkisiz", { status: 403 });

  const grants = await prisma.couponGrant.findMany({ where: { couponId: id }, orderBy: { createdAt: "asc" } });
  const names = new Map(
    (await prisma.influencer.findMany({ where: { id: { in: grants.map((g) => g.influencerId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((i) => [i.id, i.name]),
  );
  const esc = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const statusTr: Record<string, string> = { GONDERILDI: "Gönderildi", GORULDU: "Görüldü", KULLANILDI: "Kullanıldı", IPTAL: "İptal" };
  const header = ["Influencer", "Kupon Kodu", "Takip Kodu", "Durum", "Gönderim Tarihi", "Kullanım Tarihi"].map(esc).join(",");
  const rows = grants.map((g) =>
    [names.get(g.influencerId ?? "") ?? "Havuz (Atanmamış)", coupon.sharedCode ?? g.code, g.code, statusTr[g.status] ?? g.status, g.createdAt.toISOString().slice(0, 10), g.redeemedAt ? g.redeemedAt.toISOString().slice(0, 10) : ""].map(esc).join(","),
  );
  // BOM + CRLF: Excel'de Türkçe karakter ve kolon ayrımı düzgün görünür.
  const csv = "\uFEFF" + [header, ...rows].join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kupon-${id}-gonderimler.csv"`, "cache-control": "no-store" },
  });
}
