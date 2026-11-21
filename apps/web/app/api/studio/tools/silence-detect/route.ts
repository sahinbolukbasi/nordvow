import { z } from "zod";
import { detectAssetSilence } from "@infulancer/core/creative/timeline-editor/compile-ffmpeg";
import { computeSilenceKeepIntervals } from "@infulancer/core/creative/timeline-editor/ops";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";

const silenceSchema = z.object({
  assetId: z.string().min(1).max(100),
  thresholdDb: z.number().min(-60).max(-10).optional(),
  minSilenceSec: z.number().min(0.2).max(5).optional(),
  marginSec: z.number().min(0.02).max(0.5).optional(),
});

export async function POST(req: Request) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);

  try {
    const body = await readJson(req, silenceSchema);
    const res = await detectAssetSilence(tenantId, body.assetId, {
      thresholdDb: body.thresholdDb,
      minSilenceSec: body.minSilenceSec,
    });
    const keepIntervals = computeSilenceKeepIntervals(
      res.durationSec,
      res.silences,
      body.marginSec ?? 0.12,
    );
    return Response.json(
      { silences: res.silences, durationSec: res.durationSec, keepIntervals },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return studioErrorResponse(err);
  }
}

