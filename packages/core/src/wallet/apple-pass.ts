import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { envStr } from "../env";
import { BRAND_NAME } from "../brand";
import { appleWalletConfigured, type PassData } from "./passes";
import { renderBannerPng, renderBrandIconPng } from "./png";

/**
 * Apple Wallet .pkpass üretimi (gerçek PKCS#7 imzalı).
 *
 * Geçerli bir .pkpass: pass.json + görseller + manifest.json (her dosyanın SHA1'i) +
 * signature (manifest'in Pass Type sertifikasıyla PKCS#7/detached imzası) ZIP'lenir.
 * İmzalama openssl ile yapılır.
 *
 * Gereken ortam değişkenleri:
 *   APPLE_WALLET_CERT          — Pass Type ID sertifikası + özel anahtar, .p12, BASE64
 *   APPLE_WALLET_CERT_PASSWORD — .p12 parolası
 *   APPLE_WALLET_WWDR          — Apple WWDR ara sertifikası (.pem veya .cer), BASE64 veya PEM
 *   APPLE_WALLET_TEAM_ID       — Apple Team ID (10 karakter)
 *   APPLE_WALLET_PASS_TYPE_ID  — pass.com.nordvow... (Pass Type Identifier)
 */

function nonEmpty(value: string | null | undefined, fallback: string): string {
  const v = (value ?? "").trim();
  return v.length > 0 ? v : fallback;
}

function isoDate(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toISOString();
}

export function applePassJson(
  data: PassData,
  serial: string,
  overrides?: { teamId?: string; passTypeId?: string },
): Record<string, unknown> {
  const teamId = nonEmpty(overrides?.teamId ?? envStr("APPLE_WALLET_TEAM_ID", ""), "TEAMID");
  const passTypeId = nonEmpty(overrides?.passTypeId ?? envStr("APPLE_WALLET_PASS_TYPE_ID", ""), "pass.com.nordvow");
  const organizer = nonEmpty(data.organizer, BRAND_NAME);
  const code = nonEmpty(data.code, serial);

  const aux = data.fields
    .filter((f) => f.label.trim().length > 0 && f.value.trim().length > 0)
    .slice(0, 4)
    .map((f, i) => ({ key: `f${i}`, label: f.label.trim(), value: f.value.trim() }));

  const backFields: { key: string; label: string; value: string }[] = [
    { key: "code", label: data.kind === "ticket" ? "Bilet Kodu" : "Kupon Kodu", value: code },
  ];
  if (data.description?.trim()) backFields.push({ key: "desc", label: "Açıklama", value: data.description.trim() });
  if (data.terms?.trim()) backFields.push({ key: "terms", label: "Kullanım Koşulları", value: data.terms.trim() });
  if (data.webUrl?.trim()) backFields.push({ key: "web", label: "Web Kartı", value: data.webUrl.trim() });

  const headerValue = nonEmpty(data.statusLabel, data.kind === "ticket" ? "BİLET" : "KUPON");
  const headerLabel = data.kind === "ticket" ? "BİLET" : "KUPON";

  const fields =
    data.kind === "ticket"
      ? {
          headerFields: [{ key: "kind", label: headerLabel, value: headerValue }],
          primaryFields: [{ key: "title", label: "ETKİNLİK", value: nonEmpty(data.title, "Etkinlik Bileti") }],
          secondaryFields: [{ key: "subtitle", label: "KATILIMCI", value: nonEmpty(data.subtitle, "Misafir") }],
          auxiliaryFields: aux,
          backFields,
        }
      : {
          headerFields: [{ key: "kind", label: headerLabel, value: headerValue }],
          primaryFields: [{ key: "value", label: nonEmpty(data.title, "Kupon"), value: nonEmpty(data.subtitle, "İndirim") }],
          secondaryFields: [{ key: "brand", label: "MARKA", value: organizer }],
          auxiliaryFields: aux,
          backFields,
        };

  const pass: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: passTypeId,
    teamIdentifier: teamId,
    organizationName: organizer,
    logoText: organizer,
    description: nonEmpty(data.title, organizer),
    serialNumber: serial,
    backgroundColor: "rgb(20,20,31)",
    foregroundColor: "rgb(255,255,255)",
    labelColor: "rgb(185,185,205)",
    barcodes: [{ format: "PKBarcodeFormatQR", message: code, messageEncoding: "utf-8", altText: code }],
    ...(data.kind === "ticket" ? { eventTicket: fields } : { coupon: fields }),
  };

  const rel = isoDate(data.relevantDate);
  if (rel) pass.relevantDate = rel;
  const exp = isoDate(data.expirationDate);
  if (exp) pass.expirationDate = exp;
  if (data.location && Number.isFinite(data.location.latitude) && Number.isFinite(data.location.longitude)) {
    pass.locations = [
      {
        latitude: data.location.latitude,
        longitude: data.location.longitude,
        ...(data.location.relevantText ? { relevantText: data.location.relevantText } : {}),
      },
    ];
  }

  return pass;
}

