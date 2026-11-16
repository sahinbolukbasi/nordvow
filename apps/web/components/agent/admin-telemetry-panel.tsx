"use client";

import type { MultiAgentDailyReport } from "@infulancer/core/social/multi-agent-analytics";
import { useTT } from "@/lib/i18n/tt-client";
import { ActionForm } from "@/components/forms/action-form";
import { Pill, type PillTone } from "@/components/luma/primitives";
import { Card, CardTitle } from "@/components/ui/card";
import { runMultiAgentScanAction } from "@/lib/actions/operations";
import { fmtDateTime } from "@/lib/time";

const ONBOARDING_TONE: Record<"COMPLETED" | "IN_PROGRESS" | "FAILED", PillTone> = {
  COMPLETED: "green",
  IN_PROGRESS: "amber",
  FAILED: "red",
};

const SYNC_TONE: Record<"ACTIVE" | "PAUSED" | "TOKEN_EXPIRED" | "ERROR", PillTone> = {
  ACTIVE: "green",
  PAUSED: "gray",
  TOKEN_EXPIRED: "amber",
  ERROR: "red",
};

const AGENT_TONE: Record<"SUCCESS" | "FAILED" | "SKIPPED", PillTone> = {
  SUCCESS: "green",
  FAILED: "red",
  SKIPPED: "gray",
};

export function AdminTelemetryPanel({
  influencerId,
  report,
}: {
  influencerId: string;
  report: MultiAgentDailyReport | null;
}) {
  const tt = useTT();
  const t = report?.telemetry;

  return (
    <Card interactive={false} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>{tt("Otonom Ajan Telemetrisi & Günlük Veri Akışı")}</CardTitle>
          <p className="text-[13px] text-fg-muted">
            {tt("T-0 hızlı ön analiz, günlük zaman serisi aktarımı ve 4 ajanlı Meta Graph API tarama durumu.")}
          </p>
        </div>
        <ActionForm
          action={runMultiAgentScanAction}
          submitLabel={tt("Şimdi Tarama Çalıştır")}
          submitVariant="secondary"
          submitSize="sm"
          className="!flex-row items-center"
        >
          <input type="hidden" name="influencerId" value={influencerId} />
        </ActionForm>
      </div>

      {!t ? (
        <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[13px] text-fg-muted">
          {tt("Henüz bu hesap için Multi-Agent tarama kaydı yok. Yukarıdaki butonla ilk T-0 analizini başlatabilirsiniz.")}
        </div>
      ) : (
        <>
          {/* 1. Pipeline Durum Özeti */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-bg/50 p-3.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">onboarding_scan_status</span>
              <div>
                <Pill tone={ONBOARDING_TONE[t.user_profile.onboarding_scan_status]}>
                  {t.user_profile.onboarding_scan_status}
                </Pill>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-bg/50 p-3.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">daily_sync_status</span>
              <div>
                <Pill tone={SYNC_TONE[t.user_profile.daily_sync_status]}>
                  {t.user_profile.daily_sync_status}
                </Pill>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-bg/50 p-3.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">last_successful_sync</span>
              <span className="text-[13px] font-medium tabular-nums text-fg">
                {t.user_profile.last_sync_timestamp ? fmtDateTime(new Date(t.user_profile.last_sync_timestamp)) : tt("Henüz başarılı senkron yok")}
              </span>
            </div>
          </div>

          {/* 2. Hata ve Uyarı Yakalama */}
          {t.admin_telemetry.errors.length > 0 ? (
            <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-critical/40 bg-critical/10 p-4">
              <span className="text-[13px] font-semibold text-critical">{tt("Hata ve Uyarı Kaydı")}</span>
              {t.admin_telemetry.errors.map((err, idx) => (
                <div key={idx} className="flex flex-col gap-1 text-[13px] text-fg">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone="red">{err.error_code}</Pill>
                    <span className="font-medium">{err.failed_step}</span>
                    <span className="text-[12px] text-fg-muted">
                      retry_count: {err.retry_count} · next_retry_at: {fmtDateTime(new Date(err.next_retry_at))}
                    </span>
                  </div>
                  <p className="text-[12px] text-fg-muted">{err.message}</p>
                </div>
              ))}
            </div>
          ) : null}

          {/* 3. Ajan Tarama Logları (Agent Execution Matrix) */}
          <div className="flex flex-col gap-2">
            <span className="text-label text-fg-muted">{tt("Ajan Tarama Matrisi")}</span>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {t.admin_telemetry.agents_executed.map((ag) => (
                <div key={ag.agent} className="flex items-start justify-between gap-3 rounded-xl border border-line bg-bg/40 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-fg">{ag.agent}</span>
                      <Pill tone={AGENT_TONE[ag.status]}>{ag.status}</Pill>
                    </div>
                    <p className="mt-1 text-[12px] text-fg-muted">{ag.summary}</p>
                  </div>
                  <span className="shrink-0 text-[12px] tabular-nums text-fg-passive">{ag.duration_ms} ms</span>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Günlük Rapor & Standart JSON Çıktısı */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <details className="rounded-xl border border-line bg-bg/40 px-4 py-3 text-[13px]">
              <summary className="cursor-pointer font-medium text-fg">{tt("Günlük Büyüme Raporu (Markdown)")}</summary>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-fg-muted">
                {report.markdownReport}
              </pre>
            </details>
            <details className="rounded-xl border border-line bg-bg/40 px-4 py-3 text-[13px]">
              <summary className="cursor-pointer font-medium text-fg">{tt("Standart Telemetri Çıktısı (JSON)")}</summary>
              <pre className="mt-3 max-h-72 overflow-auto text-[11px] leading-relaxed text-fg-muted">
                {JSON.stringify(t, null, 2)}
              </pre>
            </details>
          </div>
        </>
      )}
    </Card>
  );
}

