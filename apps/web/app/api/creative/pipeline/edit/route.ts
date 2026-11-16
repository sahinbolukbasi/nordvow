import { z } from "zod";
import { startAiVideoEditJob } from "@infulancer/core/creative/studio/jobQueue";
import { videoModelChoiceSchema } from "@infulancer/core/creative/studio/schemas";
import { requireApiActor } from "@/lib/auth-guard";
import { creativeTenantFor } from "@/lib/creative-tenant";
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

  try {
    const body = await readJson(req, editSchema);
    const tenantId = await creativeTenantFor(auth.actor);
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

