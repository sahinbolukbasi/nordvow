import { prisma } from "@infulancer/core/db";
import { AGENT_TEMPLATES } from "@infulancer/core/assistant/catalog";
import { listUnansweredQuestions, type UnansweredQuestionEntry } from "@infulancer/core/assistant/runtime";
import type { AssistantValues } from "@/components/agent/agent-forms";

const DEFAULT_KEYWORDS = ["insan", "temsilci", "müşteri hizmetleri", "yetkili", "şikayet"];

export interface AssistantAnalytics {
  activeCount: number;
  configuredCount: number;
  totalConversations30d: number;
  selfResolvedCount30d: number;
  selfResolvedRatePct: number | null;
  handoffCount30d: number;
  handoffRatePct: number | null;
  topHandoffReasons: { reason: string; count: number }[];
  unansweredQuestions: UnansweredQuestionEntry[];
  avgFirstResponseSec: number | null;
  monthlyCostUsd: number;
  monthlyBudgetUsd: number;
}

/** Bir markanın tüm katalog asistanları (yapılandırılmamış olanlar varsayılan değerle). */
export async function assistantsFor(tenantId: string, since = new Date(Date.now() - 30 * 86_400_000)) {
  const [configs, convs, handoffs] = await Promise.all([
    prisma.agentConfig.findMany({ where: { tenantId } }),
    prisma.conversation.groupBy({ by: ["agentKey"], where: { tenantId, agentTurns: { gt: 0 }, createdAt: { gte: since } }, _count: true }),
    prisma.conversation.groupBy({ by: ["agentKey", "handoffReason"], where: { tenantId, status: { in: ["awaiting_human", "assigned", "closed"] }, handoffReason: { not: null }, createdAt: { gte: since } }, _count: true }),
  ]);
  return AGENT_TEMPLATES.map((t) => {
    const c = configs.find((x) => x.agentId === t.key);
    const bh = (c?.businessHours ?? {}) as { days?: number[]; start?: string; end?: string };
    const key = t.key === "brand_faq" ? null : t.key;
    const handled = convs.filter((x) => x.agentKey === t.key || (t.key === "brand_faq" && x.agentKey == null)).reduce((s, x) => s + x._count, 0);
    const reasons = handoffs.filter((x) => x.agentKey === key || x.agentKey === t.key);
    const values: AssistantValues = {
      agentId: t.key,
      name: t.name,
      enabled: c?.enabled ?? false,
      confidencePct: Math.round(Number(c?.confidenceThreshold ?? 0.7) * 100),
      maxTurns: c?.maxTurnsBeforeHandoff ?? 4,
      keywords: c?.handoffKeywords?.length ? c.handoffKeywords : DEFAULT_KEYWORDS,
      outOfHours: c?.outOfHoursBehavior ?? "queue",
      days: bh.days ?? [1, 2, 3, 4, 5],
      start: bh.start ?? "09:00",
      end: bh.end ?? "18:00",
      systemPrompt: c?.systemPrompt ?? t.systemPrompt,
    };
    return { template: t, configured: !!c, values, handled, handoffs: reasons.map((r) => ({ reason: r.handoffReason!, count: r._count })) };
  });
}

/**
 * Tek kaynaklı 30 günlük asistan analitiği (yalnızca seçili marka).
 * Aktif sayısı = bu markada kurulmuş VE açık (enabled === true) asistanlar.
 */
export async function assistantAnalyticsFor(tenantId: string, since = new Date(Date.now() - 30 * 86_400_000)): Promise<AssistantAnalytics> {
  const [configs, totalConvs, handoffConvs, handoffGroups, unansweredQuestions, costAgg, recentConvs] = await Promise.all([
    prisma.agentConfig.findMany({ where: { tenantId }, select: { enabled: true } }),
    prisma.conversation.count({ where: { tenantId, createdAt: { gte: since } } }),
    prisma.conversation.count({ where: { tenantId, handoffReason: { not: null }, createdAt: { gte: since } } }),
    prisma.conversation.groupBy({
      by: ["handoffReason"],
      where: { tenantId, handoffReason: { not: null }, createdAt: { gte: since } },
      _count: true,
    }),
    listUnansweredQuestions(tenantId, 10),
    prisma.aiUsageLog.aggregate({
      where: { tenantId, createdAt: { gte: since } },
      _sum: { costUsd: true },
    }),
    prisma.conversation.findMany({
      where: { tenantId, createdAt: { gte: since } },
      take: 50,
      orderBy: { createdAt: "desc" },
      select: {
        messages: {
          orderBy: { createdAt: "asc" },
          take: 4,
          select: { direction: true, createdAt: true },
        },
      },
    }),
  ]);

  const activeCount = configs.filter((c) => c.enabled).length;
  const configuredCount = configs.length;
  const selfResolvedCount30d = Math.max(0, totalConvs - handoffConvs);
  const selfResolvedRatePct = totalConvs > 0 ? Math.round((selfResolvedCount30d / totalConvs) * 100) : null;
  const handoffRatePct = totalConvs > 0 ? Math.round((handoffConvs / totalConvs) * 100) : null;

  const topHandoffReasons = handoffGroups
    .filter((g) => g.handoffReason)
    .map((g) => ({ reason: g.handoffReason!, count: g._count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const responseDeltas: number[] = [];
  for (const conv of recentConvs) {
    const firstIn = conv.messages.find((m) => m.direction === "INBOUND");
    if (!firstIn) continue;
    const firstOut = conv.messages.find((m) => m.direction === "OUTBOUND" && m.createdAt >= firstIn.createdAt);
    if (!firstOut) continue;
    const diffSec = (firstOut.createdAt.getTime() - firstIn.createdAt.getTime()) / 1000;
    if (diffSec >= 0 && diffSec < 86_400) responseDeltas.push(diffSec);
  }
  const avgFirstResponseSec =
    responseDeltas.length > 0 ? Math.round(responseDeltas.reduce((a, b) => a + b, 0) / responseDeltas.length) : null;

  return {
    activeCount,
    configuredCount,
    totalConversations30d: totalConvs,
    selfResolvedCount30d,
    selfResolvedRatePct,
    handoffCount30d: handoffConvs,
    handoffRatePct,
    topHandoffReasons,
    unansweredQuestions,
    avgFirstResponseSec,
    monthlyCostUsd: Number((costAgg._sum.costUsd ?? 0).toFixed(4)),
    monthlyBudgetUsd: 50,
  };
}
