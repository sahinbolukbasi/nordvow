import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { spawn } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chargeIn, creativePricing, unitPriceTry } from "./pricing";
import { tenantCurrency } from "./tenant";
import { prisma } from "../db";
import { envStr } from "../env";
import { objectStore } from "../channels/raw-store";
import { embedC2pa } from "./c2pa";
import { chargeHold, placeHold, releaseHold } from "./credits";
import { assertNoRealPersonClone } from "./md2712";
import { humanizeCreativeError } from "./errors";
import { resolveModel } from "./registry";
import { withCircuitBreaker } from "../resilience/circuit-breaker";

/**
 * fal queue + Nordvow Creative AI Studio entegrasyonu.
 * submit: md. 27/12 kontrolü → model çözümle (lisans/deprecation) → kredi HOLD → fal.run / queue.fal.run
 * webhook: request_id DEDUPE → çıktıyı S3'e indir → C2PA göm → generated_assets → krediyi TAHSİL ET.
 */
export interface FalClient {
  submit(appPath: string, input: Record<string, unknown>, webhookUrl: string): Promise<{ requestId: string }>;
  /** Queue durumu (webhook kaçarsa uzlaştırma için). */
  status?(appPath: string, requestId: string): Promise<{ status: string; error?: string | null }>;
  result?(appPath: string, requestId: string): Promise<FalWebhook["payload"]>;
  download(url: string): Promise<{ bytes: Uint8Array; mime: string }>;
}

export function ownerAppPath(modelId: string): string {
  return modelId.split("/").slice(0, 2).join("/");
}

let n = 0;
let cachedDbFalKey: { key: string; at: number } | null = null;

/** Ortam değişkeninden veya config_values ('creative.falKey') tablosundan FAL_KEY anahtarını çözer. */
export async function resolveFalKey(): Promise<string> {
  const envKey = (envStr("FAL_KEY", "") || envStr("FAL_API_KEY", "")).trim().replace(/^Key\s+/i, "");
  if (envKey) return envKey;
  if (cachedDbFalKey && Date.now() - cachedDbFalKey.at < 15_000) return cachedDbFalKey.key;
  try {
    const row = await prisma.configValue.findUnique({ where: { key: "creative.falKey" }, select: { value: true } });
    const val = typeof row?.value === "string" ? row.value.trim().replace(/^Key\s+/i, "") : "";
    cachedDbFalKey = { key: val, at: Date.now() };
    return val;
  } catch {
    return "";
  }
}

export function clearFalKeyCache(): void {
  cachedDbFalKey = null;
}

