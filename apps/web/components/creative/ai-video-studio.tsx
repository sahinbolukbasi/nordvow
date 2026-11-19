"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { uploadFile } from "@/lib/creative-upload";
import { VideoStudioPipeline } from "./video-studio-pipeline";
import type { StudioUpload } from "./studio-editor";

export type AiStudioMediaItem = {
  id: string;
  kind: "video" | "image" | "audio";
  name: string;
  durationSec?: number | null;
  source: string;
};

export type InitialPipelineJob = {
  id: string;
  kind: "photo_to_video" | "ai_video_edit";
  status: "queued" | "planning" | "generating" | "rendering" | "done" | "failed";
  progress: number;
  sourceUploadIds: string[];
  outputUploadId: string | null;
  rootJobId: string | null;
  versionNumber: number;
  editPlan?: {
    summary?: string[];
    aspect?: string;
    colorLook?: string;
    autoTranscribe?: boolean;
    removeSilences?: { enabled?: boolean };
    hookTitle?: { enabled?: boolean; text?: string };
    audioMix?: { musicPrompt?: string | null; voiceoverText?: string | null };
    regenerateScene?: { enabled?: boolean; position?: string };
  } | null;
  costUsd?: number;
  durationMs?: number | null;
  error?: string | null;
  createdAt: string;
  versions?: {
    id: string;
    versionNumber: number;
    uploadId: string;
    editCommand: string | null;
    createdAt: string;
  }[];
};

type ModelChoice = "hailuo" | "kling" | "wan" | "veo";

const MODEL_OPTIONS: { id: ModelChoice; label: string }[] = [
  { id: "hailuo", label: "Hailuo 02 Fast (Ekonomik)" },
  { id: "kling", label: "Kling v2.5 Pro (Sinematik)" },
  { id: "wan", label: "Wan v3 (Dinamik Kamera)" },
  { id: "veo", label: "Veo 3.1 (Maksimum Kalite)" },
];

const QUICK_PRESETS: { label: string; prompt: string }[] = [
  {
    label: "Viral 9:16 Reels",
    prompt:
      "Bu ham videoyu 9:16 dikey viral Reels yap: sessiz boşlukları otomatik kes, Türkçe altyazı ekle, başa dikkat çekici kısa bir kanca başlık koy, renkleri canlandır ve konuşmayı bastırmayan enerjik fon müziği ekle.",
  },
  {
    label: "Sessizlik Kes + Altyazı",
    prompt:
      "Konuşmadaki sessiz boşlukları temizleyip kurguyu akıcı hale getir, otomatik Türkçe altyazı ekle ve sesi dengele.",
  },
  {
    label: "Sinematik Kurgu",
    prompt:
      "Sinematik renk düzenlemesi uygula, yumuşak geçişler ekle ve modern sinematik ambiyans fon müziğiyle profesyonel ses miksajı yap.",
  },
  {
    label: "AI B-Roll Giriş Ekle",
    prompt:
      "Başa videonun havasına uygun 5 saniyelik sinematik bir AI B-roll giriş sahnesi üret, renkleri canlandır ve enerjik fon müziği ekle.",
  },
  {
    label: "15 sn Hızlı Özet",
    prompt:
      "İlk 15 saniyeyi al, 9:16 dikey formata uyarla, 1.15x hızlandır, Türkçe altyazı ve dinamik ritimli fon müziği ekle.",
  },
];

const STATUS_META: Record<
  InitialPipelineJob["status"],
  { label: string; tone: string }
