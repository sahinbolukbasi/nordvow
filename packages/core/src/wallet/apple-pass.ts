import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { envStr } from "../env";
import { BRAND_NAME } from "../brand";
import { appleWalletConfigured, logWallet, passInstant, type PassData } from "./passes";

/**
 * Apple Wallet .pkpass üretimi (gerçek PKCS#7 imzalı).
 *
 * Geçerli bir .pkpass: pass.json + görseller + manifest.json (her dosyanın SHA1'i) +
 * signature (manifest'in Pass Type sertifikasıyla PKCS#7/detached imzası) ZIP'lenir.
 * İmzalama openssl ile yapılır (container'da kuruludur).
 *
 * Gereken ortam değişkenleri (Secrets Manager):
 *   APPLE_WALLET_CERT          — Pass Type ID sertifikası + özel anahtar, .p12, BASE64
 *   APPLE_WALLET_CERT_PASSWORD — .p12 parolası
 *   APPLE_WALLET_WWDR          — Apple WWDR ara sertifikası (.pem veya .cer), BASE64
 *   APPLE_WALLET_TEAM_ID       — Apple Team ID
 *   APPLE_WALLET_PASS_TYPE_ID  — pass.com.nordvow... (Pass Type Identifier)
 */

// Minimal zorunlu görseller (pkpass icon şart). Nordvow mor düz renk (29/58 px).
const ICON_29 = "iVBORw0KGgoAAAANSUhEUgAAAB0AAAAdCAIAAADZ8fBYAAAAJklEQVR42mOY6/ufFohh1NxRc0fNHTV31NxRc0fNHTV31NxBZS4AuGtGzJuNe0oAAAAASUVORK5CYII=";
const ICON_58 = "iVBORw0KGgoAAAANSUhEUgAAADoAAAA6CAIAAABu2d1/AAAARElEQVR42u3OAQkAAAgDsBc0olk1x2GwAMvOFYmurq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6ubo8HEdgbPDsJluoAAAAASUVORK5CYII=";

export function applePassJson(data: PassData, serial: string): Record<string, unknown> {
  const teamId = envStr("APPLE_WALLET_TEAM_ID", "TEAMID");
  const passTypeId = envStr("APPLE_WALLET_PASS_TYPE_ID", "pass.com.nordvow");
  const common = {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    teamIdentifier: teamId,
    organizationName: BRAND_NAME,
    description: data.title,
    serialNumber: serial,
    backgroundColor: hexToRgb(data.accentColor ?? "#ff2bd6"),
    foregroundColor: "rgb(255,255,255)",
    labelColor: "rgb(255,255,255)",
    barcodes: [{ format: "PKBarcodeFormatQR", message: data.code, messageEncoding: "iso-8859-1" }],
  };
  const dated: Record<string, string> = {};
  if (data.kind === "ticket") {
    const relevantDate = passInstant(data.relevantDate);
    if (relevantDate) dated.relevantDate = relevantDate;
  } else {
    const expirationDate = passInstant(data.expirationDate);
    if (expirationDate) dated.expirationDate = expirationDate;
  }
  const fields = {
    headerFields: [{ key: "kind", label: data.kind === "ticket" ? "BİLET" : "KUPON", value: "" }],
    primaryFields: [{ key: "title", label: "", value: data.title }],
    secondaryFields: [{ key: "subtitle", label: data.kind === "ticket" ? "Katılımcı" : "Marka", value: data.subtitle }],
    auxiliaryFields: data.fields.slice(0, 4).map((f, i) => ({ key: `f${i}`, label: f.label, value: f.value })),
  };
  return data.kind === "ticket" ? { ...common, ...dated, eventTicket: fields } : { ...common, ...dated, coupon: fields };
}

function hexToRgb(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return "rgb(255,43,214)";
  return `rgb(${parseInt(m[1]!, 16)},${parseInt(m[2]!, 16)},${parseInt(m[3]!, 16)})`;
}

