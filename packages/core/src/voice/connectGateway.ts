import { prisma } from "../db";
import { createVoiceCallbackRequest, recordVoiceCallLog } from "./callLogService";
import { getOrCacheGreetingAudio, synthesizeVoiceSpeech } from "./ttsService";
import { VadStreamController } from "./sttService";
import { runVoiceAgentTurn } from "./voiceAgent";
import { businessHoursSchema, routingRuleSchema, type TranscriptTurn } from "./types";

export async function resolveBrandByConnectPhone(calledPhone: string) {
  const clean = calledPhone.replace(/[^\d+]/g, "");
  let cfg =
    (clean ? await prisma.voiceAssistantConfig.findFirst({ where: { connectPhoneNumber: clean, active: true } }) : null) ??
    (await prisma.voiceAssistantConfig.findFirst({ where: { active: true }, orderBy: { updatedAt: "desc" } }));
  if (!cfg) {
    const firstBrand = await prisma.brand.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true, name: true } });
    if (!firstBrand) return null;
    cfg = await prisma.voiceAssistantConfig.create({
      data: {
        brandId: firstBrand.id,
        connectPhoneNumber: clean || "+442038631184",
        active: true,
      },
    });
    return { config: cfg, brand: firstBrand };
  }
  const brand = await prisma.brand.findUnique({ where: { id: cfg.brandId }, select: { id: true, name: true } });
  return brand ? { config: cfg, brand } : null;
}

/**
 * Amazon Connect Contact Flow / Lambda / KVS Medya Akışı Ağ Geçidi:
 *  - `event: "call_start"`: Markayı aranan numaradan çözer, önbellekteki 8kHz karşılama sesini hazırlar.
 *  - `event: "utterance"`: Transcribe'dan gelen arayan cümlesini işler; niyet yönlendirmesi veya RAG yanıtı + cümle bazlı 8kHz TTS döndürür.
 *  - `event: "call_end"`: Transkripti, Bedrock özetini, kullanılan kaynakları ve geri dönüş talebini kaydeder.
 */
export async function handleConnectGatewayEvent(input: {
  event: "call_start" | "utterance" | "call_end";
  contactId: string;
  calledPhone?: string;
  callerPhone?: string;
  utterance?: string;
  history?: { role: "user" | "assistant"; text: string }[];
  skipTts?: boolean;
  durationSec?: number;
  outcome?: "resolved" | "transferred" | "callback" | "missed";
  transcript?: TranscriptTurn[];
  unansweredQuestions?: string[];
  callbackTopic?: string;
  callerName?: string;
}) {
  const resolved = await resolveBrandByConnectPhone(input.calledPhone ?? "");
  if (!resolved) {
    return { ok: false, error: "Bu numara ile eşleşen aktif marka sesli asistanı bulunamadı." };
  }
  const { config, brand } = resolved;

  if (input.event === "call_start") {
    const greeting = await getOrCacheGreetingAudio({
      brandId: brand.id,
      greetingText: config.greetingText,
      modelKey: config.ttsModelKey,
      voiceId: config.ttsVoiceId,
    });
    return {
      ok: true,
      action: "play_greeting",
      brandId: brand.id,
      brandName: brand.name,
      greetingText: config.greetingText,
      greetingCacheKey: greeting.s3Key,
      audioBase64: Buffer.from(greeting.bytes).toString("base64"),
      mime: "audio/wav",
      vad: new VadStreamController(),
    };
  }

  if (input.event === "utterance") {
    const rules = Array.isArray(config.routingRules)
      ? config.routingRules.map((r) => routingRuleSchema.parse(r))
      : [];
    const bh = config.businessHours ? businessHoursSchema.parse(config.businessHours) : null;

    const turn = await runVoiceAgentTurn({
      brandId: brand.id,
      brandName: brand.name,
      assistantName: config.assistantName,
      tone: config.tone,
      blockedTopics: config.blockedTopics,
      utterance: input.utterance ?? "",
      history: input.history ?? [],
      routingRules: rules,
      businessHours: bh,
    });

    // Cümle cümle 8kHz telefon sesine dönüştür (Lex V2 kendi TTS'ini kullanıyorsa skipTts=true ile atlanır)
    const audioChunks = input.skipTts
      ? []
      : await Promise.all(
          turn.sentences.map(async (sentence) => {
            const tts = await synthesizeVoiceSpeech({
              text: sentence,
              modelKey: config.ttsModelKey,
              voiceId: config.ttsVoiceId,
              format: "wav8k",
            });
            return {
              sentence,
              audioBase64: Buffer.from(tts.bytes).toString("base64"),
              mime: tts.mime,
              provider: tts.provider,
            };
          }),
        );

    if (turn.intent.intent === "callback" && input.callerPhone) {
      await createVoiceCallbackRequest({
        brandId: brand.id,
        callerName: input.callerName ?? null,
        callerPhone: input.callerPhone,
        topic: input.utterance || "Geri dönüş talebi",
      }).catch(() => undefined);
    }

    return {
      ok: true,
      action: turn.intent.intent === "transfer" ? "transfer" : turn.intent.intent === "goodbye" ? "hangup" : "speak",
      replyText: turn.replyText,
      intent: turn.intent,
      transferTarget: turn.intent.transferTarget ?? null,
      sources: turn.sources,
      unanswered: turn.unanswered,
      audioChunks,
    };
  }

  // call_end
  const transcript = input.transcript ?? [];
  const allSources = transcript.flatMap((t) => t.sources ?? []);
  const callLog = await recordVoiceCallLog({
    brandId: brand.id,
    contactId: input.contactId,
    callerPhone: input.callerPhone ?? null,
    calledPhone: input.calledPhone ?? null,
    durationSec: input.durationSec ?? 0,
    outcome: input.outcome ?? "resolved",
    transcript,
    sourcesUsed: allSources,
    unansweredQuestions: input.unansweredQuestions ?? [],
  });

  if (input.outcome === "callback" && input.callerPhone) {
    await createVoiceCallbackRequest({
      brandId: brand.id,
      callLogId: callLog.id,
      callerName: input.callerName ?? null,
      callerPhone: input.callerPhone,
      topic: input.callbackTopic ?? callLog.summary ?? "Geri dönüş talebi",
    }).catch(() => undefined);
  }

  return { ok: true, callLogId: callLog.id };
}