> = {
  queued: { label: "Kuyrukta", tone: "bg-amber-500/15 text-amber-700 border-amber-500/30" },
  planning: { label: "Planlanıyor · AWS Bedrock", tone: "bg-indigo-500/15 text-indigo-700 border-indigo-500/30" },
  generating: { label: "Üretiliyor · fal.ai", tone: "bg-violet-500/15 text-violet-700 border-violet-500/30" },
  rendering: { label: "Arka Planda Kurgu & Render · FFmpeg", tone: "bg-sky-500/15 text-sky-700 border-sky-500/30" },
  done: { label: "Tamamlandı", tone: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30" },
  failed: { label: "Başarısız", tone: "bg-red-500/15 text-red-700 border-red-500/30" },
};

function fmtDur(sec?: number | null): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}dk ${r}sn` : `${r}sn`;
}

export function AiVideoStudio({
  mediaAssets,
  initialAssetId,
  initialJobs,
}: {
  mediaAssets: AiStudioMediaItem[];
  initialAssetId?: string;
  initialJobs: InitialPipelineJob[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [studioMode, setStudioMode] = useState<"raw_video_ai" | "photo_to_video">("raw_video_ai");
  const [uploadedExtras, setUploadedExtras] = useState<AiStudioMediaItem[]>([]);
  const allMedia = useMemo(
    () => [
      ...uploadedExtras.filter((x) => !mediaAssets.some((m) => m.id === x.id)),
      ...mediaAssets,
    ],
    [uploadedExtras, mediaAssets],
  );

  const videos = useMemo(() => allMedia.filter((m) => m.kind === "video"), [allMedia]);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredVideos = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase("tr");
    if (!q) return videos;
    return videos.filter((v) => v.name.toLocaleLowerCase("tr").includes(q));
  }, [videos, searchQuery]);

  const initialVideoId = useMemo(() => {
    if (initialAssetId && videos.some((v) => v.id === initialAssetId)) return initialAssetId;
    return videos[0]?.id ?? "";
  }, [initialAssetId, videos]);

  const [rawVideoId, setRawVideoId] = useState<string>(initialVideoId);
  const [activeSourceId, setActiveSourceId] = useState<string>(initialVideoId);
  const [prompt, setPrompt] = useState("");
  const [modelChoice, setModelChoice] = useState<ModelChoice>("hailuo");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [jobs, setJobs] = useState<InitialPipelineJob[]>(initialJobs);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(initialJobs[0]?.id ?? null);
  const [previewMode, setPreviewMode] = useState<"edited" | "raw" | "compare">("edited");
  const [previewOutputId, setPreviewOutputId] = useState<string | null>(
    initialJobs.find((j) => j.status === "done" && j.outputUploadId)?.outputUploadId ?? null,
  );

  const activeJobs = useMemo(
    () => jobs.filter((j) => j.status !== "done" && j.status !== "failed"),
    [jobs],
  );

  const currentJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId],
  );

  // Arka planda çalışan tüm işleri otomatik yokla (sayfa yenilense bile devam eder)
  useEffect(() => {
    if (activeJobs.length === 0) return;
    let cancelled = false;
    const pollAll = async () => {
      for (const aj of activeJobs) {
        try {
          const res = await fetch(`/api/creative/pipeline/${encodeURIComponent(aj.id)}`, {
            cache: "no-store",
          });
          if (!res.ok || cancelled) continue;
          const updated = (await res.json()) as InitialPipelineJob;
          setJobs((prev) =>
            prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
          );
          if (updated.status === "done" && updated.outputUploadId) {
            setPreviewOutputId(updated.outputUploadId);
            setPreviewMode("edited");
            setNotice("AI video düzenleme arka planda tamamlandı ve Kitaplığa kaydedildi.");
            router.refresh();
          }
        } catch {
          // geçici ağ hatalarını yoksay
        }
      }
    };
    const timer = setInterval(() => void pollAll(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeJobs, router]);

  const handleUploadRawVideo = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setError(null);
    setNotice(null);
    setUploading(true);
    try {
      const up = await uploadFile(file, {
        name: file.name,
        mime: file.type || "video/mp4",
      });
      const item: AiStudioMediaItem = {
        id: up.id,
        kind: up.kind === "video" ? "video" : "image",
        name: file.name,
        source: "upload",
      };
      setUploadedExtras((prev) => [item, ...prev]);
      if (item.kind === "video") {
        setRawVideoId(item.id);
        setActiveSourceId(item.id);
        setPreviewOutputId(null);
        setPreviewMode("raw");
        setNotice(`"${item.name}" yüklendi. Şimdi ne yapılmasını istediğini yazıp AI ile düzenleyebilirsin.`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Video yüklenemedi.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleStartAiEdit = async () => {
    const sourceId = activeSourceId || rawVideoId;
    if (!sourceId) {
      setError("Önce bir ham video yükleyin veya kitaplıktan seçin.");
      return;
    }
    const cleanPrompt = prompt.trim();
    if (cleanPrompt.length < 3) {
      setError("Lütfen AI'nın videoda ne yapmasını istediğini kısaca yazın.");
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/creative/pipeline/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUploadId: sourceId,
          command: cleanPrompt,
          rootJobId: currentJob?.rootJobId ?? rawVideoId ?? sourceId,
          modelChoice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI düzenleme başlatılamadı.");
      const created: InitialPipelineJob = {
        ...data.job,
        sourceUploadIds: data.job.sourceUploadIds ?? [sourceId],
        createdAt: data.job.createdAt ?? new Date().toISOString(),
      };
      setJobs((prev) => [created, ...prev.filter((x) => x.id !== created.id)]);
      setSelectedJobId(created.id);
      setPrompt("");
      setNotice("AI düzenleme arka planda başlatıldı. AWS Bedrock planlayıp fal.ai + FFmpeg ile kurguyu tamamlayacak.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI düzenleme başlatılamadı.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevertVersion = async (jobId: string, versionId: string, uploadId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/creative/pipeline/${encodeURIComponent(jobId)}/revert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Sürüme dönülemedi.");
      }
      setPreviewOutputId(uploadId);
      setActiveSourceId(uploadId);
      setPreviewMode("edited");
      setNotice("Seçilen sürüme geri dönüldü; yeni komutlar bu sürüm üzerinden uygulanacak.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sürüme dönülemedi.");
    }
  };

  const selectRawVideo = (id: string) => {
    setRawVideoId(id);
    setActiveSourceId(id);
    setPreviewOutputId(null);
    setPreviewMode("raw");
    setError(null);
  };

  const selectedRawVideo = videos.find((v) => v.id === rawVideoId) ?? null;
  const studioUploadsForPhotoMode: StudioUpload[] = useMemo(
    () =>
      allMedia
        .filter((m): m is AiStudioMediaItem & { kind: "image" | "video" } => m.kind === "image" || m.kind === "video")
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          mime: m.kind === "video" ? "video/mp4" : "image/jpeg",
          sizeBytes: 0,
          name: m.name,
          durationSec: m.durationSec ?? null,
          source: m.source,
          createdAt: new Date().toISOString(),
        })),
    [allMedia],
  );

  const displayedOutputId = previewOutputId ?? currentJob?.outputUploadId ?? null;
  const versions = currentJob?.versions ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Üst Başlık & Mod Seçici */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-fg">AI Video Stüdyosu</h2>
              <span className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
                AWS Bedrock + fal.ai · Tam Otomatik Arka Plan Kurgu
              </span>
            </div>
            <p className="mt-0.5 text-xs text-fg-muted">
              Elle kesme veya timeline yok — ham videonu seç, ne istediğini yaz, AI arka planda en iyi kurguyu hazırlasın.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeJobs.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
              {activeJobs.length} arka plan işi çalışıyor ({activeJobs[0]?.progress ?? 0}%)
            </span>
          ) : null}

          <div className="inline-flex rounded-xl border border-line bg-bg p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setStudioMode("raw_video_ai")}
              className={cn(
                "rounded-lg px-3 py-1.5 font-medium transition",
                studioMode === "raw_video_ai"
                  ? "bg-fg text-bg shadow-xs"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              Ham Video AI Düzenle
            </button>
            <button
              type="button"
              onClick={() => setStudioMode("photo_to_video")}
              className={cn(
                "rounded-lg px-3 py-1.5 font-medium transition",
                studioMode === "photo_to_video"
                  ? "bg-fg text-bg shadow-xs"
                  : "text-fg-muted hover:text-fg",
              )}
            >
              Fotoğraflardan AI Video
            </button>
          </div>
        </div>
      </div>

      {studioMode === "photo_to_video" ? (
        <VideoStudioPipeline uploads={studioUploadsForPhotoMode} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          {/* Sol Panel: Ham Video Yükle & Kitaplıktan Seç */}
          <aside className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 lg:col-span-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                1. Ham Video Kaynağı
              </h3>
              <span className="text-[11px] text-fg-muted">{videos.length} video</span>
            </div>

            {/* Ham Video Yükleme Alanı */}
            <label
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line bg-bg px-3 py-5 text-center transition hover:border-fg/50",
                uploading && "pointer-events-none opacity-60",
              )}
            >
              <span className="text-xs font-semibold text-fg">
                {uploading ? "Video yükleniyor..." : "+ Yeni Ham Video Yükle"}
              </span>
              <span className="text-[11px] text-fg-muted">
                MP4, MOV veya WebM · En çok 100 MB
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm"
                className="hidden"
                onChange={(e) => void handleUploadRawVideo(e.target.files)}
              />
            </label>

            {/* Arama */}
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Kitaplık videolarında ara..."
              className="h-9 rounded-xl border border-line bg-bg px-3 text-xs text-fg placeholder:text-fg-muted focus:border-fg focus:outline-none"
            />

            {/* Video Listesi */}
            <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto pr-1">
              {filteredVideos.length === 0 ? (
                <div className="rounded-xl border border-line bg-bg p-4 text-center text-xs text-fg-muted">
                  Henüz video yok. Yukarıdan ham videonu yükleyebilir veya AI ile video üretebilirsin.
                </div>
              ) : (
                filteredVideos.map((v) => {
                  const selected = v.id === rawVideoId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => selectRawVideo(v.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-xl border p-2 text-left transition",
                        selected
                          ? "border-fg bg-bg ring-1 ring-fg"
                          : "border-line bg-bg/60 hover:border-fg/40",
                      )}
                    >
                      <video
                        src={`/api/creative/file/${encodeURIComponent(v.id)}`}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-14 w-11 shrink-0 rounded-lg bg-black object-cover"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-fg">{v.name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-fg-muted">
                          <span className="rounded bg-surface px-1.5 py-0.5 border border-line">
                            {v.source === "upload" ? "Ham Yükleme" : v.source === "edit" ? "AI Düzenleme" : "AI Üretim"}
                          </span>
                          {v.durationSec ? <span>{fmtDur(v.durationSec)}</span> : null}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Son Arka Plan İşleri */}
            {jobs.length > 0 ? (
              <div className="mt-2 border-t border-line pt-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                  Son Arka Plan İşleri
                </p>
                <div className="flex max-h-44 flex-col gap-1.5 overflow-y-auto pr-1">
                  {jobs.slice(0, 8).map((j) => {
                    const meta = STATUS_META[j.status];
                    const active = j.id === currentJob?.id;
                    return (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => {
                          setSelectedJobId(j.id);
                          if (j.outputUploadId) {
                            setPreviewOutputId(j.outputUploadId);
                            setPreviewMode("edited");
                          }
                        }}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-left text-xs transition",
                          active ? "border-fg bg-bg" : "border-line bg-bg/50 hover:border-fg/40",
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-fg">
                            {j.editPlan?.summary?.[0] ?? (j.kind === "ai_video_edit" ? `AI Edit v${j.versionNumber}` : "Fotoğraftan Video")}
                          </p>
                          <p className="text-[10px] text-fg-muted">
                            {j.progress}% · {meta.label}
                          </p>
                        </div>
                        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium", meta.tone)}>
                          {j.status === "done" ? "Hazır" : j.status === "failed" ? "Hata" : `${j.progress}%`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </aside>

          {/* Sağ Ana Alan: AI Prompt + Canlı Arka Plan Durumu + Önizleme */}
          <section className="flex flex-col gap-4 lg:col-span-8">
            {/* 2. AI Prompt & Komut Kartı */}
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    2. AI Düzenleme Prompt&apos;u (Bedrock + fal.ai)
                  </h3>
                  {selectedRawVideo ? (
                    <p className="mt-0.5 text-xs text-fg">
                      Kaynak:{" "}
                      <span className="font-semibold">
                        {activeSourceId !== rawVideoId ? "Son AI Sürümü (Üzerine Devam)" : selectedRawVideo.name}
                      </span>
                      {activeSourceId !== rawVideoId ? (
                        <button
                          type="button"
                          onClick={() => setActiveSourceId(rawVideoId)}
                          className="ml-2 text-[11px] underline text-fg-muted hover:text-fg"
                        >
                          Ham videoya dön
                        </button>
                      ) : null}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-fg-muted" htmlFor="ai-fal-model">
                    AI B-Roll Modeli:
                  </label>
                  <select
                    id="ai-fal-model"
                    value={modelChoice}
                    onChange={(e) => setModelChoice(e.target.value as ModelChoice)}
                    className="h-8 rounded-lg border border-line bg-bg px-2 text-xs text-fg"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <textarea
                rows={3}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void handleStartAiEdit();
                  }
                }}
                placeholder="Ham videonu nasıl düzenleyeyim? Örn: 9:16 viral Reels yap, sessiz boşlukları kes, otomatik Türkçe altyazı ekle, başa dikkat çekici kanca koy, renkleri canlandır ve enerjik fon müziği ekle..."
                className="mt-3 w-full rounded-xl border border-line bg-bg px-3.5 py-2.5 text-sm text-fg placeholder:text-fg-muted focus:border-fg focus:outline-none"
              />

              {/* Hızlı Hazır Promptlar */}
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-medium text-fg-muted">Hazır komutlar:</span>
                {QUICK_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setPrompt(preset.prompt)}
                    className="rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] font-medium text-fg-muted transition hover:border-fg/50 hover:text-fg"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-fg-muted">
                  Bedrock planlar · fal.ai (Wizper altyazı, Ace-Step müzik, B-roll) üretir · FFmpeg arka planda render alır.
                </p>
                <button
                  type="button"
                  disabled={submitting || (!rawVideoId && !activeSourceId)}
                  onClick={() => void handleStartAiEdit()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-fg px-5 text-xs font-semibold text-bg transition hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? "Başlatılıyor..." : "Arka Planda AI ile Düzenle"}
                </button>
              </div>

              {error ? (
                <p role="alert" className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              ) : null}
              {notice ? (
                <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800">
                  {notice}
                </p>
              ) : null}
            </div>

            {/* Aktif / Seçili Arka Plan İşi & Bedrock Plan Özeti */}
            {currentJob ? (
              <div className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-fg">Arka Plan İş Durumu</span>
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                        STATUS_META[currentJob.status].tone,
                      )}
                    >
                      {STATUS_META[currentJob.status].label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-fg-muted tabular-nums">
                    <span>%{currentJob.progress}</span>
                    {currentJob.durationMs ? <span>{(currentJob.durationMs / 1000).toFixed(1)} sn</span> : null}
                  </div>
                </div>

                {/* İlerleme Çubuğu */}
                <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-bg">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      currentJob.status === "failed"
                        ? "bg-red-500"
                        : currentJob.status === "done"
                          ? "bg-emerald-500"
                          : "bg-fg",
                    )}
                    style={{ width: `${Math.max(5, Math.min(100, currentJob.progress))}%` }}
                  />
                </div>

                {currentJob.error ? (
                  <p className="mt-2 text-xs text-red-700">{currentJob.error}</p>
                ) : null}

                {/* Bedrock'un Ürettiği Düzenleme Planı */}
                {currentJob.editPlan?.summary?.length ? (
                  <div className="mt-3 rounded-xl border border-line bg-bg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                        AI Düzenleme Planı
                      </span>
                      <div className="flex flex-wrap gap-1 text-[10px]">
                        {currentJob.editPlan.aspect && currentJob.editPlan.aspect !== "orijinal" ? (
                          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-fg-muted">
                            {currentJob.editPlan.aspect}
                          </span>
                        ) : null}
                        {currentJob.editPlan.removeSilences?.enabled ? (
                          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-fg-muted">
                            Sessizlik Kesimi
                          </span>
                        ) : null}
                        {currentJob.editPlan.autoTranscribe ? (
                          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-fg-muted">
                            fal.ai Wizper Altyazı
                          </span>
                        ) : null}
                        {currentJob.editPlan.hookTitle?.enabled ? (
                          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-fg-muted">
                            Kanca Başlık
                          </span>
                        ) : null}
                        {currentJob.editPlan.audioMix?.musicPrompt ? (
                          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-fg-muted">
                            fal.ai Fon Müziği
                          </span>
                        ) : null}
                        {currentJob.editPlan.regenerateScene?.enabled ? (
                          <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-fg-muted">
                            fal.ai B-Roll ({currentJob.editPlan.regenerateScene.position ?? "intro"})
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <ul className="mt-2 grid gap-1 text-xs text-fg sm:grid-cols-2">
                      {currentJob.editPlan.summary.map((line, i) => (
                        <li key={i} className="flex items-start gap-1.5">
                          <span className="text-emerald-600">✓</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* 3. Video Önizleme & Önce / Sonra Karşılaştırma */}
            <div className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-xl border border-line bg-bg p-0.5 text-xs">
                  <button
                    type="button"
                    disabled={!displayedOutputId}
                    onClick={() => setPreviewMode("edited")}
                    className={cn(
                      "rounded-lg px-3 py-1 font-medium transition disabled:opacity-40",
                      previewMode === "edited" ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    AI Düzenlenmiş
                  </button>
                  <button
                    type="button"
                    disabled={!rawVideoId}
                    onClick={() => setPreviewMode("raw")}
                    className={cn(
                      "rounded-lg px-3 py-1 font-medium transition disabled:opacity-40",
                      previewMode === "raw" ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    Ham Video
                  </button>
                  <button
                    type="button"
                    disabled={!rawVideoId || !displayedOutputId}
                    onClick={() => setPreviewMode("compare")}
                    className={cn(
                      "rounded-lg px-3 py-1 font-medium transition disabled:opacity-40",
                      previewMode === "compare" ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
                    )}
                  >
                    Yan Yana Karşılaştır
                  </button>
                </div>

                {displayedOutputId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveSourceId(displayedOutputId);
                        setNotice("Sonraki AI komutun bu düzenlenmiş sürüm üzerinden uygulanacak.");
                      }}
                      className="h-8 rounded-lg border border-line bg-bg px-3 text-xs font-medium text-fg hover:border-fg/50"
                    >
                      Bu Sürüm Üzerinden Devam Et
                    </button>
                    <a
                      href={`/api/creative/file/${encodeURIComponent(displayedOutputId)}`}
                      download={`ai-video-${displayedOutputId.slice(-6)}.mp4`}
                      className="inline-flex h-8 items-center rounded-lg bg-fg px-3 text-xs font-semibold text-bg hover:opacity-90"
                    >
                      MP4 İndir
                    </a>
                    <Link
                      href="/creative?sekme=galeri"
                      className="inline-flex h-8 items-center rounded-lg border border-line bg-bg px-3 text-xs font-medium text-fg-muted hover:text-fg"
                    >
                      Kitaplıkta Gör
                    </Link>
                  </div>
                ) : null}
              </div>

              {/* Oynatıcı Alanı */}
              <div className="mt-3">
                {previewMode === "compare" && rawVideoId && displayedOutputId ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-fg-muted">Ham Video (Önce)</span>
                      <video
                        key={`raw-${rawVideoId}`}
                        src={`/api/creative/file/${encodeURIComponent(rawVideoId)}`}
                        controls
                        playsInline
                        className="max-h-[420px] w-full rounded-xl bg-black object-contain"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-emerald-700">AI Düzenlenmiş (Sonra)</span>
                      <video
                        key={`out-${displayedOutputId}`}
                        src={`/api/creative/file/${encodeURIComponent(displayedOutputId)}`}
                        controls
                        playsInline
                        className="max-h-[420px] w-full rounded-xl bg-black object-contain"
                      />
                    </div>
                  </div>
                ) : previewMode === "edited" && displayedOutputId ? (
                  <video
                    key={`out-single-${displayedOutputId}`}
                    src={`/api/creative/file/${encodeURIComponent(displayedOutputId)}`}
                    controls
                    playsInline
                    className="max-h-[460px] w-full rounded-xl bg-black object-contain"
                  />
                ) : rawVideoId ? (
                  <video
                    key={`raw-single-${rawVideoId}`}
                    src={`/api/creative/file/${encodeURIComponent(rawVideoId)}`}
                    controls
                    playsInline
                    className="max-h-[460px] w-full rounded-xl bg-black object-contain"
                  />
                ) : (
                  <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-line bg-bg text-xs text-fg-muted">
                    Başlamak için soldan bir ham video seçin veya yeni video yükleyin.
                  </div>
                )}
              </div>

              {/* Sürüm Geçmişi */}
              {versions.length > 0 && currentJob ? (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                    AI Sürüm Geçmişi
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {versions.map((v) => (
                      <div
                        key={v.id}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs",
                          displayedOutputId === v.uploadId
                            ? "border-fg bg-bg"
                            : "border-line bg-bg/60",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewOutputId(v.uploadId);
                            setPreviewMode("edited");
                          }}
                          className="text-left"
                        >
                          <span className="font-semibold text-fg">v{v.versionNumber}</span>
                          {v.editCommand ? (
                            <span className="ml-1.5 text-fg-muted">
                              · {v.editCommand.slice(0, 40)}
                              {v.editCommand.length > 40 ? "…" : ""}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevertVersion(currentJob.id, v.id, v.uploadId)}
                          className="rounded-md border border-line bg-surface px-2 py-0.5 text-[10px] font-medium text-fg-muted hover:text-fg"
                        >
                          Bu Sürüme Dön
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
