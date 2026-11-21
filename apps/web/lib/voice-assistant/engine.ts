import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@infulancer/core/db";
import { classifyAssistantIntent, INTENT_LABELS, type AssistantIntent } from "@infulancer/core/assistant/intent-router";
import { stripInternalLeaks, validateAssistantOutput } from "@infulancer/core/assistant/output-validator";
import { retrieveWithConfidence } from "@infulancer/core/assistant/rag";
import {
  CAMPAIGN_STATUS_VERIFY_REPLY,
  COMPLAINT_HANDOFF_MESSAGE,
  CREATOR_APPLICATION_REPLY,
  lookupBrandShipmentStatus,
  recordUnansweredQuestion,
} from "@infulancer/core/assistant/runtime";
import { converseChat } from "@infulancer/core/llm/bedrock";
import { envStr } from "@infulancer/core/env";
import { retrieveBrandKnowledge } from "@infulancer/core/voice/retriever";
import { createVoiceCallbackRequest } from "@infulancer/core/voice/callLogService";
import { AssistantTools } from "./assistant-tools";
import { CallLogStore, type CallExtractedDetails } from "./call-log-store";
import { CostTracker } from "./cost-tracker";
import { KnowledgeBase } from "./knowledge-base";
import { SettingsStore, type AssistantSettings, type VoiceTone } from "./settings";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export interface VoiceAssistantRuntime {
  brandId: string;
  settingsStore: SettingsStore;
  knowledgeBase: KnowledgeBase;
  costTracker: CostTracker;
  callLogStore: CallLogStore;
  assistantTools: AssistantTools;
  syncCompanyKnowledge: (settings: AssistantSettings) => void;
  simulateChat: (input: {
    sessionId?: string;
    message: string;
    callerPhone?: string;
  }) => Promise<{
    sessionId: string;
    reply: string;
    intent?: AssistantIntent;
    intentLabel?: string;
    sources?: { title: string; confidence: number }[];
    handoff?: boolean;
  }>;
}

const DEFAULT_FAQ = `# İşletme Bilgi Bankası

## Çalışma Saatleri ve İletişim
Soru: Çalışma saatleriniz nedir? Hafta sonu açık mısınız?
Cevap: Hafta içi ve Cumartesi günleri sabah 09:00 ile akşam 20:00 arasında hizmet veriyoruz. Pazar günleri kapalıyız.

## Rezervasyon ve İptal
Soru: Rezervasyon nasıl yapabilirim?
Cevap: Telefon üzerinden adınız, iletişim numaranız, tarih, saat ve kişi sayısını paylaşarak hemen rezervasyon oluşturabilirsiniz.
`;

const TONE_DESCRIPTIONS: Record<VoiceTone, string> = {
  warm: "Sıcakkanlı, samimi, güler yüzlü ve empatik bir tonla konuş.",
  formal: "Kurumsal, saygılı, net ve profesyonel bir 'siz' diliyle konuş.",
  energetic: "Dinamik, pozitif, hızlı ve çözüm odaklı bir tonla konuş.",
  calm: "Sakin, güven verici, tane tane ve sabırlı bir tonla konuş.",
};

