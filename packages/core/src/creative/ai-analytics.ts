import { prisma } from "../db";

export type ProviderStat = {
  provider: string;
  requests: number;
  tokens: number;
  costUsd: number;
};

export type ModelUsageStat = {
  modelKey: string;
  provider: string;
  requests: number;
  completed: number;
  failed: number;
  costUsd: number;
};

export type DailyAiPoint = {
  day: string;
  requests: number;
  costUsd: number;
};

export type AdminAiAnalytics = {
  totalRequests: number;
  totalTokens: number;
  totalCreditsSpentTry: number;
  totalCostUsd: number;
  byProvider: ProviderStat[];
  byModel: ModelUsageStat[];
  daily: DailyAiPoint[];
};

export async function getAdminAiAnalytics(): Promise<AdminAiAnalytics> {
  const since = new Date(Date.now() - 14 * 86_400_000);
  const [models, creativeJobs, videoJobs, llmLogs, charges, refunds] = await Promise.all([
    prisma.modelRegistry.findMany({ select: { key: true, provider: true, unitPriceUsd: true } }),
    prisma.creativeJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 1000,
      select: { modelKey: true, status: true, units: true, actualCostUsd: true, createdAt: true },
    }),
    prisma.videoPipelineJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: { modelKey: true, status: true, costUsd: true, createdAt: true },
    }),
    prisma.aiUsageLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000,
      select: { provider: true, modelId: true, inputTokens: true, outputTokens: true, costUsd: true, createdAt: true },
    }),
    prisma.creditLedger.aggregate({ where: { kind: "CHARGE" }, _sum: { amount: true } }),
    prisma.creditLedger.aggregate({ where: { kind: "REFUND" }, _sum: { amount: true } }),
  ]);

  const modelMeta = new Map(models.map((m) => [m.key, m]));
  const providerMap = new Map<string, ProviderStat>();
  const modelMap = new Map<string, ModelUsageStat>();
  const dailyMap = new Map<string, DailyAiPoint>();

  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    dailyMap.set(d, { day: d, requests: 0, costUsd: 0 });
  }

  const addProvider = (provider: string, reqs: number, tokens: number, costUsd: number) => {
    const cur = providerMap.get(provider) ?? { provider, requests: 0, tokens: 0, costUsd: 0 };
    cur.requests += reqs;
    cur.tokens += tokens;
    cur.costUsd += costUsd;
    providerMap.set(provider, cur);
  };

  const addDaily = (at: Date, costUsd: number) => {
    if (at < since) return;
    const d = at.toISOString().slice(0, 10);
    const cur = dailyMap.get(d);
    if (cur) {
      cur.requests += 1;
      cur.costUsd += costUsd;
    }
  };

  for (const j of creativeJobs) {
    const m = modelMeta.get(j.modelKey);
    const provider = m?.provider ?? "fal";
    const cost = j.status === "COMPLETED" ? Number(j.actualCostUsd ?? Number(m?.unitPriceUsd ?? 0) * Number(j.units)) : 0;
    addProvider(provider, 1, 0, cost);
    addDaily(j.createdAt, cost);

    const ms = modelMap.get(j.modelKey) ?? { modelKey: j.modelKey, provider, requests: 0, completed: 0, failed: 0, costUsd: 0 };
    ms.requests += 1;
    if (j.status === "COMPLETED") ms.completed += 1;
    if (j.status === "FAILED" || j.status === "REJECTED") ms.failed += 1;
    ms.costUsd += cost;
    modelMap.set(j.modelKey, ms);
  }

  for (const v of videoJobs) {
    const cost = Number(v.costUsd ?? 0);
    addProvider("video-pipeline", 1, 0, cost);
    addDaily(v.createdAt, cost);
  }

  let totalTokens = 0;
  for (const l of llmLogs) {
    const tok = l.inputTokens + l.outputTokens;
    const cost = Number(l.costUsd ?? 0);
    totalTokens += tok;
    addProvider(l.provider, 1, tok, cost);
    addDaily(l.createdAt, cost);
  }

  const byProvider = [...providerMap.values()].sort((a, b) => b.costUsd - a.costUsd || b.requests - a.requests);
  const byModel = [...modelMap.values()].sort((a, b) => b.requests - a.requests).slice(0, 12);
  const totalRequests = byProvider.reduce((s, p) => s + p.requests, 0);
  const totalCostUsd = byProvider.reduce((s, p) => s + p.costUsd, 0);
  const chargedAbs = Math.abs(Number(charges._sum.amount ?? 0));
  const refundedAbs = Math.abs(Number(refunds._sum.amount ?? 0));
  const totalCreditsSpentTry = Math.max(0, chargedAbs - refundedAbs);

  return {
    totalRequests,
    totalTokens,
    totalCreditsSpentTry,
    totalCostUsd,
    byProvider,
    byModel,
    daily: [...dailyMap.values()],
  };
}

