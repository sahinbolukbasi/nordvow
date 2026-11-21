import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { applePassJson, buildPkpass } from "../src/wallet/apple-pass";
import { buildGoogleWalletLink } from "../src/wallet/google-pass";
import { renderBannerPng, renderBrandIconPng } from "../src/wallet/png";
import type { PassData } from "../src/wallet/passes";

const sampleTicket: PassData = {
  kind: "ticket",
  title: "Nordvow Lansman Gecesi",
  subtitle: "Can Yılmaz",
  code: "TKT-9F2A1C",
  organizer: "Nordvow Studio",
  statusLabel: "Geçerli",
  description: "Sezon açılış daveti",
  accentColor: "#9d4dff",
  relevantDate: "2026-12-01T19:00:00.000Z",
  location: { latitude: 41.0082, longitude: 28.9784, relevantText: "Studio X" },
  webUrl: "https://nordvow.com/bilet/tkt1",
  fields: [
    { label: "Tarih", value: "1 Aralık 2026 19:00" },
    { label: "Mekan", value: "Studio X, İstanbul" },
  ],
};

const sampleCoupon: PassData = {
  kind: "coupon",
  title: "Hoş Geldin İndirimi",
  subtitle: "%25 İndirim",
  code: "KPN-WELCOME25",
  organizer: "Glow Brand",
  statusLabel: "Kullanılabilir",
  terms: "Tek kullanımlıktır.",
  accentColor: "#ff2bd6",
  expirationDate: "2026-12-31T23:59:59.000Z",
  webUrl: "https://nordvow.com/kupon/kpn1",
  fields: [{ label: "Son kullanım", value: "31.12.2026" }],
};

