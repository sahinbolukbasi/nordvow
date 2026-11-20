import { prisma, type Prisma } from "../db";
import type { ShipmentStatus, ShippingProvider } from "../enums";
import { envStr } from "../env";
import { DomainError } from "../domain/errors";
import { dispatchNotification, recipientsFromUserIds } from "../notify/dispatch";
import { getCargoAdapter } from "./adapters/registry";
import { NavlungoAdapter } from "./adapters/navlungo";
import { decryptShippingSecret, encryptShippingSecret, maskShippingSecret } from "./crypto";
import {
  brandShippingIntegrationSchema,
  buildCarrierTrackingUrl,
  campaignShippingConfigSchema,
  confirmAddressSchema,
  parseProductDetails,
  parseShippingAddress,
  shippingProviderLabels,
  type BrandShippingIntegrationInput,
  type CampaignShippingConfigInput,
  type CargoCredentials,
  type CargoTestResult,
  type ConfirmAddressInput,
  type SenderAddress,
} from "./types";

const DAY_MS = 86_400_000;

function platformNavlungoDefaults() {
  const username = envStr("NAVLUNGO_USERNAME", "").trim();
  const password = envStr("NAVLUNGO_PASSWORD", "").trim();
  const senderAddressId = envStr("NAVLUNGO_SENDER_ADDRESS_ID", "56319").trim();
  return {
    hasPlatformCreds: Boolean(username),
    username: username || null,
    password: password || null,
    senderAddressId: senderAddressId || null,
  };
}

