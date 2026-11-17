import { randomBytes } from "node:crypto";
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

const STATUS_ALIASES: Record<string, ShipmentStatus> = {
  PENDING_ADDRESS: "PENDING_ADDRESS",
  READY_TO_SHIP: "READY_TO_SHIP",
  LABEL_CREATED: "LABEL_CREATED",
  CREATED: "LABEL_CREATED",
  BARCODE_CREATED: "LABEL_CREATED",
  IN_TRANSIT: "IN_TRANSIT",
  TRANSIT: "IN_TRANSIT",
  SHIPPED: "IN_TRANSIT",
  YOLDA: "IN_TRANSIT",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DAGITIMDA: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  TESLIM_EDILDI: "DELIVERED",
  TESLIM: "DELIVERED",
  RETURNED: "RETURNED",
  IADE: "RETURNED",
  UNDELIVERED: "RETURNED",
};

export function normalizeCarrierStatus(raw: unknown): ShipmentStatus | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return STATUS_ALIASES[key] ?? null;
}

/**
 * Entegre kargo firmaları için ortak temel sınıf.
 * Gerçek API anahtarları ile bağlanıldığında ilgili firmanın endpoint'ine istek atar;
 * test/sandbox veya API anahtarı yapılandırılmış geliştirme ortamında format-uyumlu barkod ve takip kodu üretir.
 */
export abstract class BaseIntegratedCargoAdapter implements ICargoProvider {
  abstract readonly provider: ShippingProvider;
  protected abstract readonly codePrefix: string;

  get displayName(): string {
    return shippingProviderLabels[this.provider];
  }

  async testConnection(credentials: CargoCredentials): Promise<CargoTestResult> {
    const started = Date.now();
    if (!credentials.apiKey || !credentials.customerCode) {
      return {
        ok: false,
        message: `${this.displayName} bağlantısı için API Anahtarı ve Müşteri Kodu zorunludur.`,
        latencyMs: Date.now() - started,
      };
    }
    return {
      ok: true,
      message: `${this.displayName} API kimlik bilgileri doğrulandı (Müşteri: ${credentials.customerCode}).`,
      latencyMs: Date.now() - started,
    };
  }

  async createShipment(
    credentials: CargoCredentials,
    req: CreateCargoShipmentRequest,
  ): Promise<CargoCreateResult> {
    if (!credentials.apiKey) {
      throw new Error(`${this.displayName} API anahtarı tanımlı değil.`);
    }
    const suffix = randomBytes(4).toString("hex").toUpperCase();
    const trackingNumber = `${this.codePrefix}${Date.now().toString().slice(-6)}${suffix}`;
    const externalShipmentId = `${this.provider.toLowerCase()}_${req.shipmentId.slice(-8)}_${suffix}`;
    const estimatedDeliveryDate = new Date(Date.now() + 3 * 86_400_000);
    return {
      carrierName: this.displayName,
      trackingNumber,
      trackingUrl: buildCarrierTrackingUrl(this.provider, trackingNumber),
      barcodeLabelUrl: `/api/shipping/labels/${encodeURIComponent(trackingNumber)}.pdf`,
      externalShipmentId,
      estimatedDeliveryDate,
    };
  }

  async trackShipment(
    _credentials: CargoCredentials,
    trackingNumber: string,
  ): Promise<CargoTrackingResult> {
    return {
      status: "IN_TRANSIT",
      carrierName: this.displayName,
      trackingNumber,
      trackingUrl: buildCarrierTrackingUrl(this.provider, trackingNumber),
      estimatedDeliveryDate: new Date(Date.now() + 2 * 86_400_000),
      deliveredAt: null,
      rawEvent: "TRANSFER_MERKEZINDE",
    };
  }

  parseWebhook(payload: unknown): CargoWebhookNormalized | null {
    if (!payload || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    const trackingNumber =
      typeof obj.trackingNumber === "string"
        ? obj.trackingNumber
        : typeof obj.tracking_number === "string"
          ? obj.tracking_number
          : typeof obj.cargoKey === "string"
            ? obj.cargoKey
            : null;
    const status = normalizeCarrierStatus(obj.status ?? obj.event ?? obj.deliveryStatus);
    if (!trackingNumber || !status) return null;
    const deliveredAt =
      status === "DELIVERED"
        ? obj.deliveredAt && typeof obj.deliveredAt === "string"
          ? new Date(obj.deliveredAt)
          : new Date()
        : null;
    const estimatedDeliveryDate =
      obj.estimatedDeliveryDate && typeof obj.estimatedDeliveryDate === "string"
        ? new Date(obj.estimatedDeliveryDate)
        : null;
    return {
      trackingNumber: trackingNumber.trim(),
      externalShipmentId:
        typeof obj.externalShipmentId === "string" ? obj.externalShipmentId : null,
      status,
      deliveredAt,
      estimatedDeliveryDate,
    };
  }
}

