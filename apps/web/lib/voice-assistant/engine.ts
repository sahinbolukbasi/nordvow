import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
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
  }) => Promise<{ sessionId: string; reply: string }>;
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

async function runFallbackReply(
  text: string,
  callerPhone: string,
  callId: string,
  settings: AssistantSettings,
  tools: AssistantTools,
): Promise<{ reply: string; inputTokens: number; outputTokens: number }> {
  const lower = text.toLocaleLowerCase("tr-TR");

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
        inputTokens: 80,
        outputTokens: 35,
      };
    }
    return {
      reply:
        "Memnuniyetle rezervasyon oluşturabilirim. Hangi gün ve saat için düşünüyorsunuz?",
      inputTokens: 60,
      outputTokens: 25,
    };
  }

  if (
    lower.includes("not") ||
    lower.includes("ilet") ||
    lower.includes("şikayet") ||
    lower.includes("arasın")
  ) {
    if (settings.features.staffNotesEnabled) {
      await tools.execute(
        "take_staff_note",
        {
          callerName: "Arayan Müşteri",
          callerPhone,
          category: lower.includes("şikayet") ? "complaint" : "callback",
          urgency: lower.includes("acil") ? "high" : "normal",
          summary: text,
        },
        { callId, callerPhone, settings },
      );
      return {
        reply:
          "Notunuzu aldım ve görevli ekibimize ilettim. En kısa sürede size dönüş yapılacaktır.",
        inputTokens: 70,
        outputTokens: 30,
      };
    }
  }

  if (settings.features.knowledgeBaseEnabled) {
    const kb = JSON.parse(
      await tools.execute(
        "search_knowledge_base",
        { query: text },
        { callId, callerPhone, settings },
      ),
    );
    if (kb.found && kb.results?.[0]?.content) {
      const clean = String(kb.results[0].content)
        .replace(/^#+\s.*$/gm, "")
        .replace(/Soru:.*\n?/gi, "")
        .replace(/Cevap:\s*/gi, "")
        .trim();
      return {
        reply: clean.split(/(?<=[.!?])\s+/).slice(0, 2).join(" "),
        inputTokens: 90,
        outputTokens: 40,
      };
    }
  }

  return {
    reply:
      "Anladım. İsterseniz bu konuda notunuzu alıp görevli ekibimize hemen iletebilirim.",
    inputTokens: 50,
    outputTokens: 20,
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

      let reply = "";
      let inputTokens = 0;
      let outputTokens = 0;

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        const fallback = await runFallbackReply(
          message,
          state.callerPhone,
          callId,
          settings,
          assistantTools,
        );
        reply = fallback.reply;
        inputTokens = fallback.inputTokens;
        outputTokens = fallback.outputTokens;
      } else {
        const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
        const tools = assistantTools.getEnabledToolDefinitions(settings);
        const working = [...state.history];
        for (let round = 0; round < 3; round++) {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model,
              messages: working,
              tools: tools.length > 0 ? tools : undefined,
              max_tokens: settings.conversation.maxResponseTokens,
              temperature: 0.4,
            }),
          });
          if (!res.ok) break;
          const data = (await res.json()) as {
            usage?: { prompt_tokens?: number; completion_tokens?: number };
            choices: Array<{ message: ChatMessage }>;
          };
          inputTokens += data.usage?.prompt_tokens || 0;
          outputTokens += data.usage?.completion_tokens || 0;
          const msg = data.choices[0]?.message;
          if (!msg) break;
          working.push(msg);
          if (msg.tool_calls && msg.tool_calls.length > 0) {
            for (const tc of msg.tool_calls) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments || "{}");
              } catch {
                parsedArgs = {};
              }
              const out = await assistantTools.execute(
                tc.function.name,
                parsedArgs,
                { callId, callerPhone: state.callerPhone, settings },
              );
              working.push({
                role: "tool",
                tool_call_id: tc.id,
                content: out,
              });
            }
            continue;
          }
          reply = (msg.content || "").trim();
          break;
        }
        if (!reply) {
          reply = "Anlıyorum, talebinizi hemen görevli ekibimize iletiyorum.";
        }
      }

      const usage = costTracker.recordUsage(
        callId,
        { llmInputTokens: inputTokens, llmOutputTokens: outputTokens },
        settings,
      );
      state.history.push({ role: "assistant", content: reply });
      callLogStore.appendTurn(
        callId,
        "assistant",
        reply,
        usage.estimatedCostUsd,
      );

      return { sessionId: callId, reply };
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