/** fal.ai API anahtarının geçerli ve aktif olduğunu fal.ai sunucusuna sorarak doğrular. */
export async function verifyFalKeyConnection(candidateKey?: string): Promise<{ ok: boolean; status: number; message: string }> {
  const key = (candidateKey ?? (await resolveFalKey())).trim().replace(/^Key\s+/i, "");
  if (!key) {
    return { ok: false, status: 0, message: "FAL_KEY tanımlı değil. Lütfen geçerli bir fal.ai API anahtarı (key_id:key_secret) girin." };
  }
  try {
    const res = await fetch("https://queue.fal.run/fal-ai/flux/schnell/requests/healthcheck-nonexistent", {
      method: "GET",
      headers: { authorization: `Key ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, message: `fal.ai API anahtarı geçersiz (HTTP ${res.status}).` };
    }
    return { ok: true, status: res.status, message: "fal.ai API bağlantısı doğrulandı ve aktif." };
  } catch (err) {
    return { ok: false, status: 0, message: `fal.ai bağlantı hatası: ${err instanceof Error ? err.message : String(err)}` };
  }
}

type StudioJobMeta = {
  appPath: string;
  input: Record<string, unknown>;
};

class BoundedTtlMap<V> {
  private readonly store = new Map<string, { val: V; at: number }>();
  constructor(private readonly max = 500, private readonly ttlMs = 15 * 60 * 1000) {}

  set(key: string, val: V): void {
    const now = Date.now();
    for (const [k, entry] of this.store) {
      if (now - entry.at > this.ttlMs || this.store.size >= this.max) this.store.delete(k);
      else break;
    }
    this.store.set(key, { val, at: now });
  }

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.at > this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.val;
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

function spawnAsync(cmd: string, args: string[], timeoutMs: number): Promise<{ status: number; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
    let stderr = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stderr.on("data", (d) => (stderr += String(d)));
    p.on("error", (e) => {
      clearTimeout(timer);
      resolve({ status: -1, stderr: String(e.message) });
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code ?? -1, stderr });
    });
  });
}

const studioJobCache = new BoundedTtlMap<StudioJobMeta>(500, 30 * 60 * 1000);
const syncPayloadCache = new BoundedTtlMap<FalWebhook["payload"]>(500, 15 * 60 * 1000);

let pollyCredClient: BedrockRuntimeClient | undefined;

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmacBuf(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * Amazon Polly Neural (Burcu, tr-TR) ile doğal Türkçe seslendirme (.mp3) üretir.
 * AWS erişimi olmayan yerel geliştirme ortamında ffmpeg ile geçerli bir ses dosyası üretir.
 */
export async function synthesizeTurkishSpeech(rawText: string): Promise<Uint8Array> {
  const clean = (rawText || "Merhaba, Nordvow Creative AI ile içeriğiniz hazırlandı.")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[#*_~`<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
  const text = clean || "Merhaba, Nordvow Creative AI ile içeriğiniz hazırlandı.";

  try {
    const region = envStr("BEDROCK_REGION", envStr("AWS_REGION", "eu-central-1"));
    pollyCredClient ??= new BedrockRuntimeClient({ region });
    const creds = await pollyCredClient.config.credentials();
    const host = `polly.${region}.amazonaws.com`;
    const canonicalUri = "/v1/speech";
    const body = JSON.stringify({
      Engine: "neural",
      LanguageCode: "tr-TR",
      OutputFormat: "mp3",
      Text: text,
      TextType: "text",
      VoiceId: "Burcu",
    });

    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;

    const sorted = Object.keys(headers).sort();
    const canonicalHeaders = sorted.map((k) => `${k}:${headers[k]}\n`).join("");
    const signedHeaders = sorted.join(";");
    const canonicalReq = ["POST", canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
    const scope = `${dateStamp}/${region}/polly/aws4_request`;
    const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalReq)].join("\n");
    const kSigning = hmacBuf(hmacBuf(hmacBuf(hmacBuf(`AWS4${creds.secretAccessKey}`, dateStamp), region), "polly"), "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(`https://${host}${canonicalUri}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      if (ab.byteLength > 200) return new Uint8Array(ab);
    }
  } catch (e) {
    console.warn("[creative] Polly TTS yedek moda geçiyor:", (e as Error).message);
  }

  // Yedek: ffmpeg ile geçerli 4 saniyelik yumuşak ambiyans MP3 üret
  const dir = mkdtempSync(path.join(tmpdir(), "nv-tts-"));
  try {
    const outMp3 = path.join(dir, "out.mp3");
    const r = await spawnAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=432:duration=4",
        "-af",
        "volume=0.18,afade=t=in:st=0:d=0.4,afade=t=out:st=3.2:d=0.8",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "128k",
        outMp3,
      ],
      15_000,
    );
    if (r.status === 0) return new Uint8Array(readFileSync(outMp3));
  } catch {
    // ignore
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00]);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) {
      current = w;
    } else if ((current + " " + w).length <= maxCharsPerLine) {
      current += " " + w;
    } else {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function detectScenePalette(prompt: string): {
  bg1: string;
  bg2: string;
  bg3: string;
  accent: string;
  accentSoft: string;
  theme: "coffee" | "fashion" | "cosmetics" | "tech" | "campaign";
  badge: string;
} {
  const p = prompt.toLocaleLowerCase("tr");
  if (/(kahve|kafe|latte|kruvasan|tatlı|yemek|restoran|gastronomi|çay|fincan)/.test(p)) {
    return {
      bg1: "#231710",
      bg2: "#4a2e1b",
      bg3: "#120c08",
      accent: "#f59e0b",
      accentSoft: "#fde68a",
      theme: "coffee",
      badge: "GASTRONOMİ & LIFESTYLE",
    };
  }
  if (/(kozmetik|parfüm|cilt|serum|krem|ruj|makyaj|bakım|şişe|botanik)/.test(p)) {
    return {
      bg1: "#1f2937",
      bg2: "#374151",
      bg3: "#111827",
      accent: "#f472b6",
      accentSoft: "#fbcfe8",
      theme: "cosmetics",
      badge: "BEAUTY & SKINCARE STUDIO",
    };
  }
  if (/(moda|kombin|elbise|ceket|sokak|editorial|model|giyim|stil|ayakkabı|çanta)/.test(p)) {
    return {
      bg1: "#18181b",
      bg2: "#27272a",
      bg3: "#09090b",
      accent: "#e4e4e7",
      accentSoft: "#fafafa",
      theme: "fashion",
      badge: "EDITORIAL FASHION",
    };
  }
  if (/(kampanya|indirim|lansman|fırsat|duyuru|çekiliş|yeni sezon)/.test(p)) {
    return {
      bg1: "#1e1b4b",
      bg2: "#311042",
      bg3: "#09090b",
      accent: "#38bdf8",
      accentSoft: "#bae6fd",
      theme: "campaign",
      badge: "KAMPANYA & LANSMAN",
    };
  }
  return {
    bg1: "#0f172a",
    bg2: "#1e293b",
    bg3: "#020617",
    accent: "#a78bfa",
    accentSoft: "#ddd6fe",
    theme: "tech",
    badge: "NORDVOW CREATIVE STUDIO",
  };
}

function buildStudioSceneSvg(prompt: string, width: number, height: number): string {
  const clean = prompt
    .replace(/profesyonel stüdyo aydınlatması.*$/i, "")
    .replace(/\. Format:.*$/i, "")
    .replace(/^Şimdi üret:\s*/i, "")
    .trim();
  const pal = detectScenePalette(clean);
  const cx = Math.round(width / 2);
  const cy = Math.round(height * 0.43);
  const rMain = Math.round(Math.min(width, height) * 0.24);
  const lines = wrapLines(clean || "Nordvow Creative AI Stüdyo Tasarımı", 28, 3);

  let artwork = "";
  if (pal.theme === "coffee") {
    artwork = `
      <ellipse cx="${cx}" cy="${cy + rMain * 0.68}" rx="${rMain * 0.95}" ry="${rMain * 0.24}" fill="#ffffff" fill-opacity="0.12"/>
      <ellipse cx="${cx}" cy="${cy + rMain * 0.62}" rx="${rMain * 0.72}" ry="${rMain * 0.16}" fill="${pal.accent}" fill-opacity="0.22"/>
      <path d="M ${cx - rMain * 0.48} ${cy - rMain * 0.15} L ${cx + rMain * 0.48} ${cy - rMain * 0.15} L ${cx + rMain * 0.36} ${cy + rMain * 0.58} Q ${cx} ${cy + rMain * 0.72} ${cx - rMain * 0.36} ${cy + rMain * 0.58} Z" fill="#ffffff" fill-opacity="0.9"/>
      <path d="M ${cx + rMain * 0.45} ${cy - rMain * 0.02} C ${cx + rMain * 0.76} ${cy - rMain * 0.02}, ${cx + rMain * 0.76} ${cy + rMain * 0.42}, ${cx + rMain * 0.39} ${cy + rMain * 0.42}" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round"/>
      <ellipse cx="${cx}" cy="${cy - rMain * 0.15}" rx="${rMain * 0.48}" ry="${rMain * 0.12}" fill="#78350f"/>
      <ellipse cx="${cx}" cy="${cy - rMain * 0.15}" rx="${rMain * 0.32}" ry="${rMain * 0.07}" fill="#f59e0b" fill-opacity="0.65"/>
      <path d="M ${cx - 35} ${cy - rMain * 0.38} Q ${cx - 55} ${cy - rMain * 0.68} ${cx - 25} ${cy - rMain * 0.92}" fill="none" stroke="${pal.accentSoft}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.6"/>
      <path d="M ${cx + 25} ${cy - rMain * 0.35} Q ${cx + 45} ${cy - rMain * 0.65} ${cx + 15} ${cy - rMain * 0.9}" fill="none" stroke="${pal.accentSoft}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.5"/>
    `;
  } else if (pal.theme === "cosmetics") {
    artwork = `
      <ellipse cx="${cx}" cy="${cy + rMain * 0.78}" rx="${rMain * 0.9}" ry="${rMain * 0.2}" fill="#ffffff" fill-opacity="0.1"/>
      <rect x="${cx - rMain * 0.34}" y="${cy - rMain * 0.32}" width="${rMain * 0.68}" height="${rMain * 0.98}" rx="34" fill="#ffffff" fill-opacity="0.88"/>
      <rect x="${cx - rMain * 0.24}" y="${cy - rMain * 0.04}" width="${rMain * 0.48}" height="${rMain * 0.46}" rx="12" fill="${pal.accent}" fill-opacity="0.28"/>
      <rect x="${cx - rMain * 0.14}" y="${cy - rMain * 0.58}" width="${rMain * 0.28}" height="${rMain * 0.26}" rx="10" fill="${pal.accentSoft}" fill-opacity="0.95"/>
      <rect x="${cx - rMain * 0.05}" y="${cy - rMain * 0.82}" width="${rMain * 0.1}" height="${rMain * 0.26}" rx="6" fill="#ffffff" fill-opacity="0.8"/>
      <circle cx="${cx - rMain * 0.65}" cy="${cy - rMain * 0.2}" r="28" fill="${pal.accentSoft}" fill-opacity="0.25"/>
      <circle cx="${cx + rMain * 0.68}" cy="${cy + rMain * 0.15}" r="42" fill="${pal.accent}" fill-opacity="0.2"/>
    `;
  } else {
    artwork = `
      <ellipse cx="${cx}" cy="${cy + rMain * 0.76}" rx="${rMain * 0.95}" ry="${rMain * 0.22}" fill="#ffffff" fill-opacity="0.1"/>
      <polygon points="${cx},${cy - rMain * 0.78} ${cx + rMain * 0.68},${cy + rMain * 0.42} ${cx - rMain * 0.68},${cy + rMain * 0.42}" fill="${pal.accent}" fill-opacity="0.25" stroke="${pal.accentSoft}" stroke-width="3" stroke-opacity="0.6"/>
      <circle cx="${cx}" cy="${cy - rMain * 0.05}" r="${rMain * 0.42}" fill="#ffffff" fill-opacity="0.14" stroke="#ffffff" stroke-width="3" stroke-opacity="0.5"/>
      <rect x="${cx - rMain * 0.26}" y="${cy - rMain * 0.31}" width="${rMain * 0.52}" height="${rMain * 0.52}" rx="24" fill="#ffffff" fill-opacity="0.9"/>
    `;
  }

  const textStartY = Math.round(height * 0.73);
  const textEls = lines
    .map(
      (line, idx) =>
        `<text x="${cx}" y="${textStartY + idx * 52}" text-anchor="middle" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-size="38" font-weight="700">${escapeXml(line)}</text>`,
    )
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${pal.bg1}"/>
        <stop offset="52%" stop-color="${pal.bg2}"/>
        <stop offset="100%" stop-color="${pal.bg3}"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="42%" r="48%">
        <stop offset="0%" stop-color="${pal.accent}" stop-opacity="0.55"/>
        <stop offset="60%" stop-color="${pal.accentSoft}" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <rect width="${width}" height="${height}" fill="url(#glow)"/>
    <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.2)}" r="${Math.round(rMain * 0.65)}" fill="${pal.accent}" fill-opacity="0.12"/>
    <circle cx="${Math.round(width * 0.84)}" cy="${Math.round(height * 0.28)}" r="${Math.round(rMain * 0.8)}" fill="${pal.accentSoft}" fill-opacity="0.1"/>
    <circle cx="${cx}" cy="${cy}" r="${rMain}" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.18" stroke-width="2"/>
    ${artwork}
    <rect x="${cx - 190}" y="${Math.round(height * 0.08)}" width="380" height="44" rx="22" fill="#ffffff" fill-opacity="0.12"/>
    <text x="${cx}" y="${Math.round(height * 0.08) + 29}" text-anchor="middle" fill="${pal.accentSoft}" font-family="DejaVu Sans, Arial, sans-serif" font-size="18" font-weight="600" letter-spacing="2">${escapeXml(pal.badge)}</text>
    ${textEls}
    <text x="${cx}" y="${height - 54}" text-anchor="middle" fill="#a1a1aa" font-family="DejaVu Sans, Arial, sans-serif" font-size="20" font-weight="500">NORDVOW CREATIVE AI STUDIO</text>
  </svg>`;
}

function buildPpmBuffer(prompt: string, w: number, h: number): Buffer {
  const pal = detectScenePalette(prompt);
  const hexToRgb = (hex: string): [number, number, number] => {
    const c = hex.replace("#", "");
    return [parseInt(c.slice(0, 2), 16) || 24, parseInt(c.slice(2, 4), 16) || 24, parseInt(c.slice(4, 6), 16) || 32];
  };
  const c1 = hexToRgb(pal.bg1);
  const c2 = hexToRgb(pal.bg2);
  const acc = hexToRgb(pal.accent);
  const header = Buffer.from(`P6\n${w} ${h}\n255\n`, "ascii");
  const pixels = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    const ny = y / h;
    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const dx = nx - 0.5;
      const dy = ny - 0.43;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const glow = Math.max(0, 1 - dist * 2.1);
      const ring = Math.abs(dist - 0.22) < 0.008 ? 0.45 : 0;
      const r = Math.min(255, Math.round(c1[0] * (1 - ny) + c2[0] * ny + glow * acc[0] * 0.85 + ring * 220));
      const g = Math.min(255, Math.round(c1[1] * (1 - ny) + c2[1] * ny + glow * acc[1] * 0.85 + ring * 220));
      const b = Math.min(255, Math.round(c1[2] * (1 - ny) + c2[2] * ny + glow * acc[2] * 0.85 + ring * 220));
      const i = (y * w + x) * 3;
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
    }
  }
  return Buffer.concat([header, pixels]);
}

function dimensionsForAspect(aspect?: string): { w: number; h: number } {
  if (aspect === "1:1" || aspect === "square_hd") return { w: 1080, h: 1080 };
  if (aspect === "16:9" || aspect === "landscape_16_9") return { w: 1280, h: 720 };
  if (aspect === "4:5" || aspect === "portrait_4_3") return { w: 1080, h: 1350 };
  return { w: 1080, h: 1920 };
}

/**
 * Stüdyo Görsel Üretici: referans görsel varsa ürünü koruyarak yeni sahneyle kompozitler;
 * yoksa SVG sahnesini rsvg-convert veya ffmpeg ile gerçek PNG görüntüsüne dönüştürür.
 */
export async function renderStudioImagePng(prompt: string, aspect?: string, referenceImageUrl?: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const { w, h } = dimensionsForAspect(aspect);
  const svg = buildStudioSceneSvg(prompt, w, h);
  const dir = mkdtempSync(path.join(tmpdir(), "nv-img-"));
  try {
    if (referenceImageUrl && !referenceImageUrl.includes("example.invalid")) {
      try {
        const res = await fetch(referenceImageUrl, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          const refPath = path.join(dir, "ref.bin");
          const outRefPng = path.join(dir, "ref-out.png");
          writeFileSync(refPath, Buffer.from(await res.arrayBuffer()));
          const ffRef = await spawnAsync(
            "ffmpeg",
            [
              "-y",
              "-hide_banner",
              "-loglevel",
              "error",
              "-i",
              refPath,
              "-vf",
              `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=#111827`,
              outRefPng,
            ],
            15_000,
          );
          if (ffRef.status === 0) {
            return { bytes: new Uint8Array(readFileSync(outRefPng)), mime: "image/png" };
          }
        }
      } catch {
        // referans indirilemezse standart stüdyo sahnesine devam et
      }
    }
    const svgPath = path.join(dir, "scene.svg");
    const pngPath = path.join(dir, "scene.png");
    writeFileSync(svgPath, svg, "utf8");
    const rsvg = await spawnAsync("rsvg-convert", ["-w", String(w), "-h", String(h), svgPath, "-o", pngPath], 15_000);
    if (rsvg.status === 0) {
      return { bytes: new Uint8Array(readFileSync(pngPath)), mime: "image/png" };
    }
    const ppmPath = path.join(dir, "scene.ppm");
    writeFileSync(ppmPath, buildPpmBuffer(prompt, Math.round(w / 2), Math.round(h / 2)));
    const ff = await spawnAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", ppmPath, "-vf", `scale=${w}:${h}`, pngPath], 15_000);
    if (ff.status === 0) {
      return { bytes: new Uint8Array(readFileSync(pngPath)), mime: "image/png" };
    }
  } catch {
    // ignore
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { bytes: new TextEncoder().encode(svg), mime: "image/svg+xml" };
}

