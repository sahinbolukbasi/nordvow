import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { handleGuest } from "../src/bot/guest";
import { autoLinkSender, consumeLinkCode, issueLinkCode } from "../src/bot/link";
import { hashLinkCode, LINK_CODE_TTL_MS } from "../src/bot/tokens";
import { DomainError } from "../src/domain/errors";
import { resetDb } from "./helpers";

describe("bağlama kodu", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("kodu hash olarak tutar, bir kez kullanılır ve süresi dolunca reddedilir", async () => {
    const user = await prisma.user.create({ data: { email: "code@ex.com", name: "Kod", role: "INFLUENCER", passwordHash: "x", status: "ACTIVE" } });
    const now = new Date("2026-11-14T12:00:00Z");
    const code = await issueLinkCode(user.id, now);
    const row = await prisma.botLinkCode.findFirstOrThrow({ where: { userId: user.id, usedAt: null } });
    expect(row.codeHash).toBe(hashLinkCode(code));
    expect(row.codeHash).not.toBe(code);
    expect(JSON.stringify(row)).not.toContain(code);

    await consumeLinkCode(code, "WHATSAPP", "5320000001", now);
    const used = await prisma.botLinkCode.findUniqueOrThrow({ where: { id: row.id } });
    expect(used.usedAt).not.toBeNull();
    await expect(consumeLinkCode(code, "WHATSAPP", "5320000002", now)).rejects.toBeInstanceOf(DomainError);

    const later = await issueLinkCode(user.id, now);
    await expect(consumeLinkCode(later, "INSTAGRAM", "ig-1", new Date(now.getTime() + LINK_CODE_TTL_MS + 1000))).rejects.toBeInstanceOf(DomainError);
  });

  it("beş yanlış denemeden sonra doğru kodu da kabul etmez", async () => {
    const user = await prisma.user.create({ data: { email: "lock@ex.com", name: "Kilit", role: "BRAND", passwordHash: "x", status: "ACTIVE" } });
    const now = new Date("2026-11-14T13:00:00Z");
    const code = await issueLinkCode(user.id, now);
    for (let i = 0; i < 5; i++) await expect(consumeLinkCode("000000", "MESSENGER", "psid-lock", now)).rejects.toBeInstanceOf(DomainError);
    await expect(consumeLinkCode(code, "MESSENGER", "psid-lock", now)).rejects.toBeInstanceOf(DomainError);
    const events = await prisma.botLinkEvent.findMany({ where: { externalId: "psid-lock" } });
    expect(events.some((e) => e.action === "LOCKOUT")).toBe(true);
    expect(events.some((e) => e.action === "LINK")).toBe(false);
  });

  it("aynı telefon iki hesapta ise bağlamaz", async () => {
    await prisma.user.create({ data: { email: "p1@ex.com", name: "Bir", role: "INFLUENCER", phone: "+905320009900", passwordHash: "x", status: "ACTIVE" } });
    await prisma.user.create({ data: { email: "p2@ex.com", name: "Iki", role: "INFLUENCER", phone: "05320009900", passwordHash: "x", status: "ACTIVE" } });
    const result = await autoLinkSender("WHATSAPP", "905320009900", "905320009900");
    expect(result.ok).toBe(false);
    expect(await prisma.channelAccountLink.count({ where: { externalId: "5320009900" } })).toBe(0);
  });
});

describe("bağsız gönderici talebi", () => {
  it("bilgi verir, talep toplar, tekrarlamaz ve hesap aracı çağırmaz", async () => {
    const sender = { channel: "WHATSAPP" as const, externalId: "5321110099", phone: "905321110099" };
    const hello = await handleGuest({ ...sender, text: "nordvow nedir" });
    expect(hello).toMatch(/platform/i);
    expect(hello).toMatch(/kayit/i);
    expect(hello).not.toMatch(/bakiye|iban|kupon/i);

    await handleGuest({ ...sender, text: "talep" });
    await handleGuest({ ...sender, text: "Ayse Yilmaz" });
    await handleGuest({ ...sender, text: "influencer olarak katılmak istiyorum" });
    await handleGuest({ ...sender, text: "yok" });
    await handleGuest({ ...sender, text: "@ayse" });
    const done = await handleGuest({ ...sender, text: "kampanyalara bakmak istiyorum" });
    expect(done).toBe("Bilgilerinizi aldık, ekibimiz sizinle iletişime geçecek.");
    const again = await handleGuest({ ...sender, text: "talep" });
    expect(again).toBe(done);
    expect(await prisma.botLead.count({ where: { externalId: sender.externalId } })).toBe(1);
    const lead = await prisma.botLead.findFirstOrThrow({ where: { externalId: sender.externalId } });
    expect(lead.status).toBe("YENI");
    expect(lead.intent).toBe("INFLUENCER");
    expect(lead.phone).toBe("905321110099");
    expect(lead.email).toBeNull();
  });
});
