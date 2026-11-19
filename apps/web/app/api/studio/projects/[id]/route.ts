import { z } from "zod";
import {
  deleteStudioProject,
  getStudioProject,
  updateStudioProjectMeta,
} from "@infulancer/core/creative/timeline-editor/store";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  campaignId: z.string().max(64).nullish(),
  deliverableId: z.string().max(64).nullish(),
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);
  const { id } = await params;

  try {
    const project = await getStudioProject(tenantId, id);
    return Response.json(
      { project },
      { headers: { ETag: String(project.revision), "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return studioErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);
  const { id } = await params;

  try {
    const body = await readJson(req, patchSchema);
    const project = await updateStudioProjectMeta(tenantId, id, body);
    return Response.json({ project }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return studioErrorResponse(err);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);
  const { id } = await params;

  try {
    await deleteStudioProject(tenantId, id);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return studioErrorResponse(err);
  }
}
