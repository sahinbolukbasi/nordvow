import { generateInboxAiSuggestions } from "@infulancer/core/inbox/store";
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
    const result = await generateInboxAiSuggestions({
      tenantId,
      conversationId: id,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return inboxErrorResponse(err);
  }
}
