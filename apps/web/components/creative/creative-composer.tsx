"use client";
import { useTT } from "@/lib/i18n/tt-client";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { generateCreative } from "@/lib/actions/operations";
import { openAssetInStudioAction, saveAssetToLibraryAction } from "@/lib/actions/creative-studio";
import { idleState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { KindIcon } from "@/components/creative/kind-icon";
import { chargeAmount, fmtTl, KIND_LABEL, modelHint, modelName, toneFor, unitLabel, type CreativeKind } from "@/lib/creative-models";
import { uploadFile } from "@/lib/creative-upload";
import { JobProgress } from "@/components/creative/job-progress";
import { PhonePreview } from "@/components/creative/phone-preview";
import { CheckIcon, SparkleIcon, XIcon } from "@/components/icons";

export type ComposerModel = {
  key: string;
  kind: CreativeKind;
  unit: string;
  creditsPerUnit: number;
  maxUnits: number | null;
  durations: number[] | null;
  aspects: string[] | null;
};
export type ComposerLibraryItem = {
  id: string;
  kind: "image" | "video";
  name: string | null;
  source?: string;
};
export type ComposerRefPrices = { imageEdit: number; klingI2v: number; ecoI2v: number };

export type ChatHistoryItem = {
  jobId: string;
  prompt: string;
  kind: CreativeKind;
  modelKey: string;
  status: string;
  assetId: string | null;
  uploadId: string | null;
  rejectReason: string | null;
  createdAt: string;
};

export type PersonalPreset = {
  id: string;
  label: string;
  contextPrompt: string;
};

type ChatTurn =
  | {
      id: string;
      from: "user";
      text: string;
      kind: CreativeKind;
      format: string;
      personalized?: boolean;
      refCount?: number;
    }
  | {
      id: string;
      from: "bot";
      text: string;
      assetId?: string | null;
      uploadId?: string | null;
      kind?: CreativeKind;
      format?: string;
      modelKey?: string;
      prompt?: string;
      savedToLibrary?: boolean;
      error?: string | null;
    };

const QUICK_IDEAS: Record<CreativeKind, { label: string; text: string; format?: string }[]> = {
  video: [
    { label: "🎬 Ürün Tanıtım Reels", text: "Ürünün etrafında yumuşak sinematik kamera dönüşü, sıcak stüdyo ışıkları, sonunda net ürün yakın çekimi", format: "9:16" },
    { label: "📦 Kutu Açılışı (Unboxing)", text: "Minimal masada şık kutu açılışı, doğal sabah ışığı, akıcı ve davetkar sosyal medya videosu", format: "9:16" },
    { label: "✨ Lansman Hikayesi", text: "Yeni sezon lansman videosu: dinamik ışık geçişleri, modern şehir atmosferi, yüksek enerji", format: "9:16" },
    { label: "🌿 Yaşam Tarzı Video", text: "Güneşli bir kafede ürünün doğal kullanım anı, samimi ve sıcak renk tonları, sinematik derinlik", format: "9:16" },
  ],
  image: [
    { label: "📸 Stüdyo Ürün Fotoğrafı", text: "Pastel stüdyo arka planda ürünün yakın çekimi, yumuşak gölgeler, sade ve premium kompozisyon", format: "4:5" },
    { label: "📱 Story Kapağı (9:16)", text: "Instagram story kapağı: canlı renkler, modern estetik, üstte ve altta başlık yazısı için temiz alan", format: "9:16" },
    { label: "🌿 Doğal Yaşam Tarzı", text: "Sabah ışığında ahşap masada kahve ve ürün, doğal ve samimi yaşam tarzı fotoğrafı", format: "4:5" },
    { label: "💎 Lüks Kampanya Afişi", text: "Yeni sezon kampanya çekimi: dramatik kontrast ışık, zarif yansımalar, dergi kapağı kalitesi", format: "1:1" },
  ],
  audio: [
    { label: "🎙️ Reels Seslendirme", text: "Samimi ve enerjik bir tonla: 'Yeni koleksiyonumuz yayında! Favori parçanı keşfetmek için profildeki linke tıkla.'" },
    { label: "📢 Kampanya Spotu", text: "Heyecanlı bir tonla: 'Sadece bu hafta sonuna özel tüm seçili ürünlerde sürpriz fırsatları kaçırma!'" },
  ],
};

const PERSONAL_PRESETS: PersonalPreset[] = [
  { id: "marka-ozel", label: "🎯 Bana Özel (Marka & Profil)", contextPrompt: "Kullanıcıya özel marka kimliğine uygun, profesyonel sosyal medya estetiği, yüksek çözünürlüklü temiz kompozisyon" },
  { id: "urun-odakli", label: "🛍️ Ürün Odaklı", contextPrompt: "Ürünü merkeze alan, dokuları ve detayları net gösteren ticari çekim kalitesi" },
  { id: "reels-viral", label: "📱 Reels / TikTok Estetiği", contextPrompt: "Sosyal medya akışında dikkat çeken, canlı renkler ve modern dikey kadraj" },
  { id: "sinematik-luks", label: "🎬 Sinematik & Lüks", contextPrompt: "Sinematik alan derinliği, sıcak altın saat ışığı, premium reklam filmi atmosferi" },
];

const FORMATS = [
  { id: "9:16", label: "9:16 Dikey", hint: "Reels / Story" },
  { id: "4:5", label: "4:5 Gönderi", hint: "Instagram" },
  { id: "1:1", label: "1:1 Kare", hint: "Post" },
  { id: "16:9", label: "16:9 Yatay", hint: "YouTube" },
];

const STYLES = ["Sinematik", "Minimal", "Doğal ışık", "Stüdyo", "Pastel", "Lüks", "Neon", "Retro"];

/**
 * Sohbet balonunun içindeki fotoğraf / video kartı.
 * Gerçek medya yüklendiğinde oynatır; demo/mock modunda şık bir görsel önizleme kartı gösterir.
 */
function ChatMediaCard({
  assetId,
  uploadId,
  kind,
  prompt,
  modelKey,
  savedInitial,
  onUseAsReference,
  onConvertToVideo,
  onOpenPhone,
}: {
  assetId: string;
  uploadId?: string | null;
  kind: CreativeKind;
  prompt: string;
  modelKey?: string;
  savedInitial?: boolean;
  onUseAsReference: (id: string, nextPrompt?: string, nextFormat?: string) => void;
  onConvertToVideo: (id: string, basePrompt: string) => void;
  onOpenPhone: () => void;
}) {
  const tt = useTT();
  const [mediaOk, setMediaOk] = useState(true);
  const [saveState, saveAction, savePending] = useActionState(saveAssetToLibraryAction, idleState);
  const isSaved = savedInitial || !!uploadId || saveState.ok;
  const effectiveRefId = (saveState.data?.uploadId as string | undefined) ?? uploadId ?? assetId;
  const src = `/api/creative/file/${assetId}?t=asset`;
  const cleanPrompt = prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim();

  return (
    <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
      {/* Medya Görüntüleme Alanı */}
      {kind === "audio" ? (
        <div className="flex flex-col gap-2 bg-fg/[0.03] p-4">
          <div className="flex items-center gap-2 text-[12px] font-medium text-fg">
            <KindIcon kind="audio" size={15} />
            <span>{tt("AI Seslendirme")}</span>
          </div>
          <audio src={src} controls className="w-full" />
        </div>
      ) : (
        <div className={cn("relative flex aspect-[16/10] w-full items-center justify-center overflow-hidden bg-gradient-to-br text-white", toneFor(kind, assetId))}>
          {mediaOk ? (
            kind === "video" ? (
              <video
                src={src}
                controls
                playsInline
                preload="metadata"
                onError={() => setMediaOk(false)}
                className="h-full w-full bg-black object-contain"
                aria-label={cleanPrompt}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i
              <img
                src={src}
                alt={cleanPrompt}
                onError={() => setMediaOk(false)}
                className="h-full w-full object-contain"
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-black/25 backdrop-blur">
                <KindIcon kind={kind} size={26} />
              </span>
              <span className="rounded-full bg-black/30 px-3 py-0.5 text-[11px] font-medium backdrop-blur">
                {kind === "video" ? tt("AI Video Hazır") : tt("AI Fotoğraf Hazır")}
              </span>
              <p className="max-w-md line-clamp-2 text-[13px] font-medium text-white/95">{cleanPrompt}</p>
            </div>
          )}

          {/* Üst Rozetler */}
          <div className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              <KindIcon kind={kind} size={12} />
              {KIND_LABEL[kind]}
              {modelKey ? ` · ${modelName(modelKey)}` : ""}
            </span>
            {isSaved ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                <CheckIcon size={11} />
                {tt("Kitaplıkta")}
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Alt Hızlı Eylem Çubuğu */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-bg/60 p-2.5">
        {kind !== "audio" && !isSaved ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              startTransition(() => saveAction(fd));
            }}
          >
            <input type="hidden" name="assetId" value={assetId} />
            <button
              type="submit"
              disabled={savePending}
              className="inline-flex items-center gap-1 rounded-full bg-fg px-3 py-1 text-[11px] font-semibold text-bg hover:opacity-90 disabled:opacity-50"
            >
              {savePending ? tt("Kaydediliyor…") : tt("+ Kitaplığa Kaydet")}
            </button>
          </form>
        ) : null}

        {kind === "image" ? (
          <>
            <button
              type="button"
              onClick={() => onConvertToVideo(effectiveRefId, cleanPrompt)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-fg transition-standard hover:border-fg/50"
            >
              🎬 {tt("Videoya Çevir")}
            </button>
            <button
              type="button"
              onClick={() => onUseAsReference(effectiveRefId, `${cleanPrompt}, yeni varyasyon`)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg transition-standard hover:border-fg/50"
            >
              ✨ {tt("Bunu Referans Al")}
            </button>
            <button
              type="button"
              onClick={() => onUseAsReference(effectiveRefId, "Bu görseli 9:16 Instagram Story ve Reels dikey formatına uyarla", "9:16")}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-standard hover:border-fg/40 hover:text-fg"
            >
              9:16 Story Yap
            </button>
          </>
        ) : null}

        {kind !== "audio" ? (
          <>
            <form action={openAssetInStudioAction}>
              <input type="hidden" name="assetId" value={assetId} />
              <button
                type="submit"
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg transition-standard hover:border-fg/50"
              >
                ✂️ {kind === "video" ? tt("Videoyu Düzenle") : tt("Düzenle")}
              </button>
            </form>
            <button
              type="button"
              onClick={onOpenPhone}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-standard hover:border-fg/40 hover:text-fg"
            >
              📱 {tt("Telefonda Gör")}
            </button>
          </>
        ) : null}

        <Link
          href={`/creative?sekme=metin&asset=${assetId}`}
          className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-standard hover:border-fg/40 hover:text-fg"
        >
          ✍️ {tt("Post Metni")}
        </Link>

        <a
          href={src}
          download
          className="ml-auto rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-fg transition-standard hover:border-fg/50"
        >
          ⬇️ {tt("İndir")}
        </a>
      </div>
    </div>
  );
}

/**
 * Creative AI Sohbet Stüdyosu:
 * Sade, modern bir AI Chat Video & Fotoğraf oluşturma uygulaması deneyimi.
 * Üretilen tüm video ve fotoğraflar otomatik olarak Kitaplığa kaydedilir ve sohbette anında görüntülenir.
 */
export function CreativeComposer({
  models,
  library = [],
  refPrices,
  available,
  username = "markaniz",
  profileLabel,
  currency = "TRY",
  minTry = 2,
  initialPrompt = "",
  initialKind,
  initialRefId,
  initialHistory = [],
}: {
  models: ComposerModel[];
  library?: ComposerLibraryItem[];
  refPrices?: ComposerRefPrices;
  available: number;
  username?: string;
  profileLabel?: string;
  currency?: string;
  minTry?: number;
  initialPrompt?: string;
  initialKind?: CreativeKind;
  initialRefId?: string;
  initialHistory?: ChatHistoryItem[];
}) {
  const tt = useTT();
  const router = useRouter();
  const [state, action, pending] = useActionState(generateCreative, idleState);
  const money = (n: number) => fmtTl(n, currency);
  const chargeTry = (cpu: number, units: number, min: number) => chargeAmount(cpu, units, min, currency);

  const kinds = useMemo(
    () => (["image", "video", "audio"] as CreativeKind[]).filter((k) => models.some((m) => m.kind === k)),
    [models],
  );
  const defaultKind = initialKind && kinds.includes(initialKind) ? initialKind : (kinds[0] ?? "image");
  const [kind, setKind] = useState<CreativeKind>(defaultKind);
  const inKind = models.filter((m) => m.kind === kind);
  const [modelKey, setModelKey] = useState(inKind[0]?.key ?? "");
  const [seconds, setSeconds] = useState(0);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [format, setFormat] = useState("9:16");
  const [style, setStyle] = useState("");
  const [personalPresetId, setPersonalPresetId] = useState<string>("marka-ozel");
  const [showOptions, setShowOptions] = useState(false);
  const [refs, setRefs] = useState<string[]>(initialRefId ? [initialRefId] : []);
  const [lib, setLib] = useState<ComposerLibraryItem[]>(library);
  const [showLib, setShowLib] = useState(false);
  const [upPct, setUpPct] = useState<number | null>(null);
  const [upMsg, setUpMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState("");
  const [result, setResult] = useState<{ assetId: string; kind: CreativeKind; prompt: string; format: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  // Geçmiş işleri sohbet mesajlarına dönüştür (en eskiden en yeniye doğru)
  const initialTurns = useMemo<ChatTurn[]>(() => {
    const welcome: ChatTurn = {
      id: "welcome",
      from: "bot",
      text: `Merhaba! Size özel fotoğraf veya video oluşturmak için ne istediğinizi aşağıya yazın. Ürettiğiniz tüm videolar ve fotoğraflar otomatik olarak Kitaplığınıza kaydedilir.`,
    };
    if (!initialHistory.length) return [welcome];
    const turns: ChatTurn[] = [welcome];
    const sorted = [...initialHistory].slice(0, 12).reverse();
    for (const h of sorted) {
      const cleanText = h.prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim();
      turns.push({
        id: `hist-u-${h.jobId}`,
        from: "user",
        text: cleanText || h.prompt,
        kind: h.kind,
        format: "9:16",
      });
      if (h.status === "COMPLETED" && h.assetId) {
        turns.push({
          id: `hist-b-${h.jobId}`,
          from: "bot",
          text: `${KIND_LABEL[h.kind]} hazırlandı ve kitaplığınıza kaydedildi.`,
          assetId: h.assetId,
          uploadId: h.uploadId,
          kind: h.kind,
          modelKey: h.modelKey,
          prompt: cleanText || h.prompt,
          savedToLibrary: true,
        });
      } else if (h.status === "FAILED" || h.status === "REJECTED") {
        turns.push({
          id: `hist-err-${h.jobId}`,
          from: "bot",
          text: h.rejectReason ?? "Bu istek tamamlanamadı; bakiyenizden ücret düşülmedi.",
          error: h.rejectReason ?? "Başarısız",
        });
      }
    }
    return turns;
  }, [initialHistory]);

  const [chatLog, setChatLog] = useState<ChatTurn[]>(initialTurns);

  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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
  const ready = prompt.trim().length >= 3 && !!m && n > 0 && !short && (aspectOk || withRefs);
  const activePreset = PERSONAL_PRESETS.find((p) => p.id === personalPresetId) ?? null;

  useEffect(() => {
    if (state.ok && state.data?.jobId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sunucudan dönen işi izlemeye başla
      setJobId(state.data.jobId);
    }
  }, [state]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatLog.length, jobId]);

  const addFiles = async (files: FileList) => {
    setUpMsg(null);
    for (const f of Array.from(files).slice(0, 4)) {
      try {
        setUpPct(0);
        const r = await uploadFile(f, { name: f.name, mime: f.type, onProgress: setUpPct });
        setLib((l) => [{ id: r.id, kind: r.kind, name: f.name, source: "upload" }, ...l]);
        if (r.kind === "image") {
          setRefs((x) => (x.length < 4 ? [...x, r.id] : x));
          setUpMsg({ text: "Görsel kitaplığa eklendi ve referans olarak seçildi." });
        } else {
          setUpMsg({ text: "Video kitaplığınıza kaydedildi! Kitaplık veya Düzenleyici sekmesinden kurgulayabilirsiniz." });
        }
      } catch (e) {
        setUpMsg({ text: `${f.name}: ${e instanceof Error ? e.message : "yüklenemedi"}`, isError: true });
      }
    }
    setUpPct(null);
  };

  const toggleRef = (id: string) =>
    setRefs((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length < 4 ? [...x, id] : x));

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
    setChatLog((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        from: "user",
        text: trimmed,
        kind,
        format,
        personalized: !!activePreset,
        refCount: refs.length,
      },
    ]);
  };

  const handleUseAsReference = (refId: string, nextPrompt?: string, nextFormat?: string) => {
    if (kind === "audio") pickKind("image");
    setRefs([refId]);
    if (nextFormat) setFormat(nextFormat);
    if (nextPrompt) setPrompt(nextPrompt);
    inputRef.current?.focus();
  };

  const handleConvertToVideo = (refId: string, basePrompt: string) => {
    pickKind("video");
    setFormat("9:16");
    setRefs([refId]);
    setPrompt(
      basePrompt
        ? `${basePrompt} — bu sahneyi yumuşak kamera hareketiyle akıcı bir 9:16 tanıtım videosuna dönüştür`
        : "Bu görseldeki sahneyi yumuşak kamera hareketiyle 5 saniyelik akıcı bir tanıtım videosuna dönüştür",
    );
    inputRef.current?.focus();
  };

  if (!models.length) {
    return (
      <p className="rounded-3xl border border-dashed border-line p-8 text-center text-sm text-fg-muted">
        {tt("Şu an kullanılabilir üretim modeli yok. Ajansınız modelleri açtığında burada görünür.")}
      </p>
    );
  }

  return (
    <div className={cn("grid grid-cols-1 gap-4", panelOpen ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "")}>
      {/* Ana AI Sohbet Stüdyosu */}
      <form
        ref={formRef}
        action={action}
        onSubmit={handleSubmit}
        className="flex min-h-[640px] flex-col justify-between overflow-hidden rounded-3xl border border-line bg-surface shadow-sm"
      >
        <input type="hidden" name="modelKey" value={m?.key ?? ""} />
        <input type="hidden" name="aspect" value={kind === "audio" ? "" : format} />
        <input type="hidden" name="seconds" value={kind === "video" ? sec : ""} />
        <input type="hidden" name="style" value={kind === "audio" ? "" : style} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="personalContext" value={kind === "audio" ? "" : (activePreset?.contextPrompt ?? "")} />
        {withRefs ? refs.map((r) => <input key={r} type="hidden" name="refs" value={r} />) : null}

        {/* Üst Sohbet Başlığı */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-bg/40 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="bg-neon inline-flex h-8 w-8 items-center justify-center rounded-xl text-black" aria-hidden>
              <SparkleIcon size={16} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[14px] font-semibold text-fg">{tt("AI Video & Fotoğraf Sohbeti")}</h2>
                {profileLabel ? (
                  <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-fg-muted">
                    {profileLabel}
                  </span>
                ) : null}
              </div>
              <p className="text-[11px] text-fg-muted">
                {tt("Sohbet ederek size özel video ve fotoğraf üretin · Tüm çıktılar otomatik Kitaplığa kaydedilir")}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {chatLog.length > 1 ? (
              <button
                type="button"
                onClick={() =>
                  setChatLog([
                    {
                      id: `welcome-${Date.now()}`,
                      from: "bot",
                      text: "Yeni sohbet başlatıldı. Fotoğraf veya video oluşturmak için isteğinizi yazın.",
                    },
                  ])
                }
                className="rounded-full border border-line px-3 py-1 text-[11px] text-fg-muted transition-standard hover:border-fg/40 hover:text-fg"
              >
                {tt("Yeni Sohbet")}
              </button>
            ) : null}
            {result ? (
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                className="rounded-full border border-line px-3 py-1 text-[11px] font-medium text-fg transition-standard hover:border-fg/40"
              >
                {panelOpen ? tt("Önizlemeyi Gizle") : tt("📱 Telefon Önizleme")}
              </button>
            ) : null}
          </div>
        </div>

        {/* Sohbet Mesaj Akışı */}
        <div className="flex max-h-[520px] flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6" role="log" aria-live="polite">
          {chatLog.map((msg) =>
            msg.from === "user" ? (
              <div key={msg.id} className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
                <div className="rounded-2xl rounded-br-sm bg-fg px-4 py-2.5 text-[14px] leading-relaxed text-bg">
                  {msg.text}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-fg-passive">
                  <span>{KIND_LABEL[msg.kind]}</span>
                  {msg.kind !== "audio" ? <span>· {msg.format}</span> : null}
                  {msg.personalized ? <span>· 🎯 {tt("Bana Özel")}</span> : null}
                  {msg.refCount ? <span>· 📎 {msg.refCount} {tt("referans")}</span> : null}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="mr-auto flex w-full max-w-2xl flex-col gap-2.5">
                <div className="w-fit rounded-2xl rounded-bl-sm border border-line bg-bg/70 px-4 py-2.5 text-[13px] leading-relaxed text-fg">
                  {msg.text}
                </div>
                {msg.assetId && msg.kind ? (
                  <ChatMediaCard
                    assetId={msg.assetId}
                    uploadId={msg.uploadId}
                    kind={msg.kind}
                    prompt={msg.prompt ?? msg.text}
                    modelKey={msg.modelKey}
                    savedInitial={msg.savedToLibrary}
                    onUseAsReference={handleUseAsReference}
                    onConvertToVideo={handleConvertToVideo}
                    onOpenPhone={() => {
                      setResult({
                        assetId: msg.assetId!,
                        kind: msg.kind!,
                        prompt: msg.prompt ?? msg.text,
                        format: msg.format ?? format,
                      });
                      setPanelOpen(true);
                    }}
                  />
                ) : null}
              </div>
            ),
          )}

          {jobId ? (
            <div className="mr-auto w-full max-w-md">
              <JobProgress
                key={jobId}
                jobId={jobId}
                onDone={(assetId) => {
                  setJobId(null);
                  if (assetId) {
                    const submittedText = lastSubmittedPrompt || prompt;
                    setResult({ assetId, kind, prompt: submittedText, format });
                    setChatLog((prev) => [
                      ...prev,
                      {
                        id: `done-${Date.now()}`,
                        from: "bot",
                        text: `${KIND_LABEL[kind]} oluşturuldu ve Kitaplığınıza kaydedildi!`,
                        assetId,
                        kind,
                        format,
                        modelKey: m?.key,
                        prompt: submittedText,
                        savedToLibrary: true,
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

        {/* Alt Sohbet & Oluşturma Dock'u */}
        <div className="flex flex-col gap-3 border-t border-line bg-bg/50 p-3.5 sm:p-4">
          {/* 1. Satır: Mod Seçici (Fotoğraf / Video / Ses) + Oran + Süre + Kişiselleştirme */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Tür Seçimi */}
              <div className="inline-flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label={tt("Üretim türü")}>
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => pickKind(k)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-standard",
                      kind === k ? "bg-fg text-bg shadow-xs" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    <KindIcon kind={k} size={13} />
                    {k === "image" ? tt("Fotoğraf") : k === "video" ? tt("Video") : KIND_LABEL[k]}
                  </button>
                ))}
              </div>

              {/* Oran / Format Seçimi */}
              {kind !== "audio" ? (
                <div className="inline-flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label={tt("Kadraj oranı")}>
                  {FORMATS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFormat(f.id)}
                      title={f.hint}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-standard",
                        format === f.id ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Video Süresi */}
              {kind === "video" && durations.length > 1 ? (
                <div className="inline-flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label={tt("Video süresi")}>
                  {durations.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setSeconds(d)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-standard",
                        sec === d ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                      )}
                    >
                      {d} {tt("sn")}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Model & Stil Çekmecesi Butonu */}
            <button
              type="button"
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              className={cn(
                "rounded-full border px-3 py-1 text-[11px] font-medium transition-standard",
                showOptions ? "border-fg bg-fg text-bg" : "border-line bg-surface text-fg-muted hover:text-fg",
              )}
            >
              ⚙️ {m ? modelName(m.key) : tt("Model")} {style ? `· ${style}` : ""}
            </button>
          </div>

          {/* Kişiselleştirme Modu ("Kullanıcıya Özel Video & Fotoğraf") + Hızlı Şablonlar */}
          {kind !== "audio" ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" aria-label={tt("Kişiselleştirme modu")}>
                {PERSONAL_PRESETS.map((p) => {
                  const active = personalPresetId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPersonalPresetId(active ? "" : p.id)}
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-standard",
                        active ? "border-fg bg-fg/10 text-fg" : "border-line bg-surface text-fg-muted hover:text-fg",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
                <span className="mx-1 text-line">|</span>
                {QUICK_IDEAS[kind].map((idea) => (
                  <button
                    key={idea.label}
                    type="button"
                    onClick={() => {
                      setPrompt(idea.text);
                      if (idea.format) setFormat(idea.format);
                      inputRef.current?.focus();
                    }}
                    className="shrink-0 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-standard hover:border-fg/40 hover:text-fg"
                  >
                    {idea.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* İsteğe Bağlı Model & Stil Ayarları */}
          {showOptions ? (
            <div className="grid grid-cols-1 gap-3 rounded-2xl border border-line bg-surface p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11px] font-medium text-fg-muted">
                {tt("AI Modeli")}
                <select
                  value={m?.key ?? ""}
                  onChange={(e) => setModelKey(e.target.value)}
                  className="h-9 w-full rounded-xl border border-line bg-bg px-3 text-[12px] text-fg"
                >
                  {inKind.map((x) => (
                    <option key={x.key} value={x.key}>
                      {modelName(x.key)}
                      {modelHint(x.key) ? ` · ${modelHint(x.key)}` : ""} · {money(x.creditsPerUnit)}/{unitLabel(x.unit)}
                    </option>
                  ))}
                </select>
              </label>
              {kind !== "audio" ? (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-fg-muted">{tt("Görsel / Video Stili")}</span>
                  <div className="flex flex-wrap gap-1">
                    {STYLES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setStyle(style === s ? "" : s)}
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px]",
                          style === s ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:text-fg",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {!aspectOk ? (
                <span className="text-[11px] text-amber-600 sm:col-span-2">
                  {tt("Seçili model")} {format} {tt("oranını desteklemiyor; başka oran veya model seçin.")}
                </span>
              ) : null}
            </div>
          ) : null}

          {/* Seçili Referans Görseller (Kullanıcıya Özel Üretim İçin) */}
          {refs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2">
              <span className="text-[11px] font-medium text-fg">
                📎 {kind === "video" ? tt("Videoya dönüştürülecek görsel:") : tt("Referans görseller (size özel üretim):")}
              </span>
              {refs.map((r) => (
                <div key={r} className="relative h-11 w-11 overflow-hidden rounded-xl border border-fg">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i */}
                  <img src={`/api/creative/file/${r}`} alt={tt("Referans")} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => toggleRef(r)}
                    aria-label={tt("Referansı kaldır")}
                    className="absolute top-0.5 right-0.5 rounded-full bg-black/75 px-1 text-[10px] text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setRefs([])}
                className="ml-auto text-[11px] text-fg-muted hover:text-fg"
              >
                {tt("Temizle")}
              </button>
            </div>
          ) : null}

          {/* Kitaplık Seçici Çekmecesi */}
          {showLib ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-fg">
                  📚 {tt("Kitaplığım")} ({lib.length}) — {tt("Size özel üretim için bir fotoğraf seçin veya videoyu düzenleyin")}
                </span>
                <button
                  type="button"
                  onClick={() => setShowLib(false)}
                  className="text-[11px] text-fg-muted hover:text-fg"
                >
                  {tt("Kapat")}
                </button>
              </div>
              {lib.length === 0 ? (
                <p className="py-3 text-center text-[12px] text-fg-muted">
                  {tt("Kitaplığınızda henüz dosya yok. Ürettiğiniz veya yüklediğiniz tüm fotoğraf ve videolar burada görünür.")}
                </p>
              ) : (
                <ul className="grid max-h-40 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-8">
                  {lib.map((u) => (
                    <li key={u.id} className="relative">
                      {u.kind === "image" ? (
                        <button
                          type="button"
                          onClick={() => toggleRef(u.id)}
                          title={u.name ?? tt("Referans seç")}
                          className={cn(
                            "group relative block aspect-square w-full overflow-hidden rounded-xl border bg-bg",
                            refs.includes(u.id) ? "border-fg ring-2 ring-fg/40" : "border-line hover:border-fg/40",
                          )}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i */}
                          <img src={`/api/creative/file/${u.id}`} alt={u.name ?? ""} className="h-full w-full object-cover" />
                          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-white">
                            {refs.includes(u.id) ? "✓ Seçili" : "Fotoğraf"}
                          </span>
                        </button>
                      ) : (
                        <Link
                          href={`/creative?sekme=studyo&dosya=${u.id}`}
                          title={u.name ?? tt("Videoyu düzenle")}
                          className="group relative block aspect-square w-full overflow-hidden rounded-xl border border-line bg-black hover:border-fg/50"
                        >
                          <video src={`/api/creative/file/${u.id}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
                          <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[9px] text-white">
                            🎬 Video
                          </span>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {/* Sohbet Metin Girişi + Gönder Butonu */}
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-2.5 focus-within:border-fg/50">
            <textarea
              ref={inputRef}
              id="cc-prompt"
              name="prompt"
              required
              minLength={3}
              maxLength={2000}
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (ready && !pending) formRef.current?.requestSubmit();
                }
              }}
              placeholder={
                kind === "video"
                  ? tt("Size özel nasıl bir video oluşturalım? (Örn: Ürünümüzün pastel stüdyoda 9:16 Reels tanıtım videosu…)")
                  : kind === "image"
                    ? tt("Size özel nasıl bir fotoğraf oluşturalım? (Örn: Sabah ışığında kahve yanında ürün çekimi…)")
                    : tt("Seslendirilecek metni yazın…")
              }
              className="w-full resize-none bg-transparent px-2 py-1 text-[14px] leading-relaxed text-fg placeholder:text-fg-passive focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {kind !== "audio" ? (
                  <>
                    <label className="cursor-pointer rounded-full border border-line bg-bg px-3 py-1 text-[11px] font-medium text-fg-muted transition-standard hover:border-fg/40 hover:text-fg">
                      📎 {tt("Görsel / Video Yükle")}
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"
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
                      className={cn(
                        "rounded-full border px-3 py-1 text-[11px] font-medium transition-standard",
                        showLib ? "border-fg bg-fg text-bg" : "border-line bg-bg text-fg-muted hover:border-fg/40 hover:text-fg",
                      )}
                    >
                      📚 {tt("Kitaplığım")} ({lib.length})
                    </button>
                  </>
                ) : null}
                {upPct != null ? <span className="text-[11px] text-fg-muted">%{upPct}</span> : null}
                {upMsg ? (
                  <span className={cn("text-[11px]", upMsg.isError ? "text-amber-600" : "text-emerald-600")}>
                    {upMsg.text}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right leading-tight">
                  <span className="block text-[12px] font-semibold tabular-nums text-fg">{money(cost)}</span>
                  <span className={cn("block text-[10px] tabular-nums", short ? "text-critical" : "text-fg-passive")}>
                    {short ? tt("Bakiye yetersiz") : `${tt("Kalan:")} ${money(Math.max(0, balance - cost))}`}
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={pending || !ready}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-5 text-[13px] font-semibold text-bg transition-standard hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SparkleIcon size={14} />
                  {pending
                    ? tt("Oluşturuluyor…")
                    : kind === "video"
                      ? tt("Video Oluştur")
                      : kind === "image"
                        ? tt("Fotoğraf Oluştur")
                        : tt("Ses Oluştur")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>

      {/* Sağ Telefon Önizleme Çekmecesi (İsteğe Bağlı Açılır) */}
      {panelOpen && result ? (
        <aside className="flex flex-col gap-4 rounded-3xl border border-line bg-surface p-4" aria-label={tt("Telefon önizleme")}>
          <div className="flex items-center justify-between">
            <h2 className="text-[14px] font-semibold text-fg">{tt("Telefon Önizleme")}</h2>
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              aria-label={tt("Paneli kapat")}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <XIcon size={14} />
            </button>
          </div>

          <div className="flex justify-center">
            {result.kind === "audio" ? (
              <audio src={`/api/creative/file/${result.assetId}?t=asset`} controls className="w-full" />
            ) : (
              <PhonePreview
                src={`/api/creative/file/${result.assetId}?t=asset`}
                kind={result.kind === "video" ? "video" : "image"}
                username={username}
                caption={result.prompt.slice(0, 120)}
                initial={
                  result.format === "9:16"
                    ? result.kind === "video"
                      ? "ig-reels"
                      : "ig-story"
                    : result.format === "16:9"
                      ? "yt-video"
                      : "ig-post"
                }
              />
            )}
          </div>

          <div className="flex flex-col gap-2 border-t border-line pt-3">
            {result.kind !== "audio" ? (
              <form action={openAssetInStudioAction}>
                <input type="hidden" name="assetId" value={result.assetId} />
                <button
                  type="submit"
                  className="w-full rounded-xl border border-line px-3 py-2 text-center text-[12px] font-medium text-fg hover:border-fg/40"
                >
                  ✂️ {result.kind === "video" ? tt("Videoyu Düzenleyicide Aç →") : tt("Fotoğrafı Düzenleyicide Aç →")}
                </button>
              </form>
            ) : null}
            <Link
              href={`/creative?sekme=metin&asset=${result.assetId}`}
              className="rounded-xl border border-line px-3 py-2 text-center text-[12px] text-fg hover:border-fg/40"
            >
              ✍️ {tt("Post Metni & Hashtag Oluştur →")}
            </Link>
            <a
              href={`/api/creative/file/${result.assetId}?t=asset`}
              download
              className="rounded-xl bg-fg px-3 py-2 text-center text-[12px] font-semibold text-bg hover:opacity-90"
            >
              ⬇️ {tt("İndir")}
            </a>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
