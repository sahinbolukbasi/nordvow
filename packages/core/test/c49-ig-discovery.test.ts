import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { vault } from "../src/channels/vault";
import { healthStatus } from "../src/health";
import { classifyGraphFailure, GRAPH_MAX_RETRIES, graphBackoffMs, setGraphRetrySleep } from "../src/social/graph-error";
import { normalizeInstagramHandle } from "../src/social/handles";
import { publicProfileFallback } from "../src/social/public-fallback";
import { instagramAuthorizeUrl, INSTAGRAM_LOGIN_SCOPES } from "../src/social/instagram-login";
import { resolveMetaPageToken, syncSocialAccount, syncStaleAccounts, syncStatusView } from "../src/social/sync";
import { resetDb } from "./helpers";

const originalFetch = globalThis.fetch;
const envBackup = {
  SOCIAL_SYNC_MODE: process.env.SOCIAL_SYNC_MODE,
  INSTAGRAM_IG_USER_ID: process.env.INSTAGRAM_IG_USER_ID,
  META_SYSTEM_USER_TOKEN: process.env.META_SYSTEM_USER_TOKEN,
  IG_BUSINESS_ACCOUNT_ID: process.env.IG_BUSINESS_ACCOUNT_ID,
  IG_GRAPH_TOKEN: process.env.IG_GRAPH_TOKEN,
};

function graphResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function installFetch(handler: (url: URL) => Response | Promise<Response>) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    url.searchParams.delete("client_secret");
    seen.push(`${url.origin}${url.pathname}?${url.searchParams.toString()}`);
    return handler(new URL(String(input)));
  }) as typeof fetch;
  return seen;
}

async function account(handle: string, followers = 0) {
  const inf = await prisma.influencer.create({
    data: { name: handle, category: "moda", iban: "TR110000000000000000000099", ibanHolder: handle, taxStatus: "STOPAJLI", canIssueInvoice: false },
  });
  return prisma.socialAccount.create({
    data: { influencerId: inf.id, platform: "INSTAGRAM", handle, followers, engagementRate: 0.02, demographics: {} },
  });
}

