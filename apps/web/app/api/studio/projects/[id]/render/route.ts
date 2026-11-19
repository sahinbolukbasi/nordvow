import { z } from "zod";
import { renderStudioTimelineProject } from "@infulancer/core/creative/timeline-editor/compile-ffmpeg";
import {
  getStudioProject,
  submitProjectRenderToCampaign,
} from "@infulancer/core/creative/timeline-editor/store";
import {
  assertLockedBrandLayersIntact,
  studioTimelineSchema,
} from "@infulancer/core/creative/timeline-editor/timeline-schema";
import { presignCreativeGet } from "@infulancer/core/creative/uploads";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 300;

const renderBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("submit"),
    uploadId: z.string().min(1).max(100),
    campaignId: z.string().max(64).nullish(),
    deliverableId: z.string().max(64).nullish(),
  }),
  z.object({
    action: z.literal("export").optional(),
    quality: z.enum(["draft", "standard", "high"]).optional(),
    label: z.string().max(120).optional(),
    timeline: z.unknown().optional(),
  }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);
  const { id } = await params;

  try {
    const body = await readJson(req, renderBodySchema);
    if (body.action === "submit") {
      const submitted = await submitProjectRenderToCampaign({
        tenantId,
        userId: auth.actor.userId,
        projectId: id,
        uploadId: body.uploadId,
        campaignId: body.campaignId ?? null,
        deliverableId: body.deliverableId ?? null,
      });
      return Response.json({ submitted }, { headers: { "Cache-Control": "no-store" } });
    }

    const project = await getStudioProject(tenantId, id);
    let timeline = project.timeline;
    if (body.timeline !== undefined) {
      const parsed = studioTimelineSchema.parse(body.timeline);
      assertLockedBrandLayersIntact(project.timeline, parsed);
      timeline = parsed;
    }

    const render = await renderStudioTimelineProject({
      tenantId,
      projectId: id,
      timeline,
      quality: body.quality ?? "standard",
      label: body.label ?? project.title,
    });
    const downloadUrl = await presignCreativeGet(render.s3Key);
    return Response.json(
      { render: { ...render, downloadUrl } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return studioErrorResponse(err);
  }
}

