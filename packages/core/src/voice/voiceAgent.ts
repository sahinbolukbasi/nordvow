import { envStr } from "../env";
import { converseChat, type ChatTurn } from "../llm/bedrock";
import { classifyAssistantIntent } from "../assistant/intent-router";
import { stripInternalLeaks, validateAssistantOutput } from "../assistant/output-validator";
import {
  CAMPAIGN_STATUS_VERIFY_REPLY,
  COMPLAINT_HANDOFF_MESSAGE,
  CREATOR_APPLICATION_REPLY,
  lookupBrandShipmentStatus,
  recordUnansweredQuestion,
} from "../assistant/runtime";
import { retrieveBrandKnowledge } from "./retriever";
import { routeVoiceIntent } from "./intentRouter";
import type { IntentRouteResult, RetrievedChunk, VoiceBusinessHours, VoiceRoutingRule } from "./types";

const ONES = ["", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];

export function numberToTurkishWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1_000_000) return String(n);
  if (n === 0) return "sıfır";
  const parts: string[] = [];
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  const threeDigits = (v: number) => {
    const p: string[] = [];
    const h = Math.floor(v / 100);
    const t = Math.floor((v % 100) / 10);
    const o = v % 10;
    if (h === 1) p.push("yüz");
    else if (h > 1) p.push(`${ONES[h]} yüz`);
    if (t > 0) p.push(TENS[t]!);
    if (o > 0) p.push(ONES[o]!);
    return p.join(" ");
  };
  if (thousands === 1) parts.push("bin");
  else if (thousands > 1) parts.push(`${threeDigits(thousands)} bin`);
  if (rest > 0) parts.push(threeDigits(rest));
  return parts.join(" ");
}

