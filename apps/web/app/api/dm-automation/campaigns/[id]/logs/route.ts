import {
  DM_LOG_STATUS_LABELS,
  listDmCampaignLogs,
  type DmLogStatus,
} from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const { id } = await params;
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "view", { campaignId: id });
    if (denied) return denied;

    const url = new URL(req.url);
    const status = (url.searchParams.get("status")?.trim() || "ALL") as DmLogStatus | "ALL";
    const q = url.searchParams.get("q")?.trim() || undefined;
    const limit = Math.min(500, Math.max(10, Number(url.searchParams.get("limit") ?? 100) || 100));

    const logs = await listDmCampaignLogs(tenantId, id, { status, q, limit });
    return Response.json(
      { logs, statusLabels: DM_LOG_STATUS_LABELS },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return dmErrorResponse(err);
  }
}

