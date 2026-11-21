// Portions adapted from OpenCut (https://github.com/OpenCut-app/opencut-classic)
// Copyright (c) 2025-2026 OpenCut — MIT License. See THIRD_PARTY_NOTICES.md

import { secondsToTicks, ticksToSeconds, type Ticks } from "./time";
import { allTimelineElements, type CaptionEl, type StudioTimeline, type TextStyle } from "./timeline-schema";

export const DEFAULT_WORDS_PER_CAPTION = 3;
export const MIN_CAPTION_DURATION_SECONDS = 0.8;

export type RawTranscriptSegment = {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  words?: { w: string; startSec: number; endSec: number }[];
};

export function captionStyleForPreset(preset: NonNullable<TextStyle["preset"]> = "bold-yellow"): TextStyle {
  if (preset === "classic") {
    return {
      fontFamily: "Inter",
      fontSize: 52,
      fontWeight: 700,
      color: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidth: 4,
      align: "center",
      maxWidth: 0.84,
      preset: "classic",
    };
  }
  if (preset === "karaoke") {
    return {
      fontFamily: "Montserrat",
      fontSize: 58,
      fontWeight: 800,
      color: "#FFFFFF",
      strokeColor: "#0B0B14",
      strokeWidth: 5,
      align: "center",
      maxWidth: 0.84,
      preset: "karaoke",
    };
  }
  if (preset === "box") {
    return {
      fontFamily: "Inter",
      fontSize: 48,
      fontWeight: 700,
      color: "#FFFFFF",
      background: "#09090B",
      align: "center",
      maxWidth: 0.84,
      preset: "box",
    };
  }
  return {
    fontFamily: "Montserrat",
    fontSize: 58,
    fontWeight: 800,
    color: "#FACC15",
    strokeColor: "#000000",
    strokeWidth: 5,
    align: "center",
    maxWidth: 0.84,
    preset: "bold-yellow",
  };
}

/**
 * OpenCut orantılı altyazı bölme kuralı:
 * Her segmenti en fazla `wordsPerCaption` (varsayılan 3) kelimelik parçalara böler;
 * minimum `minDurationSec` (0.8 sn) süreyi korur.
 */
export function splitSegmentsIntoCaptions(
  segments: RawTranscriptSegment[],
  opts: {
    wordsPerCaption?: number;
    minDurationSec?: number;
    preset?: NonNullable<TextStyle["preset"]>;
    groupId?: string;
  } = {},
): CaptionEl[] {
  const perCaption = Math.max(1, opts.wordsPerCaption ?? DEFAULT_WORDS_PER_CAPTION);
  const minDur = Math.max(0.3, opts.minDurationSec ?? MIN_CAPTION_DURATION_SECONDS);
  const style = captionStyleForPreset(opts.preset ?? "bold-yellow");
  const groupId = opts.groupId ?? `capgrp_${Date.now().toString(36)}`;
  const out: CaptionEl[] = [];

  for (let sIdx = 0; sIdx < segments.length; sIdx++) {
    const seg = segments[sIdx]!;
    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    const totalDur = Math.max(minDur, seg.endSec - seg.startSec);
    const chunkCount = Math.max(1, Math.ceil(words.length / perCaption));
    const perWordSec = totalDur / words.length;
    let cursorSec = seg.startSec;

    for (let c = 0; c < chunkCount; c++) {
      const sliceWords = words.slice(c * perCaption, (c + 1) * perCaption);
      const isLast = c === chunkCount - 1;
      const chunkDurRaw = Math.max(minDur, sliceWords.length * perWordSec);
      const endSec = isLast ? Math.max(seg.endSec, cursorSec + minDur * 0.5) : Math.min(seg.endSec, cursorSec + chunkDurRaw);
      const startTicks = secondsToTicks(cursorSec);
      const endTicks = secondsToTicks(Math.max(cursorSec + 0.3, endSec));
      const durTicks = Math.max(secondsToTicks(0.3), endTicks - startTicks) as Ticks;

      // Kelime düzeyi zaman damgası (karaoke vurgusu için)
      const wordStepTicks = Math.max(1, Math.floor(durTicks / sliceWords.length));
      const wordTimes = sliceWords.map((w, wIdx) => ({
        w,
        start: (startTicks + wIdx * wordStepTicks) as Ticks,
        end: (startTicks + (wIdx + 1) * wordStepTicks) as Ticks,
      }));

      out.push({
        id: `cap_${sIdx}_${c}_${Math.random().toString(36).slice(2, 6)}`,
        name: sliceWords.join(" "),
        type: "caption",
        captionGroupId: groupId,
        text: sliceWords.join(" "),
        words: wordTimes,
        startTime: startTicks,
        duration: durTicks,
        trimStart: 0 as Ticks,
        trimEnd: 0 as Ticks,
        transform: { x: 0, y: 0.28, scale: 1, rotation: 0, opacity: 1 },
        style,
      });
      cursorSec = endSec;
    }
  }
  return out;
}

