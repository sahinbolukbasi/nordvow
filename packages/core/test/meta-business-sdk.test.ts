import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfigFindMany, mockConnFindMany, mockVaultGet, mockSdkCall } = vi.hoisted(() => ({
  mockConfigFindMany: vi.fn(),
  mockConnFindMany: vi.fn(),
  mockVaultGet: vi.fn(),
  mockSdkCall: vi.fn(),
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

vi.mock("facebook-nodejs-business-sdk", () => ({
  FacebookAdsApi: class {
    static SDK_VERSION = "24.0.0";
    call = mockSdkCall;
  },
  IGUser: class {},
  IGMedia: class {},
}));

import { fetchVerifiedInstagramViaSdk, resolveMetaSdkCredentials } from "../src/social/meta-business-sdk";

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
    expect(res.username).toBe("some_creator_");
    expect(res.followers).toBe(42500);
    expect(mockSdkCall).toHaveBeenCalledTimes(2);
  });

  it("returns ok:false with 2207013 when all valid pairs report not discoverable", async () => {
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

