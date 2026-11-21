"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { uploadFile } from "@/lib/creative-upload";
import type { StudioUpload } from "./studio-editor";

type Aspect = "9:16" | "1:1" | "16:9";
type ModelChoice = "hailuo" | "kling" | "wan" | "veo";
type TransitionType = "cut" | "fade" | "wipeleft" | "slideleft" | "dissolve";

type StoryboardScene = {
  sceneIndex: number;
  uploadIndex: number;
  uploadId?: string;
  motionPrompt: string;
  cameraMove: string;
  durationSec: number;
  transition: TransitionType;
  voiceoverText: string;
  subtitleText: string;
};

type Storyboard = {
  title: string;
  musicStyle: string;
  voiceoverScript: string;
  scenes: StoryboardScene[];
};

type VersionItem = {
  id: string;
  versionNumber: number;
  uploadId: string;
  editCommand: string | null;
  createdAt: string;
};

type PipelineJobState = {
  id: string;
  kind: "photo_to_video" | "ai_video_edit";
  status: "queued" | "planning" | "generating" | "rendering" | "done" | "failed";
  progress: number;
  outputUploadId: string | null;
  rootJobId: string | null;
  editPlan?: { summary?: string[] } | null;
  costUsd?: number;
  durationMs?: number | null;
  error?: string | null;
  versions?: VersionItem[];
};

const MODEL_OPTIONS: { id: ModelChoice; label: string }[] = [
  { id: "hailuo", label: "Hailuo 02 Fast (Ekonomik)" },
  { id: "kling", label: "Kling v2.5 Pro (Sinematik)" },
  { id: "wan", label: "Wan v3 (Dinamik Kamera)" },
  { id: "veo", label: "Veo 3.1 (Maksimum Kalite)" },
];

const STATUS_LABEL: Record<PipelineJobState["status"], string> = {
  queued: "Kuyrukta",
  planning: "Planlanıyor (Bedrock AI)",
  generating: "Sahneler üretiliyor (fal.ai)",
  rendering: "Montaj & FFmpeg işleniyor",
  done: "Tamamlandı",
  failed: "Başarısız",
};

