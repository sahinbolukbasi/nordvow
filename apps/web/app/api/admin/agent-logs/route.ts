import { NextResponse } from "next/server";
import { prisma } from "@infulancer/core/db";
import { scheduledJobs } from "@infulancer/core/agents/registry";
import type { MultiAgentDailyReport } from "@infulancer/core/social/multi-agent-analytics";
import { requireApiActor } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiActor("ADMIN");
  if (auth.response) return auth.response;

  const [reportRows, jobRuns, agentRuns, influencers] = await Promise.all([
    prisma.configValue.findMany({
      where: { key: { startsWith: "social.multi_agent_report." } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    }),
    prisma.agentJobRun.findMany({
      orderBy: { startedAt: "desc" },
      take: 30,
    }),
    prisma.agentRun.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        checkType: true,
        targetType: true,
        targetId: true,
        severity: true,
        status: true,
        summary: true,
        model: true,
        createdAt: true,
      },
    }),
    prisma.influencer.findMany({
      select: { id: true, name: true },
      take: 200,
    }),
  ]);

  const infName = new Map(influencers.map((i) => [i.id, i.name]));
  const reports = reportRows
    .map((r) => {
      const val = r.value as Partial<MultiAgentDailyReport> | null;
      if (!val?.telemetry) return null;
      return {
        influencerId: val.influencerId ?? r.key.replace("social.multi_agent_report.", ""),
        influencerName: infName.get(val.influencerId ?? "") ?? val.handle ?? "Influencer",
        handle: val.handle ?? "",
        mode: val.mode ?? "DAILY_WORKER",
        generatedAt: val.generatedAt ?? r.updatedAt.toISOString(),
        telemetry: val.telemetry,
      };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);

  return NextResponse.json({
    now: new Date().toISOString(),
    scheduledJobs: scheduledJobs.map((j) => ({ name: j.name, schedule: j.schedule })),
    reports,
    jobRuns: jobRuns.map((j) => ({
      id: j.id,
      job: j.job,
      trigger: j.trigger,
      startedAt: j.startedAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? null,
      created: j.created,
      skipped: j.skipped,
      ok: j.ok,
      error: j.error,
    })),
    agentRuns: agentRuns.map((a) => ({
      id: a.id,
      checkType: a.checkType,
      targetType: a.targetType,
      targetId: a.targetId,
      severity: a.severity,
      status: a.status,
      summary: a.summary,
      model: a.model,
      createdAt: a.createdAt.toISOString(),
    })),
  });
}
