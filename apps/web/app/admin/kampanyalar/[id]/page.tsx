import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { computeCampaignScore } from "@infulancer/core/domain/campaign-score";
import {
  assetKindLabels,
  campaignStatusLabels,
  contentTypeLabels,
  deliverableStatusLabels,
  formatKurus,
  platformLabels,
} from "@infulancer/core/domain/labels";
import { AgentRunList } from "@/components/agent/agent-run-list";
import { CampaignLifecycle } from "@/components/campaign/campaign-lifecycle";
import { CampaignActionsMenu, CampaignHub } from "@/components/campaign/campaign-hub";
import { etiketle } from "@/lib/iletisim/etiketler";
import { CampaignShippingDashboard } from "@/components/shipping/campaign-shipping-dashboard";
import { getCampaignShipmentsDashboard } from "@infulancer/core/shipping/service";
import { loadCampaignHubData } from "@/lib/campaign-hub-loader";
import { ApproveSummaryButton, RecommendButton } from "@/components/forms/agent-job-forms";
import { BriefPanel } from "@/components/brief-panel";
import { WeekCalendar } from "@/components/calendar/week-calendar";
import { CampaignAiReviewPanel, CampaignSummaryCharts, type CampaignChartMetricRow } from "@/components/campaign/campaign-analytics-charts";
import { KpiBreakdown } from "@/components/campaign/kpi-breakdown";
import { AssetList } from "@/components/files/asset-list";
import { AssetThumb } from "@/components/files/asset-thumb";
import { FileUploader } from "@/components/files/file-uploader";
import { AssignmentForm } from "@/components/forms/assignment-form";
import { DeliverableForm } from "@/components/forms/deliverable-form";
import { BrandDataForm, BrandPaymentForm, CloseCampaignForm, ContractDecision } from "@/components/forms/small-forms";
import { ExternalIcon, UserPlusIcon } from "@/components/icons";
import { InfluencerPicker, type PickerInfluencer } from "@/components/campaign/influencer-picker";
import { pickerPool, toPickerInfluencers } from "@/lib/campaign-picker";
import { PlatformIcon } from "@/components/platform-icon";
import { Card, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { StatusDot } from "@/components/ui/status";
import { Tabs } from "@/components/ui/tabs";
import { requireActor } from "@/lib/auth-guard";
import { TrackerGallery, TrackerList } from "@/components/agent/tracker-ui";
import { loadTrackerViews, templateViews } from "@/lib/trackers";
import { buildCalendarRows, isOverdue, resolveWeek } from "@/lib/calendar";
import { num } from "@/lib/format";
import { scoreDeliverableSelect, toScoreDeliverables } from "@/lib/queries";
import { campaignTone, contractTone, contractUiLabels, deliverableTone } from "@/lib/status-tone";
import { AGENCY_TZ, fmtDate, fmtDateTime, fmtDayLabel, tzShort } from "@/lib/time";

export const metadata: Metadata = { title: "Kampanya" };

const AGENCY_KINDS = ["BRIEF_PDF", "MARKA_LOGO", "MARKA_FONT", "ORNEK_CEKIM", "URUN_FOTO", "ONAYLI_CAPTION", "DIGER"] as const;

type Candidate = { influencerId?: string; name?: string; score?: number; rationale?: string };

function candidatesOf(findings: unknown): Candidate[] {
  // Öneri ajanı "recommendations", eski kayıtlar "candidates" alanını kullanır.
  const f = findings as { candidates?: unknown; recommendations?: unknown } | null;
  const list = Array.isArray(f?.recommendations) ? f.recommendations : Array.isArray(f?.candidates) ? f.candidates : [];
  return (list as Candidate[]).filter((c) => c && typeof c === "object");
}

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sekme?: string; kaydedildi?: string; hafta?: string | string[] }>;
}) {
  const tt = await getTT();
  await requireActor("ADMIN");
  const { id } = await params;
  const { sekme, kaydedildi, hafta } = await searchParams;
  const campaign = await prisma.campaign.findUnique({
    where: { id },
    include: {
      brand: { select: { id: true, name: true } },
      briefs: { orderBy: { version: "desc" }, take: 1 },
      assets: { where: { uploadStatus: "TAMAM" }, orderBy: { createdAt: "desc" }, include: { uploadedBy: { select: { name: true } } } },
      assignments: {
        orderBy: { createdAt: "asc" },
        include: {
          influencer: {
            select: { id: true, name: true, category: true, audienceTimezone: true, socialAccounts: { select: { platform: true, handle: true, followers: true } } },
          },
          deliverables: {
            orderBy: { plannedAt: "asc" },
            include: {
              metricSnapshots: scoreDeliverableSelect.metricSnapshots,
              assets: { where: { uploadStatus: "TAMAM" }, orderBy: { createdAt: "asc" }, include: { uploadedBy: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });
  if (!campaign) notFound();

  const now = new Date();
  const live = campaign.assignments.filter((a) => a.contractStatus !== "RED");
  const deliverables = live.flatMap((a) => a.deliverables.map((d) => ({ ...d, influencer: a.influencer })));
  const score = computeCampaignScore(campaign, toScoreDeliverables(deliverables), now);
  const brief = campaign.briefs[0];
  const deliverableIds = campaign.assignments.flatMap((a) => a.deliverables.map((d) => d.id));

  const [runs, influencers] = await Promise.all([
    prisma.agentRun.findMany({
      where: {
        OR: [
          { targetType: "Campaign", targetId: campaign.id },
          { targetType: "Deliverable", targetId: { in: deliverableIds } },
          { targetType: "Assignment", targetId: { in: campaign.assignments.map((a) => a.id) } },
          { targetType: "Influencer", checkType: "MARKA_CAKISMASI", findings: { path: ["campaignId"], equals: campaign.id } },
        ],
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { resolvedBy: { select: { name: true } } },
      take: 100,
    }),
    pickerPool(campaign.id),
  ]);
  const trackers = await loadTrackerViews({ scope: "CAMPAIGN", targetId: campaign.id });
  const suggestions = runs.filter((r) => r.checkType === "INFLUENCER_ONERI" && r.targetType === "Campaign");
  const editable = campaign.status === "TASLAK" || campaign.status === "AKTIF";
  const suggested = new Map<string, string | undefined>();
  for (const s of suggestions) for (const c of candidatesOf(s.findings)) if (c.influencerId) suggested.set(c.influencerId, c.rationale);
  const pickerInfluencers: PickerInfluencer[] = toPickerInfluencers(influencers, campaign.brand.id, suggested);

  const latestReach = (snaps: { reach: number | null; measuredAt: Date }[]) =>
    [...snaps].sort((a, b) => b.measuredAt.getTime() - a.measuredAt.getTime()).find((s) => s.reach != null)?.reach ?? 0;

  const published = deliverables.filter((d) => d.publishedAt && d.status !== "IPTAL");

  const general = (
    <div className="flex flex-col gap-6">
      <div className="grid-12">
        <Card interactive={false} className="flex flex-col gap-6 md:col-span-8">
          <CardTitle>{tt("Kampanya skoru")}</CardTitle>
          <KpiBreakdown score={score} />
        </Card>
        <Card interactive={false} className="flex flex-col gap-4 md:col-span-4">
          <CardTitle>{tt("Özet")}</CardTitle>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-fg-passive">{tt("Marka")}</dt>
            <dd>
              <Link href={`/admin/markalar/${campaign.brand.id}`} className="hover:underline">
                {campaign.brand.name}
              </Link>
            </dd>
            <dt className="text-fg-passive">{tt("Tarih")}</dt>
            <dd>
              {fmtDate(campaign.startsAt)} – {fmtDate(campaign.endsAt)}
            </dd>
            <dt className="text-fg-passive">{tt("Toplam bütçe")}</dt>
            <dd className="tabular-nums">{formatKurus(Number(campaign.brandTotalFeeKurus || campaign.budgetKurus))}</dd>
            <dt className="text-fg-passive">{tt("Influencer bütçesi")}</dt>
            <dd className="tabular-nums">{Number(campaign.budgetKurus) > 0 ? formatKurus(Number(campaign.budgetKurus)) : "—"}</dd>
            <dt className="text-fg-passive">{tt("UTM")}</dt>
            <dd className="font-mono text-[13px]">{campaign.slug}</dd>
            <dt className="text-fg-passive">{tt("Kapanış")}</dt>
            <dd>{campaign.closedAt ? fmtDateTime(campaign.closedAt) : "—"}</dd>
            <dt className="text-fg-passive">{tt("Marka ödemesi")}</dt>
            <dd>{campaign.brandPaymentReceivedAt ? fmtDate(campaign.brandPaymentReceivedAt) : tt("Bekleniyor")}</dd>
          </dl>
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            {campaign.status === "AKTIF" ? <CloseCampaignForm campaignId={campaign.id} /> : null}
            {!campaign.brandPaymentReceivedAt && campaign.status !== "IPTAL" ? <BrandPaymentForm campaignId={campaign.id} /> : null}
          </div>
        </Card>
      </div>
      <CampaignSummaryCharts
        views={published.reduce((s, d) => s + (d.metricSnapshots[0]?.impressions ?? 0), 0)}
        reach={published.reduce((s, d) => s + (d.metricSnapshots[0]?.reach ?? 0), 0)}
        likes={published.reduce((s, d) => s + (d.metricSnapshots[0]?.likes ?? 0), 0)}
        comments={published.reduce((s, d) => s + (d.metricSnapshots[0]?.comments ?? 0), 0)}
        savesShares={published.reduce((s, d) => s + (d.metricSnapshots[0]?.shares ?? 0) + (d.metricSnapshots[0]?.saves ?? 0), 0)}
        publishedCount={published.length}
        plannedCount={deliverables.length}
        er={(() => {
          const v = published.reduce((s, d) => s + (d.metricSnapshots[0]?.impressions ?? 0), 0);
          const rc = published.reduce((s, d) => s + (d.metricSnapshots[0]?.reach ?? 0), 0);
          const inter = published.reduce(
            (s, d) =>
              s +
              (d.metricSnapshots[0]?.likes ?? 0) +
              (d.metricSnapshots[0]?.comments ?? 0) +
              (d.metricSnapshots[0]?.shares ?? 0) +
              (d.metricSnapshots[0]?.saves ?? 0),
            0,
          );
          const denom = v > 0 ? v : rc;
          return denom > 0 && inter > 0 ? inter / denom : null;
        })()}
        influencerPerf={live.map((a) => {
          const pub = a.deliverables.filter((d) => d.status === "YAYINLANDI");
          const v = pub.reduce((s, d) => s + (d.metricSnapshots[0]?.impressions ?? 0), 0);
          const rc = pub.reduce((s, d) => s + (d.metricSnapshots[0]?.reach ?? 0), 0);
          const inter = pub.reduce(
            (s, d) =>
              s +
              (d.metricSnapshots[0]?.likes ?? 0) +
              (d.metricSnapshots[0]?.comments ?? 0) +
              (d.metricSnapshots[0]?.shares ?? 0) +
              (d.metricSnapshots[0]?.saves ?? 0),
            0,
          );
          const denom = v > 0 ? v : rc;
          return {
            name: a.influencer.name,
            viewsOrReach: v > 0 ? v : rc,
            interactions: inter,
            publishedCount: pub.length,
            er: denom > 0 && inter > 0 ? inter / denom : null,
          };
        })}
      />
      <Card interactive={false} className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{tt("Influencerlar")}</CardTitle>
          {editable ? (
            <ButtonLink href={`/admin/kampanyalar/${campaign.id}?sekme=influencerlar`} variant="secondary" size="sm">
              <UserPlusIcon size={14} />{" "}{tt("Ekle")}</ButtonLink>
          ) : null}
        </div>
        <DataTable
          caption={tt("Kampanya influencerları")}
          emptyText={tt("Henüz atama yok.")}
          columns={[
            { key: "name", header: "Influencer", sortable: true },
            { key: "contract", header: "Sözleşme", sortable: true },
            { key: "fee", header: "Bedel", align: "right", sortable: true },
            { key: "commission", header: "Komisyon", align: "right", sortable: true },
            { key: "deliverables", header: "İş", align: "right", sortable: true },
            { key: "reach", header: "Erişim", align: "right", sortable: true },
            { key: "coupon", header: "Kupon" },
          ]}
          rows={campaign.assignments.map((a) => {
            const reach = a.deliverables.reduce((s, d) => s + latestReach(d.metricSnapshots), 0);
            return {
              id: a.id,
              cells: {
                name: { display: a.influencer.name, sort: a.influencer.name },
                contract: { display: <StatusDot tone={contractTone(a.contractStatus)}>{contractUiLabels[a.contractStatus]}</StatusDot>, sort: a.contractStatus },
                fee: { display: formatKurus(a.feeKurus), sort: a.feeKurus },
                commission: { display: formatKurus(a.commissionKurus), sort: a.commissionKurus },
                deliverables: { display: a.deliverables.filter((d) => d.status !== "IPTAL").length, sort: a.deliverables.length },
                reach: { display: num.format(reach), sort: reach },
                coupon: a.couponCode ?? "—",
              },
              label: a.influencer.name,
              actions: [
                { label: "Influencer profili", href: `/admin/influencerlar/${a.influencer.id}`, icon: "open" },
                { label: "Profili düzenle", href: `/admin/influencerlar/${a.influencer.id}/duzenle`, icon: "edit" },
              ],
            };
          })}
        />
      </Card>
      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("İçerik galerisi")}</CardTitle>
        {published.length === 0 ? (
          <p className="text-sm text-fg-passive">{tt("Henüz yayınlanmış içerik yok.")}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {published.map((d) => {
              const thumb = d.assets.find((a) => (a.kind === "HAM_DOSYA" || a.kind === "TASLAK") && a.mime.startsWith("image/"));
              return (
                <li key={d.id} className="overflow-hidden rounded-[8px] border border-border bg-surface transition-standard hover:border-border-strong">
                  <Link href={`/admin/teslimler/${d.id}`}>
                    <AssetThumb assetId={thumb?.id} platform={d.platform} alt={`${d.influencer.name} ${contentTypeLabels[d.contentType]}`} />
                  </Link>
                  <div className="flex flex-col gap-1 p-3 text-[12px]">
                    <span className="truncate text-fg">{d.influencer.name}</span>
                    <span className="flex items-center gap-1 text-fg-passive">
                      <PlatformIcon platform={d.platform} size={12} /> {contentTypeLabels[d.contentType]}
                    </span>
                    {d.postUrl ? (
                      <a href={d.postUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-fg-muted hover:text-fg">{" "}{tt("Paylaşımı aç")}{" "}<ExternalIcon size={12} />
                        <span className="sr-only">{tt("(yeni sekmede açılır)")}</span>
                      </a>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );

  const delivery = (
    <div className="flex flex-col gap-6">
      {campaign.assignments.length === 0 ? (
        <EmptyState message={tt("Kampanyaya henüz influencer atanmadı. Influencerlar sekmesinden ekleyin.")} />
      ) : (
        campaign.assignments.map((a) => {
          const tz = a.influencer.audienceTimezone;
          const tzLabel = tz === AGENCY_TZ ? "İstanbul" : `${tz}, ${tzShort(tz)}`;
          return (
            <Card key={a.id} interactive={false} className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h3 className="text-section">{a.influencer.name}</h3>
                  <p className="text-[13px] text-fg-muted">
                    {formatKurus(a.feeKurus)}{" "}{tt("bedel ·")}{" "}{formatKurus(a.commissionKurus)}{" "}{tt("komisyon")}{a.couponCode ? ` · kupon ${a.couponCode}` : ""}
                    {a.exclusivityDays ? ` · ${a.exclusivityDays} gün münhasırlık${a.exclusivityCategory ? ` (${a.exclusivityCategory})` : ""}` : ""}
                  </p>
                  {a.conflictOverrideReason ? <p className="text-[13px] text-fg-muted">{tt("Çakışma ezme gerekçesi:")}{" "}{a.conflictOverrideReason}</p> : null}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusDot tone={contractTone(a.contractStatus)}>{contractUiLabels[a.contractStatus]}</StatusDot>
                  {a.contractStatus === "TEKLIF" ? <ContractDecision assignmentId={a.id} /> : null}
                </div>
              </div>
              {a.deliverables.length === 0 ? (
                <p className="text-sm text-fg-passive">{tt("Bu atamada planlanmış iş yok.")}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {a.deliverables.map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/admin/teslimler/${d.id}`}
                        className="-mx-2 flex flex-wrap items-center justify-between gap-3 rounded-[8px] px-2 py-3 transition-standard hover:bg-surface-hover"
                      >
                        <span className="flex items-center gap-2 text-sm">
                          <PlatformIcon platform={d.platform} size={16} title={platformLabels[d.platform]} />
                          {contentTypeLabels[d.contentType]}
                        </span>
                        <span className="text-[13px] tabular-nums text-fg-muted">
                          {fmtDateTime(d.plannedAt, tz)}
                          {tz !== AGENCY_TZ ? ` (${tzShort(tz)}) · İstanbul ${fmtDateTime(d.plannedAt)}` : ""}
                        </span>
                        <StatusDot tone={deliverableTone(d.status, { overdue: isOverdue(d, now), violation: d.contractViolation })}>
                          {deliverableStatusLabels[d.status]}
                          {isOverdue(d, now) ? tt(" · gecikti") : ""}
                        </StatusDot>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {a.contractStatus !== "RED" && editable ? (
                <details className="rounded-[8px] border border-border">
                  <summary className="cursor-pointer px-4 py-3 text-sm text-fg-muted hover:text-fg">{tt("Yeni iş planla")}</summary>
                  <div className="border-t border-border p-4">
                    <DeliverableForm
                      assignmentId={a.id}
                      tz={tz}
                      tzLabel={tzLabel}
                      defaults={{
                        hashtags: brief?.hashtags ?? [],
                        mentions: brief?.mentions ?? [],
                        disclosureRequired: brief?.disclosureRequired ?? true,
                        advertiser: campaign.brand.name,
                      }}
                    />
                  </div>
                </details>
              ) : null}
            </Card>
          );
        })
      )}
      {live.some((a) => a.couponCode) ? (
        <Card interactive={false} className="flex flex-col gap-4">
          <CardTitle>{tt("Marka verisi (kupon koduyla)")}</CardTitle>
          <p className="text-[13px] text-fg-muted">{tt("Kupon tıklama/satış/ciro, o atamanın iptal olmayan işlerine eşit bölünür. Kaynak: marka verisi (yüksek güven).")}</p>
          <BrandDataForm campaignId={campaign.id} />
        </Card>
      ) : null}
    </div>
  );

  const files = (
    <div className="grid-12">
      <Card interactive={false} className="flex flex-col gap-4 md:col-span-7">
        <CardTitle>{tt("Ajans dosyaları")}</CardTitle>
        <AssetList
          assets={campaign.assets.map((a) => ({ ...a, uploadedByName: a.uploadedBy.name }))}
          emptyText={tt("Kampanyaya bağlı dosya yok.")}
        />
        <CardTitle className="pt-4">{tt("İş dosyaları")}</CardTitle>
        <AssetList
          editableRights
          assets={campaign.assignments.flatMap((a) =>
            a.deliverables.flatMap((d) => d.assets.map((as) => ({ ...as, uploadedByName: `${as.uploadedBy.name} · ${a.influencer.name}` }))),
          )}
          emptyText={tt("İşlere yüklenmiş dosya yok.")}
        />
      </Card>
      <Card interactive={false} className="flex flex-col gap-4 md:col-span-5">
        <CardTitle>{tt("Influencer'lara dosya gönder")}</CardTitle>
        <FileUploader target={{ type: "campaign", id: campaign.id }} kinds={AGENCY_KINDS.map((k) => ({ value: k, label: assetKindLabels[k] }))} />
      </Card>
    </div>
  );

  const briefTab = (
    <Card interactive={false} className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <CardTitle>{tt("Brief")}</CardTitle>
        <ButtonLink href={`/admin/kampanyalar/${campaign.id}/brief`} variant="secondary" size="sm">
          {brief ? tt("Yeni sürüm") : tt("Brief yaz")}
        </ButtonLink>
      </div>
      {brief ? <BriefPanel brief={brief} /> : <p className="text-sm text-fg-passive">{tt("Henüz brief yok.")}</p>}
    </Card>
  );

  const people = (
    <div className="flex flex-col gap-6">
      {editable ? (
        <>
          <Card interactive={false} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-col gap-1">
                <CardTitle>{tt("Influencer ekle")}</CardTitle>
                <p className="text-[13px] text-fg-muted">{" "}{tt("Filtreleyin, işaretleyin, bedeli girin. Eklenen herkese sözleşme teklifi gider; rakip markayla çakışanlar otomatik engellenir.")}</p>
              </div>
              <RecommendButton campaignId={campaign.id} />
            </div>
            <InfluencerPicker campaignId={campaign.id} influencers={pickerInfluencers} />
          </Card>
          <details className="rounded-[8px] border border-border">
            <summary className="cursor-pointer px-4 py-3 text-sm text-fg-muted hover:text-fg">{" "}{tt("Tekli atama (kupon, münhasırlık veya çakışma gerekçesiyle)")}</summary>
            <div className="border-t border-border p-4">
              <AssignmentForm campaignId={campaign.id} influencers={influencers.map((i) => ({ id: i.id, name: i.name, category: i.category }))} />
            </div>
          </details>
        </>
      ) : (
        <EmptyState message={tt("Kapanmış veya iptal edilmiş kampanyaya influencer eklenemez.")} />
      )}
    </div>
  );
  const summaryDraft = runs.find((r) => r.checkType === "KAMPANYA_OZETI");
  const draftText = (summaryDraft?.findings as { draft?: string } | null)?.draft;
  const agent = (
    <div className="flex flex-col gap-6">
      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Takip agent'ları")}</CardTitle>
        <TrackerList trackers={trackers} emptyText={tt("Bu kampanyada takipçi yok.")} />
        <TrackerGallery templates={templateViews()} targets={{ CAMPAIGN: [], INFLUENCER: [], BRAND: [] }} fixedTarget={{ scope: "CAMPAIGN", id: campaign.id }} />
      </Card>
      {summaryDraft && draftText ? (
        <Card interactive={false} className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{tt("Rapor özeti taslağı")}</CardTitle>
            <ApproveSummaryButton runId={summaryDraft.id} />
          </div>
          <p className="whitespace-pre-line text-sm text-fg-muted">{draftText}</p>
          {campaign.reportSummary ? <p className="text-[13px] text-fg-passive">{tt("Rapordaki mevcut özet bu taslakla değiştirilir.")}</p> : null}
        </Card>
      ) : null}
      <AgentRunList
        runs={runs.map((r) => ({ ...r, resolvedByName: r.resolvedBy?.name }))}
        emptyText={tt("Bu kampanya için agent bulgusu yok.")}
      />
      <CampaignAiReviewPanel
        items={published.map((d): CampaignChartMetricRow => {
          const snap = d.metricSnapshots[0];
          const v = snap?.impressions ?? 0;
          const rc = snap?.reach ?? 0;
          const lk = snap?.likes ?? 0;
          const cm = snap?.comments ?? 0;
          const ss = (snap?.shares ?? 0) + (snap?.saves ?? 0);
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
            complianceStatus: d.contractViolation ? "EKSIK" : "UYUMLU",
          };
        })}
        findings={runs.map((r) => ({
          id: r.id,
          title: etiketle(r.checkType, r.checkType),
          severity: r.severity,
          status: r.status,
          summary: r.summary,
        }))}
        totalViews={published.reduce((s, d) => s + (d.metricSnapshots[0]?.impressions ?? 0), 0)}
        totalLikes={published.reduce((s, d) => s + (d.metricSnapshots[0]?.likes ?? 0), 0)}
        totalComments={published.reduce((s, d) => s + (d.metricSnapshots[0]?.comments ?? 0), 0)}
        avgEr={null}
        detailHrefPrefix="/admin/teslimler"
      />
    </div>
  );

  const inRange = now >= campaign.startsAt && now <= campaign.endsAt;
  const week = { ...resolveWeek(hafta, inRange ? now : campaign.startsAt), today: resolveWeek(undefined, now).today };
  const calRows = buildCalendarRows(
    week.days,
    deliverables.map((d) => ({
      ...d,
      campaignName: campaign.name,
      influencer: { id: d.influencer.id, name: d.influencer.name, audienceTimezone: d.influencer.audienceTimezone },
    })),
    (did) => `/admin/teslimler/${did}`,
  );
  const takvimTab = (
    <Card interactive={false} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <CardTitle>{tt("Yayın takvimi")}</CardTitle>
        <nav aria-label={tt("Hafta")} className="flex items-center gap-2 text-[13px] text-fg-muted">
          <Link href={`/admin/kampanyalar/${campaign.id}?sekme=takvim&hafta=${week.prev}`} className="rounded-lg px-2 py-1 hover:bg-surface-hover">
            ←
          </Link>
          <span className="tabular-nums">
            {fmtDayLabel(week.days[0]!)} – {fmtDayLabel(week.days[6]!)}
          </span>
          <Link href={`/admin/kampanyalar/${campaign.id}?sekme=takvim&hafta=${week.next}`} className="rounded-lg px-2 py-1 hover:bg-surface-hover">
            →
          </Link>
        </nav>
      </div>
      <WeekCalendar days={week.days} rows={calRows} today={week.today} emptyText={tt("Bu hafta planlanmış paylaşım yok.")} />
      <p className="text-[12px] text-fg-passive">{tt("Saatler İstanbul saatine göredir.")}</p>
    </Card>
  );

  const [hubData, shippingDash] = await Promise.all([
    loadCampaignHubData(campaign.id),
    getCampaignShipmentsDashboard(campaign.id),
  ]);
  const showShipping =
    shippingDash.config.requiresProductShipment ||
    shippingDash.shipments.length > 0 ||
    campaign.objective === "urun_gonderimi";
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={campaign.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-3">
            <StatusDot tone={campaignTone(campaign.status)}>{campaignStatusLabels[campaign.status]}</StatusDot>
            <span>{campaign.brand.name}</span>
          </span>
        }
        actions={
          <>
            {editable ? (
              <ButtonLink href={`/admin/kampanyalar/${campaign.id}?sekme=influencerlar`}>
                <UserPlusIcon size={16} />{" "}{tt("Influencer ekle")}</ButtonLink>
            ) : null}
            <ButtonLink href={`/admin/kampanyalar/${campaign.id}/brief`} variant="secondary">{" "}{tt("Brief")}</ButtonLink>
            <ButtonLink href={`/api/fatura/${campaign.id}?format=html`} target="_blank" rel="noreferrer" variant="secondary">{" "}{tt("e-Arşiv Fatura")}</ButtonLink>
            {campaign.status !== "KAPANDI" ? (
              <ButtonLink href={`/admin/kampanyalar/${campaign.id}/duzenle`} variant="secondary">{" "}{tt("Düzenle")}</ButtonLink>
            ) : null}
            <CampaignActionsMenu campaignId={campaign.id} campaignName={campaign.name} editHref={campaign.status !== "KAPANDI" ? `/admin/kampanyalar/${campaign.id}/duzenle` : undefined} />
          </>
        }
      />
      {kaydedildi ? (
        <p role="status" className="rounded-2xl bg-emerald-500/10 px-4 py-3 text-[14px] text-emerald-700 dark:text-emerald-400">{" "}{tt("Kampanya taslak olarak kaydedildi. Kuruluma istediğiniz an “Kurulum” ile dönebilirsiniz.")}</p>
      ) : null}
      <CampaignLifecycle campaignId={campaign.id} base={`/admin/kampanyalar/${campaign.id}`} />
      <CampaignHub
        campaignId={campaign.id}
        campaignName={campaign.name}
        campaignCurrency={campaign.currency}
        viewerRole="ADMIN"
        canManage={true}
        executionMode={campaign.executionMode}
        fx={hubData.fx}
        rows={hubData.rows}
        archivedKeys={hubData.archivedKeys}
        messages={hubData.messages}
        storyRows={hubData.storyRows}
      />
      {showShipping ? (
        <section className="flex flex-col gap-3" id="kargo">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-section">{tt("Kargo & Lojistik Yönetimi")}</h2>
            <ButtonLink href="/admin/kargo" variant="ghost" size="sm">
              {tt("Tüm Kargolar")}
            </ButtonLink>
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
      ) : null}
      <Tabs
        key={sekme ?? "genel"}
        label={tt("Kampanya bölümleri")}
        defaultTab={sekme}
        tabs={[
          { id: "genel", label: "Genel", content: general },
          { id: "influencerlar", label: `Influencerlar (${live.length})`, content: people },
          { id: "teslimler", label: `Teslimler (${deliverables.length})`, content: delivery },
          { id: "takvim", label: "Takvim", content: takvimTab },
          { id: "dosyalar", label: "Dosyalar", content: files },
          { id: "brief", label: "Brief", content: briefTab },
          { id: "agent", label: `AI İnceleme & Raporlama (${runs.filter((r) => r.status === "ACIK").length + trackers.reduce((n, t) => n + t.findings.length, 0)})`, content: agent },
        ]}
      />
    </div>
  );
}
