import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@infulancer/core/db";
import { aiDisclosureChecklist } from "@infulancer/core/creative/c2pa";
import { ensureStarterCredits } from "@infulancer/core/creative/credits";
import { AGENCY_TENANT, tenantCurrency } from "@infulancer/core/creative/tenant";
import { ownTenant } from "@/lib/creative-tenant";
import { PhonePreviewButton } from "@/components/creative/phone-preview-button";
import { allowedDurations, modelSpec, supportedAspects } from "@infulancer/core/creative/adapters";
import { rateFromTry, creativePricing } from "@infulancer/core/creative/pricing";
import { reconcileStaleJobs } from "@infulancer/core/creative/fal";
import { PricingForm } from "@/components/creative/pricing-form";
import { CreditRequestForm } from "@/components/creative/credit-request-form";
import { StudioEditor, type StudioUpload } from "@/components/creative/studio-editor";
import { VideoStudioPipeline } from "@/components/creative/video-studio-pipeline";
import { AssetThumb } from "@/components/creative/asset-thumb";
import { listSavedPromptsForTenant, openAssetInStudioAction, saveAssetToLibraryAction, saveFalKeyAction } from "@/lib/actions/creative-studio";
import { resolveFalKey } from "@infulancer/core/creative/fal";
import { getConfig } from "@infulancer/core/config/store";
import { withUnverified } from "@infulancer/core/unverified";
import { CreativeComposer, type ChatHistoryItem, type ComposerModel } from "@/components/creative/creative-composer";
import { KindIcon } from "@/components/creative/kind-icon";
import { ActionForm } from "@/components/forms/action-form";
import { TopUpForm } from "@/components/forms/operations-forms";
import { FilterTabs, Pill, SectionHead, StatStrip } from "@/components/luma/primitives";
import { DocLink } from "@/components/docs/doc-components";
import { UnverifiedBadge } from "@/components/ui/unverified";
import { requireActor } from "@/lib/auth-guard";
import { asKind, fmtTl, KIND_LABEL, modelName, needsReference, toneFor, type CreativeKind } from "@/lib/creative-models";
import { fmtDateTime } from "@/lib/time";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Nordvow Creative AI" };
export const dynamic = "force-dynamic";

const usd = new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 4 });

type Tab = "uret" | "galeri" | "studyo" | "yonetim";
type SP = {
  sekme?: string;
  tur?: string;
  asset?: string;
  prompt?: string;
  ref?: string;
  hesap?: string;
  dosya?: string;
  hata?: string;
};

/**
 * Creative AI Stüdyo:
 * Sade, modern bir AI Chat Video & Fotoğraf oluşturma ve kitaplık uygulaması.
 */
