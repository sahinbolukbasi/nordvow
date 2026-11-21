import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadBrandCampaignReport } from "@infulancer/core/access/brand-report";
import { autoApproveStaleDeliverables } from "@infulancer/core/domain/deliverable-auto-approve";
import { evaluate23ACompliance } from "@infulancer/core/domain/compliance-23a";
import { isDomainError } from "@infulancer/core/domain/errors";
import {
  campaignStatusLabels,
  contentTypeLabels,
  deliverableStatusLabels,
  formatKurus,
  metricSourceLabels,
  platformLabels,
  reviewDecisionLabels,
  trustLevelLabels,
  usageChannelLabels,
} from "@infulancer/core/domain/labels";
import { DeliverableReview } from "@/components/brand/draft-review-form";
import { WeekCalendar } from "@/components/calendar/week-calendar";
import { KpiBreakdown } from "@/components/campaign/kpi-breakdown";
import { BrandCampaignActions, BrandCampaignTabs } from "@/components/campaign/brand-campaign-shell";
import { CampaignAiReviewPanel, CampaignSummaryCharts, type CampaignChartMetricRow } from "@/components/campaign/campaign-analytics-charts";
import { AssetThumb } from "@/components/files/asset-thumb";
import { ChevronLeftIcon, ChevronRightIcon, ExternalIcon, FileIcon } from "@/components/icons";
import { PlatformIcon } from "@/components/platform-icon";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonClass } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { CampaignLifecycle } from "@/components/campaign/campaign-lifecycle";
import { CampaignHub } from "@/components/campaign/campaign-hub";
import { StatusDot } from "@/components/ui/status";
import { BosDurum, KaynakRozeti, Uyumluluk23ARozeti } from "@/components/ui/trust-badges";
import { requireActor } from "@/lib/auth-guard";
import { etiketle } from "@/lib/iletisim/etiketler";
import { prisma } from "@infulancer/core/db";
import { CampaignMedia } from "@/components/campaign/campaign-media";
import { formatDualMinor } from "@infulancer/core/i18n/regions";
import { loadCampaignHubData } from "@/lib/campaign-hub-loader";
import { getCampaignShipmentsDashboard } from "@infulancer/core/shipping/service";
import { CampaignShippingDashboard } from "@/components/shipping/campaign-shipping-dashboard";
import { FileUploader } from "@/components/files/file-uploader";
import { buildCalendarRows, resolveWeek } from "@/lib/calendar";
import { fmtCompact, num, pct, pct1 } from "@/lib/format";
import { signCampaignShareToken } from "@/lib/report-share";
import { campaignTone } from "@/lib/status-tone";
import { AGENCY_TZ, fmtDate, fmtDateTime, fmtDayLabel } from "@/lib/time";

export const metadata: Metadata = { title: "Kampanya raporu" };

const BRAND_MEDIA_KINDS = [
  { value: "URUN_FOTO" as const, label: "Ürün fotoğrafı" },
  { value: "ORNEK_CEKIM" as const, label: "Örnek çekim (video/fotoğraf)" },
  { value: "MARKA_LOGO" as const, label: "Marka logosu" },
  { value: "BRIEF_PDF" as const, label: "Brief PDF" },
  { value: "DIGER" as const, label: "Diğer" },
];

