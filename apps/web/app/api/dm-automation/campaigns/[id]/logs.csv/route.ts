import {
  DM_LOG_STATUS_LABELS,
  listDmCampaignLogs,
  recordDmAudit,
} from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  checkUserActionRateLimit,
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csvCell(val: unknown): string {
  const raw = String(val ?? "");
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  const limited = checkUserActionRateLimit(auth.actor.userId, "csv_export", 10);
  if (limited) return limited;

  try {
    const { id } = await params;
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "admin", { campaignId: id });
    if (denied) return denied;

    const logs = await listDmCampaignLogs(tenantId, id, { limit: 5000 });
    await recordDmAudit(tenantId, auth.actor.userId, "logs.export_csv", id, { count: logs.length });

    const lines = [
      `# KVKK AYDINLATMA NOTU: Bu dosya kisisel veri icerir (IG kullanici adi, yorum metni). Yalnizca talep edilen icerik teslimati ve istatistik amaciyla islenir; yetkisiz paylasim yasaktir.`,
      ["Zaman", "Kaynak", "Kullanici", "Yorum", "Anahtar Kelime", "Durum", "Aciklama", "Herkese Acik Yanit", "Hata"].map(csvCell).join(","),
      ...logs.map((l) =>
        [
          l.createdAt,
          l.source,
          l.recipientUsername ? `@${l.recipientUsername}` : l.recipientIgsid,
          l.triggerText ?? "[90 gun sonra maskelendi]",
          l.matchedKeyword ?? "",
          l.status,
          DM_LOG_STATUS_LABELS[l.status] ?? l.status,
          l.publicReplySentAt ? l.publicReplyText ?? "Gonderildi" : "",
          l.errorMessage ?? "",
        ]
          .map(csvCell)
          .join(","),
      ),
    ];

    const bom = "\uFEFF";
    return new Response(bom + lines.join("\r\n"), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="dm-otomasyonu-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

