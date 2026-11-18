import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../db";
import { bucket, s3 } from "../storage/s3";
import { objectStore } from "../channels/raw-store";
import { embedC2pa } from "./c2pa";
import { synthesizeTurkishSpeech } from "./fal";
import { downloadToFile, getOwnedUpload } from "./uploads";
import type { MotionGraphicLayer, SfxCue, SfxProfile, TimelinePlan, VisionAssetAnalysis } from "./vision-session";

export type SfxLibraryEntry = {
  sfx_key: string;
  category: SfxCue["category"];
  label_tr: string;
  default_duration_ms: number;
  keywords_tr: string[];
};

export const PRODUCT_SFX_CATALOG: SfxLibraryEntry[] = [
  // Kozmetik / Şişe
  { sfx_key: "cap_open_pop", category: "cosmetics", label_tr: "Kapak Açılma (Pop)", default_duration_ms: 320, keywords_tr: ["kapak", "aç", "pop", "şişe", "tık"] },
  { sfx_key: "spray_mist", category: "cosmetics", label_tr: "Sprey / Parfüm Sıkma", default_duration_ms: 520, keywords_tr: ["sprey", "sık", "parfüm", "fıs"] },
  { sfx_key: "glass_clink", category: "cosmetics", label_tr: "Cam Şişe Tıklama", default_duration_ms: 280, keywords_tr: ["cam", "şişe", "kristal"] },
  { sfx_key: "water_drop", category: "cosmetics", label_tr: "Serum / Damla Sesi", default_duration_ms: 300, keywords_tr: ["damla", "serum", "su"] },

  // Kutu Açılımı / E-Ticaret
  { sfx_key: "tape_rip", category: "unboxing", label_tr: "Koli Bandı Yırtılma", default_duration_ms: 580, keywords_tr: ["bant", "yırt", "kargo"] },
  { sfx_key: "box_slide_open", category: "unboxing", label_tr: "Kutu Kapağı Kayma", default_duration_ms: 480, keywords_tr: ["kutu", "açılım", "unboxing", "karton"] },
  { sfx_key: "paper_rustle", category: "unboxing", label_tr: "Ambalaj Kağıdı Hışırtısı", default_duration_ms: 600, keywords_tr: ["kağıt", "pelür", "hışırtı", "ambalaj"] },

  // Teknoloji / Aksesuar
  { sfx_key: "mech_click", category: "tech", label_tr: "Mekanik Tıklama (Click)", default_duration_ms: 180, keywords_tr: ["tıkla", "click", "tuş", "buton", "mekanik"] },
  { sfx_key: "magnetic_snap", category: "tech", label_tr: "Manyetik Kapanma (Snap)", default_duration_ms: 220, keywords_tr: ["manyetik", "kapan", "snap", "mıknatıs"] },
  { sfx_key: "startup_chime", category: "tech", label_tr: "Açılış Chime", default_duration_ms: 650, keywords_tr: ["açılış", "chime", "ding", "başlangıç"] },

  // Giyim / Tekstil
  { sfx_key: "fabric_swoosh", category: "apparel", label_tr: "Kumaş Hışırtısı", default_duration_ms: 420, keywords_tr: ["kumaş", "elbise", "ceket", "kıyafet", "tekstil"] },
  { sfx_key: "zipper_pull", category: "apparel", label_tr: "Fermuar Çekme", default_duration_ms: 460, keywords_tr: ["fermuar", "zip"] },
  { sfx_key: "soft_whoosh", category: "apparel", label_tr: "Yumuşak Geçiş Whoosh", default_duration_ms: 380, keywords_tr: ["whoosh", "geçiş", "geçis", "yumuşak", "hareket"] },

  // Gastronomi & Geçiş
  { sfx_key: "pour_liquid", category: "food", label_tr: "İçecek Dökülme / Köpük", default_duration_ms: 700, keywords_tr: ["kahve", "latte", "dök", "içecek", "buz"] },
  { sfx_key: "crisp_bite", category: "food", label_tr: "Çıtır Doku", default_duration_ms: 240, keywords_tr: ["çıtır", "kruvasan", "tatlı"] },
  { sfx_key: "subtle_whoosh", category: "transition", label_tr: "Hafif Whoosh Geçişi", default_duration_ms: 340, keywords_tr: ["kay", "slide", "geçiş", "hızlı"] },
  { sfx_key: "pop_badge", category: "transition", label_tr: "Yazı / Rozet Pop", default_duration_ms: 200, keywords_tr: ["yazı", "rozet", "fiyat", "indirim", "başlık"] },
];

