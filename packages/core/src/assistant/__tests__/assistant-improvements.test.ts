import { describe, expect, it } from "vitest";
import { classifyAssistantIntent, normalizeTurkishForIntent } from "../intent-router";
import { detectInternalLeaks, findFabricatedFacts, stripInternalLeaks, validateAssistantOutput } from "../output-validator";
import { isPathAllowedByRobots } from "../seeder";
import { loadDefaultEvalDataset, runAssistantEval } from "../eval/runner";
import { AGENT_TEMPLATES } from "../catalog";

describe("AI Asistan — Ortak Niyet Yönlendirici (Metin + Sesli)", () => {
  it("Türkçe büyük/küçük İ/ı harflerini tutarlı normalleştirir", () => {
    expect(normalizeTurkishForIntent("İADE yapmak istiyorum")).toContain("iade");
    expect(normalizeTurkishForIntent("IADE süresi")).toContain("iade");
  });

  it("fiyat, kargo, basvuru, kampanya_durumu, iade ve sikayet niyetlerini doğru ayırır", () => {
    expect(classifyAssistantIntent("Kampanya fiyatlarınız ne kadar?").intent).toBe("fiyat");
    expect(classifyAssistantIntent("Kargom nerede?").intent).toBe("kargo");
    expect(classifyAssistantIntent("kargom nrde 3 gündür gelmedi").intent).toBe("kargo");
    expect(classifyAssistantIntent("Influencer olarak nasıl başvururum?").intent).toBe("basvuru");
    expect(classifyAssistantIntent("Teklifime ne zaman dönüş olur?").intent).toBe("kampanya_durumu");
    expect(classifyAssistantIntent("İADE yapmak istiyorum").intent).toBe("iade");

    const complaint = classifyAssistantIntent("Ürün bozuk geldi, rezalet!");
    expect(complaint.intent).toBe("sikayet");
    expect(complaint.alwaysHandoff).toBe(true);
  });

  it("kargo sorusunda takip numarasını yakalar veya eksikliğini işaretler", () => {
    const withoutCode = classifyAssistantIntent("Kargom nerede?");
    expect(withoutCode.needsOrderNumber).toBe(true);
    expect(withoutCode.extractedOrderCode).toBeNull();

    const withCode = classifyAssistantIntent("Kargom SIP-994411 nerede kaldı?");
    expect(withCode.needsOrderNumber).toBe(false);
    expect(withCode.extractedOrderCode).toBe("994411");
  });

  it("kişiye özel kurumsal fiyat talebinde temsilci aktarımı işaretler", () => {
    const res = classifyAssistantIntent("Bize özel kurumsal fiyat teklifi alabilir miyiz?");
    expect(res.intent).toBe("fiyat");
    expect(res.needsCustomQuote).toBe(true);
    expect(res.alwaysHandoff).toBe(true);
  });
});

describe("AI Asistan — Çıktı Doğrulayıcı (Sızıntı ve Halüsinasyon Koruması)", () => {
  it("geliştirici iç terimlerinin müşteriye sızmasını yakalar ve temizler", () => {
    const leaked = "Hesabınızı bağlamak için link_account intent'ini kullanarak devam edebilirsiniz.";
    const leaks = detectInternalLeaks(leaked);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks).toContain("link_account");

    const sanitized = stripInternalLeaks(leaked);
    expect(detectInternalLeaks(sanitized)).toHaveLength(0);
  });

  it("bilgi tabanında olmayan fiyat, tarih ve kupon kodlarını uydurma olarak reddeder", () => {
    const allowedContext = "Başlangıç paketimiz 15.000 TL'dir. Aktif kupon kodu KIS20 olup 31.12.2026 tarihine kadar geçerlidir.";

    const grounded = validateAssistantOutput(
      "Başlangıç paketimiz 15.000 TL olup KIS20 kodu 31.12.2026 tarihine kadar geçerlidir.",
      allowedContext,
    );
    expect(grounded.ok).toBe(true);
    expect(grounded.fabricatedValues).toHaveLength(0);

    const hallucinated = findFabricatedFacts(
      "Kampanya paketimiz 9.999 TL ve SAHTE50 kuponu 15.01.2027 tarihine kadar geçerli.",
      allowedContext,
    );
    expect(hallucinated.length).toBeGreaterThanOrEqual(3);
  });

  it("katalog şablonlarında kullanıcıya sızabilecek teknik '(RAG)' veya internal intent metni yoktur", () => {
    for (const tpl of AGENT_TEMPLATES) {
      expect(tpl.description).not.toMatch(/\(RAG\)/i);
      expect(detectInternalLeaks(tpl.description)).toHaveLength(0);
    }
    const keys = AGENT_TEMPLATES.map((t) => t.key);
    expect(keys).toContain("brand_faq");
    expect(keys).toContain("influencer_assistant");
  });
});

describe("AI Asistan — robots.txt Uyumu ve Türkçe Eval Seti", () => {
  it("robots.txt Disallow kurallarına saygı gösterir", () => {
    const robots = "User-agent: *\nDisallow: /admin\nDisallow: /private/\n";
    expect(isPathAllowedByRobots(robots, "/sss")).toBe(true);
    expect(isPathAllowedByRobots(robots, "/kargo")).toBe(true);
    expect(isPathAllowedByRobots(robots, "/admin/secret")).toBe(false);
    expect(isPathAllowedByRobots(robots, "/private/doc")).toBe(false);
  });

  it("en az 30 Türkçe soruluk değerlendirme setinde tüm kalite eşiklerini geçer", () => {
    const dataset = loadDefaultEvalDataset();
    expect(dataset.cases.length).toBeGreaterThanOrEqual(30);

    const report = runAssistantEval(dataset);
    expect(report.passed).toBe(true);
    expect(report.intentAccuracy).toBeGreaterThanOrEqual(dataset.thresholds.minIntentAccuracy);
    expect(report.fabricatedNumberCount).toBe(0);
    expect(report.internalLeakCount).toBe(0);
  });
});

