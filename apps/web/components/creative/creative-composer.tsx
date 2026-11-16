"use client";
import { useTT } from "@/lib/i18n/tt-client";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addVoiceoverToVideoAction,
  chatCreativeDirectorAction,
  deleteCreativePromptAction,
  openAssetInStudioAction,
  saveAssetToLibraryAction,
  saveCreativePromptAction,
  type CreditTier,
  type OrchestratorMeta,
  type PromptIdeaItem,
  type SavedPromptItem,
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
      isHistorical?: boolean;
    }
  | {
      id: string;
      from: "bot";
      text: string;
      postBrief?: string | null;
      enhancedPrompt?: string | null;
      voiceoverScript?: string | null;
      assetId?: string | null;
      uploadId?: string | null;
      kind?: CreativeKind;
      format?: string;
      modelKey?: string;
      prompt?: string;
      savedToLibrary?: boolean;
      orchestrator?: OrchestratorMeta | null;
      error?: string | null;
      isHistorical?: boolean;
    };

const STARTER_PROMPT_IDEAS: PromptIdeaItem[] = [
  {
    title: "Sabah Işığında Ürün & Kahve Postu",
    category: "4:5 Fotoğraf + Brief",
    prompt:
      "Instagram için 4:5 dikey formatta ürün ve kahve çekimi üret: Sabah güneş ışığı alan doğal ahşap masa üzerinde minimal kompozisyon, sıcak krem ve toprak tonları, arkada hafif flu bitkiler, yüksek stüdyo netliği ve dikkat çekici Instagram post metni ile hashtagler hazırla.",
  },
  {
    title: "Sinematik Sesli Reels Videosu",
    category: "9:16 Sesli Video",
    prompt:
      "Instagram Reels için 9:16 dikey formatta 5 saniyelik sinematik tanıtım videosu ve Türkçe seslendirme üret: Yavaşça ürüne doğru yaklaşan kamera hareketi, altın saat ışık yansımaları, modern lüks atmosfer ve enerjik bir Türkçe reklam seslendirmesi ekle.",
  },
  {
    title: "Videoma Türkçe Seslendirme Üret",
    category: "Videoya Ses",
    prompt:
      "Videom için enerjik ve samimi bir Türkçe reklam seslendirmesi üretip videoya ekle: 'Yeni sezon koleksiyonumuz şimdi yayında! Sınırlı stok fırsatını kaçırmamak için hemen profildeki bağlantıya tıklayın.'",
  },
  {
    title: "Kozmetik & Cilt Bakımı Stüdyo",
    category: "4:5 Makro Fotoğraf",
    prompt:
      "Kozmetik ve cilt bakımı ürünü için 4:5 makro stüdyo fotoğrafı üret: Su damlacıkları ve doğal botanik yapraklar arasında zarif şişe, yumuşak difüzör aydınlatması, pastel bej arka plan ve ürün faydalarını anlatan Instagram Post Brief'i oluştur.",
  },
  {
    title: "Editorial Moda & Sokak Stili",
    category: "9:16 Story Görseli",
    prompt:
      "Instagram Story için 9:16 dikey formatta editorial moda çekimi üret: Şehir sokaklarında doğal gün ışığında modern minimalist kombin, sinematik renk tonlaması ve etkileşim artıran Story metni hazırla.",
  },
  {
    title: "Gastronomi & Gurme Lezzet Çekimi",
    category: "4:5 Fotoğraf + Brief",
    prompt:
      "Sosyal medya için 4:5 gurme kahve ve tatlı çekimi üret: Buharı tüten latte art fincanı, yanında taze kruvasan, mermer masa üstü, 45 derece doğal pencere ışığı ve samimi davet içeren Instagram Post Brief'i yaz.",
  },
  {
    title: "Kampanya Post Brief & Hashtag Seti",
    category: "Post & Brief",
    prompt:
      "Yeni ürün lansmanımız için görsel üretmeden önce kapsamlı bir Instagram Post Brief'i, dikkat çekici 3 farklı açılış cümlesi (Hook), açıklama metni, yapılacaklar listesi ve #reklam uyumlu hashtag seti hazırla.",
  },
  {
    title: "Lüks Parfüm & Saat Stüdyo Reklamı",
    category: "9:16 Sesli Video",
    prompt:
      "9:16 dikey Reels formatında lüks parfüm tanıtım videosu ve Türkçe seslendirme üret: Siyah ıslak doğal taş zemin üzerinde dramatik altın spot ışığı, su yansımaları, sinematik kamera geçişi ve etkileyici Türkçe dış ses.",
  },
];

