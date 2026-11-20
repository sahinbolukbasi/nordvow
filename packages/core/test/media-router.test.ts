import { describe, expect, it } from "vitest";
import { calculateMediaCost, CREDIT_VALUE_USD } from "../src/media-router/pricing-engine";
import { computePromptHash } from "../src/media-router/caching";
import { MEDIA_MODEL_SEEDS } from "../src/media-router/seeds";

describe("Nordvow Media Router & Pricing Engine", () => {
  it("hesaplar: 1 Nordvow Kredisi = $0.01 değerindedir", () => {
    expect(CREDIT_VALUE_USD).toBe(0.01);
  });

  it("hesaplar: Görsel/Ses için Yüklenmiş Maliyet çarpanı 1.15 olmalıdır", () => {
    const result = calculateMediaCost({
      alias: "draft-image",
      officialCostUsd: 0.003,
      isMediaVideoOrAvatar: false,
    });

    expect(result.loadedMultiplier).toBe(1.15);
    expect(result.loadedCostUsd).toBeCloseTo(0.003 * 1.15, 5);
    expect(result.grossMarginPercentage).toBeGreaterThanOrEqual(55);
  });

  it("hesaplar: Video/Avatar için Yüklenmiş Maliyet çarpanı 1.30 olmalıdır", () => {
    const result = calculateMediaCost({
      alias: "mid-video",
      officialCostUsd: 0.06,
      isMediaVideoOrAvatar: true,
      units: 5, // 5 saniye
    });

    expect(result.loadedMultiplier).toBe(1.30);
    // 5 * 0.06 = 0.30 -> 0.30 * 1.30 = 0.39 USD loaded cost
    expect(result.loadedCostUsd).toBeCloseTo(0.39, 4);
    expect(result.requiredCredits).toBeGreaterThanOrEqual(100);
  });

  it("önbellek: computePromptHash aynı girdiler için deterministik hash üretir", () => {
    const hash1 = computePromptHash({
      alias: "mid-image",
      prompt: "A sleek modern perfume bottle on marble pedestal",
      negativePrompt: "blurry, low quality",
      parameters: { aspectRatio: "1:1" },
    });

    const hash2 = computePromptHash({
      alias: "mid-image",
      prompt: "   A sleek modern perfume bottle on marble pedestal   ",
      negativePrompt: "blurry, low quality",
      parameters: { aspectRatio: "1:1" },
    });

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex string
  });

  it("anayasa kontrolü: Kullanımdan kalkan modeller (OpenAI Sora 2, gpt-image-1.5, eski Gemini 2.5 Flash Image) seed listesinde kesinlikle OLMAMALIDIR", () => {
    const disallowedNames = ["sora-2", "gpt-image-1.5", "gemini-2.5-flash-image", "sora"];
    for (const seed of MEDIA_MODEL_SEEDS) {
      for (const disallowed of disallowedNames) {
        expect(seed.primaryModelId.toLowerCase()).not.toContain(disallowed);
        if (seed.fallbackModelId) {
          expect(seed.fallbackModelId.toLowerCase()).not.toContain(disallowed);
        }
      }
    }
  });

  it("sağlayıcı optimizasyonu: Nano Banana 2.1 doğrudan Google API'ye yönlenmelidir", () => {
    const nanoBanana = MEDIA_MODEL_SEEDS.find((s) => s.alias === "mid-image");
    expect(nanoBanana).toBeDefined();
    expect(nanoBanana?.primaryProviderId).toBe("google");
    expect(nanoBanana?.creditPrice).toBe(12.0);
  });
});

