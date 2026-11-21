"use server";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { AGENT_TEMPLATES, activateAgent, type AgentKey } from "@infulancer/core/assistant/catalog";
import { seedBrandKnowledgeDrafts } from "@infulancer/core/assistant/seeder";
import { simulateReply, type SimResult } from "@infulancer/core/assistant/simulate";
import { DomainError } from "@infulancer/core/domain/errors";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import type { ActionState } from "@/lib/action-state";
import { attempt, parseInput, revalidateAll, str, toErrorState } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";

const DEFAULT_KEYWORDS = ["insan", "temsilci", "müşteri hizmetleri", "yetkili", "şikayet"];

/** Test ekranı sonucu (yan etkisiz; gerçek mesaj gönderilmez). */
export type AssistantTestState = ActionState & {
  result?: SimResult;
  question?: string;
  notConfigured?: boolean;
  brandName?: string;
};

const testSchema = z.object({
  agentId: z.enum(AGENT_TEMPLATES.map((t) => t.key) as [AgentKey, ...AgentKey[]]),
  message: z.string().min(1, { error: "Bir mesaj yazın." }).max(1000),
});

async function resolveBrandForAssistant(actor: { role: string; brandId?: string | null }, fd: FormData) {
  const rawTenantId = actor.role === "BRAND" ? (actor.brandId ?? "") : str(fd, "tenantId");
  if (rawTenantId) {
    const brand = await prisma.brand.findUnique({ where: { id: rawTenantId }, select: { id: true, name: true } });
    if (brand) return brand;
  }
  if (actor.role === "ADMIN") {
    // Admin oturumunda tenantId seçili değilse ilk markayı dene; hiç marka yoksa açıklayıcı mesaj dön.
    const first = await prisma.brand.findFirst({ orderBy: { name: "asc" }, select: { id: true, name: true } });
    if (first) return first;
  }
  return null;
}

/**
 * Asistanı canlıya almadan dener: kayıtlı ayarlarla (yoksa şablon varsayılanıyla) gelen
 * mesaja üretilecek yanıtı hesaplar. Hiçbir dış API çağrılmaz, hiçbir mesaj gönderilmez.
 */
export async function testAssistantAction(_p: AssistantTestState, fd: FormData): Promise<AssistantTestState> {
  const actor = await requireActor("ADMIN", "BRAND");
  try {
    const brand = await resolveBrandForAssistant(actor, fd);
    if (!brand) {
      return {
        ok: false,
        notConfigured: true,
        error: "Bu markada asistan henüz kurulmadı → Önce üstten bir marka seçip Hızlı kurulum ile açın.",
      };
    }
    const tenantId = brand.id;
    const input = parseInput(testSchema, { agentId: str(fd, "agentId"), message: str(fd, "message") });
    const t = AGENT_TEMPLATES.find((x) => x.key === input.agentId)!;
    const cfg = await prisma.agentConfig.findUnique({ where: { tenantId_agentId: { tenantId, agentId: input.agentId } } });
    const bh = (cfg?.businessHours ?? { days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00" }) as unknown;
    const result = await simulateReply(
      tenantId,
      {
        agentId: input.agentId,
        systemPrompt: cfg?.systemPrompt ?? t.systemPrompt,
        handoffKeywords: cfg?.handoffKeywords?.length ? cfg.handoffKeywords : DEFAULT_KEYWORDS,
        confidenceThreshold: Number(cfg?.confidenceThreshold ?? 0.7),
        maxTurnsBeforeHandoff: cfg?.maxTurnsBeforeHandoff ?? 4,
        businessHours: bh,
        outOfHoursBehavior: cfg?.outOfHoursBehavior ?? "queue",
      },
      input.message,
    );
    return {
      ok: true,
      notConfigured: !cfg,
      brandName: brand.name,
      message: !cfg
        ? `${brand.name} markasında ${t.name} henüz kurulmadı — şablon varsayılanlarıyla önizleme gösteriliyor. Canlıya almak için Hızlı kurulum'dan açın.`
        : `${brand.name} için önizleme hazır (gerçek mesaj gönderilmedi).`,
      result,
      question: input.message,
    };
  } catch (err) {
    return toErrorState(err);
  }
}

const quickSchema = z.object({
  agentId: z.enum(AGENT_TEMPLATES.map((t) => t.key) as [AgentKey, ...AgentKey[]]),
  tone: z.enum(["samimi", "profesyonel", "kisa"]),
});

const TONE_SUFFIX: Record<string, string> = {
  samimi: " Sıcak ve samimi bir dille, emoji kullanmadan yaz.",
  profesyonel: " Resmî ve profesyonel bir dille yaz.",
  kisa: " Çok kısa ve net yanıtlar ver.",
};

/**
 * Hızlı kurulum: bir şablon asistanı tek adımda açar, seçilen tona göre talimatı ayarlar
 * ve bilgi tabanı boşsa marka profili + aktif kampanyalardan otomatik taslak üretir.
 */
export async function quickSetupAssistantAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const brand = await resolveBrandForAssistant(actor, fd);
    if (!brand) throw new DomainError("BULUNAMADI", "Bu markada asistan henüz kurulmadı — lütfen geçerli bir marka seçin.");
    const tenantId = brand.id;
    const input = parseInput(quickSchema, { agentId: str(fd, "agentId"), tone: str(fd, "tone") });
    const t = AGENT_TEMPLATES.find((x) => x.key === input.agentId)!;
    await activateAgent(tenantId, input.agentId);
    await prisma.agentConfig.update({
      where: { tenantId_agentId: { tenantId, agentId: input.agentId } },
      data: { enabled: true, systemPrompt: t.systemPrompt + (TONE_SUFFIX[input.tone] ?? "") },
    });
    const kbCount = await prisma.knowledgeSource.count({ where: { tenantId, status: { in: ["ready", "approved", "draft"] } } });
    let seededMsg = "";
    if (kbCount === 0) {
      const seeded = await seedBrandKnowledgeDrafts(tenantId).catch(() => null);
      if (seeded && seeded.createdCount > 0) {
        seededMsg = ` Ayrıca ${seeded.createdCount} bilgi tabanı taslağı hazırlandı — aşağıdan onaylayın.`;
      }
    }
    await audit.append({ actor: toAuditActor(actor), action: "ASSISTANT_QUICK_SETUP", entityType: "AgentConfig", entityId: `${tenantId}:${input.agentId}`, data: { tone: input.tone } });
    revalidateAll();
    return { ok: true, message: `${brand.name} için ${t.name} açıldı.${seededMsg}` };
  });
}
