import { z } from "zod";
import type { ContentTriggerRule, ShipmentStatus, ShippingMode, ShippingProvider } from "../enums";

export const SHIPPING_PROVIDERS: readonly ShippingProvider[] = [
  "NAVLUNGO",
  "YURTICI",
  "ARAS",
  "MNG",
  "UPS",
  "HEPSIJET",
  "KOLAY_GELSIN",
  "CUSTOM_MANUAL",
];

export const INTEGRATED_PROVIDERS: readonly ShippingProvider[] = [
  "NAVLUNGO",
  "YURTICI",
  "ARAS",
  "MNG",
  "UPS",
  "HEPSIJET",
  "KOLAY_GELSIN",
];

export const shippingProviderLabels: Record<ShippingProvider, string> = {
  NAVLUNGO: "Navlungo (Domestic v2.1)",
  YURTICI: "Yurtiçi Kargo",
  ARAS: "Aras Kargo",
  MNG: "MNG Kargo",
  UPS: "UPS Türkiye",
  HEPSIJET: "HepsiJET",
  KOLAY_GELSIN: "Kolay Gelsin",
  CUSTOM_MANUAL: "Platform Dışı / Manuel Takip",
};

export const shippingModeLabels: Record<ShippingMode, string> = {
  INTEGRATED_CARGO: "Nordvow Kargo Entegrasyonu",
  MANUAL_TRACKING: "Kendi Kargom / Manuel Takip",
};

export const contentTriggerRuleLabels: Record<ContentTriggerRule, string> = {
  AFTER_DELIVERY: "Ürün teslim edildikten sonra başlasın",
  ANYTIME: "Kargo beklenmeden yüklenebilir",
};

export const shipmentStatusLabels: Record<ShipmentStatus, string> = {
  PENDING_ADDRESS: "Adres Onayı Bekleniyor",
  READY_TO_SHIP: "Kargolanmayı Bekliyor",
  LABEL_CREATED: "Kargo Kodu Oluşturuldu",
  IN_TRANSIT: "Yolda",
  OUT_FOR_DELIVERY: "Dağıtımda",
  DELIVERED: "Teslim Edildi",
  RETURNED: "İade / Teslim Edilemedi",
};

export const productVariantSchema = z.object({
  label: z.string().trim().min(1).max(60),
  options: z.array(z.string().trim().min(1).max(60)).min(1).max(30),
});

export const productDetailsSchema = z.object({
  name: z.string().trim().max(160).default(""),
  description: z.string().trim().max(1000).default(""),
  imageUrl: z.string().trim().max(500).optional().nullable(),
  estimatedValueTry: z.number().min(0).max(1_000_000).optional().nullable(),
  variants: z.array(productVariantSchema).max(10).default([]),
});

export type ProductVariantDef = z.infer<typeof productVariantSchema>;
export type ProductDetails = z.infer<typeof productDetailsSchema>;

export const campaignShippingConfigSchema = z.object({
  requiresProductShipment: z.boolean().default(false),
  shippingMode: z.enum(["INTEGRATED_CARGO", "MANUAL_TRACKING"]).default("MANUAL_TRACKING"),
  productDetails: productDetailsSchema.default({
    name: "",
    description: "",
    imageUrl: null,
    estimatedValueTry: null,
    variants: [],
  }),
  contentTriggerRule: z.enum(["AFTER_DELIVERY", "ANYTIME"]).default("AFTER_DELIVERY"),
  contentDeadlineDays: z.number().int().min(1).max(90).optional().nullable(),
});

export type CampaignShippingConfigInput = z.infer<typeof campaignShippingConfigSchema>;

export const shippingAddressSchema = z.object({
  addressLine: z.string().trim().min(5, "Açık adres en az 5 karakter olmalıdır.").max(500),
  city: z.string().trim().min(2, "İl bilgisi zorunludur.").max(80),
  district: z.string().trim().min(2, "İlçe bilgisi zorunludur.").max(80),
  postalCode: z.string().trim().max(20).optional().nullable(),
});

export type ShippingAddress = z.infer<typeof shippingAddressSchema>;

export const confirmAddressSchema = z.object({
  recipientName: z.string().trim().min(2, "Alıcı adı zorunludur.").max(120),
  recipientPhone: z.string().trim().min(7, "Telefon numarası zorunludur.").max(30),
  shippingAddress: shippingAddressSchema,
  selectedVariant: z.record(z.string(), z.string()).optional().nullable(),
  saveAddress: z.boolean().optional(),
  addressLabel: z.string().trim().max(40).optional(),
});

export type ConfirmAddressInput = z.infer<typeof confirmAddressSchema>;

