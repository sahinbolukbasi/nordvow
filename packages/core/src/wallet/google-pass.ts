import { importPKCS8, SignJWT } from "jose";
import { envStr } from "../env";
import { BRAND_NAME } from "../brand";
import { googleWalletConfigured, logWallet, passInstant, type PassData } from "./passes";

/**
 * Google Wallet "Save to Wallet" bağlantısı üretimi.
 *
 * Servis hesabı anahtarıyla (GOOGLE_WALLET_SA_KEY = JSON) imzalanmış bir JWT oluşturulur;
 * JWT içinde generic pass object gömülür. Kullanıcı linke tıklayınca Google Wallet'a eklenir.
 * Anahtar/Issuer ID yoksa null döner (çağıran web görünümüne düşer).
 *
 * Gereken ortam değişkenleri:
 *   GOOGLE_WALLET_ISSUER_ID  — pay.google.com/business/console'dan alınan issuer numarası
 *   GOOGLE_WALLET_SA_KEY     — servis hesabı anahtarı (tüm JSON içeriği)
 *
 * JWT claim'leri: https://developers.google.com/wallet/generic/web/javascript-button
 * (`iss`, `aud=google`, `typ=savetowallet`, `iat` saniye, `origins`, `payload`).
 * GenericClass şeması: https://developers.google.com/wallet/reference/rest/v1/genericclass
 * GenericObject şeması: https://developers.google.com/wallet/reference/rest/v1/genericobject
 */
type ServiceAccount = { client_email: string; private_key: string };

const WALLET_SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1";

function serviceAccount(): ServiceAccount | null {
  const raw = envStr("GOOGLE_WALLET_SA_KEY", "").trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as ServiceAccount;
    if (j.client_email && j.private_key) return j;
    logWallet("google", "servis hesabında client_email veya private_key yok");
    return null;
  } catch (err) {
    logWallet("google", "servis hesabı JSON okunamadı", err);
    return null;
  }
}

/** Issuer ID ile sınıf (class) kimliği. Tür başına tek sınıf yeterli. Yalnızca [A-Za-z0-9._-]. */
function classId(issuerId: string, kind: PassData["kind"]): string {
  return `${issuerId}.nordvow_${kind}`;
}

function hexColor(input: string | undefined): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((input ?? "").trim());
  return m ? `#${m[1]!.toLowerCase()}` : "#ff2bd6";
}

function localized(value: string) {
  return { defaultValue: { language: "tr", value } };
}

/**
 * Generic pass object'i (JWT içine gömülür).
 * cardTitle, header, id ve classId GenericObject'te zorunlu.
 */
function buildGenericObject(issuerId: string, data: PassData, serial: string) {
  const objectId = `${issuerId}.${serial.replace(/[^\w.-]/g, "_")}`;
  const textModulesData = data.fields.slice(0, 4).flatMap((f, i) => {
    const body = f.value.trim();
    if (!body) return [];
    return [{ id: `f${i}`, header: (f.label.trim() || "Bilgi").slice(0, 35), body: body.slice(0, 500) }];
  });
  // Yalnız kupon bitişi geçerlilik aralığıdır. Etkinlik tarihi Apple'da relevantDate'dir;
  // Google'da yalnız start vermek bileti etkinlik anında süresi dolmuş gösterebilir.
  const end = data.kind === "coupon" ? passInstant(data.expirationDate) : undefined;
  const subtitle = data.subtitle.trim();
  return {
    id: objectId,
    classId: classId(issuerId, data.kind),
    genericType: data.kind === "ticket" ? "GENERIC_ENTRY_TICKET" : "GENERIC_VOUCHER",
    state: "ACTIVE",
    hexBackgroundColor: hexColor(data.accentColor),
    cardTitle: localized(BRAND_NAME),
    header: localized(data.title.trim() || BRAND_NAME),
    ...(subtitle ? { subheader: localized(subtitle) } : {}),
    barcode: { type: "QR_CODE", value: data.code },
    ...(textModulesData.length ? { textModulesData } : {}),
    ...(end ? { validTimeInterval: { end: { date: end } } } : {}),
  };
}

/**
 * Generic class. Discovery şemasında zorunlu alan yalnız `id` (`issuerID.identifier`).
 * İlk JWT kaydında sınıf boş kalmasın diye paylaşım durumu ve noktasız kimlikli bir metin
 * modülü de gider. classTemplateInfo bağlanmaz; nesnede olmayan alan yolu kaydı reddedebilir.
 * https://developers.google.com/wallet/reference/rest/v1/genericclass
 */
