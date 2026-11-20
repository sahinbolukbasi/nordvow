"use server";
import { z } from "zod";
import { prisma } from "@infulancer/core/db";
import { audit } from "@infulancer/core/audit";
import { toAuditActor } from "@infulancer/core/access/actor";
import { activateAgent, AGENT_TEMPLATES, type AgentKey } from "@infulancer/core/assistant/catalog";
import { invokeAgentCore, isAgentCoreEnabled } from "@infulancer/core/assistant/agentcore";
import { AUDIT_AGENTS, setJobEnabled } from "@infulancer/core/agents/catalog";
import { runJob } from "@infulancer/core/agents/runner";
import { getLlm } from "@infulancer/core/llm/index";
import { inspectInstagramHandle, syncInfluencer } from "@infulancer/core/social/sync";
import {
  runInstagramExplorerForAll,
  runInstagramExplorerForInfluencer,
} from "@infulancer/core/social/explorer";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ActionState } from "@/lib/action-state";
import { attempt, bool, parseInput, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";

/** Denetim agent'ını aç/kapa (yasal zorunlu olanlar kapatılamaz). */
export async function toggleAuditAgent(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const job = str(fd, "job");
    const enabled = str(fd, "enabled") === "true";
    if (!AUDIT_AGENTS.some((a) => a.job === job)) throw new DomainError("BULUNAMADI", "Agent bulunamadı.");
    try {
      await setJobEnabled(job, enabled);
    } catch (e) {
      throw new DomainError("KURAL_IHLALI", (e as Error).message);
    }
    await audit.append({ actor: toAuditActor(actor), action: "AUDIT_AGENT_TOGGLED", entityType: "AgentJob", entityId: job, data: { enabled } });
    revalidateAll();
    return { ok: true, message: enabled ? "Agent açıldı." : "Agent kapatıldı; zamanlanmış çalıştırmalar atlanacak." };
  });
}

export async function runAuditAgentNow(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const job = str(fd, "job");
    if (!AUDIT_AGENTS.some((a) => a.job === job)) throw new DomainError("BULUNAMADI", "Agent bulunamadı.");
    const r = await runJob(job, "manual");
    revalidateAll();
    return { ok: true, message: `Çalıştı: ${r.created} yeni kayıt, ${r.skipped} atlandı.` };
  });
}

const assistantSchema = z.object({
  agentId: z.enum(AGENT_TEMPLATES.map((t) => t.key) as [AgentKey, ...AgentKey[]]),
  enabled: z.boolean(),
  confidencePct: z.number().int().min(30, { error: "Güven eşiği en az %30." }).max(95, { error: "Güven eşiği en fazla %95." }),
  maxTurns: z.number().int().min(1).max(20),
  keywords: z.array(z.string().min(2).max(40)).min(1, { error: "En az bir 'insana aktar' anahtar kelimesi gerekli." }).max(30),
  outOfHours: z.enum(["queue", "auto_reply_then_queue"]),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
  systemPrompt: z.string().min(20, { error: "Talimat en az 20 karakter." }).max(4000),
});

