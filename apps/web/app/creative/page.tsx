import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { ensureStarterCredits } from "@infulancer/core/creative/credits";
import { AGENCY_TENANT, tenantCurrency } from "@infulancer/core/creative/tenant";
import { ownTenant } from "@/lib/creative-tenant";
import { allowedDurations, modelSpec, supportedAspects } from "@infulancer/core/creative/adapters";
import { rateFromTry, creativePricing, unitPriceTry } from "@infulancer/core/creative/pricing";
import { reconcileStaleJobs } from "@infulancer/core/creative/fal";
import { CreditRequestForm } from "@/components/creative/credit-request-form";
import { listSavedPromptsForTenant, loadCreativeChatHistory } from "@/lib/actions/creative-studio";
import { getConfig } from "@infulancer/core/config/store";
import { CreativeComposer, type ChatHistoryItem, type ComposerModel } from "@/components/creative/creative-composer";
import { requireActor } from "@/lib/auth-guard";
import { asKind, fmtTl, needsReference, type CreativeKind } from "@/lib/creative-models";
import { fmtDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Nordvow Creative AI" };
export const dynamic = "force-dynamic";

type SP = {
  sekme?: string;
  tur?: string;
  asset?: string;
  prompt?: string;
  ref?: string;
  dosya?: string;
};

/**
 * Nordvow Creative AI — Tek Sohbet Stüdyosu.
 * Tüm görsel, video, kurgu, seslendirme, montaj, kitaplık ve brief işlemleri
 * arka planda LLM + kayıtlı Skill Agent mimarisiyle tek sohbet üzerinden yürütülür.
 */
export default async function CreativePage({ searchParams }: { searchParams: Promise<SP> }) {
  const tt = await getTT();
  const actor = await requireActor();
  const sp = await searchParams;
  const isAdmin = actor.role === "ADMIN";
  const own = ownTenant(actor);
  const currency = await tenantCurrency(own);
  if (!isAdmin) await ensureStarterCredits(own);
  const scope = { tenantId: own };

  const pendingCreditReq =
    !isAdmin &&
    !!(await prisma.creditRequest.findFirst({ where: { tenantId: own, status: "BEKLIYOR" }, select: { id: true } }));

  void reconcileStaleJobs().catch(() => { });

  const [pricing, ledger, models, flags, brands, influencers, accounts, jobs, assets, library, savedPrompts, initialChatTurns] =
    await Promise.all([
      creativePricing(),
      prisma.creditLedger.findMany({
        where: { tenantId: own },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.modelRegistry.findMany({ orderBy: [{ kind: "asc" }, { creditsPerUnit: "asc" }] }),
      getConfig("features"),
      prisma.brand.findMany({
        where: isAdmin ? { isActive: true } : { id: actor.brandId ?? "-" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.influencer.findMany({
        where: isAdmin ? { isActive: true } : { id: actor.influencerId ?? "-" },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.creditAccount.findMany({ where: scope }),
      prisma.creativeJob.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 30 }),
      prisma.generatedAsset.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 60 }),
      prisma.creativeUpload.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 120 }),
      listSavedPromptsForTenant(own),
      loadCreativeChatHistory(own),
    ]);

  const nameOf = new Map<string, string>([
    [AGENCY_TENANT, "Ajans Stüdyosu"],
    ...brands.map((b) => [b.id, b.name] as const),
    ...influencers.map((i) => [i.id, i.name] as const),
  ]);
  const kindOf = new Map(models.map((m) => [m.key, asKind(m.kind)]));
  const acc = accounts.find((x) => x.tenantId === own);
  const available = acc ? Number(acc.balanceCredits) - Number(acc.heldCredits) : 0;

  const rate = rateFromTry(pricing, currency);
  const minCharge = currency === "TRY" ? pricing.minTry : Math.ceil(pricing.minTry * rate * 100 - 1e-9) / 100;
  const priceOf = (key: string, fallback: number) =>
    Number(models.find((m) => m.key === key)?.creditsPerUnit ?? fallback) * rate;
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
      creditsPerUnit:
        (Number(m.unitPriceUsd) > 0 ? unitPriceTry(Number(m.unitPriceUsd), pricing) : Number(m.creditsPerUnit)) * rate,
      maxUnits: m.maxUnits,
      durations: allowedDurations(m.key),
      aspects: supportedAspects(m.key),
    }));

  const jobPrompt = new Map(jobs.map((j) => [j.id, j.prompt]));
  const missingJobIds = assets.map((a) => a.jobId).filter((id): id is string => !!id && !jobPrompt.has(id));
  if (missingJobIds.length) {
    for (const j of await prisma.creativeJob.findMany({ where: { id: { in: missingJobIds } }, select: { id: true, prompt: true } })) {
      jobPrompt.set(j.id, j.prompt);
    }
  }

  const uploadByS3Key = new Map(library.map((u) => [u.s3Key, u]));
  const assetByJobId = new Map(assets.filter((a) => a.jobId).map((a) => [a.jobId!, a]));

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

  const profileName = nameOf.get(own) ?? "Stüdyo";
  const initialKind: CreativeKind | undefined =
    sp.tur === "video" || sp.tur === "image" || sp.tur === "audio" ? sp.tur : undefined;

  const mergedLibrary = (() => {
    const seen = new Set(library.map((u) => u.s3Key));
    const items: { id: string; kind: "image" | "video"; name: string | null; source: string }[] = library.map((u) => ({
      id: u.id,
      kind: u.kind === "video" ? "video" : "image",
      name: u.name,
      source: u.source,
    }));
    for (const a of assets) {
      if (seen.has(a.s3Key)) continue;
      const k = kindOf.get(a.modelKey);
      if (k === "audio") continue;
      seen.add(a.s3Key);
      items.push({
        id: a.id,
        kind: k === "video" ? "video" : "image",
        name: (a.jobId ? jobPrompt.get(a.jobId) : undefined) ?? `AI · ${a.modelKey}`,
        source: "ai",
      });
    }
    return items;
  })();

  return (
    <div className="flex min-h-[calc(100dvh-9.5rem)] w-full flex-1 flex-col gap-3 lg:h-[calc(100dvh-4.5rem)] lg:max-h-[calc(100dvh-4.5rem)] lg:overflow-hidden">
      {/* Yalnızca Nordvow Creative AI — Tek Sohbet Başlığı */}
      <header className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-line bg-surface px-4 py-2.5 sm:px-5">
        <div className="flex items-center gap-2.5">
          <h1 className="text-sm font-semibold tracking-tight text-fg">{tt("Nordvow Creative AI")}</h1>
          <span className="hidden rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted sm:inline-block">
            {profileName}
          </span>
        </div>

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
                    <ul className="flex max-h-56 flex-col divide-y divide-line overflow-y-auto text-xs">
                      {ledger.slice(0, 8).map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="truncate text-fg-muted">{r.note || r.kind}</span>
                          <span className="shrink-0 tabular-nums text-fg">
                            {fmtTl(Number(r.amount), currency)} · {fmtDateTime(r.createdAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </details>
          ) : null}
        </div>
      </header>

      {/* Tek Ekran: Nordvow Creative AI Sohbet + Skill Agent Orkestrasyonu */}
      <CreativeComposer
        key={`${sp.prompt ?? ""}-${sp.ref ?? sp.asset ?? sp.dosya ?? ""}-${sp.tur ?? ""}`}
        minTry={minCharge}
        currency={currency}
        models={usable}
        available={available}
        username={profileName.split(" ")[0]!.toLocaleLowerCase("tr")}
        profileLabel={profileName}
        library={mergedLibrary}
        refPrices={{
          imageEdit: priceOf("nano-banana-edit", 6),
          klingI2v: priceOf("kling-v2-5-i2v", 11),
          ecoI2v: priceOf("hailuo-02-fast-i2v", 3),
        }}
        initialPrompt={(sp.prompt ?? "").slice(0, 2000)}
        initialKind={initialKind}
        initialRefId={sp.ref ?? sp.asset ?? sp.dosya}
        initialHistory={chatHistory}
        initialChatTurns={initialChatTurns}
        initialActiveJob={initialActiveJob}
        initialSavedPrompts={savedPrompts}
      />
    </div>
  );
}
