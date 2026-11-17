import { importPKCS8, SignJWT } from "jose";
import { envStr } from "../env";
import { BRAND_NAME } from "../brand";
import { googleWalletConfigured, type PassData } from "./passes";

/**
 * Google Wallet "Save to Wallet" bağlantısı üretimi.
 *
 * Servis hesabı anahtarıyla (GOOGLE_WALLET_SA_KEY = JSON) imzalanmış bir JWT oluşturulur;
 * JWT içinde generic pass class (cardTemplateOverride ile 2 sütunlu ön yüz düzeni) ve
 * generic pass object gömülür.
 *
 * Gereken ortam değişkenleri:
 *   GOOGLE_WALLET_ISSUER_ID  — pay.google.com/business/console'dan alınan 19 haneli numara
 *   GOOGLE_WALLET_SA_KEY     — servis hesabı anahtarı (tüm JSON içeriği)
 */
type ServiceAccount = { client_email: string; private_key: string };

function serviceAccount(): ServiceAccount | null {
  const raw = envStr("GOOGLE_WALLET_SA_KEY", "").trim();
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as ServiceAccount;
    return j.client_email && j.private_key ? j : null;
  } catch {
    return null;
  }
}

/**
 * Issuer ID ile sınıf (class) kimliği.
 * v2 eki: mevcut düz class'ı kullanan hesaplarda yeni cardTemplateOverride düzeninin
 * hemen uygulanması için yeni sürüm sınıfı kullanılır.
 */
function classId(issuerId: string, kind: PassData["kind"]): string {
  return `${issuerId}.nordvow_${kind}_v2`;
}

function appBaseHttps(): string | null {
  const base = envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "");
  return base.startsWith("https://") ? base : null;
}

/** Ön yüzdeki 2x2 bilgi ızgarasını tanımlayan Generic Class. */
function buildGenericClass(issuerId: string, kind: PassData["kind"]) {
  return {
    id: classId(issuerId, kind),
    classTemplateInfo: {
      cardTemplateOverride: {
        cardRowTemplateInfos: [
          {
            twoItems: {
              startItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['f0']" }] } },
              endItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['f1']" }] } },
            },
          },
          {
            twoItems: {
              startItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['f2']" }] } },
              endItem: { firstValue: { fields: [{ fieldPath: "object.textModulesData['f3']" }] } },
            },
          },
        ],
      },
    },
  };
}

/** Generic pass object'i (JWT içine gömülür). */
function buildGenericObject(issuerId: string, data: PassData, serial: string) {
  const objectId = `${issuerId}.${serial.replace(/[^\w.-]/g, "_")}`;
  const organizer = (data.organizer ?? BRAND_NAME).trim() || BRAND_NAME;
  const httpsBase = appBaseHttps();

  const rowModules: { id: string; header: string; body: string }[] =
    data.kind === "ticket"
      ? [
          { id: "f0", header: "KATILIMCI", body: data.subtitle || "Misafir" },
          { id: "f1", header: "DURUM", body: data.statusLabel || "Geçerli" },
          { id: "f2", header: "TARİH", body: data.fields[0]?.value || "-" },
          { id: "f3", header: "MEKAN", body: data.fields[1]?.value || "-" },
        ]
      : [
          { id: "f0", header: "MARKA", body: organizer },
          { id: "f1", header: "DURUM", body: data.statusLabel || "Kullanılabilir" },
          { id: "f2", header: "SON KULLANIM", body: data.fields[0]?.value || "Süresiz" },
          { id: "f3", header: "KOD", body: data.code },
        ];

  if (data.description?.trim()) {
    rowModules.push({ id: "desc", header: "AÇIKLAMA", body: data.description.trim() });
  }
  if (data.terms?.trim()) {
    rowModules.push({ id: "terms", header: "KULLANIM KOŞULLARI", body: data.terms.trim() });
  }

  const obj: Record<string, unknown> = {
    id: objectId,
    classId: classId(issuerId, data.kind),
    genericType: "GENERIC_TYPE_UNSPECIFIED",
    hexBackgroundColor: "#13131d",
    cardTitle: { defaultValue: { language: "tr", value: organizer } },
    subheader: {
      defaultValue: {
        language: "tr",
        value: data.kind === "ticket" ? "ETKİNLİK BİLETİ" : data.title,
      },
    },
    header: {
      defaultValue: {
        language: "tr",
        value: data.kind === "ticket" ? data.title : data.subtitle,
      },
    },
    barcode: {
      type: "QR_CODE",
      value: data.code,
      alternateText: data.code,
    },
    textModulesData: rowModules,
  };

  if (httpsBase) {
    obj.logo = {
      sourceUri: { uri: `${httpsBase}/api/wallet/assets/logo.png` },
      contentDescription: { defaultValue: { language: "tr", value: organizer } },
    };
    const accentParam = data.accentColor ? `&accent=${encodeURIComponent(data.accentColor)}` : "";
    obj.heroImage = {
      sourceUri: { uri: `${httpsBase}/api/wallet/assets/hero.png?kind=${data.kind}${accentParam}` },
      contentDescription: { defaultValue: { language: "tr", value: data.title } },
    };
    if (data.webUrl?.startsWith("https://")) {
      obj.linksModuleData = {
        uris: [{ uri: data.webUrl, description: "Web kartını aç", id: "web" }],
      };
    }
  }

  return obj;
}

/**
 * "Save to Google Wallet" bağlantısı üretir. Anahtar yoksa null.
 * Döndürülen link doğrudan kullanıcıya sunulabilir.
 */
export async function buildGoogleWalletLink(data: PassData, serial: string): Promise<string | null> {
  if (!googleWalletConfigured()) return null;
  const sa = serviceAccount();
  const issuerId = envStr("GOOGLE_WALLET_ISSUER_ID", "").trim();
  if (!sa || !issuerId) return null;

  const payload = {
    iss: sa.client_email,
    aud: "google",
    typ: "savetowallet",
    origins: [envStr("APP_URL", "https://nordvow.com").replace(/\/$/, "")],
    payload: {
      genericClasses: [buildGenericClass(issuerId, data.kind)],
      genericObjects: [buildGenericObject(issuerId, data, serial)],
    },
  };
  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT(payload).setProtectedHeader({ alg: "RS256", typ: "JWT" }).sign(key);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
