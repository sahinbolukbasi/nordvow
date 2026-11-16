"use server";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { requestBudgetChange } from "@infulancer/core/ads/budget-optimizer";
import { adjustCredits, ensureStarterCredits, InsufficientCreditsError, setCreditBalance, topUp } from "@infulancer/core/creative/credits";
import { CreativeRejectedError, handleFalWebhook } from "@infulancer/core/creative/fal";
import { ModelUnavailableError, resolveModel, seedModelRegistry } from "@infulancer/core/creative/registry";
import { getConfig, setConfig } from "@infulancer/core/config/store";
import { runMultiAgentSocialPipeline, runMultiAgentSocialPipelineAll } from "@infulancer/core/social/multi-agent-analytics";
import type { Aspect } from "@infulancer/core/creative/adapters";
import { submitGeneration } from "@infulancer/core/creative/generate";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, parseInput, revalidateAll, str } from "@/lib/action-utils";
import { assertPlatformAdmin, requireActor } from "@/lib/auth-guard";
import { ownTenant } from "@/lib/creative-tenant";
import { isAgencyTenant } from "@infulancer/core/creative/tenant";

/** Reklam: ad set bütçe değişikliği isteği — limit aşılırsa reddedilmez, sonraki saate ötelenir. */
export async function requestAdBudget(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const input = parseInput(z.object({ tenantId: z.string().min(1).max(64), adSetId: z.string().regex(/^\d{5,30}$/, { error: "Ad set ID yalnız rakamlardan oluşur." }), budget: z.number().positive().max(10_000_000) }), {
      tenantId: str(fd, "tenantId"),
      adSetId: str(fd, "adSetId"),
      budget: Number(str(fd, "budget").replace(",", ".")),
    });
    // Marketing API bağlantısı kurulana kadar uygulama adımı kayıt altına alınır (gerçek çağrı yok).
    const d = await requestBudgetChange({ tenantId: input.tenantId, adSetId: input.adSetId, newBudgetMinor: Math.round(input.budget * 100) });
    await audit.append({ actor: toAuditActor(actor), action: "AD_BUDGET_REQUESTED", entityType: "AdSet", entityId: input.adSetId, data: { budget: input.budget, status: d.status, scheduledFor: d.scheduledFor.toISOString() } });
    revalidateAll();
    return d.status === "applied"
      ? { ok: true, message: "Bütçe değişikliği uygulandı." }
      : { ok: true, message: `Limit nedeniyle ötelendi: ${d.scheduledFor.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}. ${d.reason ?? ""}` };
  });
}

const CREATIVE_STYLES = new Set(["Minimal", "Sinematik", "Pastel", "Neon", "Doğal ışık", "Stüdyo", "Retro", "Lüks"]);
const ASPECTS = new Set(["9:16", "1:1", "4:5", "16:9"]);
/**
 * Creative üretimi (tüm roller). Model gövdesi ve faturalanan birim sunucuda hesaplanır
 * (adapters.planGeneration): video süresi modele gider, ses birimi metinden sayılır,
 * oran (Story 9:16) modele parametre olarak verilir. Demo (mock) modunda sonuç simüle edilir.
 */
