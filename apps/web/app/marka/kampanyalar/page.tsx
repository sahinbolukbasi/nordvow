import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { toBrandCampaignView } from "@infulancer/core/access/dto";
import { prisma, type CampaignStatus } from "@infulancer/core/db";
import { countryName } from "@infulancer/core/domain/campaign-plan";
import { campaignStatusLabels } from "@infulancer/core/domain/labels";
import { creativePricing } from "@infulancer/core/creative/pricing";
import { formatDualMinor } from "@infulancer/core/i18n/regions";
import { Card } from "@/components/ui/card";
import { CampaignActionsMenu } from "@/components/campaign/campaign-hub";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { ProgressBar } from "@/components/ui/progress";
import { StatusDot } from "@/components/ui/status";
import { requireActor } from "@/lib/auth-guard";
import { cn } from "@/lib/cn";
import { pct } from "@/lib/format";
import { loadCampaignScores } from "@/lib/queries";
import { campaignTone } from "@/lib/status-tone";
import { fmtDate } from "@/lib/time";

export const metadata: Metadata = { title: "Kampanyalar" };
export const dynamic = "force-dynamic";
const TABS: { id: "" | CampaignStatus; label: string }[] = [
  { id: "", label: "Tümü" },
  { id: "TASLAK", label: "Taslak" },
  { id: "AKTIF", label: "Aktif" },
  { id: "KAPANDI", label: "Kapandı" },
];

