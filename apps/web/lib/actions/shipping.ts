"use server";

import type { ActionState } from "@/lib/action-state";
import { attempt, optStr, revalidateAll, str } from "@/lib/action-utils";
import { requireActor } from "@/lib/auth-guard";
import { prisma } from "@infulancer/core/db";
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
import { saveBrandAddress } from "@infulancer/core/profile/addresses";

export async function saveBrandShippingIntegrationAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("ADMIN", "BRAND");
  return attempt(async () => {
    const targetBrandId = actor.role === "ADMIN" ? (optStr(fd, "brandId") ?? actor.brandId) : actor.brandId;
    if (!targetBrandId) throw new Error("Marka seçilmedi.");
    const provider = str(fd, "provider") as ShippingProvider;
    const senderName = optStr(fd, "senderName");
    const senderPhone = optStr(fd, "senderPhone");
    const addressLine = optStr(fd, "addressLine");
    const city = optStr(fd, "city");
    const district = optStr(fd, "district");
    const postalCode = optStr(fd, "postalCode");

    const hasSender = Boolean(senderName && senderPhone && addressLine && city && district);

    await upsertBrandShippingIntegration(targetBrandId, {
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
  brandId?: string,
): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const actor = await requireActor("ADMIN", "BRAND");
  const targetBrandId = actor.role === "ADMIN" ? (brandId ?? actor.brandId) : actor.brandId;
  if (!targetBrandId) throw new Error("Marka seçilmedi.");
  const res = await testBrandShippingIntegration(targetBrandId, provider);
  revalidateAll();
  return res;
}

export async function saveBrandSenderAddressAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("BRAND", "ADMIN");
  return attempt(async () => {
    const targetBrandId = actor.role === "ADMIN" ? (optStr(fd, "brandId") ?? actor.brandId) : actor.brandId;
    if (!targetBrandId) throw new Error("Marka bulunamadı.");
    const senderName = str(fd, "senderName");
    const senderPhone = str(fd, "senderPhone");
    const addressLine = str(fd, "addressLine");
    const neighborhood = optStr(fd, "neighborhood");
    const city = str(fd, "city");
    const district = str(fd, "district");
    const postalCode = optStr(fd, "postalCode");
    const addressDescription = optStr(fd, "addressDescription");

    const existing = await prisma.brandShippingIntegration.findFirst({
      where: { brandId: targetBrandId, isActive: true },
      orderBy: { updatedAt: "desc" },
    });
    const provider: ShippingProvider = existing?.provider ?? "CUSTOM_MANUAL";

    await upsertBrandShippingIntegration(targetBrandId, {
      provider,
      isActive: existing?.isActive ?? true,
      defaultSenderAddressId: existing?.defaultSenderAddressId ?? null,
      senderAddress: {
        senderName,
        senderPhone,
        addressLine,
        city,
        district,
        postalCode,
      },
    });
    await saveBrandAddress(targetBrandId, {
      label: "Gönderici",
      companyName: senderName,
      phone: senderPhone,
      addressLine,
      city,
      district,
      postalCode,
      isShipping: true,
    });
    revalidateAll();
    return { ok: true, message: "Gönderici adresi kaydedildi." };
  });
}

export async function saveInfluencerAddressAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("INFLUENCER");
  return attempt(async () => {
    const label = optStr(fd, "label") ?? "Varsayılan Adres";
    const recipientName = str(fd, "recipientName");
    const recipientPhone = str(fd, "recipientPhone");
    const addressLine = str(fd, "addressLine");
    const neighborhood = optStr(fd, "neighborhood");
    const city = str(fd, "city");
    const district = str(fd, "district");
    const postalCode = optStr(fd, "postalCode");
    const addressDescription = optStr(fd, "addressDescription");

    await prisma.influencerAddress.updateMany({
      where: { influencerId: actor.influencerId!, isDefault: true },
      data: { isDefault: false },
    });
    await prisma.influencerAddress.create({
      data: {
        influencerId: actor.influencerId!,
        label,
        recipientName,
        recipientPhone,
        addressLine,
        neighborhood,
        city,
        district,
        postalCode,
        addressDescription,
        isDefault: true,
      },
    });
    revalidateAll();
    return { ok: true, message: "Teslimat adresiniz kaydedildi." };
  });
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
      productUrls?: string[];
      preferredCarrier?:
        | "NAVLUNGO"
        | "YURTICI"
        | "ARAS"
        | "MNG"
        | "UPS"
        | "HEPSIJET"
        | "KOLAY_GELSIN"
        | "CUSTOM_MANUAL"
        | null;
      variants: { label: string; options: string[] }[];
    };
    contentTriggerRule: "AFTER_DELIVERY" | "ANYTIME";
    contentDeadlineDays?: number | null;
  },
): Promise<ActionState> {
  await requireActor("BRAND", "ADMIN");
  return attempt(async () => {
    await upsertCampaignShippingConfig(campaignId, {
      ...input,
      productDetails: {
        ...input.productDetails,
        productUrls: input.productDetails.productUrls ?? [],
      },
    });
    revalidateAll();
    return { ok: true, message: "Ürün gönderim ayarları kaydedildi." };
  });
}

export async function dispatchSingleShipmentAction(
  _p: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const actor = await requireActor("BRAND", "ADMIN");
  return attempt(async () => {
    const shipmentId = str(fd, "shipmentId");
    const provider = (optStr(fd, "provider") ?? "CUSTOM_MANUAL") as ShippingProvider;
    const manualCarrierName = optStr(fd, "manualCarrierName");
    const manualTrackingNumber = optStr(fd, "manualTrackingNumber");
    let brandId = actor.brandId;
    if (actor.role === "ADMIN") {
      const s = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { brandId: true } });
      if (!s) throw new DomainError("BULUNAMADI", "Gönderi bulunamadı.");
      brandId = s.brandId;
    }
    await dispatchSingleShipment({
      brandId: brandId!,
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
  const actor = await requireActor("BRAND", "ADMIN");
  if (actor.role === "ADMIN") {
    const rows = await prisma.shipment.findMany({
      where: { id: { in: input.shipmentIds } },
      select: { id: true, brandId: true },
    });
    const byBrand = new Map<string, string[]>();
    for (const r of rows) {
      const list = byBrand.get(r.brandId) ?? [];
      list.push(r.id);
      byBrand.set(r.brandId, list);
    }
    const succeeded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const [brandId, ids] of byBrand) {
      const res = await bulkDispatchShipments({
        brandId,
        shipmentIds: ids,
        provider: input.provider,
        manualCarrierName: input.manualCarrierName,
        manualTrackingNumber: input.manualTrackingNumber,
      });
      succeeded.push(...res.succeeded);
      failed.push(...res.failed);
    }
    revalidateAll();
    return { ok: succeeded.length > 0, succeeded: succeeded.length, failed };
  }
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