/**
 * Stüdyo Video Üretici:
 * Görsel sahneyi (veya referans görseli) 5 saniyelik akıcı H.264 MP4 videoya dönüştürür.
 * Eğer `voiceText` verilmişse Amazon Polly Neural Türkçe seslendirmesini doğrudan videonun ses kanalına gömer.
 */
export async function renderStudioVideoMp4(opts: {
  prompt: string;
  aspect?: string;
  voiceText?: string;
  referenceImageUrl?: string;
}): Promise<{ bytes: Uint8Array; mime: string }> {
  const { w, h } = dimensionsForAspect(opts.aspect);
  const vidW = w > 1080 ? 1280 : 720;
  const vidH = h === w ? 720 : h > w ? (opts.aspect === "4:5" ? 900 : 1280) : 720;

  const dir = mkdtempSync(path.join(tmpdir(), "nv-vid-"));
  try {
    const framePath = path.join(dir, "frame.png");
    let frameReady = false;

    if (opts.referenceImageUrl && !opts.referenceImageUrl.includes("example.invalid")) {
      try {
        const res = await fetch(opts.referenceImageUrl, { signal: AbortSignal.timeout(15_000) });
        if (res.ok) {
          writeFileSync(framePath, Buffer.from(await res.arrayBuffer()));
          frameReady = true;
        }
      } catch {
        // fallback to studio frame
      }
    }

    if (!frameReady) {
      const img = await renderStudioImagePng(opts.prompt, opts.aspect);
      if (img.mime === "image/png") {
        writeFileSync(framePath, Buffer.from(img.bytes));
        frameReady = true;
      } else {
        const ppmPath = path.join(dir, "frame.ppm");
        writeFileSync(ppmPath, buildPpmBuffer(opts.prompt, vidW, vidH));
        await spawnAsync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", ppmPath, framePath], 15_000);
      }
    }

    const outMp4 = path.join(dir, "out.mp4");
    const vf = `scale=${vidW}:${vidH}:force_original_aspect_ratio=increase,crop=${vidW}:${vidH},zoompan=z='min(zoom+0.0018,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=${vidW}x${vidH}:fps=24,fade=t=in:st=0:d=0.4,fade=t=out:st=4.5:d=0.5,format=yuv420p`;

    if (opts.voiceText && opts.voiceText.trim().length > 2) {
      const audioBytes = await synthesizeTurkishSpeech(opts.voiceText);
      const mp3Path = path.join(dir, "voice.mp3");
      writeFileSync(mp3Path, Buffer.from(audioBytes));
      const r = await spawnAsync(
        "ffmpeg",
        [
          "-y",
          "-hide_banner",
          "-loglevel",
          "error",
          "-loop",
          "1",
          "-i",
          framePath,
          "-i",
          mp3Path,
          "-vf",
          vf,
          "-t",
          "5",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-shortest",
          "-movflags",
          "+faststart",
          outMp4,
        ],
        45_000,
      );
      if (r.status === 0) {
        return { bytes: new Uint8Array(readFileSync(outMp4)), mime: "video/mp4" };
      }
    }

    const r = await spawnAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-loop",
        "1",
        "-i",
        framePath,
        "-vf",
        vf,
        "-t",
        "5",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-movflags",
        "+faststart",
        outMp4,
      ],
      45_000,
    );
    if (r.status === 0) {
      return { bytes: new Uint8Array(readFileSync(outMp4)), mime: "video/mp4" };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return { bytes: new TextEncoder().encode("mock-video-bytes"), mime: "video/mp4" };
}

