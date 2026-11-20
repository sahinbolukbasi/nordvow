import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { computeInfluencerStats, latestReachSnapshot } from "@infulancer/core/domain/influencer-stats";
import {
  formatKurus,
  taxStatusLabels,
} from "@infulancer/core/domain/labels";
import { computeBalances, holdDays } from "@infulancer/core/domain/ledger";
import { AgentRunList } from "@/components/agent/agent-run-list";
import { BarChart } from "@/components/charts/charts";
import { BalanceCards } from "@/components/finance/balance-cards";
import { CreatorShowcase } from "@/components/showcase/creator-showcase";
import { Card, CardTitle } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/form";
import { requireActor } from "@/lib/auth-guard";
import { WorkHistory } from "@/components/history/work-history";
import { SyncAccountsButton } from "@/components/forms/agent-job-forms";
import { compact, pct, pct1 } from "@/lib/format";
import { fmtDate } from "@/lib/time";

export const metadata: Metadata = { title: "Influencer profili" };

const shortDate = new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short", timeZone: "Europe/Istanbul" });

export default async function InfluencerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const tt = await getTT();
  await requireActor("ADMIN");
  const { id } = await params;
  const now = new Date();
  const inf = await prisma.influencer.findUnique({
    where: { id },
    include: {
      user: { select: { email: true } },
      categories: { orderBy: { primary: "desc" }, include: { category: { include: { parent: { select: { name: true } } } } } },
      socialAccounts: { orderBy: { followers: "desc" }, include: { snapshots: { orderBy: { takenAt: "asc" } } } },
      assignments: {
        orderBy: { createdAt: "desc" },
        include: {
          campaign: { select: { id: true, name: true, status: true, startsAt: true, endsAt: true, brand: { select: { name: true } } } },
          deliverables: {
            orderBy: { plannedAt: "asc" },
            select: {
              id: true,
              platform: true,
              contentType: true,
              status: true,
              plannedAt: true,
              publishedAt: true,
              metricSnapshots: { select: { measuredAt: true, reach: true } },
            },
          },
        },
      },
    },
  });
  if (!inf) notFound();

  const deliverableIds = inf.assignments.flatMap((a) => a.deliverables.map((d) => d.id));
  const [stats, balances, runs] = await Promise.all([
    computeInfluencerStats([inf.id], now),
    computeBalances(inf.id, now),
    prisma.agentRun.findMany({
      where: {
        OR: [
          { targetType: "Influencer", targetId: inf.id },
          { targetType: "Deliverable", targetId: { in: deliverableIds } },
          { targetType: "Assignment", targetId: { in: inf.assignments.map((a) => a.id) } },
        ],
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { resolvedBy: { select: { name: true } } },
      take: 50,
    }),
  ]);
  const st = stats.get(inf.id);

  const published = inf.assignments
    .filter((a) => a.contractStatus !== "RED")
    .flatMap((a) => a.deliverables.filter((d) => d.publishedAt && d.status !== "IPTAL").map((d) => ({ ...d, campaignName: a.campaign.name })))
    .sort((a, b) => a.publishedAt!.getTime() - b.publishedAt!.getTime())
    .slice(-12);
  const reachBars = published.map((d) => ({
    label: shortDate.format(d.publishedAt!),
    value: latestReachSnapshot(d.metricSnapshots)?.reach ?? 0,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ButtonLink href="/admin/influencerlar" variant="ghost" size="sm">
          {tt("← Influencer listesi")}
        </ButtonLink>
        <span className="text-[12px] text-fg-muted">
          {taxStatusLabels[inf.taxStatus]}
          {inf.canIssueInvoice ? ` · ${tt("Fatura kesebilir")}` : ` · ${tt("Fatura kesemiyor")}`} · {inf.user?.email ?? tt("Giriş hesabı yok")}
        </span>
      </div>

      {/* Marka Vitrini + Instagram Gezgini (AI Analiz, 7G/30G/90G Gelişim Grafikleri, Kaydetme/İzlenme, Marka İşbirlikleri & Admin Kontrolleri) */}
      <CreatorShowcase
        influencerId={inf.id}
        isAdmin
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SyncAccountsButton influencerId={inf.id} />
            <ButtonLink href={`/admin/influencerlar/${inf.id}/duzenle`}>{tt("Profili Düzenle")}</ButtonLink>
          </div>
        }
      />

      {/* Admin Operasyonel Metrikleri */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card interactive={false} className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">{tt("Tamamlanan kampanya")}</span>
          <span className="text-metric tabular-nums">{st?.completedCampaigns ?? 0}</span>
        </Card>
        <Card interactive={false} className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">{tt("Zamanında teslim")}</span>
          <span className="text-metric tabular-nums">{st?.onTimeRate == null ? "—" : pct.format(st.onTimeRate)}</span>
          <span className="text-[13px] text-fg-passive">{st ? `${st.onTimeCount} / ${st.publishedCount} yayın (≤ 30 dk)` : ""}</span>
        </Card>
        <Card interactive={false} className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">{tt("Ortalama performans")}</span>
          <span className="text-metric tabular-nums">
            {st?.performance == null ? "—" : st.performance.kind === "ERISIM_ORANI" ? pct.format(st.performance.value) : pct1.format(st.performance.value)}
          </span>
          <span className="text-[13px] text-fg-passive">
            {st?.performance?.kind === "ERISIM_ORANI" ? tt("Erişim / kişi başı hedef") : st?.performance ? tt("Ortalama ER") : tt("Ölçüm yok")}
          </span>
        </Card>
        <Card interactive={false} className="flex flex-col gap-1">
          <span className="text-label text-fg-muted">{tt("Risk skoru")}</span>
          <span className={`text-metric tabular-nums ${inf.riskScore != null && inf.riskScore >= 70 ? "text-critical" : ""}`}>{inf.riskScore ?? "—"}</span>
          <span className="text-[13px] text-fg-passive">
            {st?.activeExclusivities.length
              ? `Münhasırlık: ${st.activeExclusivities.map((e) => `${e.category} (${fmtDate(e.until)})`).join(", ")}`
              : tt("Aktif münhasırlık yok")}
          </span>
        </Card>
      </div>

      {reachBars.length > 0 ? (
        <Card interactive={false} className="flex flex-col gap-4">
          <CardTitle>{tt("Platform İçi Kampanya Teslimlerinde İçerik Başına Erişim (Son 12 Yayın)")}</CardTitle>
          <BarChart label={tt("İçerik başına erişim")} format={(v) => compact.format(v)} bars={reachBars} />
        </Card>
      ) : null}

      <section aria-label={tt("Bakiye")} className="flex flex-col gap-4">
        <h2 className="text-section">{tt("Bakiye & Finansal Durum")}</h2>
        <BalanceCards balances={balances} holdDays={holdDays()} />
        <p className="text-[13px] text-fg-passive">
          {tt("Toplam ödenen:")} {formatKurus(st?.totalPaidKurus ?? 0)} ·{" "}
          <Link href="/admin/finans" className="hover:text-fg">
            {tt("Finans ekranı →")}
          </Link>
        </p>
      </section>

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("İş ve ödeme geçmişi")}</CardTitle>
        <WorkHistory influencerId={inf.id} mode="admin" />
      </Card>

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Agent bulguları")}</CardTitle>
        <AgentRunList runs={runs.map((r) => ({ ...r, resolvedByName: r.resolvedBy?.name }))} emptyText={tt("Bu influencer için agent bulgusu yok.")} />
      </Card>
    </div>
  );
}
