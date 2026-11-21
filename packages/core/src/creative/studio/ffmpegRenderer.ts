import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../../db";
import { bucket, s3 } from "../../storage/s3";
import { downloadToFile, getOwnedUpload, saveEditedFile } from "../uploads";
import type { EditPlan, PipelineAspect, Storyboard, TransitionType } from "./schemas";

const TARGET_SIZE: Record<PipelineAspect, { w: number; h: number }> = {
  "9:16": { w: 720, h: 1280 },
  "1:1": { w: 720, h: 720 },
  "16:9": { w: 1280, h: 720 },
};

const LOOK_FILTER: Record<string, string | null> = {
  orijinal: null,
  canli: "eq=saturation=1.32:contrast=1.08",
  sinematik: "eq=contrast=1.12:saturation=1.08:brightness=-0.02,colorbalance=rs=0.04:gs=-0.01:bs=-0.05",
  "siyah-beyaz": "hue=s=0",
  sicak: "colorbalance=rs=0.08:gs=0.02:bs=-0.08",
  soguk: "colorbalance=rs=-0.06:bs=0.08",
};

function runCmd(cmd: string, args: string[], timeoutMs = 180_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let out = "";
    let err = "";
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(t);
      resolve({ code: -1, out, err: String(e.message) });
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

export async function probeVideoDuration(filePath: string): Promise<number | null> {
  const r = await runCmd("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=duration", "-of", "default=nw=1:nk=1", filePath], 30_000);
  if (r.code !== 0) return null;
  for (const line of r.out.split(/\r?\n/)) {
    const n = Number(line.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

async function probeHasAudio(filePath: string): Promise<boolean> {
  const r = await runCmd("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath], 15_000);
  return r.code === 0 && r.out.trim().length > 0;
}

function fmtSrtTime(sec: number): string {
  const s = Math.max(0, sec);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(Math.floor(s % 60)).padStart(2, "0");
  const ms = String(Math.round((s % 1) * 1000)).padStart(3, "0");
  return `${hh}:${mm}:${ss},${ms}`;
}

function buildSrtContent(lines: { startSec: number; endSec: number; text: string }[]): string {
  return lines
    .map((l, idx) => `${idx + 1}\n${fmtSrtTime(l.startSec)} --> ${fmtSrtTime(l.endSec)}\n${l.text.trim()}\n`)
    .join("\n");
}

function xfadeName(t: TransitionType): string {
  if (t === "wipeleft") return "wipeleft";
  if (t === "slideleft") return "slideleft";
  if (t === "dissolve") return "dissolve";
  return "fade";
}

async function savePipelineMp4(input: {
  tenantId: string;
  body: Buffer;
  name: string;
  durationSec: number | null;
  parentUploadId?: string | null;
}): Promise<string> {
  if (input.parentUploadId) {
    const saved = await saveEditedFile({
      tenantId: input.tenantId,
      parentId: input.parentUploadId,
      body: input.body,
      mime: "video/mp4",
      name: input.name.slice(0, 120),
      durationSec: input.durationSec,
    });
    return saved.id;
  }
  const key = `uploads/${input.tenantId}/${randomUUID()}.mp4`;
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: input.body, ContentType: "video/mp4" }));
  const row = await prisma.creativeUpload.create({
    data: {
      tenantId: input.tenantId,
      kind: "video",
      mime: "video/mp4",
      sizeBytes: input.body.length,
      s3Key: key,
      name: input.name.slice(0, 120),
      source: "ai",
      durationSec: input.durationSec,
    },
  });
  return row.id;
}

/**
 * Fotoğraftan video boru hattı montajı:
 * Sahne kliplerini hedef boyuta normalize eder, xfade geçişleriyle birleştirir,
 * seslendirme + fon müziği + altyazı + logo filigran ekler ve S3'e yükler.
 */
export async function renderStoryboardMontage(input: {
  tenantId: string;
  aspect: PipelineAspect;
  storyboard: Storyboard;
  clipS3Keys: string[];
  voiceoverS3Key?: string | null;
  musicS3Key?: string | null;
  logoUploadId?: string | null;
}): Promise<{ uploadId: string; durationSec: number | null }> {
  if (input.clipS3Keys.length === 0) throw new Error("Birleştirilecek sahne klibi bulunamadı.");
  const { w, h } = TARGET_SIZE[input.aspect];
  const dir = mkdtempSync(path.join(tmpdir(), "nv-montage-"));

  try {
    // 1. Tüm klipleri indir ve aynı çözünürlük/fps'e normalize et
    const normPaths: string[] = [];
    const normDurs: number[] = [];
    for (let i = 0; i < input.clipS3Keys.length; i++) {
      const rawPath = path.join(dir, `raw-${i}.mp4`);
      const normPath = path.join(dir, `norm-${i}.mp4`);
      await downloadToFile(input.clipS3Keys[i]!, rawPath);
      const dur = (await probeVideoDuration(rawPath)) ?? input.storyboard.scenes[i]?.durationSec ?? 5;
      const r = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        rawPath,
        "-vf",
        `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p`,
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        normPath,
      ]);
      if (r.code !== 0) throw new Error(`Sahne #${i + 1} normalize edilemedi: ${r.err.slice(0, 200)}`);
      normPaths.push(normPath);
      normDurs.push(dur);
    }

    // 2. Klipleri geçişlerle (xfade) birleştir
    let videoTrackPath = normPaths[0]!;
    if (normPaths.length > 1) {
      const mergedPath = path.join(dir, "merged.mp4");
      const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
      for (const p of normPaths) args.push("-i", p);

      const filterParts: string[] = [];
      let prevLabel = "[0:v]";
      let offset = Math.max(0.5, normDurs[0]! - 0.5);
      for (let i = 1; i < normPaths.length; i++) {
        const trans = input.storyboard.scenes[i - 1]?.transition ?? "fade";
        const xName = trans === "cut" ? "fade" : xfadeName(trans);
        const fadeDur = trans === "cut" ? 0.05 : 0.5;
        const outLabel = i === normPaths.length - 1 ? "[vout]" : `[v${i}]`;
        filterParts.push(`${prevLabel}[${i}:v]xfade=transition=${xName}:duration=${fadeDur}:offset=${offset.toFixed(2)}${outLabel}`);
        prevLabel = outLabel;
        offset += Math.max(0.5, normDurs[i]! - fadeDur);
      }

      const r = await runCmd("ffmpeg", [
        ...args,
        "-filter_complex",
        filterParts.join(";"),
        "-map",
        "[vout]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        mergedPath,
      ]);
      if (r.code !== 0) throw new Error(`Klipler birleştirilemedi: ${r.err.slice(0, 240)}`);
      videoTrackPath = mergedPath;
    }

    // 3. Altyazı ve/veya logo filigranı uygula
    let decoratedPath = videoTrackPath;
    const subtitleLines: { startSec: number; endSec: number; text: string }[] = [];
    let cursor = 0;
    for (let i = 0; i < normDurs.length; i++) {
      const txt = input.storyboard.scenes[i]?.subtitleText?.trim();
      const d = normDurs[i]!;
      if (txt) subtitleLines.push({ startSec: cursor + 0.2, endSec: Math.max(cursor + 1, cursor + d - 0.3), text: txt });
      cursor += Math.max(0.5, d - 0.4);
    }

    let logoPath: string | null = null;
    if (input.logoUploadId) {
      try {
        const logoUpload = await getOwnedUpload(input.tenantId, input.logoUploadId);
        logoPath = path.join(dir, "logo.png");
        await downloadToFile(logoUpload.s3Key, logoPath);
      } catch {
        logoPath = null;
      }
    }

    if (subtitleLines.length > 0 || logoPath) {
      const srtPath = path.join(dir, "subs.srt");
      if (subtitleLines.length > 0) writeFileSync(srtPath, buildSrtContent(subtitleLines), "utf8");
      const decOut = path.join(dir, "decorated.mp4");
      const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", videoTrackPath];
      if (logoPath) args.push("-i", logoPath);

      const escapedSrt = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      if (logoPath && subtitleLines.length > 0) {
        args.push(
          "-filter_complex",
          `[1:v]scale=110:-1[lg];[0:v][lg]overlay=W-w-24:24,subtitles='${escapedSrt}':force_style='FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=48'[v]`,
          "-map",
          "[v]",
        );
      } else if (logoPath) {
        args.push("-filter_complex", "[1:v]scale=110:-1[lg];[0:v][lg]overlay=W-w-24:24[v]", "-map", "[v]");
      } else {
        args.push(
          "-vf",
          `subtitles='${escapedSrt}':force_style='FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=48'`,
        );
      }
      args.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", decOut);
      const r = await runCmd("ffmpeg", args);
      if (r.code === 0) decoratedPath = decOut;
    }

    // 4. Seslendirme + fon müziği miksajı
    const finalPath = path.join(dir, "final.mp4");
    let voicePath: string | null = null;
    let musicPath: string | null = null;
    if (input.voiceoverS3Key) {
      voicePath = path.join(dir, "voice.mp3");
      await downloadToFile(input.voiceoverS3Key, voicePath).catch(() => {
        voicePath = null;
      });
    }
    if (input.musicS3Key) {
      musicPath = path.join(dir, "music.mp3");
      await downloadToFile(input.musicS3Key, musicPath).catch(() => {
        musicPath = null;
      });
    }

    if (voicePath && musicPath) {
      const r = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        decoratedPath,
        "-i",
        voicePath,
        "-stream_loop",
        "-1",
        "-i",
        musicPath,
        "-filter_complex",
        "[1:a]volume=1.0[v];[2:a]volume=0.22[m];[v][m]amix=inputs=2:duration=first:dropout_transition=2[aout]",
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        finalPath,
      ]);
      if (r.code !== 0) throw new Error(`Ses miksajı başarısız: ${r.err.slice(0, 200)}`);
    } else if (voicePath || musicPath) {
      const audioIn = (voicePath ?? musicPath)!;
      const vol = voicePath ? "1.0" : "0.35";
      const r = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        decoratedPath,
        ...(musicPath && !voicePath ? ["-stream_loop", "-1"] : []),
        "-i",
        audioIn,
        "-af",
        `volume=${vol}`,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        finalPath,
      ]);
      if (r.code !== 0) throw new Error(`Ses eklenemedi: ${r.err.slice(0, 200)}`);
    } else {
      const r = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        decoratedPath,
        "-c:v",
        "copy",
        "-movflags",
        "+faststart",
        finalPath,
      ]);
      if (r.code !== 0) throw new Error(`Çıktı hazırlanamadı: ${r.err.slice(0, 200)}`);
    }

    const outDuration = await probeVideoDuration(finalPath);
    const uploadId = await savePipelineMp4({
      tenantId: input.tenantId,
      body: readFileSync(finalPath),
      name: `AI Storyboard · ${input.storyboard.title}`,
      durationSec: outDuration,
    });
    return { uploadId, durationSec: outDuration };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function probeVideoSize(filePath: string): Promise<{ w: number; h: number }> {
  const r = await runCmd(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", filePath],
    15_000,
  );
  const m = r.out.trim().match(/^(\d+)x(\d+)$/);
  if (m) return { w: Number(m[1]), h: Number(m[2]) };
  return { w: 720, h: 1280 };
}

