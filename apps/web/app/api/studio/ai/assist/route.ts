import { z } from "zod";
import { submitGeneration } from "@infulancer/core/creative/generate";
import { runStudioBedrockAssist } from "@infulancer/core/creative/timeline-editor/compile-ffmpeg";
import { getStudioConsent } from "@infulancer/core/creative/timeline-editor/store";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 120;

const transcriptSegSchema = z.object({
  id: z.string().min(1).max(64),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  text: z.string().max(400),
});

const assistSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.enum(["hooks", "script", "highlights", "broll"]),
    brief: z.string().max(600).optional(),
    durationSec: z.number().min(5).max(180).optional(),
    product: z.string().max(200).optional(),
    segments: z.array(transcriptSegSchema).max(200).optional(),
  }),
  z.object({
    mode: z.literal("generate"),
    modelKey: z.string().min(1).max(64),
    prompt: z.string().min(3).max(800),
    aspect: z.enum(["9:16", "1:1", "4:5", "16:9"]).default("9:16"),
    seconds: z.number().int().min(3).max(15).optional(),
    referenceUploadIds: z.array(z.string().max(100)).max(4).optional(),
    portrait: z.boolean().optional(),
  }),
]);

export async function POST(req: Request) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);

  try {
    const body = await readJson(req, assistSchema);
    if (body.mode === "generate") {
      const consent = await getStudioConsent(tenantId, auth.actor.userId);
      if (!consent) {
        return Response.json(
          {
            error:
              "Görsel/video üretimi için yurt dışı AI sağlayıcısına (fal.ai) veri aktarımı KVKK m.9 açık rızası gereklidir.",
            code: "CONSENT_REQUIRED",
          },
          { status: 428, headers: { "Cache-Control": "no-store" } },
        );
      }

      const job = await submitGeneration({
        tenantId,
        modelKey: body.modelKey,
        prompt: body.prompt,
        aspect: body.aspect,
        seconds: body.seconds,
        referenceUploadIds: body.referenceUploadIds,
        portrait: body.portrait,
      });
      return Response.json({ job }, { headers: { "Cache-Control": "no-store" } });
    }

    const result = await runStudioBedrockAssist({
      mode: body.mode,
      brief: body.brief,
      durationSec: body.durationSec,
      product: body.product,
      segments: body.segments,
    });
    return Response.json({ result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return studioErrorResponse(err);
  }
}
