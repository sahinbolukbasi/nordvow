"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { uploadFile } from "@/lib/creative-upload";
import {
  formatTimecode,
  roundTicks,
  secondsToTicks,
  ticksToSeconds,
  type SupportedFps,
  type Ticks,
} from "@infulancer/core/creative/timeline-editor/time";
import {
  allTimelineElements,
  createEmptyTimeline,
  timelineTotalDurationTicks,
  type AspectPreset,
  type CaptionEl,
  type CtaEl,
  type StudioTimeline,
  type TextEl,
  type TextStyle,
  type TimelineElement,
} from "@infulancer/core/creative/timeline-editor/timeline-schema";
import {
  applyReframeToTimeline,
  applySilenceCutToTimeline,
  deleteElements,
  duplicateElements,
  insertElement,
  moveElement,
  resolveSnapTarget,
  splitAndDeleteSide,
  splitElementAtPlayhead,
  trimElement,
  type SilenceRange,
} from "@infulancer/core/creative/timeline-editor/ops";
import {
  captionStyleForPreset,
  parseSrt,
  serializeSrt,
  splitSegmentsIntoCaptions,
  type RawTranscriptSegment,
} from "@infulancer/core/creative/timeline-editor/captions";

export type EditorMediaAsset = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  durationSec?: number | null;
  source: string;
};

export type EditorCampaignOption = {
  id: string;
  name: string;
  brandName: string;
  deliverables: { id: string; label: string }[];
};

export type EditorModelOption = {
  key: string;
  label: string;
  kind: "image" | "video" | "audio";
  credits: number;
};

type ProjectSummary = {
  id: string;
  title: string;
  campaignId: string | null;
  deliverableId: string | null;
  templateId: string | null;
  revision: number;
  aspectPreset: AspectPreset;
  fps: SupportedFps;
  durationSec: number;
  updatedAt: string;
  lockedAt: string | null;
  submittedAssetId: string | null;
};

type ProjectFull = {
  id: string;
  title: string;
  campaignId: string | null;
  deliverableId: string | null;
  templateId: string | null;
  revision: number;
  timeline: StudioTimeline;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  submittedAssetId: string | null;
};

type TemplateInfo = {
  id: string;
  name: string;
  description: string;
  aspectPreset: AspectPreset;
  durationSec: number;
  category: string;
};

type VersionItem = {
  id: string;
  revision: number;
  label: string;
  createdAt: string;
};

type DrawerTab = "medya" | "ai_uret" | "altyazi" | "metin_ai" | "sablonlar" | "sessizlik";

const MAX_UNDO = 200;

function mediaUrl(assetId: string): string {
  return `/api/creative/file/${encodeURIComponent(assetId)}`;
}

