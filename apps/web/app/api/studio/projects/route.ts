import { z } from "zod";
import {
  BUILTIN_STUDIO_TEMPLATES,
  createStudioProject,
  listStudioProjects,
} from "@infulancer/core/creative/timeline-editor/store";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";

const createProjectSchema = z.object({
  title: z.string().max(120).optional(),
  aspectPreset: z.enum(["9:16", "1:1", "16:9", "4:5", "custom"]).optional(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]).optional(),
  templateId: z.string().max(64).nullish(),
  campaignId: z.string().max(64).nullish(),
  deliverableId: z.string().max(64).nullish(),
  initialAssetId: z.string().max(100).nullish(),
});

export async function GET() {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);

  try {
    const projects = await listStudioProjects(tenantId);
    const templates = BUILTIN_STUDIO_TEMPLATES.map(({ id, name, description, aspectPreset, durationSec, category }) => ({
      id,
      name,
      description,
      aspectPreset,
      durationSec,
      category,
    }));
    return Response.json({ projects, templates }, { headers: { "Cache-Control": "no-store" } });
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
    const body = await readJson(req, createProjectSchema);
    const project = await createStudioProject({
      tenantId,
      ownerUserId: auth.actor.userId,
      title: body.title,
      aspectPreset: body.aspectPreset,
      fps: body.fps,
      templateId: body.templateId ?? null,
      campaignId: body.campaignId ?? null,
      deliverableId: body.deliverableId ?? null,
      initialAssetId: body.initialAssetId ?? null,
    });
    return Response.json({ project }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return studioErrorResponse(err);
  }
}