/**
 * Mevcut bir MP4 videosunun üzerine doğal Türkçe AI seslendirmesi (Polly Neural Burcu) üretip gömer.
 */
export async function mergeVoiceoverOntoVideoBytes(videoBytes: Uint8Array, voiceText: string): Promise<Uint8Array> {
  const speechBytes = await synthesizeTurkishSpeech(voiceText);
  const dir = mkdtempSync(path.join(tmpdir(), "nv-mux-"));
  try {
    const vidPath = path.join(dir, "in.mp4");
    const mp3Path = path.join(dir, "voice.mp3");
    const outPath = path.join(dir, "out.mp4");
    writeFileSync(vidPath, Buffer.from(videoBytes));
    writeFileSync(mp3Path, Buffer.from(speechBytes));
    const commonArgs = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      vidPath,
      "-i",
      mp3Path,
    ];
    // Hızlı yol: video akışını kopyala (H.264 MP4).
    let r = await spawnAsync(
      "ffmpeg",
      [...commonArgs, "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-map", "0:v:0", "-map", "1:a:0", "-movflags", "+faststart", outPath],
      60_000,
    );
    // WebM/MOV gibi MP4'e doğrudan kopyalanamayan kodeklerde H.264'e yeniden kodla.
    if (r.status !== 0) {
      r = await spawnAsync(
        "ffmpeg",
        [
          ...commonArgs,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-movflags",
          "+faststart",
          outPath,
        ],
        120_000,
      );
    }
    if (r.status === 0) {
      return new Uint8Array(readFileSync(outPath));
    }
    throw new Error(`Video ses birleştirme hatası: ${r.stderr.slice(0, 240) || "ffmpeg başarısız"}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const mockFal: FalClient = {
  async submit(appPath, input) {
    const requestId = `req_mock_${Date.now()}_${++n}`;
    studioJobCache.set(requestId, { appPath, input });
    return { requestId };
  },
  async download(url) {
    if (url.startsWith("studio://")) {
      const reqId = url.split("/").pop() ?? "";
      const meta = studioJobCache.get(reqId);
      const prompt = String(meta?.input?.prompt ?? meta?.input?.text ?? "Nordvow Creative AI");
      const aspect = String(meta?.input?.aspect_ratio ?? meta?.input?.image_size ?? "9:16");
      const voiceText = typeof meta?.input?.voiceText === "string" ? meta.input.voiceText : undefined;
      const refUrl =
        typeof meta?.input?.image_url === "string"
          ? meta.input.image_url
          : Array.isArray(meta?.input?.image_urls) && typeof meta.input.image_urls[0] === "string"
            ? (meta.input.image_urls[0] as string)
            : undefined;
      if (url.startsWith("studio://audio/")) {
        return { bytes: await synthesizeTurkishSpeech(prompt), mime: "audio/mpeg" };
      }
      if (url.startsWith("studio://video/")) {
        return renderStudioVideoMp4({ prompt, aspect, voiceText, referenceImageUrl: refUrl });
      }
      return renderStudioImagePng(prompt, aspect, refUrl);
    }
    const u = url.toLowerCase();
    if (u.endsWith(".mp4") || u.endsWith(".mov") || u.endsWith(".webm") || u.includes("/video")) {
      return { bytes: new TextEncoder().encode("mock-video-bytes"), mime: "video/mp4" };
    }
    if (u.endsWith(".mp3") || u.endsWith(".wav") || u.includes("/audio")) {
      return { bytes: new TextEncoder().encode("mock-audio-bytes"), mime: "audio/mpeg" };
    }
    return { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mime: "image/png" };
  },
};

export function httpFal(): FalClient {
  return {
    async submit(appPath, input, webhookUrl) {
      const key = await resolveFalKey();
      if (!key) {
        throw new CreativeRejectedError(
          "fal.ai API anahtarı (FAL_KEY) tanımlı değil. Sahte görsel yerine gerçek fal.ai üretimi için lütfen Yönetim → fal.ai API Bağlantısı bölümünden geçerli FAL_KEY girin.",
        );
      }

      const authHeader = `Key ${key}`;
      const cleanInput = { ...input };
      delete cleanInput.voiceText;

      // Hızlı görsel/ses modellerinde önce senkron fal.run uç noktasını dene (webhook beklemeden anında sonuç)
      const isFastSyncCandidate = !appPath.includes("kling") && !appPath.includes("hailuo") && !appPath.includes("seedance") && !appPath.includes("minimax") && !appPath.includes("wan") && !appPath.includes("veo");
      if (isFastSyncCandidate) {
        try {
          const syncRes = await fetch(`https://fal.run/${appPath}`, {
            method: "POST",
            headers: { authorization: authHeader, "content-type": "application/json" },
            body: JSON.stringify(cleanInput),
            signal: AbortSignal.timeout(35_000),
          });
          if (syncRes.ok) {
            const payload = (await syncRes.json()) as FalWebhook["payload"];
            if (payload?.images?.[0]?.url || payload?.image?.url || payload?.video?.url || payload?.audio?.url) {
              const requestId = `req_sync_${Date.now()}_${++n}`;
              syncPayloadCache.set(requestId, payload);
              studioJobCache.set(requestId, { appPath, input });
              return { requestId };
            }
          } else if (syncRes.status === 401 || syncRes.status === 403) {
            throw new CreativeRejectedError(humanizeCreativeError(`HTTP ${syncRes.status}`));
          } else if (syncRes.status === 400 || syncRes.status === 402 || syncRes.status === 413 || syncRes.status === 422) {
            const errText = await syncRes.text().catch(() => "");
            if (appPath.includes("nano-banana/edit") && ("output_format" in cleanInput || "num_images" in cleanInput)) {
              const fallbackInput: Record<string, unknown> = { prompt: cleanInput.prompt, image_urls: cleanInput.image_urls };
              const retryRes = await fetch(`https://fal.run/${appPath}`, {
                method: "POST",
                headers: { authorization: authHeader, "content-type": "application/json" },
                body: JSON.stringify(fallbackInput),
                signal: AbortSignal.timeout(35_000),
              }).catch(() => null);
              if (retryRes?.ok) {
                const payload = (await retryRes.json()) as FalWebhook["payload"];
                if (payload?.images?.[0]?.url || payload?.image?.url) {
                  const requestId = `req_sync_${Date.now()}_${++n}`;
                  syncPayloadCache.set(requestId, payload);
                  studioJobCache.set(requestId, { appPath, input });
                  return { requestId };
                }
              }
            }
            console.warn("[fal] sync rejected:", appPath, syncRes.status, errText.slice(0, 300));
            throw new CreativeRejectedError(humanizeCreativeError(errText, syncRes.status));
          }
        } catch (err) {
          if (err instanceof CreativeRejectedError) throw err;
          // Senkron çağrı zaman aşımına uğrarsa queue.fal.run ile devam et
        }
      }

      const res = await fetch(`https://queue.fal.run/${appPath}?fal_webhook=${encodeURIComponent(webhookUrl)}`, {
        method: "POST",
        headers: { authorization: authHeader, "content-type": "application/json" },
        body: JSON.stringify(cleanInput),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.status === 401 || res.status === 403) {
        throw new CreativeRejectedError(`fal.ai API anahtarı geçersiz veya yetkisiz (HTTP ${res.status}). Lütfen FAL_KEY değerini kontrol edin.`);
      }
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.warn("[fal] queue error:", appPath, res.status, errBody.slice(0, 300));
        throw new Error(humanizeCreativeError(errBody, res.status));
      }
      const j = (await res.json()) as { request_id: string };
      studioJobCache.set(j.request_id, { appPath, input });
      return { requestId: j.request_id };
    },
    async download(url) {
      if (url.startsWith("studio://") || url.includes("example.invalid")) {
        return mockFal.download(url);
      }
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`fal çıktısı indirilemedi: HTTP ${res.status}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "image/png" };
    },
    async status(appPath, requestId) {
      const key = await resolveFalKey();
      const res = await fetch(`https://queue.fal.run/${queueApp(appPath)}/requests/${requestId}/status`, {
        headers: { authorization: `Key ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`fal status HTTP ${res.status}`);
      const j = (await res.json()) as { status: string; error?: string | null };
      return { status: j.status, error: j.error ?? null };
    },
    async result(appPath, requestId) {
      const key = await resolveFalKey();
      const res = await fetch(`https://queue.fal.run/${queueApp(appPath)}/requests/${requestId}`, {
        headers: { authorization: `Key ${key}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`fal result HTTP ${res.status}`);
      return (await res.json()) as FalWebhook["payload"];
    },
  };
}

/** Model kimliğinin ilk iki parçası (sahip/uygulama): queue durum/sonuç yolu uç yolu içermez. */
export function queueApp(modelId: string): string {
  return modelId.split("/").slice(0, 2).join("/");
}
let override: FalClient | undefined;
export function fal(): FalClient {
  return override ?? (envStr("FAL_MODE", "mock") === "http" ? httpFal() : mockFal);
}
export function setFalClient(c: FalClient | undefined) {
  override = c;
}

export class CreativeRejectedError extends Error {}

export async function submitCreative(input: {
  tenantId: string;
  campaignId?: string;
  modelKey: string;
  prompt: string;
  units: number;
  referenceImageIsPortrait?: boolean;
  falInput?: Record<string, unknown>;
  inputUploadId?: string | null;
}) {
  const promptHash = createHash("sha256").update(input.prompt).digest("hex");
  try {
    await assertNoRealPersonClone({ prompt: input.prompt, referenceImageIsPortrait: input.referenceImageIsPortrait });
  } catch (e) {
    await prisma.creativeJob.create({
      data: { tenantId: input.tenantId, campaignId: input.campaignId, modelKey: input.modelKey, modelId: "-", prompt: input.prompt, promptHash, units: input.units, status: "REJECTED", rejectReason: (e as Error).message },
    });
    throw new CreativeRejectedError((e as Error).message);
  }
  const model = await resolveModel(input.modelKey);
  if (model.maxUnits != null && input.units > model.maxUnits) {
    throw new CreativeRejectedError(`${model.key} için üst sınır ${model.maxUnits} ${model.unit}.`);
  }
  const pricing = await creativePricing();
  const effectiveCpu = Number(model.unitPriceUsd) > 0 ? unitPriceTry(Number(model.unitPriceUsd), pricing) : Number(model.creditsPerUnit);
  const credits = chargeIn(effectiveCpu, input.units, pricing, await tenantCurrency(input.tenantId));
  const hold = await placeHold(input.tenantId, credits);
  const job = await prisma.creativeJob.create({
    data: { tenantId: input.tenantId, campaignId: input.campaignId, modelKey: model.key, modelId: model.modelId, prompt: input.prompt, promptHash, units: input.units, creditHoldId: hold.id, inputUploadId: input.inputUploadId ?? null, status: "HELD" },
  });
  try {
    const webhookUrl = `${envStr("APP_URL", "http://localhost:3000")}/api/webhooks/fal`;
    const { requestId } = await withCircuitBreaker("fal", () =>
      fal().submit(model.modelId, input.falInput ?? { prompt: input.prompt }, webhookUrl),
    );
    const updated = await prisma.creativeJob.update({ where: { id: job.id }, data: { requestId, status: "IN_QUEUE", submittedAt: new Date() } });

    if (requestId.startsWith("req_sync_")) {
      const payload = syncPayloadCache.get(requestId);
      syncPayloadCache.delete(requestId);
      if (payload) {
        await handleFalWebhook({ request_id: requestId, status: "OK", payload, metrics: { inference_time: 1.2 } }).catch(() => undefined);
      }
    } else if (requestId.startsWith("req_studio_")) {
      const payload: FalWebhook["payload"] =
        model.kind === "video"
          ? { video: { url: `studio://video/${requestId}` } }
          : model.kind === "audio"
            ? { audio: { url: `studio://audio/${requestId}` } }
            : { images: [{ url: `studio://image/${requestId}` }] };
      await handleFalWebhook({ request_id: requestId, status: "OK", payload, metrics: { inference_time: 1.1 } }).catch(() => undefined);
    }
    return updated;
  } catch (e) {
    await releaseHold(hold.id);
    await prisma.creativeJob.update({ where: { id: job.id }, data: { status: "FAILED", rejectReason: humanizeCreativeError(e).slice(0, 300) } });
    throw e;
  }
}

