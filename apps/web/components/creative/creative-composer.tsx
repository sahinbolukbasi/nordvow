"use client";
import { useTT } from "@/lib/i18n/tt-client";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  chatCreativeDirectorAction,
  openAssetInStudioAction,
  saveAssetToLibraryAction,
  type CreditTier,
} from "@/lib/actions/creative-studio";
import { idleState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { KindIcon } from "@/components/creative/kind-icon";
import { chargeAmount, fmtTl, KIND_LABEL, modelName, toneFor, type CreativeKind } from "@/lib/creative-models";
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

type ChatTurn =
  | {
      id: string;
      from: "user";
      text: string;
      tierLabel?: string;
      refCount?: number;
    }
  | {
      id: string;
      from: "bot";
      text: string;
      postBrief?: string | null;
      enhancedPrompt?: string | null;
      assetId?: string | null;
      uploadId?: string | null;
      kind?: CreativeKind;
      format?: string;
      modelKey?: string;
      prompt?: string;
      savedToLibrary?: boolean;
      error?: string | null;
    };

const INITIAL_SUGGESTIONS = [
  "Instagram'a yeni ürün tanıtım postu atmak istiyorum",
  "9:16 dikey Story / Reels görseli tasarlayalım",
  "Şimdi üret: sabah ışığında minimal masada kahve ve ürün çekimi",
  "Şimdi üret: 5 saniyelik sinematik 9:16 ürün tanıtım videosu",
  "Neler yapabilirsin? Yeteneklerini göster",
];

function ChatMediaCard({
  assetId,
  uploadId,
  kind,
  prompt,
  modelKey,
  savedInitial,
  onQuickFollowUp,
  onOpenPhone,
}: {
  assetId: string;
  uploadId?: string | null;
  kind: CreativeKind;
  prompt: string;
  modelKey?: string;
  savedInitial?: boolean;
  onQuickFollowUp: (refId: string, command: string) => void;
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
    <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      {kind === "audio" ? (
        <div className="flex flex-col gap-2 bg-fg/[0.03] p-4">
          <div className="flex items-center gap-2 text-[12px] font-medium text-fg">
            <KindIcon kind="audio" size={14} />
            <span>{tt("Seslendirme")}</span>
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
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-black/30 backdrop-blur">
                <KindIcon kind={kind} size={22} />
              </span>
              <span className="rounded-full bg-black/35 px-3 py-0.5 text-[11px] font-medium backdrop-blur">
                {kind === "video" ? tt("Video Hazır") : tt("Fotoğraf Hazır")}
              </span>
              <p className="max-w-md line-clamp-2 text-[13px] font-medium text-white/95">{cleanPrompt}</p>
            </div>
          )}

          <div className="pointer-events-none absolute top-2.5 right-2.5 left-2.5 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              <KindIcon kind={kind} size={12} />
              {KIND_LABEL[kind]}
              {modelKey ? ` · ${modelName(modelKey)}` : ""}
            </span>
            {isSaved ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
                <CheckIcon size={11} />
                {tt("Kitaplıkta")}
              </span>
            ) : null}
          </div>
        </div>
      )}

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

        {kind !== "audio" ? (
          <button
            type="button"
            onClick={onOpenPhone}
            className="rounded-full bg-fg px-3 py-1 text-[11px] font-medium text-bg transition-standard hover:opacity-90"
          >
            {tt("Telefonda Gör & Formatla")}
          </button>
        ) : null}

        {kind === "image" ? (
          <>
            <button
              type="button"
              onClick={() => onQuickFollowUp(effectiveRefId, `Şimdi üret: ${cleanPrompt} — bu sahneyi 5 saniyelik akıcı 9:16 Reels videosuna dönüştür`)}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-fg transition-standard hover:border-fg/50"
            >
              {tt("Videoya Çevir")}
            </button>
            <button
              type="button"
              onClick={() => onQuickFollowUp(effectiveRefId, `Şimdi üret: ${cleanPrompt} — yeni varyasyon oluştur`)}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg transition-standard hover:border-fg/50"
            >
              {tt("Varyasyon Üret")}
            </button>
          </>
        ) : null}

        {kind !== "audio" ? (
          <form action={openAssetInStudioAction}>
            <input type="hidden" name="assetId" value={assetId} />
            <button
              type="submit"
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-standard hover:border-fg/50 hover:text-fg"
            >
              {tt("Düzenleyici")}
            </button>
          </form>
        ) : null}

        <a
          href={src}
          download
          className="ml-auto rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-fg transition-standard hover:border-fg/50"
        >
          {tt("İndir")}
        </a>
      </div>
    </div>
  );
}

