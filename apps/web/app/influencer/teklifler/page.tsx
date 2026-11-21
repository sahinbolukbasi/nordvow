import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { formatKurus } from "@infulancer/core/domain/labels";
import { creativePricing } from "@infulancer/core/creative/pricing";
import { currencyOf, formatDualMinor } from "@infulancer/core/i18n/regions";
import { ApplyForm } from "@/components/campaigns/open-call-forms";
import { Pill, StatStrip } from "@/components/luma/primitives";
import { RespondOffer, WithdrawOffer } from "@/components/offers/offer-forms";
import { OfferAcceptWithShipment } from "@/components/shipping/offer-shipment-modal";
import { listInfluencerAddresses } from "@infulancer/core/shipping/service";
import { parseProductDetails } from "@infulancer/core/shipping/types";
import { ButtonLink } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { requireActor } from "@/lib/auth-guard";
import { applicationPill, offerPill } from "@/lib/offers-pills";
import { expiryText, itemsSummary } from "@/lib/offers-view";
import { fmtDate } from "@/lib/time";

export const metadata: Metadata = { title: "Teklifler" };
export const dynamic = "force-dynamic";

/**
 * İçerik üreticisi: markalardan gelen teklifler ve markaların açık çağrıları tek yerde.
 * Açık çağrıya başvuru marka kabul edince bu listede "kabul edilmiş teklif" olarak görünür.
 */