const DEFAULT_SFX_BY_PROFILE: Record<SfxProfile, string[]> = {
  cosmetics: ["cap_open_pop", "spray_mist", "water_drop"],
  unboxing: ["tape_rip", "box_slide_open", "paper_rustle"],
  tech: ["mech_click", "magnetic_snap", "startup_chime"],
  apparel: ["fabric_swoosh", "zipper_pull", "soft_whoosh"],
  food: ["pour_liquid", "crisp_bite", "subtle_whoosh"],
  ambient: ["subtle_whoosh", "pop_badge"],
};

function findEntry(key: string): SfxLibraryEntry {
  return PRODUCT_SFX_CATALOG.find((x) => x.sfx_key === key) ?? PRODUCT_SFX_CATALOG.find((x) => x.sfx_key === "subtle_whoosh")!;
}

/**
 * Vision analizi + kullanıcı komutuna göre zaman çizelgesi (milisaniye bazlı SFX + Motion Graphics) üretir.
 * Maliyet: 0 AI kredisi (yerleşik kütüphane + programatik timeline).
 */
export function autoPlanProductSfxAndMotion(input: {
  userMessage: string;
  vision?: VisionAssetAnalysis | null;
  currentTimeline?: TimelinePlan | null;
  productTitleHint?: string | null;
}): TimelinePlan {
  const base: TimelinePlan = input.currentTimeline
    ? {
        ...input.currentTimeline,
        sfx_track: [...input.currentTimeline.sfx_track],
        motion_layers: [...input.currentTimeline.motion_layers],
      }
    : {
        duration_ms: 5000,
        aspect_ratio: "9:16",
        clean_ai_base: true,
        color_grade: "orijinal",
        speed_multiplier: 1,
        sfx_track: [],
        motion_layers: [],
        voiceover_script_tr: null,
      };

  const norm = input.userMessage.toLocaleLowerCase("tr");
  const profile: SfxProfile = input.vision?.recommended_sfx_profile ?? "ambient";

  // 1. SFX eşleştirme (kullanıcı komutu öncelikli, yoksa ürün profilinden)
  const matchedKeys: string[] = [];
  for (const item of PRODUCT_SFX_CATALOG) {
    if (item.keywords_tr.some((kw) => norm.includes(kw))) {
      matchedKeys.push(item.sfx_key);
    }
  }
  const wantsSfxExplicitly = /(ses efekt|sfx|tıklama|tiklama|kapak|sprey|damla|hışırtı|fermuar|whoosh|bant|kutu|sesi ekle|pop)/.test(norm);
  if (matchedKeys.length === 0 && (wantsSfxExplicitly || input.vision)) {
    matchedKeys.push(...(DEFAULT_SFX_BY_PROFILE[profile] ?? ["subtle_whoosh", "pop_badge"]));
  }

  if (matchedKeys.length > 0) {
    const uniqueKeys = [...new Set(matchedKeys)].slice(0, 3);
    const cues: SfxCue[] = uniqueKeys.map((key, idx) => {
      const entry = findEntry(key);
      const timestamps = [700, 1900, 3200];
      return {
        id: `sfx_${idx + 1}_${entry.sfx_key}`,
        timestamp_ms: timestamps[idx] ?? 700 + idx * 1200,
        duration_ms: entry.default_duration_ms,
        sfx_key: entry.sfx_key,
        category: entry.category,
        label_tr: entry.label_tr,
        source: "builtin_synth",
        volume: 0.78,
      };
    });
    base.sfx_track = cues;
  }

  // 2. Özel Animasyon / Motion Graphics Katmanları
  const quoteMatch = input.userMessage.match(/["'“”]([^"'“”]{2,48})["'“”]/);
  const derivedHeadline =
    quoteMatch?.[1]?.trim() ||
    input.vision?.detected_brand_text ||
    input.productTitleHint?.trim() ||
    input.vision?.subject_summary_tr ||
    "Yeni Sezon";

  const wantsSlide = /(soldan kay|kayan yazı|ürün adı|urun adi|başlık|baslik|isim.*gelsin|animasyon|motion|grafik)/.test(norm);
  const wantsBadge = /(fiyat|indirim|rozet|badge|etiket|tl|%|kampanya)/.test(norm);
  const wantsSubtitle = /(altyazı|altyazi|subtitle|kinetik)/.test(norm);

  const layers: MotionGraphicLayer[] = wantsSlide || wantsBadge || wantsSubtitle ? [] : [...base.motion_layers];

  if (wantsSlide) {
    layers.push({
      id: `mg_slide_${Date.now()}`,
      type: "feature_callout",
      start_ms: 1100,
      end_ms: 4600,
      text: derivedHeadline.slice(0, 38),
      position: "left_slide",
      animation: "slide_left",
      accent_color: "#ffffff",
    });
    if (!base.sfx_track.some((c) => c.sfx_key === "subtle_whoosh" || c.sfx_key === "soft_whoosh")) {
      const wh = findEntry("subtle_whoosh");
      base.sfx_track.push({
        id: "sfx_motion_whoosh",
        timestamp_ms: 1050,
        duration_ms: wh.default_duration_ms,
        sfx_key: wh.sfx_key,
        category: "transition",
        label_tr: wh.label_tr,
        source: "builtin_synth",
        volume: 0.65,
      });
    }
  }

  if (wantsBadge) {
    const pctOrPrice = input.userMessage.match(/(%\d+|\d+\s*(?:tl|₺))/i)?.[1] ?? "Özel Teklif";
    layers.push({
      id: `mg_badge_${Date.now()}`,
      type: "price_badge",
      start_ms: 1800,
      end_ms: 4800,
      text: pctOrPrice.toUpperCase(),
      position: "top_right_badge",
      animation: "pop_spring",
      accent_color: "#ff2bd6",
    });
  }

  if (wantsSubtitle && !wantsSlide) {
    layers.push({
      id: `mg_sub_${Date.now()}`,
      type: "kinetic_subtitle",
      start_ms: 400,
      end_ms: 4500,
      text: (quoteMatch?.[1] ?? input.vision?.subject_summary_tr ?? "Öne çıkan yeni tasarım").slice(0, 46),
      position: "bottom_safe",
      animation: "fade_up",
      accent_color: "#ffffff",
    });
  }

  // 3. Kırpma / Hız / Renk / Oran ayarları (0 Kredi)
  if (norm.includes("9:16")) base.aspect_ratio = "9:16";
  else if (norm.includes("1:1")) base.aspect_ratio = "1:1";
  else if (norm.includes("4:5")) base.aspect_ratio = "4:5";
  else if (norm.includes("16:9")) base.aspect_ratio = "16:9";

  if (/canlı|canli|parlak/.test(norm)) base.color_grade = "canli";
  else if (/siyah beyaz|siyah-beyaz/.test(norm)) base.color_grade = "siyah-beyaz";
  else if (/sıcak|sicak|altın/.test(norm)) base.color_grade = "sicak";
  else if (/soğuk|soguk/.test(norm)) base.color_grade = "soguk";

  if (/hızlandır|hizlandir|2x/.test(norm)) base.speed_multiplier = 1.4;
  else if (/yavaşlat|yavaslat|slow/.test(norm)) base.speed_multiplier = 0.75;

  base.motion_layers = layers.slice(0, 4);
  base.sfx_track = base.sfx_track.sort((a, b) => a.timestamp_ms - b.timestamp_ms).slice(0, 5);
  return base;
}

