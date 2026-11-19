import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../../db";
import { DomainError } from "../../domain/errors";
import { envStr } from "../../env";
import { converseStructured } from "../../llm/bedrock";
import { bucket, s3 } from "../../storage/s3";
import { embedC2pa } from "../c2pa";
import { resolveFalKey } from "../fal";
import { downloadToFile, getOwnedUpload, presignCreativeGet } from "../uploads";
import { objectStore } from "../../channels/raw-store";
import { compileTimelineAss, splitSegmentsIntoCaptions, type RawTranscriptSegment } from "./captions";
import { ticksToSeconds } from "./time";
import { timelineTotalDurationTicks, type OverlayTrack, type StudioTimeline } from "./timeline-schema";
import type { SilenceRange } from "./ops";

export type RenderQuality = "draft" | "standard" | "high";

export type RenderAssetInput = {
  id: string;
  localPath: string;
  kind: "video" | "image" | "audio";
  hasAudio: boolean;
};

export type CompiledFfmpegPlan = {
  args: string[];
  inputs: string[];
  assContent: string | null;
  totalDurationSec: number;
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

function buildAtempoChain(speed: number): string {
  const s = Math.max(0.25, Math.min(4, speed));
  const filters: string[] = [];
  let rem = s;
  while (rem > 2.0) {
    filters.push("atempo=2.0");
    rem /= 2.0;
  }
  while (rem < 0.5) {
    filters.push("atempo=0.5");
    rem /= 0.5;
  }
  filters.push(`atempo=${rem.toFixed(3)}`);
  return filters.join(",");
}

/**
 * Saf (pure) FFmpeg derleyici:
 * `StudioTimeline` JSON'unu `-protocol_whitelist file,pipe` güvenli argüman dizisine + ASS dosyasına çevirir.
 */
export function compileTimelineFfmpeg(
  timeline: StudioTimeline,
  assetsMap: Map<string, RenderAssetInput>,
  opts: {
    outputPath: string;
    assPath?: string;
    quality?: RenderQuality;
  },
): CompiledFfmpegPlan {
  const quality = opts.quality ?? "standard";
  const fps = timeline.settings.fps;
  const totalSec = Math.max(1, Number(ticksToSeconds(timelineTotalDurationTicks(timeline)).toFixed(3)));
  const srcW = timeline.settings.canvas.width;
  const srcH = timeline.settings.canvas.height;
  const outW = quality === "draft" ? Math.round((srcW * 720) / Math.max(srcW, srcH) / 2) * 2 || 720 : srcW;
  const outH = quality === "draft" ? Math.round((srcH * 720) / Math.max(srcW, srcH) / 2) * 2 || 1280 : srcH;
  const crf = quality === "high" ? "17" : quality === "draft" ? "26" : "20";
  const preset = quality === "draft" ? "veryfast" : "medium";

  const inputs: string[] = [];
  const inputArgs: string[] = [];
  const inputIdxMap = new Map<string, number>();

  const registerInput = (assetId: string, loopImageDur?: number): number | null => {
    const asset = assetsMap.get(assetId);
    if (!asset) return null;
    const key = loopImageDur ? `${assetId}::img` : assetId;
    const existing = inputIdxMap.get(key);
    if (existing !== undefined) return existing;
    const idx = inputs.length;
    inputs.push(asset.localPath);
    if (asset.kind === "image") {
      inputArgs.push("-loop", "1", "-t", String(totalSec), "-i", asset.localPath);
    } else {
      inputArgs.push("-i", asset.localPath);
    }
    inputIdxMap.set(key, idx);
    return idx;
  };

  const mainClips = timeline.tracks.main.hidden ? [] : timeline.tracks.main.elements;
  const overlayVideoClips = timeline.tracks.overlay
    .filter((tr): tr is Extract<OverlayTrack, { type: "video" }> => tr.type === "video" && !tr.hidden)
    .flatMap((tr) => tr.elements);
  const logoClips = timeline.tracks.overlay
    .filter((tr): tr is Extract<OverlayTrack, { type: "graphic" }> => tr.type === "graphic" && !tr.hidden)
    .flatMap((tr) => tr.elements.filter((el) => el.type === "logo"));

  const filterChains: string[] = [];
  const bgColor = timeline.settings.background.type === "color" ? timeline.settings.background.color : "#09090B";
  filterChains.push(`color=c=${bgColor.replace("#", "0x")}:s=${outW}x${outH}:r=${fps}:d=${totalSec}[base0]`);
  let prevV = "[base0]";

  const appendVisualClip = (
    idxNum: number,
    clip: {
      startTime: number;
      duration: number;
      trimStart: number;
      speed?: number;
      crop?: { x: number; y: number; w: number; h: number };
      fadeIn?: number;
      fadeOut?: number;
    },
    inIdx: number,
    isBlurBg = false,
  ) => {
    const startSec = ticksToSeconds(clip.startTime).toFixed(3);
    const durSec = ticksToSeconds(clip.duration).toFixed(3);
    const endSec = (ticksToSeconds(clip.startTime) + ticksToSeconds(clip.duration)).toFixed(3);
    const trimStartSec = ticksToSeconds(clip.trimStart).toFixed(3);
    const speed = clip.speed ?? 1;
    const srcDurSec = (ticksToSeconds(clip.duration) * speed).toFixed(3);

    const vParts: string[] = [
      `trim=start=${trimStartSec}:duration=${srcDurSec}`,
      `setpts=(PTS-STARTPTS)/${speed.toFixed(3)}`,
    ];
    if (isBlurBg) {
      vParts.push(`scale=${outW}:${outH}:force_original_aspect_ratio=increase`, `crop=${outW}:${outH}`, `boxblur=20:2`);
    } else if (clip.crop) {
      vParts.push(
        `crop=iw*${clip.crop.w.toFixed(3)}:ih*${clip.crop.h.toFixed(3)}:iw*${clip.crop.x.toFixed(3)}:ih*${clip.crop.y.toFixed(3)}`,
        `scale=${outW}:${outH}:force_original_aspect_ratio=increase`,
        `crop=${outW}:${outH}`,
      );
    } else {
      vParts.push(
        `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
        `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=${bgColor.replace("#", "0x")}`,
      );
    }
    vParts.push("format=yuva420p");
    if (clip.fadeIn && clip.fadeIn > 0) {
      vParts.push(`fade=t=in:st=0:d=${ticksToSeconds(clip.fadeIn).toFixed(2)}:alpha=1`);
    }
    if (clip.fadeOut && clip.fadeOut > 0 && Number(durSec) > ticksToSeconds(clip.fadeOut) + 0.1) {
      const fOut = ticksToSeconds(clip.fadeOut);
      vParts.push(`fade=t=out:st=${(Number(durSec) - fOut).toFixed(2)}:d=${fOut.toFixed(2)}:alpha=1`);
    }
    vParts.push(`setpts=PTS+${startSec}/TB`);

    const clipLabel = `[vc${idxNum}]`;
    const outLabel = `[vo${idxNum}]`;
    filterChains.push(`[${inIdx}:v]${vParts.join(",")}${clipLabel}`);
    filterChains.push(`${prevV}${clipLabel}overlay=0:0:enable='between(t,${startSec},${endSec})':eof_action=pass${outLabel}`);
    prevV = outLabel;
  };

  let clipSeq = 0;
  for (const clip of mainClips) {
    const inIdx = registerInput(clip.assetId, clip.type === "image" ? totalSec : undefined);
    if (inIdx === null) continue;
    if (timeline.settings.background.type === "blur") {
      appendVisualClip(clipSeq++, { ...clip, speed: "speed" in clip ? clip.speed : 1, crop: undefined }, inIdx, true);
    }
    appendVisualClip(clipSeq++, { ...clip, speed: "speed" in clip ? clip.speed : 1 }, inIdx, false);
  }

  for (const clip of [...overlayVideoClips].reverse()) {
    const inIdx = registerInput(clip.assetId, clip.type === "image" ? totalSec : undefined);
    if (inIdx === null) continue;
    appendVisualClip(clipSeq++, { ...clip, speed: "speed" in clip ? clip.speed : 1 }, inIdx, false);
  }

  // Logo grafik katmanları
  for (const logo of logoClips) {
    const inIdx = registerInput(logo.assetId, totalSec);
    if (inIdx === null) continue;
    const startSec = ticksToSeconds(logo.startTime).toFixed(3);
    const endSec = (ticksToSeconds(logo.startTime) + ticksToSeconds(logo.duration)).toFixed(3);
    const logoW = Math.max(48, Math.round(outW * 0.16 * logo.transform.scale));
    const cx = Math.round(outW / 2 + logo.transform.x * (outW / 2) - logoW / 2);
    const cy = Math.round(outH / 2 + logo.transform.y * (outH / 2) - logoW / 2);
    const clipLabel = `[lg${clipSeq}]`;
    const outLabel = `[lgo${clipSeq}]`;
    clipSeq++;
    filterChains.push(`[${inIdx}:v]scale=${logoW}:-1,format=yuva420p,setpts=PTS+${startSec}/TB${clipLabel}`);
    filterChains.push(`${prevV}${clipLabel}overlay=x=${cx}:y=${cy}:enable='between(t,${startSec},${endSec})':eof_action=pass${outLabel}`);
    prevV = outLabel;
  }

  // Metin + Altyazı + CTA ASS katmanı
  const assContent = compileTimelineAss(timeline);
  const hasDialogue = assContent.includes("Dialogue:");
  if (hasDialogue && opts.assPath) {
    const escapedAss = opts.assPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    filterChains.push(`${prevV}subtitles='${escapedAss}'[vsub]`);
    prevV = "[vsub]";
  }

  // Ses kanalları miksajı + -14 LUFS loudness normalization
  const audioTags: string[] = [];
  let audioSeq = 0;

  if (!timeline.tracks.main.muted) {
    for (const clip of mainClips) {
      if (clip.type !== "video" || !clip.sourceAudio || clip.volume <= 0) continue;
      const asset = assetsMap.get(clip.assetId);
      const inIdx = registerInput(clip.assetId);
      if (!asset?.hasAudio || inIdx === null) continue;
      const trimStartSec = ticksToSeconds(clip.trimStart).toFixed(3);
      const srcDurSec = (ticksToSeconds(clip.duration) * clip.speed).toFixed(3);
      const delayMs = Math.max(0, Math.round(ticksToSeconds(clip.startTime) * 1000));
      const tag = `[aud${audioSeq++}]`;
      filterChains.push(
        `[${inIdx}:a]atrim=start=${trimStartSec}:duration=${srcDurSec},asetpts=PTS-STARTPTS,${buildAtempoChain(clip.speed)},volume=${clip.volume.toFixed(2)},adelay=${delayMs}|${delayMs}${tag}`,
      );
      audioTags.push(tag);
    }
  }

  for (const aTrack of timeline.tracks.audio) {
    if (aTrack.muted) continue;
    for (const el of aTrack.elements) {
      if (el.volume <= 0) continue;
      const asset = assetsMap.get(el.assetId);
      const inIdx = registerInput(el.assetId);
      if (!asset?.hasAudio || inIdx === null) continue;
      const trimStartSec = ticksToSeconds(el.trimStart).toFixed(3);
      const srcDurSec = (ticksToSeconds(el.duration) * el.speed).toFixed(3);
      const delayMs = Math.max(0, Math.round(ticksToSeconds(el.startTime) * 1000));
      const tag = `[aud${audioSeq++}]`;
      filterChains.push(
        `[${inIdx}:a]atrim=start=${trimStartSec}:duration=${srcDurSec},asetpts=PTS-STARTPTS,${buildAtempoChain(el.speed)},volume=${el.volume.toFixed(2)},adelay=${delayMs}|${delayMs}${tag}`,
      );
      audioTags.push(tag);
    }
  }

  const mapArgs: string[] = ["-map", prevV];
  if (audioTags.length === 0) {
    filterChains.push(`anullsrc=r=48000:cl=stereo:d=${totalSec}[aout]`);
    mapArgs.push("-map", "[aout]");
  } else if (audioTags.length === 1) {
    filterChains.push(`${audioTags[0]}loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
    mapArgs.push("-map", "[aout]");
  } else {
    filterChains.push(`${audioTags.join("")}amix=inputs=${audioTags.length}:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
    mapArgs.push("-map", "[aout]");
  }

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "file,pipe",
    ...inputArgs,
    "-filter_complex",
    filterChains.join(";"),
    ...mapArgs,
    "-t",
    String(totalSec),
    "-c:v",
    "libx264",
    "-preset",
    preset,
    "-crf",
    crf,
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "high",
    "-r",
    String(fps),
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    opts.outputPath,
  ];

  return {
    args,
    inputs,
    assContent: hasDialogue ? assContent : null,
    totalDurationSec: totalSec,
  };
}

/** Sunucuda `ffmpeg silencedetect` çalıştırıp sessiz aralıkları döndürür. */
export async function detectAssetSilence(
  tenantId: string,
  assetOrUploadId: string,
  opts: { thresholdDb?: number; minSilenceSec?: number } = {},
): Promise<{ silences: SilenceRange[]; durationSec: number }> {
  const upload = await getOwnedUpload(tenantId, assetOrUploadId);
  const thresholdDb = Math.max(-60, Math.min(-10, opts.thresholdDb ?? -35));
  const minSilenceSec = Math.max(0.2, Math.min(5, opts.minSilenceSec ?? 0.4));

  const dir = mkdtempSync(path.join(tmpdir(), "nv-silence-"));
  try {
    const filePath = path.join(dir, "media.bin");
    await downloadToFile(upload.s3Key, filePath);

    const probe = await runCmd("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath], 15_000);
    const durationSec = Math.max(1, Number(probe.out.trim()) || upload.durationSec || 10);

    const res = await runCmd(
      "ffmpeg",
      ["-hide_banner", "-i", filePath, "-af", `silencedetect=noise=${thresholdDb}dB:d=${minSilenceSec}`, "-f", "null", "-"],
      60_000,
    );
    const silences: SilenceRange[] = [];
    let currentStart: number | null = null;
    for (const line of res.err.split(/\r?\n/)) {
      const mStart = line.match(/silence_start:\s*([0-9.]+)/);
      if (mStart) currentStart = Number(mStart[1]);
      const mEnd = line.match(/silence_end:\s*([0-9.]+)/);
      if (mEnd && currentStart !== null) {
        silences.push({ startSec: currentStart, endSec: Number(mEnd[1]) });
        currentStart = null;
      }
    }
    if (currentStart !== null && currentStart < durationSec) {
      silences.push({ startSec: currentStart, endSec: durationSec });
    }
    return { silences, durationSec };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * fal `fal-ai/wizper` ile otomatik Türkçe transkripsiyon + opsiyonel Bedrock yazım/marka düzeltmesi.
 * Bedrock düzeltmesinde segment ID'leri ve sayısı korunur; tutarsızlık olursa ham metin kullanılır.
 */
export async function transcribeAssetWithAi(
  tenantId: string,
  assetOrUploadId: string,
  opts: {
    language?: string;
    fixWithLlm?: boolean;
    brandGlossary?: string[];
  } = {},
): Promise<{
  provider: "fal" | "mock";
  modelId: string;
  segments: RawTranscriptSegment[];
  captionsCount: number;
  captions: ReturnType<typeof splitSegmentsIntoCaptions>;
}> {
  const upload = await getOwnedUpload(tenantId, assetOrUploadId);
  const lang = (opts.language ?? "tr").trim().slice(0, 8) || "tr";
  const falModel = envStr("STUDIO_FAL_TRANSCRIBE_MODEL", "fal-ai/wizper");
  const falKey = await resolveFalKey();

  let segments: RawTranscriptSegment[] = [];
  let provider: "fal" | "mock" = "mock";

  if (envStr("FAL_MODE", "http") !== "mock" && falKey) {
    const dir = mkdtempSync(path.join(tmpdir(), "nv-wizper-"));
    const tempS3Key = `tmp-audio/${tenantId}/${randomUUID()}.mp3`;
    let uploadedTemp = false;
    try {
      const inPath = path.join(dir, "in.bin");
      const mp3Path = path.join(dir, "audio.mp3");
      await downloadToFile(upload.s3Key, inPath);
      const ex = await runCmd("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", inPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "64k", mp3Path], 60_000);
      if (ex.code === 0) {
        const audioBuf = readFileSync(mp3Path);
        await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: tempS3Key, Body: audioBuf, ContentType: "audio/mpeg" }));
        uploadedTemp = true;
        const audioUrl = await presignCreativeGet(tempS3Key, 900);
        const falRes = await fetch(`https://fal.run/${falModel}`, {
          method: "POST",
          headers: { authorization: `Key ${falKey}`, "content-type": "application/json" },
          body: JSON.stringify({
            audio_url: audioUrl,
            task: "transcribe",
            language: lang,
            chunk_level: "segment",
            max_segment_len: 29,
            merge_chunks: true,
            version: "3",
          }),
          signal: AbortSignal.timeout(90_000),
        });
        if (falRes.ok) {
          const json = (await falRes.json()) as {
            text?: string;
            chunks?: { timestamp?: [number, number | null]; text?: string }[];
          };
          if (Array.isArray(json.chunks) && json.chunks.length > 0) {
            provider = "fal";
            segments = json.chunks
              .filter((c) => typeof c.text === "string" && c.text.trim())
              .map((c, idx) => {
                const startSec = Math.max(0, Number(c.timestamp?.[0] ?? idx * 2));
                const rawEnd = c.timestamp?.[1];
                const endSec = Math.max(startSec + 0.8, Number(rawEnd ?? startSec + 2.5));
                return { id: `seg_${idx + 1}`, startSec, endSec, text: c.text!.trim() };
              });
          }
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      if (uploadedTemp) {
        await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: tempS3Key })).catch(() => undefined);
      }
    }
  }

  if (segments.length === 0) {
    const dur = Math.max(4, Math.round(upload.durationSec ?? 6));
    segments = [
      { id: "seg_1", startSec: 0.2, endSec: Math.min(2.6, dur * 0.45), text: "Bugün sizinle favori ürünümüzü inceliyoruz" },
      { id: "seg_2", startSec: Math.min(2.7, dur * 0.46), endSec: Math.max(3.5, dur - 0.3), text: "Hemen profildeki bağlantıdan detaylı bilgi alabilirsiniz" },
    ];
  }

  // Opsiyonel Bedrock Türkçe yazım & marka sözlüğü düzeltmesi (segment sayısı ve ID doğrulamalı)
  if (opts.fixWithLlm !== false && envStr("LLM_PROVIDER", "mock") === "bedrock" && segments.length > 0) {
    try {
      const glossary = opts.brandGlossary?.filter(Boolean).join(", ") || "Nordvow";
      const schema = {
        type: "object",
        additionalProperties: false,
        required: ["segments"],
        properties: {
          segments: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["id", "text"],
              properties: {
                id: { type: "string" },
                text: { type: "string" },
              },
            },
          },
        },
      };
      const fixed = await converseStructured<{ segments: { id: string; text: string }[] }>({
        system:
          `Türkçe yazım, noktalama ve büyük-küçük harfi düzelt. Marka adlarını şu sözlüğe göre yaz: ${glossary}. ` +
          "Kelime ekleme veya çıkarma yapma, sırayı değiştirme, segment sayısını ve ID'leri kesinlikle değiştirme. Sadece JSON döndür.",
        turns: [{ role: "user", text: JSON.stringify({ segments: segments.map((s) => ({ id: s.id, text: s.text })) }) }],
        schemaName: "caption_fix",
        schema,
        maxTokens: 900,
        temperature: 0.1,
      });
      if (
        fixed.data?.segments &&
        fixed.data.segments.length === segments.length &&
        fixed.data.segments.every((item, idx) => item.id === segments[idx]!.id && item.text.trim().length > 0)
      ) {
        segments = segments.map((s, idx) => ({ ...s, text: fixed.data!.segments[idx]!.text.trim() }));
      }
    } catch {
      // Segment eşleşmezse veya Bedrock erişilemezse ham metin korunur
    }
  }

  const captions = splitSegmentsIntoCaptions(segments);
  return {
    provider,
    modelId: provider === "fal" ? falModel : "mock-wizper",
    segments,
    captionsCount: captions.length,
    captions,
  };
}