/** Sohbet asistanı ayarları. Marka yalnız kendi asistanını, admin her markanınkini düzenler. */
export async function saveAssistant(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const tenantId = actor.role === "BRAND" ? actor.brandId! : str(fd, "tenantId");
    if (!(await prisma.brand.findUnique({ where: { id: tenantId }, select: { id: true } }))) throw new DomainError("BULUNAMADI", "Marka bulunamadı.");
    const input = parseInput(assistantSchema, {
      agentId: str(fd, "agentId"),
      enabled: bool(fd, "enabled"),
      confidencePct: Number(str(fd, "confidencePct")),
      maxTurns: Number(str(fd, "maxTurns")),
      keywords: str(fd, "keywords").split(",").map((k) => k.trim().toLocaleLowerCase("tr")).filter(Boolean),
      outOfHours: str(fd, "outOfHours"),
      days: fd.getAll("days").map(Number),
      start: str(fd, "start") || "09:00",
      end: str(fd, "end") || "18:00",
      systemPrompt: str(fd, "systemPrompt"),
    });
    if (input.start >= input.end) throw new DomainError("DOGRULAMA", "Mesai bitişi başlangıçtan sonra olmalı.");
    await activateAgent(tenantId, input.agentId);
    await prisma.agentConfig.update({
      where: { tenantId_agentId: { tenantId, agentId: input.agentId } },
      data: {
        enabled: input.enabled,
        confidenceThreshold: input.confidencePct / 100,
        maxTurnsBeforeHandoff: input.maxTurns,
        handoffKeywords: [...new Set(input.keywords)],
        outOfHoursBehavior: input.outOfHours,
        businessHours: { days: input.days, start: input.start, end: input.end, tz: "Europe/Istanbul" },
        systemPrompt: input.systemPrompt,
      },
    });
    await audit.append({ actor: toAuditActor(actor), action: "ASSISTANT_UPDATED", entityType: "AgentConfig", entityId: `${tenantId}:${input.agentId}`, data: { ...input, systemPrompt: undefined } });
    revalidateAll();
    return { ok: true, message: input.enabled ? "Asistan ayarları kaydedildi." : "Asistan kapatıldı; gelen mesajlar doğrudan temsilci kuyruğuna düşer." };
  });
}

export type CustomAgentSpec = {
  id: string;
  name: string;
  campaignId: string | null;
  goal: string;
  instructions: string;
  channel: "INSTAGRAM";
  createdAt: string;
  lastRunAt?: string | null;
  lastSummary?: string | null;
  lastEngine?: string | null;
};

async function readCustomAgents(): Promise<CustomAgentSpec[]> {
  const row = await prisma.configValue.findUnique({ where: { key: "custom.agents" }, select: { value: true } });
  return Array.isArray(row?.value) ? (row.value as CustomAgentSpec[]) : [];
}

async function writeCustomAgents(list: CustomAgentSpec[]) {
  await prisma.configValue.upsert({
    where: { key: "custom.agents" },
    create: { key: "custom.agents", value: list as never, note: "Özel AWS AgentCore ajanları" },
    update: { value: list as never },
  });
}

/** AWS AgentCore ile çalışacak özel kampanya / Instagram ajanı oluşturur. */
export async function createCustomAgentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const name = str(fd, "name");
    const goal = str(fd, "goal");
    const instructions = str(fd, "instructions");
    const campaignId = str(fd, "campaignId") || null;
    if (name.length < 3) throw new DomainError("DOGRULAMA", "Agent adı en az 3 karakter olmalı.");
    if (instructions.length < 15) throw new DomainError("DOGRULAMA", "Talimat en az 15 karakter olmalı.");
    const list = await readCustomAgents();
    const agent: CustomAgentSpec = {
      id: `ag_${Date.now().toString(36)}`,
      name: name.slice(0, 80),
      campaignId,
      goal: (goal || "Instagram kampanya analizi").slice(0, 140),
      instructions: instructions.slice(0, 3000),
      channel: "INSTAGRAM",
      createdAt: new Date().toISOString(),
    };
    await writeCustomAgents([agent, ...list].slice(0, 50));
    await audit.append({ actor: toAuditActor(actor), action: "CUSTOM_AGENT_CREATED", entityType: "AgentJob", entityId: agent.id, data: { name: agent.name, campaignId } });
    revalidateAll();
    return { ok: true, message: `"${agent.name}" özel ajanı oluşturuldu (AWS AgentCore hazır).` };
  });
}

export async function deleteCustomAgentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    const list = await readCustomAgents();
    await writeCustomAgents(list.filter((a) => a.id !== id));
    revalidateAll();
    return { ok: true, message: "Özel agent silindi." };
  });
}

