import {
  endpointToModelKey,
  FAL_ORCHESTRATOR_CATALOG,
  getComboPresetForTier,
  runStoryChatbotConverse,
} from "@infulancer/core/creative/orchestrator";
import { submitGeneration } from "@infulancer/core/creative/generate";
import type { Aspect } from "@infulancer/core/creative/adapters";
import { handleFalWebhook } from "@infulancer/core/creative/fal";
import { seedModelRegistry } from "@infulancer/core/creative/registry";
import { prisma } from "@infulancer/core/db";
import type { ChatTurn } from "@infulancer/core/llm/bedrock";
import { requireApiActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/creative/chat
 * AWS Bedrock Converse API (outputConfig.textFormat Structured Outputs) + fal.ai
 * Instagram Story & Sosyal Medya Görsel/Medya Üretim Chatbot Servisi.
 */
export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND", "INFLUENCER");
  if (auth.response) return auth.response;
  const tenantId = ownTenant(auth.actor);

  let body: {
    messages?: ChatTurn[];
    tier?: "economy" | "standard" | "pro";
    execute?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Geçersiz JSON gövdesi." }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) {
    return Response.json({ error: "messages dizisi boş olamaz." }, { status: 400 });
  }
  const tier = body.tier === "pro" || body.tier === "standard" ? body.tier : "economy";

  const structured = await runStoryChatbotConverse({
    messages,
    tier,
    forceReady: Boolean(body.execute),
  });

  const spec = FAL_ORCHESTRATOR_CATALOG.find((c) => c.endpoint === structured.fal_payload.model_endpoint);
  const combo = getComboPresetForTier(tier);

  if (structured.status === "ready" && body.execute) {
    const modelKey = endpointToModelKey(structured.fal_payload.model_endpoint);
    const exists = await prisma.modelRegistry.findUnique({ where: { key: modelKey }, select: { key: true } });
    if (!exists) await seedModelRegistry().catch(() => undefined);

    const job = await submitGeneration({
      tenantId,
      modelKey,
      prompt: structured.fal_payload.prompt,
      aspect: structured.fal_payload.aspect_ratio as Aspect,
    });

    if ((process.env.FAL_MODE ?? "http") === "mock" && job.requestId) {
      await handleFalWebhook({
        request_id: job.requestId,
        status: "OK",
        payload: spec?.category === "video"
          ? { video: { url: `studio://video/${job.requestId}` } }
          : { images: [{ url: `studio://image/${job.requestId}` }] },
        metrics: { inference_time: 1.0 },
      }).catch(() => undefined);
    }

    const asset = await prisma.generatedAsset.findFirst({ where: { jobId: job.id }, select: { id: true } });
    return Response.json({
      ...structured,
      estimated_unit_cost: spec?.unitLabel ?? "$0.003/MP",
      combo_recommendation: combo,
      job_id: job.id,
      asset_id: asset?.id ?? null,
    });
  }

  return Response.json({
    ...structured,
    estimated_unit_cost: spec?.unitLabel ?? "$0.003/MP",
    combo_recommendation: combo,
  });
}

