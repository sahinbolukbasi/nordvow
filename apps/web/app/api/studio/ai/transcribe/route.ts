import { z } from "zod";
import { transcribeAssetWithAi } from "@infulancer/core/creative/timeline-editor/compile-ffmpeg";
import { getStudioConsent } from "@infulancer/core/creative/timeline-editor/store";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { studioDisabledResponse, studioErrorResponse } from "@/lib/studio-api";
import { readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const maxDuration = 120;

const transcribeSchema = z.object({
  assetId: z.string().min(1).max(100),
  language: z.string().max(8).optional(),
  fixWithLlm: z.boolean().optional(),
  brandGlossary: z.array(z.string().max(64)).max(25).optional(),
});

export async function POST(req: Request) {
  const disabled = studioDisabledResponse();
  if (disabled) return disabled;
  const auth = await requireApiActor();
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);

  try {
    const consent = await getStudioConsent(tenantId, auth.actor.userId);
    if (!consent) {
      return Response.json(
        {
          error:
            "Ses verisinin yurt dışı AI sağlayıcısına (fal.ai) aktarımı için KVKK m.9 açık rıza onayı gereklidir.",
          code: "CONSENT_REQUIRED",
        },
        { status: 428, headers: { "Cache-Control": "no-store" } },
      );
    }

    const body = await readJson(req, transcribeSchema);
    const result = await transcribeAssetWithAi(tenantId, body.assetId, {
      language: body.language ?? "tr",
      fixWithLlm: body.fixWithLlm ?? true,
      brandGlossary: body.brandGlossary,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return studioErrorResponse(err);
  }
}