/** Özel ajanı seçili kampanyanın canlı Instagram ve teslim verileriyle AWS AgentCore üzerinden çalıştırır. */
export async function runCustomAgentAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const id = str(fd, "id");
    const campaignIdOverride = str(fd, "campaignId") || null;
    const list = await readCustomAgents();
    const agent = list.find((a) => a.id === id);
    if (!agent) throw new DomainError("BULUNAMADI", "Agent bulunamadı.");

    const cid = campaignIdOverride ?? agent.campaignId;
    const campaign = cid
      ? await prisma.campaign.findUnique({
          where: { id: cid },
          include: {
            brand: { select: { name: true } },
            assignments: {
              include: {
                influencer: {
                  select: {
                    name: true,
                    socialAccounts: { where: { platform: "INSTAGRAM" }, select: { handle: true, followers: true, engagementRate: true, avgLikes: true, avgComments: true } },
                  },
                },
                deliverables: { select: { platform: true, contentType: true, status: true } },
              },
            },
          },
        })
      : null;

    const contextLines = campaign
      ? [
          `Kampanya: ${campaign.name} (${campaign.brand.name}) · Durum: ${campaign.status}`,
          `Influencerlar (${campaign.assignments.length}):`,
          ...campaign.assignments.map((a) => {
            const ig = a.influencer.socialAccounts[0];
            return `- ${a.influencer.name}: ${ig ? `@${ig.handle} (${ig.followers} takipçi, ER ${(Number(ig.engagementRate) * 100).toFixed(2)}%, ort. ${ig.avgLikes ?? 0} beğeni)` : "Instagram yok"} · ${a.deliverables.length} teslim`;
          }),
        ].join("\n")
      : "Genel platform Instagram analizi";

    let summary = "";
    let engine = "Bedrock Converse";
    if (isAgentCoreEnabled()) {
      try {
        const res = await invokeAgentCore({
          sessionId: `agent-${agent.id}-${cid ?? "global"}`,
          systemPrompt: agent.instructions,
          prompt: `Görev: ${agent.goal}\n\nVeriler:\n${contextLines}`,
          metadata: { agentId: agent.id, campaignId: cid, channel: "INSTAGRAM" },
        });
        if (res?.text) {
          summary = res.text;
          engine = "AWS AgentCore";
        }
      } catch (e) {
        console.warn("[runCustomAgent] AgentCore fallback:", (e as Error).message);
      }
    }
    if (!summary) {
      const llm = await getLlm().completeText({
        system: agent.instructions,
        promptVersion: `custom-agent-${agent.id}@1`,
        prompt: `Görev: ${agent.goal}\n\nToplanan Veriler:\n${contextLines}\n\nKısa, net Türkçe analiz ve aksiyon önerisi yaz.`,
      });
      summary = llm.text;
    }

    const nowIso = new Date().toISOString();
    await writeCustomAgents(list.map((x) => (x.id === id ? { ...x, lastRunAt: nowIso, lastSummary: summary.slice(0, 1200), lastEngine: engine } : x)));
    revalidateAll();
    return { ok: true, message: `${engine} ile çalıştırıldı.` };
  });
}

/** Seçili kampanyadaki tüm influencer'ların yalnızca Instagram verilerini Nordvow Meta token'larıyla tarar. */
export async function syncCampaignInstagramAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const campaignId = str(fd, "campaignId");
    const assigns = await prisma.assignment.findMany({ where: { campaignId }, select: { influencerId: true } });
    const ids = [...new Set(assigns.map((a) => a.influencerId))];
    let ok = 0;
    let total = 0;
    for (const id of ids) {
      const res = await syncInfluencer(id, "INSTAGRAM", { force: true });
      for (const r of res) {
        total++;
        if (r.ok) ok++;
      }
    }
    revalidateAll();
    return { ok: true, message: `Instagram taraması tamamlandı: ${ok}/${total} hesap güncellendi.` };
  });
}

