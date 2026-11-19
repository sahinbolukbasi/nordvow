import { z } from "zod";
import {
  listStudioProjectVersions,
  restoreStudioProjectVersion,
} from "@infulancer/core/creative/timeline-editor/store";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";

const restoreSchema = z.object({
  versionId: z.string().min(1).max(64),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);
  const { id } = await params;

  try {
    const versions = await listStudioProjectVersions(tenantId, id);
    return Response.json({ versions }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return studioErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);
  const { id } = await params;

  try {
    const body = await readJson(req, restoreSchema);
    const project = await restoreStudioProjectVersion({
      tenantId,
      projectId: id,
      userId: auth.actor.userId,
      versionId: body.versionId,
    });
    return Response.json({ project }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return studioErrorResponse(err);
  }
}
