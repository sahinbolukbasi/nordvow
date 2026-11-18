import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { verifyCampaignShareToken } from "@/lib/report-share";
import { evaluate23ACompliance } from "@infulancer/core/domain/compliance-23a";
import { campaignStatusLabels, contentTypeLabels, platformLabels } from "@infulancer/core/domain/labels";
import { fmtCompact, num, pct1 } from "@/lib/format";
import { fmtDate } from "@/lib/time";
import { KaynakRozeti, Uyumluluk23ARozeti } from "@/components/ui/trust-badges";

export const dynamic = "force-dynamic";

/** Girişsiz, salt okunur canlı kampanya rapor görünümü (Later Influence tarzı). */
export default async function SharedCampaignReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; bolumler?: string }>;
}) {
  const { id } = await params;
  const { t, bolumler } = await searchParams;

  if (!verifyCampaignShareToken(id, t)) {
    notFound();
  }

  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      brand: { select: { name: true } },
      assignments: {
        where: { contractStatus: { not: "RED" } },
        include: {
          influencer: { select: { id: true, name: true } },
          deliverables: {
            where: { status: { not: "IPTAL" } },
            include: { metricSnapshots: { orderBy: { measuredAt: "desc" }, take: 1 } },
          },
        },
      },
    },
  });

  if (!campaign) notFound();

  const sections = new Set((bolumler ?? "kpi,tablo,galeri,uyum").split(","));
  let totalViews = 0;
  let totalReach = 0;
  let totalInteractions = 0;
  let hasViews = false;
  let totalClicks = 0;
  let totalSales = 0;
  let publishedCount = 0;
  let compliantCount = 0;

  const infRows = campaign.assignments.map((a) => {
    let views = 0;
    let infHasViews = false;
    let reach = 0;
    let interactions = 0;
    let clicks = 0;
    let sales = 0;
    for (const d of a.deliverables) {
      if (d.publishedAt) {
        publishedCount += 1;
        if (evaluate23ACompliance({ caption: d.caption, brandName: campaign.brand.name, isPublished: true }).status === "UYUMLU") {
          compliantCount += 1;
        }
      }
      const snap = d.metricSnapshots[0];
      if (!snap) continue;
      if (snap.reach) reach += snap.reach;
      interactions += (snap.likes ?? 0) + (snap.comments ?? 0) + (snap.saves ?? 0) + (snap.shares ?? 0);
      clicks += snap.clicks ?? 0;
      sales += snap.sales ?? 0;
      const pm = snap.platformMetrics && typeof snap.platformMetrics === "object" ? (snap.platformMetrics as Record<string, unknown>) : null;
      const v = pm ? Number(pm.views ?? pm.video_views ?? pm.plays ?? NaN) : NaN;
      if (Number.isFinite(v) && v >= 0) {
        views += v;
        infHasViews = true;
      }
    }
    totalReach += reach;
    totalInteractions += interactions;
    totalClicks += clicks;
    totalSales += sales;
    if (infHasViews) {
      totalViews += views;
      hasViews = true;
    }
    const denom = infHasViews ? views : reach;
    return {
      id: a.influencer.id,
      name: a.influencer.name,
      deliverables: a.deliverables.length,
      views: infHasViews ? views : null,
      reach,
      er: denom > 0 ? interactions / denom : null,
      clicks,
      sales,
    };
  });

  const denomAll = hasViews ? totalViews : totalReach;
  const overallEr = denomAll > 0 ? totalInteractions / denomAll : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wider text-fg-passive">
            Nordvow · Salt Okunur Kampanya Raporu
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{campaign.name}</h1>
          <p className="text-sm text-fg-muted">
            {campaign.brand.name} · {campaignStatusLabels[campaign.status]} · {fmtDate(campaign.startsAt)} – {fmtDate(campaign.endsAt)}
          </p>
        </div>
        <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-fg-muted">
          Canlı veri görünümü
        </span>
      </header>

      {sections.has("kpi") ? (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">İzlenme</span>
              <KaynakRozeti source="API" />
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">{hasViews ? fmtCompact(totalViews) : "—"}</p>
            {!hasViews ? <p className="mt-0.5 text-[11px] text-fg-passive">Yayın bekleniyor</p> : null}
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">Etkileşim oranı</span>
              <KaynakRozeti source="API" />
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">{overallEr != null ? pct1.format(overallEr) : "—"}</p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">Tıklama / Satış</span>
              <KaynakRozeti source="KOD" />
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {num.format(totalClicks)} / {num.format(totalSales)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-fg-muted">Uyum (23/A)</span>
              <KaynakRozeti source="SISTEM" />
            </div>
            <p className="mt-2 text-xl font-semibold tabular-nums">
              {publishedCount > 0 ? `${compliantCount} / ${publishedCount}` : "—"}
            </p>
            {publishedCount === 0 ? <p className="mt-0.5 text-[11px] text-fg-passive">Yayın bekleniyor</p> : null}
          </div>
        </section>
      ) : null}

      {sections.has("tablo") ? (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-base font-semibold text-fg">Influencer Sonuçları</h2>
          {infRows.length === 0 ? (
            <p className="text-sm text-fg-passive">Henüz atanmış influencer yok.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs text-fg-muted">
                  <tr>
                    <th className="py-2 pr-4">Influencer</th>
                    <th className="py-2 pr-4 text-right">Teslim</th>
                    <th className="py-2 pr-4 text-right">İzlenme</th>
                    <th className="py-2 pr-4 text-right">ER</th>
                    <th className="py-2 pr-4 text-right">Tıklama</th>
                    <th className="py-2 text-right">Satış</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {infRows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2.5 pr-4 font-medium">{r.name}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{r.deliverables}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{r.views != null ? fmtCompact(r.views) : "—"}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{r.er != null ? pct1.format(r.er) : "—"}</td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">{num.format(r.clicks)}</td>
                      <td className="py-2.5 text-right tabular-nums">{num.format(r.sales)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {sections.has("uyum") ? (
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-base font-semibold text-fg">23/A Reklam İfşası Kontrolü</h2>
          <div className="flex flex-col gap-2">
            {campaign.assignments.flatMap((a) =>
              a.deliverables.map((d) => {
                const c = evaluate23ACompliance({
                  caption: d.caption,
                  brandName: campaign.brand.name,
                  isPublished: Boolean(d.publishedAt),
                });
                return (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2 text-sm">
                    <span>
                      {a.influencer.name} · {platformLabels[d.platform]} {contentTypeLabels[d.contentType]}
                    </span>
                    <Uyumluluk23ARozeti status={c.status} reason={c.reason} />
                  </div>
                );
              }),
            )}
            {campaign.assignments.every((a) => a.deliverables.length === 0) ? (
              <p className="text-sm text-fg-passive">Henüz tanımlı teslimat yok.</p>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}

