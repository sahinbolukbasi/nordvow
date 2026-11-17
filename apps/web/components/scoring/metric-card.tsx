"use client";

import type { ConfidenceLevel, DimensionScoreResult, MetricStatus } from "@infulancer/core/scoring/types";
import { COLOR_THRESHOLDS } from "@infulancer/core/scoring/scoring.config";
import { cn } from "@/lib/cn";
import { useTT } from "@/lib/i18n/tt-client";

const CONFIDENCE_TEXT: Record<ConfidenceLevel, string> = {
  YUKSEK: "Yüksek",
  ORTA: "Orta",
  DUSUK: "Düşük",
};

const STATUS_LABEL: Record<MetricStatus, string> = {
  tamam: "Tamam",
  eksik: "Eksik veri",
  baglanti_gerekli: "OAuth gerekli",
  gizli: "Gizli veri",
  hata: "Hata",
};

function toneForScore(score: number | null) {
  if (score == null) {
    return {
      bar: "bg-fg-passive/40",
      text: "text-fg-muted",
      badge: "border-border bg-surface-muted text-fg-muted",
      dotFilled: "bg-fg-passive",
    };
  }
  if (score >= COLOR_THRESHOLDS.greenMin) {
    return {
      bar: "bg-emerald-500",
      text: "text-emerald-600 dark:text-emerald-400",
      badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      dotFilled: "bg-emerald-500",
    };
  }
  if (score >= COLOR_THRESHOLDS.yellowMin) {
    return {
      bar: "bg-amber-500",
      text: "text-amber-600 dark:text-amber-400",
      badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      dotFilled: "bg-amber-500",
    };
  }
  return {
    bar: "bg-rose-500",
    text: "text-rose-600 dark:text-rose-400",
    badge: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    dotFilled: "bg-rose-500",
  };
}

export function MetricCard({
  dimension,
  view = "brand",
}: {
  dimension: DimensionScoreResult;
  view?: "brand" | "influencer" | "admin";
}) {
  const tt = useTT();
  const tone = toneForScore(dimension.score);
  const filledDots = dimension.score == null ? 0 : Math.max(1, Math.min(5, Math.round(dimension.score / 20)));

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg">{tt(dimension.title)}</h3>
        <div className="flex items-center gap-2">
          <span className={cn("text-base font-bold tabular-nums", tone.text)}>
            {dimension.score != null ? `${dimension.score} / 100` : "—"}
          </span>
          <span className="inline-flex items-center gap-0.5" aria-hidden="true">
            {[1, 2, 3, 4, 5].map((idx) => (
              <span
                key={idx}
                className={cn(
                  "h-2 w-2 rounded-full",
                  idx <= filledDots ? tone.dotFilled : "bg-border",
                )}
              />
            ))}
          </span>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", tone.badge)}>
            {tt("Güven")}: {tt(CONFIDENCE_TEXT[dimension.confidence])}
          </span>
        </div>
      </div>

      <p className="text-[12px] text-fg-muted">{dimension.benchmarkLabel}</p>

      <div className="flex flex-col gap-1 text-[12px]">
        {dimension.why.map((reason, idx) => (
          <p key={idx} className="text-fg">
            <span className="font-medium text-fg-muted">{tt("Neden")}:</span> {reason}
          </p>
        ))}
        {view !== "brand" && dimension.howToImprove.length > 0 ? (
          <p className="text-emerald-700 dark:text-emerald-300">
            <span className="font-medium">{tt("Nasıl yükselir")}:</span>{" "}
            {dimension.howToImprove[0]!.text} ({tt(`tahmini +${dimension.howToImprove[0]!.estimatedGain} puan`)})
          </p>
        ) : null}
      </div>

      {view === "admin" && dimension.signals.length > 0 ? (
        <div className="mt-1 rounded-xl border border-border bg-bg p-2.5 text-[11px]">
          <p className="mb-1.5 font-medium text-fg-muted">{tt("Sinyal & Veri Durumu (Admin)")}</p>
          <ul className="flex flex-col gap-1">
            {dimension.signals.map((sig) => (
              <li key={sig.key} className="flex items-center justify-between gap-2">
                <span className="text-fg">{sig.label} (%{Math.round(sig.weight * 100)})</span>
                <span className="tabular-nums text-fg-muted">
                  {sig.value != null ? `${sig.value}/100` : "—"} · {STATUS_LABEL[sig.status]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between border-t border-border/60 pt-2 text-[11px] text-fg-passive">
        <span>{tt("Kaynak")}: {dimension.source}</span>
        <span>{new Date(dimension.updatedAt).toLocaleDateString("tr-TR")}</span>
      </div>
    </div>
  );
}