export default async function BrandCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ hafta?: string | string[]; gonderildi?: string }>;
}) {
  const tt = await getTT();
  const actor = await requireActor("BRAND");
  const { id } = await params;
  const { hafta, gonderildi } = await searchParams;
  const now = new Date();
  await autoApproveStaleDeliverables(now).catch(() => 0);

  const report = await loadBrandCampaignReport(actor, id, now).catch((err: unknown) => {
    if (isDomainError(err) && (err.code === "BULUNAMADI" || err.code === "YETKISIZ")) notFound();
    throw err;
  });
  const { campaign, score } = report;
  const media = await prisma.asset.findMany({
    where: { campaignId: campaign.id, uploadStatus: "TAMAM" },
    orderBy: { createdAt: "desc" },
    include: { uploadedBy: { select: { name: true } } },
  });
  const draft = campaign.status === "TASLAK";
  const [meta, hubData, shippingDash, brandCoupons, agentRuns, latestSnapshots] = await Promise.all([
    prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
      select: { currency: true, executionMode: true, objective: true, brand: { select: { defaultExecutionMode: true } } },
    }),
    loadCampaignHubData(campaign.id),
    getCampaignShipmentsDashboard(campaign.id),
    actor.brandId
      ? prisma.coupon.findMany({
        where: { tenantId: actor.brandId },
        orderBy: { createdAt: "desc" },
        take: 20,
        include: { grants: { select: { id: true, status: true, influencerId: true } } },
      })
      : Promise.resolve([]),
    prisma.agentRun.findMany({
      where: {
        OR: [
          { targetType: "Campaign", targetId: campaign.id },
          { targetType: "Deliverable", targetId: { in: report.deliverables.map((d) => d.id) } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.deliverable.findMany({
      where: { id: { in: report.deliverables.map((d) => d.id) } },
      select: {
        id: true,
        metricSnapshots: {
          orderBy: { measuredAt: "desc" },
          take: 1,
          select: { impressions: true, reach: true, likes: true, comments: true, shares: true, saves: true },
        },
      },
    }),
  ]);
  const snapByDeliv = new Map(latestSnapshots.map((d) => [d.id, d.metricSnapshots[0] ?? null]));
  let sumLikes = 0;
  let sumComments = 0;
  let sumSavesShares = 0;
  const chartMetricRows: CampaignChartMetricRow[] = report.gallery.map(({ deliverable: d, views, reach, compliance23A }) => {
    const snap = snapByDeliv.get(d.id);
    const v = views ?? snap?.impressions ?? 0;
    const rc = reach ?? snap?.reach ?? 0;
    const lk = snap?.likes ?? 0;
    const cm = snap?.comments ?? 0;
    const ss = (snap?.shares ?? 0) + (snap?.saves ?? 0);
    sumLikes += lk;
    sumComments += cm;
    sumSavesShares += ss;
    const denom = v > 0 ? v : rc;
    return {
      id: d.id,
      influencerName: d.influencer.name,
      platform: d.platform,
      contentLabel: `${platformLabels[d.platform]} ${contentTypeLabels[d.contentType]}`,
      views: v,
      reach: rc,
      likes: lk,
      comments: cm,
      savesShares: ss,
      er: denom > 0 && lk + cm + ss > 0 ? (lk + cm + ss) / denom : null,
      postUrl: d.postUrl ?? null,
      complianceStatus: compliance23A.status === "UYUMLU" ? "UYUMLU" : compliance23A.status === "EKSIK" ? "EKSIK" : "BEKLIYOR",
    };
  });
  const infPerfList = report.influencers.map((inf) => ({
    name: inf.name,
    viewsOrReach: inf.views || inf.reach,
    interactions: inf.interactions,
    publishedCount: report.gallery.filter((g) => g.deliverable.influencer.id === inf.influencerId).length,
    er: inf.er,
  }));
  const currency = meta.currency;
  const effectiveMode = meta.brand.defaultExecutionMode ?? meta.executionMode;
  const isSelfManaged = effectiveMode === "SELF";

  // Finansal özet: Ödenen / Taahhüt / Bütçe ayrımı
  const paidKurus = campaign.paidKurus;
  const committedKurus = hubData.rows
    .filter((r) => r.statusCategory === "KABUL" || r.statusCategory === "BEKLIYOR" || r.statusCategory === "REVIZE")
    .reduce((sum, r) => sum + r.feeMinor, 0);
  const budgetKurus = campaign.budgetKurus;
  const budgetRatio = budgetKurus > 0 ? Math.min(1, committedKurus / budgetKurus) : 0;

  // KPI hesapları (veri yoksa sahte 0 yerine null / boş durum)
  const totalViews = report.totals.hasViewsData ? report.totals.views : null;
  const erDenom = report.totals.hasViewsData ? report.totals.views : report.totals.impressions || report.totals.reach;
  const campaignEr = erDenom > 0 && report.totals.interactions > 0 ? report.totals.interactions / erDenom : null;
  const cpvKurus = paidKurus > 0 && totalViews && totalViews > 0 ? paidKurus / totalViews : null;

  const publishedCount = report.gallery.length;
  const compliantCount = report.gallery.filter((g) => g.compliance23A.status === "UYUMLU").length;
  const missing23ACount = report.gallery.filter(
    (g) => g.compliance23A.status === "EKSIK" || g.compliance23A.status === "SUPHELI",
  ).length;
  const hasSalesIntegration =
    report.totals.sales > 0 || report.totals.clicks > 0 || report.totals.revenueKurus > 0 || brandCoupons.length > 0;

  // Operasyonel olaylar & 3 cümlelik dürüst kural özeti
  const waitingOffers = hubData.rows.filter((r) => r.statusCategory === "BEKLIYOR").length;
  const acceptedRows = hubData.rows.filter((r) => r.statusCategory === "KABUL");
  const lateDeliverables = report.deliverables.filter(
    (d) => !d.publishedAt && d.plannedAt < now && d.status !== "IPTAL",
  );

  const summarySentences: string[] = [];
  if (publishedCount === 0) {
    summarySentences.push(tt("Henüz yayınlanmış içerik yok; izlenme ve etkileşim ölçülemiyor."));
  } else {
    const viewPart = totalViews != null ? `${fmtCompact(totalViews)} izlenme` : `${fmtCompact(report.totals.reach)} erişim`;
    summarySentences.push(
      `${publishedCount} içerik yayında (${viewPart}${campaignEr != null ? `, ER ${pct1.format(campaignEr)}` : ""}).`,
    );
  }
  if (waitingOffers > 0 || acceptedRows.length > 0) {
    const opsParts: string[] = [];
    if (waitingOffers > 0) opsParts.push(`${waitingOffers} teklif yanıt bekliyor`);
    if (acceptedRows.length > 0) {
      const noTasks = acceptedRows.filter((r) => r.deliverablesTotal === 0).length;
      opsParts.push(
        noTasks > 0
          ? `${acceptedRows.length} kabul edilen iş birliğinin ${noTasks} tanesinde görev tanımlı değil`
          : `${acceptedRows.length} kabul edilen iş birliği aktif`,
      );
    }
    summarySentences.push(`${opsParts.join("; ")}.`);
  }
  if (lateDeliverables.length > 0 || missing23ACount > 0) {
    const warnParts: string[] = [];
    if (lateDeliverables.length > 0) warnParts.push(`${lateDeliverables.length} teslim tarihi gecikti`);
    if (missing23ACount > 0) warnParts.push(`${missing23ACount} yayında 23/A reklam ibaresi eksik veya şüpheli`);
    summarySentences.push(`${warnParts.join(", ")}.`);
  }

  // Uyarı şeridi (yalnız gerçek olaylar, en fazla 3)
  const alerts: { tone: "critical" | "warn"; text: string }[] = [];
  if (missing23ACount > 0) {
    alerts.push({ tone: "critical", text: `${missing23ACount} yayında md. 23/A reklam ifşası eksik veya yanlış konumda.` });
  }
  if (lateDeliverables.length > 0) {
    alerts.push({ tone: "warn", text: `${lateDeliverables.length} teslimat planlanan yayın tarihini geçti.` });
  }
  if (budgetKurus > 0 && committedKurus > budgetKurus) {
    alerts.push({
      tone: "warn",
      text: `Toplam taahhüt (${formatKurus(committedKurus)}) belirlenen bütçeyi (${formatKurus(budgetKurus)}) aşıyor.`,
    });
  }

  // Paylaşılabilir salt okunur link (30 gün geçerli)
  const shareToken = signCampaignShareToken(campaign.id, now.getTime() + 30 * 86_400_000);
  const shareUrlBase = `/rapor/kampanya/${campaign.id}?t=${encodeURIComponent(shareToken)}`;

  // Sekme içerikleri
  const inRange = now >= campaign.startsAt && now <= campaign.endsAt;
  const week = { ...resolveWeek(hafta, inRange ? now : campaign.startsAt), today: resolveWeek(undefined, now).today };
  const base = `/marka/kampanyalar/${campaign.id}`;
  const rows = buildCalendarRows(
    week.days,
    report.deliverables.map((d) => ({
      ...d,
      contractViolation: false,
      campaignName: campaign.name,
      influencer: { id: d.influencer.id, name: d.influencer.name, audienceTimezone: AGENCY_TZ },
    })),
    (did) => `${base}?hafta=${week.monday}#is-${did}`,
  );

  // Zaman çizelgesi düğümleri
  const hasShipments = shippingDash.shipments.length > 0;
  const anyDelivered = shippingDash.shipments.some((s) => Boolean(s.deliveredAt));
  const anyDraft = report.pendingDrafts.length > 0 || report.deliverables.some((d) => d.status === "ONAYLANDI" || d.publishedAt);
  const timelineNodes = [
    { label: "Başlangıç", date: fmtDate(campaign.startsAt), done: now >= campaign.startsAt, late: false },
    ...(hasShipments
      ? [{ label: "Ürün sevkiyatı", date: `${shippingDash.shipments.length} kargo`, done: anyDelivered, late: false }]
      : []),
    {
      label: "İçerik teslimi",
      date: report.deliverables.length ? `${report.deliverables.length} görev` : "Görev yok",
      done: anyDraft,
      late: lateDeliverables.length > 0,
    },
    {
      label: "Yayın",
      date: publishedCount > 0 ? `${publishedCount} yayında` : "Bekleniyor",
      done: publishedCount > 0,
      late: false,
    },
    { label: "Bitiş", date: fmtDate(campaign.endsAt), done: now > campaign.endsAt, late: false },
  ];

  const ozetTab = (
    <div className="flex flex-col gap-6">
      {/* Bu kampanyada ne oluyor? */}
      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>{tt("Bu kampanyada ne oluyor?")}</CardTitle>
        <p className="text-sm leading-relaxed text-fg">{summarySentences.join(" ")}</p>
        {alerts.length > 0 ? (
          <ul className="flex flex-col gap-1.5 border-t border-border pt-3">
            {alerts.slice(0, 3).map((a, i) => (
              <li
                key={i}
                className={
                  a.tone === "critical"
                    ? "rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[13px] text-rose-700 dark:text-rose-300"
                    : "rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-700 dark:text-amber-300"
                }
              >
                ⚠ {a.text}
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {/* Zaman Çizelgesi */}
      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Kampanya zaman çizelgesi")}</CardTitle>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          {timelineNodes.map((n) => (
            <li
              key={n.label}
              className={`flex flex-col gap-1 rounded-2xl border p-3 ${n.late
                  ? "border-rose-500/40 bg-rose-500/5"
                  : n.done
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-border bg-bg/40"
                }`}
            >
              <span className="text-[11px] font-medium text-fg-muted">{tt(n.label)}</span>
              <span className="text-sm font-semibold text-fg tabular-nums">{n.date}</span>
              <span className="text-[11px] text-fg-passive">
                {n.late ? tt("Gecikti") : n.done ? tt("Tamam") : tt("Bekleniyor")}
              </span>
            </li>
          ))}
        </ol>
      </Card>

      {/* Performans & Dağılım Grafikleri */}
      <CampaignSummaryCharts
        views={totalViews ?? 0}
        reach={report.totals.reach}
        likes={sumLikes}
        comments={sumComments}
        savesShares={sumSavesShares}
        publishedCount={publishedCount}
        plannedCount={report.deliverables.length}
        er={campaignEr}
        influencerPerf={infPerfList}
      />

      {/* Hedefler (varsa) */}
      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Kampanya hedefleri")}</CardTitle>
        <KpiBreakdown score={score} large />
      </Card>

      {/* Ajans özeti ve yönetim tercihi (daraltılmış) */}
      <div className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center">
        <div className="flex flex-col gap-1">
          <span className="text-[14px] font-semibold text-fg">
            {isSelfManaged ? tt("Yönetim: Marka Yönetimi") : tt("Yönetim: Ajans Yönetimi")}
          </span>
          <span className="text-[13px] text-fg-muted">
            {isSelfManaged
              ? tt("Teklifleri, görev atamalarını ve Story/içerik takiplerini doğrudan yönetebilirsiniz.")
              : tt("Süreç ajans ekibi tarafından yürütülüyor; canlı durumu buradan izleyebilirsiniz.")}
          </span>
          {campaign.reportSummary ? (
            <p className="mt-1 text-sm whitespace-pre-line text-fg">{campaign.reportSummary}</p>
          ) : null}
        </div>
        <Link href="/profil" className={buttonClass("secondary", "sm")}>
          {tt("Yönetim Tercihi")}
        </Link>
      </div>
    </div>
  );

  // Birleşik Influencer Sonuç Tablosu (kabul edilenler + deliverable'lar; teslim yoksa "Yayın bekleniyor")
  const perfByInfluencer = new Map(report.influencers.map((r) => [r.influencerId, r]));
  const combinedInfluencerRows = hubData.rows
    .filter((r) => r.statusCategory !== "RED")
    .reduce<
      {
        influencerId: string;
        name: string;
        handle: string | null;
        statusLabel: string;
        deliverablesTotal: number;
        deliverablesDone: number;
        views: number | null;
        er: number | null;
        feeMinor: number;
        feeCurrency: string;
        cpvMinor: number | null;
        sales: number;
        complianceStatus: "UYUMLU" | "EKSIK" | "SUPHELI" | "BEKLIYOR";
        onTimeText: string;
        onTimeSort: number | null;
      }[]
    >((acc, r) => {
      if (acc.some((x) => x.influencerId === r.influencerId)) return acc;
      const perf = perfByInfluencer.get(r.influencerId);
      const views = perf?.views ?? null;
      const cpvMinor = views && views > 0 && r.feeMinor > 0 ? r.feeMinor / views : null;
      acc.push({
        influencerId: r.influencerId,
        name: r.influencerName,
        handle: r.influencerHandle,
        statusLabel: r.statusLabel,
        deliverablesTotal: Math.max(r.deliverablesTotal, perf?.deliverableCount ?? 0),
        deliverablesDone: Math.max(r.deliverablesDone, perf?.publishedCount ?? 0),
        views,
        er: perf?.er ?? null,
        feeMinor: r.feeMinor,
        feeCurrency: r.feeCurrency,
        cpvMinor,
        sales: perf?.sales ?? 0,
        complianceStatus: perf?.complianceStatus ?? "BEKLIYOR",
        onTimeText:
          perf?.onTimeRate != null
            ? `${pct.format(perf.onTimeRate)} (${perf.onTimeCount}/${perf.publishedCount})`
            : perf && perf.deliverableCount > 0
              ? tt("Yayın bekleniyor")
              : "—",
        onTimeSort: perf?.onTimeRate ?? null,
      });
      return acc;
    }, []);

  const influencerlarTab = (
    <div className="flex flex-col gap-6">
      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Influencer sonuç tablosu")}</CardTitle>
        <DataTable
          caption={tt("Influencer sonuçları")}
          emptyText={tt("Bu kampanyada henüz teklif veya atanmış influencer yok.")}
          initialSort={{ key: "views", dir: "desc" }}
          columns={[
            { key: "name", header: "Influencer", sortable: true },
            { key: "status", header: "Durum", sortable: true },
            { key: "deliverables", header: "Teslim", align: "right", sortable: true },
            { key: "views", header: "İzlenme", align: "right", sortable: true },
            { key: "er", header: "ER", align: "right", sortable: true },
            { key: "cost", header: "Taahhüt", align: "right", sortable: true },
            { key: "cpv", header: "CPV", align: "right", sortable: true },
            ...(hasSalesIntegration ? [{ key: "sales", header: "Satış", align: "right" as const, sortable: true }] : []),
            { key: "compliance", header: "23/A" },
            { key: "onTime", header: "Zamanında", align: "right", sortable: true },
          ]}
          rows={combinedInfluencerRows.map((r) => ({
            id: r.influencerId,
            cells: {
              name: {
                display: (
                  <Link href={`/marka/kesfet/${r.influencerId}`} className="flex flex-col hover:underline">
                    <span className="font-medium text-fg">{r.name}</span>
                    <span className="text-[12px] text-fg-passive">{r.handle ? `@${r.handle.replace(/^@/, "")}` : "—"}</span>
                  </Link>
                ),
                sort: r.name,
              },
              status: { display: r.statusLabel, sort: r.statusLabel },
              deliverables: {
                display: `${r.deliverablesDone} / ${r.deliverablesTotal}`,
                sort: r.deliverablesTotal,
              },
              views: { display: r.views != null ? fmtCompact(r.views) : "—", sort: r.views },
              er: { display: r.er != null ? pct1.format(r.er) : "—", sort: r.er },
              cost: {
                display: r.feeMinor > 0 ? formatDualMinor(r.feeMinor, r.feeCurrency, { fx: hubData.fx }) : "—",
                sort: r.feeMinor,
              },
              cpv: { display: r.cpvMinor != null ? formatKurus(Math.round(r.cpvMinor)) : "—", sort: r.cpvMinor },
              ...(hasSalesIntegration
                ? { sales: { display: num.format(r.sales), sort: r.sales } }
                : {}),
              compliance: <Uyumluluk23ARozeti status={r.complianceStatus} />,
              onTime: { display: r.onTimeText, sort: r.onTimeSort },
            },
          }))}
        />
      </Card>

      <CampaignHub
        campaignId={campaign.id}
        campaignName={campaign.name}
        campaignCurrency={currency}
        viewerRole="BRAND"
        canManage={isSelfManaged}
        executionMode={effectiveMode}
        fx={hubData.fx}
        rows={hubData.rows}
        archivedKeys={hubData.archivedKeys}
        messages={hubData.messages}
        storyRows={hubData.storyRows}
      />
    </div>
  );

  const iceriklerTab = (
    <div className="flex flex-col gap-6">
      <Card interactive={false} className="flex flex-col gap-4" id="taslaklar">
        <CardTitle>{tt("Onayınızı bekleyen taslaklar")}</CardTitle>
        {report.pendingDrafts.length === 0 ? (
          <p className="text-sm text-fg-passive">{tt("Görüş bekleyen taslak yok.")}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {report.pendingDrafts.map(({ deliverable: d, assets, reviews }) => (
              <li key={d.id} id={`is-${d.id}`} className="grid grid-cols-1 gap-4 py-5 first:pt-0 lg:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="flex items-center gap-2 text-sm text-fg">
                    <PlatformIcon platform={d.platform} size={16} title={platformLabels[d.platform]} />
                    {d.influencer.name} · {contentTypeLabels[d.contentType]}
                  </span>
                  <span className="text-[13px] text-fg-muted tabular-nums">
                    {tt("Paylaşım")} {fmtDateTime(d.plannedAt)} {tt("· onay son tarihi")} {fmtDateTime(d.approvalDeadline)}
                  </span>
                  {d.caption ? <p className="text-[13px] leading-relaxed whitespace-pre-line text-fg-muted">{d.caption}</p> : null}
                  {assets.length ? (
                    <ul className="flex flex-col gap-1">
                      {assets.map((a) => (
                        <li key={a.id}>
                          <a
                            href={`/api/assets/${a.id}/download`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-[13px] text-fg-muted hover:text-fg"
                          >
                            <FileIcon size={14} /> {a.fileName} {tt("önizle")}
                            <span className="sr-only">{tt("(yeni sekmede açılır)")}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-fg-passive">{tt("Önizlenecek dosya yok.")}</p>
                  )}
                  {reviews.length ? (
                    <ul className="flex flex-col gap-1 border-t border-border pt-2 text-[13px] text-fg-passive">
                      {reviews.slice(0, 3).map((r) => (
                        <li key={r.createdAt.toISOString()}>
                          {reviewDecisionLabels[r.decision]} · {r.byName} · {fmtDateTime(r.createdAt)}
                          {r.note ? ` — ${r.note}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <DeliverableReview deliverableId={d.id} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("İçerik galerisi")}</CardTitle>
        {report.gallery.length === 0 ? (
          <p className="text-sm text-fg-passive">{tt("Henüz yayınlanmış içerik yok.")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {report.gallery.map(({ deliverable: d, thumbAssetId, usage, reach, views, compliance23A }) => (
              <li key={d.id} id={`is-${d.id}`} className="overflow-hidden rounded-[8px] border border-border bg-surface transition-standard hover:border-border-strong">
                <AssetThumb assetId={thumbAssetId} platform={d.platform} alt={`${d.influencer.name} ${contentTypeLabels[d.contentType]}`} />
                <div className="flex flex-col gap-1.5 p-3 text-[12px]">
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-medium text-fg">{d.influencer.name}</span>
                    <Uyumluluk23ARozeti status={compliance23A.status} reason={compliance23A.reason} />
                  </div>
                  <span className="flex items-center gap-1 text-fg-passive">
                    <PlatformIcon platform={d.platform} size={12} /> {contentTypeLabels[d.contentType]} · {deliverableStatusLabels[d.status]}
                  </span>
                  {views != null ? (
                    <span className="text-fg-muted tabular-nums">{fmtCompact(views)} {tt("izlenme")}</span>
                  ) : reach != null ? (
                    <span className="text-fg-muted tabular-nums">{fmtCompact(reach)} {tt("erişim")}</span>
                  ) : null}
                  {usage ? (
                    <span className="w-fit rounded-[6px] border border-border px-2 py-0.5 text-fg-muted">
                      {usage.channel ? usageChannelLabels[usage.channel] : tt("Kullanım hakkı")}
                    </span>
                  ) : null}
                  {d.postUrl ? (
                    <a href={d.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-fg-muted hover:text-fg">
                      {tt("Paylaşımı aç")} <ExternalIcon size={12} />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card interactive={false} className="flex flex-col gap-4" id="medya">
        <CardTitle>{tt("Kampanya fotoğraf ve videoları")}</CardTitle>
        <CampaignMedia
          items={media.map((a) => ({ id: a.id, fileName: a.fileName, mime: a.mime, kind: a.kind, size: a.size, uploadedById: a.uploadedById, uploadedByName: a.uploadedBy.name }))}
          canDelete={(m) => m.uploadedById === actor.userId && campaign.status !== "KAPANDI"}
        />
        {campaign.status !== "KAPANDI" && campaign.status !== "IPTAL" ? (
          <FileUploader
            target={{ type: "campaign", id: campaign.id }}
            multiple
            label={tt("Fotoğraf veya video ekle")}
            hint={tt("Ürün görselleri, örnek çekimler, logo veya brief PDF. Atanan influencerlar görür.")}
            accept="image/*,video/*,application/pdf"
            kinds={BRAND_MEDIA_KINDS}
          />
        ) : null}
      </Card>
    </div>
  );

  const satisTab = (
    <Card interactive={false} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>{tt("Satış, kuponlar ve UTM bağlantıları")}</CardTitle>
        <Link href="/marka/kuponlar" className={buttonClass("secondary", "sm")}>
          {tt("Kuponları Yönet →")}
        </Link>
      </div>
      {brandCoupons.length === 0 && report.totals.clicks === 0 && report.totals.sales === 0 ? (
        <EmptyState
          message={tt("Kupon veya UTM bağlayın; tıklama, sipariş ve ciro burada görünür.")}
          action={{ label: tt("Kupon Oluştur"), href: "/marka/kuponlar" }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl border border-border bg-bg/40 p-3">
              <span className="text-xs text-fg-muted">{tt("Tıklama")}</span>
              <p className="mt-1 text-lg font-semibold tabular-nums">{num.format(report.totals.clicks)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-bg/40 p-3">
              <span className="text-xs text-fg-muted">{tt("Sipariş / Satış")}</span>
              <p className="mt-1 text-lg font-semibold tabular-nums">{num.format(report.totals.sales)}</p>
            </div>
            <div className="rounded-2xl border border-border bg-bg/40 p-3">
              <span className="text-xs text-fg-muted">{tt("Net Ciro")}</span>
              <p className="mt-1 text-lg font-semibold tabular-nums">{formatKurus(report.totals.revenueKurus)}</p>
            </div>
          </div>
          {brandCoupons.length > 0 ? (
            <ul className="divide-y divide-border rounded-2xl border border-border">
              {brandCoupons.map((c) => {
                const used = c.grants.filter((g) => g.status === "KULLANILDI").length;
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="flex flex-col">
                      <span className="font-medium text-fg">{c.title}</span>
                      <span className="text-xs text-fg-muted">
                        {c.sharedCode ? `Kod: ${c.sharedCode}` : tt("Kişiye özel kodlar")} · {c.grants.length} {tt("gönderim")}
                      </span>
                    </div>
                    <span className="text-xs text-fg-muted tabular-nums">{used} {tt("kullanım")}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      )}
    </Card>
  );

  const teslimatTab = (
    <div className="flex flex-col gap-6">
      {shippingDash.config.requiresProductShipment || shippingDash.shipments.length > 0 || meta.objective === "urun_gonderimi" ? (
        <section className="flex flex-col gap-3" id="kargo">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-section">{tt("Kargo & Lojistik Yönetimi")}</h2>
            <Link href="/profil?sekme=kargo" className={buttonClass("ghost", "sm")}>
              {tt("Gönderici Adresi & Kargo Özeti")}
            </Link>
          </div>
          <CampaignShippingDashboard
            shippingMode={shippingDash.config.shippingMode}
            kpi={shippingDash.kpi}
            shipments={shippingDash.shipments.map((s) => ({
              id: s.id,
              collaborationId: s.collaborationId,
              influencerId: s.influencerId,
              influencerName: s.influencer.name,
              influencerCity: s.influencer.city,
              recipientName: s.recipientName,
              recipientPhone: s.recipientPhone,
              shippingAddress: s.shippingAddress as {
                addressLine?: string;
                city?: string;
                district?: string;
                postalCode?: string | null;
              } | null,
              selectedVariant: s.selectedVariant as Record<string, string> | null,
              provider: s.provider,
              carrierName: s.carrierName,
              trackingNumber: s.trackingNumber,
              trackingUrl: s.trackingUrl,
              barcodeLabelUrl: s.barcodeLabelUrl,
              status: s.status,
              estimatedDeliveryDate: s.estimatedDeliveryDate?.toISOString() ?? null,
              deliveredAt: s.deliveredAt?.toISOString() ?? null,
            }))}
            integrations={shippingDash.integrations}
          />
        </section>
      ) : (
        <EmptyState message={tt("Bu kampanya için ürün kargosu bulunmuyor.")} />
      )}
    </div>
  );

  const takvimTab = (
    <div className="flex flex-col gap-6">
      {report.deliverables.length === 0 ? (
        <EmptyState message={tt("Bu kampanyada henüz planlanmış içerik yok.")} />
      ) : (
        <Card interactive={false} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <CardTitle>{tt("Yayın takvimi")}</CardTitle>
            <nav aria-label={tt("Hafta")} className="flex items-center gap-2 text-[13px] text-fg-muted">
              <Link href={`${base}?hafta=${week.prev}`} className={buttonClass("ghost", "sm")} aria-label={tt("Önceki hafta")}>
                <ChevronLeftIcon size={16} />
              </Link>
              <span className="tabular-nums">
                {fmtDayLabel(week.days[0]!)} – {fmtDayLabel(week.days[6]!)}
              </span>
              <Link href={`${base}?hafta=${week.next}`} className={buttonClass("ghost", "sm")} aria-label={tt("Sonraki hafta")}>
                <ChevronRightIcon size={16} />
              </Link>
            </nav>
          </div>
          <WeekCalendar days={week.days} rows={rows} today={week.today} emptyText={tt("Bu hafta planlanmış paylaşım yok.")} />
          <p className="text-[12px] text-fg-passive">{tt("Saatler İstanbul saatine göredir.")}</p>
        </Card>
      )}
    </div>
  );

  const aiRaporTab = (
    <CampaignAiReviewPanel
      items={chartMetricRows}
      findings={agentRuns.map((r) => ({
        id: r.id,
        title: etiketle(r.checkType, r.checkType),
        severity: r.severity,
        status: r.status,
        summary: r.summary,
      }))}
      totalViews={totalViews ?? 0}
      totalLikes={sumLikes}
      totalComments={sumComments}
      avgEr={campaignEr}
      detailHrefPrefix="/marka/kampanyalar"
    />
  );

  const uyumTab = (
    <div className="flex flex-col gap-6">
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>{tt("2026 Yönetmelik md. 23/A Reklam İfşası Kontrolü")}</CardTitle>
            <p className="text-[13px] text-fg-muted">
              {tt("'Reklam' veya 'Tanıtım' ibaresi marka adıyla birlikte, diğer etiketlerden önce yer almalıdır. Yalnız #işbirliği yetersizdir.")}
            </p>
          </div>
          <KaynakRozeti source="SISTEM" />
        </div>
        {report.gallery.length === 0 ? (
          <p className="text-sm text-fg-passive">{tt("Yayınlanmış içerik geldiğinde 23/A uyum kontrolü burada listelenir.")}</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {report.gallery.map(({ deliverable: d, compliance23A }) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-fg">
                    {d.influencer.name} · {platformLabels[d.platform]} {contentTypeLabels[d.contentType]}
                  </span>
                  <span className="text-xs text-fg-muted">{compliance23A.reason}</span>
                </div>
                <Uyumluluk23ARozeti status={compliance23A.status} reason={compliance23A.reason} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Metrik kaynakları ve güven düzeyi")}</CardTitle>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {report.trust.map((t) => (
            <li key={t.source} className="flex flex-col gap-1 rounded-[8px] border border-border px-4 py-3">
              <StatusDot tone={t.level === "YUKSEK" ? "active" : t.level === "ORTA" ? "muted" : "passive"}>
                {metricSourceLabels[t.source]}
              </StatusDot>
              <span className="text-[13px] text-fg-passive">
                {trustLevelLabels[t.level]} · {num.format(t.count)} {tt("ölçüm")}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={campaign.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-3">
            <StatusDot tone={campaignTone(campaign.status)}>{campaignStatusLabels[campaign.status]}</StatusDot>
            <span>{campaign.brandName}</span>
            <span className="tabular-nums text-fg-passive">
              {fmtDate(campaign.startsAt)} – {fmtDate(campaign.endsAt)}
            </span>
          </span>
        }
        actions={
          <BrandCampaignActions
            campaignId={campaign.id}
            campaignName={campaign.name}
            basePath={base}
            shareUrlBase={shareUrlBase}
            isSelfManaged={isSelfManaged}
            isClosed={campaign.status === "KAPANDI" || campaign.status === "IPTAL"}
            isDraft={draft}
          />
        }
      />

      {/* Bütçe Çubuğu: Ödenen / Taahhüt / Bütçe */}
      <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm tabular-nums">
          <div className="flex flex-wrap items-center gap-4">
            <span>
              <span className="text-fg-muted">{tt("Ödenen:")} </span>
              <strong className="text-fg">{formatDualMinor(paidKurus, currency, { fx: hubData.fx })}</strong>
            </span>
            <span>
              <span className="text-fg-muted">{tt("Taahhüt:")} </span>
              <strong className="text-fg">{formatDualMinor(committedKurus, currency, { fx: hubData.fx })}</strong>
            </span>
            <span>
              <span className="text-fg-muted">{tt("Bütçe:")} </span>
              <strong className="text-fg">
                {budgetKurus > 0 ? formatDualMinor(budgetKurus, currency, { fx: hubData.fx }) : tt("Belirtilmedi")}
              </strong>
            </span>
          </div>
          {budgetKurus > 0 ? (
            <span className="text-xs text-fg-passive">{pct.format(budgetRatio)} {tt("kullanım")}</span>
          ) : null}
        </div>
        {budgetKurus > 0 ? (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-fg transition-all" style={{ width: `${Math.round(budgetRatio * 100)}%` }} />
          </div>
        ) : null}
      </div>

      {gonderildi ? (
        <p role="status" className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-[14px] text-emerald-700 dark:text-emerald-400">
          {tt("Kampanya kaydedildi, aktif duruma alındı ve seçilen influencerlara teklifler iletildi.")}
        </p>
      ) : null}

      {/* Altı KPI Kartı (Satış yoksa 5. kart gizli) */}
      <section aria-label={tt("Kampanya temel metrikleri")} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* 1. İzlenme */}
        <Card interactive={false} className="flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium text-fg-muted">{tt("İzlenme")}</span>
            <KaynakRozeti source="API" />
          </div>
          {totalViews != null ? (
            <div>
              <p className="text-xl font-semibold tabular-nums text-fg">{fmtCompact(totalViews)}</p>
              {report.totals.reach > 0 ? (
                <p className="text-[11px] text-fg-passive tabular-nums">{tt("Erişim:")} {fmtCompact(report.totals.reach)}</p>
              ) : null}
            </div>
          ) : (
            <BosDurum
              neden={publishedCount === 0 ? tt("İçerik yayına girince dolacak.") : tt("Hesap bağlanınca görünür.")}
              alt={report.totals.reach > 0 ? `${tt("Erişim:")} ${fmtCompact(report.totals.reach)}` : undefined}
            />
          )}
        </Card>

        {/* 2. Etkileşim oranı */}
        <Card
          interactive={false}
          className="flex flex-col justify-between gap-2 p-4"
          title={tt("Formül: (beğeni + yorum + paylaşım + kaydetme) / izlenme veya erişim × 100. Keşif ER'si takipçiye bölünür; bu kart kampanya gösterimine bölünür.")}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium text-fg-muted">{tt("Etkileşim oranı")}</span>
            <KaynakRozeti source="API" />
          </div>
          {campaignEr != null ? (
            <div>
              <p className="text-xl font-semibold tabular-nums text-fg">{pct1.format(campaignEr)}</p>
              <p className="text-[11px] text-fg-passive">{tt("Kampanya bazlı ER")}</p>
            </div>
          ) : (
            <BosDurum neden={publishedCount === 0 ? tt("Yayın bekleniyor.") : tt("Ölçüm bekleniyor.")} />
          )}
        </Card>

        {/* 3. Harcama */}
        <Card interactive={false} className="flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium text-fg-muted">{tt("Harcama")}</span>
            <KaynakRozeti source="MARKA" />
          </div>
          <div>
            <p className="text-xl font-semibold tabular-nums text-fg">{formatKurus(paidKurus)}</p>
            <p className="text-[11px] text-fg-passive tabular-nums">
              {tt("Taahhüt:")} {formatDualMinor(committedKurus, currency, { fx: hubData.fx })}
            </p>
          </div>
        </Card>

        {/* 4. İzlenme başı maliyet (CPV) */}
        <Card interactive={false} className="flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium text-fg-muted">{tt("İzlenme başı mal.")}</span>
            <KaynakRozeti source="API" tooltip={tt("Harcama (Marka) / İzlenme (API)")} />
          </div>
          {cpvKurus != null ? (
            <div>
              <p className="text-xl font-semibold tabular-nums text-fg">{formatKurus(Math.round(cpvKurus))}</p>
              <p className="text-[11px] text-fg-passive">CPV</p>
            </div>
          ) : (
            <BosDurum neden={tt("Ücret veya izlenme girilince hesaplanır.")} />
          )}
        </Card>

        {/* 5. Satış (entegrasyon/veri yoksa gizli) */}
        {hasSalesIntegration ? (
          <Card interactive={false} className="flex flex-col justify-between gap-2 p-4">
            <div className="flex items-center justify-between gap-1">
              <span className="text-xs font-medium text-fg-muted">{tt("Satış")}</span>
              <KaynakRozeti source="KOD" />
            </div>
            <div>
              <p className="text-xl font-semibold tabular-nums text-fg">{formatKurus(report.totals.revenueKurus)}</p>
              <p className="text-[11px] text-fg-passive tabular-nums">
                {report.totals.sales > 0 ? `${num.format(report.totals.sales)} ${tt("sipariş")}` : tt("Kod henüz kullanılmadı.")}
              </p>
            </div>
          </Card>
        ) : null}

        {/* 6. Uyum (23/A) */}
        <Card interactive={false} className="flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center justify-between gap-1">
            <span className="text-xs font-medium text-fg-muted">{tt("Uyum 23/A")}</span>
            <KaynakRozeti source="SISTEM" />
          </div>
          {publishedCount > 0 ? (
            <div>
              <p className={`text-xl font-semibold tabular-nums ${missing23ACount > 0 ? "text-critical" : "text-fg"}`}>
                {compliantCount} / {publishedCount}
              </p>
              <p className="text-[11px] text-fg-passive">
                {missing23ACount > 0 ? `${missing23ACount} ${tt("eksik/şüpheli")}` : tt("Tüm yayınlar uyumlu")}
              </p>
            </div>
          ) : (
            <BosDurum neden={tt("Yayın bekleniyor.")} />
          )}
        </Card>
      </section>

      <CampaignLifecycle campaignId={campaign.id} />

      <BrandCampaignTabs
        badges={{
          influencerlar: combinedInfluencerRows.length,
          icerikler: report.pendingDrafts.length + report.gallery.length,
          takvim: report.deliverables.length,
          ai_rapor: agentRuns.filter((r) => r.status === "ACIK").length,
          uyum: missing23ACount,
        }}
        ozet={ozetTab}
        influencerlar={influencerlarTab}
        icerikler={iceriklerTab}
        takvim={takvimTab}
        aiRapor={aiRaporTab}
        satis={satisTab}
        teslimat={teslimatTab}
        uyum={uyumTab}
      />
    </div>
  );
}