/** Bedrock metin zekâsı: Hook (≤60 kr), Senaryo iskeleti, Segment-ID Highlight ve B-Roll önerisi. */
export async function runStudioBedrockAssist(input: {
  mode: "hooks" | "script" | "highlights" | "broll";
  brief?: string;
  durationSec?: number;
  product?: string;
  segments?: RawTranscriptSegment[];
}): Promise<Record<string, unknown>> {
  const brief = (input.brief ?? input.product ?? "Yeni sezon ürün tanıtımı").slice(0, 600);
  if (input.mode === "hooks") {
    if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
      try {
        const res = await converseStructured<{ hooks: { text: string; reason: string }[] }>({
          system: "Sen kısa video hook yazarısın. İlk 3 saniyede izleyiciyi yakalayan, en fazla 60 karakterlik 5 Türkçe hook üret. Sadece JSON döndür.",
          turns: [{ role: "user", text: `Kampanya/Ürün brief: ${brief}` }],
          schemaName: "studio_hooks",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["hooks"],
            properties: {
              hooks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["text", "reason"],
                  properties: { text: { type: "string" }, reason: { type: "string" } },
                },
              },
            },
          },
          maxTokens: 500,
          temperature: 0.4,
        });
        if (res.data?.hooks?.length) {
          return { hooks: res.data.hooks.slice(0, 5).map((h) => ({ text: h.text.slice(0, 60), reason: h.reason })) };
        }
      } catch {
        // fallback below
      }
    }
    return {
      hooks: [
        { text: "Bunu denemeden asla satın alma!", reason: "Merak uyandıran güçlü kanca" },
        { text: "3 saniyede farkı kendin gör", reason: "Hızlı görsel vaat" },
        { text: "Herkesin sorduğu o detayı açıklıyorum", reason: "Topluluk etkileşimi" },
        { text: "Günlük rutinimi tamamen değiştirdi", reason: "Samimi UGC deneyimi" },
        { text: "Sınırlı stok bitmeden hemen kaydet", reason: "Aciliyet ve kaydetme çağrısı" },
      ],
    };
  }

  if (input.mode === "script") {
    const targetDur = input.durationSec ?? 15;
    if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
      try {
        const res = await converseStructured<{
          scenes: { order: number; durationSec: number; shot: string; voiceover: string; onScreenText: string }[];
        }>({
          system: "Türkçe kısa dikey video (Reels/TikTok) çekim senaryosu oluştur. Sadece JSON döndür.",
          turns: [{ role: "user", text: `Ürün/Brief: ${brief}. Hedef süre: ${targetDur} sn.` }],
          schemaName: "studio_script",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["scenes"],
            properties: {
              scenes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["order", "durationSec", "shot", "voiceover", "onScreenText"],
                  properties: {
                    order: { type: "integer" },
                    durationSec: { type: "number" },
                    shot: { type: "string" },
                    voiceover: { type: "string" },
                    onScreenText: { type: "string" },
                  },
                },
              },
            },
          },
          maxTokens: 700,
          temperature: 0.4,
        });
        if (res.data?.scenes?.length) return { scenes: res.data.scenes };
      } catch {
        // fallback
      }
    }
    const sDur = Math.max(3, Math.round(targetDur / 3));
    return {
      scenes: [
        { order: 1, durationSec: sDur, shot: "Yakın plan ürün açılışı", voiceover: "Merak ettiğiniz yeni deneyim burada!", onScreenText: "İlk İzlenim" },
        { order: 2, durationSec: sDur, shot: "Doğal ışıkta kullanım anı", voiceover: "Dokusu ve hızı gerçekten şaşırtıcı.", onScreenText: "Neden Farklı?" },
        { order: 3, durationSec: Math.max(3, targetDur - sDur * 2), shot: "Kapanış + kupon/link yönlendirmesi", voiceover: "Fırsat koduyla hemen inceleyin.", onScreenText: "Şimdi Keşfet" },
      ],
    };
  }

  if (input.mode === "highlights") {
    const segs = input.segments ?? [];
    if (segs.length === 0) {
      return { clips: [] };
    }
    const validIds = new Set(segs.map((s) => s.id));
    if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
      try {
        const res = await converseStructured<{ clips: { startSegId: string; endSegId: string; title: string; score: number; reason: string }[] }>({
          system:
            "Aşağıdaki transkript segmentlerinden en vurucu 1-3 kısa klip aralığını seç. SADECE verilen `id` değerlerini `startSegId` ve `endSegId` olarak döndür; asla saniye uydurma.",
          turns: [{ role: "user", text: JSON.stringify(segs.map((s) => ({ id: s.id, text: s.text }))) }],
          schemaName: "studio_highlights",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["clips"],
            properties: {
              clips: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["startSegId", "endSegId", "title", "score", "reason"],
                  properties: {
                    startSegId: { type: "string" },
                    endSegId: { type: "string" },
                    title: { type: "string" },
                    score: { type: "number" },
                    reason: { type: "string" },
                  },
                },
              },
            },
          },
          maxTokens: 500,
          temperature: 0.2,
        });
        const clean = (res.data?.clips ?? []).filter((c) => validIds.has(c.startSegId) && validIds.has(c.endSegId));
        if (clean.length) {
          return {
            clips: clean.map((c) => {
              const s1 = segs.find((s) => s.id === c.startSegId)!;
              const s2 = segs.find((s) => s.id === c.endSegId)!;
              return { ...c, startSec: s1.startSec, endSec: Math.max(s1.endSec, s2.endSec) };
            }),
          };
        }
      } catch {
        // fallback
      }
    }
    const first = segs[0]!;
    const last = segs[Math.min(segs.length - 1, 1)]!;
    return {
      clips: [
        {
          startSegId: first.id,
          endSegId: last.id,
          title: first.text.slice(0, 42),
          score: 92,
          reason: "En yüksek kanca yoğunluğu",
          startSec: first.startSec,
          endSec: Math.max(first.endSec, last.endSec),
        },
      ],
    };
  }

  // broll
  const segs = input.segments ?? [];
  const firstSeg = segs[0];
  return {
    suggestions: [
      {
        segId: firstSeg?.id ?? "seg_1",
        startSec: firstSeg?.startSec ?? 0.5,
        prompt: `${brief} için yakın plan stüdyo B-roll çekimi, yumuşak gün ışığı, dikey 9:16 kadraj, yazısız temiz sahne`,
      },
    ],
  };
}