export type FalWebhook = {
  request_id: string;
  status: "OK" | "ERROR";
  payload?: { images?: { url: string }[]; image?: { url: string }; video?: { url: string }; audio?: { url: string } };
  metrics?: { inference_time?: number; cost_usd?: number; cost?: number };
  error?: string;
};

/** fal webhook işleyicisi — idempotent. */
export async function handleFalWebhook(w: FalWebhook) {
  const job = await prisma.creativeJob.findUnique({ where: { requestId: w.request_id } });
  if (!job) return { handled: false, reason: "bilinmeyen request_id" };
  const claim = await prisma.creativeJob.updateMany({ where: { id: job.id, status: { in: ["IN_QUEUE", "IN_PROGRESS", "CANCELLED"] } }, data: { status: "IN_PROGRESS" } });
  if (claim.count !== 1) return { handled: false, reason: "zaten işlendi" };

  if (w.status !== "OK") {
    if (job.creditHoldId) await releaseHold(job.creditHoldId);
    await prisma.creativeJob.update({ where: { id: job.id }, data: { status: "FAILED", rejectReason: humanizeCreativeError(w.error ?? "fal ERROR").slice(0, 300), completedAt: new Date() } });
    return { handled: true, status: "FAILED" as const };
  }
  const url = w.payload?.images?.[0]?.url ?? w.payload?.image?.url ?? w.payload?.video?.url ?? w.payload?.audio?.url;
  let out: { bytes: Uint8Array; mime: string };
  try {
    if (!url) throw new Error("fal çıktısında dosya yok");
    out = await fal().download(url);
    // Eğer fal.ai video ürettiyse ve iş isteğinde voiceText (seslendirme) varsa, sesi videoya göm
    const meta = studioJobCache.get(w.request_id);
    const voiceText = typeof meta?.input?.voiceText === "string" ? meta.input.voiceText.trim() : "";
    if (voiceText && !url.startsWith("studio://") && (!!w.payload?.video?.url || out.mime.startsWith("video/"))) {
      out = { bytes: await mergeVoiceoverOntoVideoBytes(out.bytes, voiceText), mime: "video/mp4" };
    }
    studioJobCache.delete(w.request_id);
  } catch (e) {
    if (job.creditHoldId) await releaseHold(job.creditHoldId);
    await prisma.creativeJob.update({ where: { id: job.id }, data: { status: "FAILED", rejectReason: `Çıktı alınamadı: ${(e as Error).message}`.slice(0, 300), completedAt: new Date() } });
    return { handled: true, status: "FAILED" as const };
  }
  const isVideoPayload = !!w.payload?.video?.url;
  const isAudioPayload = !!w.payload?.audio?.url;
  const effectiveMime =
    isVideoPayload && !out.mime.startsWith("video/")
      ? "video/mp4"
      : isAudioPayload && !out.mime.startsWith("audio/")
        ? "audio/mpeg"
        : out.mime;
  let asset: { id: string };
  try {
    const c2pa = embedC2pa({ assetBytes: out.bytes, mime: effectiveMime, modelKey: job.modelKey, modelId: job.modelId, tenantId: job.tenantId, promptHash: job.promptHash });
    const key = `generated/${job.tenantId}/${job.id}`;
    await objectStore().put(key, c2pa.signedBytes, effectiveMime);
    await objectStore().put(`${key}.c2pa.json`, c2pa.sidecarJson, "application/json");
    asset = await prisma.$transaction(async (tx) => {
      const a = await tx.generatedAsset.create({
        data: { tenantId: job.tenantId, campaignId: job.campaignId, jobId: job.id, modelKey: job.modelKey, modelId: job.modelId, promptHash: job.promptHash, s3Key: key, c2paManifestId: c2pa.manifestId, isAiGenerated: true },
      });
      if (effectiveMime.startsWith("image/") || effectiveMime.startsWith("video/")) {
        const kind = effectiveMime.startsWith("video/") ? "video" : "image";
        const cleanPrompt = job.prompt.split(". Format:")[0]!.split(". Stil:")[0]!.split(". Instagram Story")[0]!.trim();
        const existingLib = await tx.creativeUpload.findFirst({ where: { tenantId: job.tenantId, s3Key: key }, select: { id: true } });
        if (!existingLib) {
          await tx.creativeUpload.create({
            data: {
              tenantId: job.tenantId,
              kind,
              mime: effectiveMime,
              sizeBytes: Math.max(1, c2pa.signedBytes.byteLength),
              s3Key: key,
              name: (cleanPrompt || `AI ${kind === "video" ? "Video" : "Fotoğraf"} · ${job.modelKey}`).slice(0, 120),
              source: "ai",
              parentId: job.inputUploadId ?? null,
              durationSec: kind === "video" ? Number(job.units) || 5 : null,
            },
          });
        }
      }
      if (job.creditHoldId) await chargeHold(job.creditHoldId, tx);
      const reportedCost = w.metrics?.cost_usd ?? w.metrics?.cost;
      await tx.creativeJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          inferenceMs: w.metrics?.inference_time != null ? Math.round(w.metrics.inference_time * 1000) : null,
          actualCostUsd: typeof reportedCost === "number" && Number.isFinite(reportedCost) && reportedCost >= 0 ? reportedCost : undefined,
        },
      });
      return a;
    });
  } catch (e) {
    if (job.creditHoldId) await releaseHold(job.creditHoldId);
    await prisma.creativeJob.update({ where: { id: job.id }, data: { status: "FAILED", rejectReason: `Çıktı kaydedilemedi: ${(e as Error).message}`.slice(0, 300), completedAt: new Date() } });
    return { handled: true, status: "FAILED" as const };
  }
  if (job.pipeline) {
    const { continuePipeline } = await import("./edit");
    await continuePipeline(job.id, asset.id).catch((e) => console.error("[creative] zincir", job.id, (e as Error).message));
  }
  return { handled: true, status: "COMPLETED" as const, assetId: asset.id };
}

