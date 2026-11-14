import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { claimCoupon, toolBalance } from "../src/bot/tools";
import { linkChannel, linkWhatsAppByPhone } from "../src/bot/link";
import { matchMenu } from "../src/bot/menu";
import { planOutbound } from "../src/bot/window-plan";
import { phonesMatch, rateAllows, signAccountLink, verifyAccountLink } from "../src/bot/tokens";
import { BOT_TOOLS } from "../src/bot/registry";
import { makeTenant, resetDb } from "./helpers";

describe("bot menü, pencere, imza", () => {
  it("menü anahtar kelimeleri LLM olmadan eşleşir", () => {
    expect(matchMenu("Kampanyalarım")).toBe("campaigns");
    expect(matchMenu("bakiyem")).toBe("balance");
    expect(matchMenu("temsilci")).toBe("handoff");
    expect(matchMenu("insan")).toBe("handoff");
    expect(matchMenu("EVET")).toBe("yes");
    expect(matchMenu("events")).toBe("events");
  });

  it("kapalı pencerede serbest metin yerine template veya blok döner", () => {
    const wa = planOutbound({ channel: "WHATSAPP", windowOpen: false, body: "merhaba" });
    expect(wa.mode).toBe("template");
    const open = planOutbound({ channel: "WHATSAPP", windowOpen: true, body: "merhaba" });
    expect(open.mode).toBe("text");
    const ig = planOutbound({ channel: "INSTAGRAM", windowOpen: false, body: "merhaba" });
    expect(ig.mode).toBe("blocked");
  });

  it("sihirli bağlantı süresi ve imzası", () => {
    const token = signAccountLink({ externalId: "ig1", channel: "INSTAGRAM" }, 1000, 1_000);
    expect(verifyAccountLink(token, 1_500)?.externalId).toBe("ig1");
    expect(verifyAccountLink(token, 5_000)).toBeNull();
    expect(verifyAccountLink(`${token}x`, 1_500)).toBeNull();
  });

  it("telefon eşleşmesi ve hız sınırı", () => {
    expect(phonesMatch("+90 532 111 22 33", "05321112233")).toBe(true);
    expect(phonesMatch("+905321112233", "+905309998877")).toBe(false);
    expect(rateAllows(4)).toBe(true);
    expect(rateAllows(5)).toBe(false);
  });

  it("hassas araçlar onay ister", () => {
    expect(BOT_TOOLS.claim_coupon.confirm).toBe(true);
    expect(BOT_TOOLS.reserve_ticket.confirm).toBe(true);
    expect(BOT_TOOLS.create_short_link.confirm).toBe(true);
    expect(BOT_TOOLS.balance.confirm).toBe(false);
  });
});

describe("bot bağlama ve kapsam", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("WhatsApp telefonu tek hesaba bağlar; başkasının bakiyesini okumaz", async () => {
    const a = await prisma.user.create({ data: { email: "bot-a@ex.com", name: "Ayse", role: "INFLUENCER", phone: "+905321110001", passwordHash: "x", status: "ACTIVE" } });
    const infA = await prisma.influencer.create({ data: { name: "Ayse", category: "moda", iban: "TR110000000000000000000011", ibanHolder: "Ayse", taxStatus: "STOPAJLI", canIssueInvoice: false } });
    await prisma.user.update({ where: { id: a.id }, data: { influencerId: infA.id } });
    const b = await prisma.user.create({ data: { email: "bot-b@ex.com", name: "Berk", role: "INFLUENCER", phone: "+905321110002", passwordHash: "x", status: "ACTIVE" } });
    const infB = await prisma.influencer.create({ data: { name: "Berk", category: "moda", iban: "TR220000000000000000000022", ibanHolder: "Berk", taxStatus: "STOPAJLI", canIssueInvoice: false } });
    await prisma.user.update({ where: { id: b.id }, data: { influencerId: infB.id } });
    await prisma.ledgerEntry.create({ data: { txId: "tx-bot-b", influencerId: infB.id, account: "INFLUENCER_PAYABLE", direction: "CREDIT", amountKurus: 250_000, reason: "HAKEDIS", referenceType: "Deliverable", referenceId: "d-bot" } });

    const linked = await linkWhatsAppByPhone("05321110001");
    expect(linked.ok && linked.userId).toBe(a.id);
    const ctxA = { id: a.id, role: "INFLUENCER" as const, brandId: null, influencerId: infA.id, name: "Ayse", email: a.email, phone: a.phone };
    const text = await toolBalance(ctxA, "tr");
    expect(text).not.toContain("TR220000000000000000000022");
    expect(text).not.toContain("TR110000000000000000000011");
    expect(text).toContain("0011");

    const brand = await makeTenant("Bot Marka");
    await linkChannel({ channel: "INSTAGRAM", externalId: "ig-b", userId: b.id });
    const coupon = await prisma.coupon.create({ data: { tenantId: brand.tenantId, title: "Gizli", valueType: "YUZDE", value: 10, status: "YAYINDA" } });
    await prisma.couponGrant.create({ data: { couponId: coupon.id, influencerId: infB.id, code: "KPN-SECRET-B" } });
    const claimed = await claimCoupon(ctxA, "tr");
    expect(claimed).not.toContain("KPN-SECRET-B");
  });
});
