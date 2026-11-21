import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { generateStoryboardFromPhotos } from "@infulancer/core/creative/studio/storyboardService";
import { startPhotoToVideoJob } from "@infulancer/core/creative/studio/jobQueue";
import { aspectSchema, storyboardSchema, videoModelChoiceSchema } from "@infulancer/core/creative/studio/schemas";
import { requireApiActor } from "@/lib/auth-guard";
import { creativeTenantFor } from "@/lib/creative-tenant";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  mode: z.enum(["storyboard", "start"]).default("storyboard"),
  uploadIds: z.array(z.string().min(1)).min(1).max(20),
  aspect: aspectSchema.optional(),
  modelChoice: videoModelChoiceSchema.optional(),
  goal: z.string().max(500).optional(),
  musicStyle: z.string().max(120).optional(),
  defaultDurationSec: z.number().int().min(3).max(10).optional(),
  logoUploadId: z.string().max(64).nullable().optional(),
  storyboard: storyboardSchema.optional(),
});

export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND", "INFLUENCER");
  if (auth.response) return auth.response;
  const rl = checkRateLimit(`pipeline-p2v:${auth.actor.userId}`, 10, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  try {
    const body = await readJson(req, bodySchema);
    const tenantId = await creativeTenantFor(auth.actor);
    const aspect = body.aspect ?? "9:16";
    const modelChoice = body.modelChoice ?? "hailuo";

    if (body.mode === "storyboard") {
      const res = await generateStoryboardFromPhotos({
        tenantId,
        uploadIds: body.uploadIds,
        aspect,
        goal: body.goal,
        musicStyle: body.musicStyle,
        defaultDurationSec: body.defaultDurationSec,
      });
      return Response.json(res, { headers: { "Cache-Control": "no-store" } });
    }

    const activeCount = await prisma.videoPipelineJob.count({
      where: { tenantId, status: { in: ["queued", "planning", "generating", "rendering"] } },
    });
    if (activeCount >= 2) {
      return Response.json({ error: "Aynı anda en fazla 2 video üretim işi başlatabilirsiniz." }, { status: 429 });
    }

    const job = await startPhotoToVideoJob({
      tenantId,
      uploadIds: body.uploadIds,
      modelChoice,
      aspect,
      storyboard: body.storyboard,
      goal: body.goal,
      musicStyle: body.musicStyle,
      defaultDurationSec: body.defaultDurationSec,
      logoUploadId: body.logoUploadId ?? null,
    });
    return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

