import { envStr } from "../../env";
import type { ShipmentStatus, ShippingProvider } from "../../enums";
import {
  buildCarrierTrackingUrl,
  shippingProviderLabels,
  type CargoCreateResult,
  type CargoCredentials,
  type CargoTestResult,
  type CargoTrackingResult,
  type CargoWebhookNormalized,
  type CreateCargoShipmentRequest,
  type ICargoProvider,
} from "../types";
import { normalizeCarrierStatus } from "./base";

type TokenEntry = { token: string; expiresAt: number };
const tokenCache = new Map<string, TokenEntry>();

function apiUrls() {
  const apiUrl = envStr("NAVLUNGO_API_URL", "https://domestic-api.navlungo.com/api").replace(/\/+$/, "");
  const apiV21Url = envStr("NAVLUNGO_API_V21_URL", `${apiUrl}/v2.1`).replace(/\/+$/, "");
  return { apiUrl, apiV21Url };
}

function parseCarrierId(customerCode: string | null | undefined): number {
  const n = Number(customerCode);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function mapNavlungoStatus(raw: unknown): ShipmentStatus {
  if (typeof raw === "number") {
    // Yaygın Navlungo sayısal durum kodları
    if (raw === 1 || raw === 0) return "LABEL_CREATED";
    if (raw === 2 || raw === 3) return "IN_TRANSIT";
    if (raw === 4) return "OUT_FOR_DELIVERY";
    if (raw === 5) return "DELIVERED";
    if (raw === 6 || raw === 7) return "RETURNED";
  }
  const normalized = normalizeCarrierStatus(raw);
  if (normalized) return normalized;
  if (typeof raw === "string") {
    const s = raw.toLowerCase();
    if (s.includes("teslim") && !s.includes("edilemedi")) return "DELIVERED";
    if (s.includes("dağıtım") || s.includes("dagitim")) return "OUT_FOR_DELIVERY";
    if (s.includes("iade") || s.includes("iptal") || s.includes("edilemedi")) return "RETURNED";
    if (s.includes("kargo") || s.includes("transfer") || s.includes("yolda")) return "IN_TRANSIT";
  }
  return "IN_TRANSIT";
}

/**
 * Navlungo Domestic v2.1 API adaptörü.
 * Postman koleksiyonundaki `/auth/api`, `/carrier/my-carriers`, `/address-book/create`,
 * `/post/create`, `/post/check/{post_number}`, `/post/cancel` ve `/barcode/getBarcode`
 * endpoint'lerini kullanır.
 */
export class NavlungoAdapter implements ICargoProvider {
  readonly provider: ShippingProvider = "NAVLUNGO";
  readonly displayName = shippingProviderLabels.NAVLUNGO;

  async authenticate(credentials: CargoCredentials): Promise<string> {
    const apiKey = credentials.apiKey?.trim();
    const apiSecret = credentials.apiSecret?.trim();
    if (!apiKey) {
      throw new Error("Navlungo için API Kullanıcı Adı (e-posta) veya Bearer Token zorunludur.");
    }
    // Yalnız Bearer Token girilmişse (şifre boşsa) doğrudan token olarak kullan.
    if (!apiSecret) {
      return apiKey;
    }

    const cacheKey = `${apiKey}:${apiSecret.slice(0, 4)}`;
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    const { apiUrl } = apiUrls();
    const res = await fetch(`${apiUrl}/auth/api`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-localization": "tr",
      },
      body: JSON.stringify({ username: apiKey, password: apiSecret }),
    });

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (typeof data.message === "string" && data.message) ||
        `Navlungo kimlik doğrulama hatası (HTTP ${res.status})`;
      throw new Error(msg);
    }

    const nested = (data.data as Record<string, unknown> | undefined) ?? data;
    const token =
      (typeof nested.token === "string" && nested.token) ||
      (typeof nested.access_token === "string" && nested.access_token) ||
      (typeof data.token === "string" && data.token) ||
      null;

    if (!token) {
      throw new Error("Navlungo /auth/api yanıtından token okunamadı.");
    }

    tokenCache.set(cacheKey, { token, expiresAt: Date.now() + 45 * 60_000 });
    return token;
  }

  private async authedFetch(
    credentials: CargoCredentials,
    url: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const token = await this.authenticate(credentials);
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-localization": "tr",
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  }

  async getMyCarriers(credentials: CargoCredentials): Promise<{ id: number; name: string }[]> {
    const { apiV21Url } = apiUrls();
    const res = await this.authedFetch(credentials, `${apiV21Url}/carrier/my-carriers`, {
      method: "GET",
    });
    if (!res.ok) {
      const msg =
        (typeof res.data.message === "string" && res.data.message) ||
        `Navlungo kargo firmaları alınamadı (HTTP ${res.status})`;
      throw new Error(msg);
    }
    const list = Array.isArray(res.data.data)
      ? res.data.data
      : Array.isArray(res.data.carriers)
        ? res.data.carriers
        : [];
    return list
      .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
      .map((c) => ({
        id: Number(c.id ?? c.carrier_id ?? 1),
        name: String(c.name ?? c.carrier_name ?? "Kargo"),
      }));
  }

  async ensureSenderAddressId(credentials: CargoCredentials): Promise<string> {
    if (credentials.defaultSenderAddressId?.trim()) {
      return credentials.defaultSenderAddressId.trim();
    }
    if (!credentials.senderAddress) {
      throw new Error(
        "Navlungo gönderisi için Varsayılan Gönderici Adres ID (addressId) veya Çıkış Adresi tanımlanmalıdır.",
      );
    }
    const { apiV21Url } = apiUrls();
    const res = await this.authedFetch(credentials, `${apiV21Url}/address-book/create`, {
      method: "POST",
      body: JSON.stringify({
        address_type: "sender",
        location_name: credentials.senderAddress.senderName,
        address_name: credentials.senderAddress.senderName,
        address_phone: credentials.senderAddress.senderPhone,
        address_line: credentials.senderAddress.addressLine,
        address_country: "tr",
        address_city: credentials.senderAddress.city,
        address_district: credentials.senderAddress.district,
        address_post_code: credentials.senderAddress.postalCode ?? "",
        is_main_warehouse: 1,
      }),
    });
    if (!res.ok) {
      const msg =
        (typeof res.data.message === "string" && res.data.message) ||
        `Navlungo gönderici adresi oluşturulamadı (HTTP ${res.status})`;
      throw new Error(msg);
    }
    const nested = (res.data.data as Record<string, unknown> | undefined) ?? res.data;
    const id = nested.id ?? nested.addressId ?? nested.address_id;
    if (!id) {
      throw new Error("Navlungo address-book/create yanıtında addressId dönmedi.");
    }
    return String(id);
  }

  async testConnection(credentials: CargoCredentials): Promise<CargoTestResult> {
    const started = Date.now();
    try {
      const carriers = await this.getMyCarriers(credentials);
      const names = carriers.map((c) => `${c.name} (#${c.id})`).join(", ");
      return {
        ok: true,
        message: carriers.length
          ? `Navlungo bağlantısı doğrulandı. Aktif kargo firmaları: ${names}`
          : "Navlungo API kimlik doğrulaması başarılı.",
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : "Navlungo bağlantısı kurulamadı.",
        latencyMs: Date.now() - started,
      };
    }
  }

  async createShipment(
    credentials: CargoCredentials,
    req: CreateCargoShipmentRequest,
  ): Promise<CargoCreateResult> {
    const { apiV21Url } = apiUrls();
    const addressId = await this.ensureSenderAddressId(credentials);
    const carrierId = parseCarrierId(credentials.customerCode);
    const variantNote = req.selectedVariant
      ? Object.entries(req.selectedVariant)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "";
    const note = [req.productName, variantNote].filter(Boolean).join(" | ").slice(0, 250);

    const payload = {
      platform: "Nordvow",
      posts: [
        {
          reference_id: req.shipmentId.slice(-11).toUpperCase(),
          carrier_id: carrierId,
          post_type: 2,
          cod_payment_type: "",
          sender: {
            addressId,
          },
          recipient: {
            name: req.recipientName,
            phone: req.recipientPhone,
            email: req.recipientEmail ?? "influencer@nordvow.com",
            address: req.shippingAddress.addressLine,
            country: "tr",
            city: req.shippingAddress.city,
            district: req.shippingAddress.district,
            post_code: req.shippingAddress.postalCode ?? "",
          },
          post: {
            desi: 2,
            package_count: 1,
            price: "",
            note,
          },
          barcode_format: "pdf-A5",
          custom_data_1: req.collaborationId,
          custom_data_2: req.shipmentId,
          custom_data_3: "",
          custom_data_4: "",
        },
      ],
    };

    const res = await this.authedFetch(credentials, `${apiV21Url}/post/create`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const msg =
        (typeof res.data.message === "string" && res.data.message) ||
        `Navlungo gönderi oluşturulamadı (HTTP ${res.status})`;
      throw new Error(msg);
    }

    const rawData = res.data.data ?? res.data.posts ?? res.data;
    const first = Array.isArray(rawData)
      ? (rawData[0] as Record<string, unknown> | undefined)
      : (rawData as Record<string, unknown>);

    const postNumber = String(
      first?.post_number ??
        first?.tracking_number ??
        first?.barcode_number ??
        req.shipmentId.slice(-10).toUpperCase(),
    );
    const trackingUrl =
      (typeof first?.tracking_url === "string" && first.tracking_url) ||
      buildCarrierTrackingUrl("NAVLUNGO", postNumber);
    const barcodeUrl =
      (typeof first?.barcode_url === "string" && first.barcode_url) ||
      `/api/shipping/navlungo/barcode?postNumber=${encodeURIComponent(postNumber)}`;

    return {
      carrierName:
        typeof first?.carrier_name === "string" ? first.carrier_name : this.displayName,
      trackingNumber: postNumber,
      trackingUrl,
      barcodeLabelUrl: barcodeUrl,
      externalShipmentId: postNumber,
      estimatedDeliveryDate: new Date(Date.now() + 3 * 86_400_000),
    };
  }

  async trackShipment(
    credentials: CargoCredentials,
    trackingNumber: string,
  ): Promise<CargoTrackingResult> {
    const { apiUrl } = apiUrls();
    const res = await this.authedFetch(
      credentials,
      `${apiUrl}/post/check/${encodeURIComponent(trackingNumber)}`,
      { method: "GET" },
    );
    if (!res.ok) {
      throw new Error(
        (typeof res.data.message === "string" && res.data.message) ||
          `Navlungo gönderi sorgulanamadı (HTTP ${res.status})`,
      );
    }
    const nested = (res.data.data as Record<string, unknown> | undefined) ?? res.data;
    const rawStatus = nested.status ?? nested.post_status ?? nested.state;
    const status = mapNavlungoStatus(rawStatus);
    return {
      status,
      carrierName:
        typeof nested.carrier_name === "string" ? nested.carrier_name : this.displayName,
      trackingNumber,
      trackingUrl:
        (typeof nested.tracking_url === "string" && nested.tracking_url) ||
        buildCarrierTrackingUrl("NAVLUNGO", trackingNumber),
      estimatedDeliveryDate: null,
      deliveredAt: status === "DELIVERED" ? new Date() : null,
      rawEvent: rawStatus != null ? String(rawStatus) : undefined,
    };
  }

  async getBarcode(
    credentials: CargoCredentials,
    postNumber: string,
    barcodeType: "pdf" | "html" | "zpl" = "pdf",
  ): Promise<Record<string, unknown>> {
    const { apiV21Url } = apiUrls();
    const res = await this.authedFetch(credentials, `${apiV21Url}/barcode/getBarcode`, {
      method: "POST",
      body: JSON.stringify({ post_number: postNumber, barcode_type: barcodeType }),
    });
    if (!res.ok) {
      throw new Error(
        (typeof res.data.message === "string" && res.data.message) ||
          `Navlungo barkod alınamadı (HTTP ${res.status})`,
      );
    }
    return res.data;
  }

  async cancelShipment(credentials: CargoCredentials, postNumber: string): Promise<void> {
    const { apiUrl } = apiUrls();
    const res = await this.authedFetch(credentials, `${apiUrl}/post/cancel`, {
      method: "POST",
      body: JSON.stringify({ post_number: postNumber }),
    });
    if (!res.ok) {
      throw new Error(
        (typeof res.data.message === "string" && res.data.message) ||
          `Navlungo gönderi iptal edilemedi (HTTP ${res.status})`,
      );
    }
  }

  parseWebhook(payload: unknown): CargoWebhookNormalized | null {
    if (!payload || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    const trackingNumber =
      typeof obj.post_number === "string"
        ? obj.post_number
        : typeof obj.trackingNumber === "string"
          ? obj.trackingNumber
          : typeof obj.tracking_number === "string"
            ? obj.tracking_number
            : null;
    if (!trackingNumber) return null;
    const status = mapNavlungoStatus(obj.status ?? obj.post_status ?? obj.event);
    return {
      trackingNumber: trackingNumber.trim(),
      externalShipmentId: trackingNumber.trim(),
      status,
      deliveredAt: status === "DELIVERED" ? new Date() : null,
    };
  }
}

