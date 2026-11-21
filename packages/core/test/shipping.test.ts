import { afterEach, describe, expect, it, vi } from "vitest";
import { NavlungoAdapter } from "../src/shipping/adapters/navlungo";
import { getCargoAdapter } from "../src/shipping/adapters/registry";
import {
  decryptShippingSecret,
  encryptShippingSecret,
  maskShippingSecret,
} from "../src/shipping/crypto";
import {
  buildCarrierTrackingUrl,
  campaignShippingConfigSchema,
  confirmAddressSchema,
  SHIPPING_PROVIDERS,
} from "../src/shipping/types";

describe("shipping crypto", () => {
  it("encrypts, decrypts, and masks secrets round-trip", () => {
    const plain = "yk_live_secret_987654321";
    const enc = encryptShippingSecret(plain);
    expect(enc).not.toBe(plain);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptShippingSecret(enc)).toBe(plain);
    expect(maskShippingSecret(enc)).toBe("••••4321");
  });
});

describe("cargo provider adapters (Strategy/Adapter pattern)", () => {
  it("resolves all configured providers and tests connection", async () => {
    for (const provider of SHIPPING_PROVIDERS) {
      if (provider === "NAVLUNGO") continue;
      const adapter = getCargoAdapter(provider);
      expect(adapter.provider).toBe(provider);
      const res = await adapter.testConnection({
        provider,
        apiKey: "key-123",
        apiSecret: "sec-456",
        customerCode: "CUST01",
        senderAddress: null,
      });
      expect(res.ok).toBe(true);
    }
  });

  it("fails integrated adapter testConnection when credentials are missing", async () => {
    const yurtici = getCargoAdapter("YURTICI");
    const res = await yurtici.testConnection({
      provider: "YURTICI",
      apiKey: null,
      apiSecret: null,
      customerCode: null,
      senderAddress: null,
    });
    expect(res.ok).toBe(false);
  });

  it("creates integrated shipment with barcode label and tracking url", async () => {
    const aras = getCargoAdapter("ARAS");
    const created = await aras.createShipment(
      {
        provider: "ARAS",
        apiKey: "aras-key",
        apiSecret: "aras-sec",
        customerCode: "C100",
        senderAddress: null,
      },
      {
        shipmentId: "ship_12345678",
        collaborationId: "collab_1",
        recipientName: "Ayşe Yılmaz",
        recipientPhone: "05551112233",
        shippingAddress: {
          addressLine: "Moda Cad. No:10",
          city: "İstanbul",
          district: "Kadıköy",
        },
        productName: "Serum",
      },
    );
    expect(created.trackingNumber.startsWith("AR")).toBe(true);
    expect(created.barcodeLabelUrl).toContain(created.trackingNumber);
    expect(created.trackingUrl).toContain("araskargo");
  });

  it("creates manual shipment with provided tracking number", async () => {
    const manual = getCargoAdapter("CUSTOM_MANUAL");
    const created = await manual.createShipment(
      {
        provider: "CUSTOM_MANUAL",
        apiKey: null,
        apiSecret: null,
        customerCode: null,
        senderAddress: null,
      },
      {
        shipmentId: "ship_manual_1",
        collaborationId: "collab_2",
        recipientName: "Mehmet Demir",
        recipientPhone: "05559998877",
        shippingAddress: {
          addressLine: "Atatürk Bulv. No:5",
          city: "Ankara",
          district: "Çankaya",
        },
        productName: "T-Shirt",
        manualCarrierName: "Sürat Kargo",
        manualTrackingNumber: "SRT-998877",
      },
    );
    expect(created.carrierName).toBe("Sürat Kargo");
    expect(created.trackingNumber).toBe("SRT-998877");
    expect(created.barcodeLabelUrl).toBeNull();
  });

  it("normalizes carrier webhook payloads", () => {
    const yurtici = getCargoAdapter("YURTICI");
    const parsed = yurtici.parseWebhook({
      trackingNumber: "YK123456",
      status: "TESLIM_EDILDI",
      deliveredAt: "2026-11-17T10:00:00.000Z",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.status).toBe("DELIVERED");
    expect(parsed?.trackingNumber).toBe("YK123456");
    expect(buildCarrierTrackingUrl("YURTICI", "YK123456")).toContain("yurticikargo");
  });
});

describe("shipping DTO schemas", () => {
  it("validates campaign shipping config and address confirmation", () => {
    const cfg = campaignShippingConfigSchema.parse({
      requiresProductShipment: true,
      shippingMode: "INTEGRATED_CARGO",
      productDetails: {
        name: "Krem",
        description: "Nemlendirici",
        variants: [{ label: "Boy", options: ["50ml", "100ml"] }],
      },
      contentTriggerRule: "AFTER_DELIVERY",
      contentDeadlineDays: 10,
    });
    expect(cfg.requiresProductShipment).toBe(true);

    const addr = confirmAddressSchema.parse({
      recipientName: "Zeynep Kaya",
      recipientPhone: "05321234567",
      shippingAddress: {
        addressLine: "Bağdat Cad. No:42 D:3",
        city: "İstanbul",
        district: "Kadıköy",
      },
      selectedVariant: { Boy: "50ml" },
    });
    expect(addr.shippingAddress.city).toBe("İstanbul");
  });
});

describe("NavlungoAdapter (Domestic v2.1)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authenticates, lists carriers, creates post and checks status", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/api")) {
        return new Response(JSON.stringify({ token: "nl_jwt_token_123" }), { status: 200 });
      }
      if (url.endsWith("/carrier/my-carriers")) {
        return new Response(
          JSON.stringify({ data: [{ id: 1, name: "Yurtiçi Kargo" }] }),
          { status: 200 },
        );
      }
      if (url.endsWith("/post/create")) {
        return new Response(
          JSON.stringify({
            data: [{ post_number: "NV99887766", carrier_name: "Yurtiçi Kargo" }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/post/check/NV99887766")) {
        return new Response(
          JSON.stringify({ data: { status: "DELIVERED", carrier_name: "Yurtiçi Kargo" } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const navlungo = getCargoAdapter("NAVLUNGO") as NavlungoAdapter;
    const creds = {
      provider: "NAVLUNGO" as const,
      apiKey: "marka@test.com",
      apiSecret: "secret123",
      customerCode: "1",
      defaultSenderAddressId: "147",
      senderAddress: null,
    };

    const testRes = await navlungo.testConnection(creds);
    expect(testRes.ok).toBe(true);
    expect(testRes.message).toContain("Yurtiçi Kargo");

    const created = await navlungo.createShipment(creds, {
      shipmentId: "ship_navlungo_1",
      collaborationId: "collab_1",
      recipientName: "Ayşe Yılmaz",
      recipientPhone: "05321234567",
      shippingAddress: {
        addressLine: "Zümrütevler Ural Sk. No:38",
        city: "İstanbul",
        district: "Maltepe",
      },
      productName: "Hydra Serum",
      selectedVariant: { Boy: "30ml" },
    });
    expect(created.trackingNumber).toBe("NV99887766");
    expect(created.barcodeLabelUrl).toContain("NV99887766");

    const tracked = await navlungo.trackShipment(creds, "NV99887766");
    expect(tracked.status).toBe("DELIVERED");
  });
});

