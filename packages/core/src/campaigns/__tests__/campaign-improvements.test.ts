import { describe, expect, it, vi } from "vitest";
import { cleanSocialHandle, formatSocialHandle, stripLeadingAt } from "../../social/handle";
import { draftChecks } from "../../domain/campaign-plan";
import { buildObjectiveTargets, sendConfirmedCampaignOffers } from "../../domain/campaign-draft";
import { assertSafeOutboundUrl, isPrivateIp } from "../../security/outbound-url";
import { extractProductFromUrl, parseProductHtml } from "../product-extractor";
import { generateAiCampaignBrief } from "../ai-brief";
import {
  rankInfluencersForCampaign,
  scoreInfluencerForCampaign,
  validateMatchReasons,
  type MatchCampaignInput,
  type MatchCandidateInput,
} from "../ai-matching";

describe("A5 — Sosyal Medya Kullanıcı Adı Normalizasyonu (@@ Önleme)", () => {
  it("baştaki tek veya çoklu @ işaretlerini temizler ve tek @ ile biçimler", () => {
    expect(stripLeadingAt("@@buketakdag_")).toBe("buketakdag_");
    expect(stripLeadingAt("@esinizginn")).toBe("esinizginn");
    expect(stripLeadingAt("damla")).toBe("damla");

    expect(formatSocialHandle("@@buketakdag_")).toBe("@buketakdag_");
    expect(formatSocialHandle("@esinizginn")).toBe("@esinizginn");
    expect(formatSocialHandle("damla")).toBe("@damla");
    expect(formatSocialHandle("")).toBe("");
    expect(formatSocialHandle(null)).toBe("");

    // İdempotent: tekrar uygulandığında asla @@ üretmez
    const once = formatSocialHandle("@@nordvow");
    const twice = formatSocialHandle(once);
    expect(once).toBe("@nordvow");
    expect(twice).toBe("@nordvow");
    expect(cleanSocialHandle("https://instagram.com/@buketakdag_/", "INSTAGRAM")).toBe("buketakdag_");
  });
});

describe("A2/A7 — Kampanya Planı, Başsız 'urun' Satırı ve Onaylı Teklif Koruması", () => {
  it("kargo gerektirmeyen kampanyada draftChecks içinde başıboş 'urun' satırı üretmez", () => {
    const checks = draftChecks({
      name: "Kış Kampanyası",
      objective: "satis",
      targetCountries: ["TR"],
      platforms: ["INSTAGRAM"],
      brandTotalFeeKurus: 1_500_000n,
      startsAt: new Date("2026-12-01"),
      endsAt: new Date("2026-12-31"),
      contentPlan: [{ platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "" }],
      briefCount: 1,
      mediaCount: 0,
      influencerCount: 0,
      includeShipping: false,
    });
    expect(checks.some((c) => c.key === "urun")).toBe(false);

    const withShipping = draftChecks({
      name: "Ürün Gönderimi",
      objective: "urun_gonderimi",
      targetCountries: ["TR"],
      platforms: ["INSTAGRAM"],
      brandTotalFeeKurus: 1_500_000n,
      startsAt: new Date("2026-12-01"),
      endsAt: new Date("2026-12-31"),
      contentPlan: [{ platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "" }],
      briefCount: 1,
      mediaCount: 0,
      influencerCount: 0,
      includeShipping: true,
    });
    expect(withShipping.some((c) => c.key === "urun")).toBe(true);
  });

  it("ana + ikincil hedef seçildiğinde KPI hedeflerini birleştirir", () => {
    const merged = buildObjectiveTargets("satis", "bilinirlik");
    const kpis = merged.map((t) => t.kpi);
    expect(kpis).toContain("sales");
    expect(kpis).toContain("click");
    expect(kpis).toContain("reach");
  });

  it("açık onay (confirmed: true) olmadan sunucu tarafında teklif gönderimini reddeder", async () => {
    await expect(
      sendConfirmedCampaignOffers(
        { userId: "u1", role: "BRAND", brandId: "b1" } as never,
        "camp1",
        { confirmed: false, influencerIds: ["inf1"] },
      ),
    ).rejects.toThrow(/açık onay/i);
  });
});