/** Telefonda okunuşa uygun cümle temizliği (madde işaretleri kalkar, fiyat/sayılar yazıya çevrilir). */
export function normalizeForPhoneSpeech(raw: string): string {
  return raw
    .replace(/^[\s•\-*]+\s*/gm, "")
    .replace(/(\d{1,3}(?:\.\d{3})+|\d+)\s*(?:TL|₺)/gi, (_, numStr: string) => {
      const clean = Number(numStr.replace(/\./g, ""));
      return `${numberToTurkishWords(clean)} lira`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

export function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function suggestGreetingWithAi(brandName: string, tone: string): Promise<string> {
  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const res = await converseChat({
        system: "Sen çağrı merkezi karşılama metni yazarısın. KVKK kayıt bilgisini de içeren kısa, doğal, sıcak tek paragraflık Türkçe telefon karşılama metni yaz.",
        turns: [{ role: "user", text: `Marka: ${brandName}, Ton: ${tone}` }],
        maxTokens: 160,
        temperature: 0.5,
      });
      if (res.text.trim().length > 15) return res.text.trim();
    } catch {
      /* fallback */
    }
  }
  return tone === "kurumsal"
    ? `Merhaba, ${brandName} müşteri hizmetlerine hoş geldiniz. Ben yapay zekâ asistanınızım. Kalite standartlarımız ve KVKK kapsamında görüşmemiz kayıt altına alınmaktadır. Size nasıl yardımcı olabilirim?`
    : `Merhaba! ${brandName} telefon asistanına hoş geldiniz. Ben dijital asistanınız, görüşmemiz KVKK kapsamında kayıt altına alınıyor. Size bugün nasıl yardımcı olabilirim?`;
}

/**
 * Marka bilgi bankasına dayalı sesli asistan yanıtı üretir.
 * Sistem promptu: yalnız verilen kaynaklara dayanır, uydurmaz, cümle cümle okunabilir Türkçe döner.
 */
export async function runVoiceAgentTurn(input: {
  brandId: string;
  brandName: string;
  assistantName: string;
  tone: string;
  blockedTopics?: string | null;
  utterance: string;
  history: { role: "user" | "assistant"; text: string }[];
  routingRules: VoiceRoutingRule[];
  businessHours?: VoiceBusinessHours | null;
}): Promise<{
  replyText: string;
  sentences: string[];
  intent: IntentRouteResult;
  sources: RetrievedChunk[];
  unanswered: boolean;
}> {
  const intent = await routeVoiceIntent({
    utterance: input.utterance,
    routingRules: input.routingRules,
    businessHours: input.businessHours,
  });

  if (intent.intent === "goodbye") {
    const bye = "Aradığınız için teşekkür ederiz, iyi günler dileriz.";
    return { replyText: bye, sentences: [bye], intent, sources: [], unanswered: false };
  }

  if (intent.intent === "transfer" && intent.transferTarget) {
    const msg = `Sizi hemen ${intent.transferTarget.label} birimine aktarıyorum, lütfen hatta kalın.`;
    return { replyText: msg, sentences: [msg], intent, sources: [], unanswered: false };
  }

  if (intent.intent === "callback") {
    const msg = input.businessHours?.afterHoursMessage || "Talebinizi aldım. Adınızı ve konunuzu paylaşabilirseniz ekibimiz sizi en kısa sürede arayacaktır.";
    return { replyText: msg, sentences: splitIntoSentences(msg), intent, sources: [], unanswered: false };
  }

  // Metin asistanı ile ortak niyet yönlendiricisi (fiyat, kargo, basvuru, kampanya_durumu, iade, sikayet, diger)
  const sharedIntent = classifyAssistantIntent(input.utterance);
  if (sharedIntent.intent === "sikayet") {
    return {
      replyText: COMPLAINT_HANDOFF_MESSAGE,
      sentences: splitIntoSentences(COMPLAINT_HANDOFF_MESSAGE),
      intent: { ...intent, intent: "callback", reason: "Şikâyet nedeniyle insana aktarma" },
      sources: [],
      unanswered: false,
    };
  }
  if (sharedIntent.intent === "basvuru") {
    return {
      replyText: CREATOR_APPLICATION_REPLY,
      sentences: splitIntoSentences(CREATOR_APPLICATION_REPLY),
      intent,
      sources: [{ docId: "system_creator_signup", title: "İçerik Üreticisi Kayıt Akışı", content: CREATOR_APPLICATION_REPLY, score: 0.95 }],
      unanswered: false,
    };
  }
  if (sharedIntent.intent === "kargo") {
    if (!sharedIntent.extractedOrderCode) {
      const ask = "Kargonuzun durumunu kontrol edebilmem için sipariş veya kargo takip numaranızı paylaşabilir misiniz?";
      return { replyText: ask, sentences: [ask], intent, sources: [], unanswered: false };
    }
    const status = await lookupBrandShipmentStatus(input.brandId, sharedIntent.extractedOrderCode);
    if (status) {
      return {
        replyText: status,
        sentences: splitIntoSentences(status),
        intent,
        sources: [{ docId: `shipment_${sharedIntent.extractedOrderCode}`, title: "Kargo Yönetimi Modülü", content: status, score: 0.96 }],
        unanswered: false,
      };
    }
  }
  if (sharedIntent.intent === "kampanya_durumu") {
    return {
      replyText: CAMPAIGN_STATUS_VERIFY_REPLY,
      sentences: splitIntoSentences(CAMPAIGN_STATUS_VERIFY_REPLY),
      intent,
      sources: [],
      unanswered: false,
    };
  }

  const sources = await retrieveBrandKnowledge(input.brandId, input.utterance, 4);
  const contextText = sources.length
    ? sources.map((s, i) => `[Kaynak ${i + 1} - ${s.title}]: ${s.content}`).join("\n\n")
    : "KAYNAK_YOK";

  let reply = "";
  let unanswered = sources.length === 0;

  if (envStr("LLM_PROVIDER", "mock") === "bedrock" && sources.length > 0) {
    try {
      const system = [
        `Sen ${input.brandName} şirketinde çalışan gerçek bir müşteri temsilcisisin. Adın ${input.assistantName}.`,
        "Asla 'yapay zekâ', 'bot', 'dijital asistan' veya 'telefon asistanıyım' gibi ifadeler kullanma; tamamen gerçek bir insan gibi konuş.",
        "Doğal, samimi, akıcı günlük Türkçe kullan. En fazla 1 veya 2 kısa cümle kur; uzun paragraflar, liste ve madde işareti kullanma.",
        "Yalnızca verilen onaylı şirket bilgilerindeki rakamları kullan; bilgi tabanında olmayan fiyat, tarih veya kod asla uydurma.",
        input.blockedTopics ? `Cevaplanmayacak konular: ${input.blockedTopics}` : "",
        `\nONAYLI ŞİRKET BİLGİLERİ:\n${contextText}`,
      ]
        .filter(Boolean)
        .join("\n");

      const turns: ChatTurn[] = [...input.history.slice(-8), { role: "user", text: input.utterance }];
      const res = await converseChat({ system, turns, maxTokens: 160, temperature: 0.35 });
      const candidate = normalizeForPhoneSpeech(res.text);
      const allowedContext = sources.map((s) => s.content).join("\n");
      const check = validateAssistantOutput(candidate, allowedContext);
      reply = check.ok ? candidate : normalizeForPhoneSpeech(sources[0]!.content.slice(0, 260));
      if (/bilgim yok|bulunmuyor|yetkiliye|geri dönüş/i.test(reply)) unanswered = true;
    } catch (e) {
      console.warn("[voiceAgent] Bedrock fallback:", (e as Error).message);
    }
  }

  if (!reply) {
    if (sources.length > 0) {
      reply = normalizeForPhoneSpeech(sources[0]!.content.slice(0, 260));
      unanswered = false;
    } else {
      await recordUnansweredQuestion(input.brandId, input.utterance, sharedIntent.intent, "kaynak_yok");
      reply = "Bu konuda onaylı bilgi tabanımızda kayıt bulunmuyor. Notunuzu alıp görevli ekibimize ilettim; en geç 2 saat içinde size dönüş yapılacak.";
      unanswered = true;
    }
  }

  reply = stripInternalLeaks(reply);

  return {
    replyText: reply,
    sentences: splitIntoSentences(reply),
    intent,
    sources,
    unanswered,
  };
}

