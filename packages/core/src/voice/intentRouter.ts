import { envStr } from "../env";
import { converseStructured } from "../llm/bedrock";
import type { IntentRouteResult, VoiceBusinessHours, VoiceRoutingRule } from "./types";

export function isWithinBusinessHours(bh?: VoiceBusinessHours | null, now = new Date()): boolean {
  if (!bh) return true;
  try {
    const tz = bh.timezone || "Europe/Istanbul";
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wdStr = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const day = map[wdStr] ?? 1;
    if (!bh.days.includes(day)) return false;

    const hh = parts.find((p) => p.type === "hour")?.value ?? "12";
    const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
    const cur = `${hh}:${mm}`;
    return cur >= bh.start && cur <= bh.end;
  } catch {
    return true;
  }
}

/**
 * Bedrock (Claude) veya kural yedeğiyle arayanın niyetini tespit eder:
 * info_question | transfer | callback | goodbye
 */
export async function routeVoiceIntent(input: {
  utterance: string;
  routingRules: VoiceRoutingRule[];
  businessHours?: VoiceBusinessHours | null;
}): Promise<IntentRouteResult> {
  const norm = input.utterance.toLocaleLowerCase("tr");
  const inHours = isWithinBusinessHours(input.businessHours);

  // Hızlı kural eşleşmesi (vedalaşma / açık yönlendirme anahtar kelimeleri)
  if (/(görüşürüz|teşekkürler iyi günler|hoşça kal|kapatabiliriz|tamamdır sağ olun)/.test(norm)) {
    return { intent: "goodbye", reason: "Arayan görüşmeyi sonlandırdı." };
  }

  for (const r of input.routingRules) {
    if (norm.includes(r.keyword.toLocaleLowerCase("tr"))) {
      if (!inHours || r.targetType === "callback") {
        return {
          intent: "callback",
          transferTarget: { type: "callback", value: r.targetValue, label: r.label },
          reason: inHours ? "Geri dönüş kuralı eşleşti." : "Mesai dışı olduğu için geri dönüş talebine yönlendirildi.",
        };
      }
      return {
        intent: "transfer",
        transferTarget: { type: r.targetType, value: r.targetValue, label: r.label },
        reason: `Yönlendirme kuralı eşleşti: ${r.label}`,
      };
    }
  }

  if (/(geri ara|geri dönüş|numaramı bırak|beni arayın)/.test(norm)) {
    return { intent: "callback", reason: "Arayan geri dönüş talep etti." };
  }

  if (/(yetkili|müşteri temsilcisi|insan|canlı destek|operatör|bağlar mısın|aktar)/.test(norm)) {
    const defRule = input.routingRules[0];
    if (!inHours || !defRule) {
      return { intent: "callback", reason: "Mesai dışı veya temsilci kuralı yok; geri dönüşe alındı." };
    }
    return {
      intent: "transfer",
      transferTarget: { type: defRule.targetType, value: defRule.targetValue, label: defRule.label },
      reason: "Arayan canlı temsilciye bağlanmak istedi.",
    };
  }

  if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
    try {
      const res = await converseStructured<{ intent: "info_question" | "transfer" | "callback" | "goodbye"; ruleKeyword?: string | null; reason: string }>({
        system:
          "Sen çağrı merkezi niyet yönlendiricisisin. Arayanın cümlesini şu 4 niyetten birine sınıfla: info_question, transfer, callback, goodbye.",
        turns: [
          {
            role: "user",
            text: `Yönlendirme kuralları: ${input.routingRules.map((r) => r.keyword).join(", ") || "yok"}\nMesai içi mi: ${inHours}\nArayan: ${input.utterance}`,
          },
        ],
        schemaName: "voice_intent",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["intent", "reason"],
          properties: {
            intent: { type: "string", enum: ["info_question", "transfer", "callback", "goodbye"] },
            ruleKeyword: { type: ["string", "null"] },
            reason: { type: "string" },
          },
        },
        maxTokens: 200,
        temperature: 0,
      });
      if (res.data) {
        if (res.data.intent === "transfer") {
          const matched = input.routingRules.find((r) => res.data?.ruleKeyword && r.keyword.toLowerCase() === res.data.ruleKeyword.toLowerCase()) ?? input.routingRules[0];
          if (!inHours || !matched) return { intent: "callback", reason: res.data.reason };
          return {
            intent: "transfer",
            transferTarget: { type: matched.targetType, value: matched.targetValue, label: matched.label },
            reason: res.data.reason,
          };
        }
        return { intent: res.data.intent, reason: res.data.reason };
      }
    } catch {
      /* fallback */
    }
  }

  return { intent: "info_question", reason: "Bilgi sorusu olarak değerlendirildi." };
}

