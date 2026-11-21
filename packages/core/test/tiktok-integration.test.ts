import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  TIKTOK_ALL_SCOPES,
  TikTokApiError,
  buildAuthorizeUrl,
  decryptToken,
  encryptToken,
  exchangeOAuthCode,
  generatePkcePair,
  listAllVideos,
  maskSecret,
  missingRequiredScopes,
  mockTikTok,
  preflightPublish,
  redactSecrets,
  refreshOAuthToken,
  revokeOAuthToken,
  setTikTokFetch,
  verifyTikTokWebhookSignature,
  withTokenRefreshRetry,
} from "../src/tiktok";

afterEach(() => {
  setTikTokFetch(undefined);
});

describe("TikTok crypto & secret redaction", () => {
  it("encrypts and decrypts tokens with AES-256-GCM using 32-byte key", () => {
    const keyHex = "00".repeat(32);
    const token = "act.tiktok_secret_token_example_12345";
    const enc = encryptToken(token, keyHex);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(token);
    expect(decryptToken(enc, keyHex)).toBe(token);
  });

  it("masks secrets and redacts sensitive fields in log payloads", () => {
    expect(maskSecret("abcdefgh12345678")).toBe("abcd***5678");
    const safe = redactSecrets({
      open_id: "u_1",
      access_token: "secret_access_123456",
      nested: { client_secret: "supersecret999" },
    });
    expect(safe.open_id).toBe("u_1");
    expect(safe.access_token).toBe("secr***3456");
    expect(safe.nested.client_secret).toBe("supe***t999");
  });
});

describe("TikTok OAuth v2 & PKCE", () => {
  it("generates PKCE S256 pair and valid authorize URL", () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThan(32);
    expect(codeChallenge).not.toBe(codeVerifier);

    const url = new URL(
      buildAuthorizeUrl({
        clientKey: "ck_123",
        redirectUri: "https://nordvow.com/auth/tiktok/callback",
        state: "st_abc",
        codeChallenge,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://www.tiktok.com/v2/auth/authorize/");
    expect(url.searchParams.get("client_key")).toBe("ck_123");
    expect(url.searchParams.get("scope")).toBe(TIKTOK_ALL_SCOPES.join(","));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st_abc");
  });

  it("exchanges code, refreshes token and revokes token against mocked API", async () => {
    const calls: string[] = [];
    setTikTokFetch((async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/oauth/token/")) {
        return new Response(
          JSON.stringify({
            access_token: "at_new",
            refresh_token: "rt_new",
            open_id: "open_1",
            scope: "user.info.basic,video.list",
            expires_in: 86400,
            refresh_expires_in: 31536000,
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch);

    const tok = await exchangeOAuthCode({
      clientKey: "ck",
      clientSecret: "cs",
      code: "code_1",
      redirectUri: "https://nordvow.com/auth/tiktok/callback",
      codeVerifier: "ver_1",
    });
    expect(tok.access_token).toBe("at_new");
    expect(tok.open_id).toBe("open_1");

    const ref = await refreshOAuthToken({ clientKey: "ck", clientSecret: "cs", refreshToken: "rt_old" });
    expect(ref.access_token).toBe("at_new");

    await revokeOAuthToken({ clientKey: "ck", clientSecret: "cs", token: "at_new" });
    expect(calls).toHaveLength(3);
  });
});

describe("TikTok retry, token refresh and video pagination", () => {
  it("retries once on access_token_invalid using refreshed token", async () => {
    let attempts = 0;
    const result = await withTokenRefreshRetry(
      "expired_token",
      async (token) => {
        attempts++;
        if (token === "expired_token") {
          throw new TikTokApiError({ code: "access_token_invalid", httpStatus: 401 });
        }
        return `ok:${token}`;
      },
      async () => "fresh_token",
    );
    expect(result).toBe("ok:fresh_token");
    expect(attempts).toBe(2);
  });

  it("paginates video/list until has_more is false and retries 429 rate limit", async () => {
    let pageCalls = 0;
    setTikTokFetch((async () => {
      pageCalls++;
      if (pageCalls === 1) {
        return new Response(
          JSON.stringify({ error: { code: "rate_limit_exceeded", message: "Too many requests" } }),
          { status: 429 },
        );
      }
      if (pageCalls === 2) {
        return new Response(
          JSON.stringify({
            data: { videos: [{ id: "v1", view_count: 100 }], cursor: 20, has_more: true },
            error: { code: "ok" },
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          data: { videos: [{ id: "v2", view_count: 250 }], has_more: false },
          error: { code: "ok" },
        }),
        { status: 200 },
      );
    }) as typeof fetch);

    const videos = await listAllVideos("at_123");
    expect(videos.map((v) => v.id)).toEqual(["v1", "v2"]);
    expect(pageCalls).toBe(3);
  });
});

describe("TikTok Content Posting preflight & scopes", () => {
  it("blocks branded content on unaudited app and enforces SELF_ONLY", async () => {
    const blocked = await preflightPublish(mockTikTok, "tok", {
      brandedContent: true,
      audited: false,
      requestedPrivacy: "PUBLIC_TO_EVERYONE",
    });
    expect(blocked.allowed).toBe(false);

    const ok = await preflightPublish(mockTikTok, "tok", {
      brandedContent: false,
      audited: false,
      requestedPrivacy: "PUBLIC_TO_EVERYONE",
    });
    expect(ok).toEqual({ allowed: true, privacy: "SELF_ONLY" });
  });

  it("detects missing required scopes", () => {
    expect(missingRequiredScopes(["user.info.basic", "video.list"], ["video.publish", "video.list"])).toEqual([
      "video.publish",
    ]);
  });
});

describe("TikTok Webhook signature verification", () => {
  it("accepts valid signature within 5 minutes and rejects tampered or expired requests", () => {
    const secret = "tiktok_client_secret_test";
    const body = JSON.stringify({ event: "authorization.removed", user_openid: "open_99" });
    const nowMs = 1_700_000_000_000;
    const t = Math.floor(nowMs / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");

    expect(verifyTikTokWebhookSignature(body, `t=${t},s=${sig}`, secret, nowMs)).toBe(true);
    expect(verifyTikTokWebhookSignature(body + " ", `t=${t},s=${sig}`, secret, nowMs)).toBe(false);
    // 6 dakika eski (replay)
    expect(verifyTikTokWebhookSignature(body, `t=${t},s=${sig}`, secret, nowMs + 360_000)).toBe(false);
  });
});