function sha1(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

/**
 * İmzalı .pkpass üretir. Sertifika yoksa null (fallback: web görünümü).
 */
export async function buildPkpass(data: PassData, serial: string): Promise<Buffer | null> {
  if (!appleWalletConfigured()) return null;
  const p12b64 = envStr("APPLE_WALLET_CERT", "").trim();
  const wwdrb64 = envStr("APPLE_WALLET_WWDR", "").trim();
  const p12pass = envStr("APPLE_WALLET_CERT_PASSWORD", "");
  if (!p12b64 || !wwdrb64) {
    logWallet("apple", "APPLE_WALLET_CERT veya APPLE_WALLET_WWDR boş");
    return null;
  }

  const dir = mkdtempSync(path.join(tmpdir(), "pkpass-"));
  try {
    // 1) Dosyalar: pass.json + ikonlar
    const passJson = Buffer.from(JSON.stringify(applePassJson(data, serial)));
    const files: Record<string, Buffer> = {
      "pass.json": passJson,
      "icon.png": Buffer.from(ICON_29, "base64"),
      "icon@2x.png": Buffer.from(ICON_58, "base64"),
    };
    // 2) manifest.json (her dosyanın SHA1'i)
    const manifest: Record<string, string> = {};
    for (const [name, buf] of Object.entries(files)) manifest[name] = sha1(buf);
    files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
    for (const [name, buf] of Object.entries(files)) writeFileSync(path.join(dir, name), buf);

    // 3) Sertifikaları ayıkla (.p12 → cert.pem + key.pem) ve WWDR'ı yaz
    const p12Path = path.join(dir, "cert.p12");
    const certPath = path.join(dir, "cert.pem");
    const keyPath = path.join(dir, "key.pem");
    const wwdrPath = path.join(dir, "wwdr.pem");
    writeFileSync(p12Path, Buffer.from(p12b64, "base64"));
    writeFileSync(wwdrPath, normalizeWwdr(Buffer.from(wwdrb64, "base64")));

    // .p12'den sertifika ve anahtarı çıkar (legacy bayrağı eski .p12'ler için).
    const legacyCert = openssl(["pkcs12", "-in", p12Path, "-clcerts", "-nokeys", "-out", certPath, "-passin", `pass:${p12pass}`, "-legacy"]);
    const legacyKey = openssl(["pkcs12", "-in", p12Path, "-nocerts", "-nodes", "-out", keyPath, "-passin", `pass:${p12pass}`, "-legacy"]);
    let certOk = legacyCert.ok;
    let keyOk = legacyKey.ok;
    let certErr = legacyCert.err;
    let keyErr = legacyKey.err;
    if (!certOk || !keyOk) {
      // -legacy desteklemeyen veya modern .p12 okuyamayan openssl için tekrar dene.
      const plainCert = openssl(["pkcs12", "-in", p12Path, "-clcerts", "-nokeys", "-out", certPath, "-passin", `pass:${p12pass}`]);
      const plainKey = openssl(["pkcs12", "-in", p12Path, "-nocerts", "-nodes", "-out", keyPath, "-passin", `pass:${p12pass}`]);
      certOk = plainCert.ok;
      keyOk = plainKey.ok;
      certErr = plainCert.err || certErr;
      keyErr = plainKey.err || keyErr;
    }
    if (!certOk || !keyOk) {
      logWallet("apple", "p12 ayrılamadı", certOk ? keyErr : certErr);
      return null;
    }

    // 4) manifest.json'ı PKCS#7 detached imzala → signature
    const sigPath = path.join(dir, "signature");
    const sign = openssl([
      "smime", "-sign", "-binary",
      "-signer", certPath, "-inkey", keyPath, "-certfile", wwdrPath,
      "-in", path.join(dir, "manifest.json"), "-out", sigPath,
      "-outform", "DER", "-noattr",
    ]);
    if (!sign.ok) {
      logWallet("apple", "manifest imzalanamadı", sign.err);
      return null;
    }

    // 5) Hepsini zip'le (.pkpass). zip CLI container'da kurulu.
    const zipPath = path.join(dir, "pass.pkpass");
    const entries = ["pass.json", "icon.png", "icon@2x.png", "manifest.json", "signature"];
    const zipRes = spawnSync("zip", ["-q", "-X", zipPath, ...entries], { cwd: dir });
    if (zipRes.status !== 0) {
      const stderr = Buffer.isBuffer(zipRes.stderr) ? zipRes.stderr.toString("utf8") : zipRes.stderr || "";
      logWallet("apple", "pkpass arşivi oluşturulamadı", stderr || zipRes.error?.message || "zip başarısız");
      return null;
    }
    return readFileSync(zipPath);
  } catch (err) {
    logWallet("apple", "pkpass üretilemedi", err);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function openssl(args: string[]): { ok: boolean; err: string } {
  const r = spawnSync("openssl", args, { encoding: "utf8" });
  const err = [r.stderr, r.error?.message].filter(Boolean).join(" ").trim();
  return { ok: r.status === 0, err };
}

/** WWDR .cer (DER) ise PEM'e çevir; zaten PEM ise olduğu gibi bırak. */
function normalizeWwdr(buf: Buffer): Buffer {
  const asText = buf.toString("utf8");
  if (asText.includes("BEGIN CERTIFICATE")) return buf;
  const b64 = buf.toString("base64").replace(/(.{64})/g, "$1\n");
  return Buffer.from(`-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`);
}
