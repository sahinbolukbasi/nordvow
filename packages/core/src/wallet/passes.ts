import QRCode from "qrcode";
import { envStr } from "../env";

/**
 * Cüzdan (Apple Wallet / Google Wallet) ve QR altyapısı.
 *
 * QR üretimi gerçektir (qrcode kütüphanesi). Cüzdan "pass" üretimi anahtar gerektirir:
 * - Apple Wallet: PassKit imza sertifikası (.p12) + WWDR sertifikası
 * - Google Wallet: servis hesabı + Issuer ID (JWT imzalama)
 * Anahtarlar tanımlı DEĞİLSE mock modda çalışır: "Cüzdana ekle" bağlantısı üretilir ve
 * kullanıcı bilet/kupon web görünümüne yönlendirilir. Anahtar eklenince gerçek .pkpass /
 * Google Wallet JWT üretimi bu arayüzün arkasında devreye alınır.
 */
export type WalletKind = "ticket" | "coupon";

export type PassData = {
  kind: WalletKind;
  /** Pass üzerinde görünen başlık (etkinlik adı veya kupon başlığı). */
  title: string;
  /** Alt başlık (kişi adı veya marka adı). */
  subtitle: string;
  /** QR içeriğinde kodlanan doğrulama jetonu. */
  code: string;
  /** Ek alanlar (tarih, konum, değer, koşullar). */
  fields: { label: string; value: string }[];
  /** Marka rengi (hex). */
  accentColor?: string;
  /** Etkinlik başlangıcı. Varsa Apple `relevantDate` olur. */
  relevantDate?: Date | string | null;
  /** Kupon bitişi. Varsa Apple `expirationDate` ve Google geçerlilik sonu olur. */
  expirationDate?: Date | string | null;
};

export type WalletLinks = {
  /** QR kodu PNG data URL (her zaman üretilir). */
  qrDataUrl: string;
  /** Apple Wallet'a ekleme bağlantısı (mock: web görünümü). */
  appleUrl: string;
  /** Google Wallet'a ekleme bağlantısı (mock: web görünümü). */
  googleUrl: string;
  /** Gerçek cüzdan imzalama aktif mi? */
  live: boolean;
};

function appBase(): string {
  return envStr("APP_URL", "http://localhost:3000").replace(/\/$/, "");
}

function filled(name: string): boolean {
  return envStr(name, "").trim().length > 0;
}

/**
 * Apple imzası için sertifika, WWDR, Team ID ve Pass Type ID birlikte gerekir.
 * WWDR veya Pass Type ID boşken yalnız sertifika "canlı" sayılırsa arayüz API'ye gider,
 * üretimde pkpass üretilemeyip 307 ile web sayfasına düşer.
 */
export function appleWalletConfigured(): boolean {
  return filled("APPLE_WALLET_CERT") && filled("APPLE_WALLET_WWDR") && filled("APPLE_WALLET_TEAM_ID") && filled("APPLE_WALLET_PASS_TYPE_ID");
}
export function googleWalletConfigured(): boolean {
  return envStr("GOOGLE_WALLET_ISSUER_ID", "").trim().length > 0 && envStr("GOOGLE_WALLET_SA_KEY", "").trim().length > 0;
}

/** QR kodu PNG data URL üretir (yüksek hata düzeltme; baskı/ekran için uygun). */
export async function qrDataUrl(content: string): Promise<string> {
  return QRCode.toDataURL(content, { errorCorrectionLevel: "M", margin: 1, width: 320 });
}

/** QR kodu SVG string üretir (ölçeklenebilir; bilet/kupon kartında gömülü kullanım). */
export async function qrSvg(content: string): Promise<string> {
  return QRCode.toString(content, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
}

/**
 * Bir bilet/kupon için cüzdan bağlantılarını üretir. Anahtar yoksa (mock) bağlantılar,
 * pass'in web görünümüne gider; anahtar varsa gerçek .pkpass / Google JWT uçlarına.
 */
export async function buildWalletLinks(kind: WalletKind, id: string, qrContent: string): Promise<WalletLinks> {
  const base = appBase();
  const appleLive = appleWalletConfigured();
  const googleLive = googleWalletConfigured();
  const path = kind === "ticket" ? "bilet" : "kupon";
  // Gerçek modda imzalı pass uçları; mock modda web görünümü.
  const appleUrl = appleLive ? `${base}/api/wallet/apple/${kind}/${id}` : `${base}/${path}/${id}`;
  const googleUrl = googleLive ? `${base}/api/wallet/google/${kind}/${id}` : `${base}/${path}/${id}`;
  return {
    qrDataUrl: await qrDataUrl(qrContent),
    appleUrl,
    googleUrl,
    live: appleLive || googleLive,
  };
}

/** UTC anı. Boş veya geçersizse pass alanına yazılmaz. */
export function passInstant(value: Date | string | null | undefined): string | undefined {
  if (value == null || value === "") return undefined;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * openssl/jose hatalarını loglamak için. PEM, parola ve uzun anahtar parçaları düşer.
 */
export function walletErrorDetail(err: unknown): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "bilinmeyen hata";
  return message
    .replace(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g, "[redacted]")
    .replace(/\bpass:[^\s'"]+/gi, "pass:[redacted]")
    .replace(/[A-Za-z0-9+/_-]{40,}={0,2}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

export function logWallet(scope: "apple" | "google", message: string, err?: unknown): void {
  if (err === undefined) console.error(`[wallet][${scope}] ${message}`);
  else console.error(`[wallet][${scope}] ${message}`, walletErrorDetail(err));
}

/** Pass verisini JSON'a serialize eder (gerçek .pkpass / Google JWT üretimi buradan türer). */
export function serializePass(data: PassData): string {
  return JSON.stringify({
    formatVersion: 1,
    kind: data.kind,
    title: data.title,
    subtitle: data.subtitle,
    barcode: { format: "QR", message: data.code },
    fields: data.fields,
    accentColor: data.accentColor ?? "#ff2bd6",
  });
}