function uid(prefix = "el"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

function defaultTransform() {
  return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
}

function backupStorageKey(projectId: string): string {
  return `nv_studio_backup_${projectId}`;
}

export function TimelineVideoEditor({
  mediaAssets: initialMediaAssets,
  models,
  campaigns,
  initialAssetId,
  currency,
}: {
  mediaAssets: EditorMediaAsset[];
  models: EditorModelOption[];
  campaigns: EditorCampaignOption[];
  initialAssetId?: string;
  currency: string;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [project, setProject] = useState<ProjectFull | null>(null);
  const [timeline, setTimeline] = useState<StudioTimeline>(() => createEmptyTimeline("9:16", 30));
  const [undoStack, setUndoStack] = useState<StudioTimeline[]>([]);
  const [redoStack, setRedoStack] = useState<StudioTimeline[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  const [mediaAssets, setMediaAssets] = useState<EditorMediaAsset[]>(initialMediaAssets);
  const [mediaQuery, setMediaQuery] = useState("");
  const [uploadPct, setUploadPct] = useState<number | null>(null);

  const [activeDrawer, setActiveDrawer] = useState<DrawerTab>("medya");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [zoomPxPerSec, setZoomPxPerSec] = useState(44);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [safeAreaVisible, setSafeAreaVisible] = useState(true);
  const [snapLineTicks, setSnapLineTicks] = useState<Ticks | null>(null);

  // Playback state (rAF + 10Hz-synced playhead + mutable ref for scrub smoothness)
  const playheadRef = useRef<Ticks>(0 as Ticks);
  const [playheadTicks, setPlayheadTicks] = useState<Ticks>(0 as Ticks);
  const [playing, setPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoPoolRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const imagePoolRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const audioPoolRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Persistence & conflict state
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty" | "offline" | "conflict">("saved");
  const [conflictInfo, setConflictInfo] = useState<{ currentRevision: number; updatedAt: string } | null>(null);
  const [offlineBackupBanner, setOfflineBackupBanner] = useState<{ revision: number; timeline: StudioTimeline } | null>(null);
  const [toast, setToast] = useState<{ tone: "info" | "warn" | "error" | "ok"; text: string } | null>(null);

  // Modals / Popovers
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aiEditCommand, setAiEditCommand] = useState("");
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newProjTitle, setNewProjTitle] = useState("");
  const [newProjAspect, setNewProjAspect] = useState<AspectPreset>("9:16");
  const [newProjTemplate, setNewProjTemplate] = useState<string>("");
  const [newProjCampaign, setNewProjCampaign] = useState<string>(campaigns[0]?.id ?? "");

  // Consent Modal (KVKK m.9 fal_transfer_v1)
  const [consentOpen, setConsentOpen] = useState(false);
  const pendingConsentActionRef = useRef<(() => Promise<void>) | null>(null);

  // Altyazı state
  const [captionPreset, setCaptionPreset] = useState<NonNullable<TextStyle["preset"]>>("bold-yellow");
  const [captionAssetId, setCaptionAssetId] = useState<string>(() => {
    const firstVid = initialMediaAssets.find((a) => a.kind === "video" || a.kind === "audio");
    return firstVid?.id ?? "";
  });
  const [transcribing, setTranscribing] = useState(false);
  const [lastTranscriptSegments, setLastTranscriptSegments] = useState<RawTranscriptSegment[]>([]);

  // Metin & AI Zekâsı (Bedrock)
  const [aiBrief, setAiBrief] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiHooks, setAiHooks] = useState<{ text: string; reason: string }[]>([]);
  const [aiScript, setAiScript] = useState<{ sections?: { part: string; sec: number; line: string }[] } | null>(null);
  const [aiHighlights, setAiHighlights] = useState<{ id: string; reason: string; suggestedTitle?: string }[]>([]);

  // AI Üret (fal) inside editor
  const [genModelKey, setGenModelKey] = useState<string>(() => models[0]?.key ?? "flux-schnell");
  const [genPrompt, setGenPrompt] = useState("");
  const [genSeconds, setGenSeconds] = useState<number>(5);
  const [genBusy, setGenBusy] = useState(false);
  const [genStatusText, setGenStatusText] = useState<string | null>(null);

  // Sessizlik Kes (Silence Cut)
  const [silenceAssetId, setSilenceAssetId] = useState<string>(() => {
    const firstVid = initialMediaAssets.find((a) => a.kind === "video");
    return firstVid?.id ?? "";
  });
  const [silenceDb, setSilenceDb] = useState(-35);
  const [silenceMinSec, setSilenceMinSec] = useState(0.4);
  const [silenceBusy, setSilenceBusy] = useState(false);
  const [detectedSilences, setDetectedSilences] = useState<SilenceRange[] | null>(null);
  const [silencePreviewSaved, setSilencePreviewSaved] = useState<number>(0);

  // Export & Campaign Submit
  const [exportQuality, setExportQuality] = useState<"draft" | "standard" | "high">("standard");
  const [exportBusy, setExportBusy] = useState(false);
  const [renderedOutput, setRenderedOutput] = useState<{
    uploadId: string;
    assetId: string;
    downloadUrl: string;
    durationSec: number;
    sizeBytes: number;
  } | null>(null);
  const [submitCampaignId, setSubmitCampaignId] = useState<string>(campaigns[0]?.id ?? "");
  const [submitDeliverableId, setSubmitDeliverableId] = useState<string>(campaigns[0]?.deliverables[0]?.id ?? "");
  const [submitBusy, setSubmitBusy] = useState(false);

  // Dragging transaction ref for undo batching
  const txSnapshotRef = useRef<StudioTimeline | null>(null);
  const timelineWrapRef = useRef<HTMLDivElement | null>(null);

  const notify = useCallback((tone: "info" | "warn" | "error" | "ok", text: string) => {
    setToast({ tone, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  const totalDurationTicks = useMemo(() => timelineTotalDurationTicks(timeline), [timeline]);
  const totalSec = Math.max(5, ticksToSeconds(totalDurationTicks));
  const selectedElement: TimelineElement | null = useMemo(() => {
    const id = selectedIds[0];
    if (!id) return null;
    return allTimelineElements(timeline).find((e) => e.id === id) ?? null;
  }, [selectedIds, timeline]);

  // Keep deliverable selector synced when campaign changes
  useEffect(() => {
    const camp = campaigns.find((c) => c.id === submitCampaignId);
    if (camp && !camp.deliverables.some((d) => d.id === submitDeliverableId)) {
      setSubmitDeliverableId(camp.deliverables[0]?.id ?? "");
    }
  }, [campaigns, submitCampaignId, submitDeliverableId]);

  const loadProjectById = useCallback(async (id: string) => {
    const res = await fetch(`/api/studio/projects/${encodeURIComponent(id)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Proje yüklenemedi.");
    const loaded = data.project as ProjectFull;
    setProject(loaded);
    setTimeline(loaded.timeline);
    setUndoStack([]);
    setRedoStack([]);
    setDirty(false);
    setSaveState("saved");
    setConflictInfo(null);
    setSelectedIds([]);
    playheadRef.current = 0 as Ticks;
    setPlayheadTicks(0 as Ticks);
    setRenderedOutput(null);

    try {
      const raw = localStorage.getItem(backupStorageKey(loaded.id));
      if (raw) {
        const parsed = JSON.parse(raw) as { revision: number; timeline: StudioTimeline };
        if (parsed && parsed.revision >= loaded.revision && parsed.timeline) {
          setOfflineBackupBanner({ revision: parsed.revision, timeline: parsed.timeline });
        } else {
          setOfflineBackupBanner(null);
        }
      } else {
        setOfflineBackupBanner(null);
      }
    } catch {
      setOfflineBackupBanner(null);
    }
  }, []);

  // Bootstrap projects & auto-create initial project (or open initialAssetId)
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/studio/projects", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Projeler alınamadı.");
        if (!active) return;
        setProjects(data.projects ?? []);
        setTemplates(data.templates ?? []);

        if (initialAssetId) {
          const createRes = await fetch("/api/studio/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              initialAssetId,
              aspectPreset: "9:16",
              campaignId: campaigns[0]?.id ?? null,
              deliverableId: campaigns[0]?.deliverables[0]?.id ?? null,
            }),
          });
          const created = await createRes.json();
          if (createRes.ok && created.project && active) {
            const p = created.project as ProjectFull;
            setProject(p);
            setTimeline(p.timeline);
            setProjects((prev) => [
              {
                id: p.id,
                title: p.title,
                campaignId: p.campaignId,
                deliverableId: p.deliverableId,
                templateId: p.templateId,
                revision: p.revision,
                aspectPreset: p.timeline.settings.aspectPreset,
                fps: p.timeline.settings.fps,
                durationSec: ticksToSeconds(timelineTotalDurationTicks(p.timeline)),
                updatedAt: p.updatedAt,
                lockedAt: p.lockedAt,
                submittedAssetId: p.submittedAssetId,
              },
              ...prev,
            ]);
            return;
          }
        }

        const first = (data.projects ?? [])[0] as ProjectSummary | undefined;
        if (first) {
          await loadProjectById(first.id);
        } else {
          const createRes = await fetch("/api/studio/projects", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: "İlk Video Kurgum", aspectPreset: "9:16" }),
          });
          const created = await createRes.json();
          if (createRes.ok && created.project && active) {
            const p = created.project as ProjectFull;
            setProject(p);
            setTimeline(p.timeline);
          }
        }
      } catch (err) {
        if (active) notify("error", err instanceof Error ? err.message : "Editör başlatılamadı.");
      } finally {
        if (active) setLoadingProjects(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [initialAssetId, loadProjectById, campaigns, notify]);

  // Apply timeline edit with undo stack & brand lock check
  const applyTimelineEdit = useCallback(
    (updater: (cur: StudioTimeline) => StudioTimeline, opts?: { skipHistory?: boolean }) => {
      if (project?.lockedAt) {
        notify("warn", "Bu proje teslim edildiği için kilitlidir; düzenlenemez.");
        return;
      }
      setTimeline((cur) => {
        const next = updater(cur);
        if (next === cur) return cur;
        if (!opts?.skipHistory) {
          setUndoStack((u) => [...u.slice(-(MAX_UNDO - 1)), cur]);
          setRedoStack([]);
        }
        setDirty(true);
        setSaveState("dirty");
        if (project) {
          try {
            localStorage.setItem(
              backupStorageKey(project.id),
              JSON.stringify({ revision: project.revision, timeline: next }),
            );
          } catch {
            // ignore quota errors
          }
        }
        return next;
      });
    },
    [project, notify],
  );

  const beginDragTransaction = useCallback(() => {
    setTimeline((cur) => {
      txSnapshotRef.current = cur;
      return cur;
    });
  }, []);

  const commitDragTransaction = useCallback(() => {
    const snap = txSnapshotRef.current;
    txSnapshotRef.current = null;
    if (!snap) return;
    setUndoStack((u) => [...u.slice(-(MAX_UNDO - 1)), snap]);
    setRedoStack([]);
  }, []);

  const handleUndo = useCallback(() => {
    if (project?.lockedAt) return;
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const prev = u[u.length - 1]!;
      setTimeline((cur) => {
        setRedoStack((r) => [...r.slice(-(MAX_UNDO - 1)), cur]);
        return prev;
      });
      setDirty(true);
      setSaveState("dirty");
      return u.slice(0, -1);
    });
  }, [project?.lockedAt]);

  const handleRedo = useCallback(() => {
    if (project?.lockedAt) return;
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1]!;
      setTimeline((cur) => {
        setUndoStack((u) => [...u.slice(-(MAX_UNDO - 1)), cur]);
        return next;
      });
      setDirty(true);
      setSaveState("dirty");
      return r.slice(0, -1);
    });
  }, [project?.lockedAt]);

  // Debounced autosave (1.5s) with optimistic revision lock & offline backup
  const saveNow = useCallback(
    async (opts?: { forceRevision?: number; label?: string; createSnapshot?: boolean }) => {
      if (!project || project.lockedAt) return;
      const rev = opts?.forceRevision ?? project.revision;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/timeline`, {
          method: "PUT",
          headers: { "content-type": "application/json", "If-Match": String(rev) },
          body: JSON.stringify({
            expectedRevision: rev,
            timeline,
            versionLabel: opts?.label,
            createSnapshot: opts?.createSnapshot,
          }),
        });
        const data = await res.json();
        if (res.status === 409) {
          setSaveState("conflict");
          setConflictInfo({
            currentRevision: data.details?.currentRevision ?? project.revision + 1,
            updatedAt: data.details?.updatedAt ?? new Date().toISOString(),
          });
          return;
        }
        if (!res.ok) {
          notify("error", data.error ?? "Kaydedilemedi.");
          setSaveState("dirty");
          return;
        }
        const updated = data.project as ProjectFull;
        setProject(updated);
        setDirty(false);
        setSaveState("saved");
        setConflictInfo(null);
        setProjects((prev) =>
          prev.map((p) =>
            p.id === updated.id
              ? {
                ...p,
                title: updated.title,
                revision: updated.revision,
                updatedAt: updated.updatedAt,
                aspectPreset: updated.timeline.settings.aspectPreset,
              }
              : p,
          ),
        );
        try {
          localStorage.removeItem(backupStorageKey(updated.id));
        } catch {
          // ignore
        }
      } catch {
        setSaveState("offline");
      }
    },
    [project, timeline, notify],
  );

  useEffect(() => {
    if (!dirty || !project || project.lockedAt || saveState === "conflict") return;
    const timer = setTimeout(() => {
      void saveNow();
    }, 1500);
    return () => clearTimeout(timer);
  }, [dirty, project, saveState, saveNow]);

  // Synchronize HTML media pool elements for Canvas2D preview & audio playback
  const allElements = useMemo(() => allTimelineElements(timeline), [timeline]);
  const referencedMediaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const el of allElements) {
      if ("assetId" in el && typeof el.assetId === "string") ids.add(el.assetId);
    }
    return [...ids];
  }, [allElements]);

  useEffect(() => {
    for (const id of referencedMediaIds) {
      const meta = mediaAssets.find((m) => m.id === id);
      const url = mediaUrl(id);
      if (meta?.kind === "image") {
        if (!imagePoolRef.current.has(id)) {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.src = url;
          imagePoolRef.current.set(id, img);
        }
      } else if (meta?.kind === "audio") {
        if (!audioPoolRef.current.has(id)) {
          const aud = new Audio(url);
          aud.preload = "auto";
          audioPoolRef.current.set(id, aud);
        }
      } else {
        if (!videoPoolRef.current.has(id)) {
          const vid = document.createElement("video");
          vid.crossOrigin = "anonymous";
          vid.preload = "auto";
          vid.playsInline = true;
          vid.src = url;
          videoPoolRef.current.set(id, vid);
        }
      }
    }
  }, [referencedMediaIds, mediaAssets]);

  // Pause HTML5 media when stopped
  useEffect(() => {
    if (!playing) {
      for (const v of videoPoolRef.current.values()) v.pause();
      for (const a of audioPoolRef.current.values()) a.pause();
    }
  }, [playing]);

  // Canvas2D composite renderer + 60fps playback rAF loop
  const drawFrameAt = useCallback(
    (ticks: Ticks, isPlaying: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = timeline.settings.canvas.width;
      const H = timeline.settings.canvas.height;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }

      // 1. Background
      ctx.fillStyle = timeline.settings.background.type === "color" ? timeline.settings.background.color : "#09090B";
      ctx.fillRect(0, 0, W, H);

      const drawMediaVisual = (el: TimelineElement) => {
        if (ticks < el.startTime || ticks >= el.startTime + el.duration) return;
        const speed = "speed" in el ? el.speed : 1;
        const srcSec = ticksToSeconds(el.trimStart) + ticksToSeconds(roundTicks(ticks - el.startTime)) * speed;

        ctx.save();
        ctx.globalAlpha = el.transform.opacity;
        const cx = W / 2 + el.transform.x * W;
        const cy = H / 2 + el.transform.y * H;
        ctx.translate(cx, cy);
        ctx.rotate((el.transform.rotation * Math.PI) / 180);
        ctx.scale(el.transform.scale, el.transform.scale);

        if (el.type === "image") {
          const img = imagePoolRef.current.get(el.assetId);
          if (img && img.complete && img.naturalWidth > 0) {
            const fit = Math.max(W / img.naturalWidth, H / img.naturalHeight);
            const dw = img.naturalWidth * fit;
            const dh = img.naturalHeight * fit;
            if (timeline.settings.background.type === "blur") {
              ctx.save();
              ctx.filter = `blur(${timeline.settings.background.intensity}px)`;
              ctx.drawImage(img, -W / 2, -H / 2, W, H);
              ctx.restore();
            }
            ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
          } else {
            ctx.fillStyle = "#1E293B";
            ctx.fillRect(-W / 2, -H / 2, W, H);
          }
        } else if (el.type === "video") {
          const vid = videoPoolRef.current.get(el.assetId);
          if (vid) {
            if (Math.abs(vid.currentTime - srcSec) > (isPlaying ? 0.25 : 0.04)) {
              vid.currentTime = Math.max(0, srcSec);
            }
            vid.muted = timeline.tracks.main.muted || !el.sourceAudio;
            vid.volume = Math.min(1, el.volume);
            vid.playbackRate = Math.min(4, Math.max(0.25, speed));
            if (isPlaying && vid.paused) void vid.play().catch(() => { });

            if (vid.readyState >= 2 && vid.videoWidth > 0) {
              const fit = Math.max(W / vid.videoWidth, H / vid.videoHeight);
              const dw = vid.videoWidth * fit;
              const dh = vid.videoHeight * fit;
              ctx.drawImage(vid, -dw / 2, -dh / 2, dw, dh);
            } else {
              ctx.fillStyle = "#111827";
              ctx.fillRect(-W / 2, -H / 2, W, H);
              ctx.fillStyle = "#94A3B8";
              ctx.font = "600 28px Inter, sans-serif";
              ctx.textAlign = "center";
              ctx.fillText(el.name, 0, 0);
            }
          }
        }
        ctx.restore();
      };

      // Pause videos not active right now
      const activeAssetIds = new Set<string>();
      for (const el of timeline.tracks.main.elements) {
        if (ticks >= el.startTime && ticks < el.startTime + el.duration) activeAssetIds.add(el.assetId);
      }
      if (!timeline.tracks.main.hidden) {
        for (const el of timeline.tracks.main.elements) drawMediaVisual(el);
      }

      for (const [vidId, vid] of videoPoolRef.current.entries()) {
        if (!activeAssetIds.has(vidId) && !vid.paused) vid.pause();
      }

      // Sync external audio tracks
      for (const aTrack of timeline.tracks.audio) {
        for (const aEl of aTrack.elements) {
          const aud = audioPoolRef.current.get(aEl.assetId);
          if (!aud) continue;
          const active = !aTrack.muted && isPlaying && ticks >= aEl.startTime && ticks < aEl.startTime + aEl.duration;
          if (active) {
            const srcSec = ticksToSeconds(aEl.trimStart) + ticksToSeconds(roundTicks(ticks - aEl.startTime)) * aEl.speed;
            if (Math.abs(aud.currentTime - srcSec) > 0.25) aud.currentTime = Math.max(0, srcSec);
            aud.volume = Math.min(1, aEl.volume);
            aud.playbackRate = Math.min(4, Math.max(0.25, aEl.speed));
            if (aud.paused) void aud.play().catch(() => { });
          } else if (!aud.paused) {
            aud.pause();
          }
        }
      }

      // 2. Overlay tracks (text, caption, logo, cta, shape)
      for (const tr of timeline.tracks.overlay) {
        if (tr.hidden) continue;
        for (const el of tr.elements) {
          if (ticks < el.startTime || ticks >= el.startTime + el.duration) continue;
          if (el.type === "video" || el.type === "image") {
            drawMediaVisual(el);
            continue;
          }

          ctx.save();
          ctx.globalAlpha = el.transform.opacity;
          const cx = W / 2 + el.transform.x * W;
          const cy = H / 2 + el.transform.y * H;
          ctx.translate(cx, cy);
          ctx.rotate((el.transform.rotation * Math.PI) / 180);
          ctx.scale(el.transform.scale, el.transform.scale);

          if (el.type === "text" || el.type === "caption") {
            const st = el.style;
            const font = `${st.fontWeight} ${st.fontSize}px ${st.fontFamily}, sans-serif`;
            ctx.font = font;
            ctx.textAlign = st.align;
            ctx.textBaseline = "middle";
            const maxW = W * st.maxWidth;
            const lines = el.text.split("\n");
            const lineH = st.fontSize * 1.24;
            const totalH = lines.length * lineH;
            lines.forEach((line, idx) => {
              const yOff = -totalH / 2 + idx * lineH + lineH / 2;
              if (st.background || st.preset === "box") {
                const metrics = ctx.measureText(line);
                const padX = 24;
                const padY = 12;
                const bw = Math.min(maxW, metrics.width) + padX * 2;
                const bh = lineH + padY;
                const bx = st.align === "left" ? -padX : st.align === "right" ? -bw + padX : -bw / 2;
                ctx.fillStyle = st.background ?? "rgba(9,9,11,0.82)";
                ctx.beginPath();
                ctx.roundRect(bx, yOff - bh / 2, bw, bh, 14);
                ctx.fill();
              }
              if (st.strokeWidth && st.strokeColor) {
                ctx.lineWidth = st.strokeWidth * 2;
                ctx.strokeStyle = st.strokeColor;
                ctx.lineJoin = "round";
                ctx.strokeText(line, 0, yOff, maxW);
              }
              ctx.fillStyle = st.color;
              ctx.fillText(line, 0, yOff, maxW);
            });
          } else if (el.type === "cta") {
            const label = el.label || "Şimdi Keşfet";
            ctx.font = "700 38px Montserrat, sans-serif";
            const textW = ctx.measureText(label).width;
            const bw = Math.min(W * 0.86, textW + 96);
            const bh = 104;
            ctx.fillStyle = el.style.bgColor;
            ctx.strokeStyle = el.style.accentColor;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.roundRect(-bw / 2, -bh / 2, bw, bh, el.style.borderRadius);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = el.style.textColor;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, 0, el.couponCode ? -12 : 0, bw - 32);
            if (el.couponCode) {
              ctx.font = "600 24px Inter, sans-serif";
              ctx.fillStyle = el.style.accentColor;
              ctx.fillText(`KUPON: ${el.couponCode}`, 0, 24, bw - 32);
            }
          } else if (el.type === "shape") {
            ctx.fillStyle = el.fill;
            ctx.beginPath();
            ctx.roundRect(-180, -60, 360, 120, el.shape === "pill" ? 60 : el.radius);
            ctx.fill();
          }

          if (selectedIds.includes(el.id)) {
            ctx.strokeStyle = el.lockedBy === "brand" ? "#F59E0B" : "#22D3EE";
            ctx.lineWidth = 3;
            ctx.setLineDash([8, 6]);
            ctx.strokeRect(-220, -64, 440, 128);
          }

          ctx.restore();
        }
      }
    },
    [timeline, selectedIds],
  );

  // Redraw when paused & state changes
  useEffect(() => {
    if (!playing) drawFrameAt(playheadTicks, false);
  }, [drawFrameAt, playheadTicks, playing]);

  // Playback loop (60fps canvas + ~15fps React ruler sync)
  useEffect(() => {
    if (!playing) return;
    let rafId = 0;
    let lastTs = performance.now();
    let lastSync = lastTs;

    const tick = (now: number) => {
      const dtSec = Math.min(0.1, (now - lastTs) / 1000);
      lastTs = now;
      const nextRaw = playheadRef.current + secondsToTicks(dtSec * playbackRate);
      if (nextRaw <= 0) {
        playheadRef.current = 0 as Ticks;
        setPlayheadTicks(0 as Ticks);
        setPlaying(false);
        return;
      }
      if (nextRaw >= totalDurationTicks) {
        playheadRef.current = 0 as Ticks;
        setPlayheadTicks(0 as Ticks);
        setPlaying(false);
        return;
      }
      playheadRef.current = roundTicks(nextRaw);
      drawFrameAt(playheadRef.current, true);
      if (now - lastSync > 60) {
        lastSync = now;
        setPlayheadTicks(playheadRef.current);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playing, playbackRate, totalDurationTicks, drawFrameAt]);

  const seekTo = useCallback(
    (t: Ticks) => {
      const clamped = roundTicks(Math.max(0, Math.min(totalDurationTicks, t)));
      playheadRef.current = clamped;
      setPlayheadTicks(clamped);
      drawFrameAt(clamped, playing);
    },
    [totalDurationTicks, drawFrameAt, playing],
  );

  // Keyboard shortcuts (disabled inside text inputs)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((s) => !s);
        return;
      }
      if (e.key === " ") {
        e.preventDefault();
        setPlaybackRate(1);
        setPlaying((p) => !p);
        return;
      }
      if (e.key === "j" || e.key === "J") {
        e.preventDefault();
        setPlaybackRate((r) => (playing && r < 0 ? -2 : -1));
        setPlaying(true);
        return;
      }
      if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        setPlaying(false);
        setPlaybackRate(1);
        return;
      }
      if (e.key === "l" || e.key === "L") {
        e.preventDefault();
        setPlaybackRate((r) => (playing && r > 0 ? Math.min(2, r + 1) : 1));
        setPlaying(true);
        return;
      }
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        applyTimelineEdit((cur) => splitElementAtPlayhead(cur, playheadRef.current, selectedIds));
        return;
      }
      if (e.key === "q" || e.key === "Q") {
        e.preventDefault();
        applyTimelineEdit((cur) => splitAndDeleteSide(cur, playheadRef.current, "left", selectedIds));
        return;
      }
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        applyTimelineEdit((cur) => splitAndDeleteSide(cur, playheadRef.current, "right", selectedIds));
        return;
      }
      if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        const at = playheadRef.current;
        applyTimelineEdit((cur) => ({
          ...cur,
          markers: [
            ...cur.markers,
            { id: uid("mk"), time: at, note: `İşaret ${formatTimecode(at, cur.settings.fps)}`, color: "#F59E0B" },
          ],
        }));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedIds.length === 0) return;
        e.preventDefault();
        if (selectedElement?.lockedBy === "brand") {
          notify("warn", "Marka tarafından kilitlenen katman silinemez.");
          return;
        }
        applyTimelineEdit((cur) => deleteElements(cur, selectedIds, { ripple: true }));
        setSelectedIds([]);
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        if (selectedIds.length === 0) return;
        e.preventDefault();
        applyTimelineEdit((cur) => duplicateElements(cur, selectedIds));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [playing, selectedIds, selectedElement, applyTimelineEdit, handleUndo, handleRedo, notify]);

  // Add media asset to timeline
  const addMediaToTimeline = (asset: EditorMediaAsset) => {
    const startAt =
      asset.kind === "audio"
        ? playheadRef.current
        : timeline.tracks.main.elements.reduce((max, e) => Math.max(max, e.startTime + e.duration), 0);
    const durSec = asset.kind === "image" ? 4 : Math.min(Math.max(asset.durationSec ?? 6, 1), 60);
    const durTicks = secondsToTicks(durSec);
    const newId = uid(asset.kind === "audio" ? "aud" : asset.kind === "image" ? "img" : "vid");
    applyTimelineEdit((cur) =>
      insertElement(
        cur,
        asset.kind === "audio"
          ? {
            id: newId,
            type: "audio",
            name: asset.name.slice(0, 80),
            assetId: asset.id,
            startTime: roundTicks(startAt),
            duration: durTicks,
            trimStart: 0 as Ticks,
            trimEnd: 0 as Ticks,
            sourceDuration: durTicks,
            transform: defaultTransform(),
            volume: 0.85,
            speed: 1,
          }
          : asset.kind === "image"
            ? {
              id: newId,
              type: "image",
              name: asset.name.slice(0, 80),
              assetId: asset.id,
              startTime: roundTicks(startAt),
              duration: durTicks,
              trimStart: 0 as Ticks,
              trimEnd: 0 as Ticks,
              transform: defaultTransform(),
            }
            : {
              id: newId,
              type: "video",
              name: asset.name.slice(0, 80),
              assetId: asset.id,
              startTime: roundTicks(startAt),
              duration: durTicks,
              trimStart: 0 as Ticks,
              trimEnd: 0 as Ticks,
              sourceDuration: durTicks,
              transform: defaultTransform(),
              volume: 1,
              sourceAudio: true,
              speed: 1,
            },
      ),
    );
    setSelectedIds([newId]);
    notify("ok", `"${asset.name}" zaman çizelgesine eklendi.`);
  };

  // Upload raw file directly into library + timeline
  const handleDirectUpload = async (file: File) => {
    try {
      setUploadPct(5);
      const uploaded = await uploadFile(file, {
        name: file.name,
        mime: file.type,
        onProgress: (p) => setUploadPct(p),
      });
      const item: EditorMediaAsset = {
        id: uploaded.id,
        kind: uploaded.kind,
        name: file.name,
        durationSec: uploaded.kind === "video" ? 8 : 4,
        source: "upload",
      };
      setMediaAssets((prev) => [item, ...prev]);
      addMediaToTimeline(item);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Yükleme başarısız.");
    } finally {
      setUploadPct(null);
    }
  };

  const acceptConsentAndRetry = async () => {
    try {
      const res = await fetch("/api/studio/consent", { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "Onay kaydedilemedi.");
      }
      setConsentOpen(false);
      const pending = pendingConsentActionRef.current;
      pendingConsentActionRef.current = null;
      if (pending) await pending();
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "KVKK onayı kaydedilemedi.");
    }
  };

  const runTranscribe = async () => {
    const targetAssetId =
      captionAssetId ||
      (selectedElement && "assetId" in selectedElement ? selectedElement.assetId : undefined) ||
      timeline.tracks.main.elements[0]?.assetId;
    if (!targetAssetId) {
      notify("warn", "Altyazı çıkarmak için zaman çizelgesinde veya seçicide bir medya seçin.");
      return;
    }

    const execute = async () => {
      setTranscribing(true);
      try {
        const res = await fetch("/api/studio/ai/transcribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assetId: targetAssetId, language: "tr", fixWithLlm: true }),
        });
        const data = await res.json();
        if (res.status === 428 && data.code === "CONSENT_REQUIRED") {
          pendingConsentActionRef.current = execute;
          setConsentOpen(true);
          return;
        }
        if (!res.ok) throw new Error(data.error ?? "Altyazı oluşturulamadı.");

        const segs = (data.segments ?? []) as RawTranscriptSegment[];
        setLastTranscriptSegments(segs);
        const captions = splitSegmentsIntoCaptions(segs, {
          wordsPerCaption: 3,
          minDurationSec: 0.8,
          preset: captionPreset,
        });
        applyTimelineEdit((cur) => {
          let next = cur;
          for (const cap of captions) {
            next = insertElement(next, cap, { targetTrackId: "overlay-t1" });
          }
          return next;
        });
        notify("ok", `${captions.length} adet Türkçe altyazı parçası zaman çizelgesine eklendi.`);
      } catch (err) {
        notify("error", err instanceof Error ? err.message : "Altyazı hatası.");
      } finally {
        setTranscribing(false);
      }
    };
    await execute();
  };

  const applyPresetToAllCaptions = (preset: NonNullable<TextStyle["preset"]>) => {
    setCaptionPreset(preset);
    const style = captionStyleForPreset(preset);
    applyTimelineEdit((cur) => {
      const next = structuredClone(cur);
      for (const tr of next.tracks.overlay) {
        if (tr.type !== "text") continue;
        for (const el of tr.elements) {
          if (el.type === "caption" && !el.locked) {
            el.style = { ...style };
          }
        }
      }
      return next;
    });
  };

  const exportSrtFile = () => {
    const captions = allElements.filter((e): e is CaptionEl => e.type === "caption");
    if (captions.length === 0) {
      notify("warn", "Dışa aktarılacak altyazı katmanı bulunamadı.");
      return;
    }
    const content = "\uFEFF" + serializeSrt(captions);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(project?.title || "altyazi").replace(/\s+/g, "_")}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSrtFile = async (file: File) => {
    const txt = await file.text();
    const segs = parseSrt(txt);
    if (segs.length === 0) {
      notify("error", "Geçerli .srt bloğu bulunamadı.");
      return;
    }
    setLastTranscriptSegments(segs);
    const captions = splitSegmentsIntoCaptions(segs, { preset: captionPreset });
    applyTimelineEdit((cur) => {
      let next = cur;
      for (const cap of captions) next = insertElement(next, cap, { targetTrackId: "overlay-t1" });
      return next;
    });
    notify("ok", `${captions.length} altyazı içe aktarıldı.`);
  };

  const addTextOverlay = (textValue = "Yeni Başlık ✨", preset: NonNullable<TextStyle["preset"]> = "classic", atStart = false) => {
    const id = uid("txt");
    const el: TextEl = {
      id,
      type: "text",
      name: textValue.slice(0, 32),
      startTime: atStart ? (0 as Ticks) : playheadRef.current,
      duration: secondsToTicks(3),
      trimStart: 0 as Ticks,
      trimEnd: 0 as Ticks,
      transform: { x: 0, y: -0.18, scale: 1, rotation: 0, opacity: 1 },
      text: textValue,
      style: captionStyleForPreset(preset),
    };
    applyTimelineEdit((cur) => insertElement(cur, el, { targetTrackId: "overlay-t2" }));
    setSelectedIds([id]);
  };

  const addCtaCard = () => {
    const id = uid("cta");
    const el: CtaEl = {
      id,
      type: "cta",
      name: "Kupon / CTA Kartı",
      startTime: playheadRef.current,
      duration: secondsToTicks(4),
      trimStart: 0 as Ticks,
      trimEnd: 0 as Ticks,
      transform: { x: 0, y: 0.24, scale: 1, rotation: 0, opacity: 1 },
      label: "Şimdi Keşfet",
      couponCode: "NORD15",
      style: { bgColor: "#111827", textColor: "#FFFFFF", accentColor: "#FF2BD6", borderRadius: 24 },
    };
    applyTimelineEdit((cur) => insertElement(cur, el, { targetTrackId: "overlay-g1" }));
    setSelectedIds([id]);
  };

  const runBedrock = async (mode: "hooks" | "script" | "highlights") => {
    setAiLoading(true);
    try {
      const segmentsForHighlights =
        lastTranscriptSegments.length > 0
          ? lastTranscriptSegments
          : allElements
            .filter((e): e is CaptionEl => e.type === "caption")
            .map((c) => ({
              id: c.id,
              startSec: ticksToSeconds(c.startTime),
              endSec: ticksToSeconds(c.startTime + c.duration),
              text: c.text,
            }));
      const res = await fetch("/api/studio/ai/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode,
          brief: aiBrief || project?.title || "Ürün tanıtım videosu",
          durationSec: Math.round(totalSec),
          segments: mode === "highlights" ? segmentsForHighlights : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "AI önerisi alınamadı.");
      if (mode === "hooks") setAiHooks(data.result?.hooks ?? []);
      if (mode === "script") setAiScript(data.result ?? null);
      if (mode === "highlights") setAiHighlights(data.result?.highlights ?? []);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Bedrock asistan hatası.");
    } finally {
      setAiLoading(false);
    }
  };

  const runFalGenerate = async () => {
    if (!genPrompt.trim()) {
      notify("warn", "Üretim için kısa bir prompt yazın.");
      return;
    }
    const execute = async () => {
      setGenBusy(true);
      setGenStatusText("fal.ai kuyruğuna gönderiliyor...");
      try {
        const res = await fetch("/api/studio/ai/assist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "generate",
            modelKey: genModelKey,
            prompt: genPrompt.trim(),
            aspect: timeline.settings.aspectPreset === "custom" ? "9:16" : timeline.settings.aspectPreset,
            seconds: genSeconds,
          }),
        });
        const data = await res.json();
        if (res.status === 428 && data.code === "CONSENT_REQUIRED") {
          pendingConsentActionRef.current = execute;
          setConsentOpen(true);
          return;
        }
        if (!res.ok) throw new Error(data.error ?? "Üretim başlatılamadı.");

        const jobId = data.job?.id as string | undefined;
        if (!jobId) throw new Error("İş kimliği alınamadı.");
        setGenStatusText("Üretiliyor...");

        for (let attempt = 0; attempt < 90; attempt++) {
          await new Promise((r) => setTimeout(r, 2000));
          const poll = await fetch(`/api/creative/job/${encodeURIComponent(jobId)}`, { cache: "no-store" });
          const pj = await poll.json();
          if (pj.failed) throw new Error(pj.chainError ?? "Üretim başarısız oldu (kredi iade edildi).");
          if (pj.done && pj.finalAssetId) {
            const selectedModel = models.find((m) => m.key === genModelKey);
            const item: EditorMediaAsset = {
              id: pj.finalAssetId,
              kind: selectedModel?.kind === "video" ? "video" : "image",
              name: `AI: ${genPrompt.trim().slice(0, 40)}`,
              durationSec: selectedModel?.kind === "video" ? genSeconds : 4,
              source: "ai",
            };
            setMediaAssets((prev) => [item, ...prev]);
            addMediaToTimeline(item);
            setGenStatusText("Hazır ve timeline'a eklendi!");
            return;
          }
        }
        setGenStatusText("Üretim arka planda devam ediyor; tamamlanınca Kitaplık'tan ekleyebilirsiniz.");
      } catch (err) {
        notify("error", err instanceof Error ? err.message : "AI üretim hatası.");
        setGenStatusText(null);
      } finally {
        setGenBusy(false);
      }
    };
    await execute();
  };

  const scanSilence = async () => {
    const targetAssetId = silenceAssetId || timeline.tracks.main.elements.find((e) => e.type === "video")?.assetId;
    if (!targetAssetId) {
      notify("warn", "Sessizlik taraması için ana kanalda bir video bulunmalı.");
      return;
    }
    setSilenceBusy(true);
    try {
      const res = await fetch("/api/studio/tools/silence-detect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          assetId: targetAssetId,
          thresholdDb: silenceDb,
          minSilenceSec: silenceMinSec,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sessizlik taraması başarısız.");
      const silences = (data.silences ?? []) as SilenceRange[];
      setDetectedSilences(silences);
      const cutTotal = data.keepIntervals?.[0]?.cutSec ?? silences.reduce((s, r) => s + (r.endSec - r.startSec), 0);
      setSilencePreviewSaved(Number(cutTotal.toFixed(2)));
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Sessizlik tarama hatası.");
    } finally {
      setSilenceBusy(false);
    }
  };

  const applyOneClickSilenceCut = () => {
    if (!detectedSilences || detectedSilences.length === 0) return;
    const vidEl =
      selectedElement?.type === "video"
        ? selectedElement
        : timeline.tracks.main.elements.find((e) => e.type === "video" && (!silenceAssetId || e.assetId === silenceAssetId));
    if (!vidEl) {
      notify("warn", "Sessizlik uygulanacak ana video klibi bulunamadı.");
      return;
    }
    let saved = 0;
    applyTimelineEdit((cur) => {
      const r = applySilenceCutToTimeline(cur, vidEl.id, detectedSilences, 0.12);
      saved = r.savedSeconds;
      return r.timeline;
    });
    notify("ok", `${saved.toFixed(2)} sn sessizlik tek adımda kesildi.`);
    setDetectedSilences(null);
  };

  const createNewProject = async (opts?: { templateId?: string }) => {
    try {
      const res = await fetch("/api/studio/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: newProjTitle.trim() || undefined,
          aspectPreset: newProjAspect,
          templateId: opts?.templateId ?? (newProjTemplate || null),
          campaignId: newProjCampaign || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Proje oluşturulamadı.");
      const created = data.project as ProjectFull;
      setProject(created);
      setTimeline(created.timeline);
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setSaveState("saved");
      setProjects((prev) => [
        {
          id: created.id,
          title: created.title,
          campaignId: created.campaignId,
          deliverableId: created.deliverableId,
          templateId: created.templateId,
          revision: created.revision,
          aspectPreset: created.timeline.settings.aspectPreset,
          fps: created.timeline.settings.fps,
          durationSec: ticksToSeconds(timelineTotalDurationTicks(created.timeline)),
          updatedAt: created.updatedAt,
          lockedAt: created.lockedAt,
          submittedAssetId: created.submittedAssetId,
        },
        ...prev,
      ]);
      setShowNewProjectModal(false);
      setNewProjTitle("");
      notify("ok", "Yeni video projesi açıldı.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Proje oluşturulamadı.");
    }
  };

  const openVersionDrawer = async () => {
    if (!project) return;
    setShowVersions(true);
    const res = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/versions`, { cache: "no-store" });
    const data = await res.json();
    if (res.ok) setVersions(data.versions ?? []);
  };

  const restoreVersion = async (versionId: string) => {
    if (!project) return;
    const res = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/versions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versionId }),
    });
    const data = await res.json();
    if (!res.ok) {
      notify("error", data.error ?? "Sürüm geri yüklenemedi.");
      return;
    }
    const updated = data.project as ProjectFull;
    setProject(updated);
    setTimeline(updated.timeline);
    setDirty(false);
    setSaveState("saved");
    setShowVersions(false);
    notify("ok", "Seçilen sürüme geri dönüldü.");
  };

  const runRenderExport = async () => {
    if (!project) return;
    if (dirty) await saveNow();
    setExportBusy(true);
    try {
      const res = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quality: exportQuality,
          label: project.title,
          timeline,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Video render başarısız.");
      setRenderedOutput(data.render);
      notify("ok", "MP4 dışa aktarıldı ve Kitaplığa kaydedildi!");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Render hatası.");
    } finally {
      setExportBusy(false);
    }
  };

  const submitToCampaign = async () => {
    if (!project || !renderedOutput) return;
    setSubmitBusy(true);
    try {
      const res = await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}/render`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          uploadId: renderedOutput.uploadId,
          campaignId: submitCampaignId || null,
          deliverableId: submitDeliverableId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Teslim gönderilemedi.");
      setProject((p) =>
        p ? { ...p, lockedAt: data.submitted.lockedAt, submittedAssetId: data.submitted.assetId } : p,
      );
      notify("ok", "Video kampanya taslağı olarak gönderildi ve proje kilitlendi.");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Teslimat gönderilemedi.");
    } finally {
      setSubmitBusy(false);
    }
  };

  // Timeline drag/trim interactions
  const startClipDrag = (e: React.PointerEvent, el: TimelineElement, mode: "move" | "trim-start" | "trim-end") => {
    e.stopPropagation();
    setSelectedIds([el.id]);
    if (el.locked) {
      if (el.lockedBy === "brand") notify("warn", "Bu katman marka tarafından zorunlu tutuldu; taşınamaz.");
      return;
    }
    const startX = e.clientX;
    const origStart = el.startTime;
    beginDragTransaction();
    let lastDeltaTicks = 0;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const deltaTicks = secondsToTicks(dx / zoomPxPerSec);
      if (mode === "move") {
        let targetStart = roundTicks(Math.max(0, origStart + deltaTicks));
        if (snapEnabled) {
          const snapped = resolveSnapTarget(timeline, targetStart, playheadRef.current, zoomPxPerSec, [el.id]);
          if (snapped !== null) {
            targetStart = snapped;
            setSnapLineTicks(snapped);
          } else {
            setSnapLineTicks(null);
          }
        }
        applyTimelineEdit((cur) => moveElement(cur, el.id, targetStart), { skipHistory: true });
      } else {
        const diff = deltaTicks - lastDeltaTicks;
        lastDeltaTicks = deltaTicks;
        applyTimelineEdit(
          (cur) => trimElement(cur, el.id, mode === "trim-start" ? "start" : "end", diff),
          { skipHistory: true },
        );
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSnapLineTicks(null);
      commitDragTransaction();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Canvas stage pointer drag for selected overlay element
  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!selectedElement || selectedElement.type === "audio" || selectedElement.locked) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origTx = selectedElement.transform.x;
    const origTy = selectedElement.transform.y;
    beginDragTransaction();

    const onMove = (ev: PointerEvent) => {
      const dxNorm = (ev.clientX - startX) / Math.max(1, rect.width);
      const dyNorm = (ev.clientY - startY) / Math.max(1, rect.height);
      applyTimelineEdit(
        (cur) => {
          const next = structuredClone(cur);
          for (const tr of next.tracks.overlay) {
            const target = tr.elements.find((item) => item.id === selectedElement.id);
            if (target && !target.locked) {
              target.transform.x = Number(Math.max(-1, Math.min(1, origTx + dxNorm)).toFixed(3));
              target.transform.y = Number(Math.max(-1, Math.min(1, origTy + dyNorm)).toFixed(3));
            }
          }
          return next;
        },
        { skipHistory: true },
      );
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      commitDragTransaction();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const updateSelectedProp = (mutator: (el: TimelineElement) => void) => {
    if (!selectedElement) return;
    if (selectedElement.locked) {
      notify("warn", "Kilitli öğe değiştirilemez.");
      return;
    }
    applyTimelineEdit((cur) => {
      const next = structuredClone(cur);
      for (const el of next.tracks.main.elements) {
        if (el.id === selectedElement.id) mutator(el);
      }
      for (const tr of next.tracks.overlay) {
        for (const el of tr.elements) {
          if (el.id === selectedElement.id) mutator(el);
        }
      }
      for (const tr of next.tracks.audio) {
        for (const el of tr.elements) {
          if (el.id === selectedElement.id) mutator(el);
        }
      }
      return next;
    });
  };

  const filteredMedia = useMemo(() => {
    const q = mediaQuery.trim().toLowerCase();
    if (!q) return mediaAssets;
    return mediaAssets.filter((m) => m.name.toLowerCase().includes(q));
  }, [mediaAssets, mediaQuery]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  const handleAiEditCommand = async () => {
    const cmd = aiEditCommand.trim();
    if (!cmd) return;
    const lower = cmd.toLocaleLowerCase("tr-TR");
    if (lower.includes("9:16") || lower.includes("dikey") || lower.includes("reels") || lower.includes("tiktok")) {
      applyTimelineEdit((cur) => applyReframeToTimeline(cur, "9:16", "blur"));
      notify("ok", "AI: Video 9:16 dikey Reels formatına uyarlandı.");
      setAiEditCommand("");
      return;
    }
    if (lower.includes("16:9") || lower.includes("yatay") || lower.includes("youtube")) {
      applyTimelineEdit((cur) => applyReframeToTimeline(cur, "16:9", "blur"));
      notify("ok", "AI: Video 16:9 yatay formata uyarlandı.");
      setAiEditCommand("");
      return;
    }
    if (lower.includes("1:1") || lower.includes("kare")) {
      applyTimelineEdit((cur) => applyReframeToTimeline(cur, "1:1", "blur"));
      notify("ok", "AI: Video 1:1 kare formata uyarlandı.");
      setAiEditCommand("");
      return;
    }
    if (lower.includes("sessiz") || lower.includes("boşluk")) {
      setActiveDrawer("sessizlik");
      notify("info", "AI Sessizlik Kes paneli açıldı; tek tıkla boşlukları temizleyebilirsiniz.");
      setAiEditCommand("");
      return;
    }
    if (lower.includes("altyazı") || lower.includes("alt yazı") || lower.includes("caption")) {
      setActiveDrawer("altyazi");
      notify("info", "AI Türkçe Otomatik Altyazı paneli açıldı.");
      setAiEditCommand("");
      return;
    }
    if (lower.includes("kanca") || lower.includes("hook") || lower.includes("başlık") || lower.includes("senaryo") || lower.includes("metin")) {
      setActiveDrawer("metin_ai");
      setAiBrief(cmd);
      setAiEditCommand("");
      await runBedrock("hooks");
      return;
    }
    setActiveDrawer("ai_uret");
    setGenPrompt(cmd);
    setAiEditCommand("");
    notify("info", "AI Sahne Üret paneli komutunuzla hazırlandı — 'Üret' ile sahneyi oluşturabilirsiniz.");
  };

  if (loadingProjects && !project) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-2xl border border-line bg-surface text-sm text-fg-muted">
        Video Editörü yükleniyor…
      </div>
    );
  }

  const timelineWidthPx = Math.max(820, Math.ceil(totalSec * zoomPxPerSec) + 160);
  const playheadX = ticksToSeconds(playheadTicks) * zoomPxPerSec;

  return (
    <div
      className={
        isFullscreen
          ? "fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-canvas text-fg"
          : "flex min-h-[780px] flex-col overflow-hidden rounded-2xl border border-line bg-canvas text-fg"
      }
    >
      {/* Üst Başlık Çubuğu */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Aktif Proje"
            value={project?.id ?? ""}
            onChange={(e) => e.target.value && void loadProjectById(e.target.value)}
            className="h-8 max-w-[180px] rounded-lg border border-line bg-bg px-2 text-xs text-fg"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} {p.lockedAt ? "🔒" : ""}
              </option>
            ))}
          </select>

          <input
            aria-label="Proje Başlığı"
            value={project?.title ?? ""}
            disabled={Boolean(project?.lockedAt)}
            onChange={(e) => {
              const title = e.target.value;
              setProject((p) => (p ? { ...p, title } : p));
            }}
            onBlur={async () => {
              if (!project || project.lockedAt) return;
              await fetch(`/api/studio/projects/${encodeURIComponent(project.id)}`, {
                method: "PATCH",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title: project.title }),
              });
            }}
            className="h-8 w-44 rounded-lg border border-line bg-bg px-2.5 text-xs font-medium text-fg focus:border-cyan-400 focus:outline-none disabled:opacity-60"
          />

          <button
            type="button"
            onClick={() => setShowNewProjectModal(true)}
            className="h-8 rounded-lg border border-line bg-bg px-2.5 text-xs font-medium hover:bg-surface-hover"
          >
            + Yeni Proje
          </button>

          {project?.lockedAt ? (
            <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
              🔒 Teslim Edildi · Kilitli
            </span>
          ) : null}
        </div>

        {/* En-Boy Oranı, Reframe, Geri/İleri, Kayıt Durumu, Dışa Aktar */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center overflow-hidden rounded-lg border border-line bg-bg text-[11px]">
            {(["9:16", "4:5", "1:1", "16:9"] as const).map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => applyTimelineEdit((cur) => applyReframeToTimeline(cur, ratio, "blur"))}
                className={`px-2 py-1 font-medium transition ${timeline.settings.aspectPreset === ratio ? "bg-cyan-500 text-slate-950" : "text-fg-muted hover:bg-surface-hover"
                  }`}
              >
                {ratio}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Geri Al (Cmd/Ctrl+Z)"
            className="h-8 rounded-lg border border-line px-2 text-xs hover:bg-surface-hover disabled:opacity-35"
          >
            ↶ Geri
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="İleri Al (Cmd/Ctrl+Shift+Z)"
            className="h-8 rounded-lg border border-line px-2 text-xs hover:bg-surface-hover disabled:opacity-35"
          >
            ↷ İleri
          </button>

          <button
            type="button"
            onClick={() => void saveNow({ createSnapshot: true })}
            className={`h-8 rounded-lg border px-2.5 text-[11px] font-medium ${saveState === "conflict"
                ? "border-red-400/50 bg-red-500/20 text-red-200"
                : saveState === "saving"
                  ? "border-cyan-400/40 bg-cyan-500/15 text-cyan-200"
                  : saveState === "dirty" || saveState === "offline"
                    ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
                    : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
              }`}
          >
            {saveState === "saving"
              ? "Kaydediliyor…"
              : saveState === "conflict"
                ? "Çakışma!"
                : saveState === "offline"
                  ? "Çevrimdışı Yedek"
                  : saveState === "dirty"
                    ? "Kaydet ●"
                    : `Kaydedildi · v${project?.revision ?? 1}`}
          </button>

          <button
            type="button"
            onClick={() => void openVersionDrawer()}
            className="h-8 rounded-lg border border-line px-2.5 text-xs hover:bg-surface-hover"
          >
            Sürümler
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            className="h-8 rounded-lg border border-line bg-bg px-2.5 text-xs font-medium text-fg hover:bg-surface-hover"
          >
            {isFullscreen ? "Tam Ekrandan Çık" : "Tam Ekran"}
          </button>

          <button
            type="button"
            onClick={() => setShowExportModal(true)}
            className="h-8 rounded-lg bg-fg px-3 text-xs font-semibold text-bg hover:opacity-90"
          >
            Dışa Aktar
          </button>
        </div>
      </header>

      {/* Sade AI Video Edit Komut Çubuğu */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-2 text-xs">
        <span className="font-semibold text-fg">AI Video Edit</span>
        <input
          value={aiEditCommand}
          onChange={(e) => setAiEditCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleAiEditCommand();
            }
          }}
          placeholder="AI'ya ne yapmasını istediğini yaz (ör. '9:16 Reels yap', 'Türkçe altyazı ekle', 'Kanca başlık öner', 'Sessizlikleri kes' veya yeni sahne prompt'u)..."
          className="h-8 min-w-[260px] flex-1 rounded-lg border border-line bg-surface px-3 text-xs text-fg placeholder:text-fg-muted focus:border-fg focus:outline-none"
        />
        <button
          type="button"
          onClick={() => void handleAiEditCommand()}
          className="h-8 rounded-lg bg-fg px-3 text-xs font-semibold text-bg hover:opacity-90"
        >
          AI ile Uygula
        </button>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveDrawer("ai_uret")}
            className="h-7 rounded-md border border-line bg-surface px-2 text-[11px] text-fg-muted hover:text-fg"
          >
            AI Sahne
          </button>
          <button
            type="button"
            onClick={() => setActiveDrawer("altyazi")}
            className="h-7 rounded-md border border-line bg-surface px-2 text-[11px] text-fg-muted hover:text-fg"
          >
            AI Altyazı
          </button>
          <button
            type="button"
            onClick={() => setActiveDrawer("metin_ai")}
            className="h-7 rounded-md border border-line bg-surface px-2 text-[11px] text-fg-muted hover:text-fg"
          >
            AI Kanca
          </button>
          <button
            type="button"
            onClick={() => setActiveDrawer("sessizlik")}
            className="h-7 rounded-md border border-line bg-surface px-2 text-[11px] text-fg-muted hover:text-fg"
          >
            Sessizlik Kes
          </button>
        </div>
      </div>

      {/* Çevrimdışı Yedek Banner */}
      {offlineBackupBanner ? (
        <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          <span>Bu tarayıcıda henüz sunucuya gönderilmemiş yerel yedek bulundu.</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setTimeline(offlineBackupBanner.timeline);
                setDirty(true);
                setOfflineBackupBanner(null);
              }}
              className="rounded-md bg-amber-400 px-2.5 py-1 font-semibold text-slate-950"
            >
              Yedeği Geri Yükle
            </button>
            <button
              type="button"
              onClick={() => {
                if (project) localStorage.removeItem(backupStorageKey(project.id));
                setOfflineBackupBanner(null);
              }}
              className="text-fg-muted hover:underline"
            >
              Yoksay
            </button>
          </div>
        </div>
      ) : null}

      {/* Bildirim Toast */}
      {toast ? (
        <div
          role="status"
          className={`border-b px-4 py-1.5 text-xs font-medium ${toast.tone === "error"
              ? "border-red-500/30 bg-red-500/15 text-red-200"
              : toast.tone === "warn"
                ? "border-amber-500/30 bg-amber-500/15 text-amber-200"
                : toast.tone === "ok"
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
                  : "border-cyan-500/30 bg-cyan-500/15 text-cyan-200"
            }`}
        >
          {toast.text}
        </div>
      ) : null}

      {/* Orta Çalışma Alanı: Sol Çekmece (290px) + Merkez Sahne + Sağ Özellikler (280px) */}
      <div className="grid min-h-[430px] flex-1 grid-cols-1 lg:grid-cols-[320px_1fr_280px]">
        {/* Sol Araç Paneli + 6 Çekmece */}
        <aside className="flex border-b border-line bg-surface lg:border-b-0 lg:border-r">
          <nav aria-label="Editör Araçları" className="flex w-20 shrink-0 flex-col gap-1 border-r border-line bg-bg p-1.5">
            {(
              [
                { id: "ai_uret", label: "AI Üret" },
                { id: "medya", label: "Medya" },
                { id: "altyazi", label: "Altyazı" },
                { id: "metin_ai", label: "AI Metin" },
                { id: "sessizlik", label: "Sessizlik" },
                { id: "sablonlar", label: "Şablon" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveDrawer(t.id)}
                className={`rounded-lg px-2 py-2 text-left text-[11px] font-medium transition ${activeDrawer === t.id ? "bg-fg text-bg" : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                  }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="flex max-h-[440px] flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
            {activeDrawer === "medya" ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-fg">Kitaplık & Yükle</span>
                  <label className="cursor-pointer rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-950 hover:opacity-90">
                    + Dosya Yükle
                    <input
                      type="file"
                      accept="video/*,image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleDirectUpload(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
                {uploadPct !== null ? (
                  <div className="rounded-lg bg-bg p-2 text-[11px] text-cyan-300">Yükleniyor: %{uploadPct}</div>
                ) : null}
                <input
                  value={mediaQuery}
                  onChange={(e) => setMediaQuery(e.target.value)}
                  placeholder="Medya ara..."
                  className="h-8 rounded-lg border border-line bg-bg px-2.5 text-xs text-fg placeholder:text-fg-passive"
                />
                <ul className="flex flex-col gap-1.5">
                  {filteredMedia.length === 0 ? (
                    <li className="py-4 text-center text-fg-passive">Kitaplıkta eşleşen medya yok.</li>
                  ) : null}
                  {filteredMedia.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg p-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-fg">{m.name}</p>
                        <p className="text-[10px] text-fg-muted">
                          {m.kind.toUpperCase()} {m.durationSec ? `· ${m.durationSec.toFixed(1)}s` : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addMediaToTimeline(m)}
                        className="shrink-0 rounded-lg border border-cyan-400/40 bg-cyan-500/15 px-2 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-500/25"
                      >
                        + Ekle
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {activeDrawer === "ai_uret" ? (
              <>
                <span className="font-semibold text-fg">AI Sahne / Görsel Üret (fal.ai)</span>
                <select
                  value={genModelKey}
                  onChange={(e) => setGenModelKey(e.target.value)}
                  className="h-8 rounded-lg border border-line bg-bg px-2 text-xs text-fg"
                >
                  {models
                    .filter((m) => m.kind !== "audio")
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label} ({m.credits} {currency})
                      </option>
                    ))}
                </select>
                {models.find((m) => m.key === genModelKey)?.kind === "video" ? (
                  <label className="flex items-center justify-between text-[11px] text-fg-muted">
                    <span>Süre (sn):</span>
                    <select
                      value={genSeconds}
                      onChange={(e) => setGenSeconds(Number(e.target.value))}
                      className="h-7 rounded border border-line bg-bg px-2 text-xs"
                    >
                      <option value={5}>5 sn</option>
                      <option value={6}>6 sn</option>
                      <option value={10}>10 sn</option>
                    </select>
                  </label>
                ) : null}
                <textarea
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  rows={4}
                  placeholder="Örn: Stüdyo ışığında elinde cilt serumu şişesi tutan içerik üreticisi, 9:16 dikey sinematik çekim"
                  className="rounded-lg border border-line bg-bg p-2 text-xs text-fg placeholder:text-fg-passive"
                />
                <button
                  type="button"
                  disabled={genBusy}
                  onClick={() => void runFalGenerate()}
                  className="h-9 rounded-xl bg-cyan-500 font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-50"
                >
                  {genBusy ? "Üretiliyor..." : "Üret & Timeline'a Ekle"}
                </button>
                {genStatusText ? <p className="text-[11px] text-cyan-300">{genStatusText}</p> : null}
              </>
            ) : null}

            {activeDrawer === "altyazi" ? (
              <>
                <span className="font-semibold text-fg">Türkçe Otomatik Altyazı</span>
                <p className="text-[11px] text-fg-muted">
                  fal Wizper ile sesi çözer; AWS Bedrock Türkçe yazımı düzeltir. (Max 3 kelime · ≥0.8 sn)
                </p>
                <select
                  value={captionAssetId}
                  onChange={(e) => setCaptionAssetId(e.target.value)}
                  className="h-8 rounded-lg border border-line bg-bg px-2 text-xs text-fg"
                >
                  <option value="">Ana kanal videosu</option>
                  {mediaAssets
                    .filter((m) => m.kind === "video" || m.kind === "audio")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={transcribing}
                  onClick={() => void runTranscribe()}
                  className="h-9 rounded-xl bg-gradient-to-r from-cyan-400 to-indigo-400 font-bold text-slate-950 disabled:opacity-50"
                >
                  {transcribing ? "Ses Çözümleniyor..." : "Otomatik Altyazı Oluştur"}
                </button>

                <div className="mt-1 flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-fg-muted">Stil Şablonu (Tüm Altyazılar)</span>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(
                      [
                        { id: "classic", label: "Klasik Beyaz" },
                        { id: "bold-yellow", label: "Sarı Kalın" },
                        { id: "karaoke", label: "Karaoke" },
                        { id: "box", label: "Siyah Kutu" },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => applyPresetToAllCaptions(p.id)}
                        className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium ${captionPreset === p.id
                            ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                            : "border-line bg-bg text-fg-muted hover:bg-surface-hover"
                          }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-2 flex gap-2 border-t border-line pt-2">
                  <button
                    type="button"
                    onClick={exportSrtFile}
                    className="flex-1 rounded-lg border border-line py-1.5 text-[11px] hover:bg-surface-hover"
                  >
                    .SRT İndir
                  </button>
                  <label className="flex-1 cursor-pointer rounded-lg border border-line py-1.5 text-center text-[11px] hover:bg-surface-hover">
                    .SRT Yükle
                    <input
                      type="file"
                      accept=".srt,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void importSrtFile(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              </>
            ) : null}

            {activeDrawer === "metin_ai" ? (
              <>
                <span className="font-semibold text-fg">Metin, CTA & Bedrock Zekâsı</span>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => addTextOverlay("Yeni Başlık ✨", "bold-yellow")}
                    className="rounded-lg border border-line bg-bg py-1.5 text-[11px] font-medium hover:bg-surface-hover"
                  >
                    + Metin Ekle
                  </button>
                  <button
                    type="button"
                    onClick={addCtaCard}
                    className="rounded-lg border border-fuchsia-400/40 bg-fuchsia-500/15 py-1.5 text-[11px] font-medium text-fuchsia-200 hover:bg-fuchsia-500/25"
                  >
                    + CTA Kartı
                  </button>
                </div>

                <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
                  <input
                    value={aiBrief}
                    onChange={(e) => setAiBrief(e.target.value)}
                    placeholder="Ürün / Kampanya özeti (opsiyonel)"
                    className="h-8 rounded-lg border border-line bg-bg px-2 text-xs text-fg"
                  />
                  <div className="grid grid-cols-3 gap-1">
                    <button
                      type="button"
                      disabled={aiLoading}
                      onClick={() => void runBedrock("hooks")}
                      className="rounded-lg bg-white px-2 py-1.5 text-[11px] font-bold text-slate-950 disabled:opacity-50"
                    >
                      5 Hook
                    </button>
                    <button
                      type="button"
                      disabled={aiLoading}
                      onClick={() => void runBedrock("script")}
                      className="rounded-lg border border-line px-2 py-1.5 text-[11px] font-medium hover:bg-surface-hover"
                    >
                      Senaryo
                    </button>
                    <button
                      type="button"
                      disabled={aiLoading}
                      onClick={() => void runBedrock("highlights")}
                      className="rounded-lg border border-line px-2 py-1.5 text-[11px] font-medium hover:bg-surface-hover"
                    >
                      Highlight
                    </button>
                  </div>

                  {aiHooks.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {aiHooks.map((h, i) => (
                        <li key={i} className="rounded-lg border border-line bg-bg p-2">
                          <p className="font-semibold text-amber-300">{h.text}</p>
                          <p className="mt-0.5 text-[10px] text-fg-muted">{h.reason}</p>
                          <button
                            type="button"
                            onClick={() => addTextOverlay(h.text, "bold-yellow", true)}
                            className="mt-1.5 rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-200 hover:bg-cyan-500/30"
                          >
                            + 00:00 Hook Ekle
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {aiScript?.sections?.length ? (
                    <ul className="flex flex-col gap-1.5">
                      {aiScript.sections.map((s, i) => (
                        <li key={i} className="rounded-lg border border-line bg-bg p-2">
                          <p className="font-semibold text-cyan-300">
                            {s.part} ({s.sec} sn)
                          </p>
                          <p className="mt-0.5 text-[11px] text-fg">{s.line}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {aiHighlights.length > 0 ? (
                    <ul className="flex flex-col gap-1.5">
                      {aiHighlights.map((hl, i) => (
                        <li key={i} className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-2">
                          <p className="font-semibold text-emerald-200">{hl.suggestedTitle || hl.id}</p>
                          <p className="text-[10px] text-fg-muted">{hl.reason}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </>
            ) : null}

            {activeDrawer === "sablonlar" ? (
              <>
                <span className="font-semibold text-fg">Kampanya Şablonları</span>
                <p className="text-[11px] text-fg-muted">
                  Her şablon zorunlu kilitli <span className="text-amber-300">#reklam</span> rozeti ve kampanya kupon/UTM kartıyla başlar.
                </p>
                <ul className="flex flex-col gap-2">
                  {templates.map((t) => (
                    <li key={t.id} className="rounded-xl border border-line bg-bg p-2.5">
                      <p className="font-semibold text-fg">{t.name}</p>
                      <p className="mt-1 text-[11px] text-fg-muted">{t.description}</p>
                      <button
                        type="button"
                        onClick={() => {
                          setNewProjTemplate(t.id);
                          setNewProjAspect(t.aspectPreset);
                          void createNewProject({ templateId: t.id });
                        }}
                        className="mt-2 w-full rounded-lg bg-surface-hover py-1.5 text-[11px] font-semibold text-fg hover:bg-surface-hover"
                      >
                        Bu Şablonla Proje Aç
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {activeDrawer === "sessizlik" ? (
              <>
                <span className="font-semibold text-fg">Otomatik Sessizlik Kes</span>
                <p className="text-[11px] text-fg-muted">
                  FFmpeg sesi tarar, konuşma aralarındaki duraksamaları algılar ve tek Geri Al adımında kırpar.
                </p>
                <select
                  value={silenceAssetId}
                  onChange={(e) => setSilenceAssetId(e.target.value)}
                  className="h-8 rounded-lg border border-line bg-bg px-2 text-xs text-fg"
                >
                  <option value="">Ana video klibi</option>
                  {mediaAssets
                    .filter((m) => m.kind === "video")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                  <span>Sessizlik Eşiği: {silenceDb} dB</span>
                  <input
                    type="range"
                    min={-50}
                    max={-18}
                    step={1}
                    value={silenceDb}
                    onChange={(e) => setSilenceDb(Number(e.target.value))}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                  <span>En Kısa Duraksama: {silenceMinSec} sn</span>
                  <input
                    type="range"
                    min={0.25}
                    max={1.5}
                    step={0.05}
                    value={silenceMinSec}
                    onChange={(e) => setSilenceMinSec(Number(e.target.value))}
                  />
                </label>
                <button
                  type="button"
                  disabled={silenceBusy}
                  onClick={() => void scanSilence()}
                  className="h-9 rounded-xl bg-white font-semibold text-slate-950 disabled:opacity-50"
                >
                  {silenceBusy ? "Taranıyor..." : "Sessizlikleri Tara"}
                </button>
                {detectedSilences ? (
                  <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-2.5 text-[11px]">
                    <p className="font-semibold text-emerald-200">
                      {detectedSilences.length} sessiz aralık bulundu (~{silencePreviewSaved} sn kazanım)
                    </p>
                    <button
                      type="button"
                      onClick={applyOneClickSilenceCut}
                      className="mt-2 w-full rounded-lg bg-emerald-400 py-1.5 font-bold text-slate-950 hover:bg-emerald-300"
                    >
                      Tek Tıkla Sessizlikleri Kes
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </aside>

        {/* Merkez Canvas2D Önizleme Sahnesi */}
        <section className="relative flex flex-col items-center justify-center bg-bg p-4">
          <div className="mb-2 flex w-full max-w-[420px] items-center justify-between text-[11px] text-fg-muted">
            <span>
              {timeline.settings.canvas.width}×{timeline.settings.canvas.height} · {timeline.settings.fps} fps
            </span>
            <button
              type="button"
              onClick={() => setSafeAreaVisible((v) => !v)}
              className={`rounded-md border px-2 py-0.5 ${safeAreaVisible ? "border-cyan-400/50 text-cyan-300" : "border-line text-fg-muted"
                }`}
            >
              {safeAreaVisible ? "Güvenli Alan Açık" : "Güvenli Alan Kapalı"}
            </button>
          </div>

          <div
            className="relative flex items-center justify-center overflow-hidden rounded-xl border border-line bg-black shadow-2xl"
            style={{
              aspectRatio: `${timeline.settings.canvas.width} / ${timeline.settings.canvas.height}`,
              maxHeight: "360px",
              maxWidth: "100%",
            }}
          >
            <canvas
              ref={canvasRef}
              onPointerDown={onCanvasPointerDown}
              className="h-full w-full cursor-move object-contain"
            />
            {safeAreaVisible ? (
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-x-0 top-0 h-[14%] border-b border-dashed border-amber-400/50 bg-amber-500/5" />
                <div className="absolute inset-x-0 bottom-0 h-[24%] border-t border-dashed border-amber-400/50 bg-amber-500/5" />
                <div className="absolute inset-y-[16%] right-0 w-[15%] border-l border-dashed border-amber-400/40 bg-amber-500/5" />
              </div>
            ) : null}
          </div>
        </section>

        {/* Sağ Özellik Denetleyicisi */}
        <aside className="flex max-h-[440px] flex-col gap-3 overflow-y-auto border-t border-line bg-surface p-3 text-xs lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-fg">Özellikler</span>
            {selectedElement ? (
              <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] uppercase text-fg-muted">
                {selectedElement.type}
              </span>
            ) : null}
          </div>

          {!selectedElement ? (
            <p className="py-6 text-center text-[11px] text-fg-passive">
              Düzenlemek için zaman çizelgesinden veya sahneden bir klip ya da katman seçin.
            </p>
          ) : (
            <>
              {selectedElement.lockedBy === "brand" ? (
                <div className="rounded-xl border border-amber-400/40 bg-amber-500/15 p-2.5 text-[11px] text-amber-200">
                  🔒 Bu katman marka tarafından zorunlu tutuldu; kilidi açılamaz, taşınamaz veya silinemez.
                </div>
              ) : null}

              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => applyTimelineEdit((c) => splitElementAtPlayhead(c, playheadRef.current, [selectedElement.id]))}
                  disabled={selectedElement.locked}
                  className="flex-1 rounded-lg border border-line py-1 text-[11px] hover:bg-surface-hover disabled:opacity-40"
                >
                  Böl (S)
                </button>
                <button
                  type="button"
                  onClick={() => applyTimelineEdit((c) => duplicateElements(c, [selectedElement.id]))}
                  className="flex-1 rounded-lg border border-line py-1 text-[11px] hover:bg-surface-hover"
                >
                  Çoğalt
                </button>
                <button
                  type="button"
                  disabled={selectedElement.locked}
                  onClick={() => {
                    applyTimelineEdit((c) => deleteElements(c, [selectedElement.id], { ripple: true }));
                    setSelectedIds([]);
                  }}
                  className="flex-1 rounded-lg border border-red-400/40 py-1 text-[11px] text-red-300 hover:bg-red-500/15 disabled:opacity-40"
                >
                  Sil
                </button>
              </div>

              {(selectedElement.type === "text" || selectedElement.type === "caption") && (
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                    <span>Metin</span>
                    <textarea
                      rows={3}
                      disabled={selectedElement.locked}
                      value={selectedElement.text}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateSelectedProp((el) => {
                          if (el.type === "text" || el.type === "caption") el.text = v;
                        });
                      }}
                      className="rounded-lg border border-line bg-bg p-2 text-xs text-fg disabled:opacity-60"
                    />
                  </label>
                  <label className="flex items-center justify-between text-[11px] text-fg-muted">
                    <span>Yazı Boyutu: {selectedElement.style.fontSize}px</span>
                    <input
                      type="range"
                      min={20}
                      max={110}
                      disabled={selectedElement.locked}
                      value={selectedElement.style.fontSize}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        updateSelectedProp((el) => {
                          if (el.type === "text" || el.type === "caption") el.style.fontSize = val;
                        });
                      }}
                    />
                  </label>
                </div>
              )}

              {selectedElement.type === "cta" && (
                <div className="flex flex-col gap-2">
                  <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                    <span>CTA Başlığı</span>
                    <input
                      disabled={selectedElement.locked}
                      value={selectedElement.label}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateSelectedProp((el) => {
                          if (el.type === "cta") el.label = v;
                        });
                      }}
                      className="h-8 rounded-lg border border-line bg-bg px-2 text-xs text-fg"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                    <span>Kupon Kodu</span>
                    <input
                      disabled={selectedElement.locked}
                      value={selectedElement.couponCode ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        updateSelectedProp((el) => {
                          if (el.type === "cta") el.couponCode = v;
                        });
                      }}
                      className="h-8 rounded-lg border border-line bg-bg px-2 text-xs text-fg"
                    />
                  </label>
                </div>
              )}

              {(selectedElement.type === "video" || selectedElement.type === "audio") && (
                <div className="flex flex-col gap-2">
                  <label className="flex items-center justify-between text-[11px] text-fg-muted">
                    <span>Hız ({selectedElement.speed}x)</span>
                    <select
                      disabled={selectedElement.locked}
                      value={selectedElement.speed}
                      onChange={(e) => {
                        const sp = Number(e.target.value);
                        updateSelectedProp((el) => {
                          if (el.type === "video" || el.type === "audio") el.speed = sp;
                        });
                      }}
                      className="h-7 rounded border border-line bg-bg px-2 text-xs text-fg"
                    >
                      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
                        <option key={s} value={s}>
                          {s}x
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                    <span>Ses Seviyesi: {Math.round(selectedElement.volume * 100)}%</span>
                    <input
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      disabled={selectedElement.locked}
                      value={selectedElement.volume}
                      onChange={(e) => {
                        const vol = Number(e.target.value);
                        updateSelectedProp((el) => {
                          if (el.type === "video" || el.type === "audio") el.volume = vol;
                        });
                      }}
                    />
                  </label>
                </div>
              )}

              {selectedElement.type !== "audio" && (
                <div className="flex flex-col gap-2 border-t border-line pt-2">
                  <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                    <span>Ölçek: {selectedElement.transform.scale.toFixed(2)}×</span>
                    <input
                      type="range"
                      min={0.25}
                      max={2.5}
                      step={0.05}
                      disabled={selectedElement.locked}
                      value={selectedElement.transform.scale}
                      onChange={(e) => {
                        const sc = Number(e.target.value);
                        updateSelectedProp((el) => {
                          el.transform.scale = sc;
                        });
                      }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-fg-muted">
                    <span>Opaklık: {Math.round(selectedElement.transform.opacity * 100)}%</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      disabled={selectedElement.locked}
                      value={selectedElement.transform.opacity}
                      onChange={(e) => {
                        const op = Number(e.target.value);
                        updateSelectedProp((el) => {
                          el.transform.opacity = op;
                        });
                      }}
                    />
                  </label>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      {/* Alt Çok Kanallı Zaman Çizelgesi */}
      <section className="flex flex-col border-t border-line bg-surface">
        {/* Transport & Edit Araç Çubuğu */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-bg px-3 py-1.5 text-xs">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => applyTimelineEdit((c) => splitElementAtPlayhead(c, playheadRef.current, selectedIds))}
              title="Böl (S)"
              className="rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface-hover"
            >
              ✂ Böl (S)
            </button>
            <button
              type="button"
              onClick={() => applyTimelineEdit((c) => splitAndDeleteSide(c, playheadRef.current, "left", selectedIds))}
              title="Sol Kısmı Kes (Q)"
              className="rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface-hover"
            >
              ↤ Sol (Q)
            </button>
            <button
              type="button"
              onClick={() => applyTimelineEdit((c) => splitAndDeleteSide(c, playheadRef.current, "right", selectedIds))}
              title="Sağ Kısmı Kes (W)"
              className="rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface-hover"
            >
              ↦ Sağ (W)
            </button>
            <button
              type="button"
              onClick={() =>
                applyTimelineEdit((cur) => ({
                  ...cur,
                  markers: [
                    ...cur.markers,
                    { id: uid("mk"), time: playheadRef.current, note: "İşaret", color: "#F59E0B" },
                  ],
                }))
              }
              title="İşaret Koy (M)"
              className="rounded-md border border-line px-2 py-1 text-[11px] hover:bg-surface-hover"
            >
              🚩 (M)
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => seekTo(0 as Ticks)}
              className="rounded px-1.5 py-0.5 text-fg-muted hover:text-fg"
            >
              ⏮
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaybackRate(1);
                setPlaying((p) => !p);
              }}
              className="h-7 rounded-full bg-white px-4 text-xs font-bold text-slate-950 hover:opacity-90"
            >
              {playing ? "⏸ Duraklat" : "▶ Oynat"}
            </button>
            <span className="font-mono text-xs tabular-nums text-cyan-300">
              {formatTimecode(playheadTicks, timeline.settings.fps)} /{" "}
              {formatTimecode(totalDurationTicks, timeline.settings.fps)}
            </span>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setSnapEnabled((s) => !s)}
              className={`rounded-md border px-2 py-0.5 ${snapEnabled ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-200" : "border-line text-fg-muted"
                }`}
            >
              🧲 Mıknatıs {snapEnabled ? "Açık" : "Kapalı"}
            </button>
            <span className="text-fg-muted">Yakınlaştır:</span>
            <input
              type="range"
              min={16}
              max={140}
              value={zoomPxPerSec}
              onChange={(e) => setZoomPxPerSec(Number(e.target.value))}
              className="w-24"
            />
          </div>
        </div>

        {/* Kaydırılabilir Kanallar + Cetvel */}
        <div
          ref={timelineWrapRef}
          className="relative flex overflow-x-auto"
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              setZoomPxPerSec((z) => Math.max(16, Math.min(140, z - Math.sign(e.deltaY) * 8)));
            }
          }}
        >
          {/* Sol Kanal Başlıkları */}
          <div className="sticky left-0 z-20 flex w-36 shrink-0 flex-col border-r border-line bg-surface">
            <div className="flex h-7 items-center border-b border-line px-2 text-[10px] font-medium text-fg-passive">
              ZAMAN CETVELİ
            </div>
            {[
              ...timeline.tracks.overlay.map((tr) => ({ id: tr.id, name: tr.name, kind: tr.type })),
              { id: timeline.tracks.main.id, name: timeline.tracks.main.name, kind: "video" },
              ...timeline.tracks.audio.map((tr) => ({ id: tr.id, name: tr.name, kind: "audio" })),
            ].map((row) => (
              <div key={row.id} className="flex h-12 items-center border-b border-line px-2.5 text-[11px] font-medium text-fg-muted">
                <span className="truncate">{row.name}</span>
              </div>
            ))}
          </div>

          {/* Sağ Timeline Şeridi */}
          <div className="relative" style={{ width: `${timelineWidthPx}px` }}>
            {/* Zaman Cetveli + Scrub */}
            <div
              onPointerDown={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const updateAt = (clientX: number) => {
                  const sec = Math.max(0, (clientX - rect.left) / zoomPxPerSec);
                  seekTo(secondsToTicks(sec));
                };
                updateAt(e.clientX);
                const onMove = (ev: PointerEvent) => updateAt(ev.clientX);
                const onUp = () => {
                  window.removeEventListener("pointermove", onMove);
                  window.removeEventListener("pointerup", onUp);
                };
                window.addEventListener("pointermove", onMove);
                window.addEventListener("pointerup", onUp);
              }}
              className="relative h-7 cursor-ew-resize border-b border-line bg-[#101218] select-none"
            >
              {Array.from({ length: Math.ceil(totalSec) + 2 }).map((_, s) => (
                <div
                  key={s}
                  className="absolute top-0 flex h-full flex-col justify-end border-l border-line pl-1 text-[9px] text-fg-passive"
                  style={{ left: `${s * zoomPxPerSec}px` }}
                >
                  {s}s
                </div>
              ))}
              {timeline.markers.map((m) => (
                <div
                  key={m.id}
                  title={m.note}
                  className="absolute top-1 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-amber-400"
                  style={{ left: `${ticksToSeconds(m.time) * zoomPxPerSec}px` }}
                />
              ))}
            </div>

            {/* Overlay Kanalları */}
            {timeline.tracks.overlay.map((tr) => (
              <TrackLane
                key={tr.id}
                elements={tr.elements}
                zoomPxPerSec={zoomPxPerSec}
                selectedIds={selectedIds}
                onSelect={(id) => setSelectedIds([id])}
                onStartDrag={startClipDrag}
                colorClass={tr.type === "graphic" ? "bg-fuchsia-500/25 border-fuchsia-400/60" : "bg-amber-500/25 border-amber-400/60"}
              />
            ))}

            {/* Ana Video Kanalı (V1) */}
            <TrackLane
              elements={timeline.tracks.main.elements}
              zoomPxPerSec={zoomPxPerSec}
              selectedIds={selectedIds}
              onSelect={(id) => setSelectedIds([id])}
              onStartDrag={startClipDrag}
              colorClass="bg-cyan-500/25 border-cyan-400/60"
            />

            {/* Ses Kanalları (A1+) */}
            {timeline.tracks.audio.map((tr) => (
              <TrackLane
                key={tr.id}
                elements={tr.elements}
                zoomPxPerSec={zoomPxPerSec}
                selectedIds={selectedIds}
                onSelect={(id) => setSelectedIds([id])}
                onStartDrag={startClipDrag}
                colorClass="bg-emerald-500/25 border-emerald-400/60"
              />
            ))}

            {/* 8px Mıknatıs Çizgisi */}
            {snapLineTicks !== null ? (
              <div
                className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-yellow-300 shadow-[0_0_8px_rgba(253,224,71,0.9)]"
                style={{ left: `${ticksToSeconds(snapLineTicks) * zoomPxPerSec}px` }}
              />
            ) : null}

            {/* Playhead Çizgisi */}
            <div
              className="pointer-events-none absolute inset-y-0 z-30 w-0.5 bg-cyan-300"
              style={{ left: `${playheadX}px` }}
            >
              <div className="h-3 w-3 -translate-x-[5px] rounded-b-full bg-cyan-300" />
            </div>
          </div>
        </div>
      </section>

      {/* Klavye Kısayolları Modal (?) */}
      {showShortcuts ? (
        <ModalDialog title="Klavye Kısayolları" onClose={() => setShowShortcuts(false)}>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              ["Space / K", "Oynat / Duraklat"],
              ["J / L", "Geri Sar / Hızlı İleri (1x, 2x)"],
              ["S", "Playhead Konumundan Böl"],
              ["Q / W", "Solu / Sağı Kes (Ripple)"],
              ["Delete / Backspace", "Seçili Öğeyi Sil"],
              ["Cmd/Ctrl + Z", "Geri Al (200 adım)"],
              ["Cmd/Ctrl + Shift + Z", "İleri Al"],
              ["Cmd/Ctrl + D", "Seçili Öğeyi Çoğalt"],
              ["M", "İşaret Noktası Ekle"],
              ["?", "Kısayollar Yardımı"],
            ].map(([k, d]) => (
              <div key={k} className="flex items-center justify-between rounded-lg border border-line bg-bg px-2.5 py-1.5">
                <span className="text-fg-muted">{d}</span>
                <kbd className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-cyan-200">{k}</kbd>
              </div>
            ))}
          </div>
        </ModalDialog>
      ) : null}

      {/* Yeni Proje / Şablon Modal */}
      {showNewProjectModal ? (
        <ModalDialog title="Yeni Video Projesi" onClose={() => setShowNewProjectModal(false)}>
          <div className="flex flex-col gap-3 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Proje Adı</span>
              <input
                value={newProjTitle}
                onChange={(e) => setNewProjTitle(e.target.value)}
                placeholder="Örn: Bahar Koleksiyonu Reels"
                className="h-9 rounded-lg border border-line bg-bg px-3 text-fg"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Oran</span>
              <select
                value={newProjAspect}
                onChange={(e) => setNewProjAspect(e.target.value as AspectPreset)}
                className="h-9 rounded-lg border border-line bg-bg px-2 text-fg"
              >
                <option value="9:16">9:16 Dikey (Reels / TikTok / Shorts)</option>
                <option value="4:5">4:5 Instagram Feed</option>
                <option value="1:1">1:1 Kare</option>
                <option value="16:9">16:9 Yatay (YouTube)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Şablon (opsiyonel)</span>
              <select
                value={newProjTemplate}
                onChange={(e) => setNewProjTemplate(e.target.value)}
                className="h-9 rounded-lg border border-line bg-bg px-2 text-fg"
              >
                <option value="">Boş Zaman Çizelgesi</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {campaigns.length > 0 ? (
              <label className="flex flex-col gap-1">
                <span className="text-fg-muted">Kampanya Bağlantısı (#reklam & UTM için)</span>
                <select
                  value={newProjCampaign}
                  onChange={(e) => setNewProjCampaign(e.target.value)}
                  className="h-9 rounded-lg border border-line bg-bg px-2 text-fg"
                >
                  <option value="">Seçili değil</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.brandName} · {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <button
              type="button"
              onClick={() => void createNewProject()}
              className="mt-1 h-9 rounded-xl bg-cyan-500 font-bold text-slate-950 hover:bg-cyan-400"
            >
              Projeyi Oluştur
            </button>
          </div>
        </ModalDialog>
      ) : null}

      {/* Sürüm Geçmişi Modal */}
      {showVersions ? (
        <ModalDialog title="Sürüm Geçmişi (Son 30)" onClose={() => setShowVersions(false)}>
          <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto text-xs">
            {versions.length === 0 ? <li className="py-4 text-center text-fg-passive">Sürüm kaydı yok.</li> : null}
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-line bg-bg px-3 py-2"
              >
                <div>
                  <p className="font-semibold text-fg">
                    v{v.revision} · {v.label}
                  </p>
                  <p className="text-[10px] text-fg-muted">{new Date(v.createdAt).toLocaleString("tr-TR")}</p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(project?.lockedAt)}
                  onClick={() => void restoreVersion(v.id)}
                  className="rounded-lg border border-cyan-400/40 px-2.5 py-1 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-40"
                >
                  Geri Dön
                </button>
              </li>
            ))}
          </ul>
        </ModalDialog>
      ) : null}

      {/* 409 Çakışma Çözüm Modal */}
      {conflictInfo && project ? (
        <ModalDialog title="Eşzamanlı Güncelleme Çakışması" onClose={() => setConflictInfo(null)}>
          <p className="text-xs text-fg-muted">
            Bu proje başka bir oturumda güncellenmiş (Sunucu Revizyon #{conflictInfo.currentRevision}). Hangisini korumak istersiniz?
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <button
              type="button"
              onClick={() => void loadProjectById(project.id)}
              className="flex-1 rounded-xl border border-line bg-surface-hover py-2 font-semibold text-fg"
            >
              Sunucu Sürümünü Yükle
            </button>
            <button
              type="button"
              onClick={() => void saveNow({ forceRevision: conflictInfo.currentRevision, label: "Çakışma Üzerine Yazıldı" })}
              className="flex-1 rounded-xl bg-amber-400 py-2 font-bold text-slate-950"
            >
              Değişikliklerimi Koru
            </button>
          </div>
        </ModalDialog>
      ) : null}

      {/* KVKK m.9 Yurt Dışı Aktarım Açık Rıza Modal (fal_transfer_v1) */}
      {consentOpen ? (
        <ModalDialog
          title="KVKK Yurt Dışı Veri Aktarımı Onayı"
          onClose={() => {
            setConsentOpen(false);
            pendingConsentActionRef.current = null;
          }}
        >
          <p className="text-xs leading-relaxed text-fg-muted">
            Ses çözümleme (<code className="text-cyan-300">fal-ai/wizper</code>) ve AI video/görsel üretimi için medya
            dosyanızın kısa süreli imzalı bağlantısı yurt dışında konumlu <strong>fal.ai</strong> altyapısına iletilir.
            KVKK md. 9 kapsamında açık rızanız onaylandıktan sonra işlem devam edecektir.
          </p>
          <div className="mt-4 flex justify-end gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                setConsentOpen(false);
                pendingConsentActionRef.current = null;
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-fg-muted"
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => void acceptConsentAndRetry()}
              className="rounded-lg bg-cyan-400 px-4 py-1.5 font-bold text-slate-950"
            >
              Onayla ve Devam Et
            </button>
          </div>
        </ModalDialog>
      ) : null}

      {/* Dışa Aktar & Kampanyaya Teslim Modal */}
      {showExportModal && project ? (
        <ModalDialog title="MP4 Dışa Aktar & Kampanya Teslimatı" onClose={() => setShowExportModal(false)}>
          <div className="flex flex-col gap-3 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">Çıktı Kalitesi</span>
              <select
                value={exportQuality}
                onChange={(e) => setExportQuality(e.target.value as "draft" | "standard" | "high")}
                className="h-9 rounded-lg border border-line bg-bg px-2 text-fg"
              >
                <option value="draft">Taslak Önizleme (720p · Hızlı)</option>
                <option value="standard">Standart Yayın (1080p · CRF 20)</option>
                <option value="high">Yüksek Kalite (1080p · CRF 17)</option>
              </select>
            </label>
            <button
              type="button"
              disabled={exportBusy}
              onClick={() => void runRenderExport()}
              className="h-9 rounded-xl bg-gradient-to-r from-cyan-400 to-fuchsia-500 font-bold text-slate-950 disabled:opacity-50"
            >
              {exportBusy ? "FFmpeg ile Render Alınıyor..." : "MP4 Oluştur ve İndir"}
            </button>

            {renderedOutput ? (
              <div className="flex flex-col gap-2.5 rounded-xl border border-emerald-400/30 bg-emerald-500/10 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-emerald-200">
                    Hazır ({(renderedOutput.sizeBytes / (1024 * 1024)).toFixed(2)} MB · {renderedOutput.durationSec}s)
                  </span>
                  <a
                    href={renderedOutput.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-emerald-400 px-3 py-1 font-bold text-slate-950"
                  >
                    MP4 İndir
                  </a>
                </div>

                {campaigns.length > 0 && !project.lockedAt ? (
                  <div className="flex flex-col gap-2 border-t border-emerald-400/20 pt-2">
                    <span className="font-semibold text-fg">Kampanyaya Taslak Olarak Teslim Et</span>
                    <select
                      value={submitCampaignId}
                      onChange={(e) => setSubmitCampaignId(e.target.value)}
                      className="h-8 rounded-lg border border-line bg-bg px-2 text-fg"
                    >
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.brandName} · {c.name}
                        </option>
                      ))}
                    </select>
                    {campaigns.find((c) => c.id === submitCampaignId)?.deliverables.length ? (
                      <select
                        value={submitDeliverableId}
                        onChange={(e) => setSubmitDeliverableId(e.target.value)}
                        className="h-8 rounded-lg border border-line bg-bg px-2 text-fg"
                      >
                        <option value="">Kampanya Genel Taslağı</option>
                        {campaigns
                          .find((c) => c.id === submitCampaignId)
                          ?.deliverables.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      disabled={submitBusy}
                      onClick={() => void submitToCampaign()}
                      className="h-9 rounded-xl bg-white font-bold text-slate-950 disabled:opacity-50"
                    >
                      {submitBusy ? "Gönderiliyor..." : "Kampanyaya Teslim Et & Kilitle"}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </ModalDialog>
      ) : null}
    </div>
  );
}

function TrackLane({
  elements,
  zoomPxPerSec,
  selectedIds,
  onSelect,
  onStartDrag,
  colorClass,
}: {
  elements: TimelineElement[];
  zoomPxPerSec: number;
  selectedIds: string[];
  onSelect: (id: string) => void;
  onStartDrag: (e: React.PointerEvent, el: TimelineElement, mode: "move" | "trim-start" | "trim-end") => void;
  colorClass: string;
}) {
  return (
    <div className="relative h-12 border-b border-line bg-[#0B0C11]">
      {elements.map((el) => {
        const left = ticksToSeconds(el.startTime) * zoomPxPerSec;
        const width = Math.max(22, ticksToSeconds(el.duration) * zoomPxPerSec);
        const selected = selectedIds.includes(el.id);
        return (
          <div
            key={el.id}
            onPointerDown={(e) => {
              onSelect(el.id);
              onStartDrag(e, el, "move");
            }}
            style={{ left: `${left}px`, width: `${width}px` }}
            className={`group absolute top-1.5 bottom-1.5 flex cursor-grab items-center justify-between overflow-hidden rounded-lg border px-1.5 text-[11px] font-medium select-none active:cursor-grabbing ${colorClass} ${selected ? "ring-2 ring-white" : ""
              } ${el.lockedBy === "brand" ? "border-amber-400 bg-amber-500/30" : ""}`}
          >
            {!el.locked ? (
              <div
                onPointerDown={(e) => onStartDrag(e, el, "trim-start")}
                className="h-full w-1.5 shrink-0 cursor-ew-resize rounded-l hover:bg-white/60"
              />
            ) : (
              <span className="mr-1 text-[10px]">🔒</span>
            )}
            <span className="truncate px-1 text-white">
              {el.type === "text" || el.type === "caption" ? el.text : el.name}
            </span>
            {!el.locked ? (
              <div
                onPointerDown={(e) => onStartDrag(e, el, "trim-end")}
                className="h-full w-1.5 shrink-0 cursor-ew-resize rounded-r hover:bg-white/60"
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ModalDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 text-fg shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xs text-fg-muted hover:bg-surface-hover hover:text-fg"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

