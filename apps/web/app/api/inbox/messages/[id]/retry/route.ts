import { retryFailedInboxMessage } from "@infulancer/core/inbox/store";
import { requireApiActor } from "@/lib/auth-guard";
import {
  inboxDisabledResponse,
  inboxErrorResponse,
  resolveActorInboxTenant,
} from "@/lib/inbox-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = inboxDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const { id } = await params;

  try {
    const tenantId = await resolveActorInboxTenant(auth.actor, req.url);
    const updated = await retryFailedInboxMessage(tenantId, id, auth.actor.userId);
    return Response.json({ message: updated }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}
