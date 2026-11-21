"use client";
import { useTT } from "@/lib/i18n/tt-client";
import { usePrefs } from "@/lib/i18n/client";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { checkCountryScheduleNotice, localizedName, type CountryDto } from "@infulancer/core/i18n/location-utils";
import { majorToMinor } from "@infulancer/core/i18n/currency-service";
import { formatMoneyIntl } from "@/lib/i18n/format";
import { CountryCityPicker, type SelectedLocation } from "@/components/i18n/country-city-picker";
import { ActionForm } from "@/components/forms/action-form";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { BRAND_NAME } from "@/lib/brand";
import { ImageUpload } from "@/components/ui/image-upload";
import { MapPicker } from "@/components/ui/map-picker";
import { InfluencerPicker, type PickItem } from "@/components/ui/influencer-picker";
import { CalIcon, DateBadge, InfoRow, PersonIcon, PinIcon, Pill } from "@/components/luma/primitives";
import { cn } from "@/lib/cn";
import { rangeLabel } from "@/lib/event-format";
import { AGENCY_TZ, isDay, isTime, zonedToUtc } from "@/lib/time";
import { checkInAction, createEventAction, inviteEventAction, respondInviteAction, setEventStatusAction, updateEventPartnersAction } from "@/lib/actions/events";

