import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { startAiVideoEditJob } from "@infulancer/core/creative/studio/jobQueue";
import { videoModelChoiceSchema } from "@infulancer/core/creative/studio/schemas";
import { requireApiActor } from "@/lib/auth-guard";
import { creativeTenantFor } from "@/lib/creative-tenant";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const editSchema = z.object({
  sourceUploadId: z.string().min(1).max(64),
  command: z.string().min(3).max(1000),
  rootJobId: z.string().max(64).optional(),
  modelChoice: videoModelChoiceSchema.optional(),
});

export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND", "INFLUENCER");
  if (auth.response) return auth.response;
  const rl = checkRateLimit(`pipeline-edit:${auth.actor.userId}`, 10, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);

  try {
    const body = await readJson(req, editSchema);
    const tenantId = await creativeTenantFor(auth.actor);
    const activeCount = await prisma.videoPipelineJob.count({
      where: { tenantId, status: { in: ["queued", "planning", "generating", "rendering"] } },
    });
    if (activeCount >= 2) {
      return Response.json({ error: "Aynı anda en fazla 2 video düzenleme işi çalıştırabilirsiniz." }, { status: 429 });
    }
    const job = await startAiVideoEditJob({
      tenantId,
      sourceUploadId: body.sourceUploadId,
      command: body.command,
      rootJobId: body.rootJobId,
      modelChoice: body.modelChoice,
    });
    return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