function buildVoiceSystemPrompt(settings: AssistantSettings): string {
  const capabilities: string[] = [];
  if (settings.features.knowledgeBaseEnabled) {
    capabilities.push(
      "- İşletme, fiyat, adres ve hizmet sorularında `search_knowledge_base` aracını kullan.",
    );
  }
  if (settings.features.reservationsEnabled) {
    capabilities.push(
      "- Rezervasyon istendiğinde ad soyad, telefon, tarih, saat ve kişi sayısını alıp `create_reservation` çağır.",
    );
  }
  if (settings.features.staffNotesEnabled) {
    capabilities.push(
      "- Önemli detaylar, şikayetler, özel istekler ve geri arama taleplerinde `take_staff_note` ile görevlilere aktar.",
    );
  }
  if (
    settings.features.callTransferEnabled &&
    settings.staffNotifications.transferPhoneNumber
  ) {
    capabilities.push(
      "- Arayan canlı görevli isterse `transfer_to_staff` aracını kullan.",
    );
  }

  const toneInstruction = TONE_DESCRIPTIONS[settings.voice.tone] || TONE_DESCRIPTIONS.warm;
  const companyBlock = [
    settings.companyProfile.sector && `Sektör: ${settings.companyProfile.sector}`,
    settings.companyProfile.workingHours && `Çalışma Saatleri: ${settings.companyProfile.workingHours}`,
    settings.companyProfile.address && `Adres: ${settings.companyProfile.address}`,
    settings.companyProfile.servicesSummary && `Hizmetler: ${settings.companyProfile.servicesSummary}`,
  ]
    .filter(Boolean)
    .join(" | ");

  return `Sen "${settings.businessName}" adına telefon çağrılarını yanıtlayan gerçekçi Türkçe sesli asistansın.
TONUN: ${toneInstruction}
KURALLAR:
1. Telefonda konuştuğun için yanıtların KISA, DOĞAL ve AKICI olsun (en fazla ${settings.conversation.maxResponseSentences} kısa cümle).
2. Markdown, liste, yıldız veya emoji kullanma. Düz konuşma cümlesi kur.
3. Karşı tarafı dinle, tek seferde bir soru sor.
${companyBlock ? `FİRMA ÖZETİ: ${companyBlock}` : ""}

YETENEKLERİN:
${capabilities.join("\n")}`;
}

function extractImportantDetailsFromText(
  text: string,
  prev?: CallExtractedDetails,
): CallExtractedDetails {
  const notes = new Set<string>(prev?.importantNotes || []);
  const lower = text.toLocaleLowerCase("tr-TR");

  const nameMatch = text.match(/(?:ben|adım|ismim)\s+([A-ZÇĞİÖŞÜ][a-zçğıöşü]+(?:\s+[A-ZÇĞİÖŞÜ][a-zçğıöşü]+)?)/i);
  const callerName = nameMatch?.[1] || prev?.callerName;

  let intent = prev?.intent || "genel_bilgi";
  if (lower.includes("rezervasyon") || lower.includes("randevu")) {
    intent = "rezervasyon";
  } else if (lower.includes("şikayet") || lower.includes("sorun")) {
    intent = "şikayet";
  } else if (lower.includes("not") || lower.includes("arasın")) {
    intent = "geri_arama";
  }

  const urgency: "normal" | "high" =
    lower.includes("acil") || lower.includes("hemen") || prev?.urgency === "high"
      ? "high"
      : "normal";

  if (text.trim().length > 10) {
    notes.add(text.trim());
  }

  return {
    callerName,
    intent,
    urgency,
    importantNotes: Array.from(notes).slice(-6),
  };
}

interface RoutedVoiceReply {
  reply: string;
  intent: AssistantIntent;
  intentLabel: string;
  sources: { title: string; confidence: number }[];
  handoff: boolean;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Sesli asistanın birleşik yanıt motoru:
 * 1) Metin asistanı ile aynı 7 niyet yönlendiricisini (fiyat/kargo/basvuru/kampanya_durumu/iade/sikayet/diger) kullanır.
 * 2) Prisma onaylı bilgi tabanı + Voice KB + yerel KB üzerinde arama yapar; yalnızca onaylı kaynakları kullanır.
 * 3) AWS Bedrock (eu. profili) ile yanıt üretir; uydurma rakam ve iç terim sızıntısını engeller.
 * 4) Gerçek LLM çağrısı yapılmadıysa token=0 kaydeder (sahte $0.0001 maliyet yazmaz).
 * 5) Yedek aktarma yanıtı yalnızca `diger` niyetinde ve düşük güvende (veya şikâyette) devreye girer ve görev/not açar.
 */