/** Numaralı form bölümü. */
function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fg text-[13px] font-semibold text-bg" aria-hidden>
          {n}
        </span>
        <div className="flex flex-col">
          <h2 className="font-semibold text-fg">{title}</h2>
          {hint ? <p className="text-[13px] text-fg-muted">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function toDate(day: string, time: string, tz: string): Date | null {
  if (!isDay(day)) return null;
  return zonedToUtc(day, isTime(time) ? time : "19:00", tz || AGENCY_TZ);
}

/**
 * Etkinlik oluşturma: dört bölüm (temel bilgiler, tarih, konum, katılım ayarları) ve sağda
 * yazdıkça güncellenen Luma tarzı etkinlik sayfası önizlemesi. Başarıda yönetim sayfasına gider.
 */
export function EventCreateForm({
  isAdmin,
  brands,
  organizerName,
  countries = [],
  defaultCountryCode,
}: {
  isAdmin: boolean;
  brands?: { id: string; name: string }[];
  organizerName: string;
  countries?: CountryDto[];
  defaultCountryCode?: string;
}) {
  const tt = useTT();
  const { locale } = usePrefs();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [cover, setCover] = useState<string | null>(null);
  const [startDay, setStartDay] = useState("");
  const [startTime, setStartTime] = useState("19:00");
  const [endDay, setEndDay] = useState("");
  const [endTime, setEndTime] = useState("23:00");
  const [venue, setVenue] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [selectedLoc, setSelectedLoc] = useState<SelectedLocation>({
    country: null,
    city: null,
    timezone: AGENCY_TZ,
    currency: "TRY",
  });
  const [price, setPrice] = useState("");
  const [visibility, setVisibility] = useState("KAPALI");
  const [capacity, setCapacity] = useState("");
  const [selectedTenant, setSelectedTenant] = useState("");
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [org, setOrg] = useState(organizerName);

  const handleLocChange = useCallback(
    (loc: SelectedLocation) => {
      setSelectedLoc(loc);
      if (loc.city) setCity(localizedName(loc.city.names, locale));
    },
    [locale],
  );

  const togglePartner = (id: string) =>
    setPartnerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const availablePartners = (brands ?? []).filter((b) => b.id !== selectedTenant);
  const partnerNames = availablePartners.filter((b) => partnerIds.includes(b.id)).map((b) => b.name);
  const orgDisplay = [org, ...partnerNames].join(" × ");

  const activeTz = selectedLoc.timezone || AGENCY_TZ;
  const start = useMemo(() => toDate(startDay, startTime, activeTz), [startDay, startTime, activeTz]);
  const end = useMemo(() => (endDay ? toDate(endDay, endTime, activeTz) : null), [endDay, endTime, activeTz]);
  const endBeforeStart = !!(start && end && end < start);
  const scheduleNotice = useMemo(
    () => checkCountryScheduleNotice(selectedLoc.country, startDay, startTime, locale),
    [selectedLoc.country, startDay, startTime, locale],
  );
  const previewPrice = useMemo(() => {
    const n = Number(price.replace(",", "."));
    if (!price.trim() || !Number.isFinite(n) || n <= 0) return null;
    return formatMoneyIntl(majorToMinor(n, selectedLoc.currency), selectedLoc.currency, {
      locale,
      country: selectedLoc.country?.code,
    });
  }, [price, selectedLoc, locale]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
      <ActionForm action={createEventAction} submitLabel={tt("Etkinliği oluştur")} aria-label={tt("Etkinlik oluştur")} className="gap-5">
        <Section n={1} title={tt("Temel bilgiler")} hint={tt("Misafirlerin ilk göreceği bilgiler.")}>
          {isAdmin && brands ? (
            <Field label={tt("Düzenleyen")}>
              {(p) => (
                <Select
                  {...p}
                  name="tenantId"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedTenant(v);
                    setPartnerIds((prev) => prev.filter((x) => x !== v));
                    setOrg(brands.find((b) => b.id === v)?.name ?? organizerName);
                  }}
                >
                  <option value="">{tt("Ajans (")}{BRAND_NAME})</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {availablePartners.length ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg">{tt("İş birliği yapılan markalar (opsiyonel)")}</span>
              <p className="text-[12px] text-fg-muted">{tt("Seçtiğiniz tüm markalar etkinliği ortak yönetebilir ve sayfada iş birliği olarak görünür.")}</p>
              <div className="flex flex-wrap gap-2 pt-1">
                {availablePartners.map((b) => {
                  const checked = partnerIds.includes(b.id);
                  return (
                    <label
                      key={b.id}
                      className={cn(
                        "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] transition-standard",
                        checked ? "border-fg bg-fg text-bg font-medium" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
                      )}
                    >
                      <input
                        type="checkbox"
                        name="partnerBrandIds"
                        value={b.id}
                        checked={checked}
                        onChange={() => togglePartner(b.id)}
                        className="sr-only"
                      />
                      <span>{b.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
          <Field label={tt("Etkinlik adı")}>{(p) => <Input {...p} name="title" required minLength={3} maxLength={140} placeholder={tt("Yaz lansman gecesi")} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label={tt("Açıklama")} hint={tt("Program, dress code, misafirlerin bilmesi gerekenler.")}>
            {(p) => <Textarea {...p} name="description" required minLength={5} rows={4} onChange={(e) => setDesc(e.target.value)} />}
          </Field>
          <ImageUpload name="coverImageKey" label={tt("Kapak görseli (önerilen 1:1 veya 16:9)")} onPreview={setCover} />
        </Section>

        <Section n={2} title={tt("Tarih ve saat")} hint={`${tt("Saat dilimi")}: ${activeTz} (UTC olarak saklanır)`}>
          <div className="grid grid-cols-2 gap-3">
            <Field label={tt("Başlangıç tarihi")}>{(p) => <Input {...p} name="startsAtDay" type="date" required onChange={(e) => setStartDay(e.target.value)} />}</Field>
            <Field label={tt("Başlangıç saati")}>{(p) => <Input {...p} name="startsAtTime" type="time" defaultValue="19:00" onChange={(e) => setStartTime(e.target.value)} />}</Field>
            <Field label={tt("Bitiş tarihi")}>{(p) => <Input {...p} name="endsAtDay" type="date" min={startDay || undefined} onChange={(e) => setEndDay(e.target.value)} />}</Field>
            <Field label={tt("Bitiş saati")}>{(p) => <Input {...p} name="endsAtTime" type="time" defaultValue="23:00" onChange={(e) => setEndTime(e.target.value)} />}</Field>
          </div>
          {endBeforeStart ? <p role="alert" className="text-[13px] text-critical">{tt("Bitiş, başlangıçtan önce olamaz.")}</p> : null}
          {scheduleNotice.holidayName ? (
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
              ⚠️ {tt("Seçilen tarih bu ülkede resmî tatile denk geliyor")}: <strong>{scheduleNotice.holidayName}</strong>
            </p>
          ) : null}
          {scheduleNotice.outsideWorkingHours ? (
            <p className="rounded-xl border border-line bg-bg/60 px-3 py-2 text-[12px] text-fg-muted">
              ℹ️ {tt("Seçilen saat ülke çalışma saatleri dışında")}
              {scheduleNotice.workingWindow ? ` (${scheduleNotice.workingWindow})` : ""}.
            </p>
          ) : null}
        </Section>

        <Section n={3} title={tt("Konum")} hint={tt("Önce ülke, ardından o ülkeye ait şehri seçin; saat dilimi ve para birimi otomatik güncellenir.")}>
          {countries.length > 0 ? (
            <CountryCityPicker countries={countries} defaultCountryCode={defaultCountryCode} onChange={handleLocChange} />
          ) : null}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label={tt("Mekan adı")}>{(p) => <Input {...p} name="venueName" placeholder={tt("Studio X")} onChange={(e) => setVenue(e.target.value)} />}</Field>
            {countries.length === 0 ? (
              <Field label={tt("Şehir")}>{(p) => <Input {...p} name="city" placeholder={tt("İstanbul")} onChange={(e) => setCity(e.target.value)} />}</Field>
            ) : (
              <Field label={tt("Adres")}>{(p) => <Input {...p} name="address" placeholder={tt("Açık adres")} onChange={(e) => setAddress(e.target.value)} />}</Field>
            )}
          </div>
          {countries.length === 0 ? (
            <Field label={tt("Adres")}>{(p) => <Input {...p} name="address" placeholder={tt("Açık adres")} onChange={(e) => setAddress(e.target.value)} />}</Field>
          ) : null}
          <MapPicker />
        </Section>

        <Section n={4} title={tt("Katılım")} hint={tt("Kimler katılabilir, kaç kişi?")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label={tt("Görünürlük")}>
            {[
              { v: "KAPALI", t: "Yalnız davetliler", d: "Misafirleri siz seçersiniz. Oluşturduktan sonra davet edin." },
              { v: "HERKESE_ACIK", t: "Herkese açık", d: "Etkinlik sayfası bağlantıyla herkese açık olur." },
            ].map((o) => (
              <label key={o.v} className={cn("flex cursor-pointer flex-col gap-1 rounded-xl border p-3 transition-standard", visibility === o.v ? "border-fg bg-surface-hover" : "border-line hover:border-line-strong")}>
                <span className="flex items-center gap-2 font-medium text-fg">
                  <input type="radio" name="visibility" value={o.v} checked={visibility === o.v} onChange={() => setVisibility(o.v)} className="h-4 w-4 accent-[var(--color-fg)]" />
                  {tt(o.t)}
                </span>
                <span className="text-[13px] text-fg-muted">{tt(o.d)}</span>
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={tt("Kapasite (boş = sınırsız)")}>{(p) => <Input {...p} name="capacity" type="number" min={1} placeholder="100" onChange={(e) => setCapacity(e.target.value)} />}</Field>
            <Field label={`${tt("Bilet / Katılım Ücreti (opsiyonel)")} (${selectedLoc.currency})`} hint={tt("Ücretsiz bırakmak için boş geçin")}>
              {(p) => <Input {...p} name="price" type="number" min={0} step="0.01" placeholder="0" onChange={(e) => setPrice(e.target.value)} />}
            </Field>
          </div>
        </Section>
      </ActionForm>

      <aside className="lg:sticky lg:top-6 lg:self-start" aria-label={tt("Etkinlik sayfası önizlemesi")}>
        <p className="mb-2 text-[12px] font-medium text-fg-muted">{tt("Önizleme · misafirlerin göreceği sayfa")}</p>
        <div className="overflow-hidden rounded-3xl border border-line bg-bg">
          <div className="aspect-[16/10] w-full overflow-hidden">
            {cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cover} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,var(--color-neon-violet),var(--color-neon-pink))] text-[13px] text-white/80">{tt("Kapak görseli")}</div>
            )}
          </div>
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap gap-2">
              <Pill tone="gray">{tt("Taslak")}</Pill>
              <Pill>{visibility === "HERKESE_ACIK" ? tt("Herkese açık") : tt("Yalnız davetliler")}</Pill>
              {previewPrice ? <Pill tone="violet">{previewPrice}</Pill> : null}
            </div>
            <h3 className="text-[22px] font-semibold leading-tight text-fg">{title || tt("Etkinlik adı")}</h3>
            <InfoRow icon={start ? <DateBadge date={start} size="sm" /> : <CalIcon />} title={start ? rangeLabel(start, end, activeTz, locale) : tt("Tarih seçilmedi")}>
              {activeTz}
            </InfoRow>
            <InfoRow icon={<PinIcon />} title={venue || tt("Mekan")}>
              {[address, city, selectedLoc.country ? localizedName(selectedLoc.country.names, locale) : ""].filter(Boolean).join(", ") || tt("Adres")}
            </InfoRow>
            <InfoRow icon={<PersonIcon />} title={orgDisplay}>{capacity ? `${capacity} ${tt("kişilik")}` : tt("Kapasite sınırsız")}</InfoRow>
            {desc ? <p className="line-clamp-4 whitespace-pre-line border-t border-line pt-3 text-[13px] text-fg-muted">{desc}</p> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

export function EventStatusButton({ id, to, label, variant = "secondary" }: { id: string; to: string; label: string; variant?: "primary" | "secondary" | "ghost" }) {
  return (
    <ActionForm action={setEventStatusAction} aria-label={label} className="!flex-row">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="to" value={to} />
      <Button type="submit" size="sm" variant={variant}>{label}</Button>
    </ActionForm>
  );
}

/** Etkinlik iş birliği (partner) markalarını düzenleme formu. */
export function EventPartnersForm({
  eventId,
  brands,
  initialPartnerIds,
}: {
  eventId: string;
  brands: { id: string; name: string }[];
  initialPartnerIds: string[];
}) {
  const tt = useTT();
  const [selected, setSelected] = useState<string[]>(initialPartnerIds);
  const toggle = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <ActionForm action={updateEventPartnersAction} submitLabel={tt("İş birliğini kaydet")} submitSize="sm" submitVariant="secondary" aria-label={tt("İş birliği markaları")}>
      <input type="hidden" name="eventId" value={eventId} />
      <div className="flex flex-wrap gap-2">
        {brands.map((b) => {
          const checked = selected.includes(b.id);
          return (
            <label
              key={b.id}
              className={cn(
                "inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-[13px] transition-standard",
                checked ? "border-fg bg-fg text-bg font-medium" : "border-line text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              <input type="checkbox" name="partnerBrandIds" value={b.id} checked={checked} onChange={() => toggle(b.id)} className="sr-only" />
              <span>{b.name}</span>
            </label>
          );
        })}
      </div>
    </ActionForm>
  );
}

/** Misafir davet et: kayıtlı içerik üreticilerinden çoklu seçim veya kayıtsız misafir adı. */
export function InviteForm({ eventId, influencers }: { eventId: string; influencers: PickItem[] }) {
  const tt = useTT();
  return (
    <ActionForm action={inviteEventAction} submitLabel={tt("Davet gönder")} resetOnSuccess aria-label={tt("Etkinlik daveti")}>
      <input type="hidden" name="eventId" value={eventId} />
      <InfluencerPicker items={influencers} allLabel="Tümünü seç" />
      <Field label={tt("Kayıtsız misafir (opsiyonel)")} hint={tt("Sistemde hesabı olmayan biri için ad soyad.")}>
        {(p) => <Input {...p} name="guestName" placeholder={tt("Ad Soyad")} />}
      </Field>
    </ActionForm>
  );
}

/**
 * Katılım seçimi: Katılıyorum / Katılmıyorum. İstenildiği zaman değiştirilebilir;
 * katılıyorum bilet üretir (ad sistemden gelir), katılmıyorum bileti iptal eder.
 */
export function AttendanceToggle({ inviteId, current, labels = ["Katılıyorum", "Katılmıyorum"] }: { inviteId: string; current: string; labels?: [string, string] }) {
  const tt = useTT();
  const opts: { value: "true" | "false"; label: string; on: boolean }[] = [
    { value: "true", label: labels[0], on: current === "KABUL" },
    { value: "false", label: labels[1], on: current === "RED" },
  ];
  return (
    <ActionForm action={respondInviteAction} aria-label={tt("Katılım durumu")} className="!gap-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      <div className="inline-flex w-fit rounded-full border border-line bg-surface p-0.5" role="group" aria-label={tt("Katılım durumu")}>
        {opts.map((o) => (
          <button
            key={o.value}
            type="submit"
            name="accept"
            value={o.value}
            aria-pressed={o.on}
            disabled={o.on}
            className={cn(
              "rounded-full px-3 py-1 text-[13px] font-medium transition-standard disabled:cursor-default",
              o.on ? (o.value === "true" ? "bg-emerald-500 text-white" : "bg-fg text-bg") : "text-fg-muted hover:text-fg",
            )}
          >
            {o.on ? "✓ " : ""}
            {o.label}
          </button>
        ))}
      </div>
    </ActionForm>
  );
}

/** Yönetim sayfası için (organizatör misafir adına onaylar/reddeder). */
export function InviteResponse({ inviteId, current = "DAVET_EDILDI" }: { inviteId: string; current?: string }) {
  return <AttendanceToggle inviteId={inviteId} current={current} labels={["Onayla", "Reddet"]} />;
}

/** Kapıda bilet kodu ile giriş. */
export function CheckInForm() {
  const tt = useTT();
  return (
    <ActionForm action={checkInAction} submitLabel={tt("Girişi onayla")} resetOnSuccess aria-label={tt("Bilet girişi")}>
      <Field label={tt("Bilet kodu")} hint={tt("QR okutun veya kodu yazın.")}>
        {(p) => <Input {...p} name="code" required placeholder={tt("TKT-XXXXXXXXXX")} autoComplete="off" className="font-mono uppercase" />}
      </Field>
    </ActionForm>
  );
}