async function notifyBrandUsers(
  brandId: string,
  eventKey: string,
  vars: Record<string, string>,
) {
  const users = await prisma.user.findMany({
    where: { brandId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!users.length) return;
  const recipients = await recipientsFromUserIds(users.map((u) => u.id));
  await dispatchNotification(eventKey, recipients, vars).catch(() => undefined);
}

async function notifyInfluencerUser(
  influencerId: string,
  eventKey: string,
  vars: Record<string, string>,
) {
  const user = await prisma.user.findFirst({
    where: { influencerId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!user) return;
  const recipients = await recipientsFromUserIds([user.id]);
  await dispatchNotification(eventKey, recipients, vars).catch(() => undefined);
}

export async function listBrandShippingIntegrations(brandId: string) {
  const rows = await prisma.brandShippingIntegration.findMany({
    where: { brandId },
    orderBy: { createdAt: "asc" },
  });

  // Platform genelinde Navlungo API bilgileri tanımlıysa marka için otomatik aktif olarak hazırla.
  const navDefaults = platformNavlungoDefaults();
  const existingNav = rows.find((r) => r.provider === "NAVLUNGO");
  if (navDefaults.hasPlatformCreds && (!existingNav || !existingNav.apiKey)) {
    const upsertedNav = await prisma.brandShippingIntegration.upsert({
      where: { brandId_provider: { brandId, provider: "NAVLUNGO" } },
      create: {
        brandId,
        provider: "NAVLUNGO",
        apiKey: encryptShippingSecret(navDefaults.username!),
        apiSecret: navDefaults.password ? encryptShippingSecret(navDefaults.password) : null,
        customerCode: "1",
        defaultSenderAddressId: navDefaults.senderAddressId,
        isActive: true,
        lastTestedAt: new Date(),
        lastTestOk: true,
      },
      update: {
        apiKey: encryptShippingSecret(navDefaults.username!),
        apiSecret: navDefaults.password ? encryptShippingSecret(navDefaults.password) : null,
        customerCode: existingNav?.customerCode ?? "1",
        defaultSenderAddressId: existingNav?.defaultSenderAddressId ?? navDefaults.senderAddressId,
        isActive: true,
        lastTestedAt: existingNav?.lastTestedAt ?? new Date(),
        lastTestOk: existingNav?.lastTestOk ?? true,
      },
    });
    const idx = rows.findIndex((r) => r.provider === "NAVLUNGO");
    if (idx >= 0) {
      rows[idx] = upsertedNav;
    } else {
      rows.unshift(upsertedNav);
    }
  }

  // Kargo anlaşması olmayan markalar için Platform Dışı / Manuel Takip varsayılan olarak açık gelir.
  const hasManual = rows.some((r) => r.provider === "CUSTOM_MANUAL");
  if (!hasManual) {
    const created = await prisma.brandShippingIntegration.create({
      data: {
        brandId,
        provider: "CUSTOM_MANUAL",
        isActive: true,
        lastTestOk: true,
      },
    });
    rows.push(created);
  }

  return rows.map((r) => ({
    id: r.id,
    brandId: r.brandId,
    provider: r.provider,
    label: shippingProviderLabels[r.provider],
    hasApiKey: Boolean(r.apiKey),
    maskedApiKey: maskShippingSecret(r.apiKey),
    hasApiSecret: Boolean(r.apiSecret),
    customerCode: r.customerCode,
    isActive: r.isActive,
    defaultSenderAddressId: r.defaultSenderAddressId,
    senderAddress: r.senderAddress as SenderAddress | null,
    lastTestedAt: r.lastTestedAt,
    lastTestOk: r.lastTestOk,
  }));
}

export async function upsertBrandShippingIntegration(
  brandId: string,
  rawInput: BrandShippingIntegrationInput,
) {
  const input = brandShippingIntegrationSchema.parse(rawInput);
  const existing = await prisma.brandShippingIntegration.findUnique({
    where: { brandId_provider: { brandId, provider: input.provider } },
  });

  const apiKey =
    input.apiKey && !input.apiKey.startsWith("••••")
      ? encryptShippingSecret(input.apiKey)
      : existing?.apiKey ?? null;
  const apiSecret =
    input.apiSecret && !input.apiSecret.startsWith("••••")
      ? encryptShippingSecret(input.apiSecret)
      : existing?.apiSecret ?? null;

  return prisma.brandShippingIntegration.upsert({
    where: { brandId_provider: { brandId, provider: input.provider } },
    create: {
      brandId,
      provider: input.provider,
      apiKey,
      apiSecret,
      customerCode: input.customerCode ?? null,
      isActive: input.isActive,
      defaultSenderAddressId: input.defaultSenderAddressId ?? null,
      senderAddress: (input.senderAddress ?? null) as Prisma.InputJsonValue,
    },
    update: {
      apiKey,
      apiSecret,
      customerCode: input.customerCode ?? existing?.customerCode ?? null,
      isActive: input.isActive,
      defaultSenderAddressId: input.defaultSenderAddressId ?? existing?.defaultSenderAddressId ?? null,
      senderAddress: (input.senderAddress ?? existing?.senderAddress ?? null) as Prisma.InputJsonValue,
    },
  });
}

async function getBrandCredentials(
  brandId: string,
  provider: ShippingProvider,
): Promise<CargoCredentials> {
  const row = brandId
    ? await prisma.brandShippingIntegration.findUnique({
        where: { brandId_provider: { brandId, provider } },
      })
    : null;
  const navDefaults = provider === "NAVLUNGO" ? platformNavlungoDefaults() : null;
  return {
    provider,
    apiKey: decryptShippingSecret(row?.apiKey) ?? navDefaults?.username ?? null,
    apiSecret: decryptShippingSecret(row?.apiSecret) ?? navDefaults?.password ?? null,
    customerCode: row?.customerCode ?? (provider === "NAVLUNGO" ? "1" : null),
    defaultSenderAddressId: row?.defaultSenderAddressId ?? navDefaults?.senderAddressId ?? null,
    senderAddress: (row?.senderAddress as SenderAddress | null) ?? null,
  };
}

export async function getNavlungoBarcode(
  brandId: string | null | undefined,
  postNumber: string,
  barcodeType: "pdf" | "html" | "zpl" = "pdf",
) {
  const creds = await getBrandCredentials(brandId ?? "", "NAVLUNGO");
  const adapter = new NavlungoAdapter();
  return adapter.getBarcode(creds, postNumber, barcodeType);
}

export async function testBrandShippingIntegration(
  brandId: string,
  provider: ShippingProvider,
): Promise<CargoTestResult> {
  const adapter = getCargoAdapter(provider);
  const creds = await getBrandCredentials(brandId, provider);
  const result = await adapter.testConnection(creds);

  await prisma.brandShippingIntegration.updateMany({
    where: { brandId, provider },
    data: { lastTestedAt: new Date(), lastTestOk: result.ok },
  });

  return result;
}

export async function getCampaignShippingConfig(campaignId: string) {
  const cfg = await prisma.campaignShippingConfig.findUnique({
    where: { campaignId },
  });
  if (!cfg) {
    return {
      campaignId,
      requiresProductShipment: false,
      shippingMode: "MANUAL_TRACKING" as const,
      productDetails: parseProductDetails({}),
      contentTriggerRule: "AFTER_DELIVERY" as const,
      contentDeadlineDays: 7,
    };
  }
  return {
    campaignId: cfg.campaignId,
    requiresProductShipment: cfg.requiresProductShipment,
    shippingMode: cfg.shippingMode,
    productDetails: parseProductDetails(cfg.productDetails),
    contentTriggerRule: cfg.contentTriggerRule,
    contentDeadlineDays: cfg.contentDeadlineDays,
  };
}

export async function upsertCampaignShippingConfig(
  campaignId: string,
  rawInput: CampaignShippingConfigInput,
) {
  const input = campaignShippingConfigSchema.parse(rawInput);
  return prisma.campaignShippingConfig.upsert({
    where: { campaignId },
    create: {
      campaignId,
      requiresProductShipment: input.requiresProductShipment,
      shippingMode: input.shippingMode,
      productDetails: input.productDetails as unknown as Prisma.InputJsonValue,
      contentTriggerRule: input.contentTriggerRule,
      contentDeadlineDays: input.contentDeadlineDays ?? 7,
    },
    update: {
      requiresProductShipment: input.requiresProductShipment,
      shippingMode: input.shippingMode,
      productDetails: input.productDetails as unknown as Prisma.InputJsonValue,
      contentTriggerRule: input.contentTriggerRule,
      contentDeadlineDays: input.contentDeadlineDays ?? null,
    },
  });
}

export async function listInfluencerAddresses(influencerId: string) {
  return prisma.influencerAddress.findMany({
    where: { influencerId },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
}

export async function saveInfluencerAddress(
  influencerId: string,
  input: {
    label?: string;
    recipientName: string;
    recipientPhone: string;
    addressLine: string;
    city: string;
    district: string;
    postalCode?: string | null;
    isDefault?: boolean;
  },
) {
  if (input.isDefault) {
    await prisma.influencerAddress.updateMany({
      where: { influencerId },
      data: { isDefault: false },
    });
  }
  return prisma.influencerAddress.create({
    data: {
      influencerId,
      label: input.label?.trim() || "Teslimat Adresi",
      recipientName: input.recipientName.trim(),
      recipientPhone: input.recipientPhone.trim(),
      addressLine: input.addressLine.trim(),
      city: input.city.trim(),
      district: input.district.trim(),
      postalCode: input.postalCode?.trim() || null,
      isDefault: input.isDefault ?? false,
    },
  });
}

export async function ensureShipmentForOffer(
  offerId: string,
  confirmInput?: ConfirmAddressInput | null,
) {
  const offer = await prisma.offer.findUnique({
    where: { id: offerId },
    select: { id: true, campaignId: true, assignmentId: true, brandId: true, influencerId: true },
  });
  if (!offer?.campaignId) return null;

  const cfg = await prisma.campaignShippingConfig.findUnique({
    where: { campaignId: offer.campaignId },
  });
  if (!cfg?.requiresProductShipment) return null;

  const collaborationId = offer.assignmentId ?? offer.id;
  const existing = await prisma.shipment.findFirst({
    where: {
      OR: [{ collaborationId }, { offerId: offer.id }],
    },
  });

  if (existing && !confirmInput) return existing;

  let confirmedData: ConfirmAddressInput | null = null;
  if (confirmInput) {
    confirmedData = confirmAddressSchema.parse(confirmInput);
    if (confirmedData.saveAddress) {
      await saveInfluencerAddress(offer.influencerId, {
        label: confirmedData.addressLabel || "Teslimat Adresi",
        recipientName: confirmedData.recipientName,
        recipientPhone: confirmedData.recipientPhone,
        addressLine: confirmedData.shippingAddress.addressLine,
        city: confirmedData.shippingAddress.city,
        district: confirmedData.shippingAddress.district,
        postalCode: confirmedData.shippingAddress.postalCode,
        isDefault: true,
      });
    }
  }

  const shipment = existing
    ? await prisma.shipment.update({
        where: { id: existing.id },
        data: confirmedData
          ? {
              recipientName: confirmedData.recipientName,
              recipientPhone: confirmedData.recipientPhone,
              shippingAddress: confirmedData.shippingAddress as unknown as Prisma.InputJsonValue,
              selectedVariant: (confirmedData.selectedVariant ?? null) as Prisma.InputJsonValue,
              status: "READY_TO_SHIP",
            }
          : {},
      })
    : await prisma.shipment.create({
        data: {
          collaborationId,
          campaignId: offer.campaignId,
          assignmentId: offer.assignmentId,
          offerId: offer.id,
          brandId: offer.brandId,
          influencerId: offer.influencerId,
          recipientName: confirmedData?.recipientName ?? null,
          recipientPhone: confirmedData?.recipientPhone ?? null,
          shippingAddress: (confirmedData?.shippingAddress ?? null) as Prisma.InputJsonValue,
          selectedVariant: (confirmedData?.selectedVariant ?? null) as Prisma.InputJsonValue,
          status: confirmedData ? "READY_TO_SHIP" : "PENDING_ADDRESS",
        },
      });

  if (confirmedData) {
    const [inf, camp] = await Promise.all([
      prisma.influencer.findUnique({ where: { id: offer.influencerId }, select: { name: true } }),
      prisma.campaign.findUnique({ where: { id: offer.campaignId }, select: { name: true } }),
    ]);
    await notifyBrandUsers(offer.brandId, "SHIPMENT_ADDRESS_CONFIRMED", {
      influencer: inf?.name ?? "Influencer",
      kampanya: camp?.name ?? "Kampanya",
      link: `/marka/kampanyalar/${offer.campaignId}#kargo`,
    });
  }

  return shipment;
}

export async function linkOrCreateShipmentForAssignment(assignmentId: string, offerId?: string | null) {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { campaign: { select: { id: true, brandId: true, shippingConfig: true } } },
  });
  if (!assignment) return null;

  if (offerId) {
    const existing = await prisma.shipment.findFirst({ where: { offerId } });
    if (existing) {
      return prisma.shipment.update({
        where: { id: existing.id },
        data: { assignmentId: assignment.id, collaborationId: assignment.id },
      });
    }
  }

  if (!assignment.campaign.shippingConfig?.requiresProductShipment) return null;

  return prisma.shipment.upsert({
    where: { collaborationId: assignment.id },
    create: {
      collaborationId: assignment.id,
      campaignId: assignment.campaignId,
      assignmentId: assignment.id,
      offerId: offerId ?? null,
      brandId: assignment.campaign.brandId,
      influencerId: assignment.influencerId,
      status: "PENDING_ADDRESS",
    },
    update: { assignmentId: assignment.id },
  });
}

export async function confirmShipmentAddress(
  shipmentId: string,
  influencerId: string,
  rawInput: ConfirmAddressInput,
) {
  const input = confirmAddressSchema.parse(rawInput);
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      influencer: { select: { name: true } },
      campaign: { select: { name: true } },
    },
  });
  if (!shipment || shipment.influencerId !== influencerId) {
    throw new DomainError("BULUNAMADI", "Gönderi kaydı bulunamadı.");
  }
  if (shipment.status !== "PENDING_ADDRESS" && shipment.status !== "READY_TO_SHIP") {
    throw new DomainError("GECERSIZ_GECIS", "Kargoya verilmiş gönderinin adresi değiştirilemez.");
  }

  if (input.saveAddress) {
    await saveInfluencerAddress(influencerId, {
      label: input.addressLabel || "Teslimat Adresi",
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      addressLine: input.shippingAddress.addressLine,
      city: input.shippingAddress.city,
      district: input.shippingAddress.district,
      postalCode: input.shippingAddress.postalCode,
      isDefault: true,
    });
  }

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      shippingAddress: input.shippingAddress as unknown as Prisma.InputJsonValue,
      selectedVariant: (input.selectedVariant ?? null) as Prisma.InputJsonValue,
      status: "READY_TO_SHIP",
    },
  });

  await notifyBrandUsers(shipment.brandId, "SHIPMENT_ADDRESS_CONFIRMED", {
    influencer: shipment.influencer.name,
    kampanya: shipment.campaign.name,
    link: `/marka/kampanyalar/${shipment.campaignId}#kargo`,
  });

  return updated;
}

