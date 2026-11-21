import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { envStr } from "../env";
import { bucket, s3 } from "../storage/s3";
import { resolveFalKey, synthesizeTurkishSpeech } from "../creative/fal";
import { VOICE_TTS_MODELS } from "./types";

export type TtsOutputFormat = "mp3" | "wav8k";

function spawnAsync(cmd: string, args: string[], timeoutMs = 15_000): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", () => {
      clearTimeout(t);
      resolve(-1);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve(code ?? -1);
    });
  });
}

async function transcodeTo8kWav(inputBytes: Uint8Array, inputExt = ".mp3"): Promise<Uint8Array> {
  const dir = mkdtempSync(path.join(tmpdir(), "nv-8k-"));
  try {
    const inFile = path.join(dir, `in${inputExt}`);
    const outFile = path.join(dir, "out8k.wav");
    writeFileSync(inFile, Buffer.from(inputBytes));
    const code = await spawnAsync(
      "ffmpeg",
      ["-y", "-hide_banner", "-loglevel", "error", "-i", inFile, "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le", outFile],
      15_000,
    );
    if (code === 0) return new Uint8Array(readFileSync(outFile));
    return inputBytes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Tek adapter arkasında fal.ai TTS (panelden seçilebilir model) + Amazon Polly Neural (tr-TR) yedeği.
 * Telefon akışı için `format: "wav8k"` seçildiğinde FFmpeg ile 8kHz mono PCM'e çevirir.
 */
export async function synthesizeVoiceSpeech(input: {
  text: string;
  modelKey?: string;
  voiceId?: string;
  format?: TtsOutputFormat;
}): Promise<{ bytes: Uint8Array; mime: string; provider: "fal" | "polly" }> {
  const clean = input.text.replace(/\s+/g, " ").trim().slice(0, 1500);
  const spec = VOICE_TTS_MODELS.find((m) => m.key === input.modelKey) ?? VOICE_TTS_MODELS[0];
  let rawBytes: Uint8Array | null = null;
  let provider: "fal" | "polly" = "polly";

  const falKey = await resolveFalKey();
  if (envStr("FAL_MODE", "mock") === "http" && falKey && spec.endpoint !== "aws-polly") {
    try {
      const voiceName = input.voiceId?.includes("male") ? "Adam" : input.voiceId?.includes("corporate") ? "Aria" : "Rachel";
      const res = await fetch(`https://fal.run/${spec.endpoint}`, {
        method: "POST",
        headers: { authorization: `Key ${falKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          text: clean,
          voice: voiceName,
          language_code: "tr",
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const j = (await res.json()) as { audio?: { url?: string } };
        if (j.audio?.url) {
          const dl = await fetch(j.audio.url, { signal: AbortSignal.timeout(12_000) });
          if (dl.ok) {
            rawBytes = new Uint8Array(await dl.arrayBuffer());
            provider = "fal";
          }
        }
      }
    } catch (e) {
      console.warn("[ttsService] fal TTS yedeğe (Polly) geçti:", (e as Error).message);
    }
  }

  if (!rawBytes) {
    rawBytes = await synthesizeTurkishSpeech(clean);
    provider = "polly";
  }

  if (input.format === "wav8k") {
    return { bytes: await transcodeTo8kWav(rawBytes, ".mp3"), mime: "audio/wav", provider };
  }
  return { bytes: rawBytes, mime: "audio/mpeg", provider };
}

/**
 * Sabit karşılama metinlerini S3'te önbelleğe alır (çağrı açılışında sıfır gecikme).
 */
export async function getOrCacheGreetingAudio(input: {
  brandId: string;
  greetingText: string;
  modelKey: string;
  voiceId: string;
}): Promise<{ s3Key: string; bytes: Uint8Array }> {
  const hash = createHash("sha256").update(`${input.modelKey}:${input.voiceId}:${input.greetingText}`).digest("hex").slice(0, 16);
  const s3Key = `voice-cache/${input.brandId}/greeting-${hash}.wav`;
  try {
    const existing = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: s3Key }));
    if (existing.Body) {
      const bytes = await existing.Body.transformToByteArray();
      if (bytes.byteLength > 100) return { s3Key, bytes };
    }
  } catch {
    /* cache miss */
  }

  const synth = await synthesizeVoiceSpeech({
    text: input.greetingText,
    modelKey: input.modelKey,
    voiceId: input.voiceId,
    format: "wav8k",
  });
  await s3()
    .send(new PutObjectCommand({ Bucket: bucket(), Key: s3Key, Body: synth.bytes, ContentType: "audio/wav" }))
    .catch(() => undefined);
  return { s3Key, bytes: synth.bytes };
}