/** Nordvow Instagram hesabıyla tekil bir Instagram hesabını anlık inceler (yalnız Instagram). */
export async function inspectInstagramAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  await requireActor("ADMIN");
  return attempt(async () => {
    const rawHandle = str(fd, "handle").trim().replace(/^@/, "");
    // Sistemde kayıtlı bir influencer ise tam hibrit Instagram Gezgini raporunu da çalıştır
    const matchedAcc = await prisma.socialAccount.findFirst({
      where: { platform: "INSTAGRAM", handle: { equals: rawHandle, mode: "insensitive" } },
      select: { influencerId: true },
    });

    if (matchedAcc) {
      const report = await runInstagramExplorerForInfluencer(matchedAcc.influencerId, {
        forceRefresh: true,
        triggeredBy: "admin",
      });
      if (report) {
        revalidateAll();
        return {
          ok: true,
          message: `@${report.handle}: ${report.followers.toLocaleString("tr-TR")} takipçi`,
          data: {
            handle: report.handle,
            influencerId: report.influencerId,
            followers: report.followers.toLocaleString("tr-TR"),
            postsCount: String(report.organicVsSponsored.organicCount + report.organicVsSponsored.sponsoredCount),
            avgViews: report.avgReelsViews != null ? report.avgReelsViews.toLocaleString("tr-TR") : "—",
            avgLikes: report.avgLikes != null ? report.avgLikes.toLocaleString("tr-TR") : "—",
            avgComments: report.avgComments != null ? report.avgComments.toLocaleString("tr-TR") : "—",
            avgSaves: "—",
            er: report.avgErPct != null ? `%${report.avgErPct.toFixed(2)}` : "—",
            score: report.scores.known && report.scores.overallScore != null ? `${report.scores.overallScore}/100 (${report.scores.priorityTier})` : "—",
            collabs: report.brandCollaborations.map((b) => b.brandName).join(", "),
            summary: report.aiExecutiveSummary,
          },
        };
      }
    }

    const data = await inspectInstagramHandle(rawHandle);
    return {
      ok: true,
      message: `@${data.handle}: ${data.followers.toLocaleString("tr-TR")} takipçi · ${data.postsCount ?? 0} gönderi`,
      data: {
        handle: data.handle,
        influencerId: "",
        followers: data.followers.toLocaleString("tr-TR"),
        postsCount: data.postsCount != null ? String(data.postsCount) : "—",
        avgViews: data.avgViews != null ? data.avgViews.toLocaleString("tr-TR") : "—",
        avgLikes: data.avgLikes != null ? data.avgLikes.toLocaleString("tr-TR") : "—",
        avgComments: data.avgComments != null ? data.avgComments.toLocaleString("tr-TR") : "—",
        avgSaves: "—",
        er: data.engagementRate != null ? `%${(data.engagementRate * 100).toFixed(2)}` : "—",
        score: "—",
        collabs: "—",
        summary: `@${data.handle} Business Discovery ile okundu. İzlenme ve kaydetme bu çağrıda yok; uydurulmadı.`,
      },
    };
  });
}

/** Tek bir influencer profilinde "Canlı Verileri Şimdi Güncelle (Bot/API Tetikle)" aksiyonu. */
export async function triggerInfluencerExplorerAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const influencerId = str(fd, "influencerId");
    const report = await runInstagramExplorerForInfluencer(influencerId, {
      forceRefresh: true,
      triggeredBy: actor.role === "ADMIN" ? "admin" : "brand",
    });
    if (!report) throw new DomainError("BULUNAMADI", "Influencer bulunamadı.");
    await audit.append({
      actor: toAuditActor(actor),
      action: "INSTAGRAM_EXPLORER_SCANNED",
      entityType: "Influencer",
      entityId: influencerId,
      data: {
        handle: report.handle,
        verificationStatus: report.verificationStatus,
        overallScore: report.scores.overallScore,
      },
    });
    revalidateAll();
    return {
      ok: true,
      message: `Tarama tamamlandı (@${report.handle}). Yalnız resmî kayıttaki takipçi ve beğeni kullanıldı.`,
    };
  });
}

/** Tüm kayıtlı influencer'lar için Instagram Gezgini toplu taramasını başlatır. */
export async function runBulkInstagramExplorerAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  const actor = await requireActor("ADMIN");
  return attempt(async () => {
    const res = await runInstagramExplorerForAll(30);
    await audit.append({
      actor: toAuditActor(actor),
      action: "INSTAGRAM_EXPLORER_BULK_SCANNED",
      entityType: "AgentJob",
      entityId: "instagram-explorer",
      data: res,
    });
    revalidateAll();
    return {
      ok: true,
      message: `Instagram Gezgini toplu taraması tamamlandı: ${res.scanned} influencer profili, marka geçmişi ve zaman serisi güncellendi.`,
    };
  });
}