export async function dispatchSingleShipment(params: {
  brandId: string;
  shipmentId: string;
  provider: ShippingProvider;
  manualCarrierName?: string | null;
  manualTrackingNumber?: string | null;
}) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: params.shipmentId },
    include: {
      brand: { select: { name: true } },
      campaign: { select: { name: true, shippingConfig: true } },
    },
  });
  if (!shipment || shipment.brandId !== params.brandId) {
    throw new DomainError("BULUNAMADI", "Gönderi bulunamadı.");
  }
  if (shipment.status === "PENDING_ADDRESS") {
    throw new DomainError("KURAL_IHLALI", "Influencer henüz teslimat adresini onaylamadı.");
  }
  const address = parseShippingAddress(shipment.shippingAddress);
  if (!address || !shipment.recipientName || !shipment.recipientPhone) {
    throw new DomainError("DOGRULAMA", "Teslimat adresi bilgileri eksik.");
  }

  const adapter = getCargoAdapter(params.provider);
  const creds = await getBrandCredentials(params.brandId, params.provider);
  const product = parseProductDetails(shipment.campaign.shippingConfig?.productDetails);

  const created = await adapter.createShipment(creds, {
    shipmentId: shipment.id,
    collaborationId: shipment.collaborationId,
    recipientName: shipment.recipientName,
    recipientPhone: shipment.recipientPhone,
    shippingAddress: address,
    productName: product.name || shipment.campaign.name,
    selectedVariant: (shipment.selectedVariant as Record<string, string> | null) ?? null,
    manualCarrierName: params.manualCarrierName,
    manualTrackingNumber: params.manualTrackingNumber,
  });

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      provider: params.provider,
      carrierName: created.carrierName,
      trackingNumber: created.trackingNumber,
      trackingUrl: created.trackingUrl || buildCarrierTrackingUrl(created.carrierName ?? params.provider, created.trackingNumber),
      barcodeLabelUrl: created.barcodeLabelUrl,
      externalShipmentId: created.externalShipmentId,
      estimatedDeliveryDate: created.estimatedDeliveryDate,
      status: "LABEL_CREATED",
    },
  });

  await notifyInfluencerUser(shipment.influencerId, "SHIPMENT_DISPATCHED", {
    marka: shipment.brand.name,
    kargo: created.carrierName,
    takipNo: created.trackingNumber,
    link: "/influencer",
  });

  return updated;
}

