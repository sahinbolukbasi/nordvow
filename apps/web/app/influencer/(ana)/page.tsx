import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { toInfluencerAssignmentView } from "@infulancer/core/access/dto";
import { prisma } from "@infulancer/core/db";
import { contentTypeLabels, deliverableStatusLabels, platformLabels } from "@infulancer/core/domain/labels";
import { creativePricing } from "@infulancer/core/creative/pricing";
import { currencyOf, formatDualMinor } from "@infulancer/core/i18n/regions";
import { computeBalances, holdDays } from "@infulancer/core/domain/ledger";
import { WeekAgenda, WeekCalendar } from "@/components/calendar/week-calendar";
import { BalanceCards } from "@/components/finance/balance-cards";
import { ContractDecision } from "@/components/forms/small-forms";
import { PlatformIcon } from "@/components/platform-icon";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, Stagger } from "@/components/ui/layout";
import { StatusDot } from "@/components/ui/status";
import { requireActor } from "@/lib/auth-guard";
import { CopilotHome } from "@/components/copilot/copilot-home";
import { buildCalendarRows, isOverdue, resolveWeek } from "@/lib/calendar";
import { deliverableTone } from "@/lib/status-tone";
import { fmtDate, fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "İşlerim" };

export default async function InfluencerHomePage() {
  const tt = await getTT();
  const actor = await requireActor("INFLUENCER");
  // Hakediş ve ödemeler influencer'ın kayıtlı ülkesinin para biriminde (çevrim yok).
  const myCountry = (await prisma.influencer.findUniqueOrThrow({ where: { id: actor.influencerId! }, select: { country: true } })).country;
  const influencerId = actor.influencerId!;
  const [me, assignments, balances, pricing] = await Promise.all([
    prisma.influencer.findUniqueOrThrow({ where: { id: influencerId }, select: { id: true, name: true, audienceTimezone: true } }),
    prisma.assignment.findMany({
      where: { influencerId },
      orderBy: { createdAt: "desc" },
      include: { campaign: { include: { brand: { select: { name: true, country: true } } } }, deliverables: { orderBy: { plannedAt: "asc" } } },
    }),
    computeBalances(influencerId),
    creativePricing(),
  ]);
  const myCur = currencyOf(myCountry);
  const rawFeeMap = new Map(
    assignments.map((a) => [
      a.id,
      {
        feeMinor: Number(a.feeKurus),
        currency: a.campaign.currency || currencyOf(a.campaign.brand.country),
      },
    ]),
  );
  // Influencer ekranına veri yalnız DTO üzerinden (bütçe/komisyon yok).
  const views = assignments.map(toInfluencerAssignmentView);
  const tz = me.audienceTimezone;
  const now = new Date();
  const offers = views.filter((a) => a.contractStatus === "TEKLIF");
  const active = views.filter((a) => a.contractStatus === "KABUL");

  const week = resolveWeek(undefined, now);
  const sources = active.flatMap((a) =>
    a.deliverables.filter((d) => d.status !== "IPTAL").map((d) => ({ ...d, campaignName: a.campaign.name, influencer: me })),
  );
  const rows = buildCalendarRows(week.days, sources, (id) => `/influencer/isler/${id}`);
  const weekCards = rows.flatMap((r) => r.cards);

  return (
    <Stagger className="flex flex-col gap-6">
      <PageHeader title={tt("İşlerim")} description={tt("Brief, dosyalar, yayın tarihleri ve metrik girişi.")} />
      <CopilotHome actor={actor} />

      <section aria-label={tt("Bakiye")} className="flex flex-col gap-2">
        <BalanceCards balances={balances} holdDays={holdDays()} currency={currencyOf(myCountry)} />
        <Link href="/influencer/odemeler" className="text-[13px] text-fg-muted hover:text-fg">{tt("Ödemeler ve çekim talebi →")}</Link>
      </section>

      {offers.length > 0 ? (
        <Card interactive={false} className="flex flex-col gap-4">
          <CardTitle>{tt("Bekleyen teklifler")}</CardTitle>
          <ul className="flex flex-col divide-y divide-border">
            {offers.map((o) => {
              const feeInfo = rawFeeMap.get(o.id);
              return (
                <li key={o.id} className="flex flex-col gap-3 py-4 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-fg">{o.campaign.name}</span>
                    <span className="text-[13px] text-fg-muted">
                      {o.campaign.brandName} · {fmtDate(o.campaign.startsAt, tz)} – {fmtDate(o.campaign.endsAt, tz)} · {o.deliverables.length}{" "}{tt("iş")}{o.exclusivityDays ? ` · ${o.exclusivityDays} gün münhasırlık` : ""}
                    </span>
                    {feeInfo && feeInfo.feeMinor > 0 ? (
                      <span className="text-[13px] font-semibold tabular-nums text-fg">
                        {formatDualMinor(feeInfo.feeMinor, feeInfo.currency, {
                          viewerCurrency: myCur,
                          fx: pricing.fx,
                        })}
                      </span>
                    ) : null}
                    {o.deliverables[0] ? (
                      <Link href={`/influencer/isler/${o.deliverables[0].id}`} className="text-[13px] text-fg-muted hover:text-fg">{tt("Brief ve Görev Detayını Gör →")}</Link>
                    ) : null}
                  </div>
                  <ContractDecision assignmentId={o.id} />
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("Bu hafta")}</CardTitle>
        <div className="md:hidden">
          <WeekAgenda days={week.days} cards={weekCards} today={week.today} />
        </div>
        <div className="hidden md:block">
          <WeekCalendar days={week.days} rows={rows} today={week.today} emptyText={tt("Bu hafta paylaşımınız yok.")} />
        </div>
      </Card>

      <Card interactive={false} className="flex flex-col gap-4">
        <CardTitle>{tt("İşler")}</CardTitle>
        {active.length === 0 ? (
          <EmptyState message={tt("Kabul ettiğiniz bir iş olduğunda brief ve teslim tarihleri burada listelenir.")} />
        ) : (
          <div className="flex flex-col gap-6">
            {active.map((a) => {
              const feeInfo = rawFeeMap.get(a.id);
              return (
                <section key={a.id} className="flex flex-col gap-2" aria-label={a.campaign.name}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-fg">
                      {a.campaign.name} <span className="font-normal text-fg-passive">· {a.campaign.brandName}</span>
                    </h3>
                    {feeInfo && feeInfo.feeMinor > 0 ? (
                      <span className="text-[12px] font-semibold tabular-nums text-fg-muted">
                        {formatDualMinor(feeInfo.feeMinor, feeInfo.currency, {
                          viewerCurrency: myCur,
                          fx: pricing.fx,
                        })}
                      </span>
                    ) : null}
                  </div>
                  <ul className="flex flex-col gap-2">
                    {a.deliverables.map((d) => {
                      const late = isOverdue(d, now);
                      const isDone = ["YAYINLANDI", "TAMAMLANDI"].includes(d.status) || Boolean(d.postUrl);
                      return (
                        <li key={d.id}>
                          <Link
                            href={`/influencer/isler/${d.id}`}
                            className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-border bg-surface px-4 py-3 transition-standard hover:border-border-strong"
                          >
                            <span className="flex items-center gap-2 text-sm">
                              <PlatformIcon platform={d.platform} size={16} title={platformLabels[d.platform]} />
                              {contentTypeLabels[d.contentType]}
                            </span>
                            <span className="text-[13px] tabular-nums text-fg-muted">{fmtDateTime(d.plannedAt, tz)}</span>
                            <div className="flex items-center gap-2">
                              <span className="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
                                {isDone ? tt("✓ Yaptım / Tamamlandı") : tt("Durumu Güncelle →")}
                              </span>
                              <StatusDot tone={deliverableTone(d.status, { overdue: late, violation: d.contractViolation })}>
                                {deliverableStatusLabels[d.status]}
                                {late ? tt(" · gecikti") : ""}
                              </StatusDot>
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </Card>
    </Stagger>
  );
}
