import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetaApiError } from "../../channels/meta-client";
import { classifyDmDeliveryError, isTemplateRejection } from "../delivery-errors";
import { matchKeyword, normalizeKeywordText } from "../matcher";
import { setDmMetaTransport, type DmMetaTransport } from "../meta-api";
import {
  clearCircuitBreaker,
  openCircuitBreaker,
  releaseDMSlot,
  reserveDMSlot,
  resetRateLimiterMemoryForTests,
  setRateLimitRedisClient,
  SLIDING_WINDOW_LUA,
} from "../rate-limiter";
import {
  appendCampaignUtm,
  createRecipientToken,
  DEFAULT_DM_FOOTER,
  formatDmMessage,
  hashClickIp,
  isBotUserAgent,
  isValidRecipientToken,
  requireDmTrackingSecret,
} from "../tracking";
import { parseInstagramWebhookPayload } from "../webhook-parse";

// Bellek içi Prisma taklidi (claim, çakışma, kota, opt-out, 7 gün, template geri dönüşü uçtan uca testleri için)
const { mockDb } = vi.hoisted(() => {
  const configMap = new Map<string, unknown>();
  const channelConnections: {
    id: string;
    tenantId: string;
    provider: string;
    externalIds: Record<string, unknown>;
    tokenRef: string;
    scopes: string[];
    status: string;
    connectedAt: Date | null;
    lastVerifiedAt: Date | null;
    revokedAt: Date | null;
    lastError: string | null;
    createdAt: Date;
  }[] = [];

  return {
    mockDb: {
      configMap,
      channelConnections,
      reset() {
        configMap.clear();
        channelConnections.length = 0;
      },
    },
  };
});

vi.mock("../../db", () => ({
  prisma: {
    configValue: {
      findUnique: async ({ where }: { where: { key: string } }) => {
        const value = mockDb.configMap.get(where.key);
        return value !== undefined ? { key: where.key, value } : null;
      },
      findMany: async ({ where }: { where: { key: { startsWith: string } } }) => {
        const rows: { key: string; value: unknown }[] = [];
        for (const [k, v] of mockDb.configMap.entries()) {
          if (k.startsWith(where.key.startsWith)) rows.push({ key: k, value: v });
        }
        return rows;
      },
      upsert: async ({ where, create, update }: { where: { key: string }; create: { value: unknown }; update: { value: unknown } }) => {
        const exists = mockDb.configMap.has(where.key);
        const val = exists ? update.value : create.value;
        mockDb.configMap.set(where.key, structuredClone(val));
        return { key: where.key, value: val };
      },
    },
    channelConnection: {
      findMany: async ({ where }: { where: { tenantId?: string; provider?: string; status?: string } }) =>
        mockDb.channelConnections.filter(
          (c) =>
            (!where.tenantId || c.tenantId === where.tenantId) &&
            (!where.provider || c.provider === where.provider) &&
            (!where.status || c.status === where.status),
        ),
      findFirst: async ({ where }: { where: { id?: string; tenantId?: string; provider?: string } }) =>
        mockDb.channelConnections.find(
          (c) =>
            (!where.id || c.id === where.id) &&
            (!where.tenantId || c.tenantId === where.tenantId) &&
            (!where.provider || c.provider === where.provider),
        ) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const rec = {
          id: `conn_${mockDb.channelConnections.length + 1}`,
          tenantId: String(data.tenantId),
          provider: String(data.provider),
          externalIds: (data.externalIds ?? {}) as Record<string, unknown>,
          tokenRef: String(data.tokenRef ?? "demo"),
          scopes: (data.scopes ?? []) as string[],
          status: String(data.status ?? "ACTIVE"),
          connectedAt: (data.connectedAt as Date | null) ?? new Date(),
          lastVerifiedAt: (data.lastVerifiedAt as Date | null) ?? new Date(),
          revokedAt: null,
          lastError: null,
          createdAt: new Date(),
        };
        mockDb.channelConnections.push(rec);
        return rec;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const rec = mockDb.channelConnections.find((c) => c.id === where.id);
        if (!rec) throw new Error("Not found");
        Object.assign(rec, data);
        return rec;
      },
    },
    contact: {
      findUnique: async () => null,
      upsert: async () => ({ id: "ct_1" }),
    },
    conversation: {
      findFirst: async () => null,
      create: async () => ({ id: "cv_1" }),
    },
    message: {
      create: async () => ({ id: "msg_1" }),
    },
    coupon: {
      findFirst: async () => null,
    },
    couponGrant: {
      count: async () => 0,
    },
  },
}));