async function runUnifiedVoiceTurn(
  rawBrandId: string,
  text: string,
  callerPhone: string,
  callId: string,
  settings: AssistantSettings,
  tools: AssistantTools,
  history: ChatMessage[],
): Promise<RoutedVoiceReply> {
  const lower = text.toLocaleLowerCase("tr-TR");
  const intentRes = classifyAssistantIntent(text);
  const intentLabel = INTENT_LABELS[intentRes.intent];

  // 1) Şikâyet -> özür, not al, çağrı kaydına yaz ve Gelen Kutusu / geri arama görevi aç
  if (intentRes.intent === "sikayet") {
    if (settings.features.staffNotesEnabled) {
      await tools
        .execute(
          "take_staff_note",
          {
            callerName: "Arayan Müşteri",
            callerPhone,
            category: "complaint",
            urgency: "high",
            summary: text,
          },
          { callId, callerPhone, settings },
        )
        .catch(() => undefined);
    }
    await createVoiceCallbackRequest({
      brandId: rawBrandId,
      callerPhone,
      topic: `Şikâyet: ${text.slice(0, 140)}`,
    }).catch(() => undefined);
    return {
      reply: COMPLAINT_HANDOFF_MESSAGE,
      intent: "sikayet",
      intentLabel,
      sources: [],
      handoff: true,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // 2) Rezervasyon / randevu aracı
  if (lower.includes("rezervasyon") || lower.includes("randevu")) {
    const timeMatch = lower.match(/\d{1,2}[:.]\d{2}/);
    if (timeMatch && settings.features.reservationsEnabled) {
      const res = JSON.parse(
        await tools.execute(
          "create_reservation",
          {
            customerName: "Arayan Müşteri",
            phone: callerPhone,
            date: new Date().toISOString().slice(0, 10),
            time: timeMatch[0],
            partySize: 2,
            notes: text,
          },
          { callId, callerPhone, settings },
        ),
      );
      return {
        reply: `Rezervasyonunuzu oluşturdum. Onay kodunuz ${res.confirmationCode}. Başka bir konuda yardımcı olabilir miyim?`,
        intent: "diger",
        intentLabel,
        sources: [{ title: "Rezervasyon Modülü", confidence: 0.95 }],
        handoff: false,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
    return {
      reply: "Memnuniyetle rezervasyon oluşturabilirim. Hangi gün ve saat için düşünüyorsunuz?",
      intent: "diger",
      intentLabel,
      sources: [{ title: "Rezervasyon Modülü", confidence: 0.9 }],
      handoff: false,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // 3) Influencer başvurusu -> kayıt linki ve 3 adım
  if (intentRes.intent === "basvuru") {
    return {
      reply: CREATOR_APPLICATION_REPLY,
      intent: "basvuru",
      intentLabel,
      sources: [{ title: "İçerik Üreticisi Kayıt Akışı", confidence: 0.95 }],
      handoff: false,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // 4) Kargo / sipariş durumu -> takip no iste veya Kargo Yönetimi modülünden sorgula
  if (intentRes.intent === "kargo") {
    if (!intentRes.extractedOrderCode) {
      return {
        reply: "Kargonuzun durumunu kontrol edebilmem için sipariş veya kargo takip numaranızı paylaşabilir misiniz?",
        intent: "kargo",
        intentLabel,
        sources: [{ title: "Kargo Yönetimi", confidence: 0.92 }],
        handoff: false,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
    const shipmentStatus = await lookupBrandShipmentStatus(rawBrandId, intentRes.extractedOrderCode);
    if (shipmentStatus) {
      return {
        reply: shipmentStatus,
        intent: "kargo",
        intentLabel,
        sources: [{ title: "Kargo Yönetimi Modülü", confidence: 0.96 }],
        handoff: false,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
    await createVoiceCallbackRequest({
      brandId: rawBrandId,
      callerPhone,
      topic: `Kargo sorgusu (${intentRes.extractedOrderCode}): ${text.slice(0, 120)}`,
    }).catch(() => undefined);
    return {
      reply: `${intentRes.extractedOrderCode} numaralı gönderiyi bu hat üzerinden doğrulayamadım. Notunuzu aldım; kargo ekibimiz kontrol edip size en geç 2 saat içinde dönüş yapacak.`,
      intent: "kargo",
      intentLabel,
      sources: [],
      handoff: true,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // 5) Kampanya / teklif / ödeme durumu -> kimlik doğrulama
  if (intentRes.intent === "kampanya_durumu") {
    return {
      reply: CAMPAIGN_STATUS_VERIFY_REPLY,
      intent: "kampanya_durumu",
      intentLabel,
      sources: [{ title: "Kimlik Doğrulama Politikası", confidence: 0.9 }],
      handoff: false,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // 6) Kişiye özel fiyat -> temsilci aktarımı
  if (intentRes.intent === "fiyat" && intentRes.needsCustomQuote) {
    await createVoiceCallbackRequest({
      brandId: rawBrandId,
      callerPhone,
      topic: `Özel fiyat teklifi: ${text.slice(0, 140)}`,
    }).catch(() => undefined);
    return {
      reply: "Özel fiyat ve paket talebinizi not aldım; satış ekibimiz size en geç 2 saat içinde dönüş yapacaktır.",
      intent: "fiyat",
      intentLabel,
      sources: [],
      handoff: true,
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  // 7) Birleşik onaylı bilgi tabanı araması (Prisma RAG + Voice KB + Yerel dosya KB)
  const evidence: { title: string; content: string; confidence: number }[] = [];

  if (settings.features.knowledgeBaseEnabled) {
    // 7a) Prisma onaylı RAG (marka kapsamı)
    try {
      const ragHits = await retrieveWithConfidence(rawBrandId, text, 3, "brand");
      for (const h of ragHits) {
        if (h.confidence >= 0.35) {
          evidence.push({ title: h.sourceTitle, content: h.content, confidence: h.confidence });
        }
      }
    } catch (err) {
      console.warn("[voice-engine] Prisma RAG sorgusu atlandı:", err instanceof Error ? err.message : err);
    }

    // 7b) Prisma VoiceFaqItem / VoiceKnowledgeDoc
    try {
      const voiceChunks = await retrieveBrandKnowledge(rawBrandId, text, 3);
      for (const vc of voiceChunks) {
        evidence.push({ title: vc.title, content: vc.content, confidence: Math.max(0.55, vc.score || 0.7) });
      }
    } catch (err) {
      console.warn("[voice-engine] Voice KB sorgusu atlandı:", err instanceof Error ? err.message : err);
    }

    // 7c) Yerel dosya bilgi tabanı
    try {
      const kb = JSON.parse(
        await tools.execute("search_knowledge_base", { query: text }, { callId, callerPhone, settings }),
      ) as { found?: boolean; results?: { source?: string; content?: string; score?: number }[] };
      if (kb.found && kb.results?.length) {
        for (const r of kb.results.slice(0, 2)) {
          if (r.content) {
            const clean = String(r.content)
              .replace(/^#+\s.*$/gm, "")
              .replace(/Soru:.*\n?/gi, "")
              .replace(/Cevap:\s*/gi, "")
              .trim();
            if (clean) {
              evidence.push({
                title: r.source || "İşletme Bilgi Bankası",
                content: clean,
                confidence: Math.min(0.92, Math.max(0.65, Number(r.score ?? 0.72))),
              });
            }
          }
        }
      }
    } catch {
      // Yerel KB hata verirse devam
    }
  }

  evidence.sort((a, b) => b.confidence - a.confidence);
  const topEvidence = evidence.slice(0, 3);
  const bestConfidence = topEvidence[0]?.confidence ?? 0;

  // 8) Onaylı kaynak varsa AWS Bedrock (eu. profili) ile yanıt üret ve çıktı doğrulayıcıdan geçir
  if (topEvidence.length > 0 && bestConfidence >= 0.55) {
    const allowedContext = topEvidence.map((e) => e.content).join("\n");
    let reply = "";
    let llmCalled = false;

    if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
      try {
        const system = [
          buildVoiceSystemPrompt(settings),
          "Yalnızca aşağıdaki onaylı bilgi parçalarına dayanarak 1-2 cümlelik net Türkçe yanıt ver.",
          "Bilgi tabanında olmayan fiyat, tarih veya kupon kodu ASLA uydurma.",
          "",
          "ONAYLI BİLGİ KAYNAKLARI:",
          ...topEvidence.map((e, i) => `[${i + 1} - ${e.title}] ${e.content}`),
        ].join("\n");
        const turns = [
          ...history
            .filter((h) => (h.role === "user" || h.role === "assistant") && h.content)
            .slice(-6)
            .map((h) => ({ role: h.role as "user" | "assistant", text: h.content! })),
        ];
        if (!turns.length || turns[turns.length - 1]?.text !== text) {
          turns.push({ role: "user", text });
        }
        const out = await converseChat({ system, turns, maxTokens: 180, temperature: 0.3 });
        reply = out.text.trim();
        llmCalled = true;
      } catch (err) {
        console.error("[voice-engine] Bedrock converseChat hatası:", err);
      }
    }

    if (!reply) {
      reply = topEvidence[0]!.content.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    }

    const validation = validateAssistantOutput(reply, allowedContext);
    if (!validation.ok) {
      console.warn("[voice-engine] Çıktı doğrulayıcı uydurma/sızıntı yakaladı:", validation);
      reply = topEvidence[0]!.content.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    }

    return {
      reply: stripInternalLeaks(reply),
      intent: intentRes.intent,
      intentLabel,
      sources: topEvidence.map((e) => ({ title: e.title, confidence: Number(e.confidence.toFixed(2)) })),
      handoff: false,
      // Gerçek LLM çağrısı yapılmadıysa 0 token (sahte maliyet yok)
      inputTokens: llmCalled ? Math.ceil(allowedContext.length / 4) : 0,
      outputTokens: llmCalled ? Math.ceil(reply.length / 4) : 0,
    };
  }

  // 9) Bilgi tabanında karşılık yok / düşük güven -> dürüst gerekçeli aktarma + görev + cevapsız soru kaydı
  await recordUnansweredQuestion(rawBrandId, text, intentRes.intent, "kaynak_yok");
  if (settings.features.staffNotesEnabled) {
    await tools
      .execute(
        "take_staff_note",
        {
          callerName: "Arayan Müşteri",
          callerPhone,
          category: "callback",
          urgency: "normal",
          summary: `[${intentLabel}] ${text}`,
        },
        { callId, callerPhone, settings },
      )
      .catch(() => undefined);
  }
  await createVoiceCallbackRequest({
    brandId: rawBrandId,
    callerPhone,
    topic: `${intentLabel}: ${text.slice(0, 140)}`,
  }).catch(() => undefined);

  const intentSpecificHandoff: Record<AssistantIntent, string> = {
    fiyat:
      "Güncel kampanya ve paket fiyatlarımız marka bilgi tabanında henüz onaylı değil. Fiyat bilgisi için notunuzu ekibimize ilettim; size en geç 2 saat içinde dönüş yapılacak.",
    iade:
      "İade ve değişim koşulları bilgi tabanında henüz tanımlı değil. Talebinizi kaydettim; müşteri temsilcimiz size en geç 2 saat içinde dönüş yapacak.",
    kargo:
      "Kargo kaydınızı doğrulayabilmem için notunuzu lojistik ekibimize ilettim; en geç 2 saat içinde size dönüş yapılacak.",
    basvuru: CREATOR_APPLICATION_REPLY,
    kampanya_durumu: CAMPAIGN_STATUS_VERIFY_REPLY,
    sikayet: COMPLAINT_HANDOFF_MESSAGE,
    diger:
      "Bu konuda onaylı bilgi tabanımızda kayıt bulamadım. Notunuzu alıp görevli ekibimize ilettim; size en geç 2 saat içinde dönüş yapılacak.",
  };

  return {
    reply: intentSpecificHandoff[intentRes.intent],
    intent: intentRes.intent,
    intentLabel,
    sources: [],
    handoff: true,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function createRuntime(brandId: string, brandName?: string): VoiceAssistantRuntime {
  const safeBrand = brandId.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
  const baseRoot =
    process.env.VOICE_ASSISTANT_DATA_DIR ||
    path.join(process.cwd(), ".voice-assistant-data");
  const rootDir = path.join(baseRoot, "brands", safeBrand);
  const dataDir = path.join(rootDir, "data");
  const knowledgeDir = path.join(rootDir, "knowledge");

  if (!fs.existsSync(knowledgeDir)) {
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.writeFileSync(
      path.join(knowledgeDir, "genel-bilgi-bankasi.md"),
      DEFAULT_FAQ,
      "utf-8",
    );
  }

  const settingsStore = new SettingsStore(
    dataDir,
    brandName ? `${brandName} Müşteri Hizmetleri` : "NordVow Müşteri Hizmetleri",
  );
  const knowledgeBase = new KnowledgeBase(knowledgeDir);
  const costTracker = new CostTracker(dataDir);
  const callLogStore = new CallLogStore(dataDir);
  const assistantTools = new AssistantTools(dataDir, knowledgeBase);

  const syncCompanyKnowledge = (settings: AssistantSettings) => {
    const cp = settings.companyProfile;
    const lines = [
      `# ${settings.businessName} Firma Bilgileri`,
      "",
      cp.sector ? `## Sektör\nSoru: Hangi alanda hizmet veriyorsunuz?\nCevap: ${cp.sector}` : "",
      cp.workingHours
        ? `## Çalışma Saatleri\nSoru: Çalışma saatleriniz nedir?\nCevap: ${cp.workingHours}`
        : "",
      cp.address ? `## Adres\nSoru: Adresiniz nerede?\nCevap: ${cp.address}` : "",
      cp.servicesSummary
        ? `## Hizmetler ve Bilgiler\nSoru: Hizmetleriniz ve fiyatlarınız nelerdir?\nCevap: ${cp.servicesSummary}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    if (lines.trim()) {
      knowledgeBase.addDocument("firma-bilgileri.md", lines);
    }
  };

  const sessions = new Map<
    string,
    { history: ChatMessage[]; callerPhone: string; extracted?: CallExtractedDetails }
  >();

  return {
    brandId: safeBrand,
    settingsStore,
    knowledgeBase,
    costTracker,
    callLogStore,
    assistantTools,
    syncCompanyKnowledge,
    async simulateChat({ sessionId, message, callerPhone }) {
      const settings = settingsStore.get();
      if (!settings.enabled) {
        return {
          sessionId: sessionId || "disabled",
          reply: "Bu marka için sesli asistan şu anda pasif durumda.",
        };
      }

      const phone = callerPhone || settings.telephony.personalMobileNumber;
      const callId =
        sessionId && sessions.has(sessionId) ? sessionId : crypto.randomUUID();

      let state = sessions.get(callId);
      if (!state) {
        state = {
          callerPhone: phone,
          history: [
            { role: "system", content: buildVoiceSystemPrompt(settings) },
          ],
        };
        sessions.set(callId, state);
        costTracker.startCall(callId);
        callLogStore.createCall(callId, "simulation", phone);
      }

      state.extracted = extractImportantDetailsFromText(message, state.extracted);
      callLogStore.setExtractedDetails(callId, state.extracted);

      state.history.push({ role: "user", content: message });
      callLogStore.appendTurn(callId, "caller", message);

      const routed = await runUnifiedVoiceTurn(
        brandId,
        message,
        state.callerPhone,
        callId,
        settings,
        assistantTools,
        state.history,
      );

      const usage =
        routed.inputTokens > 0 || routed.outputTokens > 0
          ? costTracker.recordUsage(
            callId,
            { llmInputTokens: routed.inputTokens, llmOutputTokens: routed.outputTokens },
            settings,
          )
          : { estimatedCostUsd: 0 };

      state.history.push({ role: "assistant", content: routed.reply });
      callLogStore.appendTurn(
        callId,
        "assistant",
        routed.reply,
        usage.estimatedCostUsd,
      );

      return {
        sessionId: callId,
        reply: routed.reply,
        intent: routed.intent,
        intentLabel: routed.intentLabel,
        sources: routed.sources,
        handoff: routed.handoff,
      };
    },
  };
}

const globalForVoice = globalThis as unknown as {
  __nordvowVoiceRuntimes?: Map<string, VoiceAssistantRuntime>;
};

export function getVoiceRuntime(
  brandId = "default",
  brandName?: string,
): VoiceAssistantRuntime {
  if (!globalForVoice.__nordvowVoiceRuntimes) {
    globalForVoice.__nordvowVoiceRuntimes = new Map();
  }
  const key = brandId || "default";
  let runtime = globalForVoice.__nordvowVoiceRuntimes.get(key);
  if (!runtime) {
    runtime = createRuntime(key, brandName);
    globalForVoice.__nordvowVoiceRuntimes.set(key, runtime);
  }
  return runtime;
}
