"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { StandardizedTelemetryJson } from "@infulancer/core/social/multi-agent-analytics";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Pill, type PillTone } from "@/components/luma/primitives";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/form";
import { runAllMultiAgentScansAction } from "@/lib/actions/operations";
import { fmtDateTime } from "@/lib/time";

type ReportRow = {
  influencerId: string;
  influencerName: string;
  handle: string;
  mode: string;
  generatedAt: string;
  telemetry: StandardizedTelemetryJson;
};

type JobRunRow = {
  id: string;
  job: string;
  trigger: string;
  startedAt: string;
  finishedAt: string | null;
  created: number;
  skipped: number;
  ok: boolean;
  error: string | null;
};

type AgentRunRow = {
  id: string;
  checkType: string;
  targetType: string;
  targetId: string;
  severity: string;
  status: string;
  summary: string;
  model: string;
  createdAt: string;
};

type LogsPayload = {
  now: string;
  scheduledJobs: { name: string; schedule: string }[];
  reports: ReportRow[];
  jobRuns: JobRunRow[];
  agentRuns: AgentRunRow[];
};

const AGENT_NAMES = [
  { key: "DataIngestionWorker", label: "Veri Çekme (DataIngestionWorker)" },
  { key: "ContentReelsAgent", label: "İçerik & Reels (ContentReelsAgent)" },
  { key: "SentimentNLPAgent", label: "Yorum & Duygu (SentimentNLPAgent)" },
  { key: "BotDetectorAgent", label: "Bot & Kitle (BotDetectorAgent)" },
] as const;

const SYNC_TONE: Record<"ACTIVE" | "PAUSED" | "TOKEN_EXPIRED" | "ERROR", PillTone> = {
  ACTIVE: "green",
  PAUSED: "gray",
  TOKEN_EXPIRED: "amber",
  ERROR: "red",
};

