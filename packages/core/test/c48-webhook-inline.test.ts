import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db";
import { receiveWebhook, setWebhookEnqueue } from "../src/channels/webhook";
import { resetDb, sign } from "./helpers";

describe("webhook bot aynı istekte işlenir", () => {
  beforeAll(async () => {
    await resetDb();
    await prisma.botSettings.create({
      data: {
        id: "default",
        whatsappEnabled: true,
        whatsappPhoneNumberId: "1337000000000001",
        welcomeTr: "Merhaba",
        welcomeEn: "Hello",
      },
    });
    process.env.WHATSAPP_ACCESS_TOKEN = "x".repeat(16);
    process.env.META_API_MODE = "mock";
  });

  it("numara tablosunda olmasa da platform botu yanıtlar ve telefonu loglamaz", async () => {
    setWebhookEnqueue(() => {
      throw new Error("enqueue");
    });
    const from = "905320001111";
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "waba", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1337000000000001" }, contacts: [{ wa_id: from, profile: { name: "A" } }], messages: [{ id: "wamid.inline", from, timestamp: "1700000000", type: "text", text: { body: "nordvow nedir" } }] } }] }],
    });
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await receiveWebhook("meta", body, sign(body), { awaitProcessing: true });
    expect(result.accepted).toBe(true);
    const out = await prisma.message.findFirst({ where: { direction: "OUTBOUND" }, orderBy: { createdAt: "desc" } });
    expect(out?.body ?? "").toMatch(/Nordvow|platform/i);
    const logged = [...spy.mock.calls, ...warn.mock.calls].map((c) => JSON.stringify(c));
    expect(logged.some((line) => line.includes("guest") || line.includes("reply_sent"))).toBe(true);
    for (const line of logged) expect(line).not.toContain(from);
    spy.mockRestore();
    warn.mockRestore();
  });
});
