"use client";
import { useTT } from "@/lib/i18n/tt-client";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addVoiceoverToVideoAction,
  chatCreativeDirectorAction,
  clearCreativeChatAction,
  deleteCreativePromptAction,
  openAssetInStudioAction,
  saveAssetToLibraryAction,
  saveCreativePromptAction,
  type CreditTier,
  type OrchestratorMeta,
  type PersistedChatTurn,
  type PromptIdeaItem,
  type SavedPromptItem,
} from "@/lib/actions/creative-studio";
import { idleState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { KindIcon } from "@/components/creative/kind-icon";
import { chargeAmount, fmtTl, KIND_LABEL, modelName, toneFor, type CreativeKind } from "@/lib/creative-models";
import { uploadFile } from "@/lib/creative-upload";
import { JobProgress, type JobDoneInfo } from "@/components/creative/job-progress";
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
        <div className="relative w-full overflow-hidden bg-black/5">
          {mediaOk ? (
            kind === "video" ? (
              <video
                src={src}
                controls
                playsInline
                preload="metadata"
                onError={() => setMediaOk(false)}
                className="block w-full max-h-[640px] bg-black"
                aria-label={cleanPrompt}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- imzalı S3 URL'i kendi doğal çerçevesinde
              <img
                src={src}
                alt={cleanPrompt}
                onError={() => setMediaOk(false)}
                className="block h-auto w-full max-h-[640px] object-contain"
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 p-8 text-center text-fg-muted">
              <KindIcon kind={kind} size={24} />
              <span className="text-[12px] font-medium">
                {kind === "video" ? tt("Video yüklenemedi") : tt("Görsel yüklenemedi")}
              </span>
              <p className="max-w-md text-[12px]">{cleanPrompt}</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-3 py-1.5 text-[11px] text-fg-muted">
            <span className="inline-flex items-center gap-1.5 font-medium text-fg">
              <KindIcon kind={kind} size={12} />
              {KIND_LABEL[kind]}
              {modelKey ? ` · ${modelName(modelKey)}` : ""}
            </span>
            {isSaved ? (
              <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
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

const WELCOME_TURN: ChatTurn = {
  id: "welcome",
  from: "bot",
  isHistorical: true,
  text:
    "Merhaba! Ben **Nordvow Creative AI**. Fotoğraf, Reels videosu, videolarınıza Türkçe AI seslendirme ve Instagram Post & Brief hazırlama işlemlerinin tamamını bu sohbette yönetebilirsiniz.\n\n" +
    "Aşağıdaki **Fikir & Hazır Promptlar** veya **Kayıtlı Promptlarım** kaydırıcısından bir karta tıklayarak detaylı komutu sohbet kutusuna ekleyebilir ya da doğrudan merhaba yazıp sohbet ederek başlayabilirsiniz.",
};

type ChatSession = {
  id: string;
  title: string;
  updatedAt: string;
  turns: ChatTurn[];
  result?: { assetId: string; uploadId?: string | null; kind: CreativeKind; prompt: string; format: string } | null;
  source: "local" | "db";
  kind?: CreativeKind;
};

export type ActiveJobState = {
  jobId: string;
  kind: CreativeKind;
  format: string;
  prompt: string;
  modelKey: string;
  postBrief?: string | null;
};

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
  initialChatTurns = [],
  initialActiveJob = null,
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
  initialChatTurns?: PersistedChatTurn[];
  initialActiveJob?: ActiveJobState | null;
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
  const [upBatch, setUpBatch] = useState<{ total: number; done: number; currentName: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [upMsg, setUpMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [quickCmd, setQuickCmd] = useState("");
  const [phoneVoiceScript, setPhoneVoiceScript] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sliderTab, setSliderTab] = useState<"ideas" | "saved">("ideas");
  const [ideasOpen, setIdeasOpen] = useState(false);
  const [ideas, setIdeas] = useState<PromptIdeaItem[]>(STARTER_PROMPT_IDEAS);
  const [savedPrompts, setSavedPrompts] = useState<SavedPromptItem[]>(initialSavedPrompts);
  const [promptNotice, setPromptNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const activeJobStorageKey = `nv_creative_active_job_${username}`;
  const [activeJob, setActiveJob] = useState<ActiveJobState | null>(initialActiveJob);

  useEffect(() => {
    if (initialActiveJob) return;
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(activeJobStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as ActiveJobState;
          if (parsed?.jobId) setActiveJob(parsed);
        }
      } catch {
        /* ignore */
      }
    });
  }, [initialActiveJob, activeJobStorageKey]);

  useEffect(() => {
    try {
      if (activeJob) {
        localStorage.setItem(activeJobStorageKey, JSON.stringify(activeJob));
      } else {
        localStorage.removeItem(activeJobStorageKey);
      }
    } catch {
      /* ignore */
    }
  }, [activeJob, activeJobStorageKey]);

  const tierCosts: Record<CreditTier, number> = {
    economy: 5,
    standard: 12,
    pro: 25,
  };

  const TIERS: { id: CreditTier; label: string; desc: string; cost: number }[] = [
    { id: "economy", label: tt("Uygun"), desc: "FLUX Schnell / LTX / Hızlı", cost: tierCosts.economy },
    { id: "standard", label: tt("Dengeli"), desc: "Recraft / Ideogram / Hailuo", cost: tierCosts.standard },
    { id: "pro", label: tt("Pro"), desc: "Pro Stüdyo / Kling Pro", cost: tierCosts.pro },
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
  const [panelOpen, setPanelOpen] = useState(false);
  const [phoneEditorOpen, setPhoneEditorOpen] = useState(false);
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  // Sohbet açılış mesajı (geçmiş işler altta dikey uzama yapmasın diye üstteki yatay medya slider'ında da gösterilir)
  const initialTurns = useMemo<ChatTurn[]>(() => {
    if (initialChatTurns.length > 0) {
      return [
        WELCOME_TURN,
        ...initialChatTurns.map((t) => ({
          id: t.id,
          from: t.from,
          text: t.text,
          postBrief: t.postBrief,
          enhancedPrompt: t.enhancedPrompt,
          voiceoverScript: t.voiceoverScript,
          assetId: t.assetId,
          uploadId: t.uploadId,
          kind: t.kind,
          format: t.format,
          modelKey: t.modelKey,
          prompt: t.prompt,
          savedToLibrary: t.savedToLibrary,
          error: t.error,
          isHistorical: true,
        })),
      ];
    }
    if (!initialHistory.length) return [WELCOME_TURN];
    const turns: ChatTurn[] = [WELCOME_TURN];
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

  const storageKey = `nv_creative_sessions_${username}`;
  const dbSessions = useMemo<ChatSession[]>(() => {
    return initialHistory.map((h) => {
      const cleanText = h.prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim() || h.prompt;
      const turns: ChatTurn[] = [
        WELCOME_TURN,
        { id: `hist-u-${h.jobId}`, from: "user", text: cleanText, isHistorical: true },
        ...(h.status === "COMPLETED" && h.assetId
          ? [
              {
                id: `hist-b-${h.jobId}`,
                from: "bot" as const,
                text: `${KIND_LABEL[h.kind]} hazırlandı ve kitaplığa kaydedildi.`,
                assetId: h.assetId,
                uploadId: h.uploadId,
                kind: h.kind,
                modelKey: h.modelKey,
                prompt: cleanText,
                savedToLibrary: true,
                isHistorical: true,
              },
            ]
          : []),
      ];
      return {
        id: `db-${h.jobId}`,
        title: cleanText.slice(0, 60),
        updatedAt: h.createdAt,
        turns,
        result: h.status === "COMPLETED" && h.assetId ? { assetId: h.assetId, uploadId: h.uploadId, kind: h.kind, prompt: cleanText, format: "9:16" } : null,
        source: "db",
        kind: h.kind,
      };
    });
  }, [initialHistory]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [localSessions, setLocalSessions] = useState<ChatSession[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as ChatSession[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [activeSessionId, setActiveSessionId] = useState<string>("current");
  const [chatLog, setChatLog] = useState<ChatTurn[]>(initialTurns);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const ideaSliderRef = useRef<HTMLDivElement>(null);
  const mediaSliderRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [sessionSeq, setSessionSeq] = useState(1);

  const persistLocalSessions = (next: ChatSession[]) => {
    setLocalSessions(next);
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(next.slice(0, 30)));
    } catch {
      /* ignore storage errors */
    }
  };

  const allSessions = useMemo(() => [...localSessions, ...dbSessions], [localSessions, dbSessions]);

  const saveCurrentIfNeeded = () => {
    const userTurns = chatLog.filter((t) => t.from === "user" && !t.isHistorical);
    if (userTurns.length === 0) return;
    const firstTitle = userTurns[0]!.text.slice(0, 60);
    const id = activeSessionId.startsWith("local-") ? activeSessionId : `local-${sessionSeq}`;
    if (!activeSessionId.startsWith("local-")) setSessionSeq((n) => n + 1);
    const entry: ChatSession = {
      id,
      title: firstTitle,
      updatedAt: new Date().toISOString(),
      turns: chatLog,
      result,
      source: "local",
      kind: result?.kind,
    };
    const next = [entry, ...localSessions.filter((s) => s.id !== id)];
    persistLocalSessions(next);
  };

  const startNewChat = () => {
    saveCurrentIfNeeded();
    void clearCreativeChatAction().catch(() => undefined);
    const nextSeq = sessionSeq + 1;
    setSessionSeq(nextSeq);
    setActiveSessionId(`local-${nextSeq}`);
    setChatLog([WELCOME_TURN]);
    setPrompt("");
    setRefs([]);
    setActiveJob(null);
    setResult(null);
    setPanelOpen(false);
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 20);
  };

  const selectSession = (s: ChatSession) => {
    saveCurrentIfNeeded();
    setActiveSessionId(s.id);
    setChatLog(s.turns.length ? s.turns : [WELCOME_TURN]);
    setResult(s.result ?? null);
    setPanelOpen(Boolean(s.result));
    setActiveJob(null);
    setError(null);
  };

  const deleteLocalSession = (id: string) => {
    persistLocalSessions(localSessions.filter((s) => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId("current");
      setChatLog([WELCOME_TURN]);
      setResult(null);
      setPanelOpen(false);
    }
  };

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
      try {
        const res = await addVoiceoverToVideoAction({ videoId, scriptText, tier });
        if (typeof res.availableCredits === "number") setLiveBalance(res.availableCredits);
        if (!res.ok) {
          const errMsg = res.error ?? "Videoya ses eklenemedi.";
          setError(errMsg);
          setChatLog((prev) => [
            ...prev,
            {
              id: `b-voice-err-${Date.now()}`,
              from: "bot",
              text: `Seslendirme eklenemedi: ${errMsg}`,
            },
          ]);
          return;
        }
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
      } catch (e) {
        setError(e instanceof Error ? e.message : "Videoya ses eklenirken beklenmeyen bir hata oluştu.");
      }
    });
  };

  const addFiles = async (files: FileList) => {
    const batch = Array.from(files).slice(0, 20);
    if (!batch.length) return;
    setUpMsg(null);
    let imgOk = 0;
    let vidOk = 0;
    let failed = 0;
    let lastErr = "";
    for (let idx = 0; idx < batch.length; idx++) {
      const f = batch[idx]!;
      try {
        setUpPct(0);
        setUpBatch({ total: batch.length, done: idx + 1, currentName: f.name });
        const r = await uploadFile(f, { name: f.name, mime: f.type, onProgress: setUpPct });
        setLib((l) => [{ id: r.id, kind: r.kind, name: f.name, source: "upload" }, ...l]);
        if (r.kind === "image") {
          imgOk++;
          setRefs((x) => (x.length < 4 && !x.includes(r.id) ? [...x, r.id] : x));
        } else {
          vidOk++;
          setResult({ assetId: r.id, uploadId: r.id, kind: "video", prompt: f.name, format: "9:16" });
          setPanelOpen(true);
        }
      } catch (e) {
        failed++;
        lastErr = `${f.name}: ${e instanceof Error ? e.message : "yüklenemedi"}`;
      }
    }
    setUpPct(null);
    setUpBatch(null);
    const totalOk = imgOk + vidOk;
    if (totalOk > 0) {
      const parts: string[] = [];
      if (imgOk > 0) parts.push(`${imgOk} fotoğraf`);
      if (vidOk > 0) parts.push(`${vidOk} video`);
      const summary = `${totalOk} dosya kitaplığa eklendi (${parts.join(", ")}).${imgOk > 0 ? " İlk 4 fotoğraf referans olarak seçildi." : ""}`;
      setUpMsg({ text: failed > 0 ? `${summary} (${failed} dosya başarısız: ${lastErr})` : summary, isError: failed > 0 });
    } else if (failed > 0) {
      setUpMsg({ text: lastErr || "Dosyalar yüklenemedi.", isError: true });
    }
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
      try {
        const res = await chatCreativeDirectorAction({
          message: trimmed,
          history: activeSessionHistory,
          tier,
          referenceUploadIds: usedRefs,
          targetVideoAssetId: result?.kind === "video" ? result.assetId : latestVideoAssetId,
          forceGenerate,
        });

        if (typeof res.availableCredits === "number") {
          setLiveBalance(res.availableCredits);
        }

        if (!res.ok) {
          const errMsg = res.error ?? "İşlem tamamlanamadı.";
          setError(errMsg);
          setChatLog((prev) => [
            ...prev,
            {
              id: `b-err-${Date.now()}`,
              from: "bot",
              text: `İşlem tamamlanamadı: ${errMsg}`,
            },
          ]);
          return;
        }

        if (res.suggestions?.length) {
          setIdeas(res.suggestions);
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
        } else if (res.pipelineJobId) {
          const pJobId = res.pipelineJobId;
          setChatLog((prev) => [
            ...prev,
            { id: `b-pipe-${Date.now()}`, from: "bot", text: res.reply },
          ]);
          void (async () => {
            for (let i = 0; i < 120; i++) {
              await new Promise((r) => setTimeout(r, 3000));
              try {
                const poll = await fetch(`/api/creative/pipeline/${pJobId}`, { cache: "no-store" });
                if (!poll.ok) continue;
                const data = (await poll.json()) as { job?: { status?: string; outputUploadId?: string; error?: string } };
                const j = data.job;
                if (!j) continue;
                if (j.status === "done" && j.outputUploadId) {
                  setResult({
                    assetId: j.outputUploadId,
                    uploadId: j.outputUploadId,
                    kind: "video",
                    prompt: trimmed,
                    format: res.format ?? "9:16",
                  });
                  setPanelOpen(true);
                  setChatLog((prev) => [
                    ...prev,
                    {
                      id: `b-pdone-${Date.now()}`,
                      from: "bot",
                      text: "AI Video montajınız hazır! Sağdaki önizlemeden izleyebilir veya kitaplıktan indirebilirsiniz.",
                      assetId: j.outputUploadId,
                      uploadId: j.outputUploadId,
                      kind: "video",
                      format: res.format ?? "9:16",
                      prompt: trimmed,
                      savedToLibrary: true,
                    },
                  ]);
                  router.refresh();
                  break;
                }
                if (j.status === "failed") {
                  const errMsg = j.error || "Video üretimi/düzenlemesi tamamlanamadı.";
                  setError(errMsg);
                  setChatLog((prev) => [
                    ...prev,
                    { id: `b-pfail-${Date.now()}`, from: "bot", text: `Video işlemi başarısız: ${errMsg}` },
                  ]);
                  break;
                }
              } catch {
                /* polling hatasında tekrar dene */
              }
            }
          })();
        } else if (res.videoEditJobId) {
          const vJobId = res.videoEditJobId;
          setChatLog((prev) => [
            ...prev,
            {
              id: `b-vedit-${Date.now()}`,
              from: "bot",
              text: res.reply,
            },
          ]);
          void (async () => {
            for (let i = 0; i < 90; i++) {
              await new Promise((r) => setTimeout(r, 2500));
              try {
                const poll = await fetch(`/api/creative/video-job/${vJobId}`, { cache: "no-store" });
                if (!poll.ok) continue;
                const data = (await poll.json()) as { status?: string; outputUploadId?: string; error?: string };
                if (data.status === "DONE" && data.outputUploadId) {
                  setResult({
                    assetId: data.outputUploadId,
                    uploadId: data.outputUploadId,
                    kind: "video",
                    prompt: trimmed,
                    format: res.format ?? "9:16",
                  });
                  setPanelOpen(true);
                  setChatLog((prev) => [
                    ...prev,
                    {
                      id: `b-vdone-${Date.now()}`,
                      from: "bot",
                      text: "Video düzenlemeniz tamamlandı! Sağdaki önizlemeden izleyebilir veya kitaplıktan indirebilirsiniz.",
                      assetId: data.outputUploadId,
                      uploadId: data.outputUploadId,
                      kind: "video",
                      format: res.format ?? "9:16",
                      prompt: trimmed,
                      savedToLibrary: true,
                    },
                  ]);
                  router.refresh();
                  break;
                }
                if (data.status === "FAILED") {
                  const errMsg = data.error || "Video düzenlenemedi.";
                  setError(errMsg);
                  setChatLog((prev) => [
                    ...prev,
                    { id: `b-vfail-${Date.now()}`, from: "bot", text: `Video düzenleme başarısız: ${errMsg}` },
                  ]);
                  break;
                }
              } catch {
                /* polling hatasında bir sonraki turda tekrar dene */
              }
            }
          })();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Üretim başlatılırken beklenmeyen bir hata oluştu.");
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
        "grid h-[calc(100dvh-10.5rem)] min-h-[480px] flex-1 w-full grid-cols-1 gap-3 overflow-hidden",
        historyOpen && panelOpen && result
          ? "lg:grid-cols-[260px_minmax(0,1fr)_370px] xl:grid-cols-[260px_minmax(0,1fr)_400px]"
          : historyOpen
            ? "lg:grid-cols-[260px_minmax(0,1fr)]"
            : panelOpen && result
              ? "lg:grid-cols-[minmax(0,1fr)_370px] xl:grid-cols-[minmax(0,1fr)_400px]"
              : "",
      )}
    >
      {/* Sol Açılır/Kapanır Geçmiş Sohbetler Paneli (Mobilde tam ekran çekmece) */}
      {historyOpen ? (
        <aside
          aria-label={tt("Geçmiş sohbetler")}
          className="fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-bg/95 p-3 backdrop-blur-xl lg:static lg:inset-auto lg:z-auto lg:h-full lg:min-h-0 lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:p-0 lg:backdrop-blur-none"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3.5 py-2.5">
            <span className="text-[12px] font-semibold text-fg">
              {tt("Geçmiş Sohbetler")} ({allSessions.length})
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={startNewChat}
                className="rounded-full bg-fg px-2.5 py-1 text-[11px] font-medium text-bg hover:opacity-90"
              >
                + {tt("Yeni")}
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label={tt("Geçmiş panelini kapat")}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2.5">
            {allSessions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-[12px] text-fg-muted">
                {tt("Henüz kayıtlı geçmiş sohbet yok.")}
              </p>
            ) : (
              allSessions.map((s) => {
                const isActive = activeSessionId === s.id;
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "group flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-standard",
                      isActive ? "border-fg bg-bg" : "border-transparent hover:border-line hover:bg-bg/60",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => selectSession(s)}
                      className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                    >
                      <span className="line-clamp-2 text-[12px] font-medium text-fg">{s.title}</span>
                      <span className="text-[10px] text-fg-passive">
                        {s.kind ? `${KIND_LABEL[s.kind]} · ` : ""}
                        {new Date(s.updatedAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })}
                      </span>
                    </button>
                    {s.source === "local" ? (
                      <button
                        type="button"
                        onClick={() => deleteLocalSession(s.id)}
                        aria-label={tt("Sohbeti sil")}
                        className="shrink-0 rounded px-1 text-[11px] text-fg-passive opacity-0 transition-opacity hover:text-critical group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </aside>
      ) : null}

      {/* Sol / Orta: Sabit Yüksekliğe Sahip Nordvow Creative AI Sohbet Stüdyosu */}
      <div className="flex h-full min-h-0 flex-col justify-between overflow-hidden rounded-2xl border border-line bg-surface">
        {/* Üst Çubuk: Geçmiş + Yeni Sohbet + Nordvow Creative AI + Kredi Seviyesi Seçimi */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen((v) => !v)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-standard",
                historyOpen ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg/40",
              )}
            >
              <span>{historyOpen ? tt("Geçmişi Gizle") : tt("Geçmiş Sohbetler")}</span>
              {allSessions.length ? <span className="opacity-75">({allSessions.length})</span> : null}
            </button>
            <button
              type="button"
              onClick={startNewChat}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] font-medium text-fg transition-standard hover:border-fg/50"
            >
              + {tt("Yeni Sohbet")}
            </button>
            <span className="hidden h-4 w-px bg-line sm:inline-block" aria-hidden />
            <span className="hidden h-7 w-7 items-center justify-center rounded-lg border border-line bg-bg text-fg sm:inline-flex" aria-hidden>
              <SparkleIcon size={14} />
            </span>
            <div className="hidden flex-wrap items-center gap-2 sm:flex">
              <h2 className="text-[13px] font-semibold text-fg">{tt("Nordvow Creative AI")}</h2>
              {profileLabel ? (
                <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-fg-muted">
                  {profileLabel}
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileSettingsOpen((v) => !v)}
              aria-expanded={mobileSettingsOpen}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-standard lg:hidden",
                mobileSettingsOpen ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-fg/40",
              )}
            >
              {tt("Kalite & Ayarlar")} {mobileSettingsOpen ? "▲" : "▼"}
            </button>
            <div
              className={cn(
                "w-full rounded-2xl border border-line bg-bg p-1 lg:inline-flex lg:w-auto lg:rounded-full lg:p-0.5",
                mobileSettingsOpen ? "flex flex-wrap gap-1" : "hidden lg:inline-flex",
              )}
              role="radiogroup"
              aria-label={tt("Kredi tercihi")}
            >
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
                    {t.label} · {t.cost} {tt("kredi")}
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
                  {msg.text
                    .replace(/\*\*([^*]+)\*\*/g, "$1")
                    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,!?:;)]|$)/g, "$1$2")
                    .replace(/^#{1,6}\s+/gm, "")
                    .replace(/\*\*/g, "")
                    .trim()}
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
            <div className="mr-auto flex w-full max-w-md flex-col gap-1.5">
              <p className="px-1 text-[11px] text-fg-muted">
                {tt("Arka planda üretim devam ediyor — başka bir sayfaya geçseniz bile işlem iptal olmaz.")}
              </p>
              <JobProgress
                key={activeJob.jobId}
                jobId={activeJob.jobId}
                onDone={(assetId, info?: JobDoneInfo) => {
                  const doneJob = activeJob;
                  setActiveJob(null);
                  if (typeof info?.availableCredits === "number") {
                    setLiveBalance(info.availableCredits);
                  }
                  if (info?.failed) {
                    const refundNote =
                      info.refundedAmount > 0
                        ? `Bloke edilen ${fmtTl(info.refundedAmount, info.currency ?? currency)} bakiyenize iade edildi.`
                        : "Ücret alınmadı, bakiyeniz korundu.";
                    const errText = `${info.error ?? "Üretim başarısız oldu."} ${refundNote}`;
                    setError(errText);
                    setChatLog((prev) => [
                      ...prev,
                      {
                        id: `fail-${Date.now()}`,
                        from: "bot",
                        text: `Üretim tamamlanamadı: ${errText}`,
                      },
                    ]);
                    router.refresh();
                    return;
                  }
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
          {/* Mobilde Açılır/Kapanır Fikir & Ek Araçlar Akordeonu */}
          <button
            type="button"
            onClick={() => setMobileToolsOpen((v) => !v)}
            aria-expanded={mobileToolsOpen}
            className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-fg-muted lg:hidden"
          >
            <span>{tt("Hazır Fikirler, Dosya & Kitaplık Araçları")}</span>
            <span>{mobileToolsOpen ? "▲" : "▼"}</span>
          </button>

          <div className={cn("flex-col gap-2", mobileToolsOpen ? "flex" : "hidden lg:flex")}>
          {/* Fikir & Hazır Promptlar Açılır/Kapanır Butonu */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-expanded={ideasOpen}
                onClick={() => {
                  if (ideasOpen && sliderTab === "ideas") setIdeasOpen(false);
                  else {
                    setSliderTab("ideas");
                    setIdeasOpen(true);
                  }
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold transition-standard",
                  ideasOpen && sliderTab === "ideas" ? "bg-fg text-bg" : "border border-line bg-surface text-fg-muted hover:text-fg",
                )}
              >
                {tt("Fikir & Hazır Promptlar")} ({ideas.length}) {ideasOpen && sliderTab === "ideas" ? "▲" : "▼"}
              </button>
              <button
                type="button"
                aria-expanded={ideasOpen}
                onClick={() => {
                  if (ideasOpen && sliderTab === "saved") setIdeasOpen(false);
                  else {
                    setSliderTab("saved");
                    setIdeasOpen(true);
                  }
                }}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-semibold transition-standard",
                  ideasOpen && sliderTab === "saved" ? "bg-fg text-bg" : "border border-line bg-surface text-fg-muted hover:text-fg",
                )}
              >
                ★ {tt("Kayıtlı Promptlarım")} ({savedPrompts.length}) {ideasOpen && sliderTab === "saved" ? "▲" : "▼"}
              </button>
            </div>

            {ideasOpen ? (
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
            ) : null}
          </div>

          {/* Yatay Kaydırılabilir (Slider) Kartlar: Yalnızca butonla açıldığında görünür */}
          {ideasOpen ? (
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
          ) : null}
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
                            setRefs((x) => {
                              if (x.includes(u.id)) return x.filter((y) => y !== u.id);
                              if (x.length < 4) return [...x, u.id];
                              return [...x.slice(1), u.id];
                            });
                            setShowLib(false);
                            setTimeout(() => inputRef.current?.focus(), 20);
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
            onDragOver={(e) => {
              e.preventDefault();
              if (!dragOver) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files?.length) void addFiles(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col gap-2 rounded-2xl border bg-surface p-2.5 focus-within:border-fg/50",
              dragOver ? "border-fg ring-2 ring-fg/30" : "border-line",
            )}
          >
            {upBatch ? (
              <div className="flex items-center justify-between gap-2 rounded-xl bg-bg px-3 py-1.5 text-[11px] text-fg">
                <span className="truncate">
                  {tt("Toplu yükleme:")} {upBatch.done}/{upBatch.total} · {upBatch.currentName}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">{upPct ?? 0}%</span>
              </div>
            ) : null}
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
              <div className={cn("flex-wrap items-center gap-1.5", mobileToolsOpen ? "flex" : "hidden lg:flex")}>
                <label className="cursor-pointer rounded-full border border-line bg-bg px-3 py-1 text-[11px] font-medium text-fg-muted transition-standard hover:border-fg/40 hover:text-fg">
                  + {tt("Toplu Fotoğraf / Video Ekle")}
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

              <div className="flex flex-wrap items-center justify-end gap-2">
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

      {/* Sağ Panel: Telefon Önizleme, Videoya Ses Ekleme & Hızlı Chat Formatlama (Mobilde tam ekran katman) */}
      {panelOpen && result ? (
        <aside
          className="fixed inset-0 z-50 flex h-dvh flex-col justify-between gap-3 overflow-y-auto bg-bg/95 p-4 backdrop-blur-xl lg:static lg:inset-auto lg:z-auto lg:h-full lg:min-h-0 lg:rounded-2xl lg:border lg:border-line lg:bg-surface lg:backdrop-blur-none"
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

            {/* Telefon Modunda Düzenleyiciyi Aç / Kapat */}
            {result.kind !== "audio" ? (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  aria-expanded={phoneEditorOpen}
                  onClick={() => setPhoneEditorOpen((v) => !v)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl border px-3 py-2 text-[12px] font-medium transition-standard",
                    phoneEditorOpen ? "border-fg bg-fg text-bg" : "border-line bg-bg/50 text-fg hover:border-fg/40",
                  )}
                >
                  <span>{tt("Düzenleyici & Ses / Format")}</span>
                  <span>{phoneEditorOpen ? "▲" : "▼"}</span>
                </button>

                {phoneEditorOpen ? (
                  <div className="flex flex-col gap-2.5">
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
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5 border-t border-line pt-2.5">
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