let reconciling = false;
export async function reconcileStaleJobs(opts: { olderThanMs?: number; giveUpAfterMs?: number } = {}): Promise<{ checked: number; settled: number }> {
  if (reconciling) return { checked: 0, settled: 0 };
  reconciling = true;
  let checked = 0;
  let settled = 0;
  try {
    const olderHeld = new Date(Date.now() - 2 * 60 * 1000);
    const olderQueue = new Date(Date.now() - (opts.olderThanMs ?? 2 * 60 * 1000));
    const giveUp = new Date(Date.now() - (opts.giveUpAfterMs ?? 6 * 3600 * 1000));
    const orphans = await prisma.creativeJob.findMany({ where: { status: "HELD", createdAt: { lt: olderHeld } }, take: 50 });
    for (const j of orphans) {
      if (j.creditHoldId) await releaseHold(j.creditHoldId);
      await prisma.creativeJob.update({ where: { id: j.id }, data: { status: "FAILED", rejectReason: "Gönderim tamamlanamadı; ücret alınmadı.", completedAt: new Date() } });
      settled++;
    }
    const staleHolds = await prisma.creditHold.findMany({ where: { status: "held", createdAt: { lt: giveUp } }, select: { id: true }, take: 50 });
    for (const h of staleHolds) {
      const linked = await prisma.creativeJob.findFirst({ where: { creditHoldId: h.id }, select: { id: true } });
      if (!linked && (await releaseHold(h.id))) settled++;
    }
    const client = fal();
    if (!client.status || !client.result) return { checked, settled };
    const stale = await prisma.creativeJob.findMany({ where: { status: { in: ["IN_QUEUE", "IN_PROGRESS"] }, requestId: { not: null }, submittedAt: { lt: olderQueue } }, orderBy: { submittedAt: "asc" }, take: 20 });
    for (const j of stale) {
      checked++;
      try {
        const st = await client.status(j.modelId, j.requestId!);
        if (st.status === "COMPLETED") {
          if (st.error) await handleFalWebhook({ request_id: j.requestId!, status: "ERROR", error: st.error });
          else await handleFalWebhook({ request_id: j.requestId!, status: "OK", payload: await client.result(j.modelId, j.requestId!) });
          settled++;
        } else if (st.status === "FAILED" || st.status === "ERROR") {
          await handleFalWebhook({ request_id: j.requestId!, status: "ERROR", error: st.error ?? "Model üretim hatası; ücret alınmadı." });
          settled++;
        } else if (j.submittedAt && j.submittedAt < giveUp) {
          await handleFalWebhook({ request_id: j.requestId!, status: "ERROR", error: "Zaman aşımı (6 saat); ücret alınmadı." });
          settled++;
        }
      } catch (e) {
        console.error("[fal] uzlaştırma", j.id, (e as Error).message);
      }
    }
  } finally {
    reconciling = false;
  }
  return { checked, settled };
}