export async function generateCreative(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND", "INFLUENCER");
  return attempt(async () => {
    const input = parseInput(z.object({ modelKey: z.string().min(2).max(80), prompt: z.string().trim().min(3, { error: "İstek en az 3 karakter olmalı." }).max(4000) }), {
      modelKey: str(fd, "modelKey"),
      prompt: str(fd, "prompt"),
    });
    // Her işlem işlemi yapanın kendi hesabından düşer (marka / influencer / ajans).
    const tenantId = ownTenant(actor);
    if (actor.role !== "ADMIN") await ensureStarterCredits(tenantId);
    const model = await resolveModel(input.modelKey).catch((e) => {
      throw new DomainError("KURAL_IHLALI", (e as Error).message);
    });
    const aspectRaw = str(fd, "aspect");
    const aspect = (ASPECTS.has(aspectRaw) ? aspectRaw : "9:16") as Aspect;
    const style = str(fd, "style");
    const personalContext = str(fd, "personalContext").slice(0, 200);
    // Seslendirmede metin olduğu gibi okunur; görsel/videoda kişisel bağlam ve stil istemin sonuna eklenir.
    const storyHint = model.kind === "image" && aspect === "9:16" ? "Instagram Story düzeni: dikey 9:16, üst ve alt %15'te yazı ve arayüz için sade boş alan bırak" : "";
    const prompt = model.kind === "audio" ? input.prompt : [input.prompt, personalContext, CREATIVE_STYLES.has(style) ? `Stil: ${style}` : "", storyHint].filter(Boolean).join(". ");
    const refs = fd.getAll("refs").map(String).filter(Boolean).slice(0, 4);
    let jobId = "";
    try {
      const job = await submitGeneration({ tenantId, modelKey: model.key, prompt, aspect, seconds: Number(str(fd, "seconds") || "0") || undefined, referenceUploadIds: refs, portrait: str(fd, "portrait") === "on" });
      jobId = job.id;
      if ((process.env.FAL_MODE ?? "mock") === "mock" && job.requestId) {
        const isVideo = model.kind === "video";
        const payload = isVideo ? { video: { url: "https://example.invalid/mock.mp4" } } : model.kind === "audio" ? { audio: { url: "https://example.invalid/mock.mp3" } } : { images: [{ url: "https://example.invalid/mock.png" }] };
        await handleFalWebhook({ request_id: job.requestId, status: "OK", payload, metrics: { inference_time: 1.2 } });
      }
      await audit.append({ actor: toAuditActor(actor), action: "CREATIVE_SUBMITTED", entityType: "CreativeJob", entityId: job.id, data: { tenantId, modelKey: job.modelKey, units: Number(job.units), aspect, refs: refs.length } });
    } catch (e) {
      if (e instanceof CreativeRejectedError || e instanceof ModelUnavailableError || e instanceof InsufficientCreditsError) throw new DomainError("KURAL_IHLALI", e.message);
      throw e;
    }
    revalidateAll();
    return { ok: true, message: "Üretim başladı.", data: { jobId } };
  });
}

export async function topUpCredits(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const input = parseInput(z.object({ tenantId: z.string().min(1).max(64), credits: z.number().int().positive().max(1_000_000) }), { tenantId: str(fd, "tenantId"), credits: Number(str(fd, "credits")) });
    const [b, i] = await Promise.all([prisma.brand.findUnique({ where: { id: input.tenantId }, select: { id: true } }), prisma.influencer.findUnique({ where: { id: input.tenantId }, select: { id: true } })]);
    if (!b && !i && !isAgencyTenant(input.tenantId)) throw new DomainError("BULUNAMADI", "Hesap bulunamadı.");
    await topUp(input.tenantId, input.credits, "Yönetici yüklemesi");
    await audit.append({ actor: toAuditActor(actor), action: "CREDITS_TOPPED_UP", entityType: "CreditAccount", entityId: input.tenantId, data: { credits: input.credits } });
    revalidateAll();
    return { ok: true, message: `${input.credits.toLocaleString("tr-TR")} TL bakiye yüklendi.` };
  });
}

/** Yönetici: Yeni gelen kullanıcılara otomatik verilen hoş geldin kredisini (TL) günceller. */
export async function saveStarterCreditsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const input = parseInput(
      z.object({ starterCreditsTry: z.number().min(0, { error: "Tutar 0 veya daha büyük olmalı." }).max(1_000_000) }),
      { starterCreditsTry: Math.round(Number(str(fd, "starterCreditsTry").replace(",", "."))) },
      { starterCreditsTry: "Hoş geldin kredisi" },
    );
    await setConfig("creative.starterCreditsTry", input.starterCreditsTry, true);
    await audit.append({
      actor: toAuditActor(actor),
      action: "STARTER_CREDITS_UPDATED",
      entityType: "ConfigValue",
      entityId: "creative.starterCreditsTry",
      data: { starterCreditsTry: input.starterCreditsTry },
    });
    revalidateAll();
    return { ok: true, message: `Yeni kullanıcı hoş geldin kredisi ${input.starterCreditsTry.toLocaleString("tr-TR")} TL olarak kaydedildi.` };
  });
}

