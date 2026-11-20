"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ContentPlanItem, Objective } from "@infulancer/core/domain/campaign-plan";
import { COUNTRIES, GENDERS, OBJECTIVES } from "@infulancer/core/domain/campaign-plan";
import {
  CAMPAIGN_TEMPLATES,
  EXPECTATION_HINTS,
  SECTORS,
  type CampaignSectorId,
} from "@infulancer/core/campaigns/templates";
import type { BriefTone } from "@infulancer/core/campaigns/ai-brief";
import type { MatchedInfluencerResult } from "@infulancer/core/campaigns/ai-matching";
import { contentTypeLabels, platformLabels } from "@infulancer/core/domain/labels";
import type { Platform } from "@infulancer/core/enums";
import { formatMinor } from "@infulancer/core/i18n/regions";
import { CheckIcon, SparkleIcon, XIcon } from "@/components/icons";
import { PlatformIcon } from "@/components/platform-icon";
import { PlanEditor, type PlanRow } from "@/components/campaign/wizard/wizard-steps";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { compact, fmtEr, fmtFollowers, fmtTrDate, formatHandle, UNMEASURED_HINT } from "@/lib/format";
import {
  extractProductAction,
  finalizeQuickCampaignAction,
  generateQuickBriefAction,
  generateQuickConceptImagesAction,
  loadQuickMatchesAction,
  saveQuickCampaignStep1Action,
  saveQuickCampaignStep2Action,
  summarizeMoodBoardAction,
} from "@/lib/actions/quick-campaign";