describe("B1 — Ürün Linki Çıkarıcı SSRF Koruması ve HTML Ayrıştırma", () => {
  it("özel IP, loopback, IMDS ve dahili alan adlarını engeller", async () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
    expect(isPrivateIp("169.254.169.254")).toBe(true);
    expect(isPrivateIp("10.0.0.5")).toBe(true);
    expect(isPrivateIp("172.16.0.1")).toBe(true);
    expect(isPrivateIp("192.168.1.10")).toBe(true);
    expect(isPrivateIp("::1")).toBe(true);
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true);
    expect(isPrivateIp("8.8.8.8")).toBe(false);

    const blockedUrls = [
      "http://localhost:3000/secret",
      "http://127.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data/",
      "https://10.0.0.1/internal",
      "https://service.internal/api",
      "file:///etc/passwd",
    ];
    for (const url of blockedUrls) {
      await expect(assertSafeOutboundUrl(url, { allowHttp: true })).rejects.toThrow();
      const res = await extractProductFromUrl(url);
      expect(res.fetched).toBe(false);
    }
  });

  it("OpenGraph ve JSON-LD ürün bilgilerini güvenle ayrıştırır", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="Kış Bakım Kremi 50ml" />
        <meta property="og:description" content="Soğuk havada yoğun nem desteği." />
        <meta property="og:image" content="/img/krem.jpg" />
        <script type="application/ld+json">
          {"@type":"Product","name":"Kış Bakım Kremi 50ml","offers":{"price":"450","priceCurrency":"TRY"}}
        </script>
      </head></html>
    `;
    const parsed = parseProductHtml(html, new URL("https://nordvowdemo.com/urun/krem"));
    expect(parsed.title).toBe("Kış Bakım Kremi 50ml");
    expect(parsed.priceText).toBe("450 TRY");
    expect(parsed.imageUrl).toBe("https://nordvowdemo.com/img/krem.jpg");
  });
});

describe("B3 — AI Brief Üretici (Mock Bedrock + Şema Doğrulama + Fallback)", () => {
  it("geçerli Bedrock structured çıktısında ROK ve md. 23/A kurallarını korur", async () => {
    const mockCaller = vi.fn().mockResolvedValue({
      model: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      rawText: "{}",
      data: {
        titleAlternatives: ["Kışın da Işılda", "Soğuk Havaya Karşı Bakım", "Günlük Kış Rutini"],
        mainMessage: "Soğuk havada cildini koruyan ürünü günlük rutininde doğal ışıkta göster.",
        dos: ["Ürünü ilk 3 saniyede göster", "Kodu ekranda okunaklı yaz"],
        donts: ["Rakip marka adı anma", "Abartılı filtre kullanma"],
        mandatoryDisclosure: "Reklam | @nordvowdemo",
        hashtags: ["kışbakımı", "#ciltbakımı"],
        contentPlan: [{ platform: "INSTAGRAM", contentType: "REELS", count: 1, notes: "15-30 sn" }],
        moodBoardPrompt: "minimalist winter skincare routine in natural daylight",
      },
    });

    const brief = await generateAiCampaignBrief(
      {
        brandName: "Nordvow Demo",
        brandHandle: "nordvowdemo",
        objective: "satis",
        sector: "kozmetik",
        platforms: ["INSTAGRAM"],
      },
      { structuredCaller: mockCaller },
    );

    expect(brief.source).toBe("bedrock");
    expect(brief.titleAlternatives).toHaveLength(3);
    expect(brief.hashtags).toContain("#reklam");
    expect(brief.mandatoryDisclosure).toContain("Reklam");
    expect(brief.donts.some((d) => /ROK/i.test(d))).toBe(true);
  });

  it("AI geçersiz JSON şeması dönerse hata fırlatmadan şablon fallback'e düşer", async () => {
    const brokenCaller = vi.fn().mockResolvedValue({
      model: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      rawText: "not valid",
      data: { titleAlternatives: [] }, // şema ihlali
    });

    const brief = await generateAiCampaignBrief(
      {
        brandName: "Nordvow Demo",
        objective: "satis",
        sector: "kozmetik",
        platforms: ["INSTAGRAM", "TIKTOK"],
      },
      { structuredCaller: brokenCaller },
    );

    expect(brief.source).toBe("template_fallback");
    expect(brief.contentPlan.length).toBeGreaterThanOrEqual(2);
    expect(brief.mandatoryDisclosure).toContain("23/A");
  });
});

describe("B4 — Deterministik AI Influencer Eşleştirme ve Gerekçe Doğrulama", () => {
  const campaign: MatchCampaignInput = {
    brandId: "b1",
    targetCountries: ["TR"],
    platforms: ["INSTAGRAM", "TIKTOK"],
    audienceInterests: ["güzellik", "cilt bakımı"],
    audienceGender: "kadin",
    audienceAgeMin: 18,
    audienceAgeMax: 34,
    budgetKurus: 1_500_000,
    currency: "TRY",
  };

  const verifiedCreator: MatchCandidateInput = {
    id: "inf_a",
    name: "Creator A",
    handle: "@@creator_a",
    category: "güzellik",
    country: "TR",
    city: "İstanbul",
    avatarUrl: null,
    platforms: ["INSTAGRAM", "TIKTOK"],
    followers: 85_000,
    er: 0.039,
    hasVerifiedApiAccount: true,
    demographics: { kadin: 0.62 },
    estimatedFeeKurus: 500_000,
    compliance23aRate: 1,
    past23aViolations: 0,
  };

  const unverifiedCreator: MatchCandidateInput = {
    id: "inf_b",
    name: "Creator B",
    handle: "creator_b",
    category: "güzellik",
    country: "TR",
    city: "Ankara",
    avatarUrl: null,
    platforms: ["INSTAGRAM"],
    followers: 85_000,
    er: 0.039,
    hasVerifiedApiAccount: false,
    demographics: null,
    estimatedFeeKurus: 2_500_000, // bütçe üstü
    past23aViolations: 2,
    competitorConflictBrand: "Rakip Kozmetik",
  };

  it("doğrulanmış veriye sahip ve bütçeye uyan creator'ı üstte sıralar, doğrulamasızda kitle skoru null kalır", () => {
    const ranked = rankInfluencersForCampaign(campaign, [unverifiedCreator, verifiedCreator]);
    expect(ranked[0]!.id).toBe("inf_a");
    expect(ranked[0]!.handle).toBe("creator_a");
    expect(ranked[0]!.audienceQualityScore).not.toBeNull();
    expect(ranked[0]!.reasons.length).toBeLessThanOrEqual(3);
    expect(ranked[0]!.overBudget).toBe(false);

    expect(ranked[1]!.id).toBe("inf_b");
    expect(ranked[1]!.audienceQualityScore).toBeNull();
    expect(ranked[1]!.overBudget).toBe(true);
    expect(ranked[1]!.brandSafetyWarnings.length).toBeGreaterThanOrEqual(2);
  });

  it("gerekçe doğrulayıcı veritabanında olmayan uydurma rakamları reddeder", () => {
    const scored = scoreInfluencerForCampaign(campaign, verifiedCreator);
    const allowedNumbers = [verifiedCreator.followers, verifiedCreator.er!, 0.62, 62];
    expect(validateMatchReasons(scored.reasons, allowedNumbers).valid).toBe(true);

    const fakeCheck = validateMatchReasons(["Kitlesinin %88'i 18-34 kadın ve aylık 450.000 satış yapıyor"], allowedNumbers);
    expect(fakeCheck.valid).toBe(false);
    expect(fakeCheck.rejected.length).toBeGreaterThan(0);
  });
});

