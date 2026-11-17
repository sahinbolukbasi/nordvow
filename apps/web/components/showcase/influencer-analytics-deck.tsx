"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useTT } from "@/lib/i18n/tt-client";
import type { InfluencerExplorerReport } from "@infulancer/core/social/explorer";
import { triggerInfluencerExplorerAction } from "@/lib/actions/agents";
import { ActionForm } from "@/components/forms/action-form";
import { BarChart, LineChart } from "@/components/charts/charts";
import { ExternalIcon, SparkleIcon } from "@/components/icons";
import { StatusDot } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { fmtDate, fmtDateTime } from "@/lib/time";

type TimeRange = "7d" | "30d" | "90d" | "all";
type ChartMetric = "followers" | "views_saves" | "er" | "frequency";
type SectionTab = "genel" | "icerik" | "markalar" | "kitle";

const compact = new Intl.NumberFormat("tr-TR", { notation: "compact", maximumFractionDigits: 1 });
const intFmt = new Intl.NumberFormat("tr-TR");

const VERIFICATION_LABEL: Record<InfluencerExplorerReport["verificationStatus"], { label: string; tone: "active" | "muted" | "passive" }> = {
  META_API_VERIFIED: { label: "Meta Graph API Doğrulandı", tone: "active" },
  HYBRID_API_BOT: { label: "Hibrit (Meta API + Gezgin Bot)", tone: "active" },
  EXPLORER_BOT: { label: "Instagram Gezgini Otonom Bot Taraması", tone: "muted" },
};

const SOURCE_BADGE: Record<string, string> = {
  meta_api: "Meta Graph API",
  explorer_bot: "Gezgin Bot (@mention/#reklam)",
  platform_campaign: "Platform Kampanyası",
};