describe("Instagram kimlik ve Graph sınıfı", () => {
  it("kullanıcı adını @, URL, sorgu ve büyük harften tek biçime indirir", () => {
    expect(normalizeInstagramHandle("  @BuketAkdag_ ")).toBe("buketakdag_");
    expect(normalizeInstagramHandle("https://www.instagram.com/BuketAkdag_/?igsh=abc")).toBe("buketakdag_");
    expect(normalizeInstagramHandle("https://instagram.com/@Public.Biz")).toBe("public.biz");
    expect(normalizeInstagramHandle("bad name")).toBe("bad name");
  });

  it("190 ve 10/200 hedef hatası sayılmaz; 110/2207013 hedef; ajans kimliği yutulmaz", () => {
    expect(classifyGraphFailure({ code: 190, errorSubcode: 467, message: "cannot find user" }).errorClass).toBe("TOKEN_INVALID");
    expect(classifyGraphFailure({ code: 102, message: "API Session" }).errorClass).toBe("TOKEN_INVALID");
    expect(classifyGraphFailure({ code: 10, message: "Application does not have permission" }).errorClass).toBe("MISSING_PERMISSION");
    expect(classifyGraphFailure({ code: 200, message: "Permissions error" }).errorClass).toBe("MISSING_PERMISSION");
    const missing = classifyGraphFailure({ code: 10, message: "(#10) Application does not have permission for this action" });
    expect(missing.message).toMatch(/Ready for testing/);
    expect(missing.message).not.toMatch(/UNKNOWN_ERROR/);
    const target = classifyGraphFailure({ code: 110, errorSubcode: 2207013, message: "Cannot find User", targetHandle: "buketakdag_", agencyIgUserId: "agencyig" });
    expect(target.errorClass).toBe("TARGET_NOT_DISCOVERABLE");
    expect(target.retryable).toBe(false);
    const agency = classifyGraphFailure({
      code: 100,
      message: "Unsupported get request. Object with ID 'agencyig' does not exist",
      agencyIgUserId: "agencyig",
      targetHandle: "buketakdag_",
    });
    expect(agency.errorClass).not.toBe("TARGET_NOT_DISCOVERABLE");
    expect(agency.blame).toBe("agency");
    expect(classifyGraphFailure({ httpStatus: 429, code: 4, message: "limit" }).errorClass).toBe("RATE_LIMITED");
    expect(classifyGraphFailure({ code: 32 }).retryable).toBe(true);
    expect(graphBackoffMs(1, 1, () => 0)).toBe(1000);
    expect(graphBackoffMs(1, undefined, () => 0)).toBeGreaterThanOrEqual(500);
    expect(graphBackoffMs(8, undefined, () => 0.2)).toBeLessThanOrEqual(60_000);
  });

  it("herkese açık yedek kayıtlı sayıyı döner, boş hesapta ve gizli isteğe gitmeden başarısız olur", () => {
    const ok = publicProfileFallback({
      handle: "@Public.Biz",
      followers: 1500,
      postsCount: 3,
      avgLikes: 20,
      avgComments: 1,
      engagementRate: 0.01,
      avatarUrl: null,
      displayName: "Public",
      bioSnippet: null,
      profileUrl: null,
    });
    expect(ok.ok && ok.source).toBe("INSTAGRAM_PUBLIC");
    if (ok.ok) expect(ok.followers).toBe(1500);
    const fail = publicProfileFallback({
      handle: "private.one",
      followers: 0,
      postsCount: null,
      avgLikes: null,
      avgComments: null,
      engagementRate: null,
      avatarUrl: null,
      displayName: null,
      bioSnippet: null,
      profileUrl: null,
    });
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.message).toMatch(/Gizli/);
    const hidden = publicProfileFallback({
      handle: "gizli.hesap",
      followers: 900,
      postsCount: 4,
      avgLikes: 10,
      avgComments: 1,
      engagementRate: 0.01,
      avatarUrl: null,
      displayName: "Gizli",
      bioSnippet: null,
      profileUrl: null,
      apiClass: "TARGET_NOT_DISCOVERABLE",
    });
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) {
      expect(hidden.oauthRequired).toBe(true);
      expect(hidden.message).toMatch(/Instagram ile bağlayın/);
    }
  });

  it("üç Sayfa token adını kırpar, ilk dolu olanı alır, farkta yalnız MISMATCH yazar", () => {
    const prev = {
      META_SYSTEM_USER_TOKEN: process.env.META_SYSTEM_USER_TOKEN,
      IG_GRAPH_TOKEN: process.env.IG_GRAPH_TOKEN,
      INSTAGRAM_ACCESS_TOKEN: process.env.INSTAGRAM_ACCESS_TOKEN,
    };
    const warn = console.warn;
    const lines: string[] = [];
    console.warn = (msg?: unknown) => {
      lines.push(String(msg));
    };
    const restore = (name: "META_SYSTEM_USER_TOKEN" | "IG_GRAPH_TOKEN" | "INSTAGRAM_ACCESS_TOKEN", value: string | undefined) => {
      if (value == null) delete process.env[name];
      else process.env[name] = value;
    };
    try {
      process.env.META_SYSTEM_USER_TOKEN = "  same-token  ";
      process.env.IG_GRAPH_TOKEN = "same-token";
      process.env.INSTAGRAM_ACCESS_TOKEN = "same-token";
      expect(resolveMetaPageToken()).toBe("same-token");
      expect(lines).toEqual([]);
      process.env.IG_GRAPH_TOKEN = "other-token";
      expect(resolveMetaPageToken()).toBe("same-token");
      expect(lines).toEqual(["MISMATCH"]);
      expect(lines.join(" ")).not.toMatch(/same-token|other-token/);
      delete process.env.META_SYSTEM_USER_TOKEN;
      delete process.env.INSTAGRAM_ACCESS_TOKEN;
      process.env.IG_GRAPH_TOKEN = "  only-graph  ";
      expect(resolveMetaPageToken()).toBe("only-graph");
    } finally {
      console.warn = warn;
      restore("META_SYSTEM_USER_TOKEN", prev.META_SYSTEM_USER_TOKEN);
      restore("IG_GRAPH_TOKEN", prev.IG_GRAPH_TOKEN);
      restore("INSTAGRAM_ACCESS_TOKEN", prev.INSTAGRAM_ACCESS_TOKEN);
    }
  });

  it("Instagram Login adresi instagram_business_basic ister", () => {
    const url = new URL(instagramAuthorizeUrl({ appId: "app", redirectUri: "https://app.example/cb", state: "s" }));
    expect(url.origin).toBe("https://www.instagram.com");
    expect(url.searchParams.get("scope")).toBe(INSTAGRAM_LOGIN_SCOPES);
    expect(url.searchParams.get("client_secret")).toBeNull();
  });
});