import {
  activateDmCampaign,
  claimCommentDelivery,
  connectDmInstagramAccount,
  createDmCampaign,
  getDmCampaignStats,
  listDmCampaignLogs,
  processCommentEvent,
  processDmInboundEvent,
  reconcileAccountComments,
  runDmRetentionJob,
} from "../store";

describe("DM Otomasyonu (Instagram Yorum → DM) — Birim ve Entegrasyon Testleri", () => {
  beforeEach(() => {
    mockDb.reset();
    resetRateLimiterMemoryForTests();
    setRateLimitRedisClient(null);
    setDmMetaTransport(null);
    process.env.DM_TRACKING_SECRET = "test-super-secret-dm-tracking-key-2026";
  });

  describe("1. Türkçe + Unicode Anahtar Kelime Eşleştirici (matcher.ts)", () => {
    it("KOD, kod, Kod 🙏, #kod ve kod!! ifadelerini aynı eşleştirir", () => {
      for (const sample of ["KOD", "kod", "Kod 🙏", "#kod", "kod!!"]) {
        const r = matchKeyword(sample, ["KOD"], "WHOLE_WORD");
        expect(r.matched).toBe(true);
        expect(r.matchedKeyword).toBe("KOD");
      }
    });

    it("İNDİRİM / indirim / INDIRIM / ındırım ve ŞİMDİ / simdi Türkçe katlama ile eşleşir", () => {
      for (const sample of ["İNDİRİM", "indirim", "INDIRIM", "ındırım", "İndirim 🔥"]) {
        expect(matchKeyword(sample, ["İNDİRİM"], "WHOLE_WORD").matched).toBe(true);
      }
      expect(matchKeyword("ŞİMDİ al", ["simdi"], "WHOLE_WORD").matched).toBe(true);
      expect(matchKeyword("IŞIK", ["ışık"], "WHOLE_WORD").matched).toBe(true);
      expect(normalizeKeywordText("preço")).toBe("preco");
    });

    it("Tam kelime modunda kodlar ≠ kod, kısmi modda kodlar = kod", () => {
      expect(matchKeyword("kodlar burada", ["kod"], "WHOLE_WORD").matched).toBe(false);
      expect(matchKeyword("kodlar burada", ["kod"], "CONTAINS").matched).toBe(true);
    });

    it("Sayısal anahtar kelimede O8 ve 08 eşleşir; boş yorum ve sadece emoji eşleşmez", () => {
      expect(matchKeyword("O8 istiyorum", ["08"], "WHOLE_WORD").matched).toBe(true);
      expect(matchKeyword("", ["kod"], "WHOLE_WORD").matched).toBe(false);
      expect(matchKeyword("🙏🙏🔥", ["kod"], "WHOLE_WORD").matched).toBe(false);
      expect(matchKeyword("   ", ["kod"], "ANY_COMMENT").matched).toBe(false);
      expect(matchKeyword("🙏", ["kod"], "ANY_COMMENT").matched).toBe(true);
    });
  });

  describe("2. Webhook Ayrıştırma (webhook-parse.ts)", () => {
    it("yorum, reklam (original_media_id), kendi yorumu, echo/silinmiş/read ve postback olaylarını ayrıştırır", () => {
      const parsed = parseInstagramWebhookPayload({
        object: "instagram",
        entry: [
          {
            id: "178414001",
            time: 1795000000,
            changes: [
              {
                field: "comments",
                value: {
                  id: "cm_1",
                  text: "KOD",
                  from: { id: "usr_1", username: "ali" },
                  media: { id: "ad_media_9", media_product_type: "AD", original_media_id: "org_media_1", ad_id: "ad_1" },
                },
              },
              {
                field: "comments",
                value: {
                  id: "cm_own",
                  text: "Kendi yanıtım",
                  from: { id: "178414001", username: "sahip" },
                  media: { id: "org_media_1" },
                },
              },
            ],
            messaging: [
              { sender: { id: "usr_2" }, recipient: { id: "178414001" }, message: { mid: "m_echo", text: "hi", is_echo: true } },
              { sender: { id: "usr_2" }, recipient: { id: "178414001" }, message: { mid: "m_del", text: "hi", is_deleted: true } },
              { sender: { id: "usr_2" }, recipient: { id: "178414001" }, message: { mid: "m_unsup", is_unsupported: true } },
              { sender: { id: "usr_2" }, recipient: { id: "178414001" }, read: { watermark: 1795000001 } },
              { sender: { id: "usr_2" }, recipient: { id: "178414001" }, postback: { mid: "pb_1", title: "Kodu göster", payload: "reveal:dmc_1" } },
            ],
          },
        ],
      });

      expect(parsed.supported).toBe(true);
      expect(parsed.comments).toHaveLength(2);
      expect(parsed.comments[0]!.originalMediaId).toBe("org_media_1");
      expect(parsed.comments[0]!.isOwnComment).toBe(false);
      expect(parsed.comments[1]!.isOwnComment).toBe(true);
      expect(parsed.messages).toHaveLength(0);
      expect(parsed.ignoredEchoOrDeletedCount).toBe(3);
      expect(parsed.ignoredReadCount).toBe(1);
      expect(parsed.postbacks).toHaveLength(1);
      expect(parsed.postbacks[0]!.payload).toBe("reveal:dmc_1");
    });
  });

  describe("3. Hata Sınıflandırma (delivery-errors.ts)", () => {
    it("Meta hata kodlarını doğru sınıflandırır ve şablon reddinde kontrollü geri dönüş verir", () => {
      expect(classifyDmDeliveryError(new MetaApiError("Expired", 190)).category).toBe("REAUTH_REQUIRED");
      expect(classifyDmDeliveryError(new MetaApiError("Denied", 10)).category).toBe("DEFINITE_REJECTION");
      expect(classifyDmDeliveryError(new MetaApiError("Param", 100)).category).toBe("DEFINITE_REJECTION");
      expect(classifyDmDeliveryError(new MetaApiError("Perm", 200)).category).toBe("DEFINITE_REJECTION");
      expect(classifyDmDeliveryError(new MetaApiError("Unavailable", 551)).category).toBe("DEFINITE_REJECTION");
      expect(classifyDmDeliveryError(new MetaApiError("Not eligible", 10, 2534025)).category).toBe("SKIPPED_NOT_ELIGIBLE");
      expect(classifyDmDeliveryError(new MetaApiError("Unknown", 1, undefined, undefined, 500)).category).toBe("UNCERTAIN");
      expect(classifyDmDeliveryError(new MetaApiError("Rate limit", 613, undefined, undefined, 429)).category).toBe("RATE_LIMITED");

      expect(isTemplateRejection(new MetaApiError("Invalid template button", 100))).toBe(true);
      expect(isTemplateRejection(new MetaApiError("Message is outside of allowed window", 100))).toBe(false);
      expect(isTemplateRejection(new MetaApiError("Invalid for a private reply", 100))).toBe(false);
      expect(isTemplateRejection(new MetaApiError("Requested user cannot be found", 100))).toBe(false);
    });
  });

  describe("4. Kayan Pencere Hız Sınırlayıcı ve Devre Kesici (rate-limiter.ts)", () => {
    it("700. istek geçer, 701. reddedilir; pencere kayınca açılır; slot iadesi ve 1000 eşzamanlı istekte tam 700 rezerve", async () => {
      const baseTs = 1_795_000_000_000;
      const results = await Promise.all(
        Array.from({ length: 1000 }, (_, i) =>
          reserveDMSlot("ig_burst_1", { nowMs: baseTs + i, hourlyCap: 700, enforcePerSecond: false }),
        ),
      );
      const passed = results.filter((r) => r.allowed);
      const blocked = results.filter((r) => !r.allowed);
      expect(passed).toHaveLength(700);
      expect(blocked).toHaveLength(300);

      // Slotu iade edince 1 yer açılır
      await releaseDMSlot("ig_burst_1", (passed[0] as { slotId: string }).slotId);
      const afterRelease = await reserveDMSlot("ig_burst_1", { nowMs: baseTs + 2000, hourlyCap: 700, enforcePerSecond: false });
      expect(afterRelease.allowed).toBe(true);

      // 1 saat sonra pencere kayar ve tekrar açılır
      const afterHour = await reserveDMSlot("ig_burst_1", { nowMs: baseTs + 3600_005, hourlyCap: 700, enforcePerSecond: false });
      expect(afterHour.allowed).toBe(true);

      // Devre kesici 15 dk bloklar
      openCircuitBreaker("ig_burst_1", 900_000, "429", baseTs + 3600_010);
      const duringBreaker = await reserveDMSlot("ig_burst_1", { nowMs: baseTs + 3600_020, hourlyCap: 700, enforcePerSecond: false });
      expect(duringBreaker.allowed).toBe(false);
      if (!duringBreaker.allowed) expect(duringBreaker.reason).toBe("CIRCUIT_OPEN");
      clearCircuitBreaker("ig_burst_1");
    });

    it("Redis Lua istemcisini çağırır", async () => {
      let calledScript = "";
      setRateLimitRedisClient({
        async eval(script) {
          calledScript = script;
          return [1, 1, 699];
        },
        async zrem() {
          return 1;
        },
      });
      const res = await reserveDMSlot("ig_redis", { enforcePerSecond: false });
      expect(res.allowed).toBe(true);
      expect(calledScript).toBe(SLIDING_WINDOW_LUA);
    });
  });

  describe("5. Takip Linkleri, Token, UTM ve Gizlilik (tracking.ts)", () => {
    it("DM_TRACKING_SECRET zorunludur; recipient token 22 krk, IP tuzlu hash, açık yönlendirme engelli", () => {
      const prev = process.env.DM_TRACKING_SECRET;
      delete process.env.DM_TRACKING_SECRET;
      expect(() => requireDmTrackingSecret()).toThrow();
      process.env.DM_TRACKING_SECRET = prev;

      const tok = createRecipientToken("178999000");
      expect(tok).toHaveLength(22);
      expect(isValidRecipientToken(tok)).toBe(true);
      expect(createRecipientToken("178999000")).toBe(tok);

      const ipHash = hashClickIp("192.168.1.50");
      expect(ipHash).not.toContain("192.168");
      expect(isBotUserAgent("facebookexternalhit/1.1")).toBe(true);
      expect(isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)")).toBe(false);

      expect(() => appendCampaignUtm("javascript:alert(1)", "c", "id1")).toThrow();
      expect(() => appendCampaignUtm("http://example.com", "c", "id1")).toThrow();
      const utmUrl = appendCampaignUtm("https://nordvow.com/urun?utm_source=custom", "sonbahar", "dmc_1");
      expect(utmUrl).toContain("utm_source=custom");
      expect(utmUrl).toContain("utm_medium=dm");
      expect(utmUrl).toContain("utm_campaign=sonbahar");

      const msg = formatDmMessage({
        dmText: "Selam @{username}, kodun: {kupon} -> https://raw.example.com",
        dmFooter: DEFAULT_DM_FOOTER,
        username: "ayse",
        linkUrl: "https://nordvow.com/r/abc",
        couponCode: "KOD25",
      });
      expect(msg).toContain("@ayse");
      expect(msg).toContain("KOD25");
      expect(msg).toContain("https://nordvow.com/r/abc");
      expect(msg).not.toContain("raw.example.com");
      expect(msg).toContain("DUR");
    });
  });

  describe("6. Claim, Çakışma, Opt-Out, 7 Gün, 190 Reauth ve Polling (store.ts)", () => {
    async function setupActiveCampaign(opts?: {
      name?: string;
      triggerMode?: "SPECIFIC_POST" | "NEXT_REEL" | "ANY_POST";
      mediaId?: string;
      keywords?: string[];
      sendCap?: number;
      buttons?: { label: string; url: string }[];
    }) {
      const acc = await connectDmInstagramAccount({
        tenantId: "brand_1",
        actorId: "usr_1",
        igUserId: "1784140099",
        igUsername: "nordvow.test",
        accountType: "CREATOR",
        accessToken: "valid_token",
      });
      const camp = await createDmCampaign({
        tenantId: "brand_1",
        actorId: "usr_1",
        igAccountId: acc.id,
        name: opts?.name ?? "Test Kampanya",
        triggerMode: opts?.triggerMode ?? "SPECIFIC_POST",
        mediaId: opts?.triggerMode === "ANY_POST" ? null : opts?.mediaId ?? "media_100",
        keywords: opts?.keywords ?? ["KOD"],
        matchMode: "WHOLE_WORD",
        dmText: "Merhaba @{username}, kodun: {kupon} {link}",
        buttons: opts?.buttons ?? [{ label: "Kullan", url: "https://nordvow.com/firsat" }],
        publicReplyEnabled: true,
        publicReplies: ["DM'den gönderdik 💌"],
        couponCode: "NV25",
        sendCap: opts?.sendCap ?? null,
      });
      return activateDmCampaign("brand_1", camp.id, "usr_1", {
        instructionAck: true,
        adDisclosureAck: true,
        contentMatchAck: true,
      });
    }

    it("Çakışma: aynı yoruma 3 kampanya eşleşirse yalnız en spesifik gönderir, diğerleri SKIPPED_OTHER_CAMPAIGN", async () => {
      const sendSpy = vi.fn().mockResolvedValue({ messageId: "mid_win", recipientId: "igsid_1" });
      setDmMetaTransport({
        sendPrivateReplyText: sendSpy,
        sendPrivateReplyTemplate: sendSpy,
        sendDirectMessage: sendSpy,
        replyToCommentPublicly: vi.fn().mockResolvedValue({ id: "rep_1" }),
        listMedia: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
        listMediaComments: vi.fn().mockResolvedValue([]),
        subscribeAppFields: vi.fn().mockResolvedValue({ success: true }),
        refreshLongLivedToken: vi.fn(),
        exchangeInstagramLoginCode: vi.fn(),
      });

      const anyCamp = await setupActiveCampaign({ name: "Genel", triggerMode: "ANY_POST", keywords: ["KOD"] });
      const specCamp = await setupActiveCampaign({ name: "Özel Gönderi", triggerMode: "SPECIFIC_POST", mediaId: "media_100", keywords: ["KOD"] });
      const anyCamp2 = await setupActiveCampaign({ name: "Genel 2", triggerMode: "ANY_POST", keywords: ["KOD"] });

      const res = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_conflict",
        text: "KOD lütfen",
        commenterId: "igsid_1",
        commenterUsername: "selin",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(),
        isOwnComment: false,
      });

      expect(res.winnerCampaignId).toBe(specCamp.id);
      expect(res.status).toBe("SENT");
      expect(sendSpy).toHaveBeenCalledTimes(1);

      const logsAny1 = await listDmCampaignLogs("brand_1", anyCamp.id);
      const logsAny2 = await listDmCampaignLogs("brand_1", anyCamp2.id);
      expect(logsAny1[0]!.status).toBe("SKIPPED_OTHER_CAMPAIGN");
      expect(logsAny2[0]!.status).toBe("SKIPPED_OTHER_CAMPAIGN");

      // Aynı webhook 3 kez gelse bile ikinci kez gönderilmez
      const resDup = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_conflict",
        text: "KOD lütfen",
        commenterId: "igsid_1",
        commenterUsername: "selin",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(),
        isOwnComment: false,
      });
      expect(resDup.status).toBe("ALREADY_CLAIMED");
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it("Belirsiz sonuç (5xx/timeout) UNCONFIRMED kalır ve ikinci claim asla çalışmaz; şablon reddinde düz metin geri dönüşü", async () => {
      const textSpy = vi.fn().mockResolvedValue({ messageId: "mid_fallback", recipientId: "igsid_2" });
      const tplSpy = vi
        .fn()
        .mockRejectedValueOnce(new MetaApiError("Template button not supported", 100))
        .mockRejectedValueOnce(new MetaApiError("Internal error", 2, undefined, undefined, 500));

      setDmMetaTransport({
        sendPrivateReplyText: textSpy,
        sendPrivateReplyTemplate: tplSpy,
        sendDirectMessage: textSpy,
        replyToCommentPublicly: vi.fn().mockResolvedValue({ id: "rep_2" }),
        listMedia: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
        listMediaComments: vi.fn().mockResolvedValue([]),
        subscribeAppFields: vi.fn().mockResolvedValue({ success: true }),
        refreshLongLivedToken: vi.fn(),
        exchangeInstagramLoginCode: vi.fn(),
      });

      const camp = await setupActiveCampaign({ name: "Fallback & Claim", mediaId: "media_100" });

      // 1. Şablon reddi → tek seferlik düz metin geri dönüşü başarılı
      const r1 = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_fb",
        text: "KOD",
        commenterId: "igsid_2",
        commenterUsername: "veli",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(),
        isOwnComment: false,
      });
      expect(r1.status).toBe("SENT");
      expect(textSpy).toHaveBeenCalledTimes(1);

      // 2. Belirsiz 5xx hatası → UNCONFIRMED ve tekrar claim yapılamaz
      const r2 = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_unc",
        text: "KOD",
        commenterId: "igsid_3",
        commenterUsername: "can",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(),
        isOwnComment: false,
      });
      expect(r2.status).toBe("UNCONFIRMED");

      const retryClaim = await claimCommentDelivery("brand_1", r2.logId!);
      expect(retryClaim.claimed).toBe(false);
    });

    it("7 gün kuralı, 24 saat tekrar, opt-out (DUR) ve kampanya tavanı çalışır", async () => {
      const sendSpy = vi.fn().mockResolvedValue({ messageId: "mid_ok", recipientId: "igsid_4" });
      setDmMetaTransport({
        sendPrivateReplyText: sendSpy,
        sendPrivateReplyTemplate: sendSpy,
        sendDirectMessage: sendSpy,
        replyToCommentPublicly: vi.fn().mockResolvedValue({ id: "rep_3" }),
        listMedia: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
        listMediaComments: vi.fn().mockResolvedValue([]),
        subscribeAppFields: vi.fn().mockResolvedValue({ success: true }),
        refreshLongLivedToken: vi.fn(),
        exchangeInstagramLoginCode: vi.fn(),
      });

      const camp = await setupActiveCampaign({ name: "Kurallar", sendCap: 1 });

      // 7 gün geçmiş yorum → SKIPPED_EXPIRED
      const expired = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_old",
        text: "KOD",
        commenterId: "igsid_old",
        commenterUsername: "eski",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(Date.now() - 8 * 86_400_000),
        isOwnComment: false,
      });
      expect(expired.status).toBe("SKIPPED_EXPIRED");

      // DUR yazan kişi → opt-out kaydı (ek mesaj yok)
      const optOutRes = await processDmInboundEvent("brand_1", {
        igAccountId: "1784140099",
        mid: "dm_dur",
        senderId: "igsid_dur",
        recipientId: "1784140099",
        text: "DUR.",
        timestamp: new Date(),
      });
      expect(optOutRes.optOut).toBe(true);
      expect(sendSpy).toHaveBeenCalledTimes(0);

      const skippedOpt = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_dur",
        text: "KOD",
        commenterId: "igsid_dur",
        commenterUsername: "durcu",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(),
        isOwnComment: false,
      });
      expect(skippedOpt.status).toBe("SKIPPED_OPTED_OUT");

      // Kampanya tavanı 1: ilk gönderim SENT, ikinci kişi SKIPPED_CAMPAIGN_CAP
      const firstOk = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_cap1",
        text: "KOD",
        commenterId: "igsid_c1",
        commenterUsername: "c1",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(),
        isOwnComment: false,
      });
      expect(firstOk.status).toBe("SENT");

      const secondCap = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_cap2",
        text: "KOD",
        commenterId: "igsid_c2",
        commenterUsername: "c2",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(),
        isOwnComment: false,
      });
      expect(secondCap.status).toBe("SKIPPED_CAMPAIGN_CAP");
      const stats = await getDmCampaignStats("brand_1", camp.id);
      expect(stats.campaign.status).toBe("PAUSED");
    });

    it("Polling güvenlik ağı sahibinin yanıtladığı yorumu atlar, kaçan yorumu yakalar; 190 token hatası kampanyayı ACCOUNT_ISSUE yapar", async () => {
      const sendSpy = vi.fn().mockResolvedValue({ messageId: "mid_poll", recipientId: "igsid_p1" });
      const transport: DmMetaTransport = {
        sendPrivateReplyText: sendSpy,
        sendPrivateReplyTemplate: sendSpy,
        sendDirectMessage: sendSpy,
        replyToCommentPublicly: vi.fn().mockResolvedValue({ id: "rep_p" }),
        listMedia: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
        listMediaComments: vi.fn().mockResolvedValue([
          {
            id: "cm_already_replied",
            text: "KOD",
            timestamp: new Date().toISOString(),
            from: { id: "igsid_skip", username: "atla" },
            repliedByOwner: true,
          },
          {
            id: "cm_missed_webhook",
            text: "KOD!",
            timestamp: new Date().toISOString(),
            from: { id: "igsid_catch", username: "yakala" },
            repliedByOwner: false,
          },
        ]),
        subscribeAppFields: vi.fn().mockResolvedValue({ success: true }),
        refreshLongLivedToken: vi.fn(),
        exchangeInstagramLoginCode: vi.fn(),
      };
      setDmMetaTransport(transport);

      const camp = await setupActiveCampaign({ name: "Polling & 190" });
      const pollRes = await reconcileAccountComments();
      expect(pollRes.processed).toBe(1);
      expect(sendSpy).toHaveBeenCalledTimes(1);

      // Token 190 hatası hesabı REAUTH_REQUIRED ve kampanyayı ACCOUNT_ISSUE yapar
      sendSpy.mockRejectedValueOnce(new MetaApiError("Invalid OAuth access token", 190, 463, "OAuthException", 401));
      const r190 = await processCommentEvent("brand_1", {
        igAccountId: "1784140099",
        commentId: "cm_190",
        text: "KOD",
        commenterId: "igsid_190",
        commenterUsername: "tok",
        mediaId: "media_100",
        mediaProductType: "REELS",
        originalMediaId: null,
        adId: null,
        parentId: null,
        timestamp: new Date(),
        isOwnComment: false,
      });
      expect(r190.status).toBe("FAILED");
      const stats = await getDmCampaignStats("brand_1", camp.id);
      expect(stats.campaign.status).toBe("ACCOUNT_ISSUE");

      // KVKK saklama işi sorunsuz çalışır
      const ret = await runDmRetentionJob(new Date(Date.now() + 95 * 86_400_000));
      expect(ret.maskedLogs).toBeGreaterThanOrEqual(1);
    });
  });
});

