// Portions adapted from OpenCut (https://github.com/OpenCut-app/opencut-classic)
// Copyright (c) 2025-2026 OpenCut — MIT License. See THIRD_PARTY_NOTICES.md

import {
  ASPECT_CANVAS,
  type AspectPreset,
  type AudioEl,
  type CaptionEl,
  type CtaEl,
  type ImageEl,
  type LogoEl,
  type OverlayTrack,
  type ShapeEl,
  type StudioTimeline,
  type TextEl,
  type TimelineElement,
  type VideoEl,
  type VideoTrack,
} from "./timeline-schema";
import { addTicks, roundTicks, secondsToTicks, snapToFrame, subTicks, type Ticks } from "./time";

function uid(prefix = "el"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

function cloneTimeline(t: StudioTimeline): StudioTimeline {
  return structuredClone(t);
}

export function overlaps(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  const aEnd = aStart + aDur;
  const bEnd = bStart + bDur;
  return aStart < bEnd && bStart < aEnd;
}

export function hasOverlapInTrack(elements: { id: string; startTime: number; duration: number }[], candidate: { id?: string; startTime: number; duration: number }): boolean {
  return elements.some((el) => el.id !== candidate.id && overlaps(el.startTime, el.duration, candidate.startTime, candidate.duration));
}

function findOverlayForElement(t: StudioTimeline, el: TimelineElement): OverlayTrack | null {
  if (el.type === "text" || el.type === "caption") {
    return (
      t.tracks.overlay.find((tr) => tr.type === "text" && !hasOverlapInTrack(tr.elements, el)) ??
      null
    );
  }
  if (el.type === "logo" || el.type === "cta" || el.type === "shape") {
    return (
      t.tracks.overlay.find((tr) => tr.type === "graphic" && !hasOverlapInTrack(tr.elements, el)) ??
      null
    );
  }
  if (el.type === "video" || el.type === "image") {
    return (
      t.tracks.overlay.find((tr) => tr.type === "video" && !hasOverlapInTrack(tr.elements, el)) ??
      null
    );
  }
  return null;
}

/**
 * Zaman çizelgesine yeni öğe ekler.
 * Çakışma varsa overlay/ses kanalı otomatik açılır; ana kanalda (`main`) çakışmıyorsa ekler.
 */
export function insertElement(
  timeline: StudioTimeline,
  element: TimelineElement,
  opts: { targetTrackId?: string } = {},
): StudioTimeline {
  const next = cloneTimeline(timeline);
  const fps = next.settings.fps;
  const snapped: TimelineElement = {
    ...element,
    startTime: snapToFrame(element.startTime, fps),
    duration: roundTicks(Math.max(secondsToTicks(0.2), snapToFrame(element.duration, fps))),
  };

  if (snapped.type === "audio") {
    const existing = next.tracks.audio.find((tr) => (!opts.targetTrackId || tr.id === opts.targetTrackId) && !hasOverlapInTrack(tr.elements, snapped));
    if (existing) {
      existing.elements.push(snapped as AudioEl);
      existing.elements.sort((a, b) => a.startTime - b.startTime);
    } else {
      next.tracks.audio.push({
        id: uid("audio"),
        type: "audio",
        name: `Ses (A${next.tracks.audio.length + 1})`,
        muted: false,
        locked: false,
        elements: [snapped as AudioEl],
      });
    }
    return next;
  }

  if ((snapped.type === "video" || snapped.type === "image") && (!opts.targetTrackId || opts.targetTrackId === next.tracks.main.id)) {
    const main = next.tracks.main;
    if (!main.locked && !hasOverlapInTrack(main.elements, snapped)) {
      main.elements.push(snapped as VideoEl | ImageEl);
      main.elements.sort((a, b) => a.startTime - b.startTime);
      return next;
    }
    // Eğer ana kanalda çakışma varsa veya sona eklenmek isteniyorsa overlay video kanalı kullan
    if (!opts.targetTrackId) {
      const endOfMain = main.elements.reduce((m, e) => Math.max(m, e.startTime + e.duration), 0);
      if (snapped.startTime === 0 && endOfMain > 0 && snapped.type === "video") {
        (snapped as VideoEl).startTime = roundTicks(endOfMain);
        main.elements.push(snapped as VideoEl);
        return next;
      }
    }
  }

  const targetOverlay =
    (opts.targetTrackId
      ? next.tracks.overlay.find((tr) => tr.id === opts.targetTrackId)
      : findOverlayForElement(next, snapped)) ?? null;

  if (targetOverlay && !targetOverlay.locked && !hasOverlapInTrack(targetOverlay.elements, snapped)) {
    if (targetOverlay.type === "text" && (snapped.type === "text" || snapped.type === "caption")) {
      targetOverlay.elements.push(snapped as TextEl | CaptionEl);
      targetOverlay.elements.sort((a, b) => a.startTime - b.startTime);
      return next;
    }
    if (targetOverlay.type === "graphic" && (snapped.type === "logo" || snapped.type === "cta" || snapped.type === "shape")) {
      targetOverlay.elements.push(snapped as LogoEl | CtaEl | ShapeEl);
      targetOverlay.elements.sort((a, b) => a.startTime - b.startTime);
      return next;
    }
    if (targetOverlay.type === "video" && (snapped.type === "video" || snapped.type === "image")) {
      targetOverlay.elements.push(snapped as VideoEl | ImageEl);
      targetOverlay.elements.sort((a, b) => a.startTime - b.startTime);
      return next;
    }
  }

  // Uygun yeni overlay kanalı oluştur (index 0 üstte)
  if (snapped.type === "text" || snapped.type === "caption") {
    next.tracks.overlay.unshift({
      id: uid("text"),
      type: "text",
      name: `Metin (${next.tracks.overlay.length + 1})`,
      hidden: false,
      locked: false,
      elements: [snapped as TextEl | CaptionEl],
    });
  } else if (snapped.type === "logo" || snapped.type === "cta" || snapped.type === "shape") {
    next.tracks.overlay.unshift({
      id: uid("graphic"),
      type: "graphic",
      name: `Grafik (${next.tracks.overlay.length + 1})`,
      hidden: false,
      locked: false,
      elements: [snapped as LogoEl | CtaEl | ShapeEl],
    });
  } else {
    next.tracks.overlay.unshift({
      id: uid("vidov"),
      type: "video",
      name: `Katman V${next.tracks.overlay.length + 2}`,
      muted: false,
      hidden: false,
      locked: false,
      elements: [snapped as VideoEl | ImageEl],
    } as VideoTrack);
  }
  return next;
}

/** Seçili öğeleri siler; kilitli öğelere dokunmaz. Ana kanalda `ripple` açıksa boşluğu kapatır. */
export function deleteElements(timeline: StudioTimeline, ids: string[], opts: { ripple?: boolean } = { ripple: true }): StudioTimeline {
  const idSet = new Set(ids);
  if (idSet.size === 0) return timeline;
  const next = cloneTimeline(timeline);

  // Main channel with optional ripple closing
  const main = next.tracks.main;
  if (!main.locked) {
    const removedRanges: { start: number; dur: number }[] = [];
    main.elements = main.elements.filter((el) => {
      if (idSet.has(el.id) && !el.locked) {
        removedRanges.push({ start: el.startTime, dur: el.duration });
        return false;
      }
      return true;
    });
    if (opts.ripple !== false && removedRanges.length > 0) {
      removedRanges.sort((a, b) => a.start - b.start);
      for (const el of main.elements) {
        let shift = 0;
        for (const r of removedRanges) {
          if (r.start < el.startTime) shift += r.dur;
        }
        if (shift > 0) el.startTime = subTicks(el.startTime, roundTicks(shift));
      }
    }
  }

  for (const tr of next.tracks.overlay) {
    if (tr.locked) continue;
    tr.elements = tr.elements.filter((el) => !(idSet.has(el.id) && !el.locked)) as typeof tr.elements;
  }
  for (const tr of next.tracks.audio) {
    if (tr.locked) continue;
    tr.elements = tr.elements.filter((el) => !(idSet.has(el.id) && !el.locked));
  }
  return next;
}

function splitSingleElement<T extends TimelineElement>(el: T, splitTime: Ticks): [T, T] | null {
  if (el.locked) return null;
  if (splitTime <= el.startTime || splitTime >= el.startTime + el.duration) return null;
  const rel = subTicks(splitTime, el.startTime);
  const rightDur = subTicks(el.duration, rel);
  if (rel <= 0 || rightDur <= 0) return null;

  const speed = "speed" in el ? el.speed : 1;
  // OpenCut tek yuvarlama kuralı: 1.5x gibi hızlarda 1 tick kaymasını önler
  const totalSourceSpan = roundTicks(el.duration * speed);
  const leftSourceSpan = roundTicks(rel * speed);
  const rightSourceSpan = subTicks(totalSourceSpan, leftSourceSpan);

  const left: T = {
    ...structuredClone(el),
    duration: rel,
    trimEnd: addTicks(el.trimEnd, rightSourceSpan),
  };
  const right: T = {
    ...structuredClone(el),
    id: uid(el.type),
    startTime: splitTime,
    duration: rightDur,
    trimStart: addTicks(el.trimStart, leftSourceSpan),
  };
  return [left, right];
}

/**
 * Playhead konumunda öğe(ler)i böler (`S`).
 * Seçili ID yoksa playhead altındaki tüm kilitsiz öğeleri böler.
 */
export function splitElementAtPlayhead(timeline: StudioTimeline, splitTimeRaw: Ticks, targetIds?: string[]): StudioTimeline {
  const next = cloneTimeline(timeline);
  const splitTime = snapToFrame(splitTimeRaw, next.settings.fps);
  const hasFilter = Boolean(targetIds && targetIds.length > 0);
  const filterSet = new Set(targetIds ?? []);
  const matches = (el: TimelineElement) => (hasFilter ? filterSet.has(el.id) : true);

  const splitTrackElements = <T extends TimelineElement>(arr: T[]): T[] => {
    const out: T[] = [];
    for (const el of arr) {
      if (matches(el)) {
        const pair = splitSingleElement(el, splitTime);
        if (pair) {
          out.push(pair[0], pair[1]);
          continue;
        }
      }
      out.push(el);
    }
    return out;
  };

  if (!next.tracks.main.locked) {
    next.tracks.main.elements = splitTrackElements(next.tracks.main.elements);
  }
  for (const tr of next.tracks.overlay) {
    if (!tr.locked) tr.elements = splitTrackElements(tr.elements as TimelineElement[]) as typeof tr.elements;
  }
  for (const tr of next.tracks.audio) {
    if (!tr.locked) tr.elements = splitTrackElements(tr.elements);
  }
  return next;
}

/** Playhead'den bölüp solunu (`Q`) veya sağını (`W`) siler. */
export function splitAndDeleteSide(
  timeline: StudioTimeline,
  playhead: Ticks,
  side: "left" | "right",
  targetIds?: string[],
): StudioTimeline {
  const splitTime = snapToFrame(playhead, timeline.settings.fps);
  const splitTl = splitElementAtPlayhead(timeline, splitTime, targetIds);
  const toDelete: string[] = [];

  const check = (arr: TimelineElement[]) => {
    for (const el of arr) {
      if (el.locked) continue;
      if (side === "left" && el.startTime + el.duration === splitTime) toDelete.push(el.id);
      if (side === "right" && el.startTime === splitTime) toDelete.push(el.id);
    }
  };
  check(splitTl.tracks.main.elements);
  for (const tr of splitTl.tracks.overlay) check(tr.elements);
  for (const tr of splitTl.tracks.audio) check(tr.elements);

  return deleteElements(splitTl, toDelete, { ripple: true });
}

/** Öğeyi sürükleyerek taşır; çakışma ve kilit kontrolü yapar. */
export function moveElement(timeline: StudioTimeline, elementId: string, newStartRaw: Ticks): StudioTimeline {
  const next = cloneTimeline(timeline);
  const newStart = snapToFrame(roundTicks(Math.max(0, newStartRaw)), next.settings.fps);

  const tryMoveIn = <T extends TimelineElement>(arr: T[], trackLocked: boolean): boolean => {
    const idx = arr.findIndex((e) => e.id === elementId);
    if (idx === -1) return false;
    const el = arr[idx]!;
    if (trackLocked || el.locked) return true;
    if (hasOverlapInTrack(arr, { id: el.id, startTime: newStart, duration: el.duration })) return true;
    el.startTime = newStart;
    arr.sort((a, b) => a.startTime - b.startTime);
    return true;
  };

  if (tryMoveIn(next.tracks.main.elements, next.tracks.main.locked)) return next;
  for (const tr of next.tracks.overlay) {
    if (tryMoveIn(tr.elements as TimelineElement[], tr.locked)) return next;
  }
  for (const tr of next.tracks.audio) {
    if (tryMoveIn(tr.elements, tr.locked)) return next;
  }
  return next;
}

/** Kenardan kırpma (trim): başlangıç veya bitiş kenarını kaynak süresi içinde tutarak kırpar. */
export function trimElement(
  timeline: StudioTimeline,
  elementId: string,
  edge: "start" | "end",
  deltaTicksRaw: number,
): StudioTimeline {
  const next = cloneTimeline(timeline);
  const minDur = secondsToTicks(0.2);

  const applyTrim = <T extends TimelineElement>(arr: T[], trackLocked: boolean): boolean => {
    const el = arr.find((e) => e.id === elementId);
    if (!el) return false;
    if (trackLocked || el.locked) return true;

    const speed = "speed" in el ? el.speed : 1;
    const step = snapToFrame(roundTicks(Math.abs(deltaTicksRaw)), next.settings.fps) * Math.sign(deltaTicksRaw);

    if (edge === "start") {
      const nextStart = Math.max(0, el.startTime + step);
      const actualShift = nextStart - el.startTime;
      const nextDur = el.duration - actualShift;
      const nextTrimStart = el.trimStart + Math.round(actualShift * speed);
      if (nextDur < minDur || nextTrimStart < 0) return true;
      if (hasOverlapInTrack(arr, { id: el.id, startTime: nextStart, duration: nextDur })) return true;
      el.startTime = roundTicks(nextStart);
      el.duration = roundTicks(nextDur);
      el.trimStart = roundTicks(nextTrimStart);
    } else {
      const nextDur = el.duration + step;
      if (nextDur < minDur) return true;
      const sourceNeeded = el.trimStart + Math.round(nextDur * speed);
      if (el.sourceDuration != null && sourceNeeded > el.sourceDuration) return true;
      if (hasOverlapInTrack(arr, { id: el.id, startTime: el.startTime, duration: nextDur })) return true;
      el.duration = roundTicks(nextDur);
      if (el.sourceDuration != null) {
        el.trimEnd = subTicks(el.sourceDuration, roundTicks(sourceNeeded));
      }
    }
    return true;
  };

  if (applyTrim(next.tracks.main.elements, next.tracks.main.locked)) return next;
  for (const tr of next.tracks.overlay) {
    if (applyTrim(tr.elements as TimelineElement[], tr.locked)) return next;
  }
  for (const tr of next.tracks.audio) {
    if (applyTrim(tr.elements, tr.locked)) return next;
  }
  return next;
}

export function duplicateElements(timeline: StudioTimeline, ids: string[]): StudioTimeline {
  const idSet = new Set(ids);
  if (idSet.size === 0) return timeline;
  let next = cloneTimeline(timeline);
  const toInsert: TimelineElement[] = [];

  for (const el of timeline.tracks.main.elements) {
    if (idSet.has(el.id) && !el.locked) toInsert.push({ ...structuredClone(el), id: uid(el.type), startTime: addTicks(el.startTime, el.duration) });
  }
  for (const tr of timeline.tracks.overlay) {
    for (const el of tr.elements) {
      if (idSet.has(el.id) && !el.locked) toInsert.push({ ...structuredClone(el), id: uid(el.type), startTime: addTicks(el.startTime, el.duration) });
    }
  }
  for (const tr of timeline.tracks.audio) {
    for (const el of tr.elements) {
      if (idSet.has(el.id) && !el.locked) toInsert.push({ ...structuredClone(el), id: uid(el.type), startTime: addTicks(el.startTime, el.duration) });
    }
  }

  for (const item of toInsert) next = insertElement(next, item);
  return next;
}

export type SilenceRange = { startSec: number; endSec: number };

/**
 * FFmpeg `silencedetect` çıkışından tutulacak konuşma aralıklarını hesaplar (`auto-editor` mantığı):
 * - Her konuşma aralığına `marginSec` (varsayılan 0.12 sn) kenar payı ekler
 * - 0.15 sn'den kısa konuşma parçalarını atar
 * - 0.20 sn'den kısa boşlukları birleştirir
 */
export function computeSilenceKeepIntervals(
  totalDurationSec: number,
  silences: SilenceRange[],
  marginSec = 0.12,
): { startSec: number; endSec: number; cutSec: number }[] {
  if (totalDurationSec <= 0) return [];
  const sorted = [...silences]
    .filter((s) => s.endSec > s.startSec)
    .sort((a, b) => a.startSec - b.startSec);

  const trimmedSilences = sorted
    .map((s) => ({
      startSec: Math.max(0, s.startSec + marginSec),
      endSec: Math.min(totalDurationSec, s.endSec - marginSec),
    }))
    .filter((s) => s.endSec - s.startSec >= 0.2);

  const keepRaw: SilenceRange[] = [];
  let cursor = 0;
  for (const s of trimmedSilences) {
    if (s.startSec > cursor) keepRaw.push({ startSec: cursor, endSec: s.startSec });
    cursor = Math.max(cursor, s.endSec);
  }
  if (cursor < totalDurationSec) keepRaw.push({ startSec: cursor, endSec: totalDurationSec });

  const filtered = keepRaw.filter((k) => k.endSec - k.startSec >= 0.15);
  const merged: SilenceRange[] = [];
  for (const seg of filtered) {
    const prev = merged.at(-1);
    if (prev && seg.startSec - prev.endSec < 0.2) {
      prev.endSec = Math.max(prev.endSec, seg.endSec);
    } else {
      merged.push({ ...seg });
    }
  }

  const totalKeep = merged.reduce((sum, x) => sum + (x.endSec - x.startSec), 0);
  const cutSec = Math.max(0, Number((totalDurationSec - totalKeep).toFixed(2)));
  return merged.map((m) => ({ ...m, cutSec }));
}

/**
 * Tek adımda (tek undo) bir video öğesindeki sessizlikleri keser ve ripple ile birleştirir.
 */
export function applySilenceCutToTimeline(
  timeline: StudioTimeline,
  elementId: string,
  silences: SilenceRange[],
  marginSec = 0.12,
): { timeline: StudioTimeline; savedSeconds: number } {
  const next = cloneTimeline(timeline);
  const idx = next.tracks.main.elements.findIndex((e) => e.id === elementId);
  if (idx === -1) return { timeline, savedSeconds: 0 };
  const target = next.tracks.main.elements[idx]!;
  if (target.locked || target.type !== "video") return { timeline, savedSeconds: 0 };

  const durSec = target.duration / 120_000;
  const trimStartSec = target.trimStart / 120_000;
  const keepLocal = computeSilenceKeepIntervals(
    durSec,
    silences
      .map((s) => ({ startSec: s.startSec - trimStartSec, endSec: s.endSec - trimStartSec }))
      .filter((s) => s.endSec > 0 && s.startSec < durSec),
    marginSec,
  );
  if (keepLocal.length === 0) return { timeline, savedSeconds: 0 };

  let cursor = target.startTime;
  const replacements: VideoEl[] = keepLocal.map((seg, i) => {
    const segDur = secondsToTicks(seg.endSec - seg.startSec);
    const segTrimStart = addTicks(target.trimStart, secondsToTicks(seg.startSec));
    const el: VideoEl = {
      ...structuredClone(target),
      id: i === 0 ? target.id : uid("vid"),
      startTime: cursor,
      duration: segDur,
      trimStart: segTrimStart,
    };
    cursor = addTicks(cursor, segDur);
    return el;
  });

  const savedTicks = subTicks(target.duration, subTicks(cursor, target.startTime));
  next.tracks.main.elements.splice(idx, 1, ...replacements);

  // Sonraki main öğelerini sola kaydır (ripple)
  for (let i = idx + replacements.length; i < next.tracks.main.elements.length; i++) {
    const el = next.tracks.main.elements[i]!;
    el.startTime = subTicks(el.startTime, savedTicks);
  }

  return { timeline: next, savedSeconds: Number((savedTicks / 120_000).toFixed(2)) };
}

/** 9:16 / 1:1 / 4:5 / 16:9 Reframe (ortadan kırp / bulanık arka plan / kenar boşluğu). */
export function applyReframeToTimeline(
  timeline: StudioTimeline,
  preset: Exclude<AspectPreset, "custom">,
  mode: "crop" | "blur" | "pad",
): StudioTimeline {
  const next = cloneTimeline(timeline);
  next.settings.aspectPreset = preset;
  next.settings.canvas = ASPECT_CANVAS[preset];
  if (mode === "blur") {
    next.settings.background = { type: "blur", intensity: 28 };
  } else {
    next.settings.background = { type: "color", color: "#09090B" };
  }
  if (mode === "crop") {
    for (const el of next.tracks.main.elements) {
      if (el.type === "video" || el.type === "image") {
        el.crop = el.crop ?? { x: 0.25, y: 0, w: 0.5, h: 1 };
      }
    }
  } else {
    for (const el of next.tracks.main.elements) {
      if (el.type === "video" || el.type === "image") {
        delete el.crop;
      }
    }
  }
  return next;
}

/** 8 piksel eşik değerine göre mıknatıslanma (snapping) hedefini çözer. */
export function resolveSnapTarget(
  timeline: StudioTimeline,
  candidateTicks: Ticks,
  playheadTicks: Ticks,
  pxPerSecond: number,
  excludeIds: string[] = [],
): Ticks | null {
  const thresholdTicks = (8 / Math.max(10, pxPerSecond)) * 120_000;
  const ex = new Set(excludeIds);
  const anchors = new Set<number>([0, playheadTicks]);

  for (const m of timeline.markers) anchors.add(m.time);
  const addFrom = (arr: TimelineElement[]) => {
    for (const el of arr) {
      if (ex.has(el.id)) continue;
      anchors.add(el.startTime);
      anchors.add(el.startTime + el.duration);
    }
  };
  addFrom(timeline.tracks.main.elements);
  for (const tr of timeline.tracks.overlay) addFrom(tr.elements);
  for (const tr of timeline.tracks.audio) addFrom(tr.elements);

  let best: number | null = null;
  let bestDist = thresholdTicks;
  for (const a of anchors) {
    const d = Math.abs(a - candidateTicks);
    if (d <= bestDist) {
      bestDist = d;
      best = a;
    }
  }
  return best === null ? null : roundTicks(best);
}
