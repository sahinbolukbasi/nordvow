import { prisma } from "../db";
import { getConfig } from "../config/store";
import { getLlm } from "../llm";
import { SendBlockedError, sendMessage } from "../messaging/send";
import { assignConversation } from "../messaging/inbox";
import { applyGuardrails } from "./guardrails";
import { retrieveWithConfidence, type KnowledgeScope } from "./rag";
import { invokeAgentCore, isAgentCoreEnabled } from "./agentcore";
import { classifyAssistantIntent, type AssistantIntent } from "./intent-router";
import { stripInternalLeaks, validateAssistantOutput } from "./output-validator";

/**
 * Agent çalışma zamanı: Niyet yönlendirme + onaylı bilgi tabanı (RAG) + kaynak gösterimi +
 * çıktı doğrulama (uydurma rakam ve iç terim sızıntısı koruması) + güven eşiği ve insana aktarma.
 * İnsana aktarma tetiklendiğinde agent cevap üretmeyi BIRAKIR (yarım yanıt yok).
 */
export type CitedSource = {
  sourceId: string;
  title: string;
  confidence: number;
};

export type AgentDecision =
  | { kind: "reply"; text: string; confidence: number; intent: AssistantIntent; sources: CitedSource[] }
  | { kind: "handoff"; reason: HandoffReason; intent: AssistantIntent; customerMessage?: string }
  | { kind: "silent"; reason: string };

export type HandoffReason =
  | "dusuk_guven"
  | "kaynak_yok"
  | "insan_istedi"
  | "tur_limiti"
  | "olumsuz_duygu"
  | "tool_hatasi"
  | "hassas_konu"
  | "kisisel_veri"
  | "guardrail"
  | "mesai_disi";

export const HANDOFF_MESSAGE = "Bu konuda ekibimiz size en geç 2 saat içinde dönecek.";
export const COMPLAINT_HANDOFF_MESSAGE =
  "Yaşadığınız olumsuzluk için üzgünüz. Talebinizi öncelikli olarak ilgili temsilcimize aktardım; ekibimiz size en geç 2 saat içinde dönecek.";
export const OUT_OF_HOURS_MESSAGE =
  "Şu an mesai saatlerimiz dışındayız. Mesajınızı aldık; ekibimiz mesai başlangıcında size dönüş yapacak.";

type BusinessHours = { days?: number[]; start?: string; end?: string };

/** Mesai saati kontrolü (Europe/Istanbul, UTC+3). Tanımsızsa her zaman mesai içi. */
export function isWithinHours(bh: unknown, at: Date): boolean {
  const h = (bh ?? null) as BusinessHours | null;
  if (!h || !h.days || !h.start || !h.end) return true;
  const local = new Date(at.getTime() + 3 * 3_600_000);
  const day = local.getUTCDay();
  const hm = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
  return h.days.includes(day) && hm >= h.start && hm < h.end;
}

export const handoffReasonLabels: Record<HandoffReason, string> = {
  dusuk_guven: "Güven eşiği altında",
  kaynak_yok: "Bilgi tabanında kaynak yok",
  insan_istedi: "Kullanıcı temsilci istedi",
  tur_limiti: "Maksimum tur sınırı aşıldı",
  olumsuz_duygu: "Şikâyet / olumsuz deneyim",
  tool_hatasi: "Sistem sorgusu yapılamadı",
  hassas_konu: "Hassas konu",
  kisisel_veri: "Kişisel veri / doğrulama gerekli",
  guardrail: "İçerik güvenlik filtresi",
  mesai_disi: "Mesai saatleri dışı",
};

export interface UnansweredQuestionEntry {
  question: string;
  count: number;
  intent: AssistantIntent;
  reason: string;
  lastSeenAt: string;
}

const UNANSWERED_PREFIX = "assistant.unanswered.";

