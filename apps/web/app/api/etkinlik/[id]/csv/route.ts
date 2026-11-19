import { prisma } from "@infulancer/core/db";
import { canBrandManageEvent } from "@infulancer/core/events/partners";
import { requireApiActor } from "@/lib/auth-guard";

export const runtime = "nodejs";

/** Etkinliğin tüm bilet ve katılımcı listesini CSV olarak indirir. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApiActor("ADMIN", "AGENCY", "BRAND");
  if (guard.response) return new Response("Yetkisiz", { status: guard.response.status });
  const actor = guard.actor;

  const { id } = await params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: {
      tickets: {
        orderBy: { createdAt: "asc" },
        include: { invite: { select: { influencerId: true, guestEmail: true } } },
      },
    },
  });
  if (!event) return new Response("Bulunamadı", { status: 404 });
  const isAdmin = actor.role === "ADMIN" || actor.role === "AGENCY";
  if (!isAdmin && (!actor.brandId || !(await canBrandManageEvent(event, actor.brandId)))) {
    return new Response("Yetkisiz", { status: 403 });
  }

  const infIds = event.tickets.map((t) => t.invite?.influencerId).filter((x): x is string => !!x);
  const infs = infIds.length
    ? await prisma.influencer.findMany({
        where: { id: { in: infIds } },
        select: { id: true, name: true, user: { select: { email: true } } },
      })
    : [];
  const infMap = new Map(infs.map((i) => [i.id, i]));

  const esc = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const statusTr: Record<string, string> = { GECERLI: "Bekleniyor", KULLANILDI: "Geldi", IPTAL: "İptal" };
  const header = ["Katılımcı", "E-posta", "Bilet Kodu", "Durum", "Giriş Saati", "Oluşturulma"].map(esc).join(",");
  const rows = event.tickets.map((t) => {
    const inf = t.invite?.influencerId ? infMap.get(t.invite.influencerId) : null;
    const email = inf?.user?.email ?? t.invite?.guestEmail ?? "";
    return [
      inf?.name ?? t.holderName,
      email,
      t.code,
      statusTr[t.status] ?? t.status,
      t.checkedInAt ? t.checkedInAt.toISOString() : "",
      t.createdAt.toISOString().slice(0, 10),
    ]
      .map(esc)
      .join(",");
  });

  const csv = "\uFEFF" + [header, ...rows].join("\r\n") + "\r\n";
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="etkinlik-${id}-katilimcilar.csv"`,
      "cache-control": "no-store",
    },
  });
}

