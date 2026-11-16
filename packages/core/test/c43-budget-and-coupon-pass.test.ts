import { describe, expect, it } from "vitest";
import { decideCouponPassAccess, visibleSharedCode } from "../src/coupons/pass-access";
import { DomainError } from "../src/domain/errors";
import { assertCampaignAmountKurus, assertFeeKurus, MAX_CAMPAIGN_AMOUNT_KURUS, MAX_FEE_KURUS } from "../src/domain/money";

describe("kampanya tutar tavanı", () => {
  it("100.000.000,00 kabul, bir kuruş fazlası ve milyarlık giriş reddedilir", () => {
    expect(assertCampaignAmountKurus(0, "Bütçe")).toBe(0);
    expect(assertCampaignAmountKurus(MAX_CAMPAIGN_AMOUNT_KURUS, "Bütçe")).toBe(MAX_CAMPAIGN_AMOUNT_KURUS);
    expect(() => assertCampaignAmountKurus(MAX_CAMPAIGN_AMOUNT_KURUS + 1, "Toplam bütçe")).toThrow(DomainError);
    expect(() => assertCampaignAmountKurus(MAX_CAMPAIGN_AMOUNT_KURUS + 1, "Toplam bütçe")).toThrow(/100\.000\.000,00/);
    // Canlıda görülen ₺4.357.453.453
    expect(() => assertCampaignAmountKurus(435_745_345_300, "Bütçe")).toThrow(/100\.000\.000,00/);
    expect(() => assertCampaignAmountKurus(-1, "Bütçe")).toThrow(/negatif/);
    expect(() => assertCampaignAmountKurus(Number.NaN, "Bütçe")).toThrow(DomainError);
  });

  it("feeKurus 32 bit sınırı aşılırsa yazılmadan reddedilir", () => {
    expect(assertFeeKurus(1, "Influencer bedeli", 1)).toBe(1);
    expect(assertFeeKurus(MAX_FEE_KURUS, "Influencer bedeli", 1)).toBe(MAX_FEE_KURUS);
    expect(assertFeeKurus(0, "Ajans komisyonu")).toBe(0);
    expect(() => assertFeeKurus(MAX_FEE_KURUS + 1, "Influencer bedeli", 1)).toThrow(/21\.474\.836,47/);
    expect(() => assertFeeKurus(10_000_000_000, "Influencer bedeli", 1)).toThrow(DomainError);
    expect(() => assertFeeKurus(0, "Influencer bedeli", 1)).toThrow(DomainError);
  });
});

describe("kupon PDF yetkisi", () => {
  const shared = "ORTAK50";

  it("şablon kimliği oturumsuz veya başka markada paylaşılan kodu açmaz", () => {
    const template = { kind: "template" as const, tenantId: "marka-a" };
    const anon = decideCouponPassAccess(template, null);
    expect(anon).toEqual({ allow: false, status: 401 });
    expect(visibleSharedCode(shared, anon)).toBeNull();

    const other = decideCouponPassAccess(template, { role: "BRAND", brandId: "marka-b" });
    expect(other).toEqual({ allow: false, status: 403 });
    expect(visibleSharedCode(shared, other)).toBeNull();

    const influencer = decideCouponPassAccess(template, { role: "INFLUENCER", brandId: null });
    expect(influencer.allow).toBe(false);
    expect(visibleSharedCode(shared, influencer)).toBeNull();
  });

  it("şablonu kendi markası ve yönetici görür", () => {
    const template = { kind: "template" as const, tenantId: "marka-a" };
    const brand = decideCouponPassAccess(template, { role: "BRAND", brandId: "marka-a" });
    expect(brand.allow).toBe(true);
    expect(visibleSharedCode(shared, brand)).toBe(shared);

    const admin = decideCouponPassAccess(template, { role: "ADMIN", brandId: null });
    expect(visibleSharedCode(shared, admin)).toBe(shared);
    expect(decideCouponPassAccess(template, { role: "AGENCY" }).allow).toBe(true);
  });

  it("gönderim bağlantısı alıcı kodunu oturumsuz açar; olmayan kayıt 404", () => {
    const grant = decideCouponPassAccess({ kind: "grant", tenantId: "marka-a" }, null);
    expect(grant.allow).toBe(true);
    expect(visibleSharedCode(shared, grant)).toBe(shared);
    expect(visibleSharedCode("  ", grant)).toBeNull();
    expect(decideCouponPassAccess({ kind: "missing" }, { role: "ADMIN" })).toEqual({ allow: false, status: 404 });
  });
});