export async function bulkDispatchShipments(params: {
  brandId: string;
  shipmentIds: string[];
  provider: ShippingProvider;
  manualCarrierName?: string | null;
  manualTrackingNumber?: string | null;
}) {
  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const shipmentId of params.shipmentIds) {
    try {
      await dispatchSingleShipment({
        brandId: params.brandId,
        shipmentId,
        provider: params.provider,
        manualCarrierName: params.manualCarrierName,
        manualTrackingNumber: params.manualTrackingNumber,
      });
      succeeded.push(shipmentId);
    } catch (err) {
      failed.push({
        id: shipmentId,
        error: err instanceof Error ? err.message : "Gönderi oluşturulamadı.",
      });
    }
  }

  return { succeeded, failed };
}

export async function transitionShipmentStatus(
  shipmentId: string,
  nextStatus: ShipmentStatus,
  opts?: { deliveredAt?: Date | null; estimatedDeliveryDate?: Date | null },
) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      brand: { select: { name: true } },
      influencer: { select: { name: true } },
      campaign: { select: { name: true, shippingConfig: true } },
    },
  });
  if (!shipment) throw new DomainError("BULUNAMADI", "Gönderi bulunamadı.");

  const isFirstDelivery = nextStatus === "DELIVERED" && shipment.status !== "DELIVERED";
  const deliveredAt = isFirstDelivery
    ? (opts?.deliveredAt ?? new Date())
    : shipment.deliveredAt;

  const updated = await prisma.shipment.update({
    where: { id: shipment.id },
    data: {
      status: nextStatus,
      deliveredAt,
      estimatedDeliveryDate: opts?.estimatedDeliveryDate ?? shipment.estimatedDeliveryDate,
    },
  });

  if (isFirstDelivery && deliveredAt) {
    // Kampanya kuralı AFTER_DELIVERY ise içerik teslim tarihlerini (deadline) teslimat tarihinden başlat.
    const cfg = shipment.campaign.shippingConfig;
    if (cfg?.contentTriggerRule === "AFTER_DELIVERY" && shipment.assignmentId) {
      const days = cfg.contentDeadlineDays ?? 7;
      const newDeadline = new Date(deliveredAt.getTime() + days * DAY_MS);
      await prisma.deliverable.updateMany({
        where: {
          assignmentId: shipment.assignmentId,
          status: { in: ["TASLAK", "ATANDI", "BRIEF_GONDERILDI"] },
        },
        data: {
          plannedAt: newDeadline,
          approvalDeadline: new Date(newDeadline.getTime() - 2 * DAY_MS),
        },
      });
    }

    await Promise.all([
      notifyInfluencerUser(shipment.influencerId, "SHIPMENT_DELIVERED_INFLUENCER", {
        marka: shipment.brand.name,
        kampanya: shipment.campaign.name,
        link: "/influencer",
      }),
      notifyBrandUsers(shipment.brandId, "SHIPMENT_DELIVERED_BRAND", {
        influencer: shipment.influencer.name,
        kampanya: shipment.campaign.name,
        link: `/marka/kampanyalar/${shipment.campaignId}#kargo`,
      }),
    ]);
  }

  return updated;
}

