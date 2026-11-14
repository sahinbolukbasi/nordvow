import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { processRawWebhook } from "../src/channels/processor";
import { metaClient, setMetaClient, type MetaClient } from "../src/channels/meta-client";
import { enablePageAndInstagramPrompts, enableWhatsAppWelcome } from "../src/bot/automation";
import { textForPayload, whatsAppAutomationBody } from "../src/bot/welcome";
import { makeTenant, resetDb } from "./helpers";

describe("karşılama ve buz kırıcı", () => {
  let phoneNumberId = "";

  beforeAll(async () => {
    await resetDb();
    const tenant = await makeTenant("Bot Karsilama");
    phoneNumberId = tenant.phoneNumberId;
    await prisma.botSettings.create({
      data: {
        id: "default",
        whatsappEnabled: true,
        instagramEnabled: true,
        messengerEnabled: true,
        whatsappPhoneNumberId: phoneNumberId,
        igUserId: "ig-1",
        pageId: "page-1",
        welcomeTr: "Merhaba Nordvow",
        welcomeEn: "Hello Nordvow",
      },
    });
  });

  it("request_welcome karşılama metnini yazar", async () => {
    const raw = await prisma.rawWebhook.create({ data: { provider: "meta", s3Key: "w1" } });
    await processRawWebhook(raw.id, JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: phoneNumberId }, messages: [{ id: "wamid.welcome", from: "905321110011", timestamp: "1700000000", type: "request_welcome", locale: "en" }] } }] }],
    }));
    const out = await prisma.message.findFirst({ where: { direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } });
    expect(out?.body).toContain("Hello Nordvow");
  });

  it("get_started ve buz kırıcı yükünü yönlendirir", async () => {
    expect(textForPayload("GET_STARTED")?.opening).toBe(true);
    expect(textForPayload("ICE_WHAT")?.text).toBe("Nordvow nedir?");
    expect(textForPayload("ICE_CREATOR")?.text).toContain("Influencer");
    expect(textForPayload("NOPE")).toBeNull();

    const raw = await prisma.rawWebhook.create({ data: { provider: "meta", s3Key: "w2" } });
    const existing = await prisma.channelConnection.findFirstOrThrow({ where: { provider: "WHATSAPP" } });
    await prisma.channelConnection.create({
      data: { tenantId: existing.tenantId, provider: "MESSENGER", externalIds: { page_id: "page-1" }, tokenRef: existing.tokenRef, scopes: [], status: "ACTIVE" },
    });
    await processRawWebhook(raw.id, JSON.stringify({
      object: "page",
      entry: [{ id: "page-1", messaging: [{ sender: { id: "psid-1" }, timestamp: 1700000001, postback: { payload: "ICE_BRAND", mid: "mid.ice" } }] }],
    }));
    const inbound = await prisma.message.findFirst({ where: { externalId: "mid.ice" } });
    expect(inbound?.body).toContain("Marka/ajans");
  });

  it("tanınmayan olayı yalnız neden koduyla yazar", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw = await prisma.rawWebhook.create({ data: { provider: "meta", s3Key: "w3" } });
    const body = JSON.stringify({ object: "not_meta", secret: "should-not-log", entry: [{ token: "abc" }] });
    await processRawWebhook(raw.id, body);
    const logged = spy.mock.calls.map((c) => JSON.stringify(c));
    expect(logged.some((line) => line.includes("unknown_object"))).toBe(true);
    for (const line of logged) {
      expect(line).not.toContain("should-not-log");
      expect(line).not.toContain("abc");
    }
    spy.mockRestore();
  });

  it("yönetici çağrıları tokenı gövdeye koymaz", async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = "x".repeat(12);
    process.env.META_SYSTEM_USER_TOKEN = "y".repeat(12);
    const calls: { path: string; body: unknown }[] = [];
    const base = metaClient();
    setMetaClient({
      ...base,
      async enableConversationalAutomation(id, token, body) {
        expect(token.length).toBeGreaterThan(0);
        calls.push({ path: id, body });
        return { success: true };
      },
      async setMessengerProfile(id, token, body) {
        expect(token.length).toBeGreaterThan(0);
        calls.push({ path: id, body });
        return { success: true };
      },
      async setInstagramIceBreakers(id, token, body) {
        expect(token.length).toBeGreaterThan(0);
        calls.push({ path: id, body });
        return { success: true };
      },
    } as MetaClient);
    await enableWhatsAppWelcome();
    await enablePageAndInstagramPrompts();
    setMetaClient(undefined);
    expect(whatsAppAutomationBody().prompts).toHaveLength(4);
    expect(calls[0]?.path).toBe(phoneNumberId);
    const dumped = JSON.stringify(calls);
    expect(dumped).not.toContain(process.env.WHATSAPP_ACCESS_TOKEN);
    expect(dumped).not.toContain(process.env.META_SYSTEM_USER_TOKEN);
    expect(dumped).toContain("GET_STARTED");
    expect(dumped).toContain("instagram");
  });
});
