import { deflateSync } from "node:zlib";

/**
 * Bağımlılıksız saf Node.js PNG üreticisi (node:zlib).
 * Apple Wallet (.pkpass) ikon/logo/strip görselleri ve Google Wallet logo/hero
 * görselleri için keskin, anti-aliased marka varlıkları üretir.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crcBuf]);
}

export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + stride);
    raw[rowStart] = 0; // filter type: None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

type RGB = [number, number, number];

export function parseHexColor(hex?: string | null, fallback: RGB = [157, 77, 255]): RGB {
  if (!hex) return fallback;
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return fallback;
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(c1: RGB, c2: RGB, t: number): RGB {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function roundedRectSdf(px: number, py: number, w: number, h: number, r: number): number {
  const cx = w / 2;
  const cy = h / 2;
  const bx = cx - r;
  const by = cy - r;
  const qx = Math.abs(px - cx) - bx;
  const qy = Math.abs(py - cy) - by;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Nordvow marka ikonu PNG (köşeleri yuvarlatılmış gradyan zemin + beyaz "N" harfi).
 */
export function renderBrandIconPng(size: number): Buffer {
  const rgba = new Uint8Array(size * size * 4);
  const c0: RGB = [157, 77, 255]; // #9d4dff
  const c1: RGB = [255, 43, 214]; // #ff2bd6
  const c2: RGB = [0, 229, 255];  // #00e5ff

  const r = size * 0.25;
  const left = size * 0.30;
  const right = size * 0.70;
  const top = size * 0.27;
  const bottom = size * 0.73;
  const strokeHalf = Math.max(1.1, size * 0.055);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const sdf = roundedRectSdf(px, py, size, size, r);
      const alpha = Math.max(0, Math.min(1, 0.5 - sdf));
      if (alpha <= 0) continue;

      const t = Math.max(0, Math.min(1, (px + py) / (2 * size)));
      const bg = t < 0.5 ? lerpRgb(c0, c1, t * 2) : lerpRgb(c1, c2, (t - 0.5) * 2);

      // "N" harfi: sol dikey + diyagonal + sağ dikey
      const d1 = distToSegment(px, py, left, bottom, left, top);
      const d2 = distToSegment(px, py, left, top, right, bottom);
      const d3 = distToSegment(px, py, right, bottom, right, top);
      const dN = Math.min(d1, d2, d3) - strokeHalf;
      const nAlpha = Math.max(0, Math.min(1, 0.5 - dN));

      const idx = (y * size + x) * 4;
      rgba[idx] = Math.round(lerp(bg[0], 255, nAlpha));
      rgba[idx + 1] = Math.round(lerp(bg[1], 255, nAlpha));
      rgba[idx + 2] = Math.round(lerp(bg[2], 255, nAlpha));
      rgba[idx + 3] = Math.round(alpha * 255);
    }
  }
  return encodeRgbaPng(size, size, rgba);
}

/**
 * Şık koyu editoryal gradyan banner PNG (Apple Wallet strip / Google Wallet heroImage).
 */
export function renderBannerPng(width: number, height: number, accentHex?: string | null): Buffer {
  const rgba = new Uint8Array(width * height * 4);
  const accent = parseHexColor(accentHex, [157, 77, 255]);
  const accent2: RGB = [255, 43, 214];
  const baseDark: RGB = [16, 16, 26];
  const baseMid: RGB = [26, 22, 44];

  for (let y = 0; y < height; y++) {
    const ny = y / height;
    for (let x = 0; x < width; x++) {
      const nx = x / width;
      const diag = 0.5 * nx + 0.5 * ny;
      let r = lerp(baseDark[0], baseMid[0], diag);
      let g = lerp(baseDark[1], baseMid[1], diag);
      let b = lerp(baseDark[2], baseMid[2], diag);

      // Sağ üstte yumuşak marka ışıltısı
      const dGlow1 = Math.hypot((nx - 0.86) * 1.4, ny - 0.18);
      const glow1 = Math.max(0, 1 - dGlow1 * 1.35) ** 2 * 0.42;
      r = lerp(r, accent[0], glow1);
      g = lerp(g, accent[1], glow1);
      b = lerp(b, accent[2], glow1);

      // Sol altta ikincil pembe/mor ışıltı
      const dGlow2 = Math.hypot((nx - 0.15) * 1.4, ny - 0.92);
      const glow2 = Math.max(0, 1 - dGlow2 * 1.45) ** 2 * 0.22;
      r = lerp(r, accent2[0], glow2);
      g = lerp(g, accent2[1], glow2);
      b = lerp(b, accent2[2], glow2);

      const idx = (y * width + x) * 4;
      rgba[idx] = Math.round(r);
      rgba[idx + 1] = Math.round(g);
      rgba[idx + 2] = Math.round(b);
      rgba[idx + 3] = 255;
    }
  }
  return encodeRgbaPng(width, height, rgba);
}