/** Cevapsız kalan soruları analitik kartı için kaydeder (en sık 10 soru + "Bilgi tabanına ekle"). */
export async function recordUnansweredQuestion(
  tenantId: string,
  question: string,
  intent: AssistantIntent,
  reason: string,
): Promise<void> {
  const clean = question.trim().slice(0, 240);
  if (clean.length < 3) return;
  try {
    const key = `${UNANSWERED_PREFIX}${tenantId}`;
    const existing = await prisma.configValue.findUnique({ where: { key } });
    const list = Array.isArray(existing?.value) ? (existing.value as unknown as UnansweredQuestionEntry[]) : [];
    const normQ = clean.toLocaleLowerCase("tr");
    const found = list.find((item) => item.question.toLocaleLowerCase("tr") === normQ);
    if (found) {
      found.count += 1;
      found.lastSeenAt = new Date().toISOString();
      found.reason = reason;
    } else {
      list.push({ question: clean, count: 1, intent, reason, lastSeenAt: new Date().toISOString() });
    }
    list.sort((a, b) => b.count - a.count);
    const trimmed = list.slice(0, 40);
    await prisma.configValue.upsert({
      where: { key },
      create: { key, value: trimmed as unknown as object, note: "Asistan cevapsız sorular listesi" },
      update: { value: trimmed as unknown as object },
    });
  } catch {
    // Analitik kaydı ana yanıt akışını bozmaz.
  }
}

export async function listUnansweredQuestions(tenantId: string, limit = 10): Promise<UnansweredQuestionEntry[]> {
  try {
    const row = await prisma.configValue.findUnique({ where: { key: `${UNANSWERED_PREFIX}${tenantId}` } });
    if (!row || !Array.isArray(row.value)) return [];
    return (row.value as unknown as UnansweredQuestionEntry[]).slice(0, limit);
  } catch {
    return [];
  }
}

const SHIPMENT_STATUS_TR: Record<string, string> = {
  ADRES_BEKLIYOR: "Adres onayı bekleniyor",
  HAZIRLANIYOR: "Hazırlanıyor",
  KARGOLANDI: "Kargoya verildi",
  DAGITIMDA: "Dağıtımda",
  TESLIM_EDILDI: "Teslim edildi",
  SORUNLU: "Teslimatta sorun bildirildi",
  IADE_EDILDI: "İade edildi",
};

/** Kargo yönetimi modülünden yalnızca ilgili markanın gönderi durumunu sorgular. */
export async function lookupBrandShipmentStatus(tenantId: string, trackingCode: string): Promise<string | null> {
  try {
    const shipment = await prisma.shipment.findFirst({
      where: {
        brandId: tenantId,
        OR: [
          { trackingNumber: { equals: trackingCode, mode: "insensitive" } },
          { externalShipmentId: { equals: trackingCode, mode: "insensitive" } },
        ],
      },
      select: {
        status: true,
        carrierName: true,
        trackingNumber: true,
        deliveredAt: true,
        estimatedDeliveryDate: true,
      },
    });
    if (!shipment) return null;
    const statusText = SHIPMENT_STATUS_TR[shipment.status] ?? shipment.status;
    const carrier = shipment.carrierName ? ` (${shipment.carrierName})` : "";
    const dateInfo = shipment.deliveredAt
      ? ` Teslim tarihi: ${shipment.deliveredAt.toLocaleDateString("tr-TR")}.`
      : shipment.estimatedDeliveryDate
        ? ` Tahmini teslimat: ${shipment.estimatedDeliveryDate.toLocaleDateString("tr-TR")}.`
        : "";
    return `${shipment.trackingNumber ?? trackingCode} numaralı gönderinizin durumu: ${statusText}${carrier}.${dateInfo}`;
  } catch {
    return null;
  }
}

function norm(s: string): string {
  return s.toLocaleLowerCase("tr");
}

export async function detectHandoff(text: string, cfg: { handoffKeywords: string[] }, turns: number, maxTurns: number): Promise<HandoffReason | null> {
  const t = norm(text);
  if (cfg.handoffKeywords.some((k) => t.includes(norm(k)))) return "insan_istedi";
  const sensitive = await getConfig("sensitive.keywords");
  if ((sensitive.sikayet ?? []).some((k) => t.includes(norm(k)))) return "olumsuz_duygu";
  for (const [topic, words] of Object.entries(sensitive)) {
    if (topic === "sikayet") continue;
    if (words.some((k) => t.includes(norm(k)))) return "hassas_konu";
  }
  if (turns >= maxTurns) return "tur_limiti";
  return null;
}

type Tool = (args: Record<string, unknown>) => Promise<string>;
/** Tenant tool'ları (e-ticaret, randevu, CRM webhook'ları) — adapter; test/mock'ta değiştirilebilir. */
export const tools: Record<string, Tool> = {
  async order_lookup() {
    throw new Error("Sipariş webhook'u yapılandırılmadı");
  },
};

