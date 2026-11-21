import { getLlm } from "../llm";
import { applyGuardrails } from "./guardrails";
import {
  CAMPAIGN_STATUS_VERIFY_REPLY,
  COMPLAINT_HANDOFF_MESSAGE,
  CREATOR_APPLICATION_REPLY,
  detectHandoff,
  HANDOFF_MESSAGE,
  handoffReasonLabels,
  isWithinHours,
  lookupBrandShipmentStatus,
  OUT_OF_HOURS_MESSAGE,
  TAX_20B_GENERAL_REPLY,
  type AgentDecision,
  type CitedSource,
} from "./runtime";
import { retrieveWithConfidence, type KnowledgeScope } from "./rag";
import { classifyAssistantIntent, INTENT_LABELS, type AssistantIntent } from "./intent-router";
import { stripInternalLeaks, validateAssistantOutput } from "./output-validator";

/**
 * Durumsuz (stateless) asistan önizlemesi: gerçek bir Conversation satırı veya dış API
 * olmadan, verilen ayarlarla gelen mesaja üretilecek yanıtı hesaplar. Test ekranı kullanır.
 * decide() ile aynı niyet yönlendirme ve doğrulama sırasını izler; yan etkisi yoktur.
 */
export type SimConfig = {
  systemPrompt: string;
  handoffKeywords: string[];
  confidenceThreshold: number;
  maxTurnsBeforeHandoff: number;
  businessHours: unknown;
  outOfHoursBehavior: "queue" | "auto_reply_then_queue";
  agentId: string;
};

export type SimResult = {
  decision: AgentDecision;
  /** Kullanıcıya gösterilecek nihai bot metni (aktarma/mesai dışı mesajları dâhil). */
  botText: string | null;
  intent: AssistantIntent;
  intentLabel: string;
  handoffLabel: string | null;
  sources: CitedSource[];
  usedKnowledge: { content: string; confidence: number; sourceId?: string; sourceTitle?: string }[];
  outOfHours: boolean;
};

function handoffText(outOfHours: boolean, behavior: SimConfig["outOfHoursBehavior"], fallback = HANDOFF_MESSAGE): string | null {
  if (!outOfHours) return fallback;
  return behavior === "auto_reply_then_queue" ? OUT_OF_HOURS_MESSAGE : null;
}

