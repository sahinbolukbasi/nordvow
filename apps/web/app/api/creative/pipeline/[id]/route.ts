import { getPipelineJobWithReconcile } from "@infulancer/core/creative/studio/jobQueue";
import { requireApiActor } from "@/lib/auth-guard";
import { creativeTenantFor } from "@/lib/creative-tenant";
import { jsonError } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiActor("ADMIN", "BRAND", "INFLUENCER");
  if (auth.response) return auth.response;

  const { id } = await params;
  const tenantId = await creativeTenantFor(auth.actor);
  const job = await getPipelineJobWithReconcile(tenantId, id);
  if (!job) return jsonError(404, "İş bulunamadı.");

  return Response.json(
    {
      id: job.id,
      kind: job.kind,
      status: job.status,
      progress: job.progress,
      aspect: job.aspect,
      modelKey: job.modelKey,
      storyboard: job.storyboard,
      editPlan: job.editPlan,
      sceneJobs: job.sceneJobs,
      outputUploadId: job.outputUploadId,
      rootJobId: job.rootJobId,
      versionNumber: job.versionNumber,
      costUsd: Number(job.costUsd),
      durationMs: job.durationMs,
      error: job.error,
      versions: job.versions,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