export async function markShipmentDeliveredByInfluencer(
  shipmentId: string,
  influencerId: string,
) {
  const shipment = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!shipment || shipment.influencerId !== influencerId) {
    throw new DomainError("BULUNAMADI", "Gönderi bulunamadı.");
  }
  if (shipment.status === "PENDING_ADDRESS") {
    throw new DomainError("GECERSIZ_GECIS", "Önce teslimat adresinizi onaylamalısınız.");
  }
  return transitionShipmentStatus(shipment.id, "DELIVERED", { deliveredAt: new Date() });
}

export async function handleCargoWebhook(
  provider: ShippingProvider,
  payload: unknown,
  headers?: Record<string, string | string[] | undefined>,
) {
  const adapter = getCargoAdapter(provider);
  const parsed = adapter.parseWebhook(payload, headers);
  if (!parsed) return { processed: false as const, reason: "INVALID_PAYLOAD" };

  const shipment = await prisma.shipment.findFirst({
    where: {
      OR: [
        { trackingNumber: parsed.trackingNumber },
        ...(parsed.externalShipmentId ? [{ externalShipmentId: parsed.externalShipmentId }] : []),
      ],
    },
  });
  if (!shipment) return { processed: false as const, reason: "SHIPMENT_NOT_FOUND" };

  const updated = await transitionShipmentStatus(shipment.id, parsed.status, {
    deliveredAt: parsed.deliveredAt,
    estimatedDeliveryDate: parsed.estimatedDeliveryDate,
  });

  return { processed: true as const, shipmentId: updated.id, status: updated.status };
}

