import {
  listDmOptOuts,
  removeDmOptOut,
} from "@infulancer/core/dm-automation/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  dmErrorResponse,
  resolveActorDmTenant,
  verifyDmApiAccess,
} from "@/lib/dm-automation-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "view");
    if (denied) return denied;

    const accountId = new URL(req.url).searchParams.get("accountId")?.trim() || undefined;
    const optOuts = await listDmOptOuts(tenantId, accountId);
    return Response.json({ optOuts }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

export async function DELETE(req: Request) {
  const auth = await requireApiActor();
  if (auth.response) return auth.response;

  try {
    const tenantId = await resolveActorDmTenant(auth.actor, req.url);
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "edit");
    if (denied) return denied;

    const url = new URL(req.url);
    const accountId = url.searchParams.get("accountId")?.trim() ?? "";
    const igsid = url.searchParams.get("igsid")?.trim() ?? "";
    if (!accountId || !igsid) {
      return Response.json(
        { error: { code: "DOGRULAMA", message: "accountId ve igsid parametreleri gereklidir." } },
        { status: 400 },
      );
    }
    await removeDmOptOut(tenantId, accountId, igsid, auth.actor.userId);
    return Response.json({ removed: true });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