export function VideoStudioPipeline({
  uploads,
  tenantId,
}: {
  uploads: StudioUpload[];
  tenantId?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"photo_to_video" | "ai_video_edit">("photo_to_video");
  const [extraUploads, setExtraUploads] = useState<StudioUpload[]>([]);
  const lib = [...extraUploads.filter((x) => !uploads.some((u) => u.id === x.id)), ...uploads];

  const images = lib.filter((u) => u.kind === "image");
  const videos = lib.filter((u) => u.kind === "video");

  // Fotoğraftan Video durumu
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>(images.slice(0, 3).map((i) => i.id));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [modelChoice, setModelChoice] = useState<ModelChoice>("hailuo");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [defaultDuration, setDefaultDuration] = useState<number>(5);
  const [musicStyle, setMusicStyle] = useState("modern enerjik elektronik fon müziği");
  const [goal, setGoal] = useState("");
  const [storyboard, setStoryboard] = useState<Storyboard | null>(null);
  const [sbLoading, setSbLoading] = useState(false);

  // AI Video Edit durumu
  const [selectedVideoId, setSelectedVideoId] = useState<string>(videos[0]?.id ?? "");
  const [editCommand, setEditCommand] = useState("");
  const [versions, setVersions] = useState<VersionItem[]>([]);

  // Ortak yükleme & aktif iş polling
  const [uploading, setUploading] = useState<string | null>(null);
  const [job, setJob] = useState<PipelineJobState | null>(null);
  const [previewUploadId, setPreviewUploadId] = useState<string | null>(videos[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "failed") return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/creative/pipeline/${job.id}`, { cache: "no-store" });
        if (res.ok && !stop) {
          const data = (await res.json()) as PipelineJobState;
          setJob(data);
          if (data.versions?.length) setVersions(data.versions);
          if (data.status === "done" && data.outputUploadId) {
            setPreviewUploadId(data.outputUploadId);
            setSelectedVideoId(data.outputUploadId);
            router.refresh();
            return;
          }
          if (data.status === "failed") {
            setError(data.error ?? "İşlem başarısız oldu.");
            return;
          }
        }
      } catch {
        /* sonraki polling turunda tekrar dene */
      }
      if (!stop) setTimeout(tick, 2000);
    };
    const t = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(t);
    };
  }, [job, router]);

  const handleBulkUpload = async (files: FileList) => {
    setError(null);
    const list = Array.from(files).slice(0, 20);
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      try {
        setUploading(`${i + 1}/${list.length}: ${f.name}`);
        const res = await uploadFile(f, { name: f.name, mime: f.type, tenantId });
        const item: StudioUpload = {
          id: res.id,
          kind: res.kind,
          name: f.name,
          mime: f.type,
          sizeBytes: f.size,
          source: "upload",
          durationSec: null,
          createdAt: new Date().toISOString(),
        };
        setExtraUploads((prev) => [item, ...prev]);
        if (res.kind === "image") {
          setSelectedPhotos((prev) => (prev.length < 20 && !prev.includes(res.id) ? [...prev, res.id] : prev));
        } else {
          setSelectedVideoId(res.id);
          setPreviewUploadId(res.id);
        }
      } catch (e) {
        setError(`${f.name}: ${e instanceof Error ? e.message : "yüklenemedi"}`);
      }
    }
    setUploading(null);
    router.refresh();
  };

  const movePhoto = (from: number, to: number) => {
    if (to < 0 || to >= selectedPhotos.length) return;
    setSelectedPhotos((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      if (item) next.splice(to, 0, item);
      return next;
    });
  };

  const generateStoryboard = async () => {
    if (!selectedPhotos.length) return;
    setError(null);
    setSbLoading(true);
    try {
      const res = await fetch("/api/creative/pipeline/photo-to-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "storyboard",
          uploadIds: selectedPhotos,
          aspect,
          modelChoice,
          goal,
          musicStyle,
          defaultDurationSec: defaultDuration,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Storyboard oluşturulamadı.");
      setStoryboard(data.storyboard);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Storyboard hatası.");
    } finally {
      setSbLoading(false);
    }
  };

  const startPhotoToVideo = async () => {
    if (!selectedPhotos.length) return;
    setError(null);
    try {
      const res = await fetch("/api/creative/pipeline/photo-to-video", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "start",
          uploadIds: selectedPhotos,
          aspect,
          modelChoice,
          goal,
          musicStyle,
          defaultDurationSec: defaultDuration,
          storyboard: storyboard ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Video üretimi başlatılamadı.");
      setJob(data.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Başlatma hatası.");
    }
  };

  const startAiEdit = async () => {
    if (!selectedVideoId || !editCommand.trim()) return;
    setError(null);
    try {
      const res = await fetch("/api/creative/pipeline/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceUploadId: selectedVideoId,
          command: editCommand.trim(),
          rootJobId: job?.rootJobId ?? undefined,
          modelChoice,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI Edit başlatılamadı.");
      setJob(data.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Edit hatası.");
    }
  };

  const handleRevert = async (versionId: string, uploadId: string) => {
    if (!job) return;
    setError(null);
    try {
      const res = await fetch(`/api/creative/pipeline/${job.id}/revert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Versiyona dönülemedi.");
      setPreviewUploadId(uploadId);
      setSelectedVideoId(uploadId);
      setVersions((prev) => [data.version, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Geri alma hatası.");
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div>
          <h2 className="text-[15px] font-semibold text-fg">AI Video Stüdyo Boru Hattı (Bedrock + fal.ai + FFmpeg)</h2>
          <p className="text-[12px] text-fg-muted">
            Fotoğraflardan Storyboard ile çok sahneli video üretin veya mevcut videoları doğal dil komutlarıyla düzenleyin.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-line bg-bg p-1">
          <button
            type="button"
            onClick={() => setMode("photo_to_video")}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium transition-standard",
              mode === "photo_to_video" ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
            )}
          >
            Fotoğraftan Video
          </button>
          <button
            type="button"
            onClick={() => setMode("ai_video_edit")}
            className={cn(
              "rounded-full px-3 py-1 text-[12px] font-medium transition-standard",
              mode === "ai_video_edit" ? "bg-fg text-bg" : "text-fg-muted hover:text-fg",
            )}
          >
            AI Video Edit
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-critical/30 bg-red-500/10 px-3 py-2 text-[12px] text-critical">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
        <div className="flex flex-col gap-3">
          {mode === "photo_to_video" ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg/50 p-3">
                <span className="text-[12px] font-medium text-fg">
                  1. Fotoğraflar ({selectedPhotos.length}/20 seçili · sürükleyip sıralayın)
                </span>
                <label className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium text-fg hover:border-fg/50">
                  {uploading ? uploading : "+ 1–20 Fotoğraf Yükle"}
                  <input
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files?.length) void handleBulkUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {selectedPhotos.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selectedPhotos.map((id, idx) => (
                    <div
                      key={id}
                      draggable
                      onDragStart={() => setDragIdx(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragIdx !== null && dragIdx !== idx) movePhoto(dragIdx, idx);
                        setDragIdx(null);
                      }}
                      className="relative flex w-20 shrink-0 cursor-move flex-col items-center gap-1 rounded-xl border border-line bg-bg p-1"
                    >
                      <span className="text-[10px] font-semibold text-fg-muted">#{idx + 1}</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/creative/file/${id}`} alt={`Sahne ${idx + 1}`} className="h-16 w-16 rounded-lg object-cover" />
                      <div className="flex gap-1">
                        <button type="button" onClick={() => movePhoto(idx, idx - 1)} className="text-[10px] text-fg-muted hover:text-fg">←</button>
                        <button type="button" onClick={() => setSelectedPhotos((p) => p.filter((x) => x !== id))} className="text-[10px] text-critical">×</button>
                        <button type="button" onClick={() => movePhoto(idx, idx + 1)} className="text-[10px] text-fg-muted hover:text-fg">→</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {images.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {images.slice(0, 16).map((img) => {
                    const active = selectedPhotos.includes(img.id);
                    return (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() =>
                          setSelectedPhotos((prev) =>
                            prev.includes(img.id) ? prev.filter((x) => x !== img.id) : prev.length < 20 ? [...prev, img.id] : prev,
                          )
                        }
                        className={cn(
                          "rounded-lg border px-2 py-1 text-[11px]",
                          active ? "border-fg bg-fg text-bg" : "border-line bg-bg text-fg-muted hover:text-fg",
                        )}
                      >
                        {img.name?.slice(0, 18) || img.id.slice(0, 8)}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                  Video Modeli
                  <select
                    value={modelChoice}
                    onChange={(e) => setModelChoice(e.target.value as ModelChoice)}
                    className="h-8 rounded-lg border border-line bg-bg px-2 text-[12px] text-fg"
                  >
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                  Çıktı Oranı
                  <select
                    value={aspect}
                    onChange={(e) => setAspect(e.target.value as Aspect)}
                    className="h-8 rounded-lg border border-line bg-bg px-2 text-[12px] text-fg"
                  >
                    <option value="9:16">9:16 (Reels / Story)</option>
                    <option value="1:1">1:1 (Kare)</option>
                    <option value="16:9">16:9 (Yatay)</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                  Sahne Süresi (sn)
                  <input
                    type="number"
                    min={3}
                    max={10}
                    value={defaultDuration}
                    onChange={(e) => setDefaultDuration(Math.min(10, Math.max(3, Number(e.target.value) || 5)))}
                    className="h-8 rounded-lg border border-line bg-bg px-2 text-[12px] text-fg"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  type="text"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  placeholder="Video hedefi / konsepti (ör: Yeni sezon spor ayakkabı lansmanı)"
                  className="h-8 rounded-lg border border-line bg-bg px-2.5 text-[12px] text-fg placeholder:text-fg-passive"
                />
                <input
                  type="text"
                  value={musicStyle}
                  onChange={(e) => setMusicStyle(e.target.value)}
                  placeholder="Müzik tarzı (ör: modern enerjik elektronik)"
                  className="h-8 rounded-lg border border-line bg-bg px-2.5 text-[12px] text-fg placeholder:text-fg-passive"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={sbLoading || !selectedPhotos.length}
                  onClick={generateStoryboard}
                  className="rounded-xl border border-line bg-bg px-3 py-1.5 text-[12px] font-medium text-fg hover:border-fg/50 disabled:opacity-40"
                >
                  {sbLoading ? "Bedrock Storyboard Hazırlıyor…" : "1. Storyboard Oluştur & Düzenle"}
                </button>
                <button
                  type="button"
                  disabled={!selectedPhotos.length || (!!job && job.status !== "done" && job.status !== "failed")}
                  onClick={startPhotoToVideo}
                  className="rounded-xl bg-fg px-4 py-1.5 text-[12px] font-semibold text-bg hover:opacity-90 disabled:opacity-40"
                >
                  2. Videoyu Üret (fal.ai + FFmpeg)
                </button>
              </div>

              {storyboard ? (
                <div className="flex flex-col gap-2 rounded-xl border border-line bg-bg/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <input
                      type="text"
                      value={storyboard.title}
                      onChange={(e) => setStoryboard({ ...storyboard, title: e.target.value })}
                      className="h-7 flex-1 rounded-lg border border-line bg-surface px-2 text-[12px] font-semibold text-fg"
                    />
                    <span className="text-[11px] text-fg-muted">{storyboard.scenes.length} sahne</span>
                  </div>
                  <input
                    type="text"
                    value={storyboard.voiceoverScript}
                    onChange={(e) => setStoryboard({ ...storyboard, voiceoverScript: e.target.value })}
                    placeholder="Opsiyonel Türkçe dış ses metni…"
                    className="h-7 rounded-lg border border-line bg-surface px-2 text-[11px] text-fg"
                  />
                  <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
                    {storyboard.scenes.map((sc, idx) => (
                      <div key={idx} className="grid grid-cols-1 gap-1.5 rounded-lg border border-line bg-surface p-2 sm:grid-cols-[1fr_70px_100px]">
                        <input
                          type="text"
                          value={sc.motionPrompt}
                          onChange={(e) => {
                            const next = [...storyboard.scenes];
                            next[idx] = { ...sc, motionPrompt: e.target.value };
                            setStoryboard({ ...storyboard, scenes: next });
                          }}
                          className="h-7 rounded border border-line bg-bg px-2 text-[11px] text-fg"
                        />
                        <input
                          type="number"
                          min={3}
                          max={10}
                          value={sc.durationSec}
                          onChange={(e) => {
                            const next = [...storyboard.scenes];
                            next[idx] = { ...sc, durationSec: Math.min(10, Math.max(3, Number(e.target.value) || 5)) };
                            setStoryboard({ ...storyboard, scenes: next });
                          }}
                          className="h-7 rounded border border-line bg-bg px-2 text-[11px] text-fg"
                        />
                        <select
                          value={sc.transition}
                          onChange={(e) => {
                            const next = [...storyboard.scenes];
                            next[idx] = { ...sc, transition: e.target.value as TransitionType };
                            setStoryboard({ ...storyboard, scenes: next });
                          }}
                          className="h-7 rounded border border-line bg-bg px-1.5 text-[11px] text-fg"
                        >
                          <option value="fade">Fade</option>
                          <option value="dissolve">Dissolve</option>
                          <option value="wipeleft">Wipe</option>
                          <option value="slideleft">Slide</option>
                          <option value="cut">Cut</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-bg/50 p-3">
                <select
                  value={selectedVideoId}
                  onChange={(e) => {
                    setSelectedVideoId(e.target.value);
                    setPreviewUploadId(e.target.value);
                  }}
                  className="h-8 flex-1 rounded-lg border border-line bg-surface px-2 text-[12px] text-fg"
                >
                  <option value="">Video seçin…</option>
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>{v.name || v.id}</option>
                  ))}
                </select>
                <label className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium text-fg hover:border-fg/50">
                  {uploading ? uploading : "+ Video Yükle"}
                  <input
                    type="file"
                    accept="video/mp4,video/quicktime,video/webm"
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files?.length) void handleBulkUpload(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <textarea
                rows={3}
                value={editCommand}
                onChange={(e) => setEditCommand(e.target.value)}
                placeholder="Örn: daha hızlı kesim yap, enerjik müzik ekle, altyazı koy, 30 saniyeye indir, 9:16 dikey yap"
                className="w-full rounded-xl border border-line bg-bg p-2.5 text-[12px] text-fg placeholder:text-fg-passive"
              />

              <button
                type="button"
                disabled={!selectedVideoId || !editCommand.trim() || (!!job && job.status !== "done" && job.status !== "failed")}
                onClick={startAiEdit}
                className="self-start rounded-xl bg-fg px-4 py-1.5 text-[12px] font-semibold text-bg hover:opacity-90 disabled:opacity-40"
              >
                AI Edit Uygula (Bedrock + FFmpeg)
              </button>

              {job?.editPlan?.summary?.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {job.editPlan.summary.map((s, i) => (
                    <li key={i} className="rounded-full border border-line bg-bg px-2.5 py-0.5 text-[11px] text-fg-muted">
                      ✓ {s}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}

          {job ? (
            <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-bg/60 p-3">
              <div className="flex items-center justify-between text-[12px]">
                <span className="font-medium text-fg">{STATUS_LABEL[job.status]}</span>
                <span className="tabular-nums text-fg-muted">{job.progress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-line">
                <div className="h-full bg-fg transition-all duration-300" style={{ width: `${job.progress}%` }} />
              </div>
              {job.costUsd ? (
                <span className="text-[11px] text-fg-muted">
                  Tahmini maliyet: ${job.costUsd.toFixed(3)} {job.durationMs ? `· Süre: ${(job.durationMs / 1000).toFixed(1)} sn` : ""}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Sağ Önizleme, İndirme ve Versiyon Geçmişi */}
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-bg/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-fg">Önizleme & Versiyon Geçmişi</span>
            {previewUploadId ? (
              <a
                href={`/api/creative/file/${previewUploadId}`}
                download
                className="rounded-full bg-fg px-3 py-1 text-[11px] font-semibold text-bg hover:opacity-90"
              >
                İndir
              </a>
            ) : null}
          </div>

          {previewUploadId ? (
            <video src={`/api/creative/file/${previewUploadId}`} controls playsInline className="w-full max-h-80 rounded-xl bg-black" />
          ) : (
            <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-line text-[12px] text-fg-muted">
              Önizlenecek video yok
            </div>
          )}

          {versions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-fg-muted">Versiyon Geçmişi</span>
              <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto">
                {versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setPreviewUploadId(v.uploadId)}
                      className="truncate text-left text-fg hover:underline"
                    >
                      v{v.versionNumber} · {v.editCommand || "Sürüm"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRevert(v.id, v.uploadId)}
                      className="shrink-0 text-[10px] font-medium text-fg-muted hover:text-fg"
                    >
                      Geri Dön
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

