import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfigFindMany, mockConnFindMany, mockVaultGet, mockSdkCall, mockAssertSafeOutboundUrl } = vi.hoisted(() => ({
  mockConfigFindMany: vi.fn(),
  mockConnFindMany: vi.fn(),
  mockVaultGet: vi.fn(),
  mockSdkCall: vi.fn(),
  mockAssertSafeOutboundUrl: vi.fn(async (raw: string) => new URL(raw)),
}));

vi.mock("../src/db", () => ({
  prisma: {
    configValue: { findMany: mockConfigFindMany },
    channelConnection: { findMany: mockConnFindMany },
  },
}));

vi.mock("../src/channels/vault", () => ({
  vault: () => ({ get: mockVaultGet }),
}));

vi.mock("../src/security/outbound-url", () => ({
  assertSafeOutboundUrl: mockAssertSafeOutboundUrl,
}));

vi.mock("facebook-nodejs-business-sdk", () => ({
  FacebookAdsApi: class {
    static SDK_VERSION = "24.0.0";
    call = mockSdkCall;
  },
  IGUser: class {},
  IGMedia: class {},
}));

import { fetchVerifiedInstagramViaSdk, resolveMetaSdkCredentials } from "../src/social/meta-business-sdk";
import { parseCompactCount, parsePublicInstagramHtml } from "../src/social/instagram-public";

describe("Meta Business Discovery credential pairing and fallback", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...origEnv };
    delete process.env.IG_BUSINESS_ACCOUNT_ID;
    delete process.env.INSTAGRAM_IG_USER_ID;
    delete process.env.META_SYSTEM_USER_TOKEN;
    delete process.env.IG_GRAPH_TOKEN;
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    delete process.env.META_IG_TOKEN;
    delete process.env.META_APP_SECRET;
    delete process.env.INSTAGRAM_PUBLIC_FALLBACK_URL;
    delete process.env.INSTAGRAM_PUBLIC_FALLBACK_API_KEY;
  });

  afterEach(() => {
    process.env = origEnv;
    vi.unstubAllGlobals();
  });

  it("pairs ChannelConnection ig_user_id with its own EAA token and skips IGAA connections", async () => {
    mockConfigFindMany.mockResolvedValue([]);
    mockConnFindMany.mockResolvedValue([
      { externalIds: { ig_user_id: "ig_igaa_only" }, tokenRef: "ref_igaa" },
      { externalIds: { ig_user_id: "ig_valid_conn" }, tokenRef: "ref_eaa" },
    ]);
    mockVaultGet.mockImplementation(async (ref: string) =>
      ref === "ref_igaa" ? "IGAA_token_123" : ref === "ref_eaa" ? "EAA_token_valid" : null,
    );

    const creds = await resolveMetaSdkCredentials();
    expect(creds.pairs).toEqual([{ igId: "ig_valid_conn", token: "EAA_token_valid" }]);
  });

  it("does not abort on first pair 110/2207013 error and succeeds on subsequent valid pair", async () => {
    process.env.IG_BUSINESS_ACCOUNT_ID = "ig_primary";
    process.env.META_SYSTEM_USER_TOKEN = "EAA_primary";

    mockConfigFindMany.mockResolvedValue([]);
    mockConnFindMany.mockResolvedValue([
      { externalIds: { ig_user_id: "ig_secondary" }, tokenRef: "ref_secondary" },
    ]);
    mockVaultGet.mockResolvedValue("EAA_secondary");

    let sdkCallCount = 0;
    mockSdkCall.mockImplementation(async () => {
      sdkCallCount++;
      if (sdkCallCount === 1) {
        throw {
          response: { error: { code: 110, error_subcode: 2207013, message: "Invalid user id" } },
        };
      }
      return {
        business_discovery: {
          id: "17841400000001",
          username: "some_creator_",
          name: "Some Creator",
          followers_count: 42500,
          follows_count: 310,
          media_count: 120,
          media: { data: [] },
        },
      };
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 110, error_subcode: 2207013, message: "Invalid user id" } }),
      }),
    );

    const res = await fetchVerifiedInstagramViaSdk({ handle: "some_creator_" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("meta_sdk_business_discovery");
    expect(res.username).toBe("some_creator_");
    expect(res.followers).toBe(42500);
    expect(mockSdkCall).toHaveBeenCalledTimes(2);
  });

  it("falls back to public OpenGraph preview when Meta Business Discovery returns 110/2207013", async () => {
    process.env.IG_BUSINESS_ACCOUNT_ID = "ig_primary";
    process.env.META_SYSTEM_USER_TOKEN = "EAA_primary";
    mockConfigFindMany.mockResolvedValue([]);
    mockConnFindMany.mockResolvedValue([]);

    mockSdkCall.mockRejectedValue({
      response: { error: { code: 110, error_subcode: 2207013, message: "Cannot find User" } },
    });

    const sampleHtml = `<!doctype html><html><head>
      <meta property="og:image" content="https://scontent.cdninstagram.com/avatar.jpg?a=1&amp;b=2" />
      <meta property="og:title" content="Buket Akda&#x11f; (&#064;buketakdag_) &#x2022; Instagram photos and videos" />
      <meta property="og:description" content="466K Followers, 3,837 Following, 1,531 Posts - See Instagram photos and videos from Buket Akda&#x11f; (&#064;buketakdag_)" />
      <meta name="description" content="466K Followers, 3,837 Following, 1,531 Posts - Buket Akda&#x11f; (&#064;buketakdag_) on Instagram: &quot;Projeler: buket&#064;buketakdag.net&quot;" />
    </head></html>`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL) => {
        const s = String(url);
        if (s.includes("graph.facebook.com")) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: { code: 110, error_subcode: 2207013, message: "Cannot find User" } }),
          };
        }
        return {
          ok: true,
          status: 200,
          text: async () => sampleHtml,
        };
      }),
    );

    const res = await fetchVerifiedInstagramViaSdk({ handle: "buketakdag_" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("instagram_public");
    expect(res.usedOAuth).toBe(false);
    expect(res.username).toBe("buketakdag_");
    expect(res.fullName).toBe("Buket Akdağ");
    expect(res.followers).toBe(466_000);
    expect(res.followsCount).toBe(3_837);
    expect(res.postsCount).toBe(1_531);
    expect(res.biography).toBe("Projeler: buket@buketakdag.net");
    expect(res.avatarUrl).toBe("https://scontent.cdninstagram.com/avatar.jpg?a=1&b=2");
  });

  it("uses Tier 2B external fallback provider when Business Discovery and OpenGraph return nothing", async () => {
    process.env.IG_BUSINESS_ACCOUNT_ID = "ig_primary";
    process.env.META_SYSTEM_USER_TOKEN = "EAA_primary";
    process.env.INSTAGRAM_PUBLIC_FALLBACK_URL = "https://relay.example.com/ig";
    process.env.INSTAGRAM_PUBLIC_FALLBACK_API_KEY = "relay_secret";

    mockConfigFindMany.mockResolvedValue([]);
    mockConnFindMany.mockResolvedValue([]);
    mockSdkCall.mockRejectedValue({
      response: { error: { code: 110, error_subcode: 2207013, message: "Cannot find User" } },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const s = String(url);
        if (s.includes("graph.facebook.com")) {
          return {
            ok: false,
            status: 400,
            json: async () => ({ error: { code: 110, error_subcode: 2207013, message: "Cannot find User" } }),
          };
        }
        if (s.includes("www.instagram.com")) {
          return {
            ok: true,
            status: 200,
            text: async () => "<html><body>Login wall</body></html>",
          };
        }
        expect(s).toBe("https://relay.example.com/ig?handle=creator_x");
        expect((init?.headers as Record<string, string>)?.authorization).toBe("Bearer relay_secret");
        return {
          ok: true,
          status: 200,
          json: async () => ({
            username: "creator_x",
            fullName: "Creator X",
            followersCount: 95200,
            followsCount: 410,
            postsCount: 280,
            avatarUrl: "https://cdn.example.com/x.jpg",
          }),
        };
      }),
    );

    const res = await fetchVerifiedInstagramViaSdk({ handle: "creator_x" });
    expect(res.ok).toBe(true);
    expect(res.source).toBe("instagram_public");
    expect(res.followers).toBe(95200);
    expect(res.postsCount).toBe(280);
    expect(res.fullName).toBe("Creator X");
    expect(mockAssertSafeOutboundUrl).toHaveBeenCalledTimes(1);
  });

  it("returns ok:false with 2207013 when Business Discovery and public fallbacks fail", async () => {
    process.env.IG_BUSINESS_ACCOUNT_ID = "ig_primary";
    process.env.META_SYSTEM_USER_TOKEN = "EAA_primary";
    mockConfigFindMany.mockResolvedValue([]);
    mockConnFindMany.mockResolvedValue([]);

    mockSdkCall.mockRejectedValue({
      response: { error: { code: 110, error_subcode: 2207013, message: "Cannot find User" } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 110, error_subcode: 2207013, message: "Cannot find User" } }),
      }),
    );

    const res = await fetchVerifiedInstagramViaSdk({ handle: "private_or_personal_" });
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe(110);
    expect(res.errorSubcode).toBe(2207013);
    expect(res.errorMessage).toContain("Meta Business Discovery'de bulunamadı");
  });
});