export const CREATOR_APPLICATION_REPLY =
  "Influencer olarak başvurmak için 3 kısa adımı izleyebilirsiniz: 1) nordvow.com/kayit sayfasından ücretsiz içerik üreticisi hesabı oluşturun, 2) Instagram, TikTok veya YouTube hesabınızı bağlayın, 3) Markaların açık kampanyalarına profiliniz üzerinden başvurun.";

export const CAMPAIGN_STATUS_VERIFY_REPLY =
  "Teklif, içerik onayı veya ödeme durumunuzu paylaşabilmem için kimliğinizi doğrulamamız gerekiyor. Lütfen Nordvow hesabınıza giriş yaparak Teklifler / Ödemeler ekranından kontrol edin veya kayıtlı e-posta adresinizi paylaşın; ekibimiz doğrulama sonrası yardımcı olsun.";

export const TAX_20B_GENERAL_REPLY =
  "20/B sosyal içerik üreticisi istisnası genel olarak istisna belgesi ve özel banka hesabı üzerinden stopaj kesintisiyle işler. Bu bilgi genel bilgilendirme amaçlıdır; vergi tavsiyesi değildir, kesin durumunuz için mali müşavirinize danışmanızı öneririz.";

export async function decide(tenantId: string, conversationId: string, text: string): Promise<AgentDecision> {
  const conv = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
  if (!conv) return { kind: "silent", reason: "konuşma yok" };
  if (conv.status === "awaiting_human" || conv.status === "assigned") return { kind: "silent", reason: "insan temsilcide" };
  const cfg = await prisma.agentConfig.findFirst({
    where: { tenantId, enabled: true, ...(conv.agentKey ? { agentId: conv.agentKey } : { agentId: "brand_faq" }) },
  });
  if (!cfg) return { kind: "silent", reason: "agent etkin değil" };

  const intentRes = classifyAssistantIntent(text);
  const scope: KnowledgeScope = cfg.agentId === "influencer_assistant" ? "influencer" : "brand";

  // 1) Şikâyet niyeti -> her zaman nazik özür ve anında insana aktarma
  if (intentRes.intent === "sikayet") {
    return { kind: "handoff", reason: "olumsuz_duygu", intent: "sikayet", customerMessage: COMPLAINT_HANDOFF_MESSAGE };
  }

  // 2) Kural tabanlı insana aktarma kontrolleri (anahtar kelime, hassas konu, tur limiti)
  const reason = await detectHandoff(text, cfg, conv.agentTurns, cfg.maxTurnsBeforeHandoff);
  if (reason) return { kind: "handoff", reason, intent: intentRes.intent };

  // 3) Girdi güvenlik filtresi (PII / kart / IBAN / yasaklı konular)
  const input = await applyGuardrails(text, "INPUT");
  if (input.action === "BLOCKED") return { kind: "handoff", reason: "kisisel_veri", intent: intentRes.intent };

  // 4) Influencer asistanı için 20/B vergi sorusu koruması (asla vergi tavsiyesi vermez)
  if (scope === "influencer" && /\b(?:20\s*\/?\s*b|istisna\s+belge|vergi|stopaj|mali\s+musavir)\b/i.test(input.text)) {
    return {
      kind: "reply",
      text: TAX_20B_GENERAL_REPLY,
      confidence: 0.95,
      intent: "kampanya_durumu",
      sources: [{ sourceId: "policy_20b", title: "Genel 20/B bilgilendirmesi", confidence: 0.95 }],
    };
  }

  // 5) Niyet bazlı doğrudan yönlendirme
  if (intentRes.intent === "basvuru") {
    return {
      kind: "reply",
      text: CREATOR_APPLICATION_REPLY,
      confidence: 0.95,
      intent: "basvuru",
      sources: [{ sourceId: "system_creator_signup", title: "İçerik Üreticisi Kayıt Akışı", confidence: 0.95 }],
    };
  }

  if (intentRes.intent === "kargo" || cfg.agentId === "order_status") {
    if (!intentRes.extractedOrderCode) {
      return {
        kind: "reply",
        text: "Kargonuzun durumunu kontrol edebilmem için lütfen sipariş veya kargo takip numaranızı paylaşır mısınız?",
        confidence: 0.92,
        intent: "kargo",
        sources: [{ sourceId: "module_shipping", title: "Kargo Yönetimi", confidence: 0.92 }],
      };
    }
    const shipmentReply = await lookupBrandShipmentStatus(tenantId, intentRes.extractedOrderCode);
    if (shipmentReply) {
      return {
        kind: "reply",
        text: shipmentReply,
        confidence: 0.96,
        intent: "kargo",
        sources: [{ sourceId: `shipment_${intentRes.extractedOrderCode}`, title: "Kargo Yönetimi Modülü", confidence: 0.96 }],
      };
    }
    try {
      const out = await tools.order_lookup!({ text: input.text, orderCode: intentRes.extractedOrderCode });
      return {
        kind: "reply",
        text: stripInternalLeaks(out),
        confidence: 0.95,
        intent: "kargo",
        sources: [{ sourceId: "tool_order_lookup", title: "Sipariş Sorgulama", confidence: 0.95 }],
      };
    } catch {
      return { kind: "handoff", reason: "kisisel_veri", intent: "kargo" };
    }
  }

  if (intentRes.intent === "kampanya_durumu" && scope !== "influencer") {
    return {
      kind: "reply",
      text: CAMPAIGN_STATUS_VERIFY_REPLY,
      confidence: 0.9,
      intent: "kampanya_durumu",
      sources: [{ sourceId: "policy_verification", title: "Kimlik Doğrulama Politikası", confidence: 0.9 }],
    };
  }

  if (intentRes.intent === "fiyat" && intentRes.needsCustomQuote) {
    return { kind: "handoff", reason: "insan_istedi", intent: "fiyat" };
  }

  // 6) Onaylı bilgi tabanında RAG araması (taslak ve reddedilen maddeler hariç)
  const hits = await retrieveWithConfidence(tenantId, input.text, 4, scope);
  if (hits.length === 0) {
    await recordUnansweredQuestion(tenantId, text, intentRes.intent, "kaynak_yok");
    return { kind: "handoff", reason: "kaynak_yok", intent: intentRes.intent };
  }

  const retrievalConfidence = hits[0]?.confidence ?? 0;
  const threshold = Number(cfg.confidenceThreshold);
  if (retrievalConfidence < threshold) {
    await recordUnansweredQuestion(tenantId, text, intentRes.intent, "dusuk_guven");
    return { kind: "handoff", reason: "dusuk_guven", intent: intentRes.intent };
  }

  const allowedContext = hits.map((h) => h.content).join("\n");
  const ragPrompt = [
    "Yalnızca aşağıdaki onaylı bilgi parçalarına dayanarak kısa, nazik, Türkçe yanıt ver.",
    "Bilgi parçalarında olmayan hiçbir fiyat, tarih, yüzde veya kupon kodu UYDURMA.",
    "Cevabın sonuna güven düzeyini ekleme; sadece müşteri yanıtını yaz.",
    "",
    "Onaylı bilgi parçaları:",
    ...hits.map((h, i) => `[${i + 1} - ${h.sourceTitle}] ${h.content}`),
    "",
    `Soru: ${input.text}`,
  ].join("\n");

  let draft = "";
  if (isAgentCoreEnabled()) {
    try {
      const ac = await invokeAgentCore({
        sessionId: conversationId,
        prompt: ragPrompt,
        systemPrompt: cfg.systemPrompt,
        metadata: { tenantId, agentId: cfg.agentId, confidence: retrievalConfidence, intent: intentRes.intent },
      });
      if (ac?.text) draft = ac.text;
    } catch (err) {
      console.warn("[assistant/runtime] AgentCore fallback to Bedrock Converse:", (err as Error).message);
    }
  }

  if (!draft) {
    try {
      const llm = await getLlm().completeText({
        system: cfg.systemPrompt,
        promptVersion: `agent-${cfg.agentId}@2`,
        prompt: ragPrompt,
      });
      draft = llm.text.startsWith("[Otomatik") ? hits[0]!.content : llm.text;
    } catch (err) {
      console.error("[assistant/runtime] LLM çağrısı başarısız, doğrulanmış kaynak metne dönüldü:", err);
      draft = hits[0]!.content;
    }
  }

  // 7) Çıktı doğrulama: iç terim sızıntısı + uydurma fiyat/tarih/kod kontrolü
  const validation = validateAssistantOutput(draft, allowedContext);
  if (!validation.ok) {
    console.warn("[assistant/runtime] Çıktı doğrulayıcı engelledi:", validation);
    // Uydurma rakam varsa en ilgili doğrulanmış bilgi parçasına düş (halüsinasyon = 0)
    if (validation.fabricatedValues.length > 0 && hits[0]?.content) {
      draft = hits[0].content;
    } else {
      return { kind: "handoff", reason: "guardrail", intent: intentRes.intent };
    }
  }

  const out = await applyGuardrails(draft, "OUTPUT");
  if (out.action === "BLOCKED" || !out.text.trim()) {
    return { kind: "handoff", reason: "guardrail", intent: intentRes.intent };
  }

  // Birleşik güven: retrieval skoru + niyet eşleşme uyumu
  const combinedConfidence = Math.min(1, Number((retrievalConfidence * 0.8 + intentRes.confidence * 0.2).toFixed(3)));
  if (combinedConfidence < threshold) {
    await recordUnansweredQuestion(tenantId, text, intentRes.intent, "dusuk_guven");
    return { kind: "handoff", reason: "dusuk_guven", intent: intentRes.intent };
  }

  const sources: CitedSource[] = hits
    .filter((h) => h.confidence >= Math.max(0.25, threshold * 0.5))
    .slice(0, 3)
    .map((h) => ({ sourceId: h.sourceId, title: h.sourceTitle, confidence: Number(h.confidence.toFixed(2)) }));

  return {
    kind: "reply",
    text: stripInternalLeaks(out.text),
    confidence: combinedConfidence,
    intent: intentRes.intent,
    sources,
  };
}