export function CreativeComposer({
  models,
  library = [],
  available,
  username = "markaniz",
  profileLabel,
  currency = "TRY",
  minTry = 2,
  initialPrompt = "",
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
  const money = (n: number) => fmtTl(n, currency);
  const chargeTry = (cpu: number, units: number, min: number) => chargeAmount(cpu, units, min, currency);

  const [tier, setTier] = useState<CreditTier>("economy");
  const [liveBalance, setLiveBalance] = useState(available);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [refs, setRefs] = useState<string[]>(initialRefId ? [initialRefId] : []);
  const [lib, setLib] = useState<ComposerLibraryItem[]>(library);
  const [showLib, setShowLib] = useState(false);
  const [upPct, setUpPct] = useState<number | null>(null);
  const [upMsg, setUpMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [quickCmd, setQuickCmd] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>(INITIAL_SUGGESTIONS);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const [activeJob, setActiveJob] = useState<{
    jobId: string;
    kind: CreativeKind;
    format: string;
    prompt: string;
    modelKey: string;
    postBrief?: string | null;
  } | null>(null);

  useEffect(() => {
    setLiveBalance(available);
  }, [available]);

  // Kredi paketlerinin (Uygun / Dengeli / Yüksek Kalite) fal.ai modellerine göre birim kredi maliyeti
  const tierCosts = useMemo(() => {
    const imgs = models.filter((m) => m.kind === "image").sort((a, b) => a.creditsPerUnit - b.creditsPerUnit);
    const econ = imgs.find((m) => m.key === "flux-schnell")?.creditsPerUnit ?? imgs[0]?.creditsPerUnit ?? minTry;
    const std = imgs.find((m) => m.key === "nano-banana-2" || m.key === "recraft-v3")?.creditsPerUnit ?? imgs[Math.min(1, imgs.length - 1)]?.creditsPerUnit ?? econ * 2;
    const pro = imgs.find((m) => m.key === "nano-banana-pro")?.creditsPerUnit ?? imgs[imgs.length - 1]?.creditsPerUnit ?? std * 2;
    return {
      economy: chargeTry(econ, 1, minTry),
      standard: chargeTry(std, 1, minTry),
      pro: chargeTry(pro, 1, minTry),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, minTry, currency]);

  const TIERS: { id: CreditTier; label: string; desc: string; cost: number }[] = [
    { id: "economy", label: tt("Uygun Kredi"), desc: "FLUX Schnell / Hızlı", cost: tierCosts.economy },
    { id: "standard", label: tt("Dengeli Kredi"), desc: "Recraft / Ideogram / Hailuo", cost: tierCosts.standard },
    { id: "pro", label: tt("Yüksek Kalite"), desc: "Pro Stüdyo / Kling Pro", cost: tierCosts.pro },
  ];

  const currentCost = tierCosts[tier];
  const short = currentCost > liveBalance;

  const latestCompleted = useMemo(() => {
    const c = initialHistory.find((h) => h.status === "COMPLETED" && h.assetId);
    if (!c || !c.assetId) return null;
    const cleanText = c.prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim();
    return {
      assetId: c.assetId,
      uploadId: c.uploadId,
      kind: c.kind,
      prompt: cleanText || c.prompt,
      format: "9:16",
    };
  }, [initialHistory]);

  const [result, setResult] = useState<{ assetId: string; uploadId?: string | null; kind: CreativeKind; prompt: string; format: string } | null>(latestCompleted);
  const [panelOpen, setPanelOpen] = useState(Boolean(latestCompleted));

  const initialTurns = useMemo<ChatTurn[]>(() => {
    const welcome: ChatTurn = {
      id: "welcome",
      from: "bot",
      text: "Merhaba! Ben Nordvow Creative AI Yönetmeninizim. Ayarlarla uğraşmanıza gerek yok: nasıl bir Instagram postu, Story, Reels videosu veya seslendirme istediğinizi yazın; birlikte netleştirip Post Brief'inizi hazırlayayım ve fal.ai (FLUX Schnell / Pro) ile üreteyim.",
    };
    if (!initialHistory.length) return [welcome];
    const turns: ChatTurn[] = [welcome];
    const sorted = [...initialHistory].slice(0, 10).reverse();
    for (const h of sorted) {
      const cleanText = h.prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim();
      turns.push({
        id: `hist-u-${h.jobId}`,
        from: "user",
        text: cleanText || h.prompt,
      });
      if (h.status === "COMPLETED" && h.assetId) {
        turns.push({
          id: `hist-b-${h.jobId}`,
          from: "bot",
          text: `${KIND_LABEL[h.kind]} hazırlandı ve kitaplığa kaydedildi.`,
          assetId: h.assetId,
          uploadId: h.uploadId,
          kind: h.kind,
          modelKey: h.modelKey,
          prompt: cleanText || h.prompt,
          savedToLibrary: true,
        });
      }
    }
    return turns;
  }, [initialHistory]);

  const [chatLog, setChatLog] = useState<ChatTurn[]>(initialTurns);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [chatLog.length, activeJob]);

  const addFiles = async (files: FileList) => {
    setUpMsg(null);
    for (const f of Array.from(files).slice(0, 4)) {
      try {
        setUpPct(0);
        const r = await uploadFile(f, { name: f.name, mime: f.type, onProgress: setUpPct });
        setLib((l) => [{ id: r.id, kind: r.kind, name: f.name, source: "upload" }, ...l]);
        if (r.kind === "image") {
          setRefs((x) => (x.length < 4 ? [...x, r.id] : x));
          setUpMsg({ text: "Görsel referans olarak seçildi." });
        } else {
          setUpMsg({ text: "Video kitaplığa eklendi." });
        }
      } catch (e) {
        setUpMsg({ text: `${f.name}: ${e instanceof Error ? e.message : "yüklenemedi"}`, isError: true });
      }
    }
    setUpPct(null);
  };

  const toggleRef = (id: string) =>
    setRefs((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length < 4 ? [...x, id] : x));

  const sendTurn = (rawMessage: string, forceGenerate = false, overrideRefs?: string[]) => {
    const trimmed = rawMessage.trim();
    if (!trimmed || pending) return;
    setError(null);
    const tierInfo = TIERS.find((t) => t.id === tier);
    const usedRefs = overrideRefs ?? refs;

    const historyForApi = chatLog
      .filter((c) => c.id !== "welcome")
      .slice(-8)
      .map((c) => ({ role: c.from === "user" ? ("user" as const) : ("assistant" as const), text: c.text }));

    setChatLog((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        from: "user",
        text: trimmed,
        tierLabel: tierInfo?.label,
        refCount: usedRefs.length,
      },
    ]);
    setPrompt("");

    start(async () => {
      const res = await chatCreativeDirectorAction({
        message: trimmed,
        history: historyForApi,
        tier,
        referenceUploadIds: usedRefs,
        forceGenerate,
      });

      if (!res.ok) {
        setError(res.error ?? "İşlem tamamlanamadı.");
        return;
      }

      if (res.suggestions?.length) {
        setSuggestions(res.suggestions);
      }

      if (typeof res.availableCredits === "number") {
        setLiveBalance(res.availableCredits);
      }

      if (res.action === "ask") {
        setChatLog((prev) => [
          ...prev,
          {
            id: `b-${Date.now()}`,
            from: "bot",
            text: res.reply,
          },
        ]);
        return;
      }

      // action === "generate"
      if (res.assetId) {
        const k = res.kind ?? "image";
        const f = res.format ?? "9:16";
        setResult({ assetId: res.assetId, kind: k, prompt: res.enhancedPrompt ?? trimmed, format: f });
        setPanelOpen(true);
        setChatLog((prev) => [
          ...prev,
          {
            id: `b-${Date.now()}`,
            from: "bot",
            text: res.reply,
            postBrief: res.postBrief,
            enhancedPrompt: res.enhancedPrompt,
            assetId: res.assetId,
            kind: k,
            format: f,
            modelKey: res.modelKey,
            prompt: res.enhancedPrompt ?? trimmed,
            savedToLibrary: true,
          },
        ]);
        router.refresh();
      } else if (res.jobId) {
        setActiveJob({
          jobId: res.jobId,
          kind: res.kind ?? "image",
          format: res.format ?? "9:16",
          prompt: res.enhancedPrompt ?? trimmed,
          modelKey: res.modelKey ?? "flux-schnell",
          postBrief: res.postBrief,
        });
        setChatLog((prev) => [
          ...prev,
          {
            id: `b-prep-${Date.now()}`,
            from: "bot",
            text: res.reply,
            postBrief: res.postBrief,
            enhancedPrompt: res.enhancedPrompt,
          },
        ]);
      }
    });
  };

  const applyQuickFormatCommand = (cmdText: string, nextFormat?: string) => {
    if (!result) return;
    if (nextFormat) {
      setResult((r) => (r ? { ...r, format: nextFormat } : r));
    }
    const refId = result.uploadId ?? result.assetId;
    const nextRefs = result.kind === "image" && refId ? [refId] : refs;
    if (nextRefs.length) setRefs(nextRefs);
    setQuickCmd("");
    sendTurn(`Şimdi üret: ${result.prompt} — ${cmdText}`, true, nextRefs);
  };

  return (
    <div
      className={cn(
        "grid min-h-[calc(100dvh-9.5rem)] w-full flex-1 grid-cols-1 gap-3",
        panelOpen && result ? "lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]" : "",
      )}
    >
      {/* Sol / Orta: Tam Ekran AI Sohbet Alanı */}
      <div className="flex min-h-[calc(100dvh-9.5rem)] flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface">
        {/* Üst Sohbet Çubuğu: Yalnız Kredi Seviyesi Seçimi (Uygun / Dengeli / Yüksek Kalite) */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-bg text-fg" aria-hidden>
              <SparkleIcon size={14} />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[13px] font-semibold text-fg">{tt("AI Creative Yönetmeni (Bedrock + fal.ai)")}</h2>
              {profileLabel ? (
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted">
                  {profileLabel}
                </span>
              ) : null}
            </div>
          </div>

          {/* Kredi Paketi Seçici: Uygun / Dengeli / Yüksek Kalite */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full border border-line bg-bg p-0.5" role="radiogroup" aria-label={tt("Kredi tercihi")}>
              {TIERS.map((t) => {
                const active = tier === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTier(t.id)}
                    title={t.desc}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-medium transition-standard",
                      active ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    {t.label} · {money(t.cost)}
                  </button>
                );
              })}
            </div>

            {result ? (
              <button
                type="button"
                onClick={() => setPanelOpen((v) => !v)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11px] font-medium transition-standard",
                  panelOpen ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg/40",
                )}
              >
                {panelOpen ? tt("Telefonu Gizle") : tt("Telefon Önizleme")}
              </button>
            ) : null}
          </div>
        </div>

        {/* Sohbet Mesaj Akışı */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 sm:p-6" role="log" aria-live="polite">
          {chatLog.map((msg) =>
            msg.from === "user" ? (
              <div key={msg.id} className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
                <div className="rounded-2xl rounded-br-sm bg-fg px-4 py-2.5 text-[14px] leading-relaxed text-bg">
                  {msg.text}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-fg-passive">
                  {msg.tierLabel ? <span>{msg.tierLabel}</span> : null}
                  {msg.refCount ? <span>· {msg.refCount} {tt("referans")}</span> : null}
                </div>
              </div>
            ) : (
              <div key={msg.id} className="mr-auto flex w-full max-w-2xl flex-col gap-2.5">
                <div className="w-fit rounded-2xl rounded-bl-sm border border-line bg-bg/70 px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-line text-fg">
                  {msg.text}
                </div>

                {/* Bedrock ile Üretilen Hazır Instagram Post Brief & Caption */}
                {msg.postBrief ? (
                  <div className="flex max-w-xl flex-col gap-2 rounded-2xl border border-line bg-bg/40 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                        {tt("Hazır Instagram Post Metni & Brief")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(msg.postBrief!);
                          setCopiedId(msg.id);
                          setTimeout(() => setCopiedId(null), 2000);
                        }}
                        className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] font-medium text-fg hover:border-fg/40"
                      >
                        {copiedId === msg.id ? tt("Kopyalandı") : tt("Metni Kopyala")}
                      </button>
                    </div>
                    <p className="whitespace-pre-line text-[13px] leading-relaxed text-fg">{msg.postBrief}</p>
                    {msg.enhancedPrompt ? (
                      <p className="border-t border-line/60 pt-2 text-[11px] text-fg-passive">
                        <strong>{tt("Geliştirilmiş fal.ai Promptu:")}</strong> {msg.enhancedPrompt}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {msg.assetId && msg.kind ? (
                  <ChatMediaCard
                    assetId={msg.assetId}
                    uploadId={msg.uploadId}
                    kind={msg.kind}
                    prompt={msg.prompt ?? msg.text}
                    modelKey={msg.modelKey}
                    savedInitial={msg.savedToLibrary}
                    onQuickFollowUp={(refId, cmd) => {
                      setRefs([refId]);
                      sendTurn(cmd, true, [refId]);
                    }}
                    onOpenPhone={() => {
                      setResult({
                        assetId: msg.assetId!,
                        uploadId: msg.uploadId,
                        kind: msg.kind!,
                        prompt: msg.prompt ?? msg.text,
                        format: msg.format ?? "9:16",
                      });
                      setPanelOpen(true);
                    }}
                  />
                ) : null}
              </div>
            ),
          )}

          {activeJob ? (
            <div className="mr-auto w-full max-w-md">
              <JobProgress
                key={activeJob.jobId}
                jobId={activeJob.jobId}
                onDone={(assetId) => {
                  const doneJob = activeJob;
                  setActiveJob(null);
                  if (assetId && doneJob) {
                    setResult({ assetId, kind: doneJob.kind, prompt: doneJob.prompt, format: doneJob.format });
                    setPanelOpen(true);
                    setChatLog((prev) => [
                      ...prev,
                      {
                        id: `done-${Date.now()}`,
                        from: "bot",
                        text: `${KIND_LABEL[doneJob.kind]} hazırlandı ve kitaplığınıza kaydedildi. Sağ panelde telefonda önizleyip formatlayabilirsiniz.`,
                        assetId,
                        kind: doneJob.kind,
                        format: doneJob.format,
                        modelKey: doneJob.modelKey,
                        prompt: doneJob.prompt,
                        savedToLibrary: true,
                      },
                    ]);
                    router.refresh();
                  }
                }}
              />
            </div>
          ) : null}

          {pending ? (
            <div className="mr-auto flex items-center gap-2 rounded-2xl border border-line bg-bg/60 px-4 py-2.5 text-[12px] text-fg-muted">
              <span>{tt("AI Yönetmen hazırlıyor…")}</span>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl border border-critical/30 bg-red-500/10 px-3 py-2 text-[13px] text-critical">
              {error}
            </p>
          ) : null}
          <div ref={endRef} />
        </div>

        {/* Alt Sohbet & Öneri Alanı (Ayar Butonları Yok, Yalnız Öneriler + Sohbet Girişi) */}
        <div className="flex flex-col gap-2 border-t border-line bg-bg/40 p-3 sm:p-4">
          {/* Önceden Oluşturulmuş / Bedrock Soru-Cevap Yönlendirme Çipleri */}
          {suggestions.length > 0 ? (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1" aria-label={tt("Önerilen yanıtlar")}>
              {suggestions.map((s) => {
                const isDirectGen = s.toLocaleLowerCase("tr").startsWith("şimdi üret");
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={pending}
                    onClick={() => sendTurn(s, isDirectGen)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-standard disabled:opacity-40",
                      isDirectGen
                        ? "border-fg bg-fg text-bg hover:opacity-90"
                        : "border-line bg-surface text-fg-muted hover:border-fg/40 hover:text-fg",
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          ) : null}

          {refs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2">
              <span className="text-[11px] font-medium text-fg">{tt("Seçili referans:")}</span>
              {refs.map((r) => (
                <div key={r} className="relative h-9 w-9 overflow-hidden rounded-lg border border-fg">
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
              <button type="button" onClick={() => setRefs([])} className="ml-auto text-[11px] text-fg-muted hover:text-fg">
                {tt("Temizle")}
              </button>
            </div>
          ) : null}

          {showLib ? (
            <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-medium text-fg">
                  {tt("Kitaplığım")} ({lib.length}) — {tt("Referans seçin")}
                </span>
                <button type="button" onClick={() => setShowLib(false)} className="text-[11px] text-fg-muted hover:text-fg">
                  {tt("Kapat")}
                </button>
              </div>
              {lib.length === 0 ? (
                <p className="py-3 text-center text-[12px] text-fg-muted">{tt("Kitaplığınızda henüz dosya yok.")}</p>
              ) : (
                <ul className="grid max-h-32 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-8">
                  {lib.map((u) => (
                    <li key={u.id} className="relative">
                      <button
                        type="button"
                        onClick={() => toggleRef(u.id)}
                        className={cn(
                          "group relative block aspect-square w-full overflow-hidden rounded-xl border bg-bg",
                          refs.includes(u.id) ? "border-fg ring-2 ring-fg/40" : "border-line hover:border-fg/40",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i */}
                        <img src={`/api/creative/file/${u.id}`} alt={u.name ?? ""} className="h-full w-full object-cover" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendTurn(prompt, false);
            }}
            className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-2.5 focus-within:border-fg/50"
          >
            <textarea
              ref={inputRef}
              id="cc-prompt"
              name="prompt"
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (prompt.trim() && !pending) sendTurn(prompt, false);
                }
              }}
              placeholder={tt("Örn: Instagram'a kahve postu atmak istiyorum şöyle olsun… (veya doğrudan üretmek istediğiniz fotoğraf/video/sesi yazın)")}
              className="w-full resize-none bg-transparent px-2 py-1 text-[14px] leading-relaxed text-fg placeholder:text-fg-passive focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="cursor-pointer rounded-full border border-line bg-bg px-3 py-1 text-[11px] font-medium text-fg-muted transition-standard hover:border-fg/40 hover:text-fg">
                  + {tt("Referans Yükle")}
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
                  {tt("Kitaplığım")} ({lib.length})
                </button>
                {upPct != null ? <span className="text-[11px] text-fg-muted">%{upPct}</span> : null}
                {upMsg ? (
                  <span className={cn("text-[11px]", upMsg.isError ? "text-critical" : "text-fg-muted")}>
                    {upMsg.text}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2.5">
                <div className="text-right leading-tight">
                  <span className="block text-[12px] font-semibold tabular-nums text-fg">{money(currentCost)}</span>
                  <span className={cn("block text-[10px] tabular-nums", short ? "text-critical" : "text-fg-passive")}>
                    {short ? tt("Kredi yetersiz") : `${tt("Kalan:")} ${money(Math.max(0, liveBalance - currentCost))}`}
                  </span>
                </div>
                {prompt.trim().length >= 3 ? (
                  <button
                    type="button"
                    disabled={pending || short}
                    onClick={() => sendTurn(prompt, true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full border border-fg px-4 text-[12px] font-semibold text-fg transition-standard hover:bg-fg/10 disabled:opacity-40"
                  >
                    {tt("Doğrudan Üret")}
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={pending || !prompt.trim()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-fg px-5 text-[13px] font-semibold text-bg transition-standard hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SparkleIcon size={13} />
                  {pending ? tt("Yanıtlanıyor…") : tt("Gönder")}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Sağ Panel: Telefon Önizleme & Chat Komutları ile Hızlı Formatlama */}
      {panelOpen && result ? (
        <aside className="flex flex-col justify-between gap-4 rounded-2xl border border-line bg-surface p-4" aria-label={tt("Telefon önizleme ve hızlı formatlama")}>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-line pb-2.5">
              <div>
                <h2 className="text-[13px] font-semibold text-fg">{tt("Telefon Önizleme & Formatlama")}</h2>
                <p className="text-[11px] text-fg-muted">{tt("Telefonda görünümü seçin veya chat komutuyla düzenleyin")}</p>
              </div>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label={tt("Paneli kapat")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <XIcon size={14} />
              </button>
            </div>

            <div className="flex justify-center py-1">
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

            {result.kind !== "audio" ? (
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg/50 p-3">
                <span className="text-[11px] font-medium text-fg">{tt("Hızlı Chat Formatlama Komutları")}</span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => applyQuickFormatCommand("9:16 dikey Instagram Reels / Story formatına uyarla", "9:16")}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg hover:border-fg/50"
                  >
                    9:16 Reels / Story
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => applyQuickFormatCommand("4:5 dikey Instagram gönderi formatına uyarla", "4:5")}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg hover:border-fg/50"
                  >
                    4:5 Instagram Post
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => applyQuickFormatCommand("1:1 kare gönderi formatına uyarla", "1:1")}
                    className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg hover:border-fg/50"
                  >
                    1:1 Kare
                  </button>
                  {result.kind === "image" ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => applyQuickFormatCommand("5 saniyelik akıcı kamera hareketli 9:16 Reels videosuna dönüştür", "9:16")}
                      className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-fg hover:border-fg/50"
                    >
                      Videoya Çevir
                    </button>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <input
                    type="text"
                    value={quickCmd}
                    onChange={(e) => setQuickCmd(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (quickCmd.trim()) applyQuickFormatCommand(quickCmd.trim());
                      }
                    }}
                    placeholder={tt("Komut yazın (örn: arka planı sadeleştir, ışığı ısıt)…")}
                    className="h-8 flex-1 rounded-lg border border-line bg-surface px-2.5 text-[12px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
                  />
                  <button
                    type="button"
                    disabled={pending || !quickCmd.trim()}
                    onClick={() => {
                      if (quickCmd.trim()) applyQuickFormatCommand(quickCmd.trim());
                    }}
                    className="h-8 rounded-lg bg-fg px-3 text-[11px] font-semibold text-bg hover:opacity-90 disabled:opacity-40"
                  >
                    {tt("Uygula")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-line pt-3">
            {result.kind !== "audio" ? (
              <form action={openAssetInStudioAction}>
                <input type="hidden" name="assetId" value={result.assetId} />
                <button
                  type="submit"
                  className="w-full rounded-xl border border-line px-3 py-2 text-center text-[12px] font-medium text-fg hover:border-fg/40"
                >
                  {result.kind === "video" ? tt("Videoyu Düzenleyicide Aç →") : tt("Fotoğrafı Düzenleyicide Aç →")}
                </button>
              </form>
            ) : null}
            <Link
              href={`/creative?sekme=metin&asset=${result.assetId}`}
              className="rounded-xl border border-line px-3 py-2 text-center text-[12px] text-fg hover:border-fg/40"
            >
              {tt("Post Metni & Hashtag Oluştur →")}
            </Link>
            <a
              href={`/api/creative/file/${result.assetId}?t=asset`}
              download
              className="rounded-xl bg-fg px-3 py-2 text-center text-[12px] font-semibold text-bg hover:opacity-90"
            >
              {tt("İndir")}
            </a>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
