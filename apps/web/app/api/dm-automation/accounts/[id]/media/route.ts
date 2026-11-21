import { listIgAccountMedia } from "@infulancer/core/dm-automation/store";
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
    const denied = await verifyDmApiAccess(auth.actor, tenantId, "view", { igAccountId: id });
    if (denied) return denied;

    const cursor = new URL(req.url).searchParams.get("cursor") ?? undefined;
    const data = await listIgAccountMedia(tenantId, id, cursor);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return dmErrorResponse(err);
  }
}