function fmtSrtTs(sec: number): string {
  const s = Math.max(0, sec);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  const ms = String(Math.round((s % 1) * 1000) % 1000).padStart(3, "0");
  return `${hh}:${mm}:${ss},${ms}`;
}

function parseSrtTs(raw: string): number {
  const m = raw.trim().match(/^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!m) return 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
}

/** Altyazıları Türkçe UTF-8 `.srt` metnine çevirir. */
export function serializeSrt(captions: { startTime: Ticks; duration: Ticks; text: string }[]): string {
  const sorted = [...captions].sort((a, b) => a.startTime - b.startTime);
  return sorted
    .map((c, idx) => {
      const start = ticksToSeconds(c.startTime);
      const end = ticksToSeconds(c.startTime + c.duration);
      return `${idx + 1}\n${fmtSrtTs(start)} --> ${fmtSrtTs(end)}\n${c.text.trim()}\n`;
    })
    .join("\n");
}

/** `.srt` metnini zaman damgalı segmentlere ayrıştırır (Türkçe karakterler korunur). */
export function parseSrt(srtContent: string): RawTranscriptSegment[] {
  const blocks = srtContent
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  const segments: RawTranscriptSegment[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i]!.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timeIdx = lines[0]!.includes("-->") ? 0 : 1;
    const timeLine = lines[timeIdx];
    if (!timeLine || !timeLine.includes("-->")) continue;
    const [a, b] = timeLine.split("-->");
    const startSec = parseSrtTs(a ?? "");
    const endSec = Math.max(startSec + 0.3, parseSrtTs(b ?? ""));
    const text = lines.slice(timeIdx + 1).join(" ").trim();
    if (!text) continue;
    segments.push({ id: `srt_${i + 1}`, startSec, endSec, text });
  }
  return segments;
}

function assColor(hex: string, alphaHex = "00"): string {
  const c = hex.replace("#", "").padStart(6, "0").slice(0, 6);
  const rr = c.slice(0, 2);
  const gg = c.slice(2, 4);
  const bb = c.slice(4, 6);
  return `&H${alphaHex}${bb}${gg}${rr}`;
}

function fmtAssTs(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const rem = Math.floor(s % 60);
  const cs = String(Math.floor((s % 1) * 100)).padStart(2, "0");
  return `${h}:${m}:${String(rem).padStart(2, "0")}.${cs}`;
}

export function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, "\\N");
}

/**
 * Zaman çizelgesindeki tüm `text`, `caption` ve `cta` katmanlarını
 * sunucuda FFmpeg `subtitles=` filtresine verilecek tek bir ASS dosyasına derler.
 */
