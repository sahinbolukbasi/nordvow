import {
  acceptStudioConsent,
  CURRENT_CONSENT_VERSION,
  getStudioConsent,
} from "@infulancer/core/creative/timeline-editor/store";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";

export const runtime = "nodejs";

export async function GET() {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);

  try {
    const consent = await getStudioConsent(tenantId, auth.actor.userId);
    return Response.json(
      { consent, requiredVersion: CURRENT_CONSENT_VERSION },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return studioErrorResponse(err);
  }
}

export async function POST(req: Request) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);

  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null;
    const userAgent = req.headers.get("user-agent") ?? null;
    const consent = await acceptStudioConsent({
      tenantId,
      userId: auth.actor.userId,
      ip,
      userAgent,
    });
    return Response.json({ consent }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return studioErrorResponse(err);
  }
}

