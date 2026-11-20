import { getTT } from "@/lib/i18n/tt-server";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Actor } from "@infulancer/core/access/actor";
import { prisma } from "@infulancer/core/db";
import { assertCanEditDraft, draftStatus, getCampaignQuickMeta, previewCampaignOffers } from "@infulancer/core/domain/campaign-draft";
import { isWizardStep, prevStepFor, visibleWizardSteps, type WizardStepKey } from "@infulancer/core/domain/campaign-plan";
import { isDomainError } from "@infulancer/core/domain/errors";
import { CampaignMedia } from "@/components/campaign/campaign-media";
import { CampaignActionsMenu } from "@/components/campaign/campaign-hub";
import { fmtTrDate } from "@/lib/format";
import { CheckIcon } from "@/components/icons";
import { pickAvatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/layout";
import { cn } from "@/lib/cn";
import { wizardBase } from "@/lib/campaign-wizard-paths";
import { AGENCY_TZ, fmtDateTime, localDay } from "@/lib/time";
import { countryLabel, currencyOf, formatMinor } from "@infulancer/core/i18n/regions";
import { contentTypeLabels, platformLabels } from "@infulancer/core/domain/labels";
import { AudienceStep, BasicsStep, BriefStep, ContentPlanStep, InfluencerStep, MediaStep, ScheduleStep, SubmitStep, type WizardInfluencer } from "./wizard-steps";
import { ProductShippingStep } from "./product-shipping-step";
import { getCampaignShippingConfig } from "@infulancer/core/shipping/service";

const tl = (k: bigint | number) => (Number(k) > 0 ? (Number(k) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : "");

/** Sihirbaz adım çubuğu: tamamlananlar işaretli, aktif adım vurgulu; taslak açılmadan diğer adımlar kilitli. */
async function Steps({ base, active, done, includeShipping = false }: { base: string | null; active: WizardStepKey; done: Set<string>; includeShipping?: boolean }) {
  const tt = await getTT();
  const steps = visibleWizardSteps(includeShipping);
  const idx = steps.findIndex((s) => s.key === active);
  return (
    <nav aria-label={tt("Kampanya oluşturma adımları")}>
      <p className="mb-2 text-[12px] text-fg-passive tabular-nums">{tt("Adım")}{" "}{Math.max(1, idx + 1)} / {steps.length}
      </p>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-8">
        {steps.map((s, i) => {
          const cur = s.key === active;
          const inner = (
            <>
              <span className="flex items-center gap-2 text-[11px] text-fg-passive">
                <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px]", done.has(s.key) ? "border-fg bg-fg text-bg" : cur ? "border-fg text-fg" : "border-line")} aria-hidden>
                  {done.has(s.key) ? <CheckIcon size={11} /> : i + 1}
                </span>
                <span className="hidden lg:inline">{done.has(s.key) ? tt("Tamam") : cur ? tt("Şu an") : ""}</span>
              </span>
              <span className="text-[13px] leading-tight text-fg">{s.title}</span>
            </>
          );
          const cls = cn("flex h-full flex-col gap-1 rounded-xl border px-2.5 py-2 transition-standard", cur ? "border-fg bg-fg/[0.04]" : "border-line", base ? "hover:border-fg/40" : "opacity-50");
          return (
            <li key={s.key}>
              {base ? (
                <Link href={`${base}?adim=${s.key}`} aria-current={cur ? "step" : undefined} className={cls}>
                  {inner}
                </Link>
              ) : (
                <span aria-current={cur ? "step" : undefined} aria-disabled={!cur} className={cls}>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Kampanya oluşturma sihirbazı (marka ve ajans aynı ekran). campaignId yoksa yalnız 1. adım açılır;
 * kaydedilince taslak oluşur ve diğer adımlara geçilir.
 */
export async function CampaignWizardPage({ actor, campaignId, step: stepRaw, defaultBrandId }: { actor: Actor; campaignId: string | null; step?: string; defaultBrandId?: string }) {
  const tt = await getTT();
  const isBrand = actor.role === "BRAND";
  if (!campaignId) {
    const brands = isBrand ? undefined : await prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader title={tt("Yeni kampanya")} description={tt("8 adım: her adım kaydedilir, istediğiniz an çıkıp taslaktan devam edebilirsiniz.")} />
        <Steps base={null} active="temel" done={new Set()} />
        <Card interactive={false} className="flex flex-col gap-2">
          <h2 className="text-section">{tt("1. Temel bilgiler")}</h2>
          <BasicsStep brands={brands} values={defaultBrandId ? { name: "", objective: null, description: null, brandId: defaultBrandId } : undefined} />
        </Card>
      </div>
    );
  }
  try {
    await assertCanEditDraft(actor, campaignId);
  } catch (e) {
    if (isDomainError(e) && e.code === "BULUNAMADI") notFound();
    if (isDomainError(e)) {
      return (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          <PageHeader title={tt("Kampanya düzenlenemiyor")} description={e.message} />
          <Link href={isBrand ? `/marka/kampanyalar/${campaignId}` : `/admin/kampanyalar/${campaignId}`} className="text-sm underline underline-offset-4">{tt("Kampanyaya dön")}</Link>
        </div>
      );
    }
    throw e;
  }
  const step: WizardStepKey = isWizardStep(stepRaw) ? stepRaw : "temel";
  const base = wizardBase(actor.role, campaignId);
  const [{ campaign: c, checks, ready, plan }, cfg, quickMeta] = await Promise.all([
    draftStatus(campaignId),
    getCampaignShippingConfig(campaignId),
    getCampaignQuickMeta(campaignId),
  ]);
  const includeShipping = c.objective === "urun_gonderimi" || cfg.requiresProductShipment;
  const steps = visibleWizardSteps(includeShipping);
  const back = prevStepFor(step, includeShipping);
  const backHref = back ? `${base}?adim=${back}` : "";
  const done = new Set(checks.filter((x) => x.ok && (x.key !== "medya" || c._count.assets > 0) && (x.key !== "influencer" || c.shortlistInfluencerIds.length > 0)).map((x) => x.key));
  if (ready) done.add("ozet");
  const meta = steps.find((s) => s.key === step) ?? steps[0]!;
  const idx = Math.max(0, steps.findIndex((s) => s.key === step));
  const [brand, brandIntegrations] = await Promise.all([
    prisma.brand.findUniqueOrThrow({ where: { id: c.brandId }, select: { name: true } }),
    prisma.brandShippingIntegration.findMany({ where: { brandId: c.brandId }, select: { senderAddress: true } }),
  ]);
  const brandHasSenderAddress = brandIntegrations.some((i) => Boolean(i.senderAddress));

  let body: React.ReactNode = null;
  if (step === "temel") {
    body = (
      <BasicsStep
        id={c.id}
        values={{
          name: c.name,
          objective: c.objective,
          secondaryObjective: quickMeta.secondaryObjective ?? null,
          description: c.description,
          brandId: c.brandId,
        }}
      />
    );
  } else if (step === "kitle") {
    const dbCategories = await prisma.category.findMany({ select: { name: true }, orderBy: { name: "asc" }, take: 50 });
    body = (
      <AudienceStep
        id={c.id}
        backHref={backHref}
        categoryOptions={dbCategories.map((cat) => cat.name)}
        values={{ targetCountries: c.targetCountries, platforms: c.platforms, audienceAgeMin: c.audienceAgeMin, audienceAgeMax: c.audienceAgeMax, audienceGender: c.audienceGender, audienceInterests: c.audienceInterests }}
      />
    );
  } else if (step === "butce") {
    body = (
      <ScheduleStep
        id={c.id}
        backHref={backHref}
        isAdmin={!isBrand}
        values={{ startsAt: localDay(c.startsAt, AGENCY_TZ), endsAt: localDay(c.endsAt, AGENCY_TZ), brandTotalFee: tl(c.brandTotalFeeKurus), budget: tl(c.budgetKurus), currency: c.currency }}
      />
    );
  } else if (step === "icerik") {
    body = <ContentPlanStep id={c.id} backHref={backHref} plan={plan} platforms={c.platforms} />;
  } else if (step === "brief") {
    const b = await prisma.campaignBrief.findFirst({ where: { campaignId: c.id }, orderBy: { version: "desc" } });
    body = <BriefStep id={c.id} backHref={backHref} advertiser={brand.name} latest={b ? { text: b.text, dos: b.dos, donts: b.donts, hashtags: b.hashtags, mentions: b.mentions, disclosureRequired: b.disclosureRequired, version: b.version } : null} />;
  } else if (step === "medya") {
    const assets = await prisma.asset.findMany({ where: { campaignId: c.id, uploadStatus: "TAMAM" }, orderBy: { createdAt: "desc" }, include: { uploadedBy: { select: { name: true } } } });
    body = (
      <MediaStep
        id={c.id}
        backHref={backHref}
        gallery={
          <CampaignMedia
            items={assets.map((a) => ({ id: a.id, fileName: a.fileName, mime: a.mime, kind: a.kind, size: a.size, uploadedById: a.uploadedById, uploadedByName: a.uploadedBy.name }))}
            canDelete={(m) => !isBrand || m.uploadedById === actor.userId}
          />
        }
      />
    );
  } else if (step === "urun") {
    body = <ProductShippingStep id={c.id} backHref={backHref} initial={cfg} hasBrandSenderAddress={brandHasSenderAddress} />;
  } else if (step === "influencer") {
    const rows = await prisma.influencer.findMany({
      // Çoklu ülke ve global influencer seçimi: vitrinde görünür tüm influencerlar listelenir, hedef ülke olanlar üstte sıralanır.
      where: { isActive: true, ...(isBrand ? { showcaseVisible: true } : {}) },
      orderBy: { name: "asc" },
      take: 500,
      select: {
        id: true,
        name: true,
        category: true,
        city: true,
        country: true,
        avatarKey: true,
        socialAccounts: { select: { platform: true, handle: true, followers: true, engagementRate: true, avatarUrl: true, verified: true, tokenRef: true, syncSource: true } },
      },
    });
    const infIds = rows.map((r) => r.id);
    const rateCardRows = infIds.length
      ? await prisma.rateCard.findMany({
        where: { influencerId: { in: infIds }, active: true },
        select: { influencerId: true, priceKurus: true },
      })
      : [];
    const rateCardsByInf = new Map<string, number[]>();
    for (const rc of rateCardRows) {
      const arr = rateCardsByInf.get(rc.influencerId) ?? [];
      arr.push(rc.priceKurus);
      rateCardsByInf.set(rc.influencerId, arr);
    }
    const targetSet = new Set(c.targetCountries);
    const interestSet = new Set(c.audienceInterests.map((x) => x.toLocaleLowerCase("tr")));
    const platformSet = new Set(c.platforms);
    const list: WizardInfluencer[] = rows.map((i) => {
      const igAcc = i.socialAccounts.find((s) => s.platform === "INSTAGRAM") ?? i.socialAccounts[0];
      const followers = i.socialAccounts.reduce((s, a) => s + a.followers, 0);
      const rawEr = igAcc?.engagementRate != null ? Number(igAcc.engagementRate) : null;
      const er = rawEr != null && rawEr > 0 ? rawEr : null;
      const verified = i.socialAccounts.some((s) => Boolean(s.verified || s.tokenRef || (s.syncSource && s.syncSource !== "manual")));
      const platforms = [...new Set(i.socialAccounts.map((s) => s.platform))];
      // Yapılandırılmış veriden deterministik uyum skoru ve gerekçeler
      const reasons: string[] = [];
      let score = 35;
      const catLower = i.category.toLocaleLowerCase("tr");
      if (interestSet.size > 0 && interestSet.has(catLower)) {
        score += 25;
        reasons.push(`Kategori eşleşiyor (${i.category})`);
      }
      if (targetSet.has(i.country)) {
        score += 10;
        reasons.push(`Hedef ülke (${countryLabel(i.country)})`);
      }
      if (platforms.some((p) => platformSet.has(p))) {
        score += 10;
      }
      if (er != null && er >= 0.03) {
        score += 12;
        reasons.push(`Yüksek etkileşim (ER %${(er * 100).toFixed(1).replace(".", ",")})`);
      } else if (er != null && er >= 0.015) {
        score += 6;
      }
      if (verified) {
        score += 8;
        reasons.push("Bağlı hesap (doğrulanmış veri)");
      }
      const fees = rateCardsByInf.get(i.id) ?? [];
      const estimatedFeeKurus =
        fees.length > 0 ? fees.reduce((sum, f) => sum + f, 0) / fees.length : null;
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        city: [i.city, `${countryLabel(i.country)} (${currencyOf(i.country)})`].filter(Boolean).join(", "),
        avatarUrl: pickAvatar(i.socialAccounts, i.avatarKey),
        platforms,
        followers,
        er,
        handle: igAcc?.handle ? igAcc.handle.replace(/^@+/, "") : null,
        verified,
        matchScore: Math.min(100, Math.round(score)),
        matchReasons: reasons.slice(0, 3),
        estimatedFeeKurus: estimatedFeeKurus != null ? Math.round(estimatedFeeKurus) : null,
      };
    });
    // Varsayılan sıralama: uyum puanı, eşitlikte doğrulanmış veri önce.
    list.sort((a, b) => {
      if ((b.matchScore ?? 0) !== (a.matchScore ?? 0)) return (b.matchScore ?? 0) - (a.matchScore ?? 0);
      if (Boolean(b.verified) !== Boolean(a.verified)) return Number(Boolean(b.verified)) - Number(Boolean(a.verified));
      return a.name.localeCompare(b.name, "tr");
    });
    const effectiveBudgetKurus = Number(c.brandTotalFeeKurus || c.budgetKurus);
    const campaignSummary = {
      name: c.name,
      objective: c.objective,
      dates: `${fmtTrDate(localDay(c.startsAt, AGENCY_TZ))} – ${fmtTrDate(localDay(c.endsAt, AGENCY_TZ))}`,
      budgetLabel: effectiveBudgetKurus > 0 ? formatMinor(effectiveBudgetKurus, c.currency) : "Belirlenmedi",
      budgetKurus: effectiveBudgetKurus,
      currency: c.currency,
      countriesLabel: c.targetCountries.map((x) => countryLabel(x)).join(", ") || "Tümü",
      planSummary: plan.map((p) => `${p.count}x ${platformLabels[p.platform]} ${contentTypeLabels[p.contentType]}`),
    };
    body = (
      <InfluencerStep
        id={c.id}
        backHref={backHref}
        influencers={list}
        selected={c.shortlistInfluencerIds}
        campaignSummary={campaignSummary}
        profileBaseHref={isBrand ? "/marka/kesfet" : "/admin/influencerlar"}
        note="Beğendiğiniz influencerları kısa listeye ekleyin. Teklifler otomatik gönderilmez; özet adımında onayınızla iletilir."
      />
    );
  } else {
    const offerPreview = await previewCampaignOffers(actor, c.id).catch(() => undefined);
    body = (
      <SubmitStep
        id={c.id}
        backHref={backHref}
        checks={checks}
        ready={ready}
        isBrand={isBrand}
        submittedAt={c.submittedAt ? fmtDateTime(c.submittedAt, AGENCY_TZ) : null}
        base={base}
        offerPreview={offerPreview}
      />
    );
  }
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        title={c.name}
        description={`${isBrand ? "" : `${brand.name} · `}${c.status === "AKTIF" ? "Aktif" : "Taslak"}${c.submittedAt ? " · kaydedildi" : ""}. Her adımın altındaki “Kaydet ve devam” bilgileri kaydeder.`}
        actions={
          <CampaignActionsMenu
            campaignId={c.id}
            campaignName={c.name}
            viewHref={isBrand ? `/marka/kampanyalar/${c.id}` : `/admin/kampanyalar/${c.id}`}
          />
        }
      />
      <Steps base={base} active={step} done={done} includeShipping={includeShipping} />
      <Card interactive={false} className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <h2 className="text-section">
            {idx + 1}. {meta.title}
          </h2>
          <p className="text-[13px] text-fg-muted">{meta.hint}</p>
        </div>
        {body}
      </Card>
    </div>
  );
}
