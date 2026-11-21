import { createHash, generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeProtectedHeader, importSPKI, jwtVerify } from "jose";
import { applePassJson, buildPkpass } from "../src/wallet/apple-pass";
import { buildGoogleWalletLink, upsertGoogleGenericClass } from "../src/wallet/google-pass";
import { appleWalletConfigured, buildWalletLinks, type PassData } from "../src/wallet/passes";

const ENV_KEYS = [
  "APPLE_WALLET_CERT",
  "APPLE_WALLET_CERT_PASSWORD",
  "APPLE_WALLET_WWDR",
  "APPLE_WALLET_TEAM_ID",
  "APPLE_WALLET_PASS_TYPE_ID",
  "GOOGLE_WALLET_ISSUER_ID",
  "GOOGLE_WALLET_SA_KEY",
  "APP_URL",
] as const;

const snapshot = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

function tool(name: string, args: string[]): boolean {
  return spawnSync(name, args, { encoding: "utf8" }).status === 0;
}

const canSignPass = tool("openssl", ["version"]) && tool("zip", ["-v"]) && tool("unzip", ["-v"]);

function ticket(over: Partial<PassData> = {}): PassData {
  return {
    kind: "ticket",
    title: "Lansman",
    subtitle: "Can Yılmaz",
    code: "TKT-1",
    accentColor: "#ff2bd6",
    fields: [{ label: "Mekan", value: "Studio X" }],
    ...over,
  };
}

const ID_RE = /^[0-9A-Za-z_-]+\.[0-9A-Za-z_.-]+$/;

