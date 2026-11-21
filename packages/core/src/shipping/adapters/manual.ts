import type { ShippingProvider } from "../../enums";
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

/**
 * Platform Dışı / Manuel Takip adaptörü.
 * Kargo anlaşması olmayan markalar kendi kargolarıyla gönderip takip numarası girer.
 */
export class ManualCargoAdapter implements ICargoProvider {
  readonly provider: ShippingProvider = "CUSTOM_MANUAL";
  readonly displayName = shippingProviderLabels.CUSTOM_MANUAL;

  async testConnection(): Promise<CargoTestResult> {
    return {
      ok: true,
      message: "Platform dışı / manuel kargo takibi kullanıma hazır.",
      latencyMs: 1,
    };
  }

  async createShipment(
    _credentials: CargoCredentials,
    req: CreateCargoShipmentRequest,
  ): Promise<CargoCreateResult> {
    const trackingNumber = req.manualTrackingNumber?.trim();
    if (!trackingNumber) {
      throw new Error("Manuel gönderimde takip numarası zorunludur.");
    }
    const carrierName = req.manualCarrierName?.trim() || "Özel Kargo";
    return {
      carrierName,
      trackingNumber,
      trackingUrl: buildCarrierTrackingUrl("CUSTOM_MANUAL", trackingNumber),
      barcodeLabelUrl: null,
      externalShipmentId: null,
      estimatedDeliveryDate: new Date(Date.now() + 3 * 86_400_000),
    };
  }

  async trackShipment(
    _credentials: CargoCredentials,
    trackingNumber: string,
  ): Promise<CargoTrackingResult> {
    return {
      status: "IN_TRANSIT",
      carrierName: "Özel Kargo",
      trackingNumber,
      trackingUrl: buildCarrierTrackingUrl("CUSTOM_MANUAL", trackingNumber),
      estimatedDeliveryDate: null,
      deliveredAt: null,
    };
  }

  parseWebhook(payload: unknown): CargoWebhookNormalized | null {
    if (!payload || typeof payload !== "object") return null;
    const obj = payload as Record<string, unknown>;
    const trackingNumber = typeof obj.trackingNumber === "string" ? obj.trackingNumber : null;
    const status = normalizeCarrierStatus(obj.status);
    if (!trackingNumber || !status) return null;
    return {
      trackingNumber: trackingNumber.trim(),
      status,
      deliveredAt: status === "DELIVERED" ? new Date() : null,
    };
  }
}

