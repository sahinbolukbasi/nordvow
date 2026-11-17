"use client";

import type { InfluencerNordvowScoreReport } from "@infulancer/core/scoring/types";
import { MetricCard } from "./metric-card";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });

export function NordvowScorePanel({
  report,
  view = "brand",
}: {
  report: InfluencerNordvowScoreReport;
  view?: "brand" | "influencer" | "admin";
}) {
  const tt = useTT();
  const primary = report.platforms[0];

  return (
    <section
      aria-label={tt("Nordvow Ölçüm ve Skorlama Raporu")}
      className="flex flex-col gap-5 rounded-3xl border border-line bg-surface p-5 sm:p-6"
    >
      {/* Üst Özet */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-fg">{tt("Nordvow Skor Kartı")}</h2>
            {report.grade ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold",
                  report.isEstimated
                    ? "border border-border bg-surface-muted text-fg-muted"
                    : "bg-neon text-black",
                )}
              >
                {report.isEstimated
                  ? tt(`Tahmini ${report.grade} (düşük güven)`)
                  : `${report.grade} · ${report.overallScore ?? "—"}/100`}
              </span>
            ) : null}
            <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-fg-muted">
              {tt("Güven")}: {report.confidence === "YUKSEK" ? tt("Yüksek") : report.confidence === "ORTA" ? tt("Orta") : tt("Düşük")}
            </span>
          </div>
          <p className="text-sm text-fg-muted">{tt(report.gradeLabel)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-4 text-right">
          {report.brandMatch ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5">
              <p className="text-[11px] text-emerald-700 dark:text-emerald-300">{tt("Marka Uyum Skoru")}</p>
              <p className="text-base font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
                {report.brandMatch.score} / 100
              </p>
            </div>
          ) : null}
          <div>
            <p className="text-[11px] text-fg-passive">{tt("Toplam Tahmini Erişim")}</p>
            <p className="text-base font-semibold tabular-nums text-fg">
              {compact.format(report.totalEstimatedReach)}
            </p>
          </div>
          {view === "admin" ? (
            <div>
              <p className="text-[11px] text-fg-passive">{tt("Skor Versiyonu")}</p>
              <p className="text-xs font-mono text-fg-muted">v{report.scoreVersion}</p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Otomatik Etiketler */}
      {report.tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {report.tags.map((tag) => {
            const isRisk = tag === "Bot Riski" || tag === "Düşen Etkileşim" || tag === "Az Paylaşım";
            return (
              <span
                key={tag}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  isRisk
                    ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                    : "border-border bg-bg text-fg",
                )}
              >
                {tt(tag)}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* Viral aykırı değer uyarısı */}
      {primary && primary.rawMetrics.viralCount > 0 ? (
        <p className="rounded-xl border border-border bg-bg px-3 py-2 text-xs text-fg-muted">
          {tt(`Son ${primary.rawMetrics.postsEvaluated} gönderide ${primary.rawMetrics.viralCount} viral içerik (medyan × 5 üzeri) tespit edildi; medyan hesaplamasında ayrı tutuldu.`)}
        </p>
      ) : null}

      {/* Altı Ana Skor Kartı */}
      {report.dimensions.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {report.dimensions.map((dim) => (
            <MetricCard key={dim.key} dimension={dim} view={view} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-fg-passive">{tt("Skor hesaplamak için bağlı sosyal hesap verisi bekleniyor.")}</p>
      )}

      {/* Influencer Görünümü: Oyunlaştırma Görevleri & Profil Tamamlanma */}
      {view === "influencer" ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-bg p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-fg">{tt("Skorunu Nasıl Yükseltirsin?")}</h3>
            <span className="text-xs font-medium text-fg-muted">
              %{report.profileCompletion.percent} {tt("tamamlandı")} · {report.profileCompletion.nextHint}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
            <div
              className="h-full rounded-full bg-neon transition-all"
              style={{ width: `${report.profileCompletion.percent}%` }}
            />
          </div>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {report.tasks.map((t) => (
              <li
                key={t.id}
                className={cn(
                  "flex items-start justify-between gap-2 rounded-xl border p-3 text-xs",
                  t.completed ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-surface",
                )}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg">
                    {t.completed ? "✓ " : "○ "}
                    {tt(t.goal)}
                  </span>
                  <span className="text-fg-muted">{tt(t.task)}</span>
                  <span className="text-[11px] text-fg-passive">{tt(t.affectedScore)}</span>
                </div>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                  {t.estimatedGainLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