describe("Google Wallet JWT", () => {
  it("iss, aud, typ, iat, origins ve sınıf/nesne kimliğini doğrular", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const email = "wallet-test@example.iam.gserviceaccount.com";
    const issuer = "3388000000000000001";
    process.env.GOOGLE_WALLET_ISSUER_ID = issuer;
    process.env.GOOGLE_WALLET_SA_KEY = JSON.stringify({ client_email: email, private_key: pem });
    process.env.APP_URL = "https://nordvow.com/";

    const before = Math.floor(Date.now() / 1000);
    const link = await buildGoogleWalletLink(
      ticket({ relevantDate: "2026-06-01T18:00:00.000Z", fields: [{ label: "Mekan", value: "Studio X" }, { label: "Boş", value: "  " }] }),
      "ab/c d.e",
    );
    const after = Math.floor(Date.now() / 1000);
    expect(link).toMatch(/^https:\/\/pay\.google\.com\/gp\/v\/save\//);

    const token = link!.slice("https://pay.google.com/gp/v/save/".length);
    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe("RS256");
    const key = await importSPKI(publicKey.export({ type: "spki", format: "pem" }).toString(), "RS256");
    const { payload } = await jwtVerify(token, key, { audience: "google" });
    expect(payload.iss).toBe(email);
    expect(payload.aud).toBe("google");
    expect(payload.typ).toBe("savetowallet");
    expect(payload.iat).toBeGreaterThanOrEqual(before);
    expect(payload.iat).toBeLessThanOrEqual(after);
    expect(payload.origins).toEqual(["https://nordvow.com"]);

    const body = payload.payload as {
      genericClasses: Array<{ id: string; multipleDevicesAndHoldersAllowedStatus: string; textModulesData: Array<{ id: string }> }>;
      genericObjects: Array<{ id: string; classId: string; genericType: string; state: string; validTimeInterval?: unknown }>;
    };
    expect(body.genericClasses).toHaveLength(1);
    expect(body.genericClasses[0]!.id).toBe(`${issuer}.nordvow_ticket_v2`);
    expect(body.genericClasses[0]!.id).toMatch(ID_RE);
    expect(body.genericClasses[0]!.multipleDevicesAndHoldersAllowedStatus).toBe("ONE_USER_ALL_DEVICES");
    expect(body.genericClasses[0]!.textModulesData[0]!.id).toBe("kind");
    expect(body.genericObjects[0]!.id).toBe(`${issuer}.ab_c_d.e`);
    expect(body.genericObjects[0]!.id).toMatch(ID_RE);
    expect(body.genericObjects[0]!.classId).toBe(body.genericClasses[0]!.id);
    expect(body.genericObjects[0]!.genericType).toBe("GENERIC_ENTRY_TICKET");
    expect(body.genericObjects[0]!.state).toBe("ACTIVE");
    expect(body.genericObjects[0]!.validTimeInterval).toBeUndefined();
    const modules = (body.genericObjects[0] as { textModulesData?: Array<{ header: string; body: string }> }).textModulesData ?? [];
    expect(modules.map((m) => m.header)).not.toContain("Boş");
    expect(modules.some((m) => m.body.trim().length === 0)).toBe(false);
  });

  it("kupon sınıfı voucher ve bitiş aralığı taşır", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    process.env.GOOGLE_WALLET_ISSUER_ID = "3388000000000000002";
    process.env.GOOGLE_WALLET_SA_KEY = JSON.stringify({
      client_email: "coupon@example.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    });
    process.env.APP_URL = "https://nordvow.com";
    const link = await buildGoogleWalletLink(
      { kind: "coupon", title: "%20", subtitle: "Marka", code: "KPN-1", fields: [], expirationDate: "2026-12-31T21:00:00.000Z" },
      "grant_1",
    );
    const token = link!.slice("https://pay.google.com/gp/v/save/".length);
    const key = await importSPKI(publicKey.export({ type: "spki", format: "pem" }).toString(), "RS256");
    const { payload } = await jwtVerify(token, key, { audience: "google" });
    const body = payload.payload as {
      genericClasses: Array<{ id: string; multipleDevicesAndHoldersAllowedStatus: string }>;
      genericObjects: Array<{ id: string; genericType: string; validTimeInterval?: { end?: { date: string } } }>;
    };
    expect(body.genericClasses[0]!.id).toBe("3388000000000000002.nordvow_coupon_v2");
    expect(body.genericClasses[0]!.id).toMatch(ID_RE);
    expect(body.genericObjects[0]!.id).toBe("3388000000000000002.grant_1");
    expect(body.genericClasses[0]!.multipleDevicesAndHoldersAllowedStatus).toBe("MULTIPLE_HOLDERS");
    expect(body.genericObjects[0]!.genericType).toBe("GENERIC_VOUCHER");
    expect(body.genericObjects[0]!.validTimeInterval?.end?.date).toBe("2026-12-31T21:00:00.000Z");
  });

  it("bozuk anahtar 307 nedenini loglar, anahtar metnini yazmaz", async () => {
    const secret = "super-secret-key-material-xxxxx";
    process.env.GOOGLE_WALLET_ISSUER_ID = "3388000000000000001";
    process.env.GOOGLE_WALLET_SA_KEY = `not-json ${secret}`;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await buildGoogleWalletLink(ticket(), "id")).toBeNull();
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toMatch(/\[wallet\]\[google\]/);
    expect(logged).not.toContain(secret);

    process.env.GOOGLE_WALLET_SA_KEY = JSON.stringify({ client_email: "a@b.iam.gserviceaccount.com", private_key: secret });
    spy.mockClear();
    expect(await buildGoogleWalletLink(ticket(), "id")).toBeNull();
    const signed = spy.mock.calls.flat().join(" ");
    expect(signed).toMatch(/JWT üretilemedi/);
    expect(signed).not.toContain(secret);
  });

  it("anahtar yoksa sınıf upsert ağa çıkmaz", async () => {
    delete process.env.GOOGLE_WALLET_SA_KEY;
    delete process.env.GOOGLE_WALLET_ISSUER_ID;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await upsertGoogleGenericClass("ticket")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Apple pass.json tarihleri", () => {
  it("etkinlik tarihi relevantDate, kupon bitişi expirationDate olur", () => {
    const event = applePassJson(ticket({ relevantDate: new Date("2026-06-01T18:00:00.000Z"), expirationDate: "2099-01-01T00:00:00.000Z" }), "ser-1");
    expect(event.relevantDate).toBe("2026-06-01T18:00:00Z");
    expect(event.expirationDate).toBeUndefined();
    expect(event).toHaveProperty("eventTicket");

    const coupon = applePassJson(
      { kind: "coupon", title: "İndirim", subtitle: "Marka", code: "KPN", fields: [], expirationDate: "2026-12-31T21:00:00.000Z", relevantDate: "2026-01-01T00:00:00.000Z" },
      "ser-2",
    );
    expect(coupon.expirationDate).toBe("2026-12-31T21:00:00Z");
    expect(coupon.relevantDate).toBeUndefined();
    expect(coupon).toHaveProperty("coupon");

    const bare = applePassJson(ticket({ relevantDate: "geçersiz" }), "ser-3");
    expect(bare.relevantDate).toBeUndefined();
  });
});

describe("appleWalletConfigured", () => {
  it("WWDR veya Pass Type ID boşsa canlı sayılmaz", async () => {
    for (const key of ["APPLE_WALLET_CERT", "APPLE_WALLET_TEAM_ID", "APPLE_WALLET_WWDR", "APPLE_WALLET_PASS_TYPE_ID"] as const) {
      process.env[key] = "dolu";
    }
    expect(appleWalletConfigured()).toBe(true);
    const live = await buildWalletLinks("ticket", "abc", "QR");
    expect(live.appleUrl).toContain("/api/wallet/apple/ticket/abc");
    expect(live.live).toBe(true);

    process.env.APPLE_WALLET_WWDR = "  ";
    expect(appleWalletConfigured()).toBe(false);
    process.env.APPLE_WALLET_WWDR = "dolu";
    delete process.env.APPLE_WALLET_PASS_TYPE_ID;
    expect(appleWalletConfigured()).toBe(false);
    const web = await buildWalletLinks("ticket", "abc", "QR");
    expect(web.appleUrl).toContain("/bilet/abc");
    expect(web.appleUrl).not.toContain("/api/wallet/");
  });
});

describe("buildPkpass", () => {
  it("bozuk p12 null döner ve parolayı loglamaz", async () => {
    const password = "super-secret-password";
    process.env.APPLE_WALLET_CERT = Buffer.from("not-a-p12").toString("base64");
    process.env.APPLE_WALLET_CERT_PASSWORD = password;
    process.env.APPLE_WALLET_WWDR = Buffer.from("-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n").toString("base64");
    process.env.APPLE_WALLET_TEAM_ID = "TEAMID1234";
    process.env.APPLE_WALLET_PASS_TYPE_ID = "pass.com.nordvow.test";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await buildPkpass(ticket(), "id-1")).toBeNull();
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).toMatch(/\[wallet\]\[apple\]/);
    expect(logged).not.toContain(password);
    expect(logged).not.toContain("BEGIN CERTIFICATE");
    expect(logged).not.toContain("not-a-p12");
  });

  it.skipIf(!canSignPass)("geçici sertifikayla zip, manifest ve imza üretir", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pkpass-test-"));
    const out = mkdtempSync(path.join(tmpdir(), "pkpass-out-"));
    try {
      const run = (args: string[]) => {
        const r = spawnSync("openssl", args, { cwd: dir, encoding: "utf8" });
        if (r.status !== 0) throw new Error((r.stderr || r.error?.message || "openssl").slice(0, 300));
      };
      run(["req", "-x509", "-newkey", "rsa:2048", "-keyout", "key.pem", "-out", "cert.pem", "-days", "2", "-nodes", "-subj", "/CN=Nordvow Test Pass"]);
      run(["pkcs12", "-export", "-inkey", "key.pem", "-in", "cert.pem", "-out", "cert.p12", "-passout", "pass:test-pass"]);
      const password = "test-pass";
      process.env.APPLE_WALLET_CERT = readFileSync(path.join(dir, "cert.p12")).toString("base64");
      process.env.APPLE_WALLET_CERT_PASSWORD = password;
      process.env.APPLE_WALLET_WWDR = readFileSync(path.join(dir, "cert.pem")).toString("base64");
      process.env.APPLE_WALLET_TEAM_ID = "TEAMID1234";
      process.env.APPLE_WALLET_PASS_TYPE_ID = "pass.com.nordvow.test";

      const buf = await buildPkpass(ticket({ relevantDate: "2026-06-01T18:00:00.000Z" }), "ser-9");
      expect(buf).toBeInstanceOf(Buffer);
      const pkpass = path.join(out, "pass.pkpass");
      writeFileSync(pkpass, buf!);
      expect(spawnSync("unzip", ["-t", pkpass], { encoding: "utf8" }).status).toBe(0);
      expect(spawnSync("unzip", ["-o", pkpass, "-d", out], { encoding: "utf8" }).status).toBe(0);

      const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8")) as Record<string, string>;
      for (const name of ["pass.json", "icon.png", "icon@2x.png"]) {
        expect(manifest[name]).toBe(createHash("sha1").update(readFileSync(path.join(out, name))).digest("hex"));
      }
      expect(manifest).not.toHaveProperty("signature");
      const signature = readFileSync(path.join(out, "signature"));
      expect(signature.length).toBeGreaterThan(64);
      expect(signature[0]).toBe(0x30);
      const verify = spawnSync(
        "openssl",
        ["smime", "-verify", "-binary", "-inform", "DER", "-in", path.join(out, "signature"), "-content", path.join(out, "manifest.json"), "-noverify"],
        { encoding: "utf8" },
      );
      expect(verify.status).toBe(0);

      const pass = JSON.parse(readFileSync(path.join(out, "pass.json"), "utf8")) as { relevantDate?: string; passTypeIdentifier?: string; teamIdentifier?: string };
      expect(pass.relevantDate).toBe("2026-06-01T18:00:00Z");
      expect(pass.passTypeIdentifier).toBe("pass.com.nordvow.test");
      expect(pass.teamIdentifier).toBe("TEAMID1234");
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});
