import { prisma } from "../db";
import { envStr } from "../env";
import { converseChat } from "../llm/bedrock";
import { syncBrandFaqsToKb } from "./knowledgeIngestion";
import type { RetrievedChunk, TranscriptTurn } from "./types";

export async function summarizeCallWithBedrock(transcript: TranscriptTurn[]): Promise<string> {
  if (!transcript.length) return "Görüşme kaydı.";
  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const text = transcript.map((t) => `${t.role === "caller" ? "Arayan" : "Asistan"}: ${t.text}`).join("\n");
      const res = await converseChat({
        system: "Aşağıdaki telefon görüşmesi transkriptini 1-2 cümlelik net Türkçe yönetici özeti haline getir.",
        turns: [{ role: "user", text: text.slice(0, 4000) }],
        maxTokens: 140,
        temperature: 0.2,
      });
      if (res.text.trim()) return res.text.trim();
    } catch {
      /* fallback */
    }
  }
  const firstCaller = transcript.find((t) => t.role === "caller")?.text ?? "";
  return firstCaller ? `Arayan sorusu: "${firstCaller.slice(0, 120)}"` : "Sesli asistan görüşmesi tamamlandı.";
}

export async function recordVoiceCallLog(input: {
  brandId: string;
  contactId?: string | null;
  callerPhone?: string | null;
  calledPhone?: string | null;
  durationSec: number;
  outcome: "resolved" | "transferred" | "callback" | "missed";
  transcript: TranscriptTurn[];
  sourcesUsed: RetrievedChunk[];
  recordingS3Key?: string | null;
  unansweredQuestions?: string[];
}) {
  const summary = await summarizeCallWithBedrock(input.transcript);
  if (input.contactId) {
    return prisma.voiceCallLog.upsert({
      where: { contactId: input.contactId },
      create: {
        brandId: input.brandId,
        contactId: input.contactId,
        callerPhone: input.callerPhone ?? null,
        calledPhone: input.calledPhone ?? null,
        durationSec: input.durationSec,
        outcome: input.outcome,
        summary,
        transcript: input.transcript,
        sourcesUsed: input.sourcesUsed,
        recordingS3Key: input.recordingS3Key ?? null,
        unansweredQuestions: input.unansweredQuestions ?? [],
      },
      update: {
        durationSec: input.durationSec,
        outcome: input.outcome,
        summary,
        transcript: input.transcript,
        sourcesUsed: input.sourcesUsed,
        recordingS3Key: input.recordingS3Key ?? null,
        unansweredQuestions: input.unansweredQuestions ?? [],
      },
    });
  }
  return prisma.voiceCallLog.create({
    data: {
      brandId: input.brandId,
      callerPhone: input.callerPhone ?? null,
      calledPhone: input.calledPhone ?? null,
      durationSec: input.durationSec,
      outcome: input.outcome,
      summary,
      transcript: input.transcript,
      sourcesUsed: input.sourcesUsed,
      recordingS3Key: input.recordingS3Key ?? null,
      unansweredQuestions: input.unansweredQuestions ?? [],
    },
  });
}

export async function createVoiceCallbackRequest(input: {
  brandId: string;
  callLogId?: string | null;
  callerName?: string | null;
  callerPhone: string;
  topic: string;
}) {
  return prisma.voiceCallbackRequest.create({
    data: {
      brandId: input.brandId,
      callLogId: input.callLogId ?? null,
      callerName: input.callerName ?? null,
      callerPhone: input.callerPhone,
      topic: input.topic.slice(0, 500),
    },
  });
}

/** Cevaplanamayan bir soruyu tek tıkla markanın SSS listesine ekler ve KB'yi senkronize eder. */
export async function promoteQuestionToFaq(input: { brandId: string; question: string; answer: string }) {
  const item = await prisma.voiceFaqItem.create({
    data: {
      brandId: input.brandId,
      question: input.question.trim(),
      answer: input.answer.trim(),
      active: true,
    },
  });
  void syncBrandFaqsToKb(input.brandId);
  return item;
}

