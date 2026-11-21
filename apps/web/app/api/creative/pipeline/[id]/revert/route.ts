import { z } from "zod";
import { revertVideoToVersion } from "@infulancer/core/creative/studio/jobQueue";
import { requireApiActor } from "@/lib/auth-guard";
import { creativeTenantFor } from "@/lib/creative-tenant";
import { errorResponse, readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const revertSchema = z.object({ versionId: z.string().min(1).max(64) });

export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND", "INFLUENCER");
  if (auth.response) return auth.response;

  try {
    const body = await readJson(req, revertSchema);
    const tenantId = await creativeTenantFor(auth.actor);
    const version = await revertVideoToVersion(tenantId, body.versionId);
    return Response.json({ version }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

