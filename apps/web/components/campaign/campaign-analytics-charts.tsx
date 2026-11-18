import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { StatusDot } from "@/components/ui/status";
import { PlatformIcon } from "@/components/platform-icon";
import { fmtCompact, num, pct1 } from "@/lib/format";
import type { Platform } from "@infulancer/core/db";

export type CampaignChartMetricRow = {
  id: string;
  influencerName: string;
  platform: Platform;
  contentLabel: string;
  views: number;
  reach: number;
  likes: number;
  comments: number;
  savesShares: number;
  er: number | null;
  postUrl: string | null;
  complianceStatus: "UYUMLU" | "EKSIK" | "BEKLIYOR";
};

export type CampaignInfluencerPerf = {
  name: string;
  viewsOrReach: number;
  interactions: number;
  publishedCount: number;
  er: number | null;
};

export type CampaignAgentFindingItem = {
  id: string;
  title: string;
  severity: string;
  status: string;
  summary: string;
};

export function CampaignSummaryCharts({
  views,
  reach,
  likes,
  comments,
  savesShares,
  publishedCount,
  plannedCount,
  er,
  influencerPerf,
}: {
  views: number;
  reach: number;
  likes: number;
  comments: number;
  savesShares: number;
  publishedCount: number;
  plannedCount: number;
  er: number | null;
  influencerPerf: CampaignInfluencerPerf[];
}) {
  const totalInteractions = likes + comments + savesShares;
  const maxBar = Math.max(1, views, reach, totalInteractions);
  const maxInf = Math.max(1, ...influencerPerf.map((i) => i.viewsOrReach));

  let verdictTitle = "Ölçüm Verisi Bekleniyor";
  let verdictTone: "active" | "muted" | "passive" = "passive";
  let verdictDesc = "Yayınlar gelip API ölçümleri toplandıkça kampanya başarı değerlendirmesi otomatik oluşacaktır.";

  if (publishedCount > 0 && (views > 0 || reach > 0 || totalInteractions > 0)) {
    const goodEr = (er ?? 0) >= 0.025;
    if (goodEr && totalInteractions >= 50) {
      verdictTitle = "Kampanya Tuttu — Yüksek Etkileşim";
      verdictTone = "active";
      verdictDesc = `${publishedCount} yayında ${fmtCompact(views || reach)} görüntülenme/erişim ve ${fmtCompact(totalInteractions)} toplam etkileşim (${er != null ? pct1.format(er) : "—"} ER) elde edildi.`;
    } else {
      verdictTitle = "Kampanya Aktif — Büyüme Sürüyor";
      verdictTone = "muted";
      verdictDesc = `${publishedCount}/${Math.max(1, plannedCount)} içerik yayında, ${fmtCompact(totalInteractions)} beğeni/yorum/etkileşim toplandı.`;
    }
  }

  const bars = [
    { label: "İzlenme", value: views, color: "bg-sky-500" },
    { label: "Erişim", value: reach, color: "bg-indigo-500" },
    { label: "Beğeni", value: likes, color: "bg-emerald-500" },
    { label: "Yorum", value: comments, color: "bg-amber-500" },
    { label: "Kaydetme & Paylaşım", value: savesShares, color: "bg-fuchsia-500" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Kampanya Performans Grafiği</CardTitle>
          <StatusDot tone={verdictTone}>{verdictTitle}</StatusDot>
        </div>
        <p className="text-[13px] text-fg-muted">{verdictDesc}</p>
        <div className="flex flex-col gap-3 pt-1">
          {bars.map((b) => {
            const w = b.value > 0 ? Math.max(4, Math.round((b.value / maxBar) * 100)) : 0;
            return (
              <div key={b.label} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-fg-muted">{b.label}</span>
                  <span className="font-medium tabular-nums text-fg">{num.format(b.value)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                  <div className={`h-full rounded-full ${b.color} transition-all`} style={{ width: `${w}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>Influencer Bazlı Erişim & Etkileşim</CardTitle>
          <span className="text-[12px] text-fg-passive">{influencerPerf.length} influencer</span>
        </div>
        {influencerPerf.length === 0 ? (
          <p className="text-sm text-fg-passive">Influencer yayın metrikleri geldiğinde karşılaştırma grafiği burada gösterilir.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {influencerPerf.slice(0, 6).map((inf) => {
              const w = inf.viewsOrReach > 0 ? Math.max(5, Math.round((inf.viewsOrReach / maxInf) * 100)) : 0;
              return (
                <div key={inf.name} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="truncate font-medium text-fg">{inf.name}</span>
                    <span className="shrink-0 tabular-nums text-fg-muted">
                      {fmtCompact(inf.viewsOrReach)} · {fmtCompact(inf.interactions)} etk.
                      {inf.er != null ? ` · ${pct1.format(inf.er)}` : ""}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                    <div className="h-full rounded-full bg-fg transition-all" style={{ width: `${w}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

export function CampaignAiReviewPanel({
  items,
  findings,
  totalViews,
  totalLikes,
  totalComments,
  avgEr,
  detailHrefPrefix,
}: {
  items: CampaignChartMetricRow[];
  findings: CampaignAgentFindingItem[];
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  avgEr: number | null;
  detailHrefPrefix: string;
}) {
  const compliantCount = items.filter((i) => i.complianceStatus === "UYUMLU").length;
  const topItem = [...items].sort((a, b) => b.views + b.likes * 5 - (a.views + a.likes * 5))[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Card interactive={false} className="p-4">
          <p className="text-[11px] text-fg-muted">Yayınlanan İçerik</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-fg">{items.length}</p>
        </Card>
        <Card interactive={false} className="p-4">
          <p className="text-[11px] text-fg-muted">Toplam İzlenme</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-fg">{fmtCompact(totalViews)}</p>
        </Card>
        <Card interactive={false} className="p-4">
          <p className="text-[11px] text-fg-muted">Toplam Beğeni</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-fg">{fmtCompact(totalLikes)}</p>
        </Card>
        <Card interactive={false} className="p-4">
          <p className="text-[11px] text-fg-muted">Toplam Yorum</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-fg">{fmtCompact(totalComments)}</p>
        </Card>
        <Card interactive={false} className="p-4">
          <p className="text-[11px] text-fg-muted">Ortalama ER / 23/A</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-fg">
            {avgEr != null ? pct1.format(avgEr) : "—"} · {items.length ? `${compliantCount}/${items.length}` : "—"}
          </p>
        </Card>
      </div>

      {topItem ? (
        <Card interactive={false} className="flex flex-col gap-2 border-emerald-500/30 bg-emerald-500/5">
          <CardTitle>AI Kampanya Değerlendirmesi</CardTitle>
          <p className="text-sm text-fg">
            En yüksek performansı <strong>{topItem.influencerName}</strong> ({topItem.contentLabel}) sağladı:{" "}
            {fmtCompact(topItem.views)} izlenme, {num.format(topItem.likes)} beğeni, {num.format(topItem.comments)} yorum.
          </p>
        </Card>
      ) : null}

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>Yayınlanan İçeriklerin AI & Metrik İncelemesi</CardTitle>
        {items.length === 0 ? (
          <p className="text-sm text-fg-passive">Henüz yayınlanan içerik yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[12px] text-fg-muted">
                  <th className="py-2 pr-3 font-medium">Influencer</th>
                  <th className="py-2 pr-3 font-medium">İçerik</th>
                  <th className="py-2 pr-3 text-right font-medium">İzlenme</th>
                  <th className="py-2 pr-3 text-right font-medium">Beğeni</th>
                  <th className="py-2 pr-3 text-right font-medium">Yorum</th>
                  <th className="py-2 pr-3 text-right font-medium">ER</th>
                  <th className="py-2 font-medium">23/A</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((it) => (
                  <tr key={it.id} className="hover:bg-surface-hover">
                    <td className="py-2.5 pr-3 font-medium text-fg">
                      <Link href={`${detailHrefPrefix}/${it.id}`} className="hover:underline">
                        {it.influencerName}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-fg-muted">
                      <span className="inline-flex items-center gap-1.5">
                        <PlatformIcon platform={it.platform} size={14} />
                        {it.contentLabel}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{num.format(it.views)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{num.format(it.likes)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{num.format(it.comments)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{it.er != null ? pct1.format(it.er) : "—"}</td>
                    <td className="py-2.5">
                      <StatusDot tone={it.complianceStatus === "UYUMLU" ? "active" : it.complianceStatus === "EKSIK" ? "critical" : "passive"}>
                        {it.complianceStatus === "UYUMLU" ? "Uyumlu" : it.complianceStatus === "EKSIK" ? "Eksik" : "Bekliyor"}
                      </StatusDot>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>AI Ajan İnceleme Bulguları</CardTitle>
        {findings.length === 0 ? (
          <p className="text-sm text-fg-passive">Aktif ajan uyarısı veya inceleme notu bulunmuyor.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {findings.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg">{f.title}</span>
                  <span className="text-[13px] text-fg-muted">{f.summary}</span>
                </div>
                <StatusDot tone={f.status === "ACIK" ? "critical" : "active"}>{f.status}</StatusDot>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