const PLATFORMS: Platform[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE"];
const AGE_PRESETS = [
  { label: "18–24", min: 18, max: 24 },
  { label: "25–34", min: 25, max: 34 },
  { label: "18–34", min: 18, max: 34 },
  { label: "35–44", min: 35, max: 44 },
  { label: "45+", min: 45, max: 65 },
];
const INTEREST_TAGS = [
  "güzellik",
  "cilt bakımı",
  "moda",
  "yeme-içme",
  "teknoloji",
  "anne-bebek",
  "spor",
  "fitness",
  "yaşam",
  "seyahat",
  "oyun",
];
const DURATIONS = [
  { label: "2 hafta", days: 14 },
  { label: "1 ay", days: 30 },
  { label: "3 ay", days: 90 },
];

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function defaultStartDay(): string {
  return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
}

function fmtSavedTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

export function QuickCampaignWizard({
  role,
  brands,
  defaultBrandId,
  defaultBrandName,
  categoryOptions = [],
  catalog = [],
  initialCampaignId,
  initialCampaignName,
}: {
  role: "ADMIN" | "BRAND";
  brands?: { id: string; name: string }[];
  defaultBrandId?: string;
  defaultBrandName?: string;
  categoryOptions?: string[];
  catalog?: { id: string; kind: "sector" | "template"; name: string; sector?: string; active: boolean }[];
  initialCampaignId?: string;
  initialCampaignName?: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [campaignId, setCampaignId] = useState<string | null>(initialCampaignId ?? null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Ekran 1: Ne istiyorsun?
  const [brandId, setBrandId] = useState(defaultBrandId ?? brands?.[0]?.id ?? "");
  const [campaignName, setCampaignName] = useState(initialCampaignName ?? "");
  const [objective, setObjective] = useState<Objective>("satis");
  const [secondaryObjective, setSecondaryObjective] = useState<Objective | "">("");
  const [sector, setSector] = useState<CampaignSectorId>("kozmetik");
  const [templateKey, setTemplateKey] = useState<string>("kozmetik_satis");
  const [productUrl, setProductUrl] = useState("");
  const [productTitle, setProductTitle] = useState<string | null>(null);
  const [productDesc, setProductDesc] = useState<string | null>(null);
  const [productPrice, setProductPrice] = useState<string | null>(null);
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [budgetStr, setBudgetStr] = useState("15000");
  const [startsAt, setStartsAt] = useState(() => defaultStartDay());
  const [endsAt, setEndsAt] = useState(() => addDays(defaultStartDay(), 29));
  const [countries, setCountries] = useState<string[]>(["TR"]);
  const [platforms, setPlatforms] = useState<Platform[]>(["INSTAGRAM", "TIKTOK"]);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(34);
  const [gender, setGender] = useState<"hepsi" | "kadin" | "erkek">("kadin");
  const [interests, setInterests] = useState<string[]>(["güzellik", "cilt bakımı"]);

  // Ekran 2: AI Brief ve İçerik Planı
  const [tone, setTone] = useState<BriefTone>("samimi");
  const [titleAlts, setTitleAlts] = useState<string[]>([]);
  const [briefText, setBriefText] = useState("");
  const [dosText, setDosText] = useState("");
  const [dontsText, setDontsText] = useState("");
  const [hashtagsText, setHashtagsText] = useState("#reklam");
  const [mentionsText, setMentionsText] = useState("");
  const [disclosureText, setDisclosureText] = useState(
    'Reklam | @marka — ilk anda görünür, diğer etiketlerden önce (md. 23/A)',
  );
  const [planRows, setPlanRows] = useState<PlanRow[]>([
    { platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "15–30 sn, ürünü ilk 3 sn'de göster" },
    { platform: "TIKTOK", contentType: "VIDEO", count: 1, notes: "15–30 sn, trend ses + ürün deneyimi" },
  ]);
  const [moodNotes, setMoodNotes] = useState("");
  const [moodSummary, setMoodSummary] = useState<string | null>(null);
  const [moodPrompt, setMoodPrompt] = useState("");
  const [conceptStatus, setConceptStatus] = useState<string | null>(null);

  // Ekran 3: Kısa Liste ve Onay
  const [matches, setMatches] = useState<MatchedInfluencerResult[]>([]);
  const [shortlist, setShortlist] = useState<Set<string>>(new Set());
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [offerMessage, setOfferMessage] = useState("");

  const activeBrandName = useMemo(() => {
    if (defaultBrandName) return defaultBrandName;
    return brands?.find((b) => b.id === brandId)?.name ?? "Markanız";
  }, [brandId, brands, defaultBrandName]);

  const allInterests = useMemo(() => {
    return [...new Set([...categoryOptions, ...INTEREST_TAGS, ...interests].map((x) => x.toLocaleLowerCase("tr")))];
  }, [categoryOptions, interests]);
  const catalogSectors = useMemo(() => catalog.filter((x) => x.kind === "sector" && x.active), [catalog]);
  const catalogTemplates = useMemo(() => catalog.filter((x) => x.kind === "template" && x.active), [catalog]);

  const budgetMajor = Math.max(0, Number(budgetStr.replace(/[^\d]/g, "")) || 0);
  const budgetKurus = budgetMajor * 100;
  const currency = countries.length === 1 && countries[0] === "US" ? "USD" : countries.length === 1 && countries[0] === "DE" ? "EUR" : "TRY";
  const microMin = budgetMajor > 0 ? Math.max(1, Math.floor(budgetMajor / (currency === "TRY" ? 7500 : 300))) : 0;
  const microMax = budgetMajor > 0 ? Math.max(microMin, Math.ceil(budgetMajor / (currency === "TRY" ? 4000 : 150))) : 0;
  const days = Math.max(1, Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 86_400_000) + 1);

  const briefQuality = useMemo(() => {
    let pts = 0;
    if (briefText.trim().length >= 40) pts += 2;
    if (dosText.trim().length >= 10) pts += 1;
    if (dontsText.trim().length >= 10) pts += 1;
    if (hashtagsText.includes("#")) pts += 1;
    if (planRows.length > 0) pts += 1;
    if (moodSummary) pts += 1;
    if (pts >= 6) return { label: "Çok iyi", tone: "text-emerald-700 dark:text-emerald-300" };
    if (pts >= 4) return { label: "İyi", tone: "text-fg" };
    return { label: "Geliştirilebilir", tone: "text-amber-700 dark:text-amber-300" };
  }, [briefText, dosText, dontsText, hashtagsText, planRows.length, moodSummary]);

  const applyTemplate = (key: string) => {
    setTemplateKey(key);
    const tpl = CAMPAIGN_TEMPLATES.find((t) => t.key === key);
    if (!tpl) {
      const custom = catalogTemplates.find((t) => t.id === key);
      if (custom) {
        const customSector = custom.sector || catalogSectors[0]?.id || "kozmetik";
        setSector(customSector as CampaignSectorId);
        if (!campaignName.trim()) setCampaignName(`${activeBrandName} · ${custom.name}`);
      }
      return;
    }
    setSector(tpl.sector);
    setObjective(tpl.objective);
    setPlatforms([...tpl.defaultPlatforms]);
    setAgeMin(tpl.defaultAgeMin);
    setAgeMax(tpl.defaultAgeMax);
    setGender(tpl.defaultGender);
    setInterests([...tpl.defaultInterests]);
    setPlanRows(tpl.recommendedPlan.map((r) => ({ ...r })));
    if (!campaignName.trim()) {
      setCampaignName(`${activeBrandName} · ${tpl.title}`);
    }
  };

  const handleFetchProduct = () => {
    if (!productUrl.trim()) return;
    setErrorMsg(null);
    setStatusMsg(null);
    startTransition(async () => {
      const info = await extractProductAction(productUrl.trim());
      if (!info.fetched) {
        setErrorMsg(info.error || "Ürün sayfası okunamadı; bilgileri elle girebilirsiniz.");
        return;
      }
      setProductTitle(info.title);
      setProductDesc(info.description);
      setProductPrice(info.priceText);
      setProductImageUrl(info.imageUrl);
      if (info.title && !campaignName.trim()) {
        setCampaignName(`${activeBrandName} · ${info.title.slice(0, 60)}`);
      }
      setStatusMsg(`Ürün bilgileri çekildi: ${info.title ?? info.hostname}`);
    });
  };

  const runAiBrief = (nextTone: BriefTone = tone) => {
    setErrorMsg(null);
    startTransition(async () => {
      const brief = await generateQuickBriefAction({
        brandId: brandId || undefined,
        campaignName: campaignName || productTitle || `${activeBrandName} Kampanyası`,
        objective,
        secondaryObjective: secondaryObjective || null,
        sector,
        productTitle,
        productDescription: productDesc,
        productPrice,
        platforms,
        audienceSummary: `${countries.join(", ")} · ${ageMin}–${ageMax} yaş · ${gender} · ${interests.join(", ")}`,
        tone: nextTone,
      });
      setTitleAlts(brief.titleAlternatives);
      if (!campaignName.trim() && brief.titleAlternatives[0]) {
        setCampaignName(brief.titleAlternatives[0]);
      }
      setBriefText(brief.mainMessage);
      setDosText(brief.dos.join("\n"));
      setDontsText(brief.donts.join("\n"));
      setDisclosureText(brief.mandatoryDisclosure);
      setHashtagsText(brief.hashtags.join(" "));
      setPlanRows(brief.contentPlan as PlanRow[]);
      setMoodPrompt(brief.moodBoardPrompt);
      setStatusMsg(
        brief.source === "bedrock"
          ? "AI brief AWS Bedrock (EU) ile hazırlandı — tüm alanları serbestçe düzenleyebilirsiniz."
          : "Şablon tabanlı brief hazırlandı — tüm alanları serbestçe düzenleyebilirsiniz.",
      );
    });
  };

  const handleStep1Next = () => {
    setErrorMsg(null);
    const effectiveName = campaignName.trim() || productTitle?.trim() || `${activeBrandName} Yeni Kampanya`;
    if (effectiveName.length < 3) {
      setErrorMsg("Lütfen en az 3 karakterlik bir kampanya adı girin.");
      return;
    }
    if (budgetMajor <= 0) {
      setErrorMsg("Lütfen geçerli bir toplam bütçe girin.");
      return;
    }
    setCampaignName(effectiveName);

    startTransition(async () => {
      const res = await saveQuickCampaignStep1Action({
        campaignId,
        brandId: role === "ADMIN" ? brandId : undefined,
        name: effectiveName,
        objective,
        secondaryObjective: secondaryObjective || null,
        description: productDesc || `${effectiveName} kampanyası`,
        targetCountries: countries,
        platforms,
        audienceAgeMin: ageMin,
        audienceAgeMax: ageMax,
        audienceGender: gender,
        audienceInterests: interests,
        startsAt,
        endsAt,
        budgetMajor,
        productUrl: productUrl.trim() || null,
        productTitle,
        productPrice,
        productImageUrl,
        templateKey,
        sector,
      });
      if (!res.ok || !res.campaignId) {
        setErrorMsg(res.error || "Taslak kaydedilemedi, lütfen tekrar deneyin.");
        return;
      }
      setCampaignId(res.campaignId);
      setSavedAt(res.savedAt ?? new Date().toISOString());
      setStep(2);
      if (!briefText.trim()) {
        runAiBrief(tone);
      }
    });
  };

  const handleStep2Next = () => {
    if (!campaignId) return;
    setErrorMsg(null);
    if (briefText.trim().length < 10) {
      setErrorMsg("Brief metni en az 10 karakter olmalıdır.");
      return;
    }
    startTransition(async () => {
      const res = await saveQuickCampaignStep2Action({
        campaignId,
        briefText,
        dos: dosText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        donts: dontsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        hashtags: hashtagsText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        mentions: mentionsText.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        disclosureRequired: true,
        contentPlan: planRows as ContentPlanItem[],
        moodBoardStyleSummary: moodSummary,
        titleAlternatives: titleAlts,
        briefTone: tone,
      });
      if (!res.ok) {
        setErrorMsg(res.error || "Brief kaydedilemedi; form verileriniz korundu.");
        return;
      }
      setSavedAt(res.savedAt ?? new Date().toISOString());
      const matchRes = await loadQuickMatchesAction(campaignId);
      if (matchRes.ok) {
        setMatches(matchRes.matches);
        setShortlist(new Set(matchRes.shortlist));
      } else if (matchRes.error) {
        setErrorMsg(matchRes.error);
      }
      setOfferMessage(
        `${campaignName} kampanyası için iş birliği teklifimizdir. Brief ve içerik detaylarını inceleyip yanıtlayabilirsiniz.`,
      );
      setStep(3);
    });
  };

  const handleFinalize = (intent: "save_draft" | "publish_only" | "publish_and_send_offers") => {
    if (!campaignId) return;
    setErrorMsg(null);
    startTransition(async () => {
      const res = await finalizeQuickCampaignAction({
        campaignId,
        intent,
        influencerIds: [...shortlist],
        confirmed: intent === "publish_and_send_offers",
        offerMessage,
      });
      if (!res.ok) {
        setErrorMsg(res.error || "İşlem tamamlanamadı.");
        return;
      }
      setConfirmOpen(false);
      setStatusMsg(res.message ?? "Kaydedildi.");
      if (res.redirectUrl) {
        router.push(res.redirectUrl);
      }
    });
  };

  const selectedMatches = useMemo(() => matches.filter((m) => shortlist.has(m.id)), [matches, shortlist]);
  const comparedMatches = useMemo(() => matches.filter((m) => compareIds.includes(m.id)), [matches, compareIds]);
  const shortlistFeeMin = selectedMatches.reduce((s, m) => s + m.estimatedFeeRangeKurus.min, 0);
  const shortlistFeeMax = selectedMatches.reduce((s, m) => s + m.estimatedFeeRangeKurus.max, 0);
  const shortlistReachMin = selectedMatches.reduce((s, m) => s + m.estimatedReachRange.min, 0);
  const shortlistReachMax = selectedMatches.reduce((s, m) => s + m.estimatedReachRange.max, 0);

  const toggleArr = <T,>(arr: T[], val: T) => (arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  const toggleShortlist = (id: string) =>
    setShortlist((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleCompare = (id: string) =>
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });

  const advancedHref = campaignId
    ? role === "BRAND"
      ? `/marka/kampanyalar/${campaignId}/olustur?adim=temel`
      : `/admin/kampanyalar/${campaignId}/olustur?adim=temel`
    : role === "BRAND"
      ? "/marka/kampanyalar/yeni?mod=gelismis"
      : "/admin/kampanyalar/yeni?mod=gelismis";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      {/* Üst başlık + ilerleme çubuğu + otomatik kayıt durumu */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-fg px-2.5 py-0.5 text-[11px] font-semibold text-bg">
              Hızlı Kampanya · {step}/3
            </span>
            <span className="text-[12px] text-fg-muted">~1 dk / ekran · toplam ~3 dk</span>
            {savedAt ? (
              <span className="text-[12px] text-emerald-700 dark:text-emerald-300">
                ✓ Taslak otomatik kaydedildi · {fmtSavedTime(savedAt)}
              </span>
            ) : null}
          </div>
          <h1 className="text-xl font-semibold text-fg">
            {step === 1
              ? "1/3 · Ne istiyorsun?"
              : step === 2
                ? "2/3 · AI brief ve içerik planı"
                : "3/3 · Kısa liste ve onay"}
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={advancedHref}
            className="rounded-full border border-line px-3 py-1.5 text-[12px] font-medium text-fg-muted hover:border-fg/40 hover:text-fg"
          >
            Gelişmiş düzenleme (8 adım) →
          </Link>
        </div>

        {/* İlerleme çubuğu */}
        <div className="grid w-full grid-cols-3 gap-2 pt-1">
          {[
            { n: 1 as const, label: "1. Hedef ve ürün (~1 dk)" },
            { n: 2 as const, label: "2. AI brief ve plan (~1 dk)" },
            { n: 3 as const, label: "3. Kısa liste ve onay (~1 dk)" },
          ].map((s) => (
            <button
              key={s.n}
              type="button"
              disabled={s.n > 1 && !campaignId}
              onClick={() => (s.n === 1 || campaignId ? setStep(s.n) : undefined)}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl border px-3 py-2 text-left text-[12px] transition-standard",
                step === s.n
                  ? "border-fg bg-fg/[0.04] font-semibold text-fg"
                  : step > s.n
                    ? "border-emerald-500/40 text-fg"
                    : "border-line text-fg-muted",
                s.n > 1 && !campaignId ? "opacity-50" : "",
              )}
            >
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                <div
                  className={cn("h-full transition-all", step >= s.n ? "bg-fg" : "bg-transparent")}
                  style={{ width: step >= s.n ? "100%" : "0%" }}
                />
              </div>
              <span>{step > s.n ? `✓ ${s.label}` : s.label}</span>
            </button>
          ))}
        </div>
      </div>

      {errorMsg ? (
        <div role="alert" className="rounded-xl border border-critical/40 bg-critical/5 px-4 py-3 text-[13px] text-critical">
          {errorMsg}
        </div>
      ) : null}
      {statusMsg ? (
        <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-[13px] text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      ) : null}

      {/* ────────────────── EKRAN 1: NE İSTİYORSUN? ────────────────── */}
      {step === 1 ? (
        <Card interactive={false} className="flex flex-col gap-5">
          {role === "ADMIN" && brands?.length ? (
            <Field label="Marka">
              {(p) => (
                <Select {...p} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Hazır şablon (sektör × hedef)" hint="Brief, içerik planı ve hedef kitleyi otomatik doldurur.">
              {(p) => (
                <Select {...p} value={templateKey} onChange={(e) => applyTemplate(e.target.value)}>
                  {[...CAMPAIGN_TEMPLATES, ...catalogTemplates.map((t) => ({ key: t.id, sectorLabel: t.sector ?? "Özel", objectiveLabel: "Kampanya", title: t.name }))].map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.sectorLabel} · {t.objectiveLabel} — {t.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Sektör">
              {(p) => (
                <Select {...p} value={sector} onChange={(e) => setSector(e.target.value as CampaignSectorId)}>
                  {[...SECTORS, ...catalogSectors.map((s) => ({ id: s.id, label: s.name }))].map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface-muted/30 p-4">
            <label className="text-[12px] font-medium text-fg">Ürün linki (isteğe bağlı — AI başlık, görsel ve fiyatı çeker)</label>
            <div className="flex flex-wrap gap-2">
              <Input
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://markaniz.com/urun/kis-bakim-kremi"
                className="min-w-[240px] flex-1"
              />
              <Button type="button" variant="secondary" size="sm" disabled={isPending || !productUrl.trim()} onClick={handleFetchProduct}>
                {isPending ? "Çekiliyor…" : "Ürünü çek"}
              </Button>
            </div>
            {productTitle ? (
              <div className="mt-1 flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5 text-[12px]">
                {productImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={productImageUrl} alt={productTitle} className="h-12 w-12 rounded-lg object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-fg">{productTitle}</p>
                  {productPrice ? <p className="text-fg-muted">{productPrice}</p> : null}
                </div>
              </div>
            ) : null}
          </div>

          <Field label="Kampanya adı">
            {(p) => (
              <Input
                {...p}
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Örn. Kış Bakım Kampanyası"
              />
            )}
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-label text-fg-muted">Ana hedef</span>
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              {OBJECTIVES.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    setObjective(o.id);
                    if (secondaryObjective === o.id) setSecondaryObjective("");
                  }}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-standard",
                    objective === o.id ? "border-fg bg-fg/[0.04] ring-1 ring-fg/30" : "border-line hover:border-fg/40",
                  )}
                >
                  <span className="text-[14px] font-semibold text-fg">{o.title}</span>
                  <span className="text-[11px] text-fg-muted">{o.text}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[12px] text-fg-muted">+ İkincil hedef (isteğe bağlı):</span>
              {OBJECTIVES.filter((o) => o.id !== objective).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setSecondaryObjective(secondaryObjective === o.id ? "" : o.id)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[12px]",
                    secondaryObjective === o.id ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:border-fg/40",
                  )}
                >
                  {o.title}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label={`Toplam bütçe (${currency})`}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="numeric"
                  value={budgetStr}
                  onChange={(e) => setBudgetStr(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="15000"
                />
              )}
            </Field>
            <Field label="Başlangıç" hint={fmtTrDate(startsAt)}>
              {(p) => <Input {...p} type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}
            </Field>
            <Field label="Bitiş" hint={fmtTrDate(endsAt)}>
              {(p) => <Input {...p} type="date" min={startsAt} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
            <div className="flex flex-wrap items-center gap-2">
              {DURATIONS.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => setEndsAt(addDays(startsAt, d.days - 1))}
                  className="rounded-full border border-line px-3 py-1 text-fg-muted hover:border-fg/40 hover:text-fg"
                >
                  {d.label}
                </button>
              ))}
              <span className="tabular-nums text-fg-passive">
                {fmtTrDate(startsAt)} – {fmtTrDate(endsAt)} ({days} gün)
              </span>
            </div>
            {microMin > 0 ? (
              <span className="flex items-center gap-1.5 text-fg-muted">
                Bu bütçeyle yaklaşık <strong className="text-fg">{microMin}–{microMax} mikro creator</strong>
                <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase">Tahmin</span>
              </span>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-label text-fg-muted">Platformlar</span>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map((pl) => (
                  <button
                    key={pl}
                    type="button"
                    onClick={() => setPlatforms((prev) => (prev.includes(pl) && prev.length > 1 ? prev.filter((x) => x !== pl) : prev.includes(pl) ? prev : [...prev, pl]))}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px]",
                      platforms.includes(pl) ? "border-fg bg-fg text-bg" : "border-line text-fg-muted",
                    )}
                  >
                    <PlatformIcon platform={pl} size={13} /> {platformLabels[pl]}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-label text-fg-muted">Ülkeler</span>
              <div className="flex flex-wrap gap-1.5">
                {COUNTRIES.slice(0, 8).map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setCountries((prev) => (prev.includes(c.code) && prev.length > 1 ? prev.filter((x) => x !== c.code) : prev.includes(c.code) ? prev : [...prev, c.code]))}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px]",
                      countries.includes(c.code) ? "border-fg bg-fg text-bg" : "border-line text-fg-muted",
                    )}
                  >
                    {c.name} <span className="opacity-70">{c.currency}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <span className="text-label text-fg-muted">Yaş aralığı ve cinsiyet</span>
              <div className="flex flex-wrap gap-1.5">
                {AGE_PRESETS.map((ap) => (
                  <button
                    key={ap.label}
                    type="button"
                    onClick={() => {
                      setAgeMin(ap.min);
                      setAgeMax(ap.max);
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px]",
                      ageMin === ap.min && ageMax === ap.max ? "border-fg bg-fg text-bg" : "border-line text-fg-muted",
                    )}
                  >
                    {ap.label}
                  </button>
                ))}
                <Select
                  aria-label="Cinsiyet"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as "hepsi" | "kadin" | "erkek")}
                  className="ml-auto w-auto"
                >
                  {GENDERS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-label text-fg-muted">İlgi alanları (kategori sözlüğü)</span>
              <div className="flex flex-wrap gap-1.5">
                {allInterests.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setInterests((prev) => toggleArr(prev, tag))}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[12px]",
                      interests.includes(tag) ? "border-fg bg-fg text-bg" : "border-line text-fg-muted",
                    )}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-line pt-4">
            <Button type="button" disabled={isPending} onClick={handleStep1Next}>
              <SparkleIcon size={14} /> {isPending ? "Hazırlanıyor…" : "AI brief'i hazırla →"}
            </Button>
          </div>
        </Card>
      ) : null}

      {/* ────────────────── EKRAN 2: AI BRIEF VE İÇERİK PLANI ────────────────── */}
      {step === 2 ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px] lg:items-start">
          <Card interactive={false} className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-medium text-fg-muted">Ton:</span>
                {(
                  [
                    { id: "samimi", label: "Samimi" },
                    { id: "eglenceli", label: "Daha eğlenceli" },
                    { id: "premium", label: "Daha premium" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTone(t.id);
                      runAiBrief(t.id);
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[12px]",
                      tone === t.id ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:border-fg/40",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 text-[12px]">
                <span className="text-fg-muted">Brief kalitesi:</span>
                <span className={cn("font-semibold", briefQuality.tone)}>{briefQuality.label}</span>
              </div>
            </div>

            {titleAlts.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-fg-muted">Başlık alternatifleri (tıklayıp seçin):</span>
                <div className="flex flex-wrap gap-2">
                  {titleAlts.map((alt) => (
                    <button
                      key={alt}
                      type="button"
                      onClick={() => setCampaignName(alt)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12px]",
                        campaignName === alt ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:border-fg/40",
                      )}
                    >
                      {alt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <Field label="Ana mesaj ve brief metni">
              {(p) => <Textarea {...p} rows={5} value={briefText} onChange={(e) => setBriefText(e.target.value)} />}
            </Field>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Yapılacaklar (her satıra bir madde)">
                {(p) => <Textarea {...p} rows={4} value={dosText} onChange={(e) => setDosText(e.target.value)} />}
              </Field>
              <Field label="Yapılmayacaklar (ROK kılavuzu dahil)">
                {(p) => <Textarea {...p} rows={4} value={dontsText} onChange={(e) => setDontsText(e.target.value)} />}
              </Field>
            </div>

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-3.5 py-2.5 text-[12px]">
              <p className="font-semibold text-fg">Zorunlu reklam ibaresi (md. 23/A) ✓ Creative Studio otomatik ekler</p>
              <p className="mt-0.5 text-fg-muted">{disclosureText}</p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Hashtag önerileri">
                {(p) => <Input {...p} value={hashtagsText} onChange={(e) => setHashtagsText(e.target.value)} />}
              </Field>
              <Field label="Bahsetmeler (@marka)">
                {(p) => <Input {...p} value={mentionsText} onChange={(e) => setMentionsText(e.target.value)} placeholder="@markahesabi" />}
              </Field>
            </div>

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <span className="text-label text-fg-muted">İçerik planı (influencer başına)</span>
              <PlanEditor rows={planRows} setRows={setPlanRows} platforms={platforms} />
            </div>

            {/* Mood board + AI stil özeti + Creative Studio fal.ai konsept görsel */}
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-muted/30 p-4">
              <span className="text-[13px] font-semibold text-fg">Mood board ve konsept görseller (Creative Studio · fal.ai)</span>
              <Field label="Referans görsel / stil notu">
                {(p) => (
                  <Input
                    {...p}
                    value={moodNotes}
                    onChange={(e) => setMoodNotes(e.target.value)}
                    placeholder="Örn. doğal pencere ışığı, yakın plan ürün dokusu, sıcak kış tonları"
                  />
                )}
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await summarizeMoodBoardAction({
                        brandName: activeBrandName,
                        fileNames: productTitle ? [productTitle] : [],
                        notes: moodNotes,
                      });
                      setMoodSummary(res.styleSummary);
                    })
                  }
                >
                  AI stil özeti çıkar
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await generateQuickConceptImagesAction({
                        campaignId,
                        brandId: role === "ADMIN" ? brandId : undefined,
                        prompt: moodPrompt || `${activeBrandName} ${campaignName} ${moodNotes}`,
                        count: 3,
                      });
                      setConceptStatus(res.message);
                    })
                  }
                >
                  3 konsept görsel üret (fal.ai)
                </Button>
              </div>
              {moodSummary ? <p className="text-[12px] text-fg">{moodSummary}</p> : null}
              {conceptStatus ? <p className="text-[12px] text-fg-muted">{conceptStatus}</p> : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                ← Geri
              </Button>
              <Button type="button" disabled={isPending} onClick={handleStep2Next}>
                {isPending ? "Eşleştiriliyor…" : "Influencer öner →"}
              </Button>
            </div>
          </Card>

          {/* Sağ panel: Canlı önizleme — "Influencer ne görecek?" */}
          <aside className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-6">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                Influencer ne görecek?
              </span>
              <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-medium text-fg-muted">
                Canlı önizleme
              </span>
            </div>
            <div className="flex flex-col gap-2.5 text-[12px]">
              <div>
                <p className="text-[11px] text-fg-passive">{activeBrandName}</p>
                <h3 className="text-[15px] font-semibold text-fg">{campaignName || "Kampanya Başlığı"}</h3>
                <p className="text-fg-muted tabular-nums">
                  {fmtTrDate(startsAt)} – {fmtTrDate(endsAt)} · Bütçe havuzu {formatMinor(budgetKurus, currency)}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface-muted/30 p-3">
                <p className="font-medium text-fg">Brief özeti</p>
                <p className="mt-1 whitespace-pre-line text-fg-muted">
                  {briefText || "Brief metni burada anlık güncellenir."}
                </p>
              </div>
              <div>
                <p className="font-medium text-fg">İstenen içerikler</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {planRows.map((r, i) => (
                    <li key={i} className="rounded-full border border-line px-2.5 py-0.5 text-[11px]">
                      {r.count}× {platformLabels[r.platform]} {contentTypeLabels[r.contentType]}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] text-fg-muted">
                <strong className="text-fg">Zorunlu ibare:</strong> {disclosureText}
              </div>
              {hashtagsText ? <p className="text-[11px] text-fg-muted">{hashtagsText}</p> : null}
            </div>
          </aside>
        </div>
      ) : null}

      {/* ────────────────── EKRAN 3: KISA LİSTE VE ONAY ────────────────── */}
      {step === 3 ? (
        <div className="flex flex-col gap-5">
          {/* Canlı bütçe ve tahmini erişim özeti */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Card interactive={false} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-fg-muted">Kısa liste bütçe uyumu ({shortlist.size} kişi)</span>
                <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase">Tahmin</span>
              </div>
              <p className="text-lg font-semibold tabular-nums text-fg">
                {shortlist.size > 0
                  ? `${formatMinor(shortlistFeeMin, currency)} – ${formatMinor(shortlistFeeMax, currency)}`
                  : "—"}
                <span className="text-[13px] font-normal text-fg-muted"> / bütçe {formatMinor(budgetKurus, currency)}</span>
              </p>
            </Card>
            <Card interactive={false} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span
                  className="text-[12px] text-fg-muted"
                  title="Geçmiş kategori erişim oranlarından (%18–%35) hesaplanan tahmin aralığıdır."
                >
                  Tahmini erişim aralığı ⓘ
                </span>
                <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase">Tahmin</span>
              </div>
              <p className="text-lg font-semibold tabular-nums text-fg">
                {shortlistReachMax > 0
                  ? `${compact.format(shortlistReachMin)} – ${compact.format(shortlistReachMax)}`
                  : "—"}
              </p>
            </Card>
          </div>

          {/* Beklenti yönetimi ipuçları */}
          <div className="flex flex-wrap gap-2 text-[11px] text-fg-muted">
            {EXPECTATION_HINTS.map((hint) => (
              <span key={hint} className="rounded-full border border-line bg-surface-muted/40 px-3 py-1">
                {hint}
              </span>
            ))}
          </div>

          {/* Yan yana karşılaştırma (2–4 kişi) */}
          {comparedMatches.length >= 2 ? (
            <Card interactive={false} className="overflow-x-auto">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-fg">Karşılaştırma ({comparedMatches.length}/4)</span>
                <button type="button" onClick={() => setCompareIds([])} className="text-[12px] text-fg-muted hover:text-fg">
                  Kapat
                </button>
              </div>
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-line text-fg-passive">
                    <th className="py-1.5 pr-3">Metrik</th>
                    {comparedMatches.map((m) => (
                      <th key={m.id} className="py-1.5 pr-3 font-semibold text-fg">{m.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">Uyum puanı</td>
                    {comparedMatches.map((m) => <td key={m.id} className="py-1.5 pr-3 font-semibold">{m.matchScore}/100</td>)}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">Takipçi</td>
                    {comparedMatches.map((m) => <td key={m.id} className="py-1.5 pr-3">{fmtFollowers(m.followers)}</td>)}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">Doğrulanmış ER</td>
                    {comparedMatches.map((m) => <td key={m.id} className="py-1.5 pr-3">{fmtEr(m.er)}</td>)}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">Kitle kalitesi</td>
                    {comparedMatches.map((m) => (
                      <td key={m.id} className="py-1.5 pr-3">
                        {m.audienceQualityScore != null ? `${m.audienceQualityScore}/100 (API)` : "Hesap bağlanmadı"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">Tahmini ücret (Tahmin)</td>
                    {comparedMatches.map((m) => (
                      <td key={m.id} className="py-1.5 pr-3">
                        {formatMinor(m.estimatedFeeRangeKurus.min, currency)} – {formatMinor(m.estimatedFeeRangeKurus.max, currency)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </Card>
          ) : null}

          {/* AI Eşleştirilmiş Influencer Kartları */}
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {matches.map((m) => {
              const inShortlist = shortlist.has(m.id);
              const handleText = formatHandle(m.handle);
              const followerText = fmtFollowers(m.followers);
              const erText = fmtEr(m.er);
              return (
                <li
                  key={m.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-2xl border p-4 transition-standard",
                    inShortlist ? "border-fg bg-fg/[0.04]" : "border-line bg-surface",
                    m.overBudget && !inShortlist ? "opacity-60" : "",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Avatar name={m.name} src={m.avatarUrl} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold text-fg">{m.name}</span>
                        <span className="shrink-0 rounded-full bg-fg px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-bg">
                          Uyum {m.matchScore}
                        </span>
                      </div>
                      <p className="truncate text-[12px] text-fg-muted">
                        {handleText ? `${handleText} · ` : ""}{m.category}{m.city ? ` · ${m.city}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] tabular-nums">
                        <span title={followerText === "—" ? UNMEASURED_HINT : undefined}>
                          <strong>{followerText}</strong>{followerText !== "—" ? " takipçi" : ""}
                        </span>
                        <span title={erText === "—" ? UNMEASURED_HINT : undefined}>ER {erText}</span>
                        <span className="rounded-full border border-line px-2 py-0.5 text-[10px]">
                          {m.hasVerifiedApiAccount ? "Bağlı hesap (API)" : "Hesap bağlanmadı · doğrulanmamış veri"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {m.reasons.length > 0 ? (
                    <div className="rounded-xl bg-surface-muted/40 px-3 py-2 text-[12px]">
                      <span className="text-[11px] font-semibold text-fg-muted">Neden bu influencer?</span>
                      <ul className="mt-1 flex flex-col gap-0.5 text-fg">
                        {m.reasons.slice(0, 3).map((r) => (
                          <li key={r}>• {r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {m.brandSafetyWarnings.length > 0 ? (
                    <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                      Marka güvenliği: {m.brandSafetyWarnings.join(" · ")}
                    </p>
                  ) : null}

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-[12px]">
                    <span className="tabular-nums text-fg-muted">
                      Tahmini: {formatMinor(m.estimatedFeeRangeKurus.min, currency)}–{formatMinor(m.estimatedFeeRangeKurus.max, currency)}
                      {m.overBudget ? " (bütçe üstü)" : ""}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCompare(m.id)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px]",
                          compareIds.includes(m.id) ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:border-fg/40",
                        )}
                      >
                        {compareIds.includes(m.id) ? "Karşılaştırılıyor" : "Karşılaştır"}
                      </button>
                      <Button
                        type="button"
                        size="sm"
                        variant={inShortlist ? "primary" : "secondary"}
                        onClick={() => toggleShortlist(m.id)}
                      >
                        {inShortlist ? "★ Kısa listede" : "☆ Kısa listeye ekle"}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Alt eylem çubuğu: Taslak kaydet vs Onaylı yayınla & teklif gönder */}
          <Card interactive={false} className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" onClick={() => setStep(2)}>
              ← Brief&apos;e dön
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" disabled={isPending} onClick={() => handleFinalize("save_draft")}>
                Taslak olarak kaydet
              </Button>
              {shortlist.size > 0 ? (
                <>
                  <Button type="button" variant="ghost" disabled={isPending} onClick={() => handleFinalize("publish_only")}>
                    Teklif göndermeden yayınla
                  </Button>
                  <Button type="button" variant="primary" disabled={isPending} onClick={() => setConfirmOpen(true)}>
                    {`Yayınla ve ${shortlist.size} kişiye teklif gönder…`}
                  </Button>
                </>
              ) : (
                <Button type="button" variant="primary" disabled={isPending} onClick={() => handleFinalize("publish_only")}>
                  Kampanyayı yayınla
                </Button>
              )}
            </div>
          </Card>
        </div>
      ) : null}

      {/* Onay penceresi: kişi listesi, kişi başı ücret, toplam tutar ve mesaj önizlemesi */}
      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-offer-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="quick-offer-confirm-title" className="text-base font-semibold text-fg">
                  {`${selectedMatches.length} influencer'a teklif göndermeyi onayla`}
                </h3>
                <p className="mt-1 text-[12px] text-fg-muted">
                  Onayladığınızda kampanya yayınlanır ve yalnızca aşağıdaki kişilere teklif iletilir.
                </p>
              </div>
              <button type="button" onClick={() => setConfirmOpen(false)} aria-label="Kapat" className="text-fg-muted hover:text-fg">
                <XIcon size={16} />
              </button>
            </div>

            <ul className="max-h-48 divide-y divide-line overflow-y-auto rounded-xl border border-line text-[13px]">
              {selectedMatches.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div>
                    <span className="font-medium text-fg">{m.name}</span>
                    {m.handle ? <span className="ml-2 text-[11px] text-fg-muted">{formatHandle(m.handle)}</span> : null}
                  </div>
                  <span className="tabular-nums text-[12px] text-fg">
                    {formatMinor(m.estimatedFeeRangeKurus.min, currency)}–{formatMinor(m.estimatedFeeRangeKurus.max, currency)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-between rounded-xl bg-surface-muted/60 px-3 py-2 text-[13px]">
              <span className="text-fg-muted">Tahmini toplam ({selectedMatches.length} kişi · Tahmin)</span>
              <span className="font-semibold tabular-nums text-fg">
                {formatMinor(shortlistFeeMin, currency)} – {formatMinor(shortlistFeeMax, currency)}
              </span>
            </div>

            <Field label="Mesaj önizlemesi">
              {(p) => <Textarea {...p} rows={3} value={offerMessage} onChange={(e) => setOfferMessage(e.target.value)} />}
            </Field>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmOpen(false)}>
                Vazgeç
              </Button>
              <Button
                type="button"
                size="sm"
                variant="primary"
                disabled={isPending}
                onClick={() => handleFinalize("publish_and_send_offers")}
              >
                <CheckIcon size={13} /> {isPending ? "Gönderiliyor…" : `Onayla ve ${selectedMatches.length} teklif gönder`}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

