import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyAssistantIntent, type AssistantIntent } from "../intent-router";
import { detectInternalLeaks, findFabricatedFacts } from "../output-validator";
import { lexicalCoverage } from "../rag";
import {
  CAMPAIGN_STATUS_VERIFY_REPLY,
  COMPLAINT_HANDOFF_MESSAGE,
  CREATOR_APPLICATION_REPLY,
  HANDOFF_MESSAGE,
} from "../runtime";

export interface EvalCase {
  id: string;
  question: string;
  expectedIntent: AssistantIntent;
  requiredInfo: string[];
  shouldHandoff: boolean;
  category: string;
}

export interface EvalKnowledgeDoc {
  id: string;
  title: string;
  content: string;
}

export interface EvalDataset {
  version: string;
  thresholds: {
    minIntentAccuracy: number;
    minRequiredInfoRate: number;
    maxFabricatedNumbers: number;
    maxInternalLeaks: number;
    minHandoffAccuracy: number;
  };
  sampleApprovedKnowledge: EvalKnowledgeDoc[];
  cases: EvalCase[];
}

export interface EvalCaseResult {
  id: string;
  question: string;
  expectedIntent: AssistantIntent;
  actualIntent: AssistantIntent;
  intentMatch: boolean;
  expectedHandoff: boolean;
  actualHandoff: boolean;
  handoffMatch: boolean;
  requiredInfoMet: boolean;
  fabricatedValues: string[];
  internalLeaks: string[];
  reply: string;
}

export interface EvalSummaryReport {
  version: string;
  totalCases: number;
  intentAccuracy: number;
  requiredInfoRate: number;
  handoffAccuracy: number;
  fabricatedNumberCount: number;
  internalLeakCount: number;
  passed: boolean;
  failures: string[];
  results: EvalCaseResult[];
}

export function loadDefaultEvalDataset(): EvalDataset {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const raw = fs.readFileSync(path.join(dir, "dataset.json"), "utf-8");
  return JSON.parse(raw) as EvalDataset;
}

/**
 * Veritabanı veya harici ağ olmadan tamamen deterministik değerlendirme koşucusu.
 * CI pipeline'ında her prompt/model/yönlendirici değişikliğinde güvenle koşar.
 */
export function runAssistantEval(dataset: EvalDataset = loadDefaultEvalDataset()): EvalSummaryReport {
  const kb = dataset.sampleApprovedKnowledge;
  const results: EvalCaseResult[] = [];

  for (const c of dataset.cases) {
    const intentRes = classifyAssistantIntent(c.question);
    let actualHandoff = false;
    let reply = "";
    let allowedContext = "";

    const piiHit = /\b(?:iban|tckn|kart\s+numara|cvv)\b/i.test(c.question);

    if (intentRes.intent === "sikayet") {
      actualHandoff = true;
      reply = COMPLAINT_HANDOFF_MESSAGE;
    } else if (piiHit) {
      actualHandoff = true;
      reply = HANDOFF_MESSAGE;
    } else if (intentRes.intent === "basvuru") {
      reply = CREATOR_APPLICATION_REPLY;
      allowedContext = CREATOR_APPLICATION_REPLY;
    } else if (intentRes.intent === "kargo") {
      if (intentRes.extractedOrderCode) {
        actualHandoff = true;
        reply = HANDOFF_MESSAGE;
      } else {
        reply = "Kargonuzun durumunu kontrol edebilmem için lütfen sipariş veya kargo takip numaranızı paylaşır mısınız?";
        allowedContext = reply;
      }
    } else if (intentRes.intent === "kampanya_durumu") {
      reply = CAMPAIGN_STATUS_VERIFY_REPLY;
      allowedContext = CAMPAIGN_STATUS_VERIFY_REPLY;
    } else if (intentRes.intent === "fiyat" && intentRes.needsCustomQuote) {
      actualHandoff = true;
      reply = HANDOFF_MESSAGE;
    } else {
      // Onaylı bilgi tabanı lexical arama
      const scored = kb
        .map((doc) => ({ doc, score: lexicalCoverage(c.question, `${doc.title} ${doc.content}`) }))
        .sort((a, b) => b.score - a.score);
      const top = scored[0];
      if (!top || top.score < 0.25) {
        actualHandoff = true;
        reply = HANDOFF_MESSAGE;
      } else {
        reply = top.doc.content;
        allowedContext = top.doc.content;
      }
    }

    const intentMatch = intentRes.intent === c.expectedIntent;
    const handoffMatch = actualHandoff === c.shouldHandoff;
    const replyLower = reply.toLocaleLowerCase("tr");
    const requiredInfoMet =
      c.requiredInfo.length === 0 ||
      c.requiredInfo.some((token) => replyLower.includes(token.toLocaleLowerCase("tr")));
    const fabricatedValues = actualHandoff ? [] : findFabricatedFacts(reply, allowedContext);
    const internalLeaks = detectInternalLeaks(reply);

    results.push({
      id: c.id,
      question: c.question,
      expectedIntent: c.expectedIntent,
      actualIntent: intentRes.intent,
      intentMatch,
      expectedHandoff: c.shouldHandoff,
      actualHandoff,
      handoffMatch,
      requiredInfoMet,
      fabricatedValues,
      internalLeaks,
      reply,
    });
  }

  const totalCases = results.length;
  const intentAccuracy = totalCases ? results.filter((r) => r.intentMatch).length / totalCases : 0;
  const casesWithReq = results.filter((_, idx) => (dataset.cases[idx]?.requiredInfo.length ?? 0) > 0);
  const requiredInfoRate = casesWithReq.length
    ? casesWithReq.filter((r) => r.requiredInfoMet).length / casesWithReq.length
    : 1;
  const handoffAccuracy = totalCases ? results.filter((r) => r.handoffMatch).length / totalCases : 0;
  const fabricatedNumberCount = results.reduce((sum, r) => sum + r.fabricatedValues.length, 0);
  const internalLeakCount = results.reduce((sum, r) => sum + r.internalLeaks.length, 0);

  const failures: string[] = [];
  if (intentAccuracy < dataset.thresholds.minIntentAccuracy) {
    failures.push(`Niyet doğruluğu eşik altında: ${(intentAccuracy * 100).toFixed(1)}% < ${(dataset.thresholds.minIntentAccuracy * 100).toFixed(1)}%`);
  }
  if (requiredInfoRate < dataset.thresholds.minRequiredInfoRate) {
    failures.push(`Zorunlu bilgi oranı eşik altında: ${(requiredInfoRate * 100).toFixed(1)}%`);
  }
  if (fabricatedNumberCount > dataset.thresholds.maxFabricatedNumbers) {
    failures.push(`Uydurma rakam/kod tespit edildi: ${fabricatedNumberCount}`);
  }
  if (internalLeakCount > dataset.thresholds.maxInternalLeaks) {
    failures.push(`İç geliştirici terimi sızıntısı tespit edildi: ${internalLeakCount}`);
  }
  if (handoffAccuracy < dataset.thresholds.minHandoffAccuracy) {
    failures.push(`Doğru aktarma oranı eşik altında: ${(handoffAccuracy * 100).toFixed(1)}%`);
  }

  return {
    version: dataset.version,
    totalCases,
    intentAccuracy: Number(intentAccuracy.toFixed(4)),
    requiredInfoRate: Number(requiredInfoRate.toFixed(4)),
    handoffAccuracy: Number(handoffAccuracy.toFixed(4)),
    fabricatedNumberCount,
    internalLeakCount,
    passed: failures.length === 0,
    failures,
    results,
  };
}