/** İnsana aktarma: awaiting_human, "Asistan emin değil" etiketi, AI ücreti yok, atama, kullanıcı bilgilendirme, SLA başlar. */
export async function handoff(
  tenantId: string,
  conversationId: string,
  reason: HandoffReason,
  now = new Date(),
  customMessage?: string,
) {
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { agentKey: true, tags: true } });
  const cfg = await prisma.agentConfig.findFirst({ where: { tenantId, agentId: conv?.agentKey ?? "brand_faq" } });
  const outOfHours = cfg ? !isWithinHours(cfg.businessHours, now) : false;
  const nextTags = [...new Set([...(conv?.tags ?? []), "Asistan emin değil", handoffReasonLabels[reason]])];

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      status: "awaiting_human",
      aiChargeable: false,
      handoffReason: reason,
      slaStartedAt: now,
      tags: nextTags,
    },
  });
  await assignConversation(tenantId, conversationId);
  try {
    if (!outOfHours) {
      await sendMessage({ tenantId, conversationId, byUserId: null, text: customMessage ?? HANDOFF_MESSAGE, now });
    } else if (cfg?.outOfHoursBehavior === "auto_reply_then_queue") {
      await sendMessage({ tenantId, conversationId, byUserId: null, text: OUT_OF_HOURS_MESSAGE, now });
    }
  } catch (e) {
    if (!(e instanceof SendBlockedError)) throw e;
  }
}

/** Gelen mesaj için agent turu. */
export async function runAgentTurn(tenantId: string, conversationId: string, text: string, now = new Date()) {
  const decision = await decide(tenantId, conversationId, text);
  if (decision.kind === "handoff") {
    await handoff(tenantId, conversationId, decision.reason, now, decision.customerMessage);
  } else if (decision.kind === "reply") {
    await sendMessage({ tenantId, conversationId, byUserId: null, text: decision.text, now });
    await prisma.conversation.update({ where: { id: conversationId }, data: { agentTurns: { increment: 1 } } });
  }
  return decision;
}

/** Konuşma yeniden açılırsa AI ücreti iade edilir (Intercom adalet mekaniği). */
export async function reopenConversation(tenantId: string, conversationId: string) {
  await prisma.conversation.updateMany({ where: { id: conversationId, tenantId }, data: { status: "open", aiChargeable: false } });
}

/** Faturalanabilir AI konuşmaları: insana aktarılan/yeniden açılanlar hariç. */
export async function billableAiConversations(tenantId: string, since: Date) {
  return prisma.conversation.count({ where: { tenantId, aiChargeable: true, agentTurns: { gt: 0 }, createdAt: { gte: since } } });
}