export default async function BrandCampaignsPage({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const tt = await getTT();
  const actor = await requireActor("BRAND");
  const { durum } = await searchParams;
  const status = TABS.find((t) => t.id && t.id === durum)?.id || undefined;
  const [rows, counts, brand, pricing] = await Promise.all([
    prisma.campaign.findMany({
      where: { brandId: actor.brandId!, ...(status ? { status } : { status: { not: "IPTAL" } }) },
      orderBy: [{ updatedAt: "desc" }],
      include: { assignments: { include: { influencer: { select: { id: true, name: true } } } } },
    }),
    prisma.campaign.groupBy({ by: ["status"], where: { brandId: actor.brandId! }, _count: true }),
    prisma.brand.findUnique({ where: { id: actor.brandId! }, select: { defaultExecutionMode: true, country: true } }),
    creativePricing(),
  ]);
  const isAgencyManaged = (brand?.defaultExecutionMode ?? "AJANS") === "AJANS";
  // Marka ekranına yalnız DTO (influencer bedeli/komisyon yok).
  const campaigns = rows.map((c) => ({ view: toBrandCampaignView(c), raw: c }));
  const scores = await loadCampaignScores(campaigns.filter((c) => c.raw.status !== "TASLAK").map((c) => c.view.id));
  const total = counts.reduce((s, c) => s + (c.status === "IPTAL" ? 0 : c._count), 0);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tt("Kampanyalar")}
        description={
          isAgencyManaged
            ? tt("Kampanyalarınız Ajans Tarafından Yürütülüyor. Süreci ve performans metriklerini anlık olarak takip edebilirsiniz. Yönetim tercihinizi Profilim → Ayarlar bölümünden değiştirebilirsiniz.")
            : tt("Kampanyalarınızı kendiniz yönetiyorsunuz (Self-Managed). Yeni kampanya oluşturabilir, influencer seçebilir ve teklif sürecini doğrudan yönetebilirsiniz.")
        }
        actions={
          isAgencyManaged ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-1.5 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {tt("Kampanyalarınız Ajans Tarafından Yürütülüyor")}
              </span>
              <ButtonLink href="/profil" variant="secondary" size="sm">
                {tt("Yönetim Tercihi (Profil)")}
              </ButtonLink>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ButtonLink href="/profil" variant="secondary" size="sm">
                {tt("Yönetim Tercihi: Kendim Yöneteceğim")}
              </ButtonLink>
              <ButtonLink href="/marka/kampanyalar/yeni">{tt("Yeni kampanya")}</ButtonLink>
            </div>
          )
        }
      />
      {isAgencyManaged ? (
        <div className="flex flex-col justify-between gap-3 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-1">
            <p className="text-[14px] font-semibold text-fg">{tt("Ajans Yönetimi Aktif — Süreci Takip Et")}</p>
            <p className="text-[13px] text-fg-muted">
              {tt("Kampanya kurulumu, influencer iletişimi, teklif pazarlıkları ve Story/içerik takibi ajans ekibi tarafından yürütülür. Aşağıdaki kampanya kartlarından süreci anlık ve şeffaf biçimde izleyebilirsiniz.")}
            </p>
          </div>
          <ButtonLink href="/profil" variant="secondary" size="sm">
            {tt("Kendim Yönetmeye Geç →")}
          </ButtonLink>
        </div>
      ) : null}
      <nav aria-label={tt("Durum")} className="inline-flex w-fit flex-wrap rounded-full border border-line bg-glass p-1">
        {TABS.map((t) => {
          const n = t.id ? (counts.find((c) => c.status === t.id)?._count ?? 0) : total;
          const on = (status ?? "") === t.id;
          return (
            <Link
              key={t.id || "hepsi"}
              href={t.id ? `/marka/kampanyalar?durum=${t.id}` : "/marka/kampanyalar"}
              aria-current={on ? "page" : undefined}
              className={cn("rounded-full px-4 py-1.5 text-[13px] transition-standard", on ? "bg-fg font-medium text-bg" : "text-fg-muted hover:text-fg")}
            >
              {t.label} <span className="tabular-nums opacity-70">{n}</span>
            </Link>
          );
        })}
      </nav>
      {campaigns.length === 0 ? (
        <div className="flex flex-col gap-4">
          <EmptyState
            message={
              status
                ? tt("Bu durumda kampanya yok.")
                : isAgencyManaged
                  ? tt("Kampanyalarınız Ajans Tarafından Yürütülüyor. Ajans ekibimiz kampanyanızı hazırladığında burada anlık olarak takip edebileceksiniz.")
                  : tt("Henüz kampanyanız yok. Hızlı Kampanya ile 3 dakikada ilk taslağınızı oluşturun.")
            }
            action={
              isAgencyManaged
                ? { label: "Yönetim Tercihini Değiştir (Profil)", href: "/profil" }
                : { label: "Hızlı Kampanya Başlat (~3 dk)", href: "/marka/kampanyalar/yeni" }
            }
          />
          {!status ? (
            <Card interactive={false} className="flex flex-col gap-3 border-dashed">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                    ÖRNEK · Salt okunur
                  </span>
                  <h2 className="text-[15px] font-semibold text-fg">Kış Bakım Lansmanı (Örnek Kampanya)</h2>
                </div>
                <span className="text-[12px] text-fg-muted">3 adım · ~3 dk kurulum</span>
              </div>
              <p className="text-[13px] text-fg-muted">
                İlk kampanyanızın nasıl görüneceğini inceleyin: Satış + Bilinirlik hedefi · 15.000 ₺ bütçe · 1 Reels + 1 TikTok planı · AI kısa liste (3 creator, tahmini 180 bin – 320 bin erişim · Tahmin) · 7 aşamalı canlı takip çizelgesi.
              </p>
              <div className="flex flex-wrap gap-2 text-[11px] text-fg-muted">
                <span className="rounded-full border border-line px-2.5 py-0.5">✓ Planlama</span>
                <span className="rounded-full border border-line px-2.5 py-0.5">Teklif (onaylı gönderim)</span>
                <span className="rounded-full border border-line px-2.5 py-0.5">İçerik (saniyeli onay)</span>
                <span className="rounded-full border border-line px-2.5 py-0.5">Yayın & 23/A kontrolü</span>
                <span className="rounded-full border border-line px-2.5 py-0.5">Ölçüm & Haftalık özet</span>
              </div>
            </Card>
          ) : null}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map(({ view: c, raw }) => {
            const draft = raw.status === "TASLAK";
            const scoreRes = scores.get(c.id);
            const hasMeasurement = Boolean(scoreRes?.kpis.some((k) => k.actual > 0));
            const score = draft || !hasMeasurement ? null : (scoreRes?.score ?? null);
            const effectiveBudgetKurus = Number(c.brandTotalFeeKurus || raw.budgetKurus);
            const cardHref =
              !isAgencyManaged && draft && !raw.submittedAt
                ? `/marka/kampanyalar/${c.id}/olustur?adim=ozet`
                : `/marka/kampanyalar/${c.id}`;
            return (
              <li key={c.id}>
                <Card className="flex h-full flex-col gap-4">
                  <Link href={cardHref} className="flex flex-1 flex-col gap-4 rounded-[8px] focus-visible:outline-offset-4">
                    <div className="flex items-start justify-between gap-4">
                      <h2 className="text-section hover:underline">{c.name}</h2>
                      <StatusDot tone={campaignTone(raw.status)}>{draft && raw.submittedAt ? tt("Kaydedildi") : campaignStatusLabels[raw.status]}</StatusDot>
                    </div>
                    {draft ? (
                      <p className="text-[13px] text-fg-muted">{isAgencyManaged || raw.submittedAt ? tt("Kampanya bilgileri kaydedildi · yayın bekleniyor.") : tt("Taslak: kalan adımları tamamlayıp kaydedin.")}</p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-baseline justify-between">
                          <span className="text-label text-fg-muted">{tt("Skor")}</span>
                          <span className="text-[26px] leading-none font-semibold tabular-nums" title={score == null ? tt("Henüz ölçüm verisi yok") : undefined}>
                            {score == null ? "—" : pct.format(score)}
                          </span>
                        </div>
                        <ProgressBar value={score ?? 0} label={`${c.name} skoru`} />
                      </div>
                    )}
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                      <dt className="text-fg-passive">{tt("Tarih")}</dt>
                      <dd className="text-fg-muted tabular-nums">
                        {fmtDate(c.startsAt)} – {fmtDate(c.endsAt)}
                      </dd>
                      <dt className="text-fg-passive">{tt("Bütçe")}</dt>
                      <dd className="text-fg-muted tabular-nums">
                        {effectiveBudgetKurus > 0
                          ? formatDualMinor(effectiveBudgetKurus, raw.currency, { fx: pricing.fx, showGlobalEquivalents: true })
                          : "—"}
                      </dd>
                      {raw.targetCountries.length ? (
                        <>
                          <dt className="text-fg-passive">{tt("Ülke")}</dt>
                          <dd className="text-fg-muted">{raw.targetCountries.map(countryName).join(", ")}</dd>
                        </>
                      ) : null}
                      <dt className="text-fg-passive">{tt("Influencer")}</dt>
                      <dd className="text-fg-muted tabular-nums">{c.influencers.length || (raw.shortlistInfluencerIds.length ? `${raw.shortlistInfluencerIds.length} kısa listede` : "—")}</dd>
                    </dl>
                  </Link>
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                    <Link href={cardHref} className="text-[13px] font-medium hover:underline">
                      {isAgencyManaged
                        ? tt("Süreci Takip Et →")
                        : draft && !raw.submittedAt
                          ? tt("Adımları Tamamla →")
                          : tt("Kampanyayı Yönet →")}
                    </Link>
                    <CampaignActionsMenu campaignId={c.id} campaignName={c.name} viewHref={cardHref} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