export async function simulateReply(tenantId: string, cfg: SimConfig, text: string, turns = 0, now = new Date()): Promise<SimResult> {
  const outOfHours = !isWithinHours(cfg.businessHours, now);
  const intentRes = classifyAssistantIntent(text);
  const intentLabel = INTENT_LABELS[intentRes.intent];
  const scope: KnowledgeScope = cfg.agentId === "influencer_assistant" ? "influencer" : "brand";

  // 1) Şikâyet niyeti -> anında özür + insana aktarma
  if (intentRes.intent === "sikayet") {
    const botText = handoffText(outOfHours, cfg.outOfHoursBehavior, COMPLAINT_HANDOFF_MESSAGE);
    return {
      decision: { kind: "handoff", reason: "olumsuz_duygu", intent: "sikayet", customerMessage: COMPLAINT_HANDOFF_MESSAGE },
      botText,
      intent: "sikayet",
      intentLabel,
      handoffLabel: handoffReasonLabels.olumsuz_duygu,
      sources: [],
      usedKnowledge: [],
      outOfHours,
    };
  }

  // 2) İnsana aktarma tetikleyicileri (anahtar kelime, hassas konu, tur limiti)
  const reason = await detectHandoff(text, { handoffKeywords: cfg.handoffKeywords }, turns, cfg.maxTurnsBeforeHandoff);
  if (reason) {
    const botText = handoffText(outOfHours, cfg.outOfHoursBehavior);
    return {
      decision: { kind: "handoff", reason, intent: intentRes.intent },
      botText,
      intent: intentRes.intent,
      intentLabel,
      handoffLabel: handoffReasonLabels[reason],
      sources: [],
      usedKnowledge: [],
      outOfHours,
    };
  }

  // 3) Girdi guardrail'i
  const input = await applyGuardrails(text, "INPUT");
  if (input.action === "BLOCKED") {
    const botText = handoffText(outOfHours, cfg.outOfHoursBehavior);
    return {
      decision: { kind: "handoff", reason: "kisisel_veri", intent: intentRes.intent },
      botText,
      intent: intentRes.intent,
      intentLabel,
      handoffLabel: handoffReasonLabels.kisisel_veri,
      sources: [],
      usedKnowledge: [],
      outOfHours,
    };
  }

  // 4) Influencer asistanı 20/B koruması
  if (scope === "influencer" && /\b(?:20\s*\/?\s*b|istisna\s+belge|vergi|stopaj|mali\s+musavir)\b/i.test(input.text)) {
    const sources: CitedSource[] = [{ sourceId: "policy_20b", title: "Genel 20/B bilgilendirmesi", confidence: 0.95 }];
    return {
      decision: { kind: "reply", text: TAX_20B_GENERAL_REPLY, confidence: 0.95, intent: "kampanya_durumu", sources },
      botText: TAX_20B_GENERAL_REPLY,
      intent: "kampanya_durumu",
      intentLabel: INTENT_LABELS.kampanya_durumu,
      handoffLabel: null,
      sources,
      usedKnowledge: [],
      outOfHours,
    };
  }

  // 5) Niyet bazlı doğrudan akışlar
  if (intentRes.intent === "basvuru") {
    const sources: CitedSource[] = [{ sourceId: "system_creator_signup", title: "İçerik Üreticisi Kayıt Akışı", confidence: 0.95 }];
    return {
      decision: { kind: "reply", text: CREATOR_APPLICATION_REPLY, confidence: 0.95, intent: "basvuru", sources },
      botText: CREATOR_APPLICATION_REPLY,
      intent: "basvuru",
      intentLabel,
      handoffLabel: null,
      sources,
      usedKnowledge: [],
      outOfHours,
    };
  }

  if (intentRes.intent === "kargo") {
    if (!intentRes.extractedOrderCode) {
      const reply = "Kargonuzun durumunu kontrol edebilmem için lütfen sipariş veya kargo takip numaranızı paylaşır mısınız?";
      const sources: CitedSource[] = [{ sourceId: "module_shipping", title: "Kargo Yönetimi", confidence: 0.92 }];
      return {
        decision: { kind: "reply", text: reply, confidence: 0.92, intent: "kargo", sources },
        botText: reply,
        intent: "kargo",
        intentLabel,
        handoffLabel: null,
        sources,
        usedKnowledge: [],
        outOfHours,
      };
    }
    const shipmentReply = await lookupBrandShipmentStatus(tenantId, intentRes.extractedOrderCode);
    if (shipmentReply) {
      const sources: CitedSource[] = [{ sourceId: `shipment_${intentRes.extractedOrderCode}`, title: "Kargo Yönetimi Modülü", confidence: 0.96 }];
      return {
        decision: { kind: "reply", text: shipmentReply, confidence: 0.96, intent: "kargo", sources },
        botText: shipmentReply,
        intent: "kargo",
        intentLabel,
        handoffLabel: null,
        sources,
        usedKnowledge: [],
        outOfHours,
      };
    }
    const botText = handoffText(outOfHours, cfg.outOfHoursBehavior);
    return {
      decision: { kind: "handoff", reason: "kisisel_veri", intent: "kargo" },
      botText,
      intent: "kargo",
      intentLabel,
      handoffLabel: handoffReasonLabels.kisisel_veri,
      sources: [],
      usedKnowledge: [],
      outOfHours,
    };
  }

  if (intentRes.intent === "kampanya_durumu" && scope !== "influencer") {
    const sources: CitedSource[] = [{ sourceId: "policy_verification", title: "Kimlik Doğrulama Politikası", confidence: 0.9 }];
    return {
      decision: { kind: "reply", text: CAMPAIGN_STATUS_VERIFY_REPLY, confidence: 0.9, intent: "kampanya_durumu", sources },
      botText: CAMPAIGN_STATUS_VERIFY_REPLY,
      intent: "kampanya_durumu",
      intentLabel,
      handoffLabel: null,
      sources,
      usedKnowledge: [],
      outOfHours,
    };
  }

  if (intentRes.intent === "fiyat" && intentRes.needsCustomQuote) {
    const botText = handoffText(outOfHours, cfg.outOfHoursBehavior);
    return {
      decision: { kind: "handoff", reason: "insan_istedi", intent: "fiyat" },
      botText,
      intent: "fiyat",
      intentLabel,
      handoffLabel: handoffReasonLabels.insan_istedi,
      sources: [],
      usedKnowledge: [],
      outOfHours,
    };
  }

  // 6) Bilgi tabanından onaylı kaynaklarla güvenli cevap
  const hits = await retrieveWithConfidence(tenantId, input.text, 4, scope);
  const retrievalConfidence = hits[0]?.confidence ?? 0;
  if (hits.length === 0 || retrievalConfidence < cfg.confidenceThreshold) {
    const reasonCode = hits.length === 0 ? "kaynak_yok" : "dusuk_guven";
    const botText = handoffText(outOfHours, cfg.outOfHoursBehavior);
    return {
      decision: { kind: "handoff", reason: reasonCode, intent: intentRes.intent },
      botText,
      intent: intentRes.intent,
      intentLabel,
      handoffLabel: handoffReasonLabels[reasonCode],
      sources: [],
      usedKnowledge: hits.map((h) => ({ content: h.content, confidence: h.confidence, sourceId: h.sourceId, sourceTitle: h.sourceTitle })),
      outOfHours,
    };
  }

  const allowedContext = hits.map((h) => h.content).join("\n");
  let draft = "";
  try {
    const llm = await getLlm().completeText({
      system: cfg.systemPrompt,
      promptVersion: `agent-${cfg.agentId}@2`,
      prompt: `Yalnızca aşağıdaki onaylı bilgi parçalarına dayanarak kısa, nazik, Türkçe yanıt ver. Bilgi tabanında olmayan fiyat, tarih veya kod asla uydurma.\n\nBilgi parçaları:\n${hits.map((h, i) => `[${i + 1} - ${h.sourceTitle}] ${h.content}`).join("\n")}\n\nSoru: ${input.text}`,
    });
    draft = llm.text.startsWith("[Otomatik") ? hits[0]!.content : llm.text;
  } catch {
    draft = hits[0]!.content;
  }

  const validation = validateAssistantOutput(draft, allowedContext);
  if (!validation.ok) {
    if (validation.fabricatedValues.length > 0 && hits[0]?.content) {
      draft = hits[0].content;
    } else {
      const botText = handoffText(outOfHours, cfg.outOfHoursBehavior);
      return {
        decision: { kind: "handoff", reason: "guardrail", intent: intentRes.intent },
        botText,
        intent: intentRes.intent,
        intentLabel,
        handoffLabel: handoffReasonLabels.guardrail,
        sources: [],
        usedKnowledge: hits.map((h) => ({ content: h.content, confidence: h.confidence, sourceId: h.sourceId, sourceTitle: h.sourceTitle })),
        outOfHours,
      };
    }
  }

  const out = await applyGuardrails(draft, "OUTPUT");
  if (out.action === "BLOCKED" || !out.text.trim()) {
    const botText = handoffText(outOfHours, cfg.outOfHoursBehavior);
    return {
      decision: { kind: "handoff", reason: "guardrail", intent: intentRes.intent },
      botText,
      intent: intentRes.intent,
      intentLabel,
      handoffLabel: handoffReasonLabels.guardrail,
      sources: [],
      usedKnowledge: hits.map((h) => ({ content: h.content, confidence: h.confidence, sourceId: h.sourceId, sourceTitle: h.sourceTitle })),
      outOfHours,
    };
  }

  const combinedConfidence = Math.min(1, Number((retrievalConfidence * 0.8 + intentRes.confidence * 0.2).toFixed(3)));
  const sources: CitedSource[] = hits
    .filter((h) => h.confidence >= Math.max(0.25, cfg.confidenceThreshold * 0.5))
    .slice(0, 3)
    .map((h) => ({ sourceId: h.sourceId, title: h.sourceTitle, confidence: Number(h.confidence.toFixed(2)) }));

  const cleanText = stripInternalLeaks(out.text);
  return {
    decision: { kind: "reply", text: cleanText, confidence: combinedConfidence, intent: intentRes.intent, sources },
    botText: cleanText,
    intent: intentRes.intent,
    intentLabel,
    handoffLabel: null,
    sources,
    usedKnowledge: hits.map((h) => ({ content: h.content, confidence: h.confidence, sourceId: h.sourceId, sourceTitle: h.sourceTitle })),
    outOfHours,
  };
}