/**
 * Prosedürel 44.1kHz Stereo 16-bit PCM WAV SFX Sentezleyicisi:
 * Harici API maliyeti olmadan milisaniye bazlı gerçekçi mekanik tık, kapak pop, sprey sisi,
 * kağıt/kumaş hışırtısı, kristal chime ve whoosh geçişleri üretir.
 */
export function synthesizeTimelineSfxWav(timeline: TimelinePlan): Buffer {
  const sampleRate = 44100;
  const totalSec = Math.max(1, Math.min(30, timeline.duration_ms / 1000));
  const totalSamples = Math.floor(sampleRate * totalSec);
  const mixL = new Float32Array(totalSamples);
  const mixR = new Float32Array(totalSamples);

  // Deterministic pseudo-random generator for rich filtered noise (spray/rustle/whoosh)
  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };

  for (const cue of timeline.sfx_track) {
    const startIdx = Math.max(0, Math.floor((cue.timestamp_ms / 1000) * sampleRate));
    const cueLen = Math.max(400, Math.floor((cue.duration_ms / 1000) * sampleRate));
    const vol = Math.max(0.05, Math.min(1, cue.volume));

    let lp = 0;
    for (let i = 0; i < cueLen && startIdx + i < totalSamples; i++) {
      const t = i / sampleRate;
      const u = i / cueLen;
      let s = 0;

      switch (cue.sfx_key) {
        case "cap_open_pop":
        case "pop_badge": {
          // Rising frequency chirp + short transient pop
          const f = 190 + 520 * Math.pow(u, 0.45);
          const env = Math.exp(-u * 6.5) * Math.sin(Math.min(1, u * 10) * (Math.PI / 2));
          s = (Math.sin(2 * Math.PI * f * t) * 0.8 + rand() * 0.15 * Math.exp(-u * 14)) * env;
          break;
        }
        case "mech_click":
        case "magnetic_snap": {
          // Sharp metallic damped click at two resonant frequencies
          const env = Math.exp(-u * 16);
          const f1 = cue.sfx_key === "magnetic_snap" ? 1150 : 1850;
          const f2 = cue.sfx_key === "magnetic_snap" ? 640 : 3200;
          s = (Math.sin(2 * Math.PI * f1 * t) * 0.65 + Math.sin(2 * Math.PI * f2 * t) * 0.35 + rand() * 0.25) * env;
          break;
        }
        case "glass_clink":
        case "water_drop": {
          const baseF = cue.sfx_key === "glass_clink" ? 2680 : 620 + 680 * u;
          const env = Math.exp(-u * 8);
          s = (Math.sin(2 * Math.PI * baseF * t) * 0.75 + Math.sin(2 * Math.PI * baseF * 1.5 * t) * 0.25) * env;
          break;
        }
        case "startup_chime": {
          const env = Math.sin(Math.min(1, u * 12) * (Math.PI / 2)) * Math.exp(-u * 4.5);
          s = (Math.sin(2 * Math.PI * 880 * t) * 0.5 + Math.sin(2 * Math.PI * 1318.5 * t) * 0.35 + Math.sin(2 * Math.PI * 1760 * t) * 0.2) * env;
          break;
        }
        case "spray_mist":
        case "paper_rustle":
        case "fabric_swoosh":
        case "tape_rip": {
          // Filtered white/pink noise burst with attack-decay envelope
          const env = Math.sin(Math.PI * Math.pow(u, 0.6));
          const raw = rand();
          const alpha = cue.sfx_key === "spray_mist" ? 0.65 : cue.sfx_key === "fabric_swoosh" ? 0.22 : 0.42;
          lp = lp + alpha * (raw - lp);
          const texture = cue.sfx_key === "tape_rip" ? Math.sin(2 * Math.PI * 42 * t) * 0.5 + 0.5 : 1;
          s = (raw - lp * 0.4) * env * texture * 0.65;
          break;
        }
        case "box_slide_open":
        case "zipper_pull":
        case "pour_liquid": {
          const env = Math.sin(Math.PI * u);
          const raw = rand();
          lp = lp + 0.25 * (raw - lp);
          const mod = cue.sfx_key === "zipper_pull" ? Math.sin(2 * Math.PI * (65 + 40 * u) * t) * 0.4 : 0;
          s = (lp * 0.7 + mod) * env * 0.7;
          break;
        }
        case "soft_whoosh":
        case "subtle_whoosh":
        default: {
          // Smooth bell-curved swept air whoosh
          const env = Math.sin(Math.PI * u);
          const raw = rand();
          lp = lp + (0.08 + 0.22 * env) * (raw - lp);
          s = (lp * 0.8 + Math.sin(2 * Math.PI * (110 + 180 * u) * t) * 0.15) * env * 0.8;
          break;
        }
      }

      const idx = startIdx + i;
      const scaled = s * vol * 0.72;
      mixL[idx] = Math.max(-0.98, Math.min(0.98, mixL[idx]! + scaled));
      mixR[idx] = Math.max(-0.98, Math.min(0.98, mixR[idx]! + scaled));
    }
  }

  // Encode 16-bit stereo PCM WAV
  const dataBytes = totalSamples * 4;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(2, 22); // Stereo
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28); // ByteRate
  buf.writeUInt16LE(4, 32); // BlockAlign
  buf.writeUInt16LE(16, 34); // BitsPerSample
  buf.write("data", 36);
  buf.writeUInt32LE(dataBytes, 40);

  let offset = 44;
  for (let i = 0; i < totalSamples; i++) {
    const l = Math.round(mixL[i]! * 32767);
    const r = Math.round(mixR[i]! * 32767);
    buf.writeInt16LE(l, offset);
    buf.writeInt16LE(r, offset + 2);
    offset += 4;
  }
  return buf;
}

