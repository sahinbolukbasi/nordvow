"use server";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { activateAgent, type AgentKey } from "@infulancer/core/assistant/catalog";
import { approveKnowledgeSource, ingestText, rejectKnowledgeSource } from "@infulancer/core/assistant/rag";
import { seedBrandKnowledgeDrafts } from "@infulancer/core/assistant/seeder";
import { reopenConversation } from "@infulancer/core/assistant/runtime";
import { completeWhatsAppSignup, confirmPaymentMethod, connectInstagram, OnboardingError } from "@infulancer/core/channels/onboarding";
import { recordConsent, ConsentError } from "@infulancer/core/compliance/iys";
import { KvkkGateError, setTenantMode, signStandardContract, uploadFilingReceipt, type TransferTarget } from "@infulancer/core/compliance/kvkk";
import { declareVerticals } from "@infulancer/core/compliance/policy";
import { DomainError } from "@infulancer/core/domain/errors";
import { SendBlockedError, sendMessage } from "@infulancer/core/messaging/send";
import { containsPromotion } from "@infulancer/core/messaging/templates";
import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, parseInput, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";

/** Dış katman hatalarını Türkçe DomainError'a çevirir. */
function wrap(e: unknown): never {
  if (e instanceof SendBlockedError || e instanceof OnboardingError || e instanceof ConsentError || e instanceof KvkkGateError) {
    throw new DomainError("KURAL_IHLALI", e.message);
  }
  throw e;
}

async function brandActor() {
  const a = await requireActor("BRAND");
  return { actor: a, tenantId: a.brandId! };
}

async function brandOrAdminTenant(fd: FormData) {
  const a = await requireActor("BRAND", "ADMIN");
  const tenantId = a.role === "BRAND" ? a.brandId! : str(fd, "tenantId");
  if (!tenantId) throw new DomainError("DOGRULAMA", "Marka seçilmedi.");
  const brand = await prisma.brand.findUnique({ where: { id: tenantId }, select: { id: true } });
  if (!brand) throw new DomainError("BULUNAMADI", "Seçili marka bulunamadı.");
  return { actor: a, tenantId };
}

export async function sendInboxMessage(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, tenantId } = await brandActor();
  return attempt(async () => {
    const input = parseInput(z.object({ conversationId: z.string().min(1).max(64), text: z.string().max(4000).nullable(), templateId: z.string().max(64).nullable() }), {
      conversationId: str(fd, "conversationId"),
      text: optStr(fd, "text"),
      templateId: optStr(fd, "templateId"),
    });
    await sendMessage({ tenantId, conversationId: input.conversationId, byUserId: actor.userId, text: input.templateId ? undefined : input.text ?? "", templateId: input.templateId ?? undefined }).catch(wrap);
    revalidateAll();
    return { ok: true, message: "Mesaj gönderildi." };
  });
}

export async function updateConversation(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { actor, tenantId } = await brandActor();
  return attempt(async () => {
    const id = str(fd, "conversationId");
    const op = str(fd, "op");
    if (op === "take") await prisma.conversation.updateMany({ where: { id, tenantId }, data: { status: "assigned", assignedUserId: actor.userId } });
    else if (op === "close") await prisma.conversation.updateMany({ where: { id, tenantId }, data: { status: "closed" } });
    else if (op === "reopen") await reopenConversation(tenantId, id);
    else throw new DomainError("DOGRULAMA", "Geçersiz işlem.");
    revalidateAll();
    return { ok: true, message: "Konuşma güncellendi." };
  });
}

export async function signupWhatsApp(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandActor();
  return attempt(async () => {
    const input = parseInput(
      z.object({ code: z.string().min(1).max(500), wabaId: z.string().regex(/^\d{5,30}$/), phoneNumberId: z.string().regex(/^\d{5,30}$/), pin: z.string().regex(/^\d{6}$/, { error: "PIN 6 haneli olmalı." }), displayNumber: z.string().max(30).nullable() }),
      { code: str(fd, "code"), wabaId: str(fd, "wabaId"), phoneNumberId: str(fd, "phoneNumberId"), pin: str(fd, "pin"), displayNumber: optStr(fd, "displayNumber") },
    );
    await completeWhatsAppSignup({ tenantId, ...input, displayNumber: input.displayNumber ?? undefined }).catch(wrap);
    revalidateAll();
    return { ok: true, message: "WhatsApp numarası bağlandı. Son adım: WhatsApp Manager'da ödeme yöntemi." };
  });
}