describe("Graph mock ile senkron", () => {
  beforeAll(async () => {
    await resetDb();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    setGraphRetrySleep();
    process.env.SOCIAL_SYNC_MODE = envBackup.SOCIAL_SYNC_MODE;
    process.env.INSTAGRAM_IG_USER_ID = envBackup.INSTAGRAM_IG_USER_ID;
    process.env.META_SYSTEM_USER_TOKEN = envBackup.META_SYSTEM_USER_TOKEN;
    process.env.IG_BUSINESS_ACCOUNT_ID = envBackup.IG_BUSINESS_ACCOUNT_ID;
    process.env.IG_GRAPH_TOKEN = envBackup.IG_GRAPH_TOKEN;
  });

  function liveEnv() {
    process.env.SOCIAL_SYNC_MODE = "http";
    process.env.INSTAGRAM_IG_USER_ID = " agencyig ";
    process.env.META_SYSTEM_USER_TOKEN = " bd-token ";
    process.env.IG_GRAPH_TOKEN = " bd-token ";
    process.env.INSTAGRAM_ACCESS_TOKEN = " bd-token ";
    process.env.IG_BUSINESS_ACCOUNT_ID = "";
  }

  it("herkese açık işletme hesabını tek çağrıda yazar ve eski hatayı temizler", async () => {
    liveEnv();
    const acc = await account("public.biz", 10);
    await prisma.socialAccount.update({ where: { id: acc.id }, data: { syncError: "UNKNOWN_ERROR", lastErrorClass: "UNKNOWN", retryCount: 4 } });
    const seen = installFetch((url) => {
      expect(url.searchParams.get("fields")).toContain("username,name,biography");
      expect(url.searchParams.get("fields")).toContain("media_product_type");
      expect(decodeURIComponent(url.searchParams.get("fields")!)).toContain("business_discovery.username(public.biz)");
      expect(url.pathname).toContain("agencyig");
      return graphResponse(200, {
        business_discovery: {
          id: "178",
          username: "public.biz",
          name: "Public",
          biography: "açık biyografi",
          followers_count: 2200,
          media_count: 8,
          profile_picture_url: "https://example.com/a.jpg",
          media: { data: [{ id: "m1", like_count: 40, comments_count: 4, media_product_type: "REELS", timestamp: "2026-01-01T00:00:00+0000", permalink: "https://instagram.com/p/abc" }] },
        },
      });
    });
    const result = await syncSocialAccount(acc.id, new Date(), { force: true });
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toMatch(/access_token|bd-token/);
    const saved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(saved.followers).toBe(2200);
    expect(saved.displayName).toBe("Public");
    expect(saved.bioSnippet).toMatch(/biyografi/);
    expect(saved.syncSource).toBe("META_API");
    expect(saved.syncError).toBeNull();
    expect(saved.lastErrorClass).toBeNull();
    expect(saved.retryCount).toBe(0);
    expect(syncStatusView(saved).label).toBe("Meta API doğrulandı");
    expect(syncStatusView(saved).error).toBeNull();
    const event = await prisma.socialSyncEvent.findFirstOrThrow({ where: { socialAccountId: acc.id } });
    expect(event.ok).toBe(true);
    expect(event.source).toBe("META_API");
    expect(event.errorClass).toBeNull();
    expect(event.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("kişisel ve gizli hesapta BD zorlanmaz, geçersiz ad Graph'a gitmez", async () => {
    liveEnv();
    const personal = await account("kisisel.hesap", 0);
    const hidden = await account("gizli.hesap", 0);
    const bad = await account("bad name", 3);
    let calls = 0;
    installFetch((url) => {
      calls += 1;
      const handle = decodeURIComponent(url.searchParams.get("fields") ?? "");
      const code = handle.includes("gizli.hesap") ? { message: "User is private", code: 110, error_subcode: 2207013 } : { message: "Cannot find User", code: 110, error_subcode: 2207013 };
      return graphResponse(400, { error: code });
    });
    const p = await syncSocialAccount(personal.id, new Date(), { force: true });
    const h = await syncSocialAccount(hidden.id, new Date(), { force: true });
    const b = await syncSocialAccount(bad.id, new Date(), { force: true });
    expect(p.ok).toBe(false);
    expect(h.ok).toBe(false);
    expect(p.errorClass).toBe("TARGET_NOT_DISCOVERABLE");
    expect(h.errorClass).toBe("TARGET_NOT_DISCOVERABLE");
    expect(p.message).toMatch(/gizli|kişisel|kısıtlı/);
    expect(p.message).not.toMatch(/UNKNOWN_ERROR/);
    expect(b.ok).toBe(false);
    expect(b.message).toMatch(/kullanıcı adı/);
    expect(calls).toBe(2);
    const saved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: personal.id } });
    expect(saved.followers).toBe(0);
    expect(saved.syncSource).toBe("NONE");
    expect(syncStatusView(saved).error).toMatch(/Instagram ile bağlayın/);
    expect(syncStatusView({ syncSource: "NONE", syncError: "UNKNOWN_ERROR", lastErrorClass: null }).error).toBeNull();
  });

  it("190 ve 10/200 kalıcıdır, hız sınırında en fazla belirli tekrar yapılır", async () => {
    liveEnv();
    const sleeps: number[] = [];
    setGraphRetrySleep(async (ms) => {
      sleeps.push(ms);
    });
    const tokenAcc = await account("token.hesap", 0);
    const permAcc = await account("izin.hesap", 0);
    const perm200 = await account("izin200.hesap", 0);
    const rateAcc = await account("limit.hesap", 0);
    const calls = new Map<string, number>();
    installFetch((url) => {
      const fields = decodeURIComponent(url.searchParams.get("fields") ?? "");
      const handle = fields.match(/username\(([^)]+)\)/)?.[1] ?? "";
      calls.set(handle, (calls.get(handle) ?? 0) + 1);
      if (handle === "token.hesap") return graphResponse(401, { error: { message: "Error validating access token", code: 190, error_subcode: 467, type: "OAuthException" } });
      if (handle === "izin.hesap") return graphResponse(403, { error: { message: "(#10) Application does not have permission", code: 10 } });
      if (handle === "izin200.hesap") return graphResponse(403, { error: { message: "(#200) Permissions error", code: 200 } });
      return graphResponse(429, { error: { message: "(#32) rate limit", code: 32, estimated_time_to_regain_access: 1 } });
    });
    const token = await syncSocialAccount(tokenAcc.id, new Date(), { force: true });
    const perm = await syncSocialAccount(permAcc.id, new Date(), { force: true });
    const permB = await syncSocialAccount(perm200.id, new Date(), { force: true });
    const rate = await syncSocialAccount(rateAcc.id, new Date(), { force: true });
    expect(token.errorClass).toBe("TOKEN_INVALID");
    expect(token.message).toMatch(/TOKEN_INVALID|belirteç/);
    expect(perm.errorClass).toBe("MISSING_PERMISSION");
    expect(permB.errorClass).toBe("MISSING_PERMISSION");
    expect(perm.message).toMatch(/10\/200|Ready for testing|izni yok/);
    expect(calls.get("token.hesap")).toBe(1);
    expect(calls.get("izin.hesap")).toBe(1);
    expect(rate.errorClass).toBe("RATE_LIMITED");
    expect(calls.get("limit.hesap")).toBe(1 + GRAPH_MAX_RETRIES);
    expect(sleeps.length).toBe(GRAPH_MAX_RETRIES);
    expect(sleeps.every((ms) => ms >= 500 && ms <= 60_000)).toBe(true);
    expect(sleeps[0]).toBe(1000);
    const saved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: rateAcc.id } });
    expect(saved.retryCount).toBe(GRAPH_MAX_RETRIES);
    expect(saved.followers).toBe(0);
  });

  it("API başarısız olunca kayıtlı public veriye düşer ve nedeni yazar", async () => {
    liveEnv();
    const acc = await account("public.yedek", 1800);
    installFetch(() => graphResponse(401, { error: { message: "Error validating access token", code: 190, error_subcode: 463, type: "OAuthException" } }));
    const result = await syncSocialAccount(acc.id, new Date(), { force: true });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("INSTAGRAM_PUBLIC");
    const saved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(saved.followers).toBe(1800);
    expect(saved.syncSource).toBe("INSTAGRAM_PUBLIC");
    expect(saved.syncError).toBeNull();
    expect(saved.syncReason).toBe("TOKEN_INVALID");
    expect(syncStatusView(saved).label).toBe("Public profil verisi");
    expect(syncStatusView(saved).note).toMatch(/TOKEN_INVALID/);
    const event = await prisma.socialSyncEvent.findFirstOrThrow({ where: { socialAccountId: acc.id }, orderBy: { createdAt: "desc" } });
    expect(event.ok).toBe(true);
    expect(event.source).toBe("INSTAGRAM_PUBLIC");
    expect(event.reason).toBe("TOKEN_INVALID");
    expect(JSON.stringify(event)).not.toMatch(/bd-token|access_token/);
  });

  it("API gizli hesabı görünce public yol durur ve OAuth ister", async () => {
    liveEnv();
    const acc = await account("gizli.profil", 2500);
    const seen = installFetch((url) => {
      expect(url.hostname).toBe("graph.facebook.com");
      return graphResponse(400, { error: { message: "Cannot find User", code: 110, error_subcode: 2207013 } });
    });
    const result = await syncSocialAccount(acc.id, new Date(), { force: true });
    expect(result.ok).toBe(false);
    expect(result.errorClass).toBe("TARGET_NOT_DISCOVERABLE");
    expect(result.message).toMatch(/Instagram ile bağlayın/);
    expect(seen.some((u) => u.includes("www.instagram.com"))).toBe(false);
    const saved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(saved.followers).toBe(2500);
    expect(saved.syncSource).toBe("NONE");
    expect(saved.syncReason).toBe("TARGET_NOT_DISCOVERABLE");
    expect(syncStatusView(saved).error).toMatch(/bağlayın/);
    const event = await prisma.socialSyncEvent.findFirstOrThrow({ where: { socialAccountId: acc.id }, orderBy: { createdAt: "desc" } });
    expect(event.ok).toBe(false);
    expect(event.source).toBe("NONE");
    expect(event.reason).toBe("TARGET_NOT_DISCOVERABLE");
  });

  it("ajans kimliği hedef hesabı gibi yazılmaz", async () => {
    liveEnv();
    const acc = await account("buketakdag_", 40);
    installFetch(() => graphResponse(400, { error: { message: "Unsupported get request. Object with ID 'agencyig' does not exist", code: 100 } }));
    const result = await syncSocialAccount(acc.id, new Date(), { force: true });
    expect(result.errorClass).not.toBe("TARGET_NOT_DISCOVERABLE");
    expect(result.message).toMatch(/Ajans/);
    const saved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(saved.followers).toBe(40);
  });

  it("public yedek yoksa izin hatası hesabı NONE bırakır", async () => {
    liveEnv();
    const empty = await account("yedek.yok", 0);
    installFetch(() => graphResponse(403, { error: { message: "(#10) Application does not have permission", code: 10 } }));
    const fail = await syncSocialAccount(empty.id, new Date(), { force: true });
    expect(fail.ok).toBe(false);
    expect(fail.errorClass).toBe("MISSING_PERMISSION");
    const emptySaved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: empty.id } });
    expect(emptySaved.followers).toBe(0);
    expect(emptySaved.syncSource).toBe("manual");
  });

  it("bağlı Instagram belirteci Business Discovery çağırmaz", async () => {
    liveEnv();
    const acc = await account("oauth.user", 1);
    const tokenRef = await vault().put("inf_oauth", "instagram", "user-token");
    await prisma.socialAccount.update({ where: { id: acc.id }, data: { tokenRef } });
    const seen = installFetch((url) => {
      expect(url.hostname).toBe("graph.instagram.com");
      if (url.pathname.endsWith("/me")) {
        return graphResponse(200, { user_id: "99", username: "oauth.user", name: "OAuth", biography: "kendi", followers_count: 50, media_count: 2, profile_picture_url: null });
      }
      return graphResponse(200, { data: [{ id: "m", like_count: 5, comments_count: 1, media_product_type: "FEED", timestamp: "2026-02-01T00:00:00+0000", permalink: "https://instagram.com/p/z" }] });
    });
    const result = await syncSocialAccount(acc.id, new Date(), { force: true });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("INSTAGRAM_OAUTH");
    expect(seen.every((u) => u.startsWith("https://graph.instagram.com/"))).toBe(true);
    expect(seen.some((u) => u.includes("graph.facebook.com"))).toBe(false);
    const saved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(saved.followers).toBe(50);
    expect(saved.syncSource).toBe("INSTAGRAM_OAUTH");
    expect(syncStatusView(saved).label).toBe("Instagram OAuth");
  });

  it("kalıcı hata ve kilit günlük senkronu ikinci kez çalıştırmaz", async () => {
    process.env.SOCIAL_SYNC_MODE = "mock";
    const stuck = await account("stuck.user", 7);
    await prisma.socialAccount.update({
      where: { id: stuck.id },
      data: { lastErrorClass: "TOKEN_INVALID", lastSyncedAt: new Date(Date.now() - 10 * 86_400_000), syncError: "eski" },
    });
    const due = await account("due.user", 4);
    await prisma.socialSyncLock.deleteMany();
    const first = await syncStaleAccounts(50);
    expect(first.checked).toBeGreaterThan(0);
    await prisma.socialSyncLock.upsert({
      where: { id: "social-sync" },
      create: { id: "social-sync", owner: "other", expiresAt: new Date(Date.now() + 60_000) },
      update: { owner: "other", expiresAt: new Date(Date.now() + 60_000) },
    });
    const again = await syncStaleAccounts(50);
    expect(again.checked).toBe(0);
    const dueRow = await prisma.socialAccount.findUniqueOrThrow({ where: { id: due.id } });
    expect(dueRow.syncSource).toBe("mock");
    const row = await prisma.socialAccount.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(row.followers).toBe(7);
    expect(row.lastErrorClass).toBe("TOKEN_INVALID");
  });

  it("/health sır dökmez ve veritabanını yoklar", async () => {
    const status = await healthStatus();
    expect(status).toEqual({ ok: true, db: "up" });
    expect(JSON.stringify(status)).not.toMatch(/token|secret|password/i);
  });
});