/** Sunucuda zaman çizelgesini FFmpeg ile MP4 olarak render eder ve S3 / kitaplığa kaydeder. */
export async function renderStudioTimelineProject(input: {
  tenantId: string;
  projectId: string;
  timeline: StudioTimeline;
  quality?: RenderQuality;
  label?: string;
}): Promise<{ assetId: string; uploadId: string; s3Key: string; durationSec: number; sizeBytes: number }> {
  const dir = mkdtempSync(path.join(tmpdir(), "nv-render-"));
  try {
    // Timeline içinde geçen tüm medya/logo varlıklarını S3'ten yerel diske indir
    const neededAssetIds = new Set<string>();
    for (const el of input.timeline.tracks.main.elements) neededAssetIds.add(el.assetId);
    for (const tr of input.timeline.tracks.overlay) {
      for (const el of tr.elements) {
        if ("assetId" in el && typeof el.assetId === "string") neededAssetIds.add(el.assetId);
      }
    }
    for (const tr of input.timeline.tracks.audio) {
      for (const el of tr.elements) neededAssetIds.add(el.assetId);
    }

    const assetsMap = new Map<string, RenderAssetInput>();
    let idx = 0;
    for (const aid of neededAssetIds) {
      const u = await getOwnedUpload(input.tenantId, aid);
      const ext = u.mime.includes("png") ? "png" : u.mime.includes("jpeg") ? "jpg" : u.kind === "audio" ? "mp3" : "mp4";
      const localPath = path.join(dir, `in_${idx++}_${aid.slice(-6)}.${ext}`);
      await downloadToFile(u.s3Key, localPath);
      const audioCheck =
        u.kind === "image"
          ? false
          : (await runCmd("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", localPath], 10_000)).out.trim().length > 0;
      assetsMap.set(aid, {
        id: aid,
        localPath,
        kind: u.kind === "audio" ? "audio" : u.kind === "image" ? "image" : "video",
        hasAudio: audioCheck,
      });
    }

    const assPath = path.join(dir, "captions.ass");
    const outputPath = path.join(dir, "render.mp4");
    const plan = compileTimelineFfmpeg(input.timeline, assetsMap, {
      outputPath,
      assPath,
      quality: input.quality ?? "standard",
    });
    if (plan.assContent) writeFileSync(assPath, plan.assContent, "utf8");

    const timeoutMs = Math.min(30 * 60_000, Math.max(60_000, Math.round(plan.totalDurationSec * 6 * 1000)));
    const ff = await runCmd("ffmpeg", plan.args, timeoutMs);
    if (ff.code !== 0) {
      throw new DomainError("SUNUCU_HATASI", `Video hazırlanamadı: ${ff.err.slice(0, 220) || "FFmpeg hatası"}`);
    }

    const rawBytes = new Uint8Array(readFileSync(outputPath));
    const title = input.label?.trim() || "Video Editör Çıktısı";
    const promptHash = createHash("sha256").update(`${input.projectId}:${Date.now()}:${title}`).digest("hex");
    const c2pa = embedC2pa({
      assetBytes: rawBytes,
      mime: "video/mp4",
      modelKey: "studio-timeline-ffmpeg",
      modelId: "local/timeline-renderer",
      tenantId: input.tenantId,
      promptHash,
    });

    const jobId = `job_ed_${randomUUID().slice(0, 12)}`;
    const outKey = `generated/${input.tenantId}/${jobId}`;
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: outKey, Body: Buffer.from(c2pa.signedBytes), ContentType: "video/mp4" }));
    await objectStore().put(`${outKey}.c2pa.json`, c2pa.sidecarJson, "application/json").catch(() => undefined);

    const created = await prisma.$transaction(async (tx) => {
      await tx.creativeJob.create({
        data: {
          id: jobId,
          tenantId: input.tenantId,
          modelKey: "ffmpeg-programmatic",
          modelId: "local/timeline-renderer",
          prompt: `Video Editör Export: ${title}`.slice(0, 500),
          promptHash,
          units: 0,
          status: "COMPLETED",
          submittedAt: new Date(),
          completedAt: new Date(),
          inferenceMs: 1200,
        },
      });
      const asset = await tx.generatedAsset.create({
        data: {
          tenantId: input.tenantId,
          jobId,
          modelKey: "ffmpeg-programmatic",
          modelId: "local/timeline-renderer",
          promptHash,
          s3Key: outKey,
          c2paManifestId: c2pa.manifestId,
          isAiGenerated: false,
        },
      });
      const upload = await tx.creativeUpload.create({
        data: {
          tenantId: input.tenantId,
          kind: "video",
          mime: "video/mp4",
          sizeBytes: c2pa.signedBytes.byteLength,
          s3Key: outKey,
          name: `${title.slice(0, 80)} (${input.quality ?? "standard"})`,
          source: "edit",
          durationSec: plan.totalDurationSec,
        },
      });
      return { assetId: asset.id, uploadId: upload.id };
    });

    return {
      assetId: created.assetId,
      uploadId: created.uploadId,
      s3Key: outKey,
      durationSec: plan.totalDurationSec,
      sizeBytes: c2pa.signedBytes.byteLength,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