function buildGenericClass(issuerId: string, kind: PassData["kind"]) {
  return {
    id: classId(issuerId, kind),
    multipleDevicesAndHoldersAllowedStatus: kind === "ticket" ? "ONE_USER_ALL_DEVICES" : "MULTIPLE_HOLDERS",
    textModulesData: [
      {
        id: "kind",
        header: kind === "ticket" ? "Bilet" : "Kupon",
        body: BRAND_NAME,
      },
    ],
  };
}

/**
 * "Save to Google Wallet" bağlantısı üretir. Anahtar yoksa veya imza başarısızsa null.
 * Döndürülen link doğrudan kullanıcıya sunulabilir. Sınıfı önceden açmak için
 * `upsertGoogleGenericClass` ayrıca çağrılabilir; bu fonksiyon onu çağırmaz.
 */
export async function buildGoogleWalletLink(data: PassData, serial: string): Promise<string | null> {
  if (!googleWalletConfigured()) return null;
  const sa = serviceAccount();
  const issuerId = envStr("GOOGLE_WALLET_ISSUER_ID", "").trim();
  if (!sa || !issuerId) return null;

  try {
    const claims = {
      iss: sa.client_email,
      aud: "google",
      typ: "savetowallet",
      iat: Math.floor(Date.now() / 1000),
      origins: [envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "")],
      payload: {
        genericClasses: [buildGenericClass(issuerId, data.kind)],
        genericObjects: [buildGenericObject(issuerId, data, serial)],
      },
    };
    const key = await importPKCS8(sa.private_key, "RS256");
    const jwt = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", typ: "JWT" }).sign(key);
    return `https://pay.google.com/gp/v/save/${jwt}`;
  } catch (err) {
    logWallet("google", "JWT üretilemedi", err);
    return null;
  }
}

async function googleAccessToken(sa: ServiceAccount, signal: AbortSignal): Promise<string | null> {
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: WALLET_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal,
  });
  const raw = await res.text();
  if (!res.ok) {
    logWallet("google", `erişim jetonu alınamadı (${res.status})`);
    return null;
  }
  let token = "";
  try {
    token = String((JSON.parse(raw) as { access_token?: string }).access_token ?? "");
  } catch (err) {
    logWallet("google", "erişim jetonu yanıtı okunamadı", err);
    return null;
  }
  if (!token) {
    logWallet("google", "erişim jetonu yanıtı boş");
    return null;
  }
  return token;
}

/**
 * Generic class'ı walletobjects REST ile yoksa oluşturur. Varsa konsoldaki haline dokunmaz.
 * Kaydetme linkinin akışını değiştirmez; sınıf JWT'den önce açılsın istenirse çağrılır.
 * Başarıda true. Ağ veya kimlik hatasında false (ayrıntı loglanır, anahtar loglanmaz).
 */
export async function upsertGoogleGenericClass(kind: PassData["kind"]): Promise<boolean> {
  if (!googleWalletConfigured()) return false;
  const sa = serviceAccount();
  const issuerId = envStr("GOOGLE_WALLET_ISSUER_ID", "").trim();
  if (!sa || !issuerId) return false;

  const signal = AbortSignal.timeout(15_000);
  try {
    const access = await googleAccessToken(sa, signal);
    if (!access) return false;
    const id = classId(issuerId, kind);
    const headers = { authorization: `Bearer ${access}`, "content-type": "application/json" };
    const existing = await fetch(`${WALLET_API}/genericClass/${encodeURIComponent(id)}`, { headers, signal });
    await existing.arrayBuffer().catch(() => undefined);
    if (existing.status === 200) return true;
    if (existing.status !== 404) {
      logWallet("google", `sınıf okunamadı (${existing.status})`);
      return false;
    }
    const created = await fetch(`${WALLET_API}/genericClass`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildGenericClass(issuerId, kind)),
      signal,
    });
    await created.arrayBuffer().catch(() => undefined);
    if (created.status === 200 || created.status === 409) return true;
    logWallet("google", `sınıf oluşturulamadı (${created.status})`);
    return false;
  } catch (err) {
    logWallet("google", "sınıf upsert hatası", err);
    return false;
  }
}
