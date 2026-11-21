"use client";
import { useTT } from "@/lib/i18n/tt-client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { ContentType, Platform } from "@infulancer/core/enums";
import { COUNTRIES, GENDERS, OBJECTIVES, type ContentPlanItem, type DraftCheck } from "@infulancer/core/domain/campaign-plan";
import { MAX_CAMPAIGN_AMOUNT_LABEL } from "@infulancer/core/domain/money";
import { contentTypeLabels, platformLabels } from "@infulancer/core/domain/labels";
import { platformRules } from "@infulancer/core/domain/platform-rules";
import { formatDualMinor } from "@infulancer/core/i18n/regions";
import { ActionForm, type FormAction } from "@/components/forms/action-form";
import { FileUploader } from "@/components/files/file-uploader";
import { CheckIcon, PlusIcon, SearchIcon, XIcon } from "@/components/icons";
import { PlatformIcon } from "@/components/platform-icon";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonClass, Field, Input, Select, Textarea } from "@/components/ui/form";
import {
  wizardAudienceAction,
  wizardBasicsAction,
  wizardBriefAction,
  wizardContentPlanAction,
  wizardInfluencersAction,
  wizardMediaAction,
  wizardScheduleAction,
  wizardSubmitAction,
} from "@/lib/actions/campaign-wizard";
import { cn } from "@/lib/cn";

import { fmtEr, fmtFollowers, fmtTrDate, formatHandle, UNMEASURED_HINT } from "@/lib/format";
import { formatMinor } from "@infulancer/core/i18n/regions";

const PLATFORMS: Platform[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE"];

const INTEREST_TAXONOMY = [
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
  "ev & dekorasyon",
  "oyun",
];

const AGE_PRESETS: { label: string; min: number; max: number }[] = [
  { label: "18–24", min: 18, max: 24 },
  { label: "25–34", min: 25, max: 34 },
  { label: "18–34", min: 18, max: 34 },
  { label: "35–44", min: 35, max: 44 },
  { label: "45+", min: 45, max: 65 },
];

function estimateMicroCountRange(budgetMajor: number, currency: string): { min: number; max: number } | null {
  if (!Number.isFinite(budgetMajor) || budgetMajor <= 0) return null;
  // Basit tahmini mikro influencer aralığı (TR: 4.000–7.500 TL/kişi; EUR/USD: 150–300/kişi)
  const unitLow = currency === "TRY" ? 4000 : 150;
  const unitHigh = currency === "TRY" ? 7500 : 300;
  const min = Math.max(1, Math.floor(budgetMajor / unitHigh));
  const max = Math.max(min, Math.ceil(budgetMajor / unitLow));
  return { min, max };
}

/**
 * Ortak adım formu: her adımın altında aynı üç eylem durur, böylece kullanıcı hangi adımda olursa
 * olsun ne yapacağını görür — "Kaydet ve devam", "Taslağı kaydet" ve "Geri".
 */
function StepForm({
  action,
  id,
  backHref,
  submitLabel = "Kaydet ve devam →",
  allowStay = true,
  label,
  children,
}: {
  action: FormAction;
  id?: string;
  backHref?: string | null;
  submitLabel?: string;
  allowStay?: boolean;
  label: string;
  children: ReactNode;
}) {
  const tt = useTT();
  return (
    <ActionForm
      action={action}
      aria-label={label}
      submitLabel={submitLabel}
      className="gap-6"
      footer={
        <>
          {allowStay && id ? (
            <Button type="submit" name="intent" value="stay" variant="secondary">{tt("Taslağı kaydet")}</Button>
          ) : null}
          {backHref ? (
            <Link href={backHref} className={cn(buttonClass("ghost"), "sm:ml-auto")}>{tt("← Geri")}</Link>
          ) : null}
        </>
      }
    >
      {id ? <input type="hidden" name="id" value={id} /> : null}
      {children}
    </ActionForm>
  );
}

function Chip({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] transition-standard",
        on ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:border-fg/40 hover:text-fg",
      )}
    >
      {on ? <CheckIcon size={13} /> : null}
      {children}
    </button>
  );
}

