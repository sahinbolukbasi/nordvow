import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { countOpenFindings } from "../src/agents/catalog";
import { parseMetaSignedRequest, signMetaRequest } from "../src/channels/meta-signed-request";
import { metaSubscriptionChallenge } from "../src/channels/meta-hub";
import { couponDisplayStatus, createCoupon, expirePublishedCoupons, grantCoupon, setCouponStatus } from "../src/coupons/service";
import { metaEventDate } from "../src/messaging/meta-time";
import { assertAllowedTarget, createShortLink, resolveAndCount } from "../src/notify/shortlink";
import { DomainError } from "../src/domain/errors";
import { makeTenant, resetDb } from "./helpers";

describe("saf yardımcılar", () => {
  it("10 hane saniye, 13 hane milisaniye", () => {
    const sec = 1_700_000_000;
    expect(metaEventDate(String(sec)).getTime()).toBe(sec * 1000);
    expect(metaEventDate(sec * 1000).getTime()).toBe(sec * 1000);
  });

  it("kupon görünen durumu: süre yayından önce gelir", () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    expect(couponDisplayStatus("YAYINDA", past).key).toBe("suresi_doldu");
    expect(couponDisplayStatus("YAYINDA", future).label).toBe("Yayında");
    expect(couponDisplayStatus("TASLAK", null).key).toBe("taslak");
  });

  it("kısa link yalnız https ve izinli host", () => {
    expect(assertAllowedTarget("https://nordvow.com/a")).toContain("https://nordvow.com/a");
    expect(assertAllowedTarget("https://www.nordvow.com/a")).toContain("www.nordvow.com");
    expect(() => assertAllowedTarget("http://nordvow.com/a")).toThrow(DomainError);
    expect(() => assertAllowedTarget("https://evil.example/phish")).toThrow(DomainError);
    expect(() => assertAllowedTarget("https://user:pass@nordvow.com/a")).toThrow(DomainError);
  });

  it("Meta signed_request doğrulanır, bozuk imza reddedilir", () => {
    const signed = signMetaRequest({ user_id: "42" }, "secret");
    expect(parseMetaSignedRequest(signed, "secret")?.user_id).toBe("42");
    expect(parseMetaSignedRequest(signed, "yanlis")).toBeNull();
    expect(parseMetaSignedRequest("aa.bb", "secret")).toBeNull();
  });

  it("webhook GET challenge yalnız doğru token ile döner", () => {
    expect(metaSubscriptionChallenge({ mode: "subscribe", verifyToken: "tok", challenge: "ch" }, "tok")).toBe("ch");
    expect(metaSubscriptionChallenge({ mode: "subscribe", verifyToken: "no", challenge: "ch" }, "tok")).toBeNull();
    expect(metaSubscriptionChallenge({ mode: "subscribe", verifyToken: "tok", challenge: "ch" }, undefined)).toBeNull();
  });
});

describe("kiracı ve sayaç", () => {
  beforeAll(async () => {
    await resetDb();
  });

  it("başka markanın kuponu gönderilemez", async () => {
    const a = await makeTenant("A");
    const b = await makeTenant("B");
    const c = await createCoupon({ tenantId: b.tenantId, kind: "KUPON", title: "B kuponu", valueType: "YUZDE", value: 10 });
    await setCouponStatus(b.tenantId, c.id, "YAYINDA");
    const user = await prisma.user.create({ data: { email: `g-${Date.now()}@ex.com`, name: "G", role: "INFLUENCER", passwordHash: "x" } });
    const inf = await prisma.influencer.create({ data: { name: "G", category: "moda", iban: "TR000000000000000000000000", ibanHolder: "G", taxStatus: "STOPAJLI", canIssueInvoice: false, user: { connect: { id: user.id } } } });
    await expect(grantCoupon(c.id, inf.id, a.tenantId)).rejects.toBeInstanceOf(DomainError);
    const ok = await grantCoupon(c.id, inf.id, b.tenantId);
    expect(ok.couponId).toBe(c.id);
  });

  it("süresi dolan yayındaki kupon pasife alınır", async () => {
    const a = await makeTenant("Sure");
    const c = await createCoupon({ tenantId: a.tenantId, kind: "KUPON", title: "Eski", valueType: "YUZDE", value: 5, validUntil: new Date(Date.now() - 1000) });
    await setCouponStatus(a.tenantId, c.id, "YAYINDA");
    expect(await expirePublishedCoupons()).toBeGreaterThanOrEqual(1);
    const row = await prisma.coupon.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.status).toBe("PASIF");
  });

  it("açık bulgu sayımı önem kırılımı verir", async () => {
    const base = { targetType: "X", targetId: "1", checkType: "BRIEF_UYUM" as const, findings: [], summary: "s", model: "m", promptVersion: "1", status: "ACIK" as const };
    await prisma.agentRun.create({ data: { ...base, severity: "KRITIK", idempotencyKey: `k-${Date.now()}-1` } });
    await prisma.agentRun.create({ data: { ...base, severity: "UYARI", idempotencyKey: `k-${Date.now()}-2` } });
    await prisma.agentRun.create({ data: { ...base, severity: "BILGI", idempotencyKey: `k-${Date.now()}-3` } });
    await prisma.agentRun.create({ data: { ...base, severity: "BILGI", status: "ONAYLANDI", idempotencyKey: `k-${Date.now()}-4` } });
    const c = await countOpenFindings();
    expect(c.kritik).toBeGreaterThanOrEqual(1);
    expect(c.uyari).toBeGreaterThanOrEqual(1);
    expect(c.bilgi).toBeGreaterThanOrEqual(1);
    expect(c.uyarilar).toBe(c.kritik + c.uyari);
    expect(c.total).toBe(c.kritik + c.uyari + c.bilgi);
  });

  it("izin dışı kayıtlı hedef çözülmez", async () => {
    await prisma.shortLink.create({ data: { slug: "eskihedef", targetUrl: "https://evil.example/x", label: "eski" } });
    expect(await resolveAndCount("eskihedef")).toBeNull();
    const link = await createShortLink("https://app.nordvow.com/p");
    expect(await resolveAndCount(link.slug)).toContain("app.nordvow.com");
  });
});