/** Instagram DM bağlantısı (Meta ile giriş penceresinden dönen kod + sayfa/hesap kimlikleri). */
export async function connectInstagramAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandActor();
  return attempt(async () => {
    const input = parseInput(
      z.object({
        code: z.string().min(1).max(500),
        pageId: z.string().regex(/^\d{5,30}$/, { error: "Sayfa ID sayısal olmalı." }),
        igUserId: z.string().regex(/^\d{5,30}$/, { error: "Instagram hesap ID sayısal olmalı." }),
        accountType: z.enum(["BUSINESS", "CREATOR", "PERSONAL"]),
      }),
      { code: str(fd, "code"), pageId: str(fd, "pageId"), igUserId: str(fd, "igUserId"), accountType: str(fd, "accountType") },
      { code: "Bağlantı kodu", pageId: "Facebook Sayfa ID", igUserId: "Instagram hesap ID" },
    );
    const existing = await prisma.channelConnection.findFirst({ where: { tenantId, provider: "INSTAGRAM", status: "ACTIVE" }, select: { id: true } });
    if (existing) throw new DomainError("DOGRULAMA", "Instagram hesabı zaten bağlı.");
    await connectInstagram({ tenantId, ...input }).catch(wrap);
    revalidateAll();
    return { ok: true, message: "Instagram bağlandı. DM'ler Gelen kutusu'na düşecek." };
  });
}
export async function confirmPayment(): Promise<ActionState> {
  const { tenantId } = await brandActor();
  return attempt(async () => {
    await confirmPaymentMethod(tenantId);
    revalidateAll();
    return { ok: true, message: "Ödeme yöntemi onaylandı; onboarding tamamlandı." };
  });
}

export async function enableAgent(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandActor();
  return attempt(async () => {
    await activateAgent(tenantId, str(fd, "key") as AgentKey);
    revalidateAll();
    return { ok: true, message: "Agent etkinleştirildi." };
  });
}

export async function addKnowledge(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandOrAdminTenant(fd);
  return attempt(async () => {
    const input = parseInput(z.object({ title: z.string().min(2).max(140), text: z.string().min(10).max(50_000) }), { title: str(fd, "title"), text: str(fd, "text") });
    const scope = str(fd, "scope") === "influencer" ? "influencer_brief" : "manual";
    const r = await ingestText(tenantId, { type: scope, uri: `${scope}://${input.title}`, text: input.text, status: "ready" });
    revalidateAll();
    return { ok: true, message: `${r.chunks} parça bilgi tabanına eklendi.` };
  });
}

export async function seedKnowledgeDraftsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandOrAdminTenant(fd);
  return attempt(async () => {
    const websiteUrl = optStr(fd, "websiteUrl");
    const r = await seedBrandKnowledgeDrafts(tenantId, { websiteUrl });
    revalidateAll();
    if (r.createdCount === 0) {
      return { ok: true, message: "Yeni taslak bulunamadı; mevcut kaynaklar zaten güncel." };
    }
    return {
      ok: true,
      message: `Asistanınız 3 kaynaktan ${r.createdCount} cevap taslağı hazırladı. 2 dakikada kontrol edip onaylayın.`,
    };
  });
}

export async function approveKnowledgeDraftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandOrAdminTenant(fd);
  return attempt(async () => {
    const sourceId = str(fd, "sourceId");
    const editedText = optStr(fd, "text") ?? undefined;
    if (!sourceId) throw new DomainError("DOGRULAMA", "Kaynak seçilmedi.");
    await approveKnowledgeSource(tenantId, sourceId, editedText);
    revalidateAll();
    return { ok: true, message: "Madde onaylandı ve asistan yanıtlarında aktif edildi." };
  });
}

export async function rejectKnowledgeDraftAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandOrAdminTenant(fd);
  return attempt(async () => {
    const sourceId = str(fd, "sourceId");
    if (!sourceId) throw new DomainError("DOGRULAMA", "Kaynak seçilmedi.");
    await rejectKnowledgeSource(tenantId, sourceId);
    revalidateAll();
    return { ok: true, message: "Taslak reddedildi ve listeden çıkarıldı." };
  });
}

export async function promoteUnansweredQuestionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandOrAdminTenant(fd);
  return attempt(async () => {
    const question = str(fd, "question");
    const answer = str(fd, "answer");
    if (question.length < 3 || answer.length < 5) {
      throw new DomainError("DOGRULAMA", "Soru ve yanıt en az 5 karakter olmalıdır.");
    }
    await ingestText(tenantId, {
      type: "manual",
      uri: `manual://SSS · ${question.slice(0, 60)}`,
      text: `Soru: ${question}\nYanıt: ${answer}`,
      status: "ready",
    });
    // Cevapsız listesinden kaldır
    const key = `assistant.unanswered.${tenantId}`;
    const existing = await prisma.configValue.findUnique({ where: { key } });
    if (existing && Array.isArray(existing.value)) {
      const next = (existing.value as { question: string }[]).filter(
        (x) => x.question.toLocaleLowerCase("tr") !== question.toLocaleLowerCase("tr"),
      );
      await prisma.configValue.update({ where: { key }, data: { value: next as unknown as object } });
    }
    revalidateAll();
    return { ok: true, message: "Yanıt onaylanarak bilgi tabanına eklendi." };
  });
}

export async function createTemplate(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandActor();
  return attempt(async () => {
    const input = parseInput(
      z.object({ name: z.string().regex(/^[a-z0-9_]{3,60}$/, { error: "Küçük harf, rakam ve alt çizgi." }), category: z.enum(["marketing", "utility", "authentication"]), body: z.string().min(3).max(1024) }),
      { name: str(fd, "name"), category: str(fd, "category"), body: str(fd, "body") },
    );
    await prisma.messageTemplate.create({ data: { tenantId, ...input, containsPromotion: containsPromotion(input.body), status: "IN_REVIEW" } });
    revalidateAll();
    return { ok: true, message: "Template incelemeye gönderildi (inceleme 24 saate kadar sürebilir)." };
  });
}

export async function captureConsent(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandActor();
  return attempt(async () => {
    const input = parseInput(z.object({ recipient: z.string().min(5).max(120), channel: z.enum(["MESAJ", "EPOSTA", "ARAMA"]), state: z.enum(["ONAY", "RET"]), evidence: z.string().max(500).nullable(), aydinlatmaVersion: z.string().min(1).max(40) }), {
      recipient: str(fd, "recipient"),
      channel: str(fd, "channel"),
      state: str(fd, "state"),
      evidence: optStr(fd, "evidence"),
      aydinlatmaVersion: str(fd, "aydinlatmaVersion"),
    });
    await recordConsent({ tenantId, ...input, evidence: input.evidence ?? undefined, source: "panel", consentedAt: new Date() }).catch(wrap);
    revalidateAll();
    return { ok: true, message: "Kayıt alındı; 3 iş günü içinde İYS'ye iletilecek." };
  });
}

export async function kvkkAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const { tenantId } = await brandActor();
  return attempt(async () => {
    const op = str(fd, "op");
    if (op === "sign") await signStandardContract(tenantId);
    else if (op === "receipt") await uploadFilingReceipt(tenantId, str(fd, "target") as TransferTarget, str(fd, "s3Key")).catch(wrap);
    else if (op === "production") await setTenantMode(tenantId, "production").catch(wrap);
    else if (op === "verticals") await declareVerticals(tenantId, fd.getAll("vertical").map(String));
    revalidateAll();
    return { ok: true, message: "Kaydedildi." };
  });
}
