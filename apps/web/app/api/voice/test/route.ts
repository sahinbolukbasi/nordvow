import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { recordVoiceCallLog } from "@infulancer/core/voice/callLogService";
import { synthesizeVoiceSpeech } from "@infulancer/core/voice/ttsService";
import { runVoiceAgentTurn } from "@infulancer/core/voice/voiceAgent";
import { businessHoursSchema, routingRuleSchema } from "@infulancer/core/voice/types";
import { requireApiActor } from "@/lib/auth-guard";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { resolveVoiceBrandId } from "@/lib/voice-brand";
import { errorResponse, jsonError, readJson } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const testSchema = z.object({
  brandId: z.string().optional(),
  question: z.string().min(2).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string() })).optional(),
  saveAsTestCall: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await requireApiActor("ADMIN", "BRAND");
  if (auth.response) return auth.response;
  const rl = checkRateLimit(`voice-test:${auth.actor.userId}`, 15, 60_000);
  if (!rl.ok) return rateLimitResponse(rl.retryAfterSec);
  try {
    const body = await readJson(req, testSchema);
    const brandId = await resolveVoiceBrandId(auth.actor, body.brandId ?? null);
    if (!brandId) return jsonError(400, "Marka bulunamadı.");

    const [brand, config] = await Promise.all([
      prisma.brand.findUnique({ where: { id: brandId }, select: { id: true, name: true } }),
      prisma.voiceAssistantConfig.upsert({ where: { brandId }, create: { brandId }, update: {} }),
    ]);

    const rules = Array.isArray(config.routingRules) ? config.routingRules.map((r) => routingRuleSchema.parse(r)) : [];
    const bh = config.businessHours ? businessHoursSchema.parse(config.businessHours) : null;

    const turn = await runVoiceAgentTurn({
      brandId,
      brandName: brand?.name ?? "Marka",
      assistantName: config.assistantName,
      tone: config.tone,
      blockedTopics: config.blockedTopics,
      utterance: body.question,
      history: body.history ?? [],
      routingRules: rules,
      businessHours: bh,
    });

    const speech = await synthesizeVoiceSpeech({
      text: turn.replyText,
      modelKey: config.ttsModelKey,
      voiceId: config.ttsVoiceId,
      format: "mp3",
    });

    if (body.saveAsTestCall) {
      await recordVoiceCallLog({
        brandId,
        callerPhone: "Web Test",
        calledPhone: config.connectPhoneNumber ?? "Test Simülasyonu",
        durationSec: 12,
        outcome: turn.intent.intent === "transfer" ? "transferred" : turn.intent.intent === "callback" ? "callback" : "resolved",
        transcript: [
          { role: "caller", text: body.question, at: new Date().toISOString() },
          { role: "assistant", text: turn.replyText, at: new Date().toISOString(), sources: turn.sources },
        ],
        sourcesUsed: turn.sources,
        unansweredQuestions: turn.unanswered ? [body.question] : [],
      }).catch(() => undefined);
    }

    return Response.json(
      {
        replyText: turn.replyText,
        sentences: turn.sentences,
        intent: turn.intent,
        sources: turn.sources,
        unanswered: turn.unanswered,
        audioBase64: Buffer.from(speech.bytes).toString("base64"),
        mime: speech.mime,
        provider: speech.provider,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

