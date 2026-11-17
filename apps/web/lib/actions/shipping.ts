"use server";

import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";
import { DomainError } from "@infulancer/core/domain/errors";
import type { ShippingProvider } from "@infulancer/core/enums";
import {
  bulkDispatchShipments,
  confirmShipmentAddress,
  dispatchSingleShipment,
  markShipmentDeliveredByInfluencer,
  testBrandShippingIntegration,
  transitionShipmentStatus,
  upsertBrandShippingIntegration,
  upsertCampaignShippingConfig,
} from "@infulancer/core/shipping/service";

export async function saveBrandShippingIntegrationAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("BRAND");
  return attempt(async () => {
    const provider = str(fd, "provider") as ShippingProvider;
    const senderName = optStr(fd, "senderName");
    const senderPhone = optStr(fd, "senderPhone");
    const addressLine = optStr(fd, "addressLine");
    const city = optStr(fd, "city");
    const district = optStr(fd, "district");
    const postalCode = optStr(fd, "postalCode");

    const hasSender = Boolean(senderName && senderPhone && addressLine && city && district);

    await upsertBrandShippingIntegration(actor.brandId!, {
      provider,
      apiKey: optStr(fd, "apiKey"),
      apiSecret: optStr(fd, "apiSecret"),
      customerCode: optStr(fd, "customerCode"),
      isActive: fd.get("isActive") === "on" || fd.get("isActive") === "1" || fd.get("isActive") === "true",
      defaultSenderAddressId: optStr(fd, "defaultSenderAddressId"),
      senderAddress: hasSender
        ? {
            senderName: senderName!,
            senderPhone: senderPhone!,
            addressLine: addressLine!,
            city: city!,
            district: district!,
            postalCode,
          }
        : null,
    });
    revalidateAll();
    return { ok: true, message: "Kargo entegrasyon ayarları kaydedildi." };
  });
}

export async function testBrandShippingIntegrationAction(
  provider: ShippingProvider,
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const actor = await requireActor("BRAND");
  const res = await testBrandShippingIntegration(actor.brandId!, provider);
  revalidateAll();
  return res;
}

export async function saveCampaignShippingConfigAction(
  campaignId: string,
  input: {
    requiresProductShipment: boolean;
    shippingMode: "INTEGRATED_CARGO" | "MANUAL_TRACKING";
    productDetails: {
      name: string;
      description: string;
      imageUrl?: string | null;
      estimatedValueTry?: number | null;
      variants: { label: string; options: string[] }[];
    };
    contentTriggerRule: "AFTER_DELIVERY" | "ANYTIME";
    contentDeadlineDays?: number | null;
  },
): Promise<ActionState> {
  await requireActor("BRAND", "ADMIN");
  return attempt(async () => {
    await upsertCampaignShippingConfig(campaignId, input);
    revalidateAll();
    return { ok: true, message: "Ürün gönderim ayarları kaydedildi." };
  });
}

export async function dispatchSingleShipmentAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("BRAND");
  return attempt(async () => {
    const shipmentId = str(fd, "shipmentId");
    const provider = (optStr(fd, "provider") ?? "CUSTOM_MANUAL") as ShippingProvider;
    const manualCarrierName = optStr(fd, "manualCarrierName");
    const manualTrackingNumber = optStr(fd, "manualTrackingNumber");
    await dispatchSingleShipment({
      brandId: actor.brandId!,
      shipmentId,
      provider,
      manualCarrierName,
      manualTrackingNumber,
    });
    revalidateAll();
    return { ok: true, message: "Kargo bilgisi oluşturuldu ve influencer'a bildirildi." };
  });
}

export async function bulkDispatchShipmentsAction(input: {
  shipmentIds: string[];
  provider: ShippingProvider;
  manualCarrierName?: string | null;
  manualTrackingNumber?: string | null;
}): Promise<{ ok: boolean; succeeded: number; failed: { id: string; error: string }[] }> {
  const actor = await requireActor("BRAND");
  const res = await bulkDispatchShipments({
    brandId: actor.brandId!,
    ...input,
  });
  revalidateAll();
  return {
    ok: res.succeeded.length > 0,
    succeeded: res.succeeded.length,
    failed: res.failed,
  };
}

export async function updateShipmentStatusAction(
  shipmentId: string,
  status: "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | "RETURNED",
): Promise<ActionState> {
  const actor = await requireActor("BRAND", "ADMIN");
  return attempt(async () => {
    await transitionShipmentStatus(shipmentId, status);
    revalidateAll();
    return { ok: true, message: "Kargo durumu güncellendi." };
  });
}

export async function confirmShipmentAddressAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("INFLUENCER");
  return attempt(async () => {
    const shipmentId = str(fd, "shipmentId");
    const recipientName = str(fd, "recipientName");
    const recipientPhone = str(fd, "recipientPhone");
    const addressLine = str(fd, "addressLine");
    const city = str(fd, "city");
    const district = str(fd, "district");
    const postalCode = optStr(fd, "postalCode");
    const variantRaw = optStr(fd, "selectedVariant");
    let selectedVariant: Record<string, string> | null = null;
    if (variantRaw) {
      try {
        selectedVariant = JSON.parse(variantRaw) as Record<string, string>;
      } catch {
        throw new DomainError("DOGRULAMA", "Varyant seçimi okunamadı.");
      }
    }
    await confirmShipmentAddress(shipmentId, actor.influencerId!, {
      recipientName,
      recipientPhone,
      shippingAddress: { addressLine, city, district, postalCode },
      selectedVariant,
      saveAddress: fd.get("saveAddress") === "on" || fd.get("saveAddress") === "1",
      addressLabel: optStr(fd, "addressLabel") ?? undefined,
    });
    revalidateAll();
    return { ok: true, message: "Teslimat adresiniz onaylandı, markaya bildirildi." };
  });
}

export async function markShipmentDeliveredAction(shipmentId: string): Promise<ActionState> {
  const actor = await requireActor("INFLUENCER");
  return attempt(async () => {
    await markShipmentDeliveredByInfluencer(shipmentId, actor.influencerId!);
    revalidateAll();
    return { ok: true, message: "Ürün teslim alındı olarak işaretlendi! Artık içeriğinizi yükleyebilirsiniz." };
  });
}