/** Yönetici: Tablodan herhangi bir hesabın kredisini artırır, azaltır veya doğrudan belirler. */
export async function manageCreditAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const input = parseInput(
      z.object({
        tenantId: z.string().min(1).max(64),
        mode: z.enum(["add", "deduct", "set"]),
        amount: z.number().min(0, { error: "Tutar negatif olamaz." }).max(10_000_000),
        note: z.string().trim().max(200).optional(),
      }),
      {
        tenantId: str(fd, "tenantId"),
        mode: str(fd, "mode"),
        amount: Number(str(fd, "amount").replace(",", ".")),
        note: optStr(fd, "note") ?? undefined,
      },
      { tenantId: "Hesap", mode: "İşlem", amount: "Tutar", note: "Not" },
    );
    if ((input.mode === "add" || input.mode === "deduct") && input.amount <= 0) {
      throw new DomainError("DOGRULAMA", "Ekleme veya düşme tutarı 0'dan büyük olmalı.");
    }
    const [b, i] = await Promise.all([
      prisma.brand.findUnique({ where: { id: input.tenantId }, select: { id: true } }),
      prisma.influencer.findUnique({ where: { id: input.tenantId }, select: { id: true } }),
    ]);
    if (!b && !i && !isAgencyTenant(input.tenantId)) throw new DomainError("BULUNAMADI", "Hesap bulunamadı.");

    try {
      if (input.mode === "add") {
        await adjustCredits(input.tenantId, input.amount, input.note);
      } else if (input.mode === "deduct") {
        await adjustCredits(input.tenantId, -input.amount, input.note);
      } else {
        await setCreditBalance(input.tenantId, input.amount, input.note);
      }
    } catch (e) {
      if (e instanceof InsufficientCreditsError) throw new DomainError("KURAL_IHLALI", e.message);
      throw e;
    }

    await audit.append({
      actor: toAuditActor(actor),
      action: "CREDITS_MANAGED",
      entityType: "CreditAccount",
      entityId: input.tenantId,
      data: { mode: input.mode, amount: input.amount, note: input.note ?? null },
    });
    revalidateAll();
    const msg =
      input.mode === "add"
        ? `${input.amount.toLocaleString("tr-TR")} kredi eklendi.`
        : input.mode === "deduct"
          ? `${input.amount.toLocaleString("tr-TR")} kredi düşüldü.`
          : `Bakiye ${input.amount.toLocaleString("tr-TR")} olarak güncellendi.`;
    return { ok: true, message: msg };
  });
}

/** Yönetici: Belirli bir influencer için 4 ajanlı Meta Graph API analizini ve telemetriyi şimdi çalıştırır. */
export async function runMultiAgentScanAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const influencerId = str(fd, "influencerId");
    const report = await runMultiAgentSocialPipeline(influencerId, { mode: "DAILY_WORKER" });
    if (!report) throw new DomainError("BULUNAMADI", "Influencer bulunamadı.");
    await audit.append({
      actor: toAuditActor(actor),
      action: "MULTI_AGENT_SCAN_RUN",
      entityType: "Influencer",
      entityId: influencerId,
      data: {
        apiConnected: report.ingestion.apiConnected,
        errors: report.telemetry.admin_telemetry.errors.map((e) => e.error_code),
      },
    });
    revalidateAll();
    return {
      ok: true,
      message: report.ingestion.apiConnected
        ? `@${report.handle} için 4 ajanlı analiz ve telemetri güncellendi.`
        : `@${report.handle} taraması tamamlandı (Meta API durumu: ${report.ingestion.apiMessage}).`,
    };
  });
}

/** Yönetici: Tüm aktif influencer'lar için 4 ajanlı Meta Graph API analizini toplu çalıştırır. */
export async function runAllMultiAgentScansAction(_p: ActionState): Promise<ActionState> {
  void _p;
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const r = await runMultiAgentSocialPipelineAll(50);
    await audit.append({
      actor: toAuditActor(actor),
      action: "MULTI_AGENT_SCAN_ALL",
      entityType: "AgentJobRun",
      entityId: "social-multi-agent",
      data: r,
    });
    revalidateAll();
    return {
      ok: true,
      message: `${r.processed} influencer tarandı (${r.withData} hesapta gerçek veri bulundu).`,
    };
  });
}

/** Yönetici: Creative fiyatlandırma ayarı (markup, en düşük ücret, kur) ve tüm model fiyatlarını yeniden hesapla. */
export async function savePricingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  assertPlatformAdmin(actor);
  return attempt(async () => {
    const input = parseInput(
      z.object({ markup: z.number().min(1, { error: "Markup en az 1 olmalı (maliyetin altında satılmaz)." }).max(20), minTry: z.number().min(0).max(1000), usdTry: z.number().min(1).max(1000), autoFx: z.boolean() }),
      { markup: Number(str(fd, "markup").replace(",", ".")), minTry: Number(str(fd, "minTry").replace(",", ".")), usdTry: Number(str(fd, "usdTry").replace(",", ".")), autoFx: str(fd, "autoFx") === "on" },
    );
    const cur = await getConfig("pricing.creative");
    await setConfig("pricing.creative", { ...cur, ...input, fxUpdatedAt: input.usdTry !== cur.usdTry ? new Date().toISOString() : cur.fxUpdatedAt }, true);
    await seedModelRegistry();
    await audit.append({ actor: toAuditActor(actor), action: "CREATIVE_PRICING_SAVED", entityType: "ConfigValue", entityId: "pricing.creative", data: input });
    revalidateAll();
    return { ok: true, message: "Fiyatlandırma kaydedildi; tüm model fiyatları yeniden hesaplandı." };
  });
}