function ChatMediaCard({
  assetId,
  uploadId,
  kind,
  prompt,
  modelKey,
  voiceoverScript,
  savedInitial,
  onInsertPrompt,
  onAddVoiceToVideo,
  onOpenPhone,
  onSavePrompt,
}: {
  assetId: string;
  uploadId?: string | null;
  kind: CreativeKind;
  prompt: string;
  modelKey?: string;
  voiceoverScript?: string | null;
  savedInitial?: boolean;
  onInsertPrompt: (refId: string | null, promptText: string) => void;
  onAddVoiceToVideo: (videoId: string, defaultScript: string) => void;
  onOpenPhone: () => void;
  onSavePrompt: (text: string, k: CreativeKind) => void;
}) {
  const tt = useTT();
  const [mediaOk, setMediaOk] = useState(true);
  const [voiceBoxOpen, setVoiceBoxOpen] = useState(false);
  const [voiceScript, setVoiceScript] = useState(
    voiceoverScript || "Yeni sezon koleksiyonumuz şimdi yayında! Sınırlı stok fırsatını kaçırmamak için hemen profildeki bağlantıya tıklayın.",
  );
  const [saveState, saveAction, savePending] = useActionState(saveAssetToLibraryAction, idleState);
  const isSaved = savedInitial || !!uploadId || saveState.ok;
  const effectiveRefId = (saveState.data?.uploadId as string | undefined) ?? uploadId ?? assetId;
  const src = `/api/creative/file/${assetId}?t=asset`;
  const cleanPrompt = prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim();

  return (
    <div className="flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-line bg-surface">
      {kind === "audio" ? (
        <div className="flex flex-col gap-2 bg-fg/[0.03] p-4">
          <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-fg">
            <span className="inline-flex items-center gap-1.5">
              <KindIcon kind="audio" size={14} />
              <span>{tt("Türkçe AI Seslendirme")}</span>
            </span>
            <button
              type="button"
              onClick={() => onSavePrompt(cleanPrompt, "audio")}
              className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[10px] text-fg-muted hover:border-fg/40 hover:text-fg"
            >
              ★ {tt("Promptu Kaydet")}
            </button>
          </div>
          <audio src={src} controls className="w-full" />
        </div>
      ) : (
        <div className={cn("relative flex aspect-[16/10] max-h-72 w-full items-center justify-center overflow-hidden bg-gradient-to-br text-white", toneFor(kind, assetId))}>
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

      {/* Videoya Ses Üret & Ekle Açılır Kutusu */}
      {kind === "video" && voiceBoxOpen ? (
        <div className="flex flex-col gap-2 border-t border-line bg-bg/80 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-fg">{tt("Bu Videoya Türkçe AI Seslendirme Üret & Ekle")}</span>
            <button type="button" onClick={() => setVoiceBoxOpen(false)} className="text-[11px] text-fg-muted hover:text-fg">
              {tt("Kapat")}
            </button>
          </div>
          <textarea
            rows={2}
            value={voiceScript}
            onChange={(e) => setVoiceScript(e.target.value)}
            placeholder={tt("Videoda okunmasını istediğiniz Türkçe metni yazın…")}
            className="w-full rounded-xl border border-line bg-surface p-2 text-[12px] text-fg focus:border-fg focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (voiceScript.trim()) {
                  setVoiceBoxOpen(false);
                  onAddVoiceToVideo(assetId, voiceScript.trim());
                }
              }}
              className="rounded-full bg-fg px-3.5 py-1 text-[11px] font-semibold text-bg hover:opacity-90"
            >
              {tt("Ses Üret & Videoya Göm")}
            </button>
          </div>
        </div>
      ) : null}

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
            {tt("Telefonda Gör")}
          </button>
        ) : null}

        {kind === "video" ? (
          <button
            type="button"
            onClick={() => setVoiceBoxOpen((v) => !v)}
            className="rounded-full border border-fg bg-surface px-3 py-1 text-[11px] font-semibold text-fg transition-standard hover:bg-fg hover:text-bg"
          >
            {tt("Videoya Ses Üret & Ekle")}
          </button>
        ) : null}

        {kind === "image" ? (
          <>
            <button
              type="button"
              onClick={() =>
                onInsertPrompt(
                  effectiveRefId,
                  `Şimdi üret: ${cleanPrompt} — bu görseli 5 saniyelik akıcı kamera hareketli 9:16 Reels videosuna dönüştür ve üzerine Türkçe seslendirme ekle`,
                )
              }
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-fg transition-standard hover:border-fg/50"
            >
              {tt("Sesli Videoya Çevir")}
            </button>
            <button
              type="button"
              onClick={() => onInsertPrompt(effectiveRefId, `Şimdi üret: ${cleanPrompt} — farklı ışık ve kadrajla yeni bir varyasyon üret`)}
              className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg transition-standard hover:border-fg/50"
            >
              {tt("Varyasyon")}
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={() => onSavePrompt(cleanPrompt, kind)}
          className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] text-fg-muted transition-standard hover:border-fg/50 hover:text-fg"
        >
          ★ {tt("Promptu Kaydet")}
        </button>

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
  initialSavedPrompts = [],
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
  initialSavedPrompts?: SavedPromptItem[];
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
  const [phoneVoiceScript, setPhoneVoiceScript] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sliderTab, setSliderTab] = useState<"ideas" | "saved">("ideas");
  const [ideas, setIdeas] = useState<PromptIdeaItem[]>(STARTER_PROMPT_IDEAS);
  const [savedPrompts, setSavedPrompts] = useState<SavedPromptItem[]>(initialSavedPrompts);
  const [promptNotice, setPromptNotice] = useState<string | null>(null);
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
    { id: "economy", label: tt("Uygun Kredi"), desc: "FLUX Schnell / LTX / Hızlı", cost: tierCosts.economy },
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

  // Sohbet açılış mesajı (geçmiş işler altta dikey uzama yapmasın diye üstteki yatay medya slider'ında da gösterilir)
  const initialTurns = useMemo<ChatTurn[]>(() => {
    const welcome: ChatTurn = {
      id: "welcome",
      from: "bot",
      isHistorical: true,
      text:
        "Merhaba! Ben **Nordvow Creative AI**. Fotoğraf, Reels videosu, videolarınıza Türkçe AI seslendirme ve Instagram Post & Brief hazırlama işlemlerinin tamamını bu sohbette yönetebilirsiniz.\n\n" +
        "Aşağıdaki **Fikir & Hazır Promptlar** veya **Kayıtlı Promptlarım** kaydırıcısından bir karta tıklayarak detaylı komutu sohbet kutusuna ekleyebilir ya da doğrudan merhaba yazıp sohbet ederek başlayabilirsiniz.",
    };
    if (!initialHistory.length) return [welcome];
    const turns: ChatTurn[] = [welcome];
    const sorted = [...initialHistory].slice(0, 6).reverse();
    for (const h of sorted) {
      const cleanText = h.prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim();
      turns.push({
        id: `hist-u-${h.jobId}`,
        from: "user",
        text: cleanText || h.prompt,
        isHistorical: true,
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
          isHistorical: true,
        });
      }
    }
    return turns;
  }, [initialHistory]);

  const [chatLog, setChatLog] = useState<ChatTurn[]>(initialTurns);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const ideaSliderRef = useRef<HTMLDivElement>(null);
  const mediaSliderRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = chatScrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [chatLog.length, activeJob]);

  // Sohbette üretilmiş tüm medya öğeleri (yatay slider için)
  const mediaItems = useMemo(() => {
    const list: { assetId: string; uploadId?: string | null; kind: CreativeKind; prompt: string; modelKey?: string; format?: string }[] = [];
    const seen = new Set<string>();
    for (let i = chatLog.length - 1; i >= 0; i--) {
      const m = chatLog[i]!;
      if (m.from === "bot" && m.assetId && m.kind && !seen.has(m.assetId)) {
        seen.add(m.assetId);
        list.push({
          assetId: m.assetId,
          uploadId: m.uploadId,
          kind: m.kind,
          prompt: m.prompt ?? m.text,
          modelKey: m.modelKey,
          format: m.format,
        });
      }
    }
    return list;
  }, [chatLog]);

  const latestVideoAssetId = useMemo(() => {
    const v = mediaItems.find((m) => m.kind === "video");
    return v?.assetId ?? null;
  }, [mediaItems]);

  /** Hazır prompt veya kayıtlı prompt tıklandığında komutu GÖNDERMEZ; sohbet kutusuna ekler ve odaklar. */
  const insertPromptIntoChat = (textToInsert: string, refId?: string | null) => {
    if (refId) {
      setRefs((prev) => (prev.includes(refId) ? prev : [refId, ...prev].slice(0, 4)));
    }
    setPrompt(textToInsert);
    setPromptNotice("Prompt sohbet kutusuna eklendi — dilediğiniz gibi düzenleyip Gönder'e basabilirsiniz.");
    setTimeout(() => setPromptNotice(null), 4000);
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 30);
  };

  const handleSavePrompt = (textToSave: string, kind: "image" | "video" | "audio" | "brief" = "image") => {
    const clean = textToSave.trim();
    if (clean.length < 3) return;
    start(async () => {
      const res = await saveCreativePromptAction({ prompt: clean, kind });
      if (res.ok) {
        setSavedPrompts(res.items);
        setSliderTab("saved");
        setPromptNotice("Prompt 'Kayıtlı Promptlarım' alanına kaydedildi.");
        setTimeout(() => setPromptNotice(null), 3500);
      }
    });
  };

  const handleDeleteSavedPrompt = (id: string) => {
    start(async () => {
      const res = await deleteCreativePromptAction(id);
      if (res.ok) setSavedPrompts(res.items);
    });
  };

  const handleAddVoiceToVideo = (videoId: string, scriptText: string) => {
    if (!scriptText.trim() || pending) return;
    setError(null);
    const tierInfo = TIERS.find((t) => t.id === tier);
    setChatLog((prev) => [
      ...prev,
      {
        id: `u-voice-${Date.now()}`,
        from: "user",
        text: `Videoya Türkçe Seslendirme Ekle: "${scriptText}"`,
        tierLabel: tierInfo?.label,
      },
    ]);
    start(async () => {
      const res = await addVoiceoverToVideoAction({ videoId, scriptText, tier });
      if (!res.ok) {
        setError(res.error ?? "Videoya ses eklenemedi.");
        return;
      }
      if (typeof res.availableCredits === "number") setLiveBalance(res.availableCredits);
      if (res.assetId) {
        setResult({ assetId: res.assetId, kind: "video", prompt: scriptText, format: "9:16" });
        setPanelOpen(true);
        setChatLog((prev) => [
          ...prev,
          {
            id: `b-voice-${Date.now()}`,
            from: "bot",
            text: res.reply,
            voiceoverScript: scriptText,
            assetId: res.assetId,
            kind: "video",
            format: "9:16",
            modelKey: res.modelKey,
            prompt: scriptText,
            savedToLibrary: true,
          },
        ]);
        router.refresh();
      }
    });
  };

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
          setResult({ assetId: r.id, uploadId: r.id, kind: "video", prompt: f.name, format: "9:16" });
          setPanelOpen(true);
          setUpMsg({ text: "Video yüklendi — sağ panelden veya sohbetten videoya ses ekleyebilirsiniz." });
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
    setPromptNotice(null);
    const tierInfo = TIERS.find((t) => t.id === tier);
    const usedRefs = overrideRefs ?? refs;

    // Yalnız bu oturumdaki aktif konuşma geçmişini gönder (eski iş geçmişi 'selam' mesajını üretime zorlamasın)
    const activeSessionHistory = chatLog
      .filter((c) => !c.isHistorical)
      .slice(-6)
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
        history: activeSessionHistory,
        tier,
        referenceUploadIds: usedRefs,
        targetVideoAssetId: result?.kind === "video" ? result.assetId : latestVideoAssetId,
        forceGenerate,
      });

      if (!res.ok) {
        setError(res.error ?? "İşlem tamamlanamadı.");
        return;
      }

      if (res.suggestions?.length) {
        setIdeas(res.suggestions);
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
            postBrief: res.postBrief,
            orchestrator: res.orchestrator,
          },
        ]);
        return;
      }

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
            voiceoverScript: res.voiceoverScript,
            assetId: res.assetId,
            kind: k,
            format: f,
            modelKey: res.modelKey,
            prompt: res.enhancedPrompt ?? trimmed,
            savedToLibrary: true,
            orchestrator: res.orchestrator,
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
            voiceoverScript: res.voiceoverScript,
            orchestrator: res.orchestrator,
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

  const scrollElement = (el: HTMLDivElement | null, dir: -1 | 1) => {
    if (!el) return;
    el.scrollBy({ left: dir * 320, behavior: "smooth" });
  };

  return (
    <div
      className={cn(
        "grid h-[calc(100dvh-8.2rem)] max-h-[calc(100dvh-8.2rem)] w-full grid-cols-1 gap-3 overflow-hidden",
        panelOpen && result ? "lg:grid-cols-[minmax(0,1fr)_370px] xl:grid-cols-[minmax(0,1fr)_400px]" : "",
      )}
    >
      {/* Sol / Orta: Sabit Yüksekliğe Sahip Nordvow Creative AI Sohbet Stüdyosu */}
      <div className="flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface">
        {/* Üst Çubuk: Nordvow Creative AI + Kredi Seviyesi Seçimi */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-line bg-bg text-fg" aria-hidden>
              <SparkleIcon size={14} />
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[13px] font-semibold text-fg">{tt("Nordvow Creative AI")}</h2>
              {profileLabel ? (
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted">
                  {profileLabel}
                </span>
              ) : null}
            </div>
          </div>

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

        {/* Üretilen İçerikler Yatay Slider Şeridi (Chat uzamadan hızlı geçiş) */}
        {mediaItems.length > 0 ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-bg/40 px-3 py-1.5">
            <span className="shrink-0 text-[11px] font-semibold text-fg-muted">{tt("Üretilenler:")}</span>
            <button
              type="button"
              onClick={() => scrollElement(mediaSliderRef.current, -1)}
              aria-label={tt("Sola kaydır")}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[12px] text-fg hover:border-fg/50"
            >
              ‹
            </button>
            <div
              ref={mediaSliderRef}
              className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scroll-smooth py-0.5 [scrollbar-width:none]"
            >
              {mediaItems.map((item) => {
                const active = result?.assetId === item.assetId;
                return (
                  <button
                    key={item.assetId}
                    type="button"
                    onClick={() => {
                      setResult({
                        assetId: item.assetId,
                        uploadId: item.uploadId,
                        kind: item.kind,
                        prompt: item.prompt,
                        format: item.format ?? "9:16",
                      });
                      setPanelOpen(true);
                    }}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-standard",
                      active ? "border-fg bg-fg text-bg" : "border-line bg-surface text-fg hover:border-fg/40",
                    )}
                  >
                    <KindIcon kind={item.kind} size={11} />
                    <span className="max-w-[140px] truncate">{item.prompt}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => scrollElement(mediaSliderRef.current, 1)}
              aria-label={tt("Sağa kaydır")}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[12px] text-fg hover:border-fg/50"
            >
              ›
            </button>
          </div>
        ) : null}

        {/* Sohbet Mesaj Akışı (Sabit yükseklik içinde kayar, sayfayı uzatmaz) */}
        <div
          ref={chatScrollRef}
          className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto scroll-smooth p-4 sm:p-5"
          role="log"
          aria-live="polite"
        >
          {chatLog.map((msg) =>
            msg.from === "user" ? (
              <div key={msg.id} className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
                <div className="rounded-2xl rounded-br-sm bg-fg px-4 py-2.5 text-[13px] leading-relaxed text-bg">
                  {msg.text}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[10px] text-fg-passive">
                  {msg.tierLabel ? <span>{msg.tierLabel}</span> : null}
                  {msg.refCount ? <span>· {msg.refCount} {tt("referans")}</span> : null}
                  <button
                    type="button"
                    onClick={() => insertPromptIntoChat(msg.text)}
                    className="underline hover:text-fg"
                  >
                    {tt("Chate Ekle")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSavePrompt(msg.text, "image")}
                    className="underline hover:text-fg"
                  >
                    ★ {tt("Kaydet")}
                  </button>
                </div>
              </div>
            ) : (
              <div key={msg.id} className="mr-auto flex w-full max-w-2xl flex-col gap-2.5">
                <div className="w-fit rounded-2xl rounded-bl-sm border border-line bg-bg/70 px-4 py-2.5 text-[13px] leading-relaxed whitespace-pre-line text-fg">
                  {msg.text}
                </div>

                {/* fal.ai Medya Orkestratörü & Bedrock Structured Output JSON Özeti */}
                {msg.orchestrator ? (
                  <details className="max-w-xl rounded-2xl border border-line bg-surface/80 px-3.5 py-2 text-[11px]">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 font-medium text-fg">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="rounded-full bg-fg px-2 py-0.5 text-[10px] font-semibold text-bg">
                          {msg.orchestrator.status === "ready" ? "READY" : "NEEDS_INFO"}
                        </span>
                        <code className="font-mono text-[11px] text-fg">{msg.orchestrator.endpoint}</code>
                      </span>
                      <span className="text-fg-muted">
                        {tt("Tahmini Maliyet:")} <strong>{msg.orchestrator.unitCostLabel}</strong> · {tt("JSON Payload Gör")}
                      </span>
                    </summary>
                    <div className="mt-2.5 flex flex-col gap-2 border-t border-line pt-2 text-[11px] text-fg-muted">
                      {msg.orchestrator.missingSlots.length > 0 ? (
                        <div>
                          <strong>{tt("Beklenen Bilgiler (missing_slots):")}</strong>{" "}
                          <code className="font-mono">{msg.orchestrator.missingSlots.join(", ")}</code>
                        </div>
                      ) : null}
                      <div className="grid grid-cols-1 gap-1 rounded-xl border border-line/60 bg-bg/60 p-2 sm:grid-cols-2">
                        <span><strong>{tt("Görsel:")}</strong> {msg.orchestrator.comboPreset.image}</span>
                        <span><strong>{tt("Video:")}</strong> {msg.orchestrator.comboPreset.video}</span>
                        <span><strong>{tt("Ses (TTS):")}</strong> {msg.orchestrator.comboPreset.tts}</span>
                        <span><strong>{tt("Müzik:")}</strong> {msg.orchestrator.comboPreset.music}</span>
                      </div>
                      <pre className="max-h-36 overflow-auto rounded-xl border border-line bg-bg p-2 font-mono text-[10px] text-fg">
                        {JSON.stringify(
                          {
                            status: msg.orchestrator.status,
                            missing_slots: msg.orchestrator.missingSlots,
                            fal_payload: msg.orchestrator.falPayload,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  </details>
                ) : null}

                {/* Hazır Instagram Post Metni & Brief Kartı */}
                {msg.postBrief ? (
                  <div className="flex max-w-xl flex-col gap-2 rounded-2xl border border-line bg-bg/40 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                        {tt("Instagram Post Metni & Brief")}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {msg.enhancedPrompt ? (
                          <button
                            type="button"
                            onClick={() => handleSavePrompt(msg.enhancedPrompt!, msg.kind ?? "image")}
                            className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-[11px] text-fg-muted hover:border-fg/40 hover:text-fg"
                          >
                            ★ {tt("Promptu Kaydet")}
                          </button>
                        ) : null}
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
                    </div>
                    <p className="max-h-40 overflow-y-auto whitespace-pre-line text-[12px] leading-relaxed text-fg">{msg.postBrief}</p>
                    {msg.voiceoverScript ? (
                      <p className="border-t border-line/60 pt-2 text-[11px] text-fg-muted">
                        <strong>{tt("Seslendirme Metni:")}</strong> {msg.voiceoverScript}
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
                    voiceoverScript={msg.voiceoverScript}
                    savedInitial={msg.savedToLibrary}
                    onInsertPrompt={(refId, textToInsert) => insertPromptIntoChat(textToInsert, refId)}
                    onAddVoiceToVideo={(vidId, script) => handleAddVoiceToVideo(vidId, script)}
                    onSavePrompt={(p, k) => handleSavePrompt(p, k)}
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
                        text: `${KIND_LABEL[doneJob.kind]} hazırlandı ve kitaplığınıza kaydedildi. Sağ panelde telefonda önizleyebilir veya videoya seslendirme ekleyebilirsiniz.`,
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
            <div className="mr-auto flex items-center gap-2 rounded-2xl border border-line bg-bg/60 px-4 py-2 text-[12px] text-fg-muted">
              <span>{tt("Nordvow Creative AI hazırlıyor…")}</span>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="rounded-xl border border-critical/30 bg-red-500/10 px-3 py-2 text-[13px] text-critical">
              {error}
            </p>
          ) : null}
        </div>

        {/* Alt Bölüm: Yatay Kaydırılabilir (Slider) Hazır Fikir Promptları + Kayıtlı Promptlar + Sohbet Kutusu */}
        <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-bg/40 p-2.5 sm:p-3">
          {/* Slider Sekmeleri ve Sol/Sağ Kaydırma Okları */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setSliderTab("ideas")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold transition-standard",
                  sliderTab === "ideas" ? "bg-fg text-bg" : "border border-line bg-surface text-fg-muted hover:text-fg",
                )}
              >
                {tt("Fikir & Hazır Promptlar")} ({ideas.length})
              </button>
              <button
                type="button"
                onClick={() => setSliderTab("saved")}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold transition-standard",
                  sliderTab === "saved" ? "bg-fg text-bg" : "border border-line bg-surface text-fg-muted hover:text-fg",
                )}
              >
                ★ {tt("Kayıtlı Promptlarım")} ({savedPrompts.length})
              </button>
              <span className="hidden text-[11px] text-fg-passive sm:inline">
                {tt("(Tıkladığınız prompt sohbet kutusuna eklenir)")}
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => scrollElement(ideaSliderRef.current, -1)}
                aria-label={tt("Promptları sola kaydır")}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-[12px] text-fg hover:border-fg/50"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => scrollElement(ideaSliderRef.current, 1)}
                aria-label={tt("Promptları sağa kaydır")}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-[12px] text-fg hover:border-fg/50"
              >
                ›
              </button>
            </div>
          </div>

          {/* Yatay Kaydırılabilir (Slider) Kartlar: Tıklayınca Komut Gitmez, Chate Detaylı Ekler */}
          <div
            ref={ideaSliderRef}
            className="flex snap-x snap-mandatory items-stretch gap-2 overflow-x-auto scroll-smooth pb-0.5 [scrollbar-width:none]"
          >
            {sliderTab === "ideas" ? (
              ideas.map((idea, idx) => (
                <button
                  key={`${idea.title}-${idx}`}
                  type="button"
                  onClick={() => insertPromptIntoChat(idea.prompt)}
                  className="group flex w-64 shrink-0 snap-start flex-col justify-between gap-1 rounded-xl border border-line bg-surface p-2.5 text-left transition-standard hover:border-fg"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="truncate text-[11px] font-semibold text-fg">{idea.title}</span>
                    <span className="shrink-0 rounded-full border border-line bg-bg px-2 py-0.5 text-[9px] font-medium text-fg-muted group-hover:border-fg/40">
                      {idea.category}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[11px] leading-snug text-fg-muted">{idea.prompt}</p>
                </button>
              ))
            ) : savedPrompts.length === 0 ? (
              <div className="flex w-full items-center justify-between rounded-xl border border-dashed border-line bg-surface/60 px-3 py-2 text-[12px] text-fg-muted">
                <span>{tt("Henüz kayıtlı promptunuz yok. Sohbet kutusuna yazdığınız veya beğendiğiniz bir promptu '★ Promptu Kaydet' ile buraya ekleyebilirsiniz.")}</span>
              </div>
            ) : (
              savedPrompts.map((sp) => (
                <div
                  key={sp.id}
                  className="group relative flex w-64 shrink-0 snap-start flex-col justify-between gap-1 rounded-xl border border-line bg-surface p-2.5 text-left transition-standard hover:border-fg"
                >
                  <div className="flex items-center justify-between gap-1.5 pr-5">
                    <button
                      type="button"
                      onClick={() => insertPromptIntoChat(sp.prompt)}
                      className="truncate text-left text-[11px] font-semibold text-fg hover:underline"
                    >
                      ★ {sp.title}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => insertPromptIntoChat(sp.prompt)}
                    className="line-clamp-2 text-left text-[11px] leading-snug text-fg-muted"
                  >
                    {sp.prompt}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteSavedPrompt(sp.id)}
                    aria-label={tt("Kayıtlı promptu sil")}
                    className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-fg-passive hover:bg-bg hover:text-critical"
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>

          {promptNotice ? (
            <p className="text-[11px] font-medium text-fg">{promptNotice}</p>
          ) : null}

          {refs.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5">
              <span className="text-[11px] font-medium text-fg">{tt("Seçili referans:")}</span>
              {refs.map((r) => (
                <div key={r} className="relative h-8 w-8 overflow-hidden rounded-lg border border-fg">
                  {/* eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i */}
                  <img src={`/api/creative/file/${r}`} alt={tt("Referans")} className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => toggleRef(r)}
                    aria-label={tt("Referansı kaldır")}
                    className="absolute top-0 right-0 rounded-full bg-black/75 px-1 text-[9px] text-white"
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
                  {tt("Kitaplığım")} ({lib.length}) — {tt("Referans görsel seçin veya videoya ses ekleyin")}
                </span>
                <button type="button" onClick={() => setShowLib(false)} className="text-[11px] text-fg-muted hover:text-fg">
                  {tt("Kapat")}
                </button>
              </div>
              {lib.length === 0 ? (
                <p className="py-2 text-center text-[12px] text-fg-muted">{tt("Kitaplığınızda henüz dosya yok.")}</p>
              ) : (
                <ul className="flex gap-2 overflow-x-auto pb-1">
                  {lib.map((u) => (
                    <li key={u.id} className="shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (u.kind === "video") {
                            setResult({ assetId: u.id, uploadId: u.id, kind: "video", prompt: u.name ?? "Video", format: "9:16" });
                            setPanelOpen(true);
                            setShowLib(false);
                          } else {
                            toggleRef(u.id);
                          }
                        }}
                        className={cn(
                          "group relative block h-16 w-16 overflow-hidden rounded-xl border bg-bg",
                          refs.includes(u.id) ? "border-fg ring-2 ring-fg/40" : "border-line hover:border-fg/40",
                        )}
                      >
                        {u.kind === "video" ? (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-fg/10 p-1 text-center text-[9px] font-medium text-fg">
                            <KindIcon kind="video" size={14} />
                            <span className="line-clamp-1">{u.name ?? "Video"}</span>
                          </div>
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i
                          <img src={`/api/creative/file/${u.id}`} alt={u.name ?? ""} className="h-full w-full object-cover" />
                        )}
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
              placeholder={tt("Selam yazarak tanışın veya üretmek istediğiniz fotoğraf, sesli video, videoya seslendirme ya da Post Brief'i yazın…")}
              className="w-full resize-none bg-transparent px-2 py-0.5 text-[13px] leading-relaxed text-fg placeholder:text-fg-passive focus:outline-none"
            />

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="cursor-pointer rounded-full border border-line bg-bg px-3 py-1 text-[11px] font-medium text-fg-muted transition-standard hover:border-fg/40 hover:text-fg">
                  + {tt("Dosya / Video Yükle")}
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
                {prompt.trim().length >= 3 ? (
                  <button
                    type="button"
                    onClick={() => handleSavePrompt(prompt, "image")}
                    className="rounded-full border border-line bg-bg px-3 py-1 text-[11px] font-medium text-fg-muted transition-standard hover:border-fg/40 hover:text-fg"
                  >
                    ★ {tt("Promptu Kaydet")}
                  </button>
                ) : null}
                {upPct != null ? <span className="text-[11px] text-fg-muted">%{upPct}</span> : null}
                {upMsg ? (
                  <span className={cn("text-[11px]", upMsg.isError ? "text-critical" : "text-fg-muted")}>
                    {upMsg.text}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <div className="text-right leading-tight">
                  <span className="block text-[11px] font-semibold tabular-nums text-fg">{money(currentCost)}</span>
                  <span className={cn("block text-[10px] tabular-nums", short ? "text-critical" : "text-fg-passive")}>
                    {short ? tt("Kredi yetersiz") : `${tt("Bakiye:")} ${money(liveBalance)}`}
                  </span>
                </div>
                {prompt.trim().length >= 3 ? (
                  <button
                    type="button"
                    disabled={pending || short}
                    onClick={() => sendTurn(prompt, true)}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-fg px-3.5 text-[11px] font-semibold text-fg transition-standard hover:bg-fg/10 disabled:opacity-40"
                  >
                    {tt("Doğrudan Üret")}
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={pending || !prompt.trim()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fg px-4 text-[12px] font-semibold text-bg transition-standard hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SparkleIcon size={12} />
                  {pending ? tt("Yanıtlanıyor…") : tt("Gönder")}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* Sağ Panel: Telefon Önizleme, Videoya Ses Ekleme & Hızlı Chat Formatlama */}
      {panelOpen && result ? (
        <aside
          className="flex h-full min-h-0 flex-col justify-between gap-3 overflow-y-auto rounded-2xl border border-line bg-surface p-4"
          aria-label={tt("Telefon önizleme ve hızlı formatlama")}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-line pb-2">
              <div>
                <h2 className="text-[13px] font-semibold text-fg">{tt("Telefon Önizleme & Ses / Format")}</h2>
                <p className="text-[11px] text-fg-muted">{tt("Telefonda görünümü inceleyin veya videoya ses ekleyin")}</p>
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

            {/* Videolar İçin Doğrudan Ses Üret & Ekle Bölümü */}
            {result.kind === "video" ? (
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg/50 p-3">
                <span className="text-[11px] font-semibold text-fg">{tt("Bu Videoya Türkçe AI Seslendirme Ekle")}</span>
                <textarea
                  rows={2}
                  value={phoneVoiceScript}
                  onChange={(e) => setPhoneVoiceScript(e.target.value)}
                  placeholder={tt("Örn: Yeni koleksiyonumuz şimdi mağazalarda ve online'da! Hemen keşfedin…")}
                  className="w-full rounded-lg border border-line bg-surface p-2 text-[12px] text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
                />
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    const txt =
                      phoneVoiceScript.trim() ||
                      "Yeni sezon koleksiyonumuz şimdi yayında! Sınırlı stok fırsatını kaçırmamak için hemen profildeki bağlantıya tıklayın.";
                    setPhoneVoiceScript("");
                    handleAddVoiceToVideo(result.assetId, txt);
                  }}
                  className="rounded-lg bg-fg px-3 py-1.5 text-[11px] font-semibold text-bg hover:opacity-90 disabled:opacity-40"
                >
                  {tt("Ses Üret & Videoya Göm")}
                </button>
              </div>
            ) : null}

            {result.kind !== "audio" ? (
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg/50 p-3">
                <span className="text-[11px] font-medium text-fg">{tt("Hızlı Formatlama & Sohbet İşlemleri")}</span>
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
                      onClick={() => applyQuickFormatCommand("5 saniyelik akıcı kamera hareketli ve Türkçe seslendirmeli 9:16 Reels videosuna dönüştür", "9:16")}
                      className="rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-medium text-fg hover:border-fg/50"
                    >
                      {tt("Sesli Videoya Çevir")}
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

          <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
            {result.kind !== "audio" ? (
              <form action={openAssetInStudioAction}>
                <input type="hidden" name="assetId" value={result.assetId} />
                <button
                  type="submit"
                  className="w-full rounded-xl border border-line px-3 py-1.5 text-center text-[12px] font-medium text-fg hover:border-fg/40"
                >
                  {result.kind === "video" ? tt("Videoyu Düzenleyicide Aç →") : tt("Fotoğrafı Düzenleyicide Aç →")}
                </button>
              </form>
            ) : null}
            <button
              type="button"
              onClick={() =>
                insertPromptIntoChat(
                  `Sadece post brief hazırla: "${result.prompt}" içeriği için dikkat çekici Instagram başlığı (Hook), açıklama metni, brief yapılacaklar listesi ve #reklam uyumlu hashtag seti yaz.`,
                )
              }
              className="rounded-xl border border-line px-3 py-1.5 text-center text-[12px] text-fg hover:border-fg/40"
            >
              {tt("Sohbette Post & Brief Yaz →")}
            </button>
            <a
              href={`/api/creative/file/${result.assetId}?t=asset`}
              download
              className="rounded-xl bg-fg px-3 py-1.5 text-center text-[12px] font-semibold text-bg hover:opacity-90"
            >
              {tt("İndir")}
            </a>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