// ───────────────────────── 1. Temel bilgiler ─────────────────────────
export function BasicsStep({
  id,
  brands,
  values,
}: {
  id?: string;
  brands?: { id: string; name: string }[];
  values?: { name: string; objective: string | null; secondaryObjective?: string | null; description: string | null; brandId: string };
}) {
  const tt = useTT();
  const [objective, setObjective] = useState(values?.objective ?? "bilinirlik");
  const [secondaryObjective, setSecondaryObjective] = useState(values?.secondaryObjective ?? "");
  return (
    <StepForm action={wizardBasicsAction} id={id} label={tt("Temel bilgiler")} submitLabel={id ? tt("Kaydet ve devam →") : tt("Taslağı oluştur ve devam →")}>
      <input type="hidden" name="objective" value={objective} />
      <input type="hidden" name="secondaryObjective" value={secondaryObjective === objective ? "" : secondaryObjective} />
      {brands && !id ? (
        <Field label={tt("Marka")}>
          {(p) => (
            <Select {...p} name="brandId" required defaultValue={values?.brandId ?? ""}>
              <option value="" disabled>{tt("Marka seçin")}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <Field label={tt("Kampanya adı")} hint={tt("Influencerlar ve raporlar bu adı görür.")}>
        {(p) => <Input {...p} name="name" required minLength={3} maxLength={140} defaultValue={values?.name} placeholder={tt("Yaz koleksiyonu lansmanı")} />}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label text-fg-muted">{tt("Ana hedef")}</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="radiogroup" aria-label={tt("Kampanyanın amacı")}>
          {OBJECTIVES.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={objective === o.id}
              onClick={() => {
                setObjective(o.id);
                if (secondaryObjective === o.id) setSecondaryObjective("");
              }}
              className={cn(
                "flex flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-standard",
                objective === o.id ? "border-fg ring-1 ring-fg/40" : "border-line hover:border-fg/40",
              )}
            >
              <span className="text-[15px] font-semibold">{o.title}</span>
              <span className="text-[12px] text-fg-muted">{o.text}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-fg-muted">{tt("İkincil hedef (isteğe bağlı):")}</span>
          {OBJECTIVES.filter((o) => o.id !== objective).map((o) => (
            <Chip
              key={o.id}
              on={secondaryObjective === o.id}
              onClick={() => setSecondaryObjective(secondaryObjective === o.id ? "" : o.id)}
            >
              {o.title}
            </Chip>
          ))}
        </div>
        <p className="text-[12px] text-fg-passive">{tt("Ana ve ikincil hedefe göre ölçülecek KPI hedefleri ve önerilen içerik planı otomatik hazırlanır.")}</p>
      </fieldset>
      <Field label={tt("Kısa açıklama")} hint={tt("Ürün/hizmet, kampanyanın hikâyesi, beklenen sonuç.")}>
        {(p) => <Textarea {...p} name="description" rows={4} maxLength={4000} defaultValue={values?.description ?? ""} />}
      </Field>
    </StepForm>
  );
}

// ───────────────────────── 2. Hedef kitle ─────────────────────────
export function AudienceStep({
  id,
  backHref,
  values,
  categoryOptions,
}: {
  id: string;
  backHref: string;
  values: { targetCountries: string[]; platforms: Platform[]; audienceAgeMin: number | null; audienceAgeMax: number | null; audienceGender: string | null; audienceInterests: string[] };
  categoryOptions?: string[];
}) {
  const tt = useTT();
  const [countries, setCountries] = useState<string[]>(values.targetCountries.length ? values.targetCountries : ["TR"]);
  const [platforms, setPlatforms] = useState<Platform[]>(values.platforms.length ? values.platforms : ["INSTAGRAM"]);
  const [ageMin, setAgeMin] = useState<number>(values.audienceAgeMin ?? 18);
  const [ageMax, setAgeMax] = useState<number>(values.audienceAgeMax ?? 34);
  const [selectedInterests, setSelectedInterests] = useState<string[]>(values.audienceInterests);
  const [showCurrencyTip, setShowCurrencyTip] = useState(false);
  const [curNote, setCurNote] = useState<string | null>(null);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const allCategoryTags = useMemo(() => {
    const base = [...(categoryOptions ?? []), ...INTEREST_TAXONOMY, ...values.audienceInterests];
    return [...new Set(base.map((x) => x.trim().toLocaleLowerCase("tr")).filter(Boolean))];
  }, [categoryOptions, values.audienceInterests]);

  return (
    <StepForm action={wizardAudienceAction} id={id} backHref={backHref} label={tt("Hedef kitle")}>
      {countries.map((c) => (
        <input key={c} type="hidden" name="targetCountries" value={c} />
      ))}
      {platforms.map((p) => (
        <input key={p} type="hidden" name="platforms" value={p} />
      ))}
      {selectedInterests.map((tag) => (
        <input key={tag} type="hidden" name="audienceInterestTags" value={tag} />
      ))}
      <fieldset className="flex flex-col gap-2">
        <div className="mb-1 flex items-center gap-2">
          <legend className="text-label text-fg-muted">{tt("Yayınlanacak ülkeler")}</legend>
          <button
            type="button"
            onClick={() => setShowCurrencyTip((v) => !v)}
            aria-label={tt("Para birimi bilgisi")}
            title={tt("Farklı para birimli ülkeler seçildiğinde bütçe ve teklifler otomatik dönüştürülür.")}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-[11px] font-semibold text-fg-muted hover:border-fg/40 hover:text-fg"
          >
            i
          </button>
        </div>
        {showCurrencyTip ? (
          <p className="rounded-xl border border-line bg-surface-muted/40 px-3 py-2 text-[12px] text-fg-muted">
            {tt("Yerel ve global ülkeleri aynı anda seçebilirsiniz. Farklı para birimli ülkelerdeki influencerlar bütçe ve teklifleri kendi para birimlerinde görür.")}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {COUNTRIES.map((c) => (
            <Chip
              key={c.code}
              on={countries.includes(c.code)}
              onClick={() => {
                const next = toggle(countries, c.code);
                setCountries(next);
                const selectedCurrencies = new Set(
                  next.map((code) => COUNTRIES.find((x) => x.code === code)?.currency).filter(Boolean),
                );
                if (selectedCurrencies.size > 1) {
                  setCurNote(
                    `Çoklu Para Birimi Aktif (${[...selectedCurrencies].join(" + ")}): Teklifler otomatik kur dönüşümü ile gösterilir.`,
                  );
                } else {
                  setCurNote(null);
                }
              }}
            >
              {c.name} <span className="opacity-60">{c.currency}</span>
            </Chip>
          ))}
        </div>
        {curNote ? (
          <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] font-medium text-emerald-700 dark:text-emerald-300">
            {curNote}
          </p>
        ) : null}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label text-fg-muted">{tt("Platformlar")}</legend>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <Chip key={p} on={platforms.includes(p)} onClick={() => setPlatforms(toggle(platforms, p))}>
              <PlatformIcon platform={p} size={14} /> {platformLabels[p]}
            </Chip>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        <span className="text-label text-fg-muted">{tt("Yaş aralığı ve cinsiyet")}</span>
        <div className="flex flex-wrap gap-1.5">
          {AGE_PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              on={ageMin === preset.min && ageMax === preset.max}
              onClick={() => {
                setAgeMin(preset.min);
                setAgeMax(preset.max);
              }}
            >
              {preset.label}
            </Chip>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label={tt("Yaş (en küçük)")}>
            {(p) => <Input {...p} name="audienceAgeMin" type="number" min={13} max={80} value={ageMin} onChange={(e) => setAgeMin(Number(e.target.value) || 18)} />}
          </Field>
          <Field label={tt("Yaş (en büyük)")}>
            {(p) => <Input {...p} name="audienceAgeMax" type="number" min={13} max={80} value={ageMax} onChange={(e) => setAgeMax(Number(e.target.value) || 34)} />}
          </Field>
          <Field label={tt("Cinsiyet")}>
            {(p) => (
              <Select {...p} name="audienceGender" defaultValue={values.audienceGender ?? "hepsi"}>
                {GENDERS.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-label text-fg-muted">{tt("İlgi alanları (kategori sözlüğü)")}</legend>
        <div className="flex flex-wrap gap-2">
          {allCategoryTags.map((tag) => (
            <Chip key={tag} on={selectedInterests.includes(tag)} onClick={() => setSelectedInterests(toggle(selectedInterests, tag))}>
              {tag}
            </Chip>
          ))}
        </div>
        <p className="text-[12px] text-fg-passive">{tt("Influencer kategorileriyle birebir eşleşen etiketleri seçin (en fazla 15).")}</p>
      </fieldset>
    </StepForm>
  );
}

// ───────────────────────── 3. Tarih ve bütçe ─────────────────────────
const DURATIONS = [
  { label: "2 hafta", days: 14 },
  { label: "1 ay", days: 30 },
  { label: "3 ay", days: 90 },
];
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export function ScheduleStep({
  id,
  backHref,
  isAdmin,
  values,
}: {
  id: string;
  backHref: string;
  isAdmin: boolean;
  values: { startsAt: string; endsAt: string; brandTotalFee: string; budget: string; currency?: string };
}) {
  const tt = useTT();
  const baseCur = values.currency ?? "TRY";
  const symbol = baseCur === "USD" ? "$" : baseCur === "EUR" ? "€" : baseCur === "GBP" ? "£" : "₺";
  const formatLiveCurrency = (raw: string): { display: string; rawDigits: string } => {
    const digits = raw.replace(/[^\d]/g, "");
    if (!digits) return { display: "", rawDigits: "" };
    const formatted = Number(digits).toLocaleString("tr-TR");
    return { display: `${formatted} ${symbol}`, rawDigits: digits };
  };
  const [startsAt, setStartsAt] = useState(values.startsAt);
  const [endsAt, setEndsAt] = useState(values.endsAt);
  const initialDigits = String(values.brandTotalFee || "").replace(/[^\d]/g, "");
  const [feeDigits, setFeeDigits] = useState(initialDigits);
  const [feeDisplay, setFeeDisplay] = useState(() => formatLiveCurrency(initialDigits).display);
  const days = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 86_400_000) + 1;
  const parsedMajor = Number(feeDigits || "0");
  const microEstimate = estimateMicroCountRange(parsedMajor, baseCur);

  return (
    <StepForm action={wizardScheduleAction} id={id} backHref={backHref} label={tt("Tarih ve bütçe")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={tt("Başlangıç")} hint={fmtTrDate(startsAt)}>
          {(p) => <Input {...p} name="startsAt" type="date" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}
        </Field>
        <Field label={tt("Bitiş")} hint={fmtTrDate(endsAt)}>
          {(p) => <Input {...p} name="endsAt" type="date" required min={startsAt} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {DURATIONS.map((d) => (
          <button key={d.label} type="button" onClick={() => setEndsAt(addDays(startsAt, d.days - 1))} className="rounded-full border border-line px-3 py-1 text-[12px] text-fg-muted hover:border-fg/40 hover:text-fg">
            {d.label}
          </button>
        ))}
        <span className="text-[12px] tabular-nums text-fg-passive">
          {days > 0 ? `${fmtTrDate(startsAt)} – ${fmtTrDate(endsAt)} (${days} gün)` : tt("Bitiş başlangıçtan önce olamaz")}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <input type="hidden" name="brandTotalFee" value={feeDigits} />
        <Field label={tt("Toplam Bütçe")}>
          {(p) => (
            <Input
              {...p}
              required
              inputMode="numeric"
              value={feeDisplay}
              onChange={(e) => {
                const next = formatLiveCurrency(e.target.value);
                setFeeDigits(next.rawDigits);
                setFeeDisplay(next.display);
              }}
              placeholder={`15.000 ${symbol}`}
            />
          )}
        </Field>
        {microEstimate ? (
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-fg-muted">
            <span>
              Bu bütçeyle yaklaşık <strong className="text-fg">{microEstimate.min}–{microEstimate.max} mikro influencer</strong> ile çalışabilirsiniz.
            </span>
            <span className="rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
              Tahmin
            </span>
          </p>
        ) : null}
      </div>
    </StepForm>
  );
}

// ───────────────────────── 4. İçerik planı ─────────────────────────
export type PlanRow = { platform: Platform; contentType: ContentType; count: number; notes: string };
const PRESETS: { label: string; rows: PlanRow[] }[] = [
  { label: "1 Reels + 3 Story", rows: [{ platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "" }, { platform: "INSTAGRAM", contentType: "STORY", count: 3, notes: "" }] },
  { label: "Instagram carousel", rows: [{ platform: "INSTAGRAM", contentType: "CAROUSEL", count: 1, notes: "" }] },
  { label: "TikTok video", rows: [{ platform: "TIKTOK", contentType: "VIDEO", count: 1, notes: "" }] },
  { label: "YouTube + Shorts", rows: [{ platform: "YOUTUBE", contentType: "VIDEO", count: 1, notes: "Entegrasyon (60–90 sn)" }, { platform: "YOUTUBE", contentType: "SHORTS", count: 2, notes: "" }] },
];
/** İçerik planı satır düzenleyicisi (sihirbaz ve ajansın toplu plan formu ortak kullanır). */
export function PlanEditor({ rows, setRows, platforms }: { rows: PlanRow[]; setRows: (fn: (r: PlanRow[]) => PlanRow[]) => void; platforms: Platform[] }) {
  const tt = useTT();
  const first = (platforms.length ? platforms : PLATFORMS)[0]!;
  const set = (i: number, patch: Partial<PlanRow>) =>
    setRows((r) =>
      r.map((row, j) => {
        if (j !== i) return row;
        const next = { ...row, ...patch };
        if (patch.platform && !platformRules[patch.platform].contentTypes.includes(next.contentType)) next.contentType = platformRules[patch.platform].contentTypes[0]!;
        return next;
      }),
    );
  const total = rows.reduce((s, r) => s + (Number(r.count) || 0), 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" aria-label={tt("Hazır planlar")}>
        {PRESETS.map((p) => (
          <button key={p.label} type="button" onClick={() => setRows(() => p.rows)} className="rounded-full border border-line px-3 py-1 text-[12px] text-fg-muted hover:border-fg/40 hover:text-fg">
            {p.label}
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row, i) => (
          <li key={i} className="grid grid-cols-2 gap-3 rounded-2xl border border-line p-3 md:grid-cols-[1fr_1fr_100px_1.6fr_auto] md:items-end">
            <Field label={tt("Platform")}>
              {(p) => (
                <Select {...p} value={row.platform} onChange={(e) => set(i, { platform: e.target.value as Platform })}>
                  {PLATFORMS.map((pl) => (
                    <option key={pl} value={pl}>
                      {platformLabels[pl]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={tt("İçerik tipi")}>
              {(p) => (
                <Select {...p} value={row.contentType} onChange={(e) => set(i, { contentType: e.target.value as ContentType })}>
                  {platformRules[row.platform].contentTypes.map((t) => (
                    <option key={t} value={t}>
                      {contentTypeLabels[t]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={row.contentType === "STORY" ? tt("Kare") : tt("Adet")}>{(p) => <Input {...p} type="number" min={1} max={20} value={row.count} onChange={(e) => set(i, { count: Number(e.target.value) })} />}</Field>
            <Field label={tt("Not")}>{(p) => <Input {...p} value={row.notes} maxLength={500} placeholder={tt("ör. ürünü kullanırken, 15–30 sn")} onChange={(e) => set(i, { notes: e.target.value })} />}</Field>
            <Button variant="ghost" size="sm" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={`Satır ${i + 1} sil`} disabled={rows.length === 1}>
              <XIcon size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" size="sm" onClick={() => setRows((r) => [...r, { platform: first, contentType: platformRules[first].contentTypes[0]!, count: 1, notes: "" }])} disabled={rows.length >= 20}>
          <PlusIcon size={14} />{" "}{tt("Satır ekle")}</Button>
        <span className="text-[13px] tabular-nums text-fg-muted">{tt("Influencer başına")}{" "}{total}{" "}{tt("içerik")}</span>
      </div>
    </div>
  );
}
export function defaultPlanRow(platforms: Platform[]): PlanRow {
  const first = (platforms.length ? platforms : PLATFORMS)[0]!;
  return { platform: first, contentType: platformRules[first].contentTypes[0]!, count: 1, notes: "" };
}
export function defaultPlanRowsForPlatforms(platforms: Platform[]): PlanRow[] {
  const active = platforms.length ? platforms : (["INSTAGRAM"] as Platform[]);
  const rows: PlanRow[] = [];
  if (active.includes("INSTAGRAM")) {
    rows.push({ platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "" });
  }
  if (active.includes("TIKTOK")) {
    rows.push({ platform: "TIKTOK", contentType: "VIDEO", count: 1, notes: "" });
  }
  if (active.includes("YOUTUBE")) {
    rows.push({ platform: "YOUTUBE", contentType: "SHORTS", count: 1, notes: "" });
  }
  return rows.length ? rows : [defaultPlanRow(platforms)];
}

export function ContentPlanStep({ id, backHref, plan, platforms }: { id: string; backHref: string; plan: ContentPlanItem[]; platforms: Platform[] }) {
  const tt = useTT();
  const [rows, setRows] = useState<PlanRow[]>(plan.length ? plan : defaultPlanRowsForPlatforms(platforms));
  return (
    <StepForm action={wizardContentPlanAction} id={id} backHref={backHref} label={tt("İçerik planı")}>
      {/* Ham JSON dizgisi yerine düz form alanları gönderilir (CloudFront/WAF 403 engellemesini önler). */}
      {rows.map((r, idx) => (
        <span key={idx} className="hidden" aria-hidden>
          <input type="hidden" name="planPlatform" value={r.platform} />
          <input type="hidden" name="planContentType" value={r.contentType} />
          <input type="hidden" name="planCount" value={String(Number(r.count) || 0)} />
          <input type="hidden" name="planNotes" value={r.notes} />
        </span>
      ))}
      <p className="text-[13px] text-fg-muted">{tt("Her influencer için aynı plan uygulanır; seçilen platformlarınıza göre başlangıç planı hazırlandı. Story satırında adet = kare sayısı.")}</p>
      <PlanEditor rows={rows} setRows={setRows} platforms={platforms} />
    </StepForm>
  );
}

// ───────────────────────── 5. Brief ─────────────────────────
export function BriefStep({
  id,
  backHref,
  latest,
  advertiser,
}: {
  id: string;
  backHref: string;
  latest: { text: string; dos: string[]; donts: string[]; hashtags: string[]; mentions: string[]; disclosureRequired: boolean; version: number } | null;
  advertiser: string;
}) {
  const tt = useTT();
  const [dirty, setDirty] = useState(!latest);
  return (
    <StepForm action={wizardBriefAction} id={id} backHref={backHref} label={tt("Brief")}>
      <input type="hidden" name="unchanged" value={dirty ? "0" : "1"} />
      <div className="contents" onChange={() => setDirty(true)}>
        {latest ? <p className="text-[12px] text-fg-passive">{tt("Son kayıt: sürüm")}{" "}{latest.version}{tt(". Değiştirip kaydederseniz yeni sürüm açılır.")}</p> : null}
        <Field label={tt("Brief metni")} hint={tt("Ana mesaj, tonu, ürünün öne çıkan özellikleri.")}>
          {(p) => <Textarea {...p} name="text" rows={7} required minLength={10} defaultValue={latest?.text} />}
        </Field>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label={tt("Yapılacaklar")} hint={tt("Her satıra bir madde.")}>
            {(p) => <Textarea {...p} name="dos" rows={4} defaultValue={latest?.dos.join("\n")} />}
          </Field>
          <Field label={tt("Yapılmayacaklar")} hint={tt("Her satıra bir madde.")}>
            {(p) => <Textarea {...p} name="donts" rows={4} defaultValue={latest?.donts.join("\n")} />}
          </Field>
          <Field label={tt("Hashtagler")}>{(p) => <Input {...p} name="hashtags" defaultValue={latest?.hashtags.join(" ")} placeholder="#markaadi #reklam" />}</Field>
          <Field label={tt("Bahsetmeler")}>{(p) => <Input {...p} name="mentions" defaultValue={latest?.mentions.join(" ")} placeholder={tt("@markahesabi")} />}</Field>
        </div>
        <label className="flex items-start gap-2 text-sm text-fg-muted">
          <input type="checkbox" name="disclosureRequired" defaultChecked={latest?.disclosureRequired ?? true} className="mt-0.5 h-4 w-4 accent-[var(--color-fg)]" />
          <span>{tt("Reklam ibaresi zorunlu")}<span className="block text-[12px] text-fg-passive">{tt("Yasal zorunluluk: her içerikte “Reklam” ve")}{" "}{advertiser}{" "}{tt("adı görünür.")}</span>
          </span>
        </label>
      </div>
    </StepForm>
  );
}

// ───────────────────────── 6. Medya ─────────────────────────
export function MediaStep({ id, backHref, gallery }: { id: string; backHref: string; gallery: ReactNode }) {
  const tt = useTT();
  return (
    <div className="flex flex-col gap-6">
      <FileUploader
        target={{ type: "campaign", id }}
        multiple
        label={tt("Fotoğraf veya video ekle")}
        hint={tt("Birden çok dosya seçebilirsiniz. Ürün görselleri, örnek çekimler, logo, brief PDF. Influencerlar atandıktan sonra görür.")}
        accept="image/*,video/*,application/pdf"
        kinds={[
          { value: "URUN_FOTO", label: "Ürün fotoğrafı" },
          { value: "ORNEK_CEKIM", label: "Örnek çekim (video/fotoğraf)" },
          { value: "MARKA_LOGO", label: "Marka logosu" },
          { value: "BRIEF_PDF", label: "Brief PDF" },
          { value: "DIGER", label: "Diğer" },
        ]}
      />
      {gallery}
      <StepForm action={wizardMediaAction} id={id} backHref={backHref} label={tt("Medya")} allowStay={false}>
        <p className="text-[12px] text-fg-passive">{tt("Dosyalar yüklendiği anda kaydedilir. Bu adım isteğe bağlıdır.")}</p>
      </StepForm>
    </div>
  );
}

// ───────────────────────── 7. Influencerlar (Kısa Liste + Sağ Kampanya Bilgi Alanı) ─────────────────────────
export type WizardInfluencer = {
  id: string;
  name: string;
  category: string;
  city: string | null;
  avatarUrl: string | null;
  platforms: Platform[];
  followers: number;
  er: number | null;
  handle: string | null;
  verified?: boolean;
  matchScore?: number;
  matchReasons?: string[];
  estimatedFeeKurus?: number | null;
  brandSafetyWarning?: string | null;
};
export type WizardCampaignSummary = {
  name: string;
  objective: string | null;
  dates: string;
  budgetLabel: string;
  budgetKurus?: number;
  currency?: string;
  countriesLabel: string;
  planSummary: string[];
};
export type SubmitOfferPreview = {
  currency: string;
  defaultMessage: string;
  totalKurus: number;
  pendingCount: number;
  recipients: {
    influencerId: string;
    name: string;
    handle: string | null;
    estimatedTotalKurus: number;
    alreadyOffered: boolean;
  }[];
};

export function InfluencerStep({
  id,
  backHref,
  influencers,
  selected: initial,
  note,
  campaignSummary,
  profileBaseHref = "/marka/kesfet",
}: {
  id: string;
  backHref: string;
  influencers: WizardInfluencer[];
  selected: string[];
  note: string;
  campaignSummary?: WizardCampaignSummary;
  profileBaseHref?: string;
}) {
  const tt = useTT();
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [platform, setPlatform] = useState<"" | Platform>("");
  const [minFollowers, setMinFollowers] = useState("");
  const cats = useMemo(() => [...new Set(influencers.map((i) => i.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr")), [influencers]);
  const minF = Number(minFollowers) || 0;
  const shown = influencers.filter(
    (i) =>
      (!q || i.name.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")) || (i.handle ?? "").toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr"))) &&
      (!cat || i.category === cat) &&
      (!platform || i.platforms.includes(platform)) &&
      i.followers >= minF,
  );
  const selectedItems = useMemo(() => influencers.filter((i) => selected.has(i.id)), [influencers, selected]);
  const comparedItems = useMemo(() => influencers.filter((i) => compareIds.includes(i.id)), [influencers, compareIds]);
  const allShown = shown.length > 0 && shown.every((i) => selected.has(i.id));
  const toggle = (iid: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(iid)) n.delete(iid);
      else n.add(iid);
      return n;
    });
  const toggleCompare = (iid: string) =>
    setCompareIds((prev) => {
      if (prev.includes(iid)) return prev.filter((x) => x !== iid);
      if (prev.length >= 4) return prev;
      return [...prev, iid];
    });
  const estimatedShortlistLow = selectedItems.reduce((sum, item) => sum + Math.round((item.estimatedFeeKurus ?? 450_000) * 0.85), 0);
  const estimatedShortlistHigh = selectedItems.reduce((sum, item) => sum + Math.round((item.estimatedFeeKurus ?? 450_000) * 1.15), 0);
  const cur = campaignSummary?.currency ?? "TRY";
  const budgetKurus = campaignSummary?.budgetKurus ?? 0;

  return (
    <StepForm action={wizardInfluencersAction} id={id} backHref={backHref} label={tt("Influencer kısa listesi")}>
      {[...selected].map((s) => (
        <input key={s} type="hidden" name="influencerIds" value={s} />
      ))}
      <p className="text-[13px] text-fg-muted">{note}</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
            <label className="relative sm:col-span-2 xl:col-span-1">
              <span className="sr-only">{tt("Influencer ara")}</span>
              <SearchIcon size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-passive" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tt("İsim veya @kullanıcı ara")} className="pl-9" />
            </label>
            <Select aria-label={tt("Kategori")} value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">{tt("Tüm kategoriler")}</option>
              {cats.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select aria-label={tt("Platform")} value={platform} onChange={(e) => setPlatform(e.target.value as Platform | "")}>
              <option value="">{tt("Tüm platformlar")}</option>
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {platformLabels[p]}
                </option>
              ))}
            </Select>
            <Select aria-label={tt("Min takipçi")} value={minFollowers} onChange={(e) => setMinFollowers(e.target.value)}>
              <option value="">{tt("Takipçi (Tümü)")}</option>
              <option value="10000">10K+</option>
              <option value="50000">50K+</option>
              <option value="100000">100K+</option>
              <option value="500000">500K+</option>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-fg/[0.03] px-4 py-2.5 text-[13px]">
            <span className="font-semibold tabular-nums">{selected.size} {tt("kısa listede")}</span>
            <span className="text-fg-passive">· {shown.length} {tt("listeleniyor")}</span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              onClick={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  for (const i of shown) {
                    if (allShown) n.delete(i.id);
                    else n.add(i.id);
                  }
                  return n;
                })
              }
            >
              {allShown ? tt("Kısa Listeden Çıkar") : tt("Listelenenleri Kısa Listeye Ekle")}
            </Button>
            {selected.size ? (
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{tt("Temizle")}</Button>
            ) : null}
          </div>

          {comparedItems.length >= 2 ? (
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-fg">{tt("Yan Yana Karşılaştırma")} ({comparedItems.length}/4)</span>
                <button type="button" onClick={() => setCompareIds([])} className="text-[11px] text-fg-muted hover:text-fg">{tt("Kapat")}</button>
              </div>
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-line text-fg-passive">
                    <th className="py-1.5 pr-3">Metrik</th>
                    {comparedItems.map((ci) => (
                      <th key={ci.id} className="py-1.5 pr-3 font-semibold text-fg">{ci.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line tabular-nums">
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">Takipçi</td>
                    {comparedItems.map((ci) => <td key={ci.id} className="py-1.5 pr-3" title={ci.followers <= 0 ? UNMEASURED_HINT : undefined}>{fmtFollowers(ci.followers)}</td>)}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">ER</td>
                    {comparedItems.map((ci) => <td key={ci.id} className="py-1.5 pr-3" title={!ci.er || ci.er <= 0 ? UNMEASURED_HINT : undefined}>{fmtEr(ci.er)}</td>)}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">Uyum puanı</td>
                    {comparedItems.map((ci) => <td key={ci.id} className="py-1.5 pr-3 font-semibold">{ci.matchScore != null ? `${ci.matchScore}/100` : "—"}</td>)}
                  </tr>
                  <tr>
                    <td className="py-1.5 pr-3 text-fg-muted">Veri durumu</td>
                    {comparedItems.map((ci) => <td key={ci.id} className="py-1.5 pr-3">{ci.verified ? "Bağlı hesap (API)" : "Doğrulanmadı"}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={tt("Influencerlar")}>
            {shown.map((i) => {
              const on = selected.has(i.id);
              const overBudget = budgetKurus > 0 && (i.estimatedFeeKurus ?? 0) > budgetKurus;
              const cleanHandle = formatHandle(i.handle);
              const followerText = fmtFollowers(i.followers);
              const erText = fmtEr(i.er);
              return (
                <li key={i.id}>
                  <label
                    className={cn(
                      "flex h-full cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition-standard",
                      on ? "border-fg bg-fg/[0.04] shadow-sm" : "border-line bg-surface hover:border-fg/40",
                      overBudget && !on ? "opacity-65" : "",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(i.id)}
                        className="mt-1 h-4 w-4 accent-[var(--color-fg)]"
                        aria-label={`${i.name} kısa listeye ekle`}
                      />
                      <Avatar name={i.name} src={i.avatarUrl} size={44} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[15px] font-semibold text-fg">{i.name}</span>
                          {i.matchScore != null ? (
                            <span className="shrink-0 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-fg">
                              Uyum {i.matchScore}
                            </span>
                          ) : null}
                        </div>
                        <span className="truncate text-[12px] text-fg-muted">
                          {cleanHandle ? `${cleanHandle} · ` : ""}{i.category}
                        </span>
                        {i.city ? <span className="truncate text-[11px] text-fg-passive">{i.city}</span> : null}
                      </div>
                    </div>

                    {i.matchReasons?.length ? (
                      <ul className="flex flex-col gap-1 text-[11px] text-fg-muted">
                        {i.matchReasons.slice(0, 3).map((reason) => (
                          <li key={reason} className="truncate">• {reason}</li>
                        ))}
                      </ul>
                    ) : null}

                    {!i.verified ? (
                      <span className="text-[11px] text-fg-passive">Hesap bağlanmadı · doğrulanmamış veri</span>
                    ) : null}

                    {i.brandSafetyWarning ? (
                      <span className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-800 dark:text-amber-300">
                        Uyarı: {i.brandSafetyWarning}
                      </span>
                    ) : null}

                    <div className="flex items-center justify-between border-t border-line pt-2.5 text-[12px]">
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="font-semibold text-fg" title={followerText === "—" ? UNMEASURED_HINT : undefined}>
                          {followerText}{followerText !== "—" ? <span className="font-normal text-fg-muted"> {tt("takipçi")}</span> : null}
                        </span>
                        <span
                          className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted"
                          title={erText === "—" ? UNMEASURED_HINT : undefined}
                        >
                          ER {erText}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="flex gap-1 text-fg-muted">
                          {i.platforms.map((p) => (
                            <PlatformIcon key={p} platform={p} size={14} title={platformLabels[p]} />
                          ))}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleCompare(i.id);
                          }}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            compareIds.includes(i.id) ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:border-fg/40",
                          )}
                        >
                          {compareIds.includes(i.id) ? "Karşılaştırılıyor" : "Karşılaştır"}
                        </button>
                        <a
                          href={`${profileBaseHref}/${i.id}`}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-full border border-line bg-surface-muted/60 px-2.5 py-0.5 text-[11px] font-medium text-fg hover:border-fg/40"
                        >
                          {tt("Profili Gör ↗")}
                        </a>
                      </div>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
          {shown.length === 0 ? <p className="rounded-2xl border border-dashed border-line p-6 text-center text-[13px] text-fg-passive">{tt("Bu filtreye uygun influencer bulunamadı.")}</p> : null}
        </div>

        {/* Sağ: Kampanya Bilgi & Kısa Liste Özeti */}
        <aside className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 lg:sticky lg:top-6">
          <div className="flex flex-col gap-1 border-b border-line pb-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted">{tt("Kampanya Bilgileri")}</span>
            <h3 className="text-[15px] font-semibold text-fg">{campaignSummary?.name || tt("Yeni Kampanya")}</h3>
            {campaignSummary?.objective ? (
              <span className="text-[12px] text-fg-muted">{OBJECTIVES.find((o) => o.id === campaignSummary.objective)?.title ?? campaignSummary.objective}</span>
            ) : null}
          </div>

          {campaignSummary ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
              <dt className="text-fg-passive">{tt("Tarih")}</dt>
              <dd className="text-right font-medium tabular-nums text-fg">{campaignSummary.dates}</dd>
              <dt className="text-fg-passive">{tt("Bütçe")}</dt>
              <dd className="text-right font-semibold tabular-nums text-fg">{campaignSummary.budgetLabel}</dd>
              <dt className="text-fg-passive">{tt("Hedef Ülke")}</dt>
              <dd className="text-right text-fg-muted">{campaignSummary.countriesLabel}</dd>
            </dl>
          ) : null}

          {campaignSummary?.planSummary.length ? (
            <div className="flex flex-col gap-1.5 border-t border-line pt-3">
              <span className="text-[11px] font-medium text-fg-muted">{tt("İçerik Planı")}</span>
              <ul className="flex flex-wrap gap-1.5">
                {campaignSummary.planSummary.map((p) => (
                  <li key={p} className="rounded-full border border-line bg-surface-muted/50 px-2.5 py-0.5 text-[11px] text-fg">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <span className="text-[11px] font-medium text-fg-muted">
              {tt("Kısa Liste")} ({selectedItems.length})
            </span>
            {selectedItems.length > 0 ? (
              <div className="rounded-xl border border-line bg-surface-muted/40 px-3 py-2 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-fg-muted">Tahmini toplam</span>
                  <span className="rounded-full border border-line px-1.5 py-0.5 text-[10px] font-semibold uppercase text-fg-muted">Tahmin</span>
                </div>
                <p className="mt-0.5 font-semibold tabular-nums text-fg">
                  {formatMinor(estimatedShortlistLow, cur)} – {formatMinor(estimatedShortlistHigh, cur)}
                  {budgetKurus > 0 ? <span className="font-normal text-fg-muted"> / {formatMinor(budgetKurus, cur)}</span> : null}
                </p>
              </div>
            ) : null}
            {selectedItems.length === 0 ? (
              <p className="text-[12px] text-fg-passive">
                {tt("Sol listeden seçtiğiniz influencerlar kısa listeye eklenir. Teklifler otomatik gönderilmez; özet adımında onayınızla iletilir.")}
              </p>
            ) : (
              <ul className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
                {selectedItems.map((inf) => (
                  <li key={inf.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-muted/40 px-2.5 py-1.5 text-[12px]">
                    <span className="truncate font-medium text-fg">{inf.name}</span>
                    <button
                      type="button"
                      onClick={() => toggle(inf.id)}
                      className="text-[11px] text-fg-muted hover:text-critical"
                    >
                      {tt("Çıkar")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </StepForm>
  );
}

// ───────────────────────── 8. Özet ve kaydet ─────────────────────────
export function SubmitStep({
  id,
  backHref,
  checks,
  ready,
  isBrand,
  submittedAt,
  base,
  offerPreview,
}: {
  id: string;
  backHref: string;
  checks: DraftCheck[];
  ready: boolean;
  isBrand: boolean;
  submittedAt: string | null;
  base: string;
  offerPreview?: SubmitOfferPreview;
}) {
  const tt = useTT();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [offerMessage, setOfferMessage] = useState(offerPreview?.defaultMessage ?? "");
  const pendingRecipients = (offerPreview?.recipients ?? []).filter((r) => !r.alreadyOffered);
  const pendingCount = pendingRecipients.length;
  const currency = offerPreview?.currency ?? "TRY";

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line">
        {checks.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="flex items-center gap-3">
              <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full border", c.ok ? "border-fg bg-fg text-bg" : "border-critical text-critical")} aria-hidden>
                {c.ok ? <CheckIcon size={12} /> : "!"}
              </span>
              <span>
                <span className="text-fg">{stepTitle(c.key)}</span>
                <span className="block text-[12px] text-fg-muted">{c.note}</span>
              </span>
            </span>
            <Link href={`${base}?adim=${c.key}`} className="text-[12px] text-fg-muted underline-offset-4 hover:text-fg hover:underline">
              {c.ok ? tt("Düzenle") : tt("Tamamla")}
            </Link>
          </li>
        ))}
      </ul>

      {!ready ? <p className="text-[13px] text-critical">{tt("Kırmızı işaretli adımları tamamlayın; ardından yayınlayabilirsiniz.")}</p> : null}

      <p className="text-[12px] text-fg-passive">
        {submittedAt
          ? `Son yayın kaydı: ${submittedAt}. Taslak kaydetme hiçbir influencer'a teklif göndermez; teklifler yalnızca onay penceresinden iletilir.`
          : tt("Taslak olarak kaydettiğinizde hiçbir influencer'a teklif gitmez. Teklif göndermek isterseniz onay penceresinde kişi listesini ve tutarı kontrol edip onaylarsınız.")}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {/* 1. Buton: Taslak olarak kaydet (asla teklif göndermez) */}
        <ActionForm action={wizardSubmitAction} aria-label={tt("Taslak olarak kaydet")} className="flex-row items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="intent" value="save_draft" />
          <Button type="submit" variant="secondary">
            {tt("Taslak olarak kaydet")}
          </Button>
        </ActionForm>

        {/* 2. Buton: Yayınla (kısa listede kişi varsa onay modalı açar, yoksa sadece yayınlar) */}
        {pendingCount > 0 ? (
          <Button type="button" variant="primary" disabled={!ready} onClick={() => setConfirmOpen(true)}>
            {`Kampanyayı yayınla ve ${pendingCount} influencer'a teklif gönder…`}
          </Button>
        ) : (
          <ActionForm action={wizardSubmitAction} aria-label={tt("Kampanyayı yayınla")} className="flex-row items-center gap-2">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="intent" value="publish_only" />
            <Button type="submit" variant="primary" disabled={!ready}>
              {isBrand ? tt("Kampanyayı yayınla") : tt("Kampanyayı yayınla")}
            </Button>
          </ActionForm>
        )}

        {pendingCount > 0 ? (
          <ActionForm action={wizardSubmitAction} aria-label={tt("Yalnızca yayınla")} className="flex-row items-center gap-2">
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="intent" value="publish_only" />
            <Button type="submit" variant="ghost" disabled={!ready}>
              {tt("Teklif göndermeden yayınla")}
            </Button>
          </ActionForm>
        ) : null}

        {backHref ? (
          <Link href={backHref} className={cn(buttonClass("ghost"), "sm:ml-auto")}>
            {tt("← Geri")}
          </Link>
        ) : null}
      </div>

      {/* Onay penceresi: kişi listesi, kişi başı ücret, toplam tutar ve mesaj önizlemesi */}
      {confirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="offer-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
        >
          <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="offer-confirm-title" className="text-base font-semibold text-fg">
                  {`${pendingCount} influencer'a teklif göndermeyi onayla`}
                </h3>
                <p className="mt-1 text-[12px] text-fg-muted">
                  Onayladığınızda kampanya yayınlanır ve aşağıdaki kişilere davet teklifi iletilir.
                </p>
              </div>
              <button type="button" onClick={() => setConfirmOpen(false)} aria-label="Kapat" className="text-fg-muted hover:text-fg">
                <XIcon size={16} />
              </button>
            </div>

            <div className="max-h-48 overflow-y-auto rounded-xl border border-line">
              <ul className="divide-y divide-line text-[13px]">
                {pendingRecipients.map((r) => (
                  <li key={r.influencerId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <span className="block truncate font-medium text-fg">{r.name}</span>
                      {r.handle ? <span className="text-[11px] text-fg-muted">{formatHandle(r.handle)}</span> : null}
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-fg">
                      {formatMinor(r.estimatedTotalKurus, currency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex items-center justify-between rounded-xl bg-surface-muted/60 px-3 py-2 text-[13px]">
              <span className="text-fg-muted">Tahmini toplam tutar ({pendingCount} kişi)</span>
              <span className="font-semibold tabular-nums text-fg">{formatMinor(offerPreview?.totalKurus ?? 0, currency)}</span>
            </div>

            <Field label={tt("Influencer'lara gidecek mesaj önizlemesi")}>
              {(p) => <Textarea {...p} rows={3} value={offerMessage} onChange={(e) => setOfferMessage(e.target.value)} />}
            </Field>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setConfirmOpen(false)}>
                {tt("Vazgeç")}
              </Button>
              <ActionForm
                action={wizardSubmitAction}
                submitLabel={`Onayla ve ${pendingCount} teklif gönder`}
                submitSize="sm"
                submitVariant="primary"
              >
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="intent" value="publish_and_send_offers" />
                <input type="hidden" name="confirmed" value="1" />
                <input type="hidden" name="offerMessage" value={offerMessage} />
                {pendingRecipients.map((r) => (
                  <input key={r.influencerId} type="hidden" name="influencerIds" value={r.influencerId} />
                ))}
              </ActionForm>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
const TITLES: Record<string, string> = {
  temel: "Temel bilgiler",
  kitle: "Hedef kitle",
  butce: "Tarih ve bütçe",
  icerik: "İçerik planı",
  brief: "Brief",
  medya: "Fotoğraf ve video",
  urun: "Ürün ve kargo",
  influencer: "Influencerlar",
  ozet: "Özet ve kaydet",
};
const stepTitle = (k: string) => TITLES[k] ?? k;