function runCmd(cmd: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; out: string; err: string }> {
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

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildMotionGraphicSvg(layer: MotionGraphicLayer): { svg: string; w: number; h: number } {
  const txt = escapeXml(layer.text.trim().slice(0, 42));
  if (layer.type === "price_badge") {
    const w = 260;
    const h = 84;
    return {
      w,
      h,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
        <rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="36" fill="${layer.accent_color || "#ff2bd6"}" fill-opacity="0.94" stroke="#ffffff" stroke-width="3"/>
        <text x="${w / 2}" y="${h / 2 + 9}" text-anchor="middle" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="800">${txt}</text>
      </svg>`,
    };
  }
  const w = 540;
  const h = 92;
  return {
    w,
    h,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="20" fill="#09090b" fill-opacity="0.82" stroke="#ffffff" stroke-opacity="0.28" stroke-width="2"/>
      <rect x="14" y="18" width="6" height="${h - 36}" rx="3" fill="${layer.accent_color && layer.accent_color !== "#ffffff" ? layer.accent_color : "#a78bfa"}"/>
      <text x="36" y="55" text-anchor="start" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="700">${txt}</text>
    </svg>`,
  };
}

const LOOK_FILTER: Record<string, string | null> = {
  orijinal: null,
  canli: "eq=saturation=1.35:contrast=1.08",
  "siyah-beyaz": "hue=s=0",
  sicak: "colorbalance=rs=0.08:gs=0.02:bs=-0.08",
  soguk: "colorbalance=rs=-0.06:bs=0.08",
};

function targetDimensions(aspect: TimelinePlan["aspect_ratio"]): { w: number; h: number } {
  if (aspect === "1:1") return { w: 720, h: 720 };
  if (aspect === "4:5") return { w: 720, h: 900 };
  if (aspect === "16:9") return { w: 1280, h: 720 };
  return { w: 720, h: 1280 };
}

/**
 * Sıfır AI Video Kredisi ile Programatik Post-Prodüksiyon Render'ı:
 * - Mevcut video veya görseli hedef boyuta getirir.
 * - Motion graphics katmanlarını (soldan kayan başlık, fiyat rozeti, altyazı) FFmpeg overlay ile gömer.
 * - Ürün odaklı WAV SFX kanalını (ve varsa Türkçe voiceover'ı) videonun ses kanalına amix ile senkronize eder.
 */
export async function renderProgrammaticTimelineVideo(input: {
  tenantId: string;
  sourceAssetOrUploadId: string;
  timeline: TimelinePlan;
  label?: string;
}): Promise<{ assetId: string; uploadId: string; durationSec: number }> {
  const source = await getOwnedUpload(input.tenantId, input.sourceAssetOrUploadId);
  const { w, h } = targetDimensions(input.timeline.aspect_ratio);
  const dir = mkdtempSync(path.join(tmpdir(), "nv-sfx-prog-"));

  try {
    const srcPath = path.join(dir, source.kind === "video" ? "source.mp4" : "source.png");
    await downloadToFile(source.s3Key, srcPath);

    // 1. Baz video oluştur (video ise normalize et, fotoğraf ise 5sn smooth zoompan MP4'e çevir)
    const baseVideoPath = path.join(dir, "base.mp4");
    const totalSec = Math.max(2, Math.min(20, Math.round(input.timeline.duration_ms / 1000)));
    const look = LOOK_FILTER[input.timeline.color_grade] ?? null;
    const speed = input.timeline.speed_multiplier !== 1 ? Math.max(0.5, Math.min(2, input.timeline.speed_multiplier)) : 1;

    if (source.kind === "image") {
      const vfParts = [
        `scale=${w}:${h}:force_original_aspect_ratio=increase`,
        `crop=${w}:${h}`,
        `zoompan=z='min(zoom+0.0014,1.14)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalSec * 24}:s=${w}x${h}:fps=24`,
        ...(look ? [look] : []),
        "format=yuv420p",
      ];
      const r = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-i",
        srcPath,
        "-vf",
        vfParts.join(","),
        "-t",
        String(totalSec),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        baseVideoPath,
      ]);
      if (r.code !== 0) throw new Error(`Baz video oluşturulamadı: ${r.err.slice(0, 200)}`);
    } else {
      const vfParts = [
        `scale=${w}:${h}:force_original_aspect_ratio=increase`,
        `crop=${w}:${h}`,
        ...(speed !== 1 ? [`setpts=${(1 / speed).toFixed(3)}*PTS`] : []),
        ...(look ? [look] : []),
        "fps=24",
        "format=yuv420p",
      ];
      const r = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        srcPath,
        "-vf",
        vfParts.join(","),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        baseVideoPath,
      ]);
      if (r.code !== 0) throw new Error(`Video normalize edilemedi: ${r.err.slice(0, 200)}`);
    }

    // 2. Özel Animasyonlar (SVG -> PNG -> animated FFmpeg overlay)
    let visualVideoPath = baseVideoPath;
    const overlayPngs: { layer: MotionGraphicLayer; pngPath: string }[] = [];
    for (let i = 0; i < input.timeline.motion_layers.length; i++) {
      const layer = input.timeline.motion_layers[i]!;
      const { svg, w: sw, h: sh } = buildMotionGraphicSvg(layer);
      const svgPath = path.join(dir, `mg-${i}.svg`);
      const pngPath = path.join(dir, `mg-${i}.png`);
      writeFileSync(svgPath, svg, "utf8");
      const conv = await runCmd("rsvg-convert", ["-w", String(sw), "-h", String(sh), svgPath, "-o", pngPath], 15_000);
      if (conv.code === 0) {
        overlayPngs.push({ layer, pngPath });
      }
    }

    if (overlayPngs.length > 0) {
      const overlayedPath = path.join(dir, "overlayed.mp4");
      const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", visualVideoPath];
      for (const item of overlayPngs) args.push("-loop", "1", "-i", item.pngPath);

      const chains: string[] = [];
      let prev = "[0:v]";
      for (let i = 0; i < overlayPngs.length; i++) {
        const { layer } = overlayPngs[i]!;
        const sSec = (layer.start_ms / 1000).toFixed(2);
        const eSec = (layer.end_ms / 1000).toFixed(2);
        const inputIdx = i + 1;
        const outLabel = i === overlayPngs.length - 1 ? "[vout]" : `[v${i}]`;

        let xExpr = "40";
        let yExpr = String(Math.round(h * 0.76));
        if (layer.position === "top_right_badge") {
          xExpr = "W-w-32";
          yExpr = "88";
        } else if (layer.position === "top_safe") {
          xExpr = "(W-w)/2";
          yExpr = "96";
        } else if (layer.animation === "slide_left") {
          // Smooth slide-in from left outside screen (-w -> 40) within 0.35s
          xExpr = `if(lt(t,${sSec}),-w,min(40,-w+(t-${sSec})*1800))`;
          yExpr = String(Math.round(h * 0.72));
        } else {
          xExpr = "(W-w)/2";
          yExpr = String(Math.round(h * 0.78));
        }

        chains.push(`${prev}[${inputIdx}:v]overlay=x='${xExpr}':y='${yExpr}':enable='between(t,${sSec},${eSec})'${outLabel}`);
        prev = outLabel;
      }

      const r = await runCmd("ffmpeg", [
        ...args,
        "-filter_complex",
        chains.join(";"),
        "-map",
        "[vout]",
        "-map",
        "0:a?",
        "-t",
        String(totalSec),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "copy",
        overlayedPath,
      ]);
      if (r.code === 0) {
        visualVideoPath = overlayedPath;
      }
    } else if (input.timeline.motion_layers.length > 0) {
      const overlayedPath = path.join(dir, "overlayed-dt.mp4");
      const dtFilters = input.timeline.motion_layers.map((layer) => {
        const sSec = (layer.start_ms / 1000).toFixed(2);
        const eSec = (layer.end_ms / 1000).toFixed(2);
        const txt = layer.text.replace(/[':]/g, " ").slice(0, 40);
        const xExpr = layer.position === "top_right_badge"
          ? "w-tw-44"
          : layer.animation === "slide_left"
            ? `if(lt(t,${sSec}),-tw,min(40,-tw+(t-${sSec})*1800))`
            : "(w-tw)/2";
        const yExpr = layer.position === "top_right_badge" ? "88" : String(Math.round(h * 0.75));
        const boxColor = layer.type === "price_badge" ? "0xff2bd6@0.88" : "0x09090b@0.78";
        return `drawtext=text='${txt}':fontsize=30:fontcolor=white:box=1:boxcolor=${boxColor}:boxborderw=14:x='${xExpr}':y=${yExpr}:enable='between(t,${sSec},${eSec})'`;
      });
      const r = await runCmd("ffmpeg", [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        visualVideoPath,
        "-vf",
        dtFilters.join(","),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "copy",
        overlayedPath,
      ]);
      if (r.code === 0) {
        visualVideoPath = overlayedPath;
      }
    }

    // 3. SFX & (opsiyonel) Voiceover ses miksajı
    let finalMp4Path = visualVideoPath;
    const hasSfx = input.timeline.sfx_track.length > 0;
    const hasVoice = Boolean(input.timeline.voiceover_script_tr && input.timeline.voiceover_script_tr.trim().length > 2);

    if (hasSfx || hasVoice) {
      const sfxWavPath = path.join(dir, "sfx.wav");
      const audioInputs: string[] = [];

      if (hasSfx) {
        const wav = synthesizeTimelineSfxWav(input.timeline);
        writeFileSync(sfxWavPath, wav);
        audioInputs.push(sfxWavPath);
      }
      if (hasVoice && input.timeline.voiceover_script_tr) {
        const voicePath = path.join(dir, "voice.mp3");
        const voiceBytes = await synthesizeTurkishSpeech(input.timeline.voiceover_script_tr);
        writeFileSync(voicePath, Buffer.from(voiceBytes));
        audioInputs.push(voicePath);
      }

      const probeAudio = await runCmd("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "csv=p=0", visualVideoPath], 10_000);
      const hasOrigAudio = probeAudio.code === 0 && probeAudio.out.trim().length > 0;

      const mixedPath = path.join(dir, "final.mp4");
      const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", visualVideoPath];
      for (const a of audioInputs) args.push("-i", a);

      const streamCount = (hasOrigAudio ? 1 : 0) + audioInputs.length;
      if (streamCount === 1) {
        const audioMapIdx = hasOrigAudio ? 0 : 1;
        args.push("-map", "0:v:0", "-map", `${audioMapIdx}:a:0`, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", mixedPath);
      } else {
        const mixTags: string[] = [];
        if (hasOrigAudio) mixTags.push("[0:a]");
        for (let i = 0; i < audioInputs.length; i++) mixTags.push(`[${i + 1}:a]`);
        const fc = `${mixTags.join("")}amix=inputs=${mixTags.length}:duration=first:dropout_transition=0,volume=${mixTags.length}[aout]`;
        args.push("-filter_complex", fc, "-map", "0:v:0", "-map", "[aout]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", mixedPath);
      }

      const r = await runCmd("ffmpeg", args, 60_000);
      if (r.code === 0) {
        finalMp4Path = mixedPath;
      }
    }

    const outBytes = new Uint8Array(readFileSync(finalMp4Path));
    const promptSummary = input.label?.trim() || "Programatik SFX & Motion Kurgu";
    const promptHash = createHash("sha256").update(promptSummary).digest("hex");
    const c2pa = embedC2pa({
      assetBytes: outBytes,
      mime: "video/mp4",
      modelKey: "ffmpeg-programmatic",
      modelId: "local/ffmpeg-sfx-timeline",
      tenantId: input.tenantId,
      promptHash,
    });

    const jobId = `job_prog_${randomUUID().slice(0, 12)}`;
    const outS3Key = `generated/${input.tenantId}/${jobId}`;
    await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: outS3Key, Body: Buffer.from(c2pa.signedBytes), ContentType: "video/mp4" }));
    await objectStore().put(`${outS3Key}.c2pa.json`, c2pa.sidecarJson, "application/json").catch(() => undefined);

    const created = await prisma.$transaction(async (tx) => {
      await tx.creativeJob.create({
        data: {
          id: jobId,
          tenantId: input.tenantId,
          modelKey: "ffmpeg-programmatic",
          modelId: "local/ffmpeg-sfx-timeline",
          prompt: promptSummary.slice(0, 500),
          promptHash,
          units: 0,
          inputUploadId: source.id,
          status: "COMPLETED",
          submittedAt: new Date(),
          completedAt: new Date(),
          inferenceMs: 900,
        },
      });
      const asset = await tx.generatedAsset.create({
        data: {
          tenantId: input.tenantId,
          jobId,
          modelKey: "ffmpeg-programmatic",
          modelId: "local/ffmpeg-sfx-timeline",
          promptHash,
          s3Key: outS3Key,
          c2paManifestId: c2pa.manifestId,
          isAiGenerated: false,
        },
      });
      const upload = await tx.creativeUpload.create({
        data: {
          tenantId: input.tenantId,
          kind: "video",
          mime: "video/mp4",
          sizeBytes: Math.max(1, c2pa.signedBytes.byteLength),
          s3Key: outS3Key,
          name: `Kurgu · ${promptSummary.slice(0, 72)}`,
          source: "edit",
          parentId: source.id,
          durationSec: totalSec,
        },
      });
      return { assetId: asset.id, uploadId: upload.id };
    });

    return {
      assetId: created.assetId,
      uploadId: created.uploadId,
      durationSec: totalSec,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
