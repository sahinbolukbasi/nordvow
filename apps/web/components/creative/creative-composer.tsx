"use client";
import { useTT } from "@/lib/i18n/tt-client";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { generateCreative } from "@/lib/actions/operations";
import { openAssetInStudioAction } from "@/lib/actions/creative-studio";
import { idleState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { KindIcon } from "@/components/creative/kind-icon";
import { chargeAmount, fmtTl, KIND_LABEL, modelHint, modelName, unitLabel, type CreativeKind } from "@/lib/creative-models";
import { uploadFile } from "@/lib/creative-upload";
import { JobProgress } from "@/components/creative/job-progress";
import { PhonePreview } from "@/components/creative/phone-preview";
import { SparkleIcon, XIcon } from "@/components/icons";

export type ComposerModel = { key: string; kind: CreativeKind; unit: string; creditsPerUnit: number; maxUnits: number | null; durations: number[] | null; aspects: string[] | null };
export type ComposerLibraryItem = { id: string; kind: "image" | "video"; name: string | null };
export type ComposerRefPrices = { imageEdit: number; klingI2v: number; ecoI2v: number };

type ChatMsg =
  | { id: string; from: "user"; text: string; kind: CreativeKind; format: string }
  | { id: string; from: "bot"; text: string; assetId?: string | null; kind?: CreativeKind; format?: string };

const IDEAS: Record<CreativeKind, { label: string; text: string }[]> = {
  image: [
    { label: "Ürün çekimi", text: "Pastel stüdyo arka planda ürünün yakın çekimi, yumuşak gölgeler, sade ve premium kompozisyon" },
    { label: "Lansman afişi", text: "Yeni sezon lansman afişi: ürün ortada, neon ışıklı şehir gecesi arka planı, büyük ve sade başlık alanı" },
    { label: "Story kapağı", text: "Instagram story kapağı: canlı renkler, ürünü elinde tutan model silueti, 'Yeni' yazısı için boşluk" },
    { label: "Yaşam tarzı", text: "Sabah ışığında kafede kahve ve ürün, doğal ve samimi yaşam tarzı fotoğrafı" },
  ],
  video: [
    { label: "Ürün tanıtımı", text: "Dönen platformda ürün, yavaş kamera hareketi, pastel ışık, sonda ürün yakın çekimi" },
    { label: "Unboxing", text: "Kutunun açılışı, ellerin ürünü çıkarması, sıcak ışık, sakin ve premium his" },
    { label: "Şehir reels", text: "Gece şehir sokaklarında hızlı geçişler, neon yansımalar, enerjik reels havası" },
  ],
  audio: [
    { label: "Reklam spotu", text: "Sıcak ve enerjik bir tonla: 'Yeni sezon şimdi mağazalarda. Kaçırma, hemen keşfet!'" },
    { label: "Story seslendirme", text: "Samimi bir tonla: 'Bugün size en sevdiğim ürünü anlatmak istiyorum, linki profilimde bulabilirsiniz.'" },
    { label: "Kampanya duyurusu", text: "Heyecanlı bir tonla: 'Sadece bu hafta sonu tüm ürünlerde yüzde yirmi indirim!'" },
  ],
};

const FORMATS = [
  { id: "9:16", label: "Story / Reels", hint: "9:16" },
  { id: "4:5", label: "Gönderi", hint: "4:5" },
  { id: "1:1", label: "Kare", hint: "1:1" },
  { id: "16:9", label: "Yatay", hint: "16:9" },
];
const STYLES = ["Minimal", "Sinematik", "Pastel", "Neon", "Doğal ışık", "Stüdyo", "Retro", "Lüks"];

/**
 * Creative Stüdyo: Sohbet odaklı üretim + sağda açılan canlı telefon önizlemesi ve kolay düzenleme komutları.
 */
export function CreativeComposer({
  models,
  library = [],
  refPrices,
  available,
  username = "markaniz",
  currency = "TRY",
  minTry = 2,
  initialPrompt = "",
}: {
  models: ComposerModel[];
  library?: ComposerLibraryItem[];
  refPrices?: ComposerRefPrices;
  available: number;
  username?: string;
  currency?: string;
  minTry?: number;
  initialPrompt?: string;
}) {
  const tt = useTT();
  const router = useRouter();
  const [state, action, pending] = useActionState(generateCreative, idleState);
  const money = (n: number) => fmtTl(n, currency);
  const chargeTry = (cpu: number, units: number, min: number) => chargeAmount(cpu, units, min, currency);

  const kinds = useMemo(() => (["image", "video", "audio"] as CreativeKind[]).filter((k) => models.some((m) => m.kind === k)), [models]);
  const [kind, setKind] = useState<CreativeKind>(kinds[0] ?? "image");
  const inKind = models.filter((m) => m.kind === kind);
  const [modelKey, setModelKey] = useState(inKind[0]?.key ?? "");
  const [seconds, setSeconds] = useState(0);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [format, setFormat] = useState("9:16");
  const [style, setStyle] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [refs, setRefs] = useState<string[]>([]);
  const [lib, setLib] = useState<ComposerLibraryItem[]>(library);
  const [showLib, setShowLib] = useState(false);
  const [upPct, setUpPct] = useState<number | null>(null);
  const [upErr, setUpErr] = useState<string | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState("");
  const [result, setResult] = useState<{ assetId: string; kind: CreativeKind; prompt: string; format: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [chatLog, setChatLog] = useState<ChatMsg[]>([
    {
      id: "welcome",
      from: "bot",
      text: "Ne üretmek istediğinizi yazın; çıktıyı sağdaki telefon önizlemesinde görüp tek tıkla formatlayabilir veya düzenleyebilirsiniz.",
    },
  ]);

  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const m = models.find((x) => x.key === modelKey) ?? inKind[0];
  const durations = m?.durations ?? [5];
  const sec = durations.includes(seconds) ? seconds : durations[0]!;
  const n = kind === "video" ? sec : kind === "audio" ? Math.max(1, Math.ceil(prompt.trim().length / 1000)) : 1;
  const withRefs = refs.length > 0 && kind !== "audio";
  const kling = !!m?.key.startsWith("kling");
  const refSec = kind === "video" ? (kling ? ([5, 10].includes(sec) ? sec : 5) : [6, 10].includes(sec) ? sec : 6) : 1;
  const refCpu = kind === "image" ? (refPrices?.imageEdit ?? 0) : kling ? (refPrices?.klingI2v ?? 0) : (refPrices?.ecoI2v ?? 0);
  const cost = withRefs ? chargeTry(refCpu, refSec, minTry) : m ? chargeTry(m.creditsPerUnit, n, minTry) : 0;
  const aspectOk = kind === "audio" || !m?.aspects || m.aspects.includes(format);
  const balance = available;
  const short = cost > balance;
  const ready = prompt.trim().length >= 10 && !!m && n > 0 && !short && (aspectOk || withRefs);

  useEffect(() => {
    if (state.ok && state.data?.jobId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sunucudan dönen işi izlemeye başla
      setJobId(state.data.jobId);
      setPanelOpen(true);
    }
  }, [state]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatLog, jobId]);

  const addFiles = async (files: FileList) => {
    setUpErr(null);
    for (const f of Array.from(files).slice(0, 4)) {
      try {
        setUpPct(0);
        const r = await uploadFile(f, { name: f.name, mime: f.type, onProgress: setUpPct });
        setLib((l) => [{ id: r.id, kind: r.kind, name: f.name }, ...l]);
        if (r.kind === "image") setRefs((x) => (x.length < 4 ? [...x, r.id] : x));
        else setUpErr("Video kitaplığa eklendi. Videolar Stüdyo sekmesinde düzenlenebilir.");
      } catch (e) {
        setUpErr(`${f.name}: ${e instanceof Error ? e.message : "yüklenemedi"}`);
      }
    }
    setUpPct(null);
  };

  const toggleRef = (id: string) => setRefs((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length < 4 ? [...x, id] : x));

  const pickKind = (k: CreativeKind) => {
    setKind(k);
    const first = models.find((x) => x.kind === k);
    setModelKey(first?.key ?? "");
    setSeconds(0);
  };

  const handleSubmit = () => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    setLastSubmittedPrompt(trimmed);
    setChatLog((prev) => [...prev, { id: `u-${Date.now()}`, from: "user", text: trimmed, kind, format }]);
  };

  /** Sağ paneldeki kolay chat komutları: mevcut görseli referans alıp formatı/komutu uygular. */
  const applyQuickCommand = (cmd: { label: string; promptText: string; nextFormat?: string; nextKind?: CreativeKind }) => {
    if (cmd.nextKind && cmd.nextKind !== kind) {
      pickKind(cmd.nextKind);
    }
    if (cmd.nextFormat) setFormat(cmd.nextFormat);
    if (result?.assetId && result.kind === "image") {
      setRefs([result.assetId]);
    }
    setPrompt(cmd.promptText);
    setChatLog((prev) => [...prev, { id: `hint-${Date.now()}`, from: "bot", text: `Komut hazırlandı: “${cmd.label}”. İsterseniz metni düzenleyip Üret'e basın.` }]);
  };

  if (!models.length) {
    return <p className="rounded-3xl border border-dashed border-line p-8 text-center text-sm text-fg-muted">{tt("Şu an kullanılabilir üretim modeli yok. Ajansınız modelleri açtığında burada görünür.")}</p>;
  }

  return (
    <div className={cn("grid grid-cols-1 gap-5", panelOpen ? "lg:grid-cols-[minmax(0,1fr)_390px]" : "")}>
      {/* Sol / Ana Sohbet Alanı */}
      <form ref={formRef} action={action} onSubmit={handleSubmit} className="flex min-h-[540px] flex-col overflow-hidden rounded-3xl border border-line bg-surface">
        <input type="hidden" name="modelKey" value={m?.key ?? ""} />
        <input type="hidden" name="aspect" value={kind === "audio" ? "" : format} />
        <input type="hidden" name="seconds" value={kind === "video" ? sec : ""} />
        <input type="hidden" name="style" value={kind === "audio" ? "" : style} />
        <input type="hidden" name="kind" value={kind} />
        {withRefs ? refs.map((r) => <input key={r} type="hidden" name="refs" value={r} />) : null}

        {/* Üst sade başlık ve tür seçici */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="bg-neon inline-flex h-8 w-8 items-center justify-center rounded-xl text-black" aria-hidden>
              <SparkleIcon size={16} />
            </span>
            <div className="flex gap-1 rounded-full border border-line bg-bg p-0.5">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => pickKind(k)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium transition-standard",
                    kind === k ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                  )}
                >
                  <KindIcon kind={k} size={13} />
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-line px-2.5 py-1 text-[11px] text-fg-muted sm:inline-flex">
              {m ? modelName(m.key) : ""}
              {kind !== "audio" ? ` · ${format}` : ""}
              {kind === "video" ? ` · ${sec} sn` : ""}
            </span>
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              className="rounded-full border border-line px-3 py-1 text-[12px] text-fg-muted transition-standard hover:border-fg/40 hover:text-fg"
            >
              {showOptions ? tt("Ayarları gizle") : tt("Model & Format")}
            </button>
            {result ? (
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                className="rounded-full border border-line px-3 py-1 text-[12px] text-fg transition-standard hover:border-fg/40"
              >
                {panelOpen ? tt("Paneli gizle") : tt("Telefon önizleme")}
              </button>
            ) : null}
          </div>
        </div>

        {/* İsteğe bağlı açılan sade ayarlar çekmecesi */}
        {showOptions ? (
          <div className="grid grid-cols-1 gap-3 border-b border-line bg-fg/[0.02] p-4 sm:grid-cols-2">
            {kind !== "audio" ? (
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] font-medium text-fg-muted">{tt("Format")}</span>
                <div className="flex flex-wrap gap-1.5">
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFormat(f.id)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-[12px] transition-standard",
                        format === f.id ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:text-fg",
                      )}
                    >
                      {f.label} ({f.hint})
                    </button>
                  ))}
                </div>
                {!aspectOk ? <span className="text-[11px] text-amber-600">{tt("Bu model")} {format} {tt("desteklemiyor; başka format veya model seçin.")}</span> : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <label className="text-[12px] font-medium text-fg-muted">
                {tt("Kalite / Model")}
                <select value={m?.key ?? ""} onChange={(e) => setModelKey(e.target.value)} className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-[13px] text-fg">
                  {inKind.map((x) => (
                    <option key={x.key} value={x.key}>
                      {modelName(x.key)}
                      {modelHint(x.key) ? ` · ${modelHint(x.key)}` : ""} · {money(x.creditsPerUnit)}/{unitLabel(x.unit)}
                    </option>
                  ))}
                </select>
              </label>
              {kind === "video" ? (
                <label className="text-[12px] font-medium text-fg-muted">
                  {tt("Süre")}
                  <select value={sec} onChange={(e) => setSeconds(Number(e.target.value))} className="mt-1 h-9 w-full rounded-xl border border-line bg-bg px-3 text-[13px] text-fg">
                    {durations.map((d) => (
                      <option key={d} value={d}>
                        {d} {tt("sn")}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {kind !== "audio" ? (
              <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                <span className="mr-1 self-center text-[12px] text-fg-muted">{tt("Stil:")}</span>
                {STYLES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStyle(style === s ? "" : s)}
                    className={cn("rounded-full border px-2.5 py-0.5 text-[11px]", style === s ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:text-fg")}
                  >
                    {s}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Sohbet mesaj akışı */}
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" role="log" aria-live="polite">
          {chatLog.map((msg) =>
            msg.from === "user" ? (
              <div key={msg.id} className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
                <div className="rounded-2xl rounded-br-sm bg-fg px-4 py-2.5 text-[14px] text-bg">{msg.text}</div>
                <span className="text-[10px] text-fg-passive">
                  {KIND_LABEL[msg.kind]}
                  {msg.kind !== "audio" ? ` · ${msg.format}` : ""}
                </span>
              </div>
            ) : (
              <div key={msg.id} className="mr-auto flex max-w-[90%] flex-col gap-2">
                <div className="rounded-2xl rounded-bl-sm border border-line bg-glass px-4 py-2.5 text-[14px] leading-relaxed text-fg">{msg.text}</div>
              </div>
            ),
          )}

          {jobId ? (
            <div className="mr-auto w-full max-w-md rounded-2xl border border-line bg-glass p-3">
              <JobProgress
                key={jobId}
                jobId={jobId}
                onDone={(assetId) => {
                  setJobId(null);
                  if (assetId) {
                    setResult({ assetId, kind, prompt: lastSubmittedPrompt || prompt, format });
                    setPanelOpen(true);
                    setChatLog((prev) => [
                      ...prev,
                      {
                        id: `done-${Date.now()}`,
                        from: "bot",
                        text: "Üretim tamamlandı! Sağdaki telefon panelinde önizleyebilir, kolay komutlarla formatlayıp düzenleyebilirsiniz.",
                        assetId,
                        kind,
                        format,
                      },
                    ]);
                    setPrompt("");
                    router.refresh();
                  }
                }}
              />
            </div>
          ) : null}

          {state.error ? (
            <p role="alert" className="rounded-xl bg-red-500/10 px-3 py-2 text-[13px] text-critical">
              {state.error}
            </p>
          ) : null}
          <div ref={endRef} />
        </div>

        {/* Alt giriş ve hızlı fikirler */}
        <div className="flex flex-col gap-2.5 border-t border-line bg-fg/[0.02] p-4">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5" aria-label={tt("Hazır fikirler")}>
            {IDEAS[kind].map((idea) => (
              <button
                key={idea.label}
                type="button"
                onClick={() => setPrompt(idea.text)}
                className="shrink-0 rounded-full border border-line bg-bg px-3 py-1 text-[12px] text-fg-muted transition-standard hover:border-fg/40 hover:text-fg"
              >
                + {idea.label}
              </button>
            ))}
          </div>

          {refs.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-fg-muted">{tt("Referanslar:")}</span>
              {refs.map((r) => (
                <div key={r} className="relative h-12 w-12 overflow-hidden rounded-xl border border-fg">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i */}
                  <img src={`/api/creative/file/${r}`} alt={tt("Referans")} className="h-full w-full object-cover" />
                  <button type="button" onClick={() => toggleRef(r)} aria-label={tt("Referansı kaldır")} className="absolute top-0.5 right-0.5 rounded-full bg-black/70 px-1 text-[10px] text-white">
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {showLib ? (
            <div className="rounded-2xl border border-dashed border-line bg-bg p-3">
              {lib.length === 0 ? (
                <p className="text-[12px] text-fg-muted">{tt("Kitaplık boş.")}</p>
              ) : (
                <ul className="grid max-h-36 grid-cols-6 gap-2 overflow-y-auto">
                  {lib.map((u) =>
                    u.kind === "image" ? (
                      <li key={u.id}>
                        <button type="button" onClick={() => toggleRef(u.id)} className={cn("block aspect-square w-full overflow-hidden rounded-lg border", refs.includes(u.id) ? "border-fg ring-2 ring-fg/40" : "border-line")}>
                          {/* eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i */}
                          <img src={`/api/creative/file/${u.id}`} alt="" className="h-full w-full object-cover" />
                        </button>
                      </li>
                    ) : null,
                  )}
                </ul>
              )}
            </div>
          ) : null}

          <textarea
            id="cc-prompt"
            name="prompt"
            required
            minLength={10}
            maxLength={2000}
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={kind === "audio" ? tt("Seslendirilecek metni ve tonu yazın…") : tt("Ne oluşturmak veya değiştirmek istediğinizi yazın…")}
            className="resize-none rounded-2xl border border-line bg-bg px-4 py-3 text-[14px] leading-relaxed text-fg placeholder:text-fg-passive focus:border-fg/50 focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {kind !== "audio" ? (
                <>
                  <label className="cursor-pointer rounded-full border border-line bg-bg px-3 py-1.5 text-[12px] text-fg-muted hover:border-fg/40 hover:text-fg">
                    {tt("+ Görsel ekle")}
                    <input
                      type="file"
                      multiple
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      onChange={(e) => {
                        if (e.target.files?.length) void addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowLib((v) => !v)}
                    className="rounded-full border border-line bg-bg px-3 py-1.5 text-[12px] text-fg-muted hover:border-fg/40 hover:text-fg"
                  >
                    {tt("Kitaplık")} ({lib.length})
                  </button>
                </>
              ) : null}
              {upPct != null ? <span className="text-[11px] text-fg-muted">%{upPct}</span> : null}
              {upErr ? <span className="text-[11px] text-amber-600">{upErr}</span> : null}
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right leading-tight">
                <span className="block text-[13px] font-semibold tabular-nums text-fg">{money(cost)}</span>
                <span className={cn("block text-[11px] tabular-nums", short ? "text-critical" : "text-fg-passive")}>
                  {short ? tt("Kredi yetersiz") : `${tt("Kalan:")} ${money(Math.max(0, balance - cost))}`}
                </span>
              </div>
              <button
                type="submit"
                disabled={pending || !ready}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-fg px-5 text-[13px] font-semibold text-bg transition-standard hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {pending ? tt("Gönderiliyor…") : tt("Üret")}
              </button>
            </div>
          </div>
        </div>
      </form>

      {/* Sağ Telefon Önizleme ve Kolay Düzenleme Paneli */}
      {panelOpen ? (
        <aside className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-4" aria-label={tt("Telefon önizleme ve hızlı komutlar")}>
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-fg">{tt("Telefon Önizleme")}</h2>
            <button type="button" onClick={() => setPanelOpen(false)} aria-label={tt("Paneli kapat")} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg">
              <XIcon size={14} />
            </button>
          </div>

          {result?.assetId ? (
            <>
              <div className="flex justify-center">
                {result.kind === "audio" ? (
                  <audio src={`/api/creative/file/${result.assetId}?t=asset`} controls className="w-full" />
                ) : (
                  <PhonePreview
                    src={`/api/creative/file/${result.assetId}?t=asset`}
                    kind={result.kind === "video" ? "video" : "image"}
                    username={username}
                    caption={result.prompt.slice(0, 120)}
                    initial={result.format === "9:16" ? (result.kind === "video" ? "ig-reels" : "ig-story") : result.format === "16:9" ? "yt-video" : "ig-post"}
                  />
                )}
              </div>

              {result.kind === "image" ? (
                <div className="flex flex-col gap-2 border-t border-line pt-3">
                  <span className="text-[12px] font-medium text-fg-muted">{tt("Kolay chat komutları (tek tıkla düzenle)")}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: "9:16 Story / Reels yap", nextFormat: "9:16", promptText: "Bu görseli Instagram Story ve Reels için 9:16 dikey formata uyarla, üst ve altta yazı için güvenli alan bırak." },
                      { label: "4:5 Gönderi yap", nextFormat: "4:5", promptText: "Bu görseli Instagram gönderisi için 4:5 dikey formata uyarla, ürünü merkeze al." },
                      { label: "16:9 YouTube yap", nextFormat: "16:9", promptText: "Bu görseli 16:9 yatay YouTube kapak formatına genişlet, sinematik ışık ekle." },
                      { label: "Arka planı stüdyo yap", promptText: "Ürünü koruyarak arka planı temiz, minimal ve premium bir stüdyo ortamına dönüştür." },
                      { label: "Işığı güçlendir", promptText: "Aynı sahneyi daha canlı stüdyo ışığı, keskin detaylar ve yüksek kontrast ile yeniden düzenle." },
                      { label: "5 sn videoya çevir", nextKind: "video" as CreativeKind, nextFormat: "9:16", promptText: "Bu görseldeki sahneyi yumuşak kamera hareketiyle 5 saniyelik akıcı bir tanıtım videosuna dönüştür." },
                    ].map((cmd) => (
                      <button
                        key={cmd.label}
                        type="button"
                        onClick={() => applyQuickCommand(cmd)}
                        className="rounded-full border border-line bg-bg px-3 py-1 text-[11px] text-fg transition-standard hover:border-fg/50"
                      >
                        {cmd.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-col gap-2 border-t border-line pt-3">
                <Link href={`/creative?sekme=metin&asset=${result.assetId}`} className="rounded-xl border border-line px-3 py-2 text-center text-[12px] text-fg hover:border-fg/40">
                  {tt("Post metni ve hashtag yaz →")}
                </Link>
                {result.kind !== "audio" ? (
                  <form action={openAssetInStudioAction}>
                    <input type="hidden" name="assetId" value={result.assetId} />
                    <button type="submit" className="w-full rounded-xl border border-line px-3 py-2 text-center text-[12px] text-fg hover:border-fg/40">
                      {tt("Gelişmiş Stüdyoda düzenle →")}
                    </button>
                  </form>
                ) : null}
                <a href={`/api/creative/file/${result.assetId}?t=asset`} download className="rounded-xl bg-fg px-3 py-2 text-center text-[12px] font-medium text-bg hover:opacity-90">
                  {tt("İndir")}
                </a>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-line p-8 text-center">
              <p className="text-[13px] text-fg-muted">{tt("Üretim hazırlanıyor… Tamamlandığında burada telefon içinde görünecek.")}</p>
            </div>
          )}
        </aside>
      ) : null}
    </div>
  );
}