export const senderAddressSchema = z.object({
  senderName: z.string().trim().min(2).max(120),
  senderPhone: z.string().trim().min(7).max(30),
  addressLine: z.string().trim().min(5).max(500),
  city: z.string().trim().min(2).max(80),
  district: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().max(20).optional().nullable(),
});

export type SenderAddress = z.infer<typeof senderAddressSchema>;

export const brandShippingIntegrationSchema = z.object({
  provider: z.enum(["NAVLUNGO", "YURTICI", "ARAS", "MNG", "UPS", "HEPSIJET", "KOLAY_GELSIN", "CUSTOM_MANUAL"]),
  apiKey: z.string().trim().max(500).optional().nullable(),
  apiSecret: z.string().trim().max(500).optional().nullable(),
  customerCode: z.string().trim().max(120).optional().nullable(),
  isActive: z.boolean().default(true),
  defaultSenderAddressId: z.string().trim().max(80).optional().nullable(),
  senderAddress: senderAddressSchema.optional().nullable(),
});

export type BrandShippingIntegrationInput = z.infer<typeof brandShippingIntegrationSchema>;

export type CargoCredentials = {
  provider: ShippingProvider;
  apiKey: string | null;
  apiSecret: string | null;
  customerCode: string | null;
  defaultSenderAddressId?: string | null;
  senderAddress: SenderAddress | null;
};

export type CreateCargoShipmentRequest = {
  shipmentId: string;
  collaborationId: string;
  recipientName: string;
  recipientPhone: string;
  recipientEmail?: string | null;
  shippingAddress: ShippingAddress;
  productName: string;
  selectedVariant?: Record<string, string> | null;
  manualCarrierName?: string | null;
  manualTrackingNumber?: string | null;
};

export type CargoCreateResult = {
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string;
  barcodeLabelUrl: string | null;
  externalShipmentId: string | null;
  estimatedDeliveryDate: Date | null;
};

export type CargoTrackingResult = {
  status: ShipmentStatus;
  carrierName: string;
  trackingNumber: string;
  trackingUrl: string | null;
  estimatedDeliveryDate: Date | null;
  deliveredAt: Date | null;
  rawEvent?: string;
};

export type CargoWebhookNormalized = {
  trackingNumber: string;
  externalShipmentId?: string | null;
  status: ShipmentStatus;
  deliveredAt?: Date | null;
  estimatedDeliveryDate?: Date | null;
};

export type CargoTestResult = {
  ok: boolean;
  message: string;
  latencyMs: number;
};

/**
 * Adapter / Strategy Pattern arayüzü.
 * Her kargo firması bu arayüzü uygular.
 */
export interface ICargoProvider {
  readonly provider: ShippingProvider;
  readonly displayName: string;

  testConnection(credentials: CargoCredentials): Promise<CargoTestResult>;

  createShipment(
    credentials: CargoCredentials,
    req: CreateCargoShipmentRequest,
  ): Promise<CargoCreateResult>;

  trackShipment(
    credentials: CargoCredentials,
    trackingNumber: string,
  ): Promise<CargoTrackingResult>;

  parseWebhook(
    payload: unknown,
    headers?: Record<string, string | string[] | undefined>,
  ): CargoWebhookNormalized | null;
}

export function buildCarrierTrackingUrl(provider: ShippingProvider | string, trackingNumber: string): string {
  const code = encodeURIComponent(trackingNumber.trim());
  switch (provider) {
    case "NAVLUNGO":
      return `https://app.navlungo.com/track/${code}`;
    case "YURTICI":
      return `https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code=${code}`;
    case "ARAS":
      return `https://kargotakip.araskargo.com.tr/mainpage.aspx?code=${code}`;
    case "MNG":
      return `https://www.mngkargo.com.tr/gonderitakip?gonderino=${code}`;
    case "UPS":
      return `https://www.ups.com/track?loc=tr_TR&tracknum=${code}`;
    case "HEPSIJET":
      return `https://www.hepsijet.com/gonderi-takibi/${code}`;
    case "KOLAY_GELSIN":
      return `https://kolaygelsin.com/gonderi-takip?trackingNumber=${code}`;
    default:
      return `https://www.google.com/search?q=kargo+takip+${code}`;
  }
}

export function parseProductDetails(raw: unknown): ProductDetails {
  const res = productDetailsSchema.safeParse(raw ?? {});
  return res.success
    ? res.data
    : { name: "", description: "", imageUrl: null, estimatedValueTry: null, variants: [] };
}

export function parseShippingAddress(raw: unknown): ShippingAddress | null {
  const res = shippingAddressSchema.safeParse(raw);
  return res.success ? res.data : null;
}

