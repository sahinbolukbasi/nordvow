import { prisma } from "@infulancer/core/db";
import { buildCouponExportXlsx, buildCouponTemplateXlsx } from "@infulancer/core/coupons/spreadsheet";
import { getActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Kupon kodlarını Excel (.xlsx) olarak indirir veya ?template=1 ile örnek şablon verir. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("Yetkisiz", { status: 401 });

  const url = new URL(req.url);
  if (url.searchParams.get("template") === "1") {
    const buf = await buildCouponTemplateXlsx();
    return new Response(new Uint8Array(buf), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="kupon-kodlari-sablon.xlsx"`,
        "cache-control": "no-store",
      },
    });
  }

  const { id } = await params;
  const coupon = await prisma.coupon.findUnique({
    where: { id },
    select: { tenantId: true, title: true, sharedCode: true },
  });
  if (!coupon) return new Response("Bulunamadı", { status: 404 });
  const isAdmin = actor.role === "ADMIN" || actor.role === "AGENCY";
  if (!isAdmin && actor.brandId !== coupon.tenantId) return new Response("Yetkisiz", { status: 403 });

  const grants = await prisma.couponGrant.findMany({ where: { couponId: id }, orderBy: { createdAt: "asc" } });
  const infIds = grants.map((g) => g.influencerId).filter((x): x is string => !!x);
  const influencers = infIds.length
    ? await prisma.influencer.findMany({
        where: { id: { in: infIds } },
        select: { id: true, name: true, user: { select: { email: true } } },
      })
    : [];
  const infMap = new Map(influencers.map((i) => [i.id, i]));
  const statusTr: Record<string, string> = {
    GONDERILDI: "Gönderildi",
    GORULDU: "Görüldü",
    KULLANILDI: "Kullanıldı",
    IPTAL: "İptal",
  };

  const buf = await buildCouponExportXlsx(
    coupon.title,
    grants.map((g) => {
      const inf = g.influencerId ? infMap.get(g.influencerId) : undefined;
      return {
        influencerName: inf?.name ?? "—",
        email: inf?.user?.email ?? "",
        couponCode: coupon.sharedCode ?? g.code,
        trackingCode: g.code,
        status: statusTr[g.status] ?? g.status,
        sentAt: g.createdAt.toISOString().slice(0, 10),
        redeemedAt: g.redeemedAt ? g.redeemedAt.toISOString().slice(0, 10) : "",
      };
    }),
  );

  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="kupon-${id}-kodlar.xlsx"`,
      "cache-control": "no-store",
    },
  });
}