export function InfluencerAnalyticsDeck({
  report,
  isAdmin = false,
}: {
  report: InfluencerExplorerReport;
  isAdmin?: boolean;
}) {
  const tt = useTT();
  const [range, setRange] = useState<TimeRange>("30d");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("followers");
  const [activeTab, setActiveTab] = useState<SectionTab>("genel");
  const [mediaFilter, setMediaFilter] = useState<"ALL" | "REELS" | "POST" | "CAROUSEL" | "STORY">("ALL");
  const [showRawLogs, setShowRawLogs] = useState(false);

  const filteredMedia = useMemo(() => {
    if (mediaFilter === "ALL") return report.recentMedia;
    return report.recentMedia.filter((m) => m.mediaType === mediaFilter);
  }, [report.recentMedia, mediaFilter]);

  const filteredSeries = useMemo(() => {
    const all = report.dailySeries;
    if (range === "7d") return all.slice(-7);
    if (range === "30d") return all.slice(-30);
    if (range === "90d") return all.slice(-90);
    return all;
  }, [report.dailySeries, range]);

  const periodStats = useMemo(() => {
    if (!filteredSeries.length) {
      return { netFollowers: 0, growthPct: 0, avgViews: 0, avgSaves: 0, totalPosts: 0, totalReels: 0, totalStories: 0 };
    }
    const first = filteredSeries[0]!.followers;
    const last = filteredSeries[filteredSeries.length - 1]!.followers;
    const netFollowers = last - first;
    const growthPct = first > 0 ? Number(((netFollowers / first) * 100).toFixed(2)) : 0;
    const avgViews = Math.round(filteredSeries.reduce((s, d) => s + d.avgViews, 0) / filteredSeries.length);
    const avgSaves = Math.round(filteredSeries.reduce((s, d) => s + d.avgSaves, 0) / filteredSeries.length);
    const totalPosts = filteredSeries.reduce((s, d) => s + d.postsPublished, 0);
    const totalReels = filteredSeries.reduce((s, d) => s + d.reelsPublished, 0);
    const totalStories = filteredSeries.reduce((s, d) => s + d.storiesPublished, 0);
    return { netFollowers, growthPct, avgViews, avgSaves, totalPosts, totalReels, totalStories };
  }, [filteredSeries]);

  const verInfo = VERIFICATION_LABEL[report.verificationStatus];

  return (
    <div className="flex flex-col gap-6">
      {/* 1. "Instagram Gezgini" (Instagram Explorer) AI Karar & Marka Uyum Skoru Kartı */}
      <section
        aria-label={tt("Instagram Gezgini AI Analizi ve Marka Uyum Skoru")}
        className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-bg text-fg">
              <SparkleIcon size={18} />
            </span>
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-fg">
                  {isAdmin ? tt("Instagram Gezgini (AI Performans & Kimlik Analizi)") : tt("İçerik Performansı & Kitle Özeti")}
                </h2>
                <span className="rounded-full bg-fg px-2.5 py-0.5 text-[11px] font-semibold text-bg">
                  {report.scores.priorityTier} · {report.scores.overallScore}/100
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                <StatusDot tone={verInfo.tone}>{isAdmin ? verInfo.label : report.verificationStatus === "EXPLORER_BOT" ? tt("Güncel Profil Verisi") : tt("Doğrulanmış Hesap")}</StatusDot>
                <span>· @{report.handle}</span>
                <span>· {tt("Son güncelleme:")} {fmtDateTime(new Date(report.generatedAt))}</span>
              </div>
            </div>
          </div>

          {/* Admin & Marka Kontrolleri */}
          <div className="flex flex-wrap items-center gap-2">
            <ActionForm
              action={triggerInfluencerExplorerAction}
              submitLabel={isAdmin ? tt("Canlı Verileri Şimdi Güncelle (Bot/API Tetikle)") : tt("Verileri Yenile")}
              submitVariant="secondary"
              submitSize="sm"
            >
              <input type="hidden" name="influencerId" value={report.influencerId} />
            </ActionForm>
            {isAdmin ? (
              <button
                type="button"
                onClick={() => setShowRawLogs((v) => !v)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-standard",
                  showRawLogs ? "border-fg bg-fg text-bg" : "border-line bg-bg text-fg hover:border-fg/40",
                )}
              >
                {showRawLogs ? tt("Ham Logları Gizle") : `${tt("Ham Veri Logları")} (${report.rawLogs.length})`}
              </button>
            ) : null}
          </div>
        </div>

        {/* Admin Ham Veri Logları (Açılır Tablo) */}
        {isAdmin && showRawLogs ? (
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-fg">
                {tt("Hibrit Veri Hattı Ham Tarama Logları (Meta Graph API + Instagram Gezgini Bot + AWS AgentCore)")}
              </span>
              <Link href="/admin/agent?bolum=instagram" className="text-[11px] text-fg-muted underline hover:text-fg">
                {tt("Agent Merkezinde Aç →")}
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead className="border-b border-line text-left text-fg-muted">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">{tt("Zaman")}</th>
                    <th className="py-1.5 pr-3 font-medium">{tt("Kaynak")}</th>
                    <th className="py-1.5 pr-3 font-medium">{tt("Endpoint / İşlem")}</th>
                    <th className="py-1.5 pr-3 font-medium">{tt("Durum")}</th>
                    <th className="py-1.5 pr-3 font-medium">{tt("Süre")}</th>
                    <th className="py-1.5 font-medium">{tt("Detay")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {report.rawLogs.map((log, i) => (
                    <tr key={i} className="align-top">
                      <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-fg-passive">
                        {fmtDateTime(new Date(log.timestamp))}
                      </td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] font-semibold text-fg">{log.source}</td>
                      <td className="py-1.5 pr-3 font-mono text-[11px] text-fg-muted">{log.endpoint}</td>
                      <td className="py-1.5 pr-3">
                        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] font-semibold">
                          {log.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums text-fg-muted">{log.durationMs} ms</td>
                      <td className="py-1.5 text-fg-muted">{log.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {/* AI Yönetici Özeti + 4 Boyutlu Marka Uyum Skorları */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-bg/50 p-4">
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                {tt("Akıllı Yorumlama ve Yönetici Özeti")}
              </span>
              <p className="text-[14px] leading-relaxed text-fg">{report.aiExecutiveSummary}</p>
            </div>
            <ul className="flex flex-col gap-1.5 border-t border-line/60 pt-3 text-[12px] text-fg-muted">
              {report.aiHighlights.map((h, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-fg" />
                  <span>{h}</span>
                </li>
              ))}
            </ul>
            <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[12px] font-medium text-fg">
              {report.aiRecommendation}
            </div>
          </div>

          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-bg/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-fg">{tt("Marka Uyum & Seçim Önceliği Skoru")}</span>
              <span className="text-xl font-bold tabular-nums text-fg">{report.scores.overallScore} / 100</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {[
                { label: tt("Güvenilirlik & Gerçek Kitle"), val: report.scores.reliabilityScore },
                { label: tt("İçerik & Yayın İstikrarı"), val: report.scores.consistencyScore },
                { label: tt("Kaydetme & Dönüşüm Potansiyeli"), val: report.scores.conversionPotentialScore },
                { label: tt("Sponsorlu / Organik Performans Koruma"), val: report.scores.sponsoredRetentionScore },
              ].map((s) => (
                <div key={s.label} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-fg-muted">{s.label}</span>
                    <span className="font-semibold tabular-nums text-fg">%{s.val}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-fg transition-all" style={{ width: `${Math.min(100, s.val)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 border-t border-line/60 pt-2.5 text-center text-[11px] sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface p-2">
                <span className="block text-fg-muted">{tt("Ort. İzlenme")}</span>
                <strong className="text-[13px] tabular-nums text-fg">{compact.format(report.avgReelsViews)}</strong>
              </div>
              <div className="rounded-xl border border-line bg-surface p-2">
                <span className="block text-fg-muted">{tt("Ort. Kaydetme")}</span>
                <strong className="text-[13px] tabular-nums text-fg">{compact.format(report.avgSaves)}</strong>
              </div>
              <div className="rounded-xl border border-line bg-surface p-2">
                <span className="block text-fg-muted">{tt("Satın Alma Niyeti")}</span>
                <strong className="text-[13px] tabular-nums text-fg">%{report.sentiment.purchaseIntentPct}</strong>
              </div>
            </div>
          </div>
        </div>

        {/* Alt Gezinme Sekmeleri */}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3" role="tablist">
          {[
            { id: "genel" as const, label: tt("Gelişim Grafikleri (7G / 30G / 90G)") },
            { id: "icerik" as const, label: `${tt("Etkileşim, Kaydetme & Reels Analizi")} (${report.recentMedia.length})` },
            { id: "markalar" as const, label: `${tt("Çalıştığı Markalar & İşbirliği Kıyaslaması")} (${report.brandCollaborations.length})` },
            { id: "kitle" as const, label: tt("Kitle Kalitesi & Yorum Duygu Analizi (NLP)") },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-[12px] font-semibold transition-standard",
                activeTab === t.id ? "bg-fg text-bg" : "border border-line bg-bg text-fg-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* SEKME 1: İNTERAKTİF ZAMAN ÇİZELGESİ GELİŞİM GRAFİKLERİ */}
      {activeTab === "genel" ? (
        <section className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-fg">{tt("Tarihsel Gelişim & Zaman Serisi Analizi")}</h3>
              <p className="text-[12px] text-fg-muted">
                {tt("Günlük takipçi değişimi, Reels izlenmeleri, kaydetme (saves) ve yayın sıklığı trendi")}
              </p>
            </div>

            {/* Zaman Aralığı Seçici: Son 7 Gün / 30 Gün / 90 Gün / Tüm Zamanlar */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border border-line bg-bg p-0.5" role="group" aria-label={tt("Zaman aralığı")}>
                {(
                  [
                    { id: "7d", label: tt("Son 7 Gün") },
                    { id: "30d", label: tt("Son 30 Gün") },
                    { id: "90d", label: tt("Son 90 Gün") },
                    { id: "all", label: tt("Tüm Zamanlar") },
                  ] as const
                ).map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRange(r.id)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-medium transition-standard",
                      range === r.id ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Seçili Dönem Özet KPI Kartları */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-2xl border border-line bg-bg/40 p-3">
              <span className="text-[11px] text-fg-muted">{tt("Net Takipçi Değişimi")}</span>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">
                {periodStats.netFollowers >= 0 ? "+" : ""}
                {intFmt.format(periodStats.netFollowers)}
              </p>
              <span className="text-[11px] text-fg-passive">%{periodStats.growthPct} {tt("büyüme")}</span>
            </div>
            <div className="rounded-2xl border border-line bg-bg/40 p-3">
              <span className="text-[11px] text-fg-muted">{tt("Dönem Ort. İzlenme")}</span>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{compact.format(periodStats.avgViews)}</p>
              <span className="text-[11px] text-fg-passive">Reels / Video</span>
            </div>
            <div className="rounded-2xl border border-line bg-bg/40 p-3">
              <span className="text-[11px] text-fg-muted">{tt("Dönem Ort. Kaydetme")}</span>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{compact.format(periodStats.avgSaves)}</p>
              <span className="text-[11px] text-fg-passive">Saves / Gönderi</span>
            </div>
            <div className="rounded-2xl border border-line bg-bg/40 p-3">
              <span className="text-[11px] text-fg-muted">{tt("Yayınlanan Reels")}</span>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{periodStats.totalReels}</p>
              <span className="text-[11px] text-fg-passive">{tt("dikey video")}</span>
            </div>
            <div className="rounded-2xl border border-line bg-bg/40 p-3">
              <span className="text-[11px] text-fg-muted">{tt("Yayınlanan Gönderi")}</span>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{periodStats.totalPosts}</p>
              <span className="text-[11px] text-fg-passive">Post & Carousel</span>
            </div>
            <div className="rounded-2xl border border-line bg-bg/40 p-3">
              <span className="text-[11px] text-fg-muted">{tt("Yayınlanan Story")}</span>
              <p className="mt-0.5 text-lg font-semibold tabular-nums text-fg">{periodStats.totalStories}</p>
              <span className="text-[11px] text-fg-passive">24s Hikaye</span>
            </div>
          </div>

          {/* Grafik Metrik Seçici */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: "followers", label: tt("Takipçi Sayısı & Günlük Kazanım") },
                { id: "views_saves", label: tt("Reels İzlenme & Kaydetme (Saves)") },
                { id: "er", label: tt("Etkileşim Oranı (ER%)") },
                { id: "frequency", label: tt("Yayınlanma Sıklığı (Reels / Post / Story)") },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setChartMetric(m.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-medium transition-standard",
                  chartMetric === m.id ? "border-fg bg-fg text-bg" : "border-line bg-bg text-fg-muted hover:text-fg",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* İnteraktif İkili Grafik Alanı */}
          {chartMetric === "followers" ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/30 p-4">
                <span className="text-[12px] font-medium text-fg">{tt("Toplam Takipçi Gelişimi")}</span>
                <LineChart
                  label={tt("Toplam takipçi")}
                  format={(v) => compact.format(v)}
                  points={filteredSeries.map((d) => ({ label: d.label, value: d.followers }))}
                />
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/30 p-4">
                <span className="text-[12px] font-medium text-fg">{tt("Günlük Net Takipçi Kazanımı (+ / -)")}</span>
                <BarChart
                  label={tt("Günlük takipçi değişimi")}
                  format={(v) => `${v >= 0 ? "+" : ""}${intFmt.format(v)}`}
                  bars={filteredSeries.slice(-14).map((d) => ({ label: d.label, value: Math.max(0, d.followersDelta) }))}
                />
              </div>
            </div>
          ) : chartMetric === "views_saves" ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/30 p-4">
                <span className="text-[12px] font-medium text-fg">{tt("Günlük Ortalama Reels / Video İzlenme (Views)")}</span>
                <LineChart
                  label={tt("Reels izlenme")}
                  format={(v) => compact.format(v)}
                  points={filteredSeries.map((d) => ({ label: d.label, value: d.avgViews }))}
                />
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/30 p-4">
                <span className="text-[12px] font-medium text-fg">{tt("Günlük Ortalama Kaydetme (Saves) Sayısı")}</span>
                <LineChart
                  label={tt("Kaydetme sayısı")}
                  format={(v) => compact.format(v)}
                  points={filteredSeries.map((d) => ({ label: d.label, value: d.avgSaves }))}
                />
              </div>
            </div>
          ) : chartMetric === "er" ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/30 p-4">
                <span className="text-[12px] font-medium text-fg">{tt("Günlük Etkileşim Oranı (ER%) Trendi")}</span>
                <LineChart
                  label={tt("Etkileşim oranı")}
                  format={(v) => `%${v.toFixed(2)}`}
                  points={filteredSeries.map((d) => ({ label: d.label, value: d.engagementRatePct }))}
                />
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/30 p-4">
                <span className="text-[12px] font-medium text-fg">{tt("Günlük Ortalama Beğeni (Likes)")}</span>
                <LineChart
                  label={tt("Ortalama beğeni")}
                  format={(v) => compact.format(v)}
                  points={filteredSeries.map((d) => ({ label: d.label, value: d.avgLikes }))}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/30 p-4">
                <span className="text-[12px] font-medium text-fg">{tt("Günlük Story Yayınlanma Sıklığı")}</span>
                <BarChart
                  label={tt("Story sayısı")}
                  format={(v) => `${v} Story`}
                  bars={filteredSeries.slice(-14).map((d) => ({ label: d.label, value: d.storiesPublished }))}
                />
              </div>
              <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/30 p-4">
                <span className="text-[12px] font-medium text-fg">{tt("Günlük Reels & Post Yayın Sıklığı")}</span>
                <BarChart
                  label={tt("Reels ve Post")}
                  format={(v) => `${v} içerik`}
                  bars={filteredSeries.slice(-14).map((d) => ({ label: d.label, value: d.reelsPublished + d.postsPublished }))}
                />
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* SEKME 2: ETKİLEŞİM, KAYDETME (SAVES) & REELS / POST KIRILIMI */}
      {activeTab === "icerik" ? (
        <section className="flex flex-col gap-5 rounded-3xl border border-line bg-surface p-5 sm:p-6">
          <div>
            <h3 className="text-base font-semibold text-fg">{tt("İçerik Türüne Göre Etkileşim, İzlenme ve Kaydetme Kırılımı")}</h3>
            <p className="text-[12px] text-fg-muted">
              {tt("Reels, Kaydırmalı Gönderi (Carousel), Tekli Post ve Hikaye (Story) performans karşılaştırması")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {report.formatBreakdown.map((f) => (
              <div key={f.format} className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-bg/40 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-fg">{f.label}</span>
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-fg">
                    ER %{f.erPct}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <dt className="text-fg-passive">{tt("Ort. İzlenme")}</dt>
                    <dd className="font-semibold tabular-nums text-fg">{compact.format(f.avgViews)}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-passive">{tt("Ort. Kaydetme")}</dt>
                    <dd className="font-semibold tabular-nums text-fg">{compact.format(f.avgSaves)}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-passive">{tt("Ort. Beğeni")}</dt>
                    <dd className="font-semibold tabular-nums text-fg">{compact.format(f.avgLikes)}</dd>
                  </div>
                  <div>
                    <dt className="text-fg-passive">{tt("Ort. Yorum / Paylaşım")}</dt>
                    <dd className="font-semibold tabular-nums text-fg">
                      {compact.format(f.avgComments)} / {compact.format(f.avgShares)}
                    </dd>
                  </div>
                </dl>
                <div className="border-t border-line/60 pt-2 text-[11px] text-fg-muted">
                  {tt("Yayın Sıklığı:")} <strong>{tt("Haftada")} ~{f.weeklyFrequency}</strong> · {tt("Pay:")} %{f.sharePct}
                </div>
              </div>
            ))}
          </div>

          {/* Son 50 Gönderi, Reels & Hikâye Detay Tablosu */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-fg">
                {tt("Son Paylaşımlar (Reels, Post, Carousel, Hikâye)")} · {filteredMedia.length}
              </h4>
              <div className="flex flex-wrap items-center gap-1.5">
                {(["ALL", "REELS", "POST", "CAROUSEL", "STORY"] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setMediaFilter(fmt)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-semibold transition-standard",
                      mediaFilter === fmt ? "bg-fg text-bg" : "border border-line bg-bg text-fg-muted hover:text-fg",
                    )}
                  >
                    {fmt === "ALL" ? tt("Tümü") : fmt}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[560px] overflow-auto rounded-2xl border border-line">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="sticky top-0 z-10 bg-surface text-left text-[12px] text-fg-muted shadow-xs">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{tt("Tür")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("İçerik / Açıklama")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("İzlenme")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("Beğeni")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("Yorum")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("Kaydetme")}</th>
                    <th className="px-4 py-2.5 font-medium">{tt("Paylaşım")}</th>
                    <th className="px-4 py-2.5 font-medium">ER%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {filteredMedia.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-[13px] text-fg-muted">
                        {mediaFilter === "STORY"
                          ? tt("Aktif hikâye (Story) verisi yalnızca içerik üreticisi Instagram OAuth bağlantısı yaptığında 24 saatlik pencereden çekilebilir.")
                          : tt("Bu formatta paylaşım kaydı bulunamadı.")}
                      </td>
                    </tr>
                  ) : (
                    filteredMedia.map((m) => (
                      <tr key={m.id} className="align-top">
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-[11px] font-semibold text-fg">
                            {m.mediaType}
                          </span>
                          {m.isSponsored ? (
                            <span className="ml-1.5 rounded-full bg-fg px-2 py-0.5 text-[10px] font-semibold text-bg">
                              {m.detectedBrand ?? tt("İşbirliği")}
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-sm px-4 py-2.5">
                          <div className="flex items-start gap-2.5">
                            {m.thumbnailUrl ? (
                              <img
                                src={m.thumbnailUrl}
                                alt=""
                                loading="lazy"
                                className="h-11 w-11 shrink-0 rounded-lg border border-line object-cover"
                              />
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-[12px] text-fg">{m.caption}</p>
                              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-passive">
                                <span>{fmtDate(new Date(m.publishedAt))}</span>
                                {m.permalink ? (
                                  <a
                                    href={m.permalink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-0.5 text-fg-muted underline hover:text-fg"
                                  >
                                    Instagram <ExternalIcon size={10} />
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-semibold tabular-nums">{m.views > 0 ? compact.format(m.views) : "—"}</td>
                        <td className="px-4 py-2.5 tabular-nums">{compact.format(m.likes)}</td>
                        <td className="px-4 py-2.5 tabular-nums">{compact.format(m.comments)}</td>
                        <td className="px-4 py-2.5 font-semibold tabular-nums text-fg">{m.saves > 0 ? compact.format(m.saves) : "—"}</td>
                        <td className="px-4 py-2.5 tabular-nums text-fg-muted">{m.shares > 0 ? compact.format(m.shares) : "—"}</td>
                        <td className="px-4 py-2.5 font-semibold tabular-nums">%{m.erPct.toFixed(2)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}

      {/* SEKME 3: İŞBİRLİĞİ & MARKA GEÇMİŞİ ANALİZİ (ORGANİK VS SPONSORLU KIYASLAMASI) */}
      {activeTab === "markalar" ? (
        <section className="flex flex-col gap-5 rounded-3xl border border-line bg-surface p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-fg">{tt("En Son Çalıştığı Markalar & İşbirliği Performans Kıyaslaması")}</h3>
              <p className="text-[12px] text-fg-muted">
                {tt("Caption (@mention, #reklam, #işbirliği, Paid Partnership) ve kampanya geçmişinden tespit edilen sponsorlu içerik analizi")}
              </p>
            </div>
            <span className="rounded-full border border-line bg-bg px-3 py-1 text-[12px] font-semibold text-fg">
              {tt("Sponsorlu Performans Koruma:")} %{report.organicVsSponsored.performanceRetentionPct}
            </span>
          </div>

          {/* Organik vs İşbirliği (Sponsorlu) Performans Kıyaslaması */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-fg">{tt("Organik İçerik Ortalaması")}</span>
                <span className="text-[12px] text-fg-muted">{report.organicVsSponsored.organicCount} {tt("gönderi")}</span>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] text-fg-passive">{tt("Ort. İzlenme")}</dt>
                  <dd className="text-base font-semibold tabular-nums text-fg">
                    {compact.format(report.organicVsSponsored.organicAvgViews)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-passive">{tt("Ort. Beğeni")}</dt>
                  <dd className="text-base font-semibold tabular-nums text-fg">
                    {compact.format(report.organicVsSponsored.organicAvgLikes)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-passive">{tt("Ort. Kaydetme")}</dt>
                  <dd className="text-base font-semibold tabular-nums text-fg">
                    {compact.format(report.organicVsSponsored.organicAvgSaves)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-passive">{tt("Organik ER%")}</dt>
                  <dd className="text-base font-semibold tabular-nums text-fg">
                    %{report.organicVsSponsored.organicErPct.toFixed(2)}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-fg">{tt("Sponsorlu / İşbirliği İçerik Ortalaması")}</span>
                <span className="text-[12px] text-fg-muted">{report.organicVsSponsored.sponsoredCount} {tt("işbirliği")}</span>
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] text-fg-passive">{tt("Ort. İzlenme")}</dt>
                  <dd className="text-base font-semibold tabular-nums text-fg">
                    {compact.format(report.organicVsSponsored.sponsoredAvgViews)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-passive">{tt("Ort. Beğeni")}</dt>
                  <dd className="text-base font-semibold tabular-nums text-fg">
                    {compact.format(report.organicVsSponsored.sponsoredAvgLikes)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-passive">{tt("Ort. Kaydetme")}</dt>
                  <dd className="text-base font-semibold tabular-nums text-fg">
                    {compact.format(report.organicVsSponsored.sponsoredAvgSaves)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-fg-passive">{tt("Sponsorlu ER%")}</dt>
                  <dd className="text-base font-semibold tabular-nums text-fg">
                    %{report.organicVsSponsored.sponsoredErPct.toFixed(2)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>

          {/* Tespit Edilen Marka İşbirlikleri Tablosu */}
          <div className="overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-fg/[0.03] text-left text-[12px] text-fg-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{tt("Marka")}</th>
                  <th className="px-4 py-2.5 font-medium">{tt("Kategori")}</th>
                  <th className="px-4 py-2.5 font-medium">{tt("Format & Etiket")}</th>
                  <th className="px-4 py-2.5 font-medium">{tt("İzlenme")}</th>
                  <th className="px-4 py-2.5 font-medium">{tt("Beğeni")}</th>
                  <th className="px-4 py-2.5 font-medium">{tt("Kaydetme")}</th>
                  <th className="px-4 py-2.5 font-medium">ER%</th>
                  <th className="px-4 py-2.5 font-medium">{tt("Tespit Kaynağı & Tarih")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.brandCollaborations.map((b) => (
                  <tr key={b.id}>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-fg">{b.brandName}</span>
                      <span className="block text-[11px] text-fg-muted">{b.brandHandle}</span>
                    </td>
                    <td className="px-4 py-2.5 text-[12px] text-fg-muted">{b.category}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full border border-line bg-bg px-2 py-0.5 text-[11px] font-medium">
                        {b.contentType}
                      </span>
                      <span className="ml-1.5 text-[11px] text-fg-passive">{b.disclosureTag}</span>
                    </td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums">{compact.format(b.views)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{compact.format(b.likes)}</td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums">{compact.format(b.saves)}</td>
                    <td className="px-4 py-2.5 font-semibold tabular-nums">%{b.erPct.toFixed(2)}</td>
                    <td className="px-4 py-2.5 text-[11px] text-fg-muted">
                      <span className="block text-fg">{SOURCE_BADGE[b.source] ?? b.source}</span>
                      <span>{fmtDate(new Date(b.lastWorkedAt))}</span>
                      {b.postUrl ? (
                        <a
                          href={b.postUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 inline-flex items-center gap-0.5 underline hover:text-fg"
                        >
                          {tt("Aç")} <ExternalIcon size={10} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* SEKME 4: KİTLE KALİTESİ, YORUM DUYGU ANALİZİ (NLP) & BOT TESPİTİ */}
      {activeTab === "kitle" ? (
        <section className="flex flex-col gap-5 rounded-3xl border border-line bg-surface p-5 sm:p-6">
          <div>
            <h3 className="text-base font-semibold text-fg">{tt("Kitle Kalitesi, NLP Yorum Duygu Analizi & Bot / Pod Denetimi")}</h3>
            <p className="text-[12px] text-fg-muted">
              {tt("Gönderilere gelen yorumların doğal dil işleme (LLM) ile duygu kırılımı ve sahte etkileşim kontrolü")}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Yorum Duygu Analizi */}
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-bg/40 p-4">
              <span className="text-sm font-semibold text-fg">{tt("Gönderi Yorumları NLP Duygu Dağılımı")}</span>
              {[
                { label: tt("Pozitif & Beğeni Yorumları"), val: report.sentiment.positivePct },
                { label: tt("Satın Alma Niyeti Taşıyan Yorumlar ('link', 'fiyat', 'kod')"), val: report.sentiment.purchaseIntentPct },
                { label: tt("Nötr / Emoji Yorumları"), val: report.sentiment.neutralPct },
                { label: tt("Negatif / Şikayet Yorumları"), val: report.sentiment.negativePct },
              ].map((s) => (
                <div key={s.label} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-fg-muted">{s.label}</span>
                    <span className="font-semibold tabular-nums text-fg">%{s.val}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-fg" style={{ width: `${Math.min(100, s.val)}%` }} />
                  </div>
                </div>
              ))}
              <div className="mt-1 flex flex-wrap gap-1.5 border-t border-line/60 pt-2.5">
                <span className="text-[11px] text-fg-passive">{tt("Sık Geçen İfadeler:")}</span>
                {report.sentiment.topKeywords.map((kw) => (
                  <span key={kw} className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] text-fg">
                    “{kw}”
                  </span>
                ))}
              </div>
            </div>

            {/* Bot / Sahte Takipçi & Engagement Pod Denetimi */}
            <div className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-bg/40 p-4">
              <span className="text-sm font-semibold text-fg">{tt("Gerçek Kitle & Sahte Etkileşim (Pod) Denetimi")}</span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-line bg-surface p-3">
                  <span className="text-[11px] text-fg-muted">{tt("Gerçek Kitle Skoru")}</span>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-fg">%{report.sentiment.authenticityScore}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface p-3">
                  <span className="text-[11px] text-fg-muted">{tt("Tahmini Bot / İnaktif")}</span>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-fg">%{report.sentiment.botFollowerEstimatePct}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface p-3">
                  <span className="text-[11px] text-fg-muted">{tt("Pod Riski")}</span>
                  <p className="mt-0.5 text-lg font-bold text-fg">{report.sentiment.engagementPodRisk}</p>
                </div>
                <div className="rounded-xl border border-line bg-surface p-3">
                  <span className="text-[11px] text-fg-muted">{tt("Kaydetme / Beğeni")}</span>
                  <p className="mt-0.5 text-lg font-bold tabular-nums text-fg">%{report.sentiment.saveToLikeRatioPct}</p>
                </div>
              </div>
              <ul className="flex flex-col gap-1.5 border-t border-line/60 pt-2.5 text-[12px] text-fg-muted">
                {report.sentiment.sampleInsights.map((ins, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-fg" />
                    <span>{ins}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
