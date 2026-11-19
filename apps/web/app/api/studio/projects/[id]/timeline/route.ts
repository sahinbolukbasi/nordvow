import { z } from "zod";
import { saveStudioProjectTimeline } from "@infulancer/core/creative/timeline-editor/store";
import { DomainError } from "@infulancer/core/domain/errors";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";

const saveTimelineSchema = z.object({
  expectedRevision: z.number().int().min(1).optional(),
  timeline: z.unknown(),
  versionLabel: z.string().max(80).optional(),
  createSnapshot: z.boolean().optional(),
});

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);
  const { id } = await params;

  try {
    const body = await readJson(req, saveTimelineSchema);
    const ifMatchRaw = req.headers.get("if-match")?.replace(/^W\/|"|'/g, "").trim();
    const headerRev = ifMatchRaw && /^\d+$/.test(ifMatchRaw) ? Number(ifMatchRaw) : undefined;
    const expectedRevision = body.expectedRevision ?? headerRev;
    if (!expectedRevision || expectedRevision < 1) {
      throw new DomainError("DOGRULAMA", "Kaydetme için expectedRevision veya If-Match başlığı zorunludur.");
    }
    const project = await saveStudioProjectTimeline({
      tenantId,
      projectId: id,
      userId: auth.actor.userId,
      expectedRevision,
      timeline: body.timeline,
      versionLabel: body.versionLabel,
      createSnapshot: body.createSnapshot,
    });
    return Response.json(
      { project },
      { headers: { ETag: String(project.revision), "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return studioErrorResponse(err);
  }
}