function buildAtempoChain(speed: number): string {
  const s = Math.max(0.5, Math.min(2.5, speed));
  const parts: string[] = [];
  let rem = s;
  while (rem > 2.0) {
    parts.push("atempo=2.0");
    rem /= 2.0;
  }
  while (rem < 0.5) {
    parts.push("atempo=0.5");
    rem /= 0.5;
  }
  parts.push(`atempo=${rem.toFixed(3)}`);
  return parts.join(",");
}

function fmtAssTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const secs = String(Math.floor(s % 60)).padStart(2, "0");
  const cs = String(Math.floor((s % 1) * 100)).padStart(2, "0");
  return `${h}:${m}:${secs}.${cs}`;
}

function escAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N").trim();
}

function remapTimestampForIntervals(
  t: number,
  intervals: { startSec: number; endSec: number }[],
): number | null {
  let acc = 0;
  for (const iv of intervals) {
    if (t >= iv.startSec && t <= iv.endSec) {
      return acc + (t - iv.startSec);
    }
    if (t < iv.startSec) {
      return acc;
    }
    acc += iv.endSec - iv.startSec;
  }
  return null;
}

function buildAiEditAss(input: {
  playResX: number;
  playResY: number;
  subtitleStyle?: "classic" | "bold-yellow" | "box";
  subtitles?: { startSec: number; endSec: number; text: string }[];
  hookTitle?: { enabled: boolean; text: string; durationSec: number; position: "top" | "center" } | null;
}): string | null {
  const hasSubs = (input.subtitles?.length ?? 0) > 0;
  const hasHook = !!(input.hookTitle?.enabled && input.hookTitle.text.trim());
  if (!hasSubs && !hasHook) return null;

  const style = input.subtitleStyle ?? "bold-yellow";
  const fontSize = Math.max(24, Math.round(input.playResY * 0.036));
  const hookSize = Math.max(30, Math.round(input.playResY * 0.044));
  const marginV = Math.round(input.playResY * 0.11);
  const hookMarginV = input.hookTitle?.position === "center" ? Math.round(input.playResY * 0.42) : Math.round(input.playResY * 0.12);
  const hookAlign = input.hookTitle?.position === "center" ? 5 : 8;

  // ASS colors: &HAABBGGRR
  const subStyleLine =
    style === "bold-yellow"
      ? `Style: Sub,Arial,${fontSize},&H0000E5FF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1.5,2,36,36,${marginV},1`
      : style === "box"
        ? `Style: Sub,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&HB0000000,-1,0,0,0,100,100,0,0,3,8,0,2,36,36,${marginV},1`
        : `Style: Sub,Arial,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.5,1,2,36,36,${marginV},1`;

  const hookStyleLine = `Style: Hook,Arial,${hookSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&HC0000000,-1,0,0,0,100,100,0,0,3,10,0,${hookAlign},44,44,${hookMarginV},1`;

  const lines: string[] = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${input.playResX}`,
    `PlayResY: ${input.playResY}`,
    "WrapStyle: 1",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    subStyleLine,
    hookStyleLine,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  if (hasHook && input.hookTitle) {
    const dur = Math.max(1, Math.min(8, input.hookTitle.durationSec || 3));
    lines.push(`Dialogue: 2,${fmtAssTime(0.1)},${fmtAssTime(dur)},Hook,,0,0,0,,{\\fad(180,220)}${escAssText(input.hookTitle.text)}`);
  }

  if (hasSubs && input.subtitles) {
    for (const s of input.subtitles) {
      if (!s.text.trim() || s.endSec <= s.startSec) continue;
      lines.push(`Dialogue: 1,${fmtAssTime(s.startSec)},${fmtAssTime(s.endSec)},Sub,,0,0,0,,${escAssText(s.text)}`);
    }
  }

  return lines.join("\n") + "\n";
}

/**
 * AI Video Edit planını FFmpeg komutlarına çevirip çalıştırır:
 * Sessizlik kesme, kırpma, en-boy uyarlama, hız, renk tonu, kanca başlık,
 * otomatik Türkçe altyazı (ASS), ses miksajı (orijinal + müzik / seslendirme) ve AI B-roll birleştirme.
 */
export async function renderAiVideoEdit(input: {
  tenantId: string;
  sourceUploadId: string;
  plan: EditPlan;
  keepIntervals?: { startSec: number; endSec: number }[] | null;
  musicS3Key?: string | null;
  voiceoverS3Key?: string | null;
  regeneratedClipS3Key?: string | null;
}): Promise<{ uploadId: string; durationSec: number | null }> {
  const source = await getOwnedUpload(input.tenantId, input.sourceUploadId);
  const dir = mkdtempSync(path.join(tmpdir(), "nv-aiedit-"));
  try {
    const srcPath = path.join(dir, `src${path.extname(source.s3Key) || ".mp4"}`);
    await downloadToFile(source.s3Key, srcPath);
    const srcDuration = await probeVideoDuration(srcPath);
    if (srcDuration == null) throw new Error("Kaynak video okunamadı.");

    let workingPath = srcPath;
    let workingDuration = srcDuration;
    const srcHasAudio = await probeHasAudio(srcPath);

    // 1. Trim sınırlarını hesapla
    const start = Math.max(0, input.plan.trim?.startSec ?? 0);
    const endRaw = input.plan.trim?.endSec ?? input.plan.trim?.targetDurationSec ?? srcDuration;
    const end = Math.min(Math.max(start + 1, endRaw), Math.min(srcDuration, start + 180));

    // 2. Sessizlik kesme (removeSilences) aktifse ve anlamlı aralıklar varsa önce kes-birleştir
    let appliedIntervals: { startSec: number; endSec: number }[] | null = null;
    if (
      input.plan.removeSilences?.enabled &&
      input.keepIntervals &&
      input.keepIntervals.length > 0 &&
      input.keepIntervals.length <= 45
    ) {
      const clipped = input.keepIntervals
        .map((iv) => ({ startSec: Math.max(start, iv.startSec), endSec: Math.min(end, iv.endSec) }))
        .filter((iv) => iv.endSec - iv.startSec >= 0.2);

      const keptTotal = clipped.reduce((s, x) => s + (x.endSec - x.startSec), 0);
      if (clipped.length >= 1 && keptTotal >= 1.5 && keptTotal < end - start - 0.35) {
        const cutPath = path.join(dir, "silence-cut.mp4");
        const fParts: string[] = [];
        const concatIn: string[] = [];
        clipped.forEach((iv, idx) => {
          fParts.push(`[0:v]trim=start=${iv.startSec.toFixed(3)}:end=${iv.endSec.toFixed(3)},setpts=PTS-STARTPTS[v${idx}]`);
          if (srcHasAudio) {
            fParts.push(`[0:a]atrim=start=${iv.startSec.toFixed(3)}:end=${iv.endSec.toFixed(3)},asetpts=PTS-STARTPTS[a${idx}]`);
            concatIn.push(`[v${idx}][a${idx}]`);
          } else {
            concatIn.push(`[v${idx}]`);
          }
        });
        fParts.push(`${concatIn.join("")}concat=n=${clipped.length}:v=1:a=${srcHasAudio ? 1 : 0}[vout]${srcHasAudio ? "[aout]" : ""}`);
        const cutArgs = [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          srcPath,
          "-filter_complex",
          fParts.join(";"),
          "-map",
          "[vout]",
          ...(srcHasAudio ? ["-map", "[aout]", "-c:a", "aac", "-b:a", "128k"] : ["-an"]),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "22",
          "-pix_fmt",
          "yuv420p",
          cutPath,
        ];
        const rCut = await runCmd("ffmpeg", cutArgs, 240_000);
        if (rCut.code === 0) {
          workingPath = cutPath;
          workingDuration = (await probeVideoDuration(cutPath)) ?? keptTotal;
          appliedIntervals = clipped;
        }
      }
    }

    // 3. Hedef çözünürlük / en-boy oranı ve ASS altyazı + kanca başlık hazırla
    const rawSize = await probeVideoSize(workingPath);
    const vFilters: string[] = [];
    let outW = rawSize.w;
    let outH = rawSize.h;

    if (input.plan.aspect !== "orijinal") {
      const target = TARGET_SIZE[input.plan.aspect];
      outW = target.w;
      outH = target.h;
      vFilters.push(`scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}`);
    } else {
      const scaleFactor = Math.min(1, (rawSize.h > rawSize.w ? 720 : 1280) / Math.max(rawSize.w, rawSize.h));
      outW = Math.max(2, Math.floor((rawSize.w * scaleFactor) / 2) * 2);
      outH = Math.max(2, Math.floor((rawSize.h * scaleFactor) / 2) * 2);
      vFilters.push(`scale=${outW}:${outH}`);
    }

    const speed = input.plan.speed ?? 1;
    if (speed !== 1) vFilters.push(`setpts=PTS/${speed}`);
    const look = LOOK_FILTER[input.plan.colorLook ?? "orijinal"];
    if (look) vFilters.push(look);

    const effDuration = (appliedIntervals ? workingDuration : end - start) / speed;
    if (input.plan.transition !== "cut") {
      vFilters.push("fade=t=in:st=0:d=0.35");
      if (effDuration > 1.2) vFilters.push(`fade=t=out:st=${(effDuration - 0.35).toFixed(2)}:d=0.35`);
    }

    // Altyazı zamanlamalarını trim / silence-cut / speed'e göre hizala
    let subLines: { startSec: number; endSec: number; text: string }[] = [];
    if (input.plan.subtitles?.enabled && input.plan.subtitles.lines.length > 0) {
      for (const l of input.plan.subtitles.lines) {
        let s0: number | null;
        let s1: number | null;
        if (appliedIntervals) {
          s0 = remapTimestampForIntervals(l.startSec, appliedIntervals);
          s1 = remapTimestampForIntervals(l.endSec, appliedIntervals);
        } else {
          s0 = Math.max(0, l.startSec - start);
          s1 = Math.min(end - start, l.endSec - start);
        }
        if (s0 != null && s1 != null && s1 > s0 + 0.15) {
          subLines.push({ startSec: s0 / speed, endSec: s1 / speed, text: l.text });
        }
      }
    }

    const assContent = buildAiEditAss({
      playResX: outW,
      playResY: outH,
      subtitleStyle: input.plan.subtitleStyle,
      subtitles: subLines,
      hookTitle: input.plan.hookTitle ?? null,
    });
    if (assContent) {
      const assPath = path.join(dir, "overlays.ass");
      writeFileSync(assPath, assContent, "utf8");
      const escaped = assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      vFilters.push(`ass='${escaped}'`);
    }

    vFilters.push("fps=30,format=yuv420p");

    const workingHasAudio = await probeHasAudio(workingPath);
    const keepOriginalAudio = workingHasAudio && !input.plan.audioMix?.muteOriginal;

    const baseEditPath = path.join(dir, "edited-base.mp4");
    const baseArgs: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
    if (!appliedIntervals && (start > 0 || end < srcDuration - 0.1)) {
      baseArgs.push("-ss", String(start), "-to", String(end));
    }
    baseArgs.push("-i", workingPath, "-vf", vFilters.join(","));

    if (!keepOriginalAudio) {
      baseArgs.push("-an");
    } else {
      const aFilters: string[] = [];
      if (speed !== 1) aFilters.push(buildAtempoChain(speed));
      if (input.plan.audioMix?.normalizeAudio !== false) aFilters.push("loudnorm=I=-16:TP=-1.5:LRA=11");
      if (aFilters.length) baseArgs.push("-af", aFilters.join(","));
      baseArgs.push("-c:a", "aac", "-b:a", "160k");
    }
    baseArgs.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", baseEditPath);
    const rBase = await runCmd("ffmpeg", baseArgs, 240_000);
    if (rBase.code !== 0) throw new Error(`Video düzenlenemedi: ${rBase.err.slice(0, 240)}`);

    // 4. Ses miksajı: orijinal konuşma + fon müziği / seslendirme
    let mixedPath = baseEditPath;
    let voicePath: string | null = null;
    let musicPath: string | null = null;
    if (input.voiceoverS3Key) {
      voicePath = path.join(dir, "voice.mp3");
      await downloadToFile(input.voiceoverS3Key, voicePath).catch(() => {
        voicePath = null;
      });
    }
    if (input.musicS3Key) {
      musicPath = path.join(dir, "music.mp3");
      await downloadToFile(input.musicS3Key, musicPath).catch(() => {
        musicPath = null;
      });
    }

    const baseHasAudio = await probeHasAudio(baseEditPath);
    const musicVol = Math.max(0.06, Math.min(0.85, input.plan.audioMix?.musicVolume ?? (baseHasAudio || voicePath ? 0.2 : 0.35)));

    if (voicePath || musicPath) {
      const audioOut = path.join(dir, "edited-audio.mp4");
      const mArgs: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-i", baseEditPath];
      const audioInputs: string[] = [];
      const fParts: string[] = [];
      let nextIdx = 1;

      if (baseHasAudio && !voicePath) {
        fParts.push("[0:a]volume=1.0[a_orig]");
        audioInputs.push("[a_orig]");
      } else if (baseHasAudio && voicePath) {
        fParts.push("[0:a]volume=0.18[a_orig]");
        audioInputs.push("[a_orig]");
      }

      if (voicePath) {
        mArgs.push("-i", voicePath);
        fParts.push(`[${nextIdx}:a]volume=1.0[a_voice]`);
        audioInputs.push("[a_voice]");
        nextIdx++;
      }
      if (musicPath) {
        mArgs.push("-stream_loop", "-1", "-i", musicPath);
        fParts.push(`[${nextIdx}:a]volume=${musicVol.toFixed(2)}[a_music]`);
        audioInputs.push("[a_music]");
        nextIdx++;
      }

      if (audioInputs.length === 1) {
        const single = audioInputs[0]!;
        const rAud = await runCmd("ffmpeg", [
          ...mArgs,
          "-filter_complex",
          fParts.join(";"),
          "-map",
          "0:v:0",
          "-map",
          single,
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-movflags",
          "+faststart",
          audioOut,
        ]);
        if (rAud.code === 0) mixedPath = audioOut;
      } else {
        fParts.push(`${audioInputs.join("")}amix=inputs=${audioInputs.length}:duration=first:dropout_transition=2[aout]`);
        const rAud = await runCmd("ffmpeg", [
          ...mArgs,
          "-filter_complex",
          fParts.join(";"),
          "-map",
          "0:v:0",
          "-map",
          "[aout]",
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-movflags",
          "+faststart",
          audioOut,
        ]);
        if (rAud.code === 0) mixedPath = audioOut;
      }
    }

    // 5. Opsiyonel fal.ai B-roll sahnesini (intro veya outro) aynı çözünürlük ve ses uyumuyla ekle
    let finalPath = mixedPath;
    if (input.regeneratedClipS3Key) {
      const regenRaw = path.join(dir, "regen.mp4");
      const spliced = path.join(dir, "spliced.mp4");
      await downloadToFile(input.regeneratedClipS3Key, regenRaw);
      const regenDur = (await probeVideoDuration(regenRaw)) ?? 5;
      const mixedHasAudio = await probeHasAudio(mixedPath);
      const isOutro = input.plan.regenerateScene?.position === "outro";

      const firstIn = isOutro ? mixedPath : regenRaw;
      const secondIn = isOutro ? regenRaw : mixedPath;
      const regenIdx = isOutro ? 1 : 0;
      const mainIdx = isOutro ? 0 : 1;

      const spliceFilter = mixedHasAudio
        ? [
            `[${regenIdx}:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},fps=30,format=yuv420p[vr]`,
            `[${mainIdx}:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},fps=30,format=yuv420p[vm]`,
            `anullsrc=channel_layout=stereo:sample_rate=44100,atrim=0:${regenDur.toFixed(2)}[ar]`,
            `[${mainIdx}:a]aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo[am]`,
            isOutro ? "[vm][am][vr][ar]concat=n=2:v=1:a=1[v][a]" : "[vr][ar][vm][am]concat=n=2:v=1:a=1[v][a]",
          ].join(";")
        : [
            `[0:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},fps=30,format=yuv420p[v0]`,
            `[1:v]scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH},fps=30,format=yuv420p[v1]`,
            "[v0][v1]concat=n=2:v=1:a=0[v]",
          ].join(";");

      const rSplice = await runCmd(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          firstIn,
          "-i",
          secondIn,
          "-filter_complex",
          spliceFilter,
          "-map",
          "[v]",
          ...(mixedHasAudio ? ["-map", "[a]", "-c:a", "aac", "-b:a", "192k"] : ["-an"]),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "22",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          spliced,
        ],
        240_000,
      );
      if (rSplice.code === 0) finalPath = spliced;
    }

    const outDuration = await probeVideoDuration(finalPath);
    const uploadId = await savePipelineMp4({
      tenantId: input.tenantId,
      parentUploadId: source.id,
      body: readFileSync(finalPath),
      name: `${source.name ?? "Video"} (AI Edit)`,
      durationSec: outDuration,
    });
    return { uploadId, durationSec: outDuration };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