describe("Public Instagram OpenGraph parser", () => {
  it("parses compact English and Turkish follower/post counts", () => {
    expect(parseCompactCount("466K")).toBe(466_000);
    expect(parseCompactCount("686M")).toBe(686_000_000);
    expect(parseCompactCount("1.2B")).toBe(1_200_000_000);
    expect(parseCompactCount("3,837")).toBe(3_837);
    expect(parseCompactCount("1,531")).toBe(1_531);
    expect(parseCompactCount("466 B")).toBe(466_000);
    expect(parseCompactCount("1,5 Mn")).toBe(1_500_000);
  });

  it("handles reversed attribute order, Turkish labels, and rejects mismatched or empty HTML", () => {
    const reversedHtml = `<html><head>
      <meta content="https://scontent.cdninstagram.com/pic.jpg" property="og:image" />
      <meta content="Test Hesap (@test_user_) • Instagram" property="og:title" />
      <meta content="1,5 Mn Takipçi, 420 Takip, 312 Gönderi - Test Hesap (@test_user_) Instagram'da: &quot;Merhaba &amp; Selam&quot;" name="description" />
    </head></html>`;

    const parsed = parsePublicInstagramHtml(reversedHtml, "test_user_");
    expect(parsed).not.toBeNull();
    expect(parsed?.followers).toBe(1_500_000);
    expect(parsed?.followsCount).toBe(420);
    expect(parsed?.postsCount).toBe(312);
    expect(parsed?.fullName).toBe("Test Hesap");
    expect(parsed?.biography).toBe("Merhaba & Selam");
    expect(parsed?.avatarUrl).toBe("https://scontent.cdninstagram.com/pic.jpg");

    expect(parsePublicInstagramHtml(reversedHtml, "other_user")).toBeNull();
    expect(parsePublicInstagramHtml("<html><body>Login</body></html>", "test_user_")).toBeNull();
  });
});