export default async function InfluencerOffersPage({ searchParams }: { searchParams: Promise<{ sekme?: string; sonuc?: string }> }) {
  const tt = await getTT();
  const actor = await requireActor("INFLUENCER");
  const { sekme, sonuc } = await searchParams;
  const id = actor.influencerId!;
  const now = new Date();
  const [offers, open, mine, me, pricing, savedAddresses, myAssignments] = await Promise.all([
    prisma.offer.findMany({ where: { influencerId: id }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.campaignOpenCall.findMany({ where: { status: "ACIK", OR: [{ deadline: null }, { deadline: { gte: now } }] }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.campaignApplication.findMany({ where: { influencerId: id }, orderBy: { createdAt: "desc" }, include: { openCall: { select: { title: true, tenantId: true } } } }),
    prisma.influencer.findUnique({ where: { id }, select: { country: true } }),
    creativePricing(),
    listInfluencerAddresses(id),
    prisma.assignment.findMany({
      where: { influencerId: id, contractStatus: "KABUL" },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        campaign: { select: { id: true, name: true, status: true, startsAt: true, endsAt: true, brand: { select: { name: true } } } },
        deliverables: { where: { status: { not: "IPTAL" } }, orderBy: { plannedAt: "asc" }, take: 1, select: { id: true, status: true } },
      },
    }),
  ]);
  const deliverableByCampaign = new Map<string, string>();
  for (const a of myAssignments) {
    if (a.deliverables[0]) deliverableByCampaign.set(a.campaignId, a.deliverables[0].id);
  }
  const activeCampaigns = myAssignments.filter((a) => a.campaign.status === "AKTIF" || a.campaign.status === "TASLAK");
  const completedCampaigns = myAssignments.filter((a) => a.campaign.status === "KAPANDI" || a.campaign.status === "IPTAL");
  const offerCampaignIds = [...new Set(offers.map((o) => o.campaignId).filter((x): x is string => Boolean(x)))];
  const shippingConfigs = new Map(
    (
      offerCampaignIds.length
        ? await prisma.campaignShippingConfig.findMany({
            where: { campaignId: { in: offerCampaignIds }, requiresProductShipment: true },
          })
        : []
    ).map((c) => [c.campaignId, c]),
  );
  const myCur = currencyOf(me?.country);
  // Influencer panelinde tutarlar kullanıcının kayıtlı/seçili para birimine çevrilip tek fiyat olarak gösterilir.
  const viewerCur = myCur;
  const brands = new Map(
    (await prisma.brand.findMany({ where: { id: { in: [...new Set([...offers.map((o) => o.brandId), ...open.map((c) => c.tenantId), ...mine.map((m) => m.openCall.tenantId)])] } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]),
  );
  const applied = new Set(mine.map((m) => m.openCallId));
  const fromApplication = new Set(mine.map((m) => m.offerId).filter(Boolean));
  const pending = offers.filter((o) => (o.status === "GONDERILDI" || o.status === "KARSI_TEKLIF") && o.expiresAt > now);
  const openNotApplied = open.filter((c) => !applied.has(c.id));

  const offerCards = (items: typeof offers, actionable: boolean, emptyText: string) =>
    items.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-fg-muted">{emptyText}</p>
    ) : (
      <ul className="flex flex-col gap-3">
        {items.map((o) => {
          const p = offerPill[o.status] ?? { label: o.status, tone: "gray" as const };
          const shipCfg = o.campaignId ? shippingConfigs.get(o.campaignId) : undefined;
          const productDetails = shipCfg ? parseProductDetails(shipCfg.productDetails) : null;
          return (
            <li key={o.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
                    {brands.get(o.brandId) ?? tt("Marka")}
                    <Pill tone={fromApplication.has(o.id) ? "violet" : "gray"}>{fromApplication.has(o.id) ? tt("Başvurunuzdan") : tt("Size özel teklif")}</Pill>
                    {shipCfg ? (
                      <Pill tone="amber">{tt("Bu iş birliği kapsamında tarafınıza ürün gönderimi yapılacaktır")}</Pill>
                    ) : null}
                  </span>
                  <span className="text-[17px] font-semibold text-fg">{o.title}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-xl font-semibold tabular-nums text-fg">
                    {formatDualMinor(
                      o.status === "KARSI_TEKLIF" && o.counterKurus ? o.counterKurus : o.totalKurus,
                      "TRY",
                      {
                        viewerCurrency: myCur !== "TRY" ? myCur : viewerCur,
                        perspective: myCur !== "TRY" ? "influencer" : "brand",
                        fx: pricing.fx,
                        showGlobalEquivalents: true,
                      },
                    )}
                  </span>
                  <Pill tone={o.status === "KARSI_TEKLIF" ? "amber" : p.tone}>{o.status === "KARSI_TEKLIF" ? tt("Karşı fiyat") : p.label}</Pill>
                </div>
              </div>
              <p className="whitespace-pre-line text-[14px] text-fg-muted">{o.message}</p>
              {productDetails ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-fg">
                  <span className="font-medium">Gönderilecek Ürün:</span> {productDetails.name || "Kampanya Ürünü"}
                  {productDetails.description ? ` — ${productDetails.description}` : ""}
                  {productDetails.estimatedValueTry ? ` (Tahmini değer: ₺${productDetails.estimatedValueTry})` : ""}
                </div>
              ) : null}
              {o.status === "KARSI_TEKLIF" && o.counterKurus ? (
                <p className="text-[13px] text-amber-600 dark:text-amber-400">
                  {o.counterByRole === "BRAND" ? tt("Marka farklı bir fiyat talep etti:") : tt("Önerdiğiniz karşı fiyat:")}{" "}
                  <strong>
                    {formatDualMinor(o.counterKurus, "TRY", {
                      viewerCurrency: myCur !== "TRY" ? myCur : viewerCur,
                      perspective: myCur !== "TRY" ? "influencer" : "brand",
                      fx: pricing.fx,
                    })}
                  </strong>
                  {o.counterNote ? ` · ${o.counterNote}` : ""}
                </p>
              ) : null}
              <ul className="flex flex-wrap gap-2 text-[12px] text-fg">
                {itemsSummary(o.items).map((t) => (
                  <li key={t} className="rounded-full border border-line px-2.5 py-0.5">{t}</li>
                ))}
                {o.publishBy ? <li className="rounded-full border border-line px-2.5 py-0.5">{tt("Yayın:")}{" "}{fmtDate(o.publishBy)}</li> : null}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <span className="text-[12px] text-fg-passive">
                  {fmtDate(o.createdAt)} {expiryText(o.expiresAt, o.status)}
                  {o.responseNote ? ` · Not: ${o.responseNote}` : ""}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {o.campaignId && deliverableByCampaign.get(o.campaignId) ? (
                    <ButtonLink href={`/influencer/isler/${deliverableByCampaign.get(o.campaignId)}`} variant="secondary" size="sm">
                      {tt("Kampanyaya Git →")}
                    </ButtonLink>
                  ) : null}
                  {actionable && (o.status === "GONDERILDI" || (o.status === "KARSI_TEKLIF" && o.counterByRole === "BRAND")) ? (
                    shipCfg && productDetails ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <OfferAcceptWithShipment
                          offerId={o.id}
                          productDetails={productDetails}
                          savedAddresses={savedAddresses}
                        />
                        <RespondOffer id={o.id} />
                      </div>
                    ) : (
                      <RespondOffer id={o.id} />
                    )
                  ) : null}
                  {actionable && o.status === "GONDERILDI" ? <WithdrawOffer id={o.id} /> : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    );

  const calls =
    openNotApplied.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-fg-muted">{tt("Şu an başvurabileceğiniz açık çağrı yok.")}</p>
    ) : (
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {openNotApplied.map((c) => (
          <li key={c.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-col gap-1">
              <span className="text-[12px] text-fg-muted">{brands.get(c.tenantId) ?? tt("Marka")}</span>
              <span className="text-[17px] font-semibold text-fg">{c.title}</span>
              <span className="text-[12px] text-fg-muted">
                {c.platforms.join(", ") || tt("Tüm platformlar")}
                {c.budgetMinKurus != null || c.budgetMaxKurus != null ? ` · ${c.budgetMinKurus != null ? formatKurus(Number(c.budgetMinKurus)) : "?"} – ${c.budgetMaxKurus != null ? formatKurus(Number(c.budgetMaxKurus)) : "?"}` : ""}
                {c.deadline ? ` · son başvuru ${fmtDate(c.deadline)}` : ""}
              </span>
            </div>
            <p className="line-clamp-4 whitespace-pre-line text-[13px] text-fg-muted">{c.description}</p>
            <details className="rounded-xl border border-line">
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-medium text-fg">{tt("Başvur")}</summary>
              <div className="border-t border-line p-3"><ApplyForm openCallId={c.id} /></div>
            </details>
          </li>
        ))}
      </ul>
    );

  const applications =
    mine.length === 0 ? (
      <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-fg-muted">{tt("Henüz bir çağrıya başvurmadınız.")}</p>
    ) : (
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {mine.map((m) => {
          const p = applicationPill[m.status] ?? { label: m.status, tone: "gray" as const };
          return (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <span className="flex flex-col">
                <span className="font-medium text-fg">{m.openCall.title}</span>
                <span className="text-[12px] text-fg-muted">{brands.get(m.openCall.tenantId) ?? tt("Marka")} · {fmtDate(m.createdAt)}{m.quotedKurus != null ? ` · ${formatKurus(Number(m.quotedKurus))}` : ""}</span>
              </span>
              <Pill tone={p.tone}>{p.label}</Pill>
            </li>
          );
        })}
      </ul>
    );

  const defaultTab = sekme ?? (pending.length ? "gelen" : "cagrilar");
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-title text-fg">{tt("Teklifler")}</h1>
          <p className="text-[14px] text-fg-muted">{tt("Markaların size gönderdiği teklifler ve başvurabileceğiniz açık çağrılar.")}</p>
        </div>
        <ButtonLink href="/profil?sekme=fiyat" variant="secondary" size="sm">{tt("Fiyat listem")}</ButtonLink>
      </header>
      {sonuc === "kabul" || sonuc === "red" ? (
        <p role="status" className="rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] text-fg">
          {sonuc === "kabul" ? tt("Teklifi kabul ettiniz. Ajans kampanyaya ekleyince brief ve tarihler İşlerim'e düşecek.") : tt("Teklifi reddettiniz; markaya notunuz iletildi.")}
        </p>
      ) : null}
      <StatStrip
        stats={[
          { label: "Yanıt bekleyen", value: String(pending.length) },
          { label: "Kabul ettiğim", value: String(offers.filter((o) => o.status === "KABUL" || o.status === "KAMPANYAYA_EKLENDI").length) },
          { label: "Açık çağrı", value: String(openNotApplied.length) },
          { label: "Başvurularım", value: String(mine.length) },
          { label: "Kabul edilen başvuru", value: String(mine.filter((m) => m.status === "KABUL").length) },
          { label: "Toplam teklif", value: String(offers.length) },
        ]}
      />
      <Tabs
        key={defaultTab}
        label={tt("Teklifler")}
        defaultTab={defaultTab}
        tabs={[
          { id: "gelen", label: `Yanıt bekleyen (${pending.length})`, content: offerCards(pending, true, "Yanıt bekleyen teklif yok. Fiyat listenizi doldurun; markalar sizi bulsun.") },
          {
            id: "aktif",
            label: `Aktif Kampanyalar (${activeCampaigns.length})`,
            content: activeCampaigns.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-4 py-10 text-center text-[13px] text-fg-muted">{tt("Şu an aktif kampanyanız bulunmuyor.")}</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {activeCampaigns.map((a) => {
                  const href = a.deliverables[0] ? `/influencer/isler/${a.deliverables[0].id}` : "/influencer";
                  return (
                    <li key={a.id}>
                      <Link href={href} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition-standard hover:border-fg/40">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-fg-muted">{a.campaign.brand.name}</span>
                          <span className="text-[15px] font-semibold text-fg">{a.campaign.name}</span>
                          <span className="text-xs text-fg-passive">{fmtDate(a.campaign.startsAt)} – {fmtDate(a.campaign.endsAt)}</span>
                        </div>
                        <span className="text-xs font-medium text-fg underline underline-offset-4">{tt("Kampanyayı Aç →")}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ),
          },
          { id: "cagrilar", label: `Açık çağrılar (${openNotApplied.length})`, content: calls },
          { id: "basvurularim", label: `Başvurularım (${mine.length})`, content: applications },
          {
            id: "gecmis",
            label: `Geçmiş & Tamamlananlar (${offers.length + completedCampaigns.length})`,
            content: (
              <div className="flex flex-col gap-5">
                {completedCampaigns.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    <h2 className="text-sm font-semibold text-fg">{tt("Tamamlanan / Geçmiş Kampanyalar")}</h2>
                    <ul className="flex flex-col gap-2">
                      {completedCampaigns.map((a) => {
                        const href = a.deliverables[0] ? `/influencer/isler/${a.deliverables[0].id}` : "/influencer";
                        return (
                          <li key={a.id}>
                            <Link href={href} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition-standard hover:border-fg/40">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-fg-muted">{a.campaign.brand.name}</span>
                                <span className="text-[15px] font-semibold text-fg">{a.campaign.name}</span>
                                <span className="text-xs text-fg-passive">{fmtDate(a.campaign.startsAt)} – {fmtDate(a.campaign.endsAt)}</span>
                              </div>
                              <span className="text-xs font-medium text-fg underline underline-offset-4">{tt("Detaya Git →")}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                {offerCards(offers, false, "Henüz teklif yok.")}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