/** Arka plan polling worker'ı: kargodaki aktif gönderilerin durumunu senkronize eder. */
export async function pollActiveShipments(limit = 50): Promise<{ checked: number; updated: number }> {
  const active = await prisma.shipment.findMany({
    where: {
      status: { in: ["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY"] },
      trackingNumber: { not: null },
      provider: { not: "CUSTOM_MANUAL" },
    },
    take: limit,
    orderBy: { updatedAt: "asc" },
  });

  let updated = 0;
  for (const s of active) {
    if (!s.provider || !s.trackingNumber) continue;
    try {
      const adapter = getCargoAdapter(s.provider);
      const creds = await getBrandCredentials(s.brandId, s.provider);
      const res = await adapter.trackShipment(creds, s.trackingNumber);
      if (res.status !== s.status) {
        await transitionShipmentStatus(s.id, res.status, {
          deliveredAt: res.deliveredAt,
          estimatedDeliveryDate: res.estimatedDeliveryDate,
        });
        updated++;
      }
    } catch {
      // Tekil kargo sorgu hatası diğer gönderileri durdurmaz.
    }
  }
  return { checked: active.length, updated };
}

export async function getCampaignShipmentsDashboard(campaignId: string) {
  const [config, shipments, integrations] = await Promise.all([
    getCampaignShippingConfig(campaignId),
    prisma.shipment.findMany({
      where: { campaignId },
      include: {
        influencer: { select: { id: true, name: true, city: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.campaign
      .findUnique({ where: { id: campaignId }, select: { brandId: true } })
      .then((c) => (c ? listBrandShippingIntegrations(c.brandId) : [])),
  ]);

  const kpi = {
    total: shipments.length,
    pendingAddress: shipments.filter((s) => s.status === "PENDING_ADDRESS").length,
    readyToShip: shipments.filter((s) => s.status === "READY_TO_SHIP").length,
    inTransit: shipments.filter((s) =>
      ["LABEL_CREATED", "IN_TRANSIT", "OUT_FOR_DELIVERY"].includes(s.status),
    ).length,
    delivered: shipments.filter((s) => s.status === "DELIVERED").length,
    returned: shipments.filter((s) => s.status === "RETURNED").length,
  };

  return { config, shipments, kpi, integrations };
}

export async function getInfluencerShipmentForCollaboration(params: {
  influencerId: string;
  campaignId: string;
  assignmentId?: string | null;
}) {
  const [config, shipment, addresses] = await Promise.all([
    getCampaignShippingConfig(params.campaignId),
    prisma.shipment.findFirst({
      where: {
        influencerId: params.influencerId,
        campaignId: params.campaignId,
        ...(params.assignmentId ? { OR: [{ assignmentId: params.assignmentId }, { assignmentId: null }] } : {}),
      },
      orderBy: { createdAt: "desc" },
    }),
    listInfluencerAddresses(params.influencerId),
  ]);

  const isUploadLocked =
    config.requiresProductShipment &&
    config.contentTriggerRule === "AFTER_DELIVERY" &&
    shipment?.status !== "DELIVERED";

  return { config, shipment, addresses, isUploadLocked };
}

export async function isContentUploadLockedForAssignment(assignmentId: string): Promise<{
  locked: boolean;
  reason?: string;
}> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true,
      campaignId: true,
      influencerId: true,
      campaign: { select: { shippingConfig: true } },
    },
  });
  if (!assignment?.campaign.shippingConfig?.requiresProductShipment) {
    return { locked: false };
  }
  if (assignment.campaign.shippingConfig.contentTriggerRule !== "AFTER_DELIVERY") {
    return { locked: false };
  }
  const shipment = await prisma.shipment.findFirst({
    where: {
      campaignId: assignment.campaignId,
      influencerId: assignment.influencerId,
    },
    orderBy: { createdAt: "desc" },
  });
  if (shipment?.status === "DELIVERED") {
    return { locked: false };
  }
  return {
    locked: true,
    reason:
      "Ürününüz kargo aşamasındadır. Ürün elinize ulaştıktan sonra çekim yaparak içeriğinizi yükleyebilirsiniz.",
  };
}