export function compileTimelineAss(timeline: StudioTimeline): string {
  const { width, height } = timeline.settings.canvas;
  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Classic,Inter,52,${assColor("#FFFFFF")},${assColor("#FACC15")},${assColor("#000000")},${assColor("#000000", "80")},1,0,0,0,100,100,0,0,1,4,1,2,90,130,340,1`,
    `Style: BoldYellow,Montserrat,58,${assColor("#FACC15")},${assColor("#FFFFFF")},${assColor("#000000")},${assColor("#000000", "80")},1,0,0,0,100,100,0,0,1,5,1,2,90,130,340,1`,
    `Style: Karaoke,Montserrat,58,${assColor("#FACC15")},${assColor("#FFFFFF")},${assColor("#0B0B14")},${assColor("#000000", "80")},1,0,0,0,100,100,0,0,1,5,1,2,90,130,340,1`,
    `Style: Box,Inter,48,${assColor("#FFFFFF")},${assColor("#FFFFFF")},${assColor("#09090B")},${assColor("#09090B", "45")},1,0,0,0,100,100,0,0,3,14,0,2,90,130,340,1`,
    `Style: OverlayText,Inter,52,${assColor("#FFFFFF")},${assColor("#FFFFFF")},${assColor("#000000")},${assColor("#000000", "55")},1,0,0,0,100,100,0,0,1,3,1,5,80,80,120,1`,
    `Style: AdBadge,Inter,34,${assColor("#FFFFFF")},${assColor("#FFFFFF")},${assColor("#000000")},${assColor("#09090B", "30")},1,0,0,0,100,100,0,0,3,10,0,7,48,48,96,1`,
    `Style: CtaCard,Montserrat,42,${assColor("#FFFFFF")},${assColor("#FF2BD6")},${assColor("#111827")},${assColor("#111827", "20")},1,0,0,0,100,100,0,0,3,16,0,2,80,80,180,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const elements = allTimelineElements(timeline);
  for (const el of elements) {
    const start = fmtAssTs(ticksToSeconds(el.startTime));
    const end = fmtAssTs(ticksToSeconds(el.startTime + el.duration));

    if (el.type === "caption") {
      const styleName =
        el.style.preset === "classic"
          ? "Classic"
          : el.style.preset === "karaoke"
            ? "Karaoke"
            : el.style.preset === "box"
              ? "Box"
              : "BoldYellow";
      const cx = Math.round(width / 2 + el.transform.x * (width / 2));
      const cy = Math.round(height / 2 + el.transform.y * (height / 2));
      let body = escapeAssText(el.text);
      if (el.style.preset === "karaoke" && el.words?.length) {
        body = el.words
          .map((wd) => {
            const cs = Math.max(5, Math.round(ticksToSeconds(wd.end - wd.start) * 100));
            return `{\\k${cs}}${escapeAssText(wd.w)}`;
          })
          .join(" ");
      }
      lines.push(`Dialogue: 2,${start},${end},${styleName},,0,0,0,,{\\pos(${cx},${cy})}${body}`);
    } else if (el.type === "text") {
      const isAdBadge = el.locked && el.lockedBy === "brand";
      const styleName = isAdBadge ? "AdBadge" : "OverlayText";
      const cx = Math.round(width / 2 + el.transform.x * (width / 2));
      const cy = Math.round(height / 2 + el.transform.y * (height / 2));
      lines.push(`Dialogue: 3,${start},${end},${styleName},,0,0,0,,{\\pos(${cx},${cy})}${escapeAssText(el.text)}`);
    } else if (el.type === "cta") {
      const cx = Math.round(width / 2 + el.transform.x * (width / 2));
      const cy = Math.round(height / 2 + el.transform.y * (height / 2));
      const label = el.couponCode ? `${el.label} · Kod: ${el.couponCode}` : el.label;
      lines.push(`Dialogue: 3,${start},${end},CtaCard,,0,0,0,,{\\pos(${cx},${cy})}${escapeAssText(label)}`);
    }
  }

  return lines.join("\n") + "\n";
}