export default async function CreativePage({ searchParams }: { searchParams: Promise<SP> }) {
  const tt = await getTT();
  const actor = await requireActor();
  const sp = await searchParams;
  const isAdmin = actor.role === "ADMIN";
  const own = ownTenant(actor);
  const accCurrency = await tenantCurrency(own);
  if (!isAdmin) await ensureStarterCredits(own);
  const scope = { tenantId: own };
  const pendingCreditReq =
    !isAdmin && !!(await prisma.creditRequest.findFirst({ where: { tenantId: own, status: "BEKLIYOR" }, select: { id: true } }));

  void reconcileStaleJobs().catch(() => { });

  const [pricing, starterCreditsTry, ledger] = await Promise.all([
    creativePricing(),
    getConfig("creative.starterCreditsTry"),
    prisma.creditLedger.findMany({
      where: isAdmin ? {} : { tenantId: own },
      orderBy: { createdAt: "desc" },
      take: isAdmin ? 60 : 25,
    }),
  ]);

  const [models, flags, brands, influencers, accounts, jobs, assets, library] = await Promise.all([
    prisma.modelRegistry.findMany({ orderBy: [{ kind: "asc" }, { creditsPerUnit: "asc" }] }),
    getConfig("features"),
    prisma.brand.findMany({
      where: isAdmin ? {} : { id: actor.brandId ?? "-" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.influencer.findMany({
      where: isAdmin ? {} : { id: actor.influencerId ?? "-" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, category: true },
    }),
    prisma.creditAccount.findMany({ where: isAdmin ? {} : scope }),
    prisma.creativeJob.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 30 }),
    prisma.generatedAsset.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 60 }),
    prisma.creativeUpload.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 120 }),
  ]);

  const nameOf = new Map<string, string>([
    [AGENCY_TENANT, "Ajans Stüdyosu"],
    ...brands.map((b) => [b.id, b.name] as const),
    ...influencers.map((i) => [i.id, i.name] as const),
  ]);
  const kindOf = new Map(models.map((m) => [m.key, asKind(m.kind)]));
  const avail = (tenantId: string) => {
    const a = accounts.find((x) => x.tenantId === tenantId);
    return a ? Number(a.balanceCredits) - Number(a.heldCredits) : 0;
  };

  const currency = accCurrency;
  const rate = rateFromTry(pricing, currency);
  const minCharge = currency === "TRY" ? pricing.minTry : Math.ceil(pricing.minTry * rate * 100 - 1e-9) / 100;
  const priceOf = (key: string, fallback: number) => Number(models.find((m) => m.key === key)?.creditsPerUnit ?? fallback) * rate;
  const money = (n: number) => fmtTl(n, currency);

  const usable: ComposerModel[] = models
    .filter(
      (m) =>
        m.status === "active" &&
        m.licenseStatus === "cleared" &&
        (!m.featureFlag || flags[m.featureFlag]) &&
        m.provider === "fal" &&
        asKind(m.kind) &&
        !needsReference(m.key) &&
        modelSpec(m.key),
    )
    .map((m) => ({
      key: m.key,
      kind: asKind(m.kind)!,
      unit: m.unit,
      creditsPerUnit: Number(m.creditsPerUnit) * rate,
      maxUnits: m.maxUnits,
      durations: allowedDurations(m.key),
      aspects: supportedAspects(m.key),
    }));

  const tenants = isAdmin
    ? [
      { id: AGENCY_TENANT, name: "Ajans (kendi hesabı)", group: "Ajans" as const },
      ...brands.map((b) => ({ id: b.id, name: b.name, group: "Markalar" as const })),
      ...influencers.map((i) => ({ id: i.id, name: i.name, group: "Influencerlar" as const })),
    ]
    : [];

  const jobPrompt = new Map(jobs.map((j) => [j.id, j.prompt]));
  const missingJobIds = assets.map((a) => a.jobId).filter((id): id is string => !!id && !jobPrompt.has(id));
  if (missingJobIds.length) {
    for (const j of await prisma.creativeJob.findMany({ where: { id: { in: missingJobIds } }, select: { id: true, prompt: true } })) {
      jobPrompt.set(j.id, j.prompt);
    }
  }

  // Üretilen asset'ler ile Kitaplık (creative_uploads) kayıtlarını eşleştir
  const uploadByS3Key = new Map(library.map((u) => [u.s3Key, u]));
  const assetByJobId = new Map(assets.filter((a) => a.jobId).map((a) => [a.jobId!, a]));

  // Sohbet geçmişi: kullanıcının son işleri ve üretilen video/fotoğraf kartları
  const chatHistory: ChatHistoryItem[] = jobs
    .filter((j) => j.status === "COMPLETED" || j.status === "FAILED" || j.status === "REJECTED")
    .slice(0, 12)
    .map((j) => {
      const a = assetByJobId.get(j.id) ?? null;
      const libEntry = a ? uploadByS3Key.get(a.s3Key) : undefined;
      return {
        jobId: j.id,
        prompt: j.prompt,
        kind: j.prompt.startsWith("Videoya Seslendirme:") ? ("video" as const) : (kindOf.get(j.modelKey) ?? "image"),
        modelKey: j.modelKey,
        status: j.status,
        assetId: a?.id ?? null,
        uploadId: libEntry?.id ?? null,
        rejectReason: j.rejectReason ?? null,
        createdAt: j.createdAt.toISOString(),
      };
    });

  const runningJob = jobs.find((j) => j.status === "HELD" || j.status === "IN_QUEUE" || j.status === "IN_PROGRESS");
  const initialActiveJob = runningJob
    ? {
      jobId: runningJob.id,
      kind: runningJob.prompt.startsWith("Videoya Seslendirme:") ? ("video" as const) : (kindOf.get(runningJob.modelKey) ?? "image"),
      format: "9:16",
      prompt: runningJob.prompt,
      modelKey: runningJob.modelKey,
    }
    : null;

  const studioUploads: StudioUpload[] = library.map((u) => ({
    id: u.id,
    kind: u.kind === "video" ? "video" : "image",
    name: u.name,
    mime: u.mime,
    sizeBytes: u.sizeBytes,
    source: u.source,
    durationSec: u.durationSec,
    createdAt: u.createdAt.toISOString(),
  }));

  const studioPrices = {
    currency,
    minTry: minCharge,
    promptEdit: priceOf("nano-banana-edit", 6),
    bgRemove: priceOf("bria-bg-remove", 3),
    upscale: priceOf("esrgan-upscale", 1),
    i2vPerSec: priceOf("kling-v2-5-i2v", 11),
    i2vEcoPerSec: priceOf("hailuo-02-fast-i2v", 3),
  };

  const available = avail(own);
  const completed = jobs.filter((j) => j.status === "COMPLETED").length;
  const adBase = actor.role === "ADMIN" ? "/admin/reklam" : actor.role === "BRAND" ? "/marka/reklam" : null;

  const [savedPrompts, currentFalKey] = await Promise.all([
    listSavedPromptsForTenant(own),
    isAdmin ? resolveFalKey() : Promise.resolve(""),
  ]);

  const rawTab = sp.sekme === "kitaplik" ? "galeri" : sp.sekme;
  const tab: Tab =
    rawTab === "galeri" || rawTab === "studyo" || (rawTab === "yonetim" && isAdmin)
      ? (rawTab as Tab)
      : "uret";

  // Kitaplık toplam öğe sayısı (hem yüklemeler hem AI çıktıları, s3Key ile tekilleştirilmiş)
  const uniqueLibraryCount = new Set([...library.map((u) => u.s3Key), ...assets.map((a) => a.s3Key)]).size;
  const profileName = nameOf.get(own) ?? "Stüdyo";

  const tabs = [
    { id: "uret", label: "Nordvow Creative AI", href: "/creative" },
    { id: "galeri", label: "Kitaplık", href: "/creative?sekme=galeri", count: uniqueLibraryCount },
    { id: "studyo", label: "Düzenleyici", href: "/creative?sekme=studyo" },
    ...(isAdmin ? [{ id: "yonetim", label: "Yönetim", href: "/creative?sekme=yonetim" }] : []),
  ];

  const initialKind: CreativeKind | undefined =
    sp.tur === "video" || sp.tur === "image" || sp.tur === "audio" ? sp.tur : undefined;

  return (
    <div
      className={
        tab === "uret"
          ? "flex min-h-[calc(100dvh-9.5rem)] w-full flex-1 flex-col gap-3 lg:h-[calc(100dvh-4.5rem)] lg:max-h-[calc(100dvh-4.5rem)] lg:overflow-hidden"
          : "flex min-h-[calc(100dvh-5.5rem)] w-full flex-1 flex-col gap-3"
      }
    >
      {/* Sade Üst Stüdyo Çubuğu */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-line bg-surface px-3 py-2 sm:gap-3 sm:px-5">
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight text-fg">{tt("Nordvow Creative AI")}</h1>
            <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted sm:inline-block">
              {profileName}
            </span>
          </div>
          <div className="max-w-full overflow-x-auto [scrollbar-width:none]">
            <FilterTabs items={tabs} active={tab} />
          </div>
        </div>

        {/* Sağ Bakiye & Açılır Bakiye Yönetimi */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-full border border-line bg-bg px-3 py-1">
            <span className="text-[11px] text-fg-muted">{tt("Kredi:")}</span>
            <span className="text-[13px] font-semibold tabular-nums text-fg">{money(available)}</span>
          </div>
          {!isAdmin ? (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-full border border-line bg-surface px-3 py-1 text-[12px] font-medium text-fg hover:border-fg/40">
                {pendingCreditReq ? tt("Talep İnceleniyor") : tt("+ Kredi Yükle")}
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-3 shadow-xl sm:w-96">
                <CreditRequestForm pending={pendingCreditReq} currency={currency} />
                {ledger.length ? (
                  <div className="mt-3">
                    <p className="mb-1.5 px-1 text-[11px] font-medium text-fg-muted">{tt("Son Bakiye Hareketleri")}</p>
                    <LedgerList rows={ledger.slice(0, 8)} currencyOf={() => currency} />
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </header>

      {/* 1. Sekme: AI Sohbet Video & Fotoğraf Oluşturucu */}
      {tab === "uret" ? (
        <CreativeComposer
          key={`${sp.prompt ?? ""}-${sp.ref ?? ""}-${sp.tur ?? ""}`}
          minTry={minCharge}
          currency={currency}
          models={usable}
          available={available}
          username={profileName.split(" ")[0]!.toLocaleLowerCase("tr")}
          profileLabel={profileName}
          library={library.map((u) => ({
            id: u.id,
            kind: u.kind === "video" ? "video" : "image",
            name: u.name,
            source: u.source,
          }))}
          refPrices={{
            imageEdit: priceOf("nano-banana-edit", 6),
            klingI2v: priceOf("kling-v2-5-i2v", 11),
            ecoI2v: priceOf("hailuo-02-fast-i2v", 3),
          }}
          initialPrompt={(sp.prompt ?? "").slice(0, 2000)}
          initialKind={initialKind}
          initialRefId={sp.ref}
          initialHistory={chatHistory}
          initialActiveJob={initialActiveJob}
          initialSavedPrompts={savedPrompts}
        />
      ) : null}

      {/* 2. Sekme: Birleşik Kitaplık (Üretilen & Yüklenen Tüm Videolar ve Fotoğraflar) */}
      {tab === "galeri" && sp.hata ? (
        <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-[13px] text-critical">
          {sp.hata.slice(0, 200)}
        </p>
      ) : null}
      {tab === "galeri" ? (
        <UnifiedLibrary
          assets={assets}
          uploads={library}
          uploadByS3Key={uploadByS3Key}
          kindOf={kindOf}
          jobPrompt={jobPrompt}
          adBase={adBase}
          filter={sp.tur}
          completed={completed}
        />
      ) : null}

      {/* 3. Sekme: Düzenleyici (Video & Fotoğraf Stüdyosu) */}
      {tab === "studyo" ? (
        <div className="flex flex-col gap-6">
          <VideoStudioPipeline uploads={studioUploads} />
          <StudioEditor
            uploads={studioUploads}
            available={available}
            prices={studioPrices}
            isAdmin={isAdmin}
            initialSelected={sp.dosya}
          />
        </div>
      ) : null}

      {/* 4. Sekme: Yönetici Bakiye, fal.ai API & Model Yönetimi */}
      {tab === "yonetim" && isAdmin ? (
        <div className="flex flex-col gap-6">
          <StatStrip
            stats={[
              { label: "Hesap", value: String(accounts.length) },
              {
                label: "Toplam kredi bakiyesi",
                value: fmtTl(accounts.filter((a) => a.currency === "TRY").reduce((s, a) => s + Number(a.balanceCredits), 0)),
              },
              {
                label: "Blokede kredi",
                value: fmtTl(accounts.filter((a) => a.currency === "TRY").reduce((s, a) => s + Number(a.heldCredits), 0)),
              },
              { label: "Son işler", value: String(jobs.length) },
              { label: "Tamamlanan", value: String(completed) },
              { label: "Aktif model", value: String(usable.length) },
            ]}
          />
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <SectionHead title={tt("fal.ai API Bağlantısı (FAL_KEY)")} />
            <p className="text-[12px] text-fg-muted">
              {currentFalKey
                ? tt("fal.ai API anahtarı tanımlı ve aktif. Tüm görsel, video ve ses modelleri doğrudan fal.ai üzerinden çalışır.")
                : tt("fal.ai API anahtarınızı (key_id:key_secret) aşağıya girerek FLUX Schnell, Recraft V3, Ideogram V3, Kling ve ElevenLabs modellerini doğrudan fal.ai kuyruğuna bağlayabilirsiniz.")}
            </p>
            <ActionForm action={saveFalKeyAction} submitLabel={tt("fal.ai Anahtarını Kaydet")}>
              <input
                type="password"
                name="falKey"
                defaultValue={currentFalKey}
                placeholder="key_id:key_secret"
                className="h-9 w-full max-w-md rounded-xl border border-line bg-bg px-3 text-sm text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
              />
            </ActionForm>
          </section>
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <SectionHead title={tt("Fiyatlandırma")} />
              <p className="text-[12px] text-fg-muted">
                {tt("Fiyat = sağlayıcı USD maliyeti × kur (")}
                {pricing.usdTry.toLocaleString("tr-TR")} {tt("TL")}
                {pricing.fxUpdatedAt ? `, ${fmtDateTime(new Date(pricing.fxUpdatedAt))}` : ""}) × {pricing.markup}{" "}
                {tt("· iş başına en az")} {fmtTl(pricing.minTry)}
                {tt(". Kur her açılışta güncellenir.")}
              </p>
              <PricingForm markup={pricing.markup} minTry={pricing.minTry} usdTry={pricing.usdTry} autoFx={pricing.autoFx} />
              <SectionHead title={tt("Bakiye yükle")} />
              <TopUpForm
                label={tt("Hesap")}
                brands={tenants.map((t) => ({
                  id: t.id,
                  name: t.group === "Ajans" ? t.name : `${t.group === "Markalar" ? "Marka" : "Influencer"} · ${t.name}`,
                }))}
              />
              <p className="text-[12px] text-fg-passive">
                {tt("Tutarlar Kredi cinsindendir. Yeni marka/influencer ilk girişte")}{" "}
                {fmtTl(starterCreditsTry)} {tt("hoş geldin kredisi alır.")}{" "}
                <Link href="/admin/krediler" className="underline hover:text-fg">{tt("Kredi yönetiminden düzenle →")}</Link>
              </p>
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <SectionHead title={tt("Bakiyeler")} />
              <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto text-sm">
                {accounts.length === 0 ? <li className="py-2 text-fg-muted">{tt("Henüz hesap yok.")}</li> : null}
                {accounts.map((a) => (
                  <li key={a.tenantId} className="flex justify-between gap-2 py-2">
                    <span className="truncate">{nameOf.get(a.tenantId) ?? a.tenantId.slice(-6)}</span>
                    <span className="shrink-0 tabular-nums text-fg-muted">
                      {fmtTl(Number(a.balanceCredits), a.currency)}
                      {Number(a.heldCredits) ? ` · ${fmtTl(Number(a.heldCredits), a.currency)} blokede` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <DocLink slug="kredi-ve-maliyet" />
            </div>
          </section>
          {ledger.length ? (
            <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface">
              <div className="px-4 pt-4">
                <SectionHead title={tt("Son bakiye hareketleri (tüm hesaplar)")} />
              </div>
              <LedgerList
                currencyOf={(t) => accounts.find((a) => a.tenantId === t)?.currency ?? "TRY"}
                rows={ledger.map((r) => ({
                  ...r,
                  note: `${nameOf.get(r.tenantId) ?? r.tenantId.slice(-6)}${r.note ? ` · ${r.note}` : ""}`,
                }))}
              />
            </section>
          ) : null}
          <section className="flex flex-col gap-3">
            <SectionHead title={tt("Model kaydı")} action={<DocLink slug="model-kaydi-ve-lisans" />} />
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[640px] text-sm">
                <caption className="sr-only">{tt("Model listesi ve fiyatları")}</caption>
                <thead className="bg-fg/[0.03]">
                  <tr className="text-left text-[12px] text-fg-muted">
                    <th className="px-4 py-2 font-medium">{tt("Model")}</th>
                    <th className="px-4 py-2 font-medium">{tt("Tür")}</th>
                    <th className="px-4 py-2 font-medium">{tt("Birim fiyat")}</th>
                    <th className="px-4 py-2 font-medium">{tt("Fiyat")}</th>
                    <th className="px-4 py-2 font-medium">{tt("Lisans")}</th>
                    <th className="px-4 py-2 font-medium">{tt("Durum")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {models.map((m) => (
                    <tr key={m.key} className="align-top">
                      <td className="px-4 py-2">
                        {modelName(m.key)}
                        <span className="block text-[11px] text-fg-passive">{m.modelId}</span>
                      </td>
                      <td className="px-4 py-2">{m.kind}</td>
                      <td className="px-4 py-2 tabular-nums">
                        {withUnverified(`${usd.format(Number(m.unitPriceUsd))} / ${m.unit}`, m.priceVerified)}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{fmtTl(Number(m.creditsPerUnit))}</td>
                      <td className="px-4 py-2">
                        <Pill tone={m.licenseStatus === "cleared" ? "green" : "amber"}>
                          {m.licenseStatus === "cleared" ? tt("Onaylı") : tt("Bekliyor")}
                        </Pill>
                      </td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1">
                          {m.status === "active" ? tt("Aktif") : m.status}
                          {m.replacementKey ? ` → ${m.replacementKey}` : ""}
                          {m.emitsC2pa == null ? (
                            <UnverifiedBadge title={tt("Çıktının C2PA taşıyıp taşımadığı ampirik olarak test edilmedi.")} />
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <SectionHead title={tt("AI açıklama kontrol listesi")} action={<DocLink slug="ai-icerik-aciklamasi" />} />
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-fg-muted">
              {aiDisclosureChecklist.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}

type UnifiedLibraryItem = {
  id: string;
  assetId: string | null;
  uploadId: string | null;
  kind: CreativeKind;
  title: string;
  subtitle: string;
  sourceLabel: string;
  savedInLibrary: boolean;
  createdAt: Date;
};

/**
 * Birleşik Kitaplık:
 * Hem AI Sohbette üretilen video/fotoğrafları hem de kullanıcının yüklediği veya düzenlediği
 * video/fotoğrafları tek bir sade kitaplıkta gösterir.
 */
async function UnifiedLibrary({
  assets,
  uploads,
  uploadByS3Key,
  kindOf,
  jobPrompt,
  adBase,
  filter,
}: {
  assets: { id: string; tenantId: string; jobId: string | null; modelKey: string; s3Key: string; c2paManifestId: string; createdAt: Date }[];
  uploads: { id: string; kind: string; name: string | null; s3Key: string; source: string; createdAt: Date }[];
  uploadByS3Key: Map<string, { id: string; kind: string; name: string | null; s3Key: string; source: string; createdAt: Date }>;
  kindOf: Map<string, CreativeKind | null>;
  jobPrompt: Map<string, string>;
  adBase: string | null;
  filter?: string;
  completed: number;
}) {
  const tt = await getTT();
  const active: CreativeKind | "hepsi" =
    filter === "image" || filter === "video" || filter === "audio" ? filter : "hepsi";

  const seenS3Keys = new Set<string>();
  const items: UnifiedLibraryItem[] = [];

  for (const a of assets) {
    seenS3Keys.add(a.s3Key);
    const k = kindOf.get(a.modelKey) ?? "image";
    const prompt = (a.jobId ? jobPrompt.get(a.jobId) : undefined) ?? "";
    const basePrompt = prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim();
    const linkedUpload = uploadByS3Key.get(a.s3Key);
    items.push({
      id: a.id,
      assetId: a.id,
      uploadId: linkedUpload?.id ?? null,
      kind: k,
      title: basePrompt || linkedUpload?.name || modelName(a.modelKey),
      subtitle: `${modelName(a.modelKey)} · C2PA ${a.c2paManifestId.slice(0, 6)}`,
      sourceLabel: "AI Üretimi",
      savedInLibrary: !!linkedUpload || k === "audio",
      createdAt: a.createdAt,
    });
  }

  for (const u of uploads) {
    if (seenS3Keys.has(u.s3Key)) continue;
    const k: CreativeKind = u.kind === "video" ? "video" : "image";
    items.push({
      id: u.id,
      assetId: null,
      uploadId: u.id,
      kind: k,
      title: u.name || (k === "video" ? "Video" : "Fotoğraf"),
      subtitle: u.source === "edit" ? "Stüdyoda düzenlendi" : u.source === "ai" ? "AI Stüdyo" : "Yüklendi",
      sourceLabel: u.source === "edit" ? "Düzenlendi" : u.source === "ai" ? "AI" : "Yükleme",
      savedInLibrary: true,
      createdAt: u.createdAt,
    });
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const list = items.filter((i) => active === "hepsi" || i.kind === active);
  const count = (k: CreativeKind) => items.filter((i) => i.kind === k).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterTabs
          active={active}
          items={[
            { id: "hepsi", label: "Tümü", href: "/creative?sekme=galeri", count: items.length },
            { id: "video", label: "Videolar", href: "/creative?sekme=galeri&tur=video", count: count("video") },
            { id: "image", label: "Fotoğraflar", href: "/creative?sekme=galeri&tur=image", count: count("image") },
            { id: "audio", label: "Sesler", href: "/creative?sekme=galeri&tur=audio", count: count("audio") },
          ]}
        />
        <div className="flex items-center gap-2">
          <Link
            href="/creative?sekme=studyo"
            className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12px] font-medium text-fg hover:border-fg/40"
          >
            + {tt("Dosya Yükle & Düzenle")}
          </Link>
          <Link
            href="/creative"
            className="rounded-full bg-fg px-3.5 py-1.5 text-[12px] font-semibold text-bg hover:opacity-90"
          >
            {tt("Yeni Video / Fotoğraf Üret")}
          </Link>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line px-6 py-14 text-center">
          <p className="text-base font-medium text-fg">{tt("Kitaplığınız henüz boş")}</p>
          <p className="max-w-sm text-sm text-fg-muted">
            {tt("AI Sohbette ürettiğiniz veya yüklediğiniz tüm videolar ve fotoğraflar otomatik olarak burada toplanır.")}
          </p>
          <Link href="/creative" className="rounded-full bg-fg px-5 py-2 text-[13px] font-semibold text-bg hover:opacity-90">
            {tt("AI Sohbette İlk İçeriği Oluştur")}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((item) => {
            const fileId = item.assetId ?? item.uploadId!;
            const fileHref = item.assetId ? `/api/creative/file/${item.assetId}?t=asset` : `/api/creative/file/${item.uploadId}`;
            return (
              <li
                key={item.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition-standard hover:border-fg/30"
              >
                <div
                  className={cn(
                    "relative flex aspect-[4/5] flex-col justify-between overflow-hidden bg-gradient-to-br p-3 text-white",
                    toneFor(item.kind, item.id),
                  )}
                >
                  <AssetThumb id={fileId} kind={item.kind} alt={item.title} />
                  <div className="relative flex items-start justify-between gap-1">
                    <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-medium backdrop-blur">
                      <KindIcon kind={item.kind} size={12} /> {KIND_LABEL[item.kind]}
                    </span>
                    <span className="rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-black">
                      {item.sourceLabel}
                    </span>
                  </div>
                  <div className="relative flex justify-center opacity-80" aria-hidden>
                    <KindIcon kind={item.kind} size={36} />
                  </div>
                  <p className="relative line-clamp-2 rounded-xl bg-black/35 p-2 text-[12px] leading-snug backdrop-blur">
                    {item.title}
                  </p>
                </div>

                <div className="flex flex-1 flex-col gap-2 p-3">
                  <div className="flex flex-col text-[11px] text-fg-passive">
                    <span className="truncate text-[12px] text-fg-muted">{item.subtitle}</span>
                    <span>{fmtDateTime(item.createdAt)}</span>
                  </div>

                  <div className="mt-auto flex flex-wrap gap-1.5">
                    {item.kind !== "audio" ? (
                      <PhonePreviewButton
                        src={fileHref}
                        kind={item.kind === "video" ? "video" : "image"}
                        caption={item.title.slice(0, 120)}
                      />
                    ) : null}

                    {/* Kitaplıkta değilse tek tıkla Kitaplığa kaydet */}
                    {item.assetId && !item.savedInLibrary && item.kind !== "audio" ? (
                      <form action={async (fd: FormData) => { "use server"; await saveAssetToLibraryAction({ ok: false }, fd); }}>
                        <input type="hidden" name="assetId" value={item.assetId} />
                        <button
                          type="submit"
                          className="rounded-full bg-fg px-2.5 py-1 text-[11px] font-medium text-bg hover:opacity-90"
                        >
                          {tt("+ Kitaplığa Kaydet")}
                        </button>
                      </form>
                    ) : null}

                    {/* Hem Video hem Fotoğraf için Düzenleyiciye Gönder */}
                    {item.kind !== "audio" ? (
                      item.uploadId ? (
                        <Link
                          href={`/creative?sekme=studyo&dosya=${item.uploadId}`}
                          className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg hover:border-fg/40"
                        >
                          {tt("Düzenle")}
                        </Link>
                      ) : item.assetId ? (
                        <form action={openAssetInStudioAction}>
                          <input type="hidden" name="assetId" value={item.assetId} />
                          <button
                            type="submit"
                            className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg hover:border-fg/40"
                          >
                            {tt("Düzenle")}
                          </button>
                        </form>
                      ) : null
                    ) : null}

                    {/* Fotoğraf ise AI Sohbette Referans / Sesli Videoya Çevir */}
                    {item.kind === "image" ? (
                      <Link
                        href={`/creative?ref=${encodeURIComponent(item.uploadId ?? item.assetId ?? "")}&tur=video&prompt=${encodeURIComponent(`Şimdi üret: ${item.title} — bu görseli 5 saniyelik akıcı bir tanıtım videosuna dönüştür ve Türkçe seslendirme ekle`)}`}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg hover:border-fg/40"
                      >
                        {tt("Sesli Videoya Çevir")}
                      </Link>
                    ) : null}

                    {/* Video ise AI Sohbette Videoya Ses Ekle */}
                    {item.kind === "video" ? (
                      <Link
                        href={`/creative?prompt=${encodeURIComponent(`Videoma seslendirme ekle: '${item.title} için yeni sezon fırsatlarını hemen keşfedin!'`)}`}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg hover:border-fg/40"
                      >
                        {tt("Videoya Ses Ekle")}
                      </Link>
                    ) : null}

                    <Link
                      href={`/creative?prompt=${encodeURIComponent(`Sadece post brief hazırla: "${item.title}" içeriği için dikkat çekici Instagram başlığı, açıklama metni ve #reklam uyumlu hashtag seti yaz.`)}`}
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted hover:text-fg"
                    >
                      {tt("Post & Brief")}
                    </Link>

                    {adBase && item.assetId ? (
                      <Link
                        href={`${adBase}?asset=${item.assetId}`}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted hover:text-fg"
                      >
                        {tt("Reklam")}
                      </Link>
                    ) : null}

                    <a
                      href={fileHref}
                      download
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted hover:text-fg"
                    >
                      {tt("İndir")}
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const LEDGER_LABEL: Record<string, string> = {
  STARTER: "Hoş geldin bakiyesi",
  TOPUP: "Yükleme",
  CHARGE: "Üretim",
  REFUND: "İade",
  ADJUST: "Düzeltme",
};

async function LedgerList({
  rows,
  currencyOf,
}: {
  rows: { id: string; tenantId?: string; kind: string; amount: unknown; balanceAfter: unknown; note: string | null; createdAt: Date }[];
  currencyOf: (tenantId?: string) => string;
}) {
  const tt = await getTT();
  return (
    <ul className="flex max-h-64 flex-col divide-y divide-line overflow-y-auto rounded-xl border border-line text-[12px]">
      {rows.map((r) => {
        const amt = Number(r.amount);
        return (
          <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="text-fg">{LEDGER_LABEL[r.kind] ?? r.kind}</span>
              <span className="truncate text-[10px] text-fg-passive">
                {fmtDateTime(r.createdAt)}
                {r.note ? ` · ${r.note}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 flex-col items-end tabular-nums">
              <span className={amt < 0 ? "text-fg" : "text-emerald-600"}>
                {amt > 0 ? "+" : "−"}
                {fmtTl(Math.abs(amt), currencyOf(r.tenantId))}
              </span>
              <span className="text-[10px] text-fg-passive">
                {tt("Bakiye")} {fmtTl(Number(r.balanceAfter), currencyOf(r.tenantId))}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
