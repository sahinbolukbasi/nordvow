import { envStr } from "../env";
import { converseChat, type ChatTurn } from "../llm/bedrock";
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

  const sources = await retrieveBrandKnowledge(input.brandId, input.utterance, 4);
  const contextText = sources.length
    ? sources.map((s, i) => `[Kaynak ${i + 1} - ${s.title}]: ${s.content}`).join("\n\n")
    : "KAYNAK_YOK";

  let reply = "";
  let unanswered = sources.length === 0;

  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const system = [
        `Sen ${input.brandName} şirketinde çalışan gerçek bir müşteri temsilcisisin. Adın ${input.assistantName}.`,
        "Asla 'yapay zekâ', 'bot', 'dijital asistan' veya 'telefon asistanıyım' gibi ifadeler kullanma; tamamen gerçek bir insan gibi konuş.",
        "Doğal, samimi, akıcı günlük Türkçe kullan ('Tabii, hemen bakayım', 'Anlıyorum', 'Memnuniyetle' gibi). En fazla 1 veya 2 kısa cümle kur; uzun paragraflar, liste ve madde işareti kullanma.",
        "Sayı, fiyat, tarih ve saatleri konuşma dilindeki okunuşuyla yaz (ör. 1.250 TL -> bin iki yüz elli lira). Bilgi yoksa uydurma; kibarca adını ve numarasını alıp ekibin döneceğini söyle.",
        input.blockedTopics ? `Cevaplanmayacak konular (bunlar sorulursa kibarca yardımcı olamayacağını söyle): ${input.blockedTopics}` : "",
        `\nŞİRKET BİLGİLERİ:\n${contextText}`,
      ]
        .filter(Boolean)
        .join("\n");

      const turns: ChatTurn[] = [...input.history.slice(-8), { role: "user", text: input.utterance }];
      const res = await converseChat({ system, turns, maxTokens: 160, temperature: 0.55 });
      reply = normalizeForPhoneSpeech(res.text);
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
      reply = "Bu konuda elimde kesin bilgi bulunmuyor. Dilerseniz adınızı ve konunuzu not alayım, yetkili ekibimiz sizi arasın ya da sizi temsilciye aktarayım.";
      unanswered = true;
    }
  }

  return {
    replyText: reply,
    sentences: splitIntoSentences(reply),
    intent,
    sources,
    unanswered,
  };
}