function sha1(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

function cleanBase64(raw: string): string {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  const dataUriIdx = s.indexOf(";base64,");
  if (dataUriIdx !== -1) s = s.slice(dataUriIdx + 8);
  return s.replace(/\s+/g, "");
}

function decodeWwdr(raw: string): Buffer {
  const trimmed = raw.trim().replace(/\\n/g, "\n");
  if (trimmed.includes("BEGIN CERTIFICATE")) {
    return Buffer.from(trimmed, "utf8");
  }
  const buf = Buffer.from(cleanBase64(trimmed), "base64");
  if (buf.toString("utf8").includes("BEGIN CERTIFICATE")) {
    return buf;
  }
  const b64 = buf.toString("base64").replace(/(.{64})/g, "$1\n");
  return Buffer.from(`-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`);
}

function extractCertIds(certPath: string): { passTypeId?: string; teamId?: string } {
  const r = spawnSync("openssl", ["x509", "-in", certPath, "-noout", "-subject", "-nameopt", "RFC2253"], {
    encoding: "utf8",
  });
  if (r.status !== 0) return {};
  const out = r.stdout ?? "";
  const uidMatch = /(?:^|,|\s)(?:UID|userId)=([^,\r\n]+)/i.exec(out);
  const ouMatch = /(?:^|,|\s)OU=([^,\r\n]+)/i.exec(out);
  return {
    passTypeId: uidMatch?.[1]?.trim(),
    teamId: ouMatch?.[1]?.trim(),
  };
}

/**
 * İmzalı .pkpass üretir. Sertifika yoksa veya imzalama başarısız olursa null döner.
 */
export async function buildPkpass(data: PassData, serial: string): Promise<Buffer | null> {
  if (!appleWalletConfigured()) return null;
  const p12raw = envStr("APPLE_WALLET_CERT", "").trim();
  const wwdrRaw = envStr("APPLE_WALLET_WWDR", "").trim();
  const p12pass = envStr("APPLE_WALLET_CERT_PASSWORD", "");
  if (!p12raw || !wwdrRaw) return null;

  const dir = mkdtempSync(path.join(tmpdir(), "pkpass-"));
  try {
    // 1) Sertifikaları ayıkla (.p12 → cert.pem + key.pem) ve WWDR'ı yaz
    const p12Path = path.join(dir, "cert.p12");
    const certPath = path.join(dir, "cert.pem");
    const keyPath = path.join(dir, "key.pem");
    const wwdrPath = path.join(dir, "wwdr.pem");
    writeFileSync(p12Path, Buffer.from(cleanBase64(p12raw), "base64"));
    writeFileSync(wwdrPath, decodeWwdr(wwdrRaw));

    const tryExtract = (extra: string[]) => {
      const c = openssl(["pkcs12", "-in", p12Path, "-clcerts", "-nokeys", "-out", certPath, "-passin", `pass:${p12pass}`, ...extra]);
      const k = openssl(["pkcs12", "-in", p12Path, "-nocerts", "-nodes", "-out", keyPath, "-passin", `pass:${p12pass}`, ...extra]);
      return { ok: c.ok && k.ok, err: c.err || k.err };
    };

    let extracted = tryExtract(["-legacy"]);
    if (!extracted.ok) {
      extracted = tryExtract([]);
    }
    if (!extracted.ok) {
      console.error("[apple-wallet] .p12 ayıklama hatası:", extracted.err);
      return null;
    }

    // Sertifikadaki UID (passTypeId) ve OU (teamId) ile uyumu garanti et
    const certIds = extractCertIds(certPath);
    const envTeamId = envStr("APPLE_WALLET_TEAM_ID", "").trim();
    const envPassTypeId = envStr("APPLE_WALLET_PASS_TYPE_ID", "").trim();
    if (certIds.teamId && envTeamId && certIds.teamId !== envTeamId) {
      console.warn(`[apple-wallet] TEAM_ID uyuşmazlığı (env=${envTeamId}, cert=${certIds.teamId}); sertifika değeri kullanılıyor.`);
    }
    if (certIds.passTypeId && envPassTypeId && certIds.passTypeId !== envPassTypeId) {
      console.warn(`[apple-wallet] PASS_TYPE_ID uyuşmazlığı (env=${envPassTypeId}, cert=${certIds.passTypeId}); sertifika değeri kullanılıyor.`);
    }

    // 2) Dosyalar: pass.json + görseller
    const passJson = Buffer.from(
      JSON.stringify(
        applePassJson(data, serial, {
          teamId: certIds.teamId || envTeamId || undefined,
          passTypeId: certIds.passTypeId || envPassTypeId || undefined,
        }),
      ),
    );
    const files: Record<string, Buffer> = {
      "pass.json": passJson,
      "icon.png": renderBrandIconPng(29),
      "icon@2x.png": renderBrandIconPng(58),
      "icon@3x.png": renderBrandIconPng(87),
      "logo.png": renderBrandIconPng(50),
      "logo@2x.png": renderBrandIconPng(100),
      "strip.png": renderBannerPng(375, 123, data.accentColor),
      "strip@2x.png": renderBannerPng(750, 246, data.accentColor),
    };

    // 3) manifest.json (her dosyanın SHA1'i)
    const manifest: Record<string, string> = {};
    for (const [name, buf] of Object.entries(files)) manifest[name] = sha1(buf);
    files["manifest.json"] = Buffer.from(JSON.stringify(manifest));
    for (const [name, buf] of Object.entries(files)) writeFileSync(path.join(dir, name), buf);

    // 4) manifest.json'ı PKCS#7 detached imzala → signature
    const sigPath = path.join(dir, "signature");
    const sign = openssl([
      "smime", "-sign", "-binary",
      "-signer", certPath, "-inkey", keyPath, "-certfile", wwdrPath,
      "-in", path.join(dir, "manifest.json"), "-out", sigPath,
      "-outform", "DER", "-noattr",
    ]);
    if (!sign.ok) {
      console.error("[apple-wallet] PKCS#7 imzalama hatası:", sign.err);
      return null;
    }

    // 5) Hepsini zip'le (.pkpass)
    const zipPath = path.join(dir, "pass.pkpass");
    const entries = [...Object.keys(files), "signature"];
    const zipRes = spawnSync("zip", ["-q", "-X", zipPath, ...entries], { cwd: dir, encoding: "utf8" });
    if (zipRes.status !== 0) {
      console.error("[apple-wallet] zip hatası:", zipRes.stderr);
      return null;
    }
    return readFileSync(zipPath);
  } catch (err) {
    console.error("[apple-wallet] Beklenmeyen hata:", err);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function openssl(args: string[]): { ok: boolean; err: string } {
  const r = spawnSync("openssl", args, { encoding: "utf8" });
  return { ok: r.status === 0, err: r.stderr ?? "" };
}
