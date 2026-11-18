"use client";
import { useTT } from "@/lib/i18n/tt-client";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import type { ContentType, Platform } from "@infulancer/core/enums";
import { COUNTRIES, GENDERS, OBJECTIVES, type ContentPlanItem, type DraftCheck } from "@infulancer/core/domain/campaign-plan";
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

const PLATFORMS: Platform[] = ["INSTAGRAM", "TIKTOK", "YOUTUBE"];

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
export function BasicsStep({ id, brands, values }: { id?: string; brands?: { id: string; name: string }[]; values?: { name: string; objective: string | null; description: string | null; brandId: string } }) {
  const tt = useTT();
  const [objective, setObjective] = useState(values?.objective ?? "bilinirlik");
  return (
    <StepForm action={wizardBasicsAction} id={id} label={tt("Temel bilgiler")} submitLabel={id ? tt("Kaydet ve devam →") : tt("Taslağı oluştur ve devam →")}>
      <input type="hidden" name="objective" value={objective} />
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
        <legend className="mb-2 text-label text-fg-muted">{tt("Kampanyanın amacı")}</legend>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5" role="radiogroup" aria-label={tt("Kampanyanın amacı")}>
          {OBJECTIVES.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={objective === o.id}
              onClick={() => setObjective(o.id)}
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
        <p className="text-[12px] text-fg-passive">{tt("Amaca göre ölçülecek KPI hedefleri otomatik hazırlanır; ajans gerekirse ince ayar yapar.")}</p>
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
}: {
  id: string;
  backHref: string;
  values: { targetCountries: string[]; platforms: Platform[]; audienceAgeMin: number | null; audienceAgeMax: number | null; audienceGender: string | null; audienceInterests: string[] };
}) {
  const tt = useTT();
  const [countries, setCountries] = useState<string[]>(values.targetCountries.length ? values.targetCountries : ["TR"]);
  const [platforms, setPlatforms] = useState<Platform[]>(values.platforms.length ? values.platforms : ["INSTAGRAM"]);
  const [curNote, setCurNote] = useState<string | null>(null);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <StepForm action={wizardAudienceAction} id={id} backHref={backHref} label={tt("Hedef kitle")}>
      {countries.map((c) => (
        <input key={c} type="hidden" name="targetCountries" value={c} />
      ))}
      {platforms.map((p) => (
        <input key={p} type="hidden" name="platforms" value={p} />
      ))}
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-label text-fg-muted">{tt("Yayınlanacak ülkeler")}</legend>
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
                    `Çoklu Para Birimi Aktif (${[...selectedCurrencies].join(" + ")}): Yurt dışındaki influencer'lara gönderilen bütçe ve teklifler anlık döviz kuru üzerinden otomatik çevrilir.`,
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
        <p className="text-[12px] text-fg-passive">
          {tt("Yerel ve global ülkeleri aynı anda seçebilirsiniz. Farklı para birimli ülkelerdeki influencer'lar teklif ve bütçeleri kendi yerel/global para birimleri (EUR/USD) cinsinden otomatik dönüştürülmüş olarak görür.")}
        </p>
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label={tt("Yaş (en küçük)")}>{(p) => <Input {...p} name="audienceAgeMin" type="number" min={13} max={80} defaultValue={values.audienceAgeMin ?? 18} />}</Field>
        <Field label={tt("Yaş (en büyük)")}>{(p) => <Input {...p} name="audienceAgeMax" type="number" min={13} max={80} defaultValue={values.audienceAgeMax ?? 34} />}</Field>
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
      <Field label={tt("İlgi alanları")} hint={tt("Virgülle ayırın: güzellik, cilt bakımı, moda")}>
        {(p) => <Input {...p} name="audienceInterests" defaultValue={values.audienceInterests.join(", ")} />}
      </Field>
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
  const minorPreview = Number.isFinite(parsedMajor) && parsedMajor > 0 ? Math.round(parsedMajor * 100) : 0;

  return (
    <StepForm action={wizardScheduleAction} id={id} backHref={backHref} label={tt("Tarih ve bütçe")}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label={tt("Başlangıç")}>{(p) => <Input {...p} name="startsAt" type="date" required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}</Field>
        <Field label={tt("Bitiş")}>{(p) => <Input {...p} name="endsAt" type="date" required min={startsAt} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />}</Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {DURATIONS.map((d) => (
          <button key={d.label} type="button" onClick={() => setEndsAt(addDays(startsAt, d.days - 1))} className="rounded-full border border-line px-3 py-1 text-[12px] text-fg-muted hover:border-fg/40 hover:text-fg">
            {d.label}
          </button>
        ))}
        <span className="text-[12px] tabular-nums text-fg-passive">{days > 0 ? `${days} gün` : tt("Bitiş başlangıçtan önce olamaz")}</span>
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
export function ContentPlanStep({ id, backHref, plan, platforms }: { id: string; backHref: string; plan: ContentPlanItem[]; platforms: Platform[] }) {
  const tt = useTT();
  const [rows, setRows] = useState<PlanRow[]>(plan.length ? plan : [defaultPlanRow(platforms)]);
  return (
    <StepForm action={wizardContentPlanAction} id={id} backHref={backHref} label={tt("İçerik planı")}>
      <input type="hidden" name="plan" value={JSON.stringify(rows.map((r) => ({ ...r, count: Number(r.count) || 0 })))} />
      <p className="text-[13px] text-fg-muted">{tt("Her influencer için aynı plan uygulanır; ajans bu planı seçilen tüm influencerlara tek seferde dağıtır. Story satırında adet = kare sayısı.")}</p>
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

// ───────────────────────── 7. Influencerlar (Influencer Bul görünümü + Sağ Kampanya Bilgi Alanı) ─────────────────────────
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
};
export type WizardCampaignSummary = {
  name: string;
  objective: string | null;
  dates: string;
  budgetLabel: string;
  countriesLabel: string;
  planSummary: string[];
};
import { compact } from "@/lib/format";
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
  const allShown = shown.length > 0 && shown.every((i) => selected.has(i.id));
  const toggle = (iid: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(iid)) n.delete(iid);
      else n.add(iid);
      return n;
    });
  return (
    <StepForm action={wizardInfluencersAction} id={id} backHref={backHref} label={tt("Influencer seçimi")}>
      {[...selected].map((s) => (
        <input key={s} type="hidden" name="influencerIds" value={s} />
      ))}
      <p className="text-[13px] text-fg-muted">{note}</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
        {/* Sol: Influencer Bul Ekranı Gibi Zengin Filtreleme & Kart Seçimi */}
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
            <span className="font-semibold tabular-nums">{selected.size} {tt("influencer seçili")}</span>
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
              {allShown ? tt("Tüm Seçimi Kaldır") : tt("Listelenenleri Seç")}
            </Button>
            {selected.size ? (
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>{tt("Temizle")}</Button>
            ) : null}
          </div>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label={tt("Influencerlar")}>
            {shown.map((i) => {
              const on = selected.has(i.id);
              return (
                <li key={i.id}>
                  <label
                    className={cn(
                      "flex h-full cursor-pointer flex-col gap-3 rounded-2xl border p-4 transition-standard",
                      on ? "border-fg bg-fg/[0.04] shadow-sm" : "border-line bg-surface hover:border-fg/40",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(i.id)}
                        className="mt-1 h-4 w-4 accent-[var(--color-fg)]"
                        aria-label={`${i.name} seç`}
                      />
                      <Avatar name={i.name} src={i.avatarUrl} size={44} />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px] font-semibold text-fg">{i.name}</span>
                        <span className="truncate text-[12px] text-fg-muted">
                          {i.handle ? `@${i.handle} · ` : ""}{i.category}
                        </span>
                        {i.city ? <span className="truncate text-[11px] text-fg-passive">{i.city}</span> : null}
                      </div>
                    </div>
                    <div className="flex items-center justify-between border-t border-line pt-2.5 text-[12px]">
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="font-semibold text-fg">{compact.format(i.followers)} <span className="font-normal text-fg-muted">{tt("takipçi")}</span></span>
                        {i.er != null ? (
                          <span className="rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                            ER %{(i.er * 100).toFixed(1)}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="flex gap-1.5 text-fg-muted">
                          {i.platforms.map((p) => (
                            <PlatformIcon key={p} platform={p} size={14} title={platformLabels[p]} />
                          ))}
                        </span>
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

        {/* Sağ: Kampanya Bilgi Alanı */}
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
              {tt("Seçilen Influencerlar")} ({selectedItems.length})
            </span>
            {selectedItems.length === 0 ? (
              <p className="text-[12px] text-fg-passive">
                {tt("Sol listeden influencer seçtiğinizde teklifler kampanya kaydedilince otomatik iletilir.")}
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
export function SubmitStep({ id, backHref, checks, ready, isBrand, submittedAt, base }: { id: string; backHref: string; checks: DraftCheck[]; ready: boolean; isBrand: boolean; submittedAt: string | null; base: string }) {
  const tt = useTT();
  return (
    <StepForm
      action={wizardSubmitAction}
      id={id}
      backHref={backHref}
      allowStay={false}
      label={tt("Özet ve kaydet")}
      submitLabel={isBrand ? (submittedAt ? tt("Değişiklikleri Kaydet") : tt("Kaydet ve Kampanyayı Başlat")) : tt("Kaydet ve Kuruluma Geç →")}
    >
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
      {!ready ? <p className="text-[13px] text-critical">{tt("Kırmızı işaretli adımları tamamlayın; ardından kaydedebilirsiniz.")}</p> : null}
      <p className="text-[12px] text-fg-passive">
        {isBrand
          ? submittedAt
            ? `Ajansa ${submittedAt} tarihinde gönderildi. Değişiklikleri kaydedip yeniden gönderebilirsiniz.`
            : tt("Gönderince ajans bildirim alır: influencerları onaylar, bedelleri belirler ve yasal kontrolden sonra yayına alır.")
          : tt("Kurulumda influencer atama, bedeller, toplu içerik planı ve yasal yayın kontrolü yapılır.")}
      </p>
    </StepForm>
  );
}
const TITLES: Record<string, string> = {
  temel: "Temel bilgiler",
  kitle: "Hedef kitle",
  butce: "Tarih ve bütçe",
  icerik: "İçerik planı",
  brief: "Brief",
  medya: "Fotoğraf ve video",
  influencer: "Influencerlar",
};
const stepTitle = (k: string) => TITLES[k] ?? k;
