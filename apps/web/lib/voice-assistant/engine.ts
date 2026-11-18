import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AssistantTools } from "./assistant-tools";
import { CallLogStore } from "./call-log-store";
import { CostTracker } from "./cost-tracker";
import { KnowledgeBase } from "./knowledge-base";
import { SettingsStore, type AssistantSettings } from "./settings";

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
  settingsStore: SettingsStore;
  knowledgeBase: KnowledgeBase;
  costTracker: CostTracker;
  callLogStore: CallLogStore;
  assistantTools: AssistantTools;
  simulateChat: (input: {
    sessionId?: string;
    message: string;
    callerPhone?: string;
  }) => Promise<{ sessionId: string; reply: string }>;
}

const DEFAULT_FAQ = `# NordVow Bilgi Bankası

## Çalışma Saatleri ve İletişim
Soru: Çalışma saatleriniz nedir? Hafta sonu açık mısınız?
Cevap: Hafta içi ve Cumartesi günleri sabah 09:00 ile akşam 20:00 arasında hizmet veriyoruz. Pazar günleri kapalıyız.

## Rezervasyon ve İptal
Soru: Rezervasyon nasıl yapabilirim?
Cevap: Telefon üzerinden adınız, iletişim numaranız, tarih, saat ve kişi sayısını paylaşarak hemen rezervasyon oluşturabilirsiniz.
`;

function buildVoiceSystemPrompt(settings: AssistantSettings): string {
  const capabilities: string[] = [];
  if (settings.features.knowledgeBaseEnabled) {
    capabilities.push(
      "- İşletme hakkında sorulan sorularda önce `search_knowledge_base` aracını kullan.",
    );
  }
  if (settings.features.reservationsEnabled) {
    capabilities.push(
      "- Rezervasyon istendiğinde ad soyad, telefon, tarih, saat ve kişi sayısını alıp `create_reservation` çağır.",
    );
  }
  if (settings.features.staffNotesEnabled) {
    capabilities.push(
      "- Diğer tüm talep, şikayet veya geri arama isteklerinde `take_staff_note` ile görevlilere aktar.",
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

  return `Sen "${settings.businessName}" adına telefon çağrılarını yanıtlayan gerçekçi, sıcakkanlı ve profesyonel bir Türkçe sesli asistansın.
Her yanıt en fazla ${settings.conversation.maxResponseSentences} kısa cümleden oluşsun. Markdown, liste veya emoji kullanma.

YETENEKLERİN:
${capabilities.join("\n")}`;
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
            customerName: "Test Müşteri",
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
          urgency: "normal",
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

function createRuntime(): VoiceAssistantRuntime {
  const rootDir =
    process.env.VOICE_ASSISTANT_DATA_DIR ||
    path.join(process.cwd(), ".voice-assistant-data");
  const dataDir = path.join(rootDir, "data");
  const knowledgeDir = path.join(rootDir, "knowledge");

  if (!fs.existsSync(knowledgeDir)) {
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.writeFileSync(
      path.join(knowledgeDir, "nordvow-bilgi-bankasi.md"),
      DEFAULT_FAQ,
      "utf-8",
    );
  }

  const settingsStore = new SettingsStore(dataDir);
  const knowledgeBase = new KnowledgeBase(knowledgeDir);
  const costTracker = new CostTracker(dataDir);
  const callLogStore = new CallLogStore(dataDir);
  const assistantTools = new AssistantTools(dataDir, knowledgeBase);

  const sessions = new Map<
    string,
    { history: ChatMessage[]; callerPhone: string }
  >();

  return {
    settingsStore,
    knowledgeBase,
    costTracker,
    callLogStore,
    assistantTools,
    async simulateChat({ sessionId, message, callerPhone }) {
      const settings = settingsStore.get();
      const phone = callerPhone || settings.telephony.personalMobileNumber;
      const callId = sessionId && sessions.has(sessionId)
        ? sessionId
        : crypto.randomUUID();

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
  __nordvowVoiceRuntime?: VoiceAssistantRuntime;
};

export function getVoiceRuntime(): VoiceAssistantRuntime {
  if (!globalForVoice.__nordvowVoiceRuntime) {
    globalForVoice.__nordvowVoiceRuntime = createRuntime();
  }
  return globalForVoice.__nordvowVoiceRuntime;
}