export function LiveAgentMonitor() {
  const tt = useTT();
  const [data, setData] = useState<LogsPayload | null>(null);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async (withSpinner = false) => {
    if (withSpinner) setLoading(true);
    try {
      const res = await fetch("/api/admin/agent-logs", { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as LogsPayload;
        setData(json);
      }
    } finally {
      if (withSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/agent-logs", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<LogsPayload>) : null))
      .then((json) => {
        if (active && json) setData(json);
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      void fetchLogs(false);
    }, 5000);
    return () => clearInterval(id);
  }, [live, fetchLogs]);

  const reports = data?.reports ?? [];
  const jobRuns = data?.jobRuns ?? [];
  const agentRuns = data?.agentRuns ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* Üst Kontrol Çubuğu */}
      <Card interactive={false} className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${live ? "bg-emerald-500 animate-pulse" : "bg-fg-passive"}`} />
            <CardTitle>{tt("Canlı Ajan Orkestratörü & Anlık Loglar")}</CardTitle>
          </div>
          <p className="text-[13px] text-fg-muted">
            {tt("4 uzman ajanın çalışma durumu, zamanlanmış görevler ve anlık hata/log akışı (5 sn otomatik yenileme).")}
            {data?.now ? ` · ${tt("Son kontrol:")} ${fmtDateTime(new Date(data.now))}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant={live ? "primary" : "secondary"} onClick={() => setLive((v) => !v)}>
            {live ? tt("Canlı İzleme: Açık") : tt("Canlı İzleme: Durduruldu")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => void fetchLogs(true)} disabled={loading}>
            {loading ? tt("Yenileniyor…") : tt("Şimdi Yenile")}
          </Button>
          <ActionForm
            action={runAllMultiAgentScansAction}
            submitLabel={tt("Tüm Influencerları Tara")}
            submitSize="sm"
            onSuccess={() => void fetchLogs()}
            className="!flex-row items-center"
          />
        </div>
      </Card>

      {/* 4 Uzman Ajanın Anlık Özeti */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {AGENT_NAMES.map((ag) => {
          const entries = reports.flatMap((r) => r.telemetry.admin_telemetry.agents_executed.filter((a) => a.agent === ag.key));
          const okCount = entries.filter((e) => e.status === "SUCCESS").length;
          const failCount = entries.filter((e) => e.status === "FAILED").length;
          const avgMs = entries.length ? Math.round(entries.reduce((s, e) => s + e.duration_ms, 0) / entries.length) : 0;
          const last = entries[0];
          return (
            <Card key={ag.key} interactive={false} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-fg">{ag.label}</span>
                {last ? (
                  <Pill tone={last.status === "SUCCESS" ? "green" : "red"}>{last.status}</Pill>
                ) : (
                  <Pill tone="gray">{tt("BEKLEMEDE")}</Pill>
                )}
              </div>
              <div className="flex flex-wrap gap-3 text-[12px] text-fg-muted tabular-nums">
                <span>{tt("Başarılı:")} {okCount}</span>
                <span>{tt("Hata:")} {failCount}</span>
                <span>{tt("Ort. Süre:")} {avgMs} ms</span>
              </div>
              {last ? <p className="line-clamp-2 text-[12px] text-fg-passive">{last.summary}</p> : null}
            </Card>
          );
        })}
      </div>

      {/* Hesap Bazlı Ajan Telemetrisi */}
      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("Hesap Bazlı Anlık Ajan Durumu")} ({reports.length})</CardTitle>
        {reports.length === 0 ? (
          <p className="text-[13px] text-fg-muted">{tt("Henüz taranmış influencer hesabı yok. Yukarıdan 'Tüm Influencerları Tara' butonunu kullanabilirsiniz.")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-line text-[12px] text-fg-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">{tt("Influencer")}</th>
                  <th className="py-2 px-3 font-medium">{tt("Onboarding")}</th>
                  <th className="py-2 px-3 font-medium">{tt("Günlük Senkron")}</th>
                  <th className="py-2 px-3 font-medium">{tt("Ajanlar")}</th>
                  <th className="py-2 px-3 font-medium">{tt("Hata")}</th>
                  <th className="py-2 pl-3 font-medium">{tt("Son Tarama")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {reports.map((r) => {
                  const up = r.telemetry.user_profile;
                  const errs = r.telemetry.admin_telemetry.errors;
                  return (
                    <tr key={r.influencerId} className="align-top">
                      <td className="py-2.5 pr-3">
                        <Link href={`/admin/influencerlar/${r.influencerId}`} className="font-medium text-fg hover:underline">
                          {r.influencerName}
                        </Link>
                        <div className="text-[12px] text-fg-muted">@{r.handle.replace(/^@+/, "")}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <Pill tone={up.onboarding_scan_status === "COMPLETED" ? "green" : up.onboarding_scan_status === "FAILED" ? "red" : "amber"}>
                          {up.onboarding_scan_status}
                        </Pill>
                      </td>
                      <td className="py-2.5 px-3">
                        <Pill tone={SYNC_TONE[up.daily_sync_status]}>{up.daily_sync_status}</Pill>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {r.telemetry.admin_telemetry.agents_executed.map((a) => (
                            <span
                              key={a.agent}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${a.status === "SUCCESS" ? "bg-emerald-500/12 text-emerald-500" : "bg-red-500/12 text-red-500"
                                }`}
                            >
                              {a.agent.replace("Agent", "").replace("Worker", "")} · {a.duration_ms}ms
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {errs.length ? (
                          <span className="text-[12px] font-medium text-critical">{errs[0]!.error_code}</span>
                        ) : (
                          <span className="text-[12px] text-fg-passive">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pl-3 text-[12px] tabular-nums text-fg-muted">
                        {fmtDateTime(new Date(r.generatedAt))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Anlık İşlem & Zamanlayıcı Log Akışı */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>{tt("Arka Plan Job Logları (AgentJobRun)")}</CardTitle>
          {jobRuns.length === 0 ? (
            <p className="text-[13px] text-fg-muted">{tt("Henüz arka plan job kaydı yok.")}</p>
          ) : (
            <ul className="flex max-h-96 flex-col divide-y divide-line overflow-y-auto text-[12px]">
              {jobRuns.map((j) => (
                <li key={j.id} className="flex flex-col gap-1 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Pill tone={j.ok ? "green" : "red"}>{j.ok ? "OK" : "HATA"}</Pill>
                      <span className="font-semibold text-fg">{j.job}</span>
                      <span className="text-fg-passive">({j.trigger})</span>
                    </div>
                    <span className="tabular-nums text-fg-muted">{fmtDateTime(new Date(j.startedAt))}</span>
                  </div>
                  <div className="text-fg-muted">
                    {tt("Oluşturulan:")} {j.created} · {tt("Atlanan:")} {j.skipped}
                    {j.error ? <span className="ml-2 text-critical">{j.error}</span> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card interactive={false} className="flex flex-col gap-3">
          <CardTitle>{tt("Canlı Ajan Bulguları (AgentRun)")}</CardTitle>
          {agentRuns.length === 0 ? (
            <p className="text-[13px] text-fg-muted">{tt("Henüz ajan bulgusu yok.")}</p>
          ) : (
            <ul className="flex max-h-96 flex-col divide-y divide-line overflow-y-auto text-[12px]">
              {agentRuns.map((a) => (
                <li key={a.id} className="flex flex-col gap-1 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Pill tone={a.severity === "KRITIK" ? "red" : a.severity === "UYARI" ? "amber" : "gray"}>{a.severity}</Pill>
                      <span className="font-semibold text-fg">{a.checkType}</span>
                    </div>
                    <span className="tabular-nums text-fg-muted">{fmtDateTime(new Date(a.createdAt))}</span>
                  </div>
                  <p className="text-fg-muted">{a.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
