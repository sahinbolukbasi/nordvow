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
  canli: "eq=saturation=1.35:contrast=1.08",
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

/**
 * AI Video Edit planını FFmpeg komutlarına çevirip çalıştırır.
 */
export async function renderAiVideoEdit(input: {
  tenantId: string;
  sourceUploadId: string;
  plan: EditPlan;
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

    // Eğer belirli bir sahne yeniden üretildiyse, başa veya sona ekle (normalize edilmiş H.264).
    let activeInput = srcPath;
    if (input.regeneratedClipS3Key) {
      const regenRaw = path.join(dir, "regen.mp4");
      const spliced = path.join(dir, "spliced.mp4");
      await downloadToFile(input.regeneratedClipS3Key, regenRaw);
      const r = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        regenRaw,
        "-i",
        srcPath,
        "-filter_complex",
        "[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p[v0];[1:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,fps=30,format=yuv420p[v1];[v0][v1]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        spliced,
      ]);
      if (r.code === 0) activeInput = spliced;
    }

    const start = Math.max(0, input.plan.trim?.startSec ?? 0);
    const endRaw = input.plan.trim?.endSec ?? input.plan.trim?.targetDurationSec ?? srcDuration;
    const end = Math.min(Math.max(start + 1, endRaw), start + 180);

    const vFilters: string[] = [];
    if (input.plan.aspect !== "orijinal") {
      const ratioMap = { "9:16": 9 / 16, "1:1": 1, "16:9": 16 / 9 } as const;
      const a = ratioMap[input.plan.aspect].toFixed(6);
      vFilters.push(`crop='if(gt(iw/ih,${a}),ih*${a},iw)':'if(gt(iw/ih,${a}),ih,iw/${a})'`);
    }
    vFilters.push("scale='trunc(min(iw,if(gt(ih,iw),720,1280))/2)*2':-2");
    if (input.plan.speed !== 1) vFilters.push(`setpts=PTS/${input.plan.speed}`);
    const look = LOOK_FILTER[input.plan.colorLook ?? "orijinal"];
    if (look) vFilters.push(look);
    if (input.plan.transition !== "cut") {
      const outDur = (end - start) / input.plan.speed;
      vFilters.push("fade=t=in:st=0:d=0.4");
      if (outDur > 1.2) vFilters.push(`fade=t=out:st=${(outDur - 0.4).toFixed(2)}:d=0.4`);
    }

    if (input.plan.subtitles?.enabled && input.plan.subtitles.lines.length > 0) {
      const srtPath = path.join(dir, "edit-subs.srt");
      writeFileSync(srtPath, buildSrtContent(input.plan.subtitles.lines), "utf8");
      const escaped = srtPath.replace(/\\/g, "/").replace(/:/g, "\\:");
      vFilters.push(`subtitles='${escaped}':force_style='FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,Alignment=2,MarginV=42'`);
    }

    const hasAudio = await probeHasAudio(activeInput);
    const baseEditPath = path.join(dir, "edited-base.mp4");
    const baseArgs = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(start),
      "-to",
      String(end),
      "-i",
      activeInput,
      "-vf",
      vFilters.join(","),
    ];
    if (!hasAudio || input.plan.audioMix?.muteOriginal || input.voiceoverS3Key || input.musicS3Key) {
      baseArgs.push("-an");
    } else {
      if (input.plan.speed !== 1) baseArgs.push("-af", `atempo=${Math.min(2, Math.max(0.5, input.plan.speed))}`);
      baseArgs.push("-c:a", "aac", "-b:a", "128k");
    }
    baseArgs.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", baseEditPath);
    const rBase = await runCmd("ffmpeg", baseArgs, 240_000);
    if (rBase.code !== 0) throw new Error(`Video düzenlenemedi: ${rBase.err.slice(0, 240)}`);

    let finalPath = baseEditPath;
    if (input.voiceoverS3Key || input.musicS3Key) {
      const audioOut = path.join(dir, "edited-audio.mp4");
      const audioFile = path.join(dir, "mix.mp3");
      await downloadToFile((input.voiceoverS3Key ?? input.musicS3Key)!, audioFile);
      const rAud = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        baseEditPath,
        ...(input.musicS3Key && !input.voiceoverS3Key ? ["-stream_loop", "-1"] : []),
        "-i",
        audioFile,
        "-af",
        input.voiceoverS3Key ? "volume=1.0" : `volume=${input.plan.audioMix?.musicVolume ?? 0.28}`,
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
        audioOut,
      ]);
      if (rAud.code === 0) finalPath = audioOut;
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