describe("wallet PNG ve pass üretimi", () => {
  it("geçerli PNG başlığıyla ikon ve banner üretir", () => {
    const icon = renderBrandIconPng(58);
    expect(icon.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const banner = renderBannerPng(1032, 336, "#ff2bd6");
    expect(banner.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it("applePassJson boş değerli alan üretmez ve konum/tarih içerir", () => {
    const tJson = applePassJson(sampleTicket, "tkt1", { teamId: "TEAM123456", passTypeId: "pass.com.nordvow" });
    expect(tJson.passTypeIdentifier).toBe("pass.com.nordvow");
    expect(tJson.teamIdentifier).toBe("TEAM123456");
    const et = tJson.eventTicket as { headerFields: { value: string }[]; primaryFields: { value: string }[] };
    expect(et.headerFields[0]!.value).toBe("Geçerli");
    expect(et.primaryFields[0]!.value).toBe("Nordvow Lansman Gecesi");
    expect(tJson.locations).toHaveLength(1);

    const cJson = applePassJson(sampleCoupon, "kpn1", { teamId: "TEAM123456", passTypeId: "pass.com.nordvow" });
    const cp = cJson.coupon as { primaryFields: { value: string }[] };
    expect(cp.primaryFields[0]!.value).toBe("%25 İndirim");
  });

  it("gerçek openssl sertifikası ile imzalı .pkpass üretir ve doğrular", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pkpass-test-"));
    const prevEnv = { ...process.env };
    try {
      // Test CA (WWDR simülasyonu) + Pass Type sertifikası + .p12 oluştur
      const caKey = path.join(dir, "ca.key");
      const caCert = path.join(dir, "ca.pem");
      const passKey = path.join(dir, "pass.key");
      const passCsr = path.join(dir, "pass.csr");
      const passCert = path.join(dir, "pass.pem");
      const passP12 = path.join(dir, "pass.p12");

      expect(
        spawnSync("openssl", [
          "req", "-x509", "-newkey", "rsa:2048", "-nodes",
          "-keyout", caKey, "-out", caCert, "-days", "2",
          "-subj", "/CN=Test WWDR",
        ]).status,
      ).toBe(0);
      expect(
        spawnSync("openssl", [
          "req", "-new", "-newkey", "rsa:2048", "-nodes",
          "-keyout", passKey, "-out", passCsr,
          "-subj", "/UID=pass.com.nordvow/CN=Nordvow Pass/OU=AB12CD34EF",
        ]).status,
      ).toBe(0);
      expect(
        spawnSync("openssl", [
          "x509", "-req", "-in", passCsr, "-CA", caCert, "-CAkey", caKey,
          "-CAcreateserial", "-out", passCert, "-days", "2",
        ]).status,
      ).toBe(0);
      expect(
        spawnSync("openssl", [
          "pkcs12", "-export", "-inkey", passKey, "-in", passCert,
          "-out", passP12, "-passout", "pass:testpass",
        ]).status,
      ).toBe(0);

      process.env.APPLE_WALLET_CERT = readFileSync(passP12).toString("base64");
      process.env.APPLE_WALLET_CERT_PASSWORD = "testpass";
      process.env.APPLE_WALLET_WWDR = readFileSync(caCert).toString("base64");
      process.env.APPLE_WALLET_TEAM_ID = "AB12CD34EF";
      process.env.APPLE_WALLET_PASS_TYPE_ID = "pass.com.nordvow";

      const pkpass = await buildPkpass(sampleTicket, "tkt1");
      expect(pkpass).not.toBeNull();

      // Zip'i aç ve PKCS#7 imzasını doğrula
      const outZip = path.join(dir, "out.pkpass");
      const extractDir = path.join(dir, "out");
      writeFileSync(outZip, pkpass!);
      expect(spawnSync("unzip", ["-q", outZip, "-d", extractDir]).status).toBe(0);

      const verify = spawnSync(
        "openssl",
        [
          "smime", "-verify", "-binary", "-inform", "DER",
          "-in", path.join(extractDir, "signature"),
          "-content", path.join(extractDir, "manifest.json"),
          "-CAfile", caCert,
          "-purpose", "any",
          "-out", "/dev/null",
        ],
        { encoding: "utf8" },
      );
      expect(verify.status).toBe(0);
    } finally {
      process.env = prevEnv;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("Google Wallet JWT içinde classTemplateInfo, logo, heroImage ve koyu arka plan üretir", async () => {
    const prevEnv = { ...process.env };
    try {
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      process.env.APP_URL = "https://nordvow.com";
      process.env.GOOGLE_WALLET_ISSUER_ID = "3388000000022123456";
      process.env.GOOGLE_WALLET_SA_KEY = JSON.stringify({
        client_email: "wallet@example.iam.gserviceaccount.com",
        private_key: privateKey,
      });

      const link = await buildGoogleWalletLink(sampleCoupon, "kpn1");
      expect(link).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);
      const jwt = link!.replace("https://pay.google.com/gp/v/save/", "");
      const decoded = decodeJwt(jwt) as {
        payload: {
          genericClasses: { id: string; classTemplateInfo: unknown }[];
          genericObjects: {
            hexBackgroundColor: string;
            logo?: { sourceUri: { uri: string } };
            heroImage?: { sourceUri: { uri: string } };
            barcode: { alternateText?: string };
          }[];
        };
      };
      expect(decoded.payload.genericClasses[0]!.id).toBe("3388000000022123456.nordvow_coupon_v2");
      expect(decoded.payload.genericClasses[0]!.classTemplateInfo).toBeTruthy();
      const obj = decoded.payload.genericObjects[0]!;
      expect(obj.hexBackgroundColor).toBe("#13131d");
      expect(obj.logo?.sourceUri.uri).toBe("https://nordvow.com/api/wallet/assets/logo.png");
      expect(obj.heroImage?.sourceUri.uri).toContain("https://nordvow.com/api/wallet/assets/hero.png");
      expect(obj.barcode.alternateText).toBe("KPN-WELCOME25");
    } finally {
      process.env = prevEnv;
    }
  });
});
