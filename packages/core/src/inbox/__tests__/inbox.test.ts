import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSignedOAuthState,
  decryptMetaToken,
  encryptMetaToken,
  verifyMetaSignature,
  verifyMetaSignedRequest,
  verifyMetaTokenConstantTime,
  verifySignedOAuthState,
} from "../meta-security";
import { getWindowState } from "../messaging-window";
import {
  aiSuggestionResponseSchema,
  classifyMetaSendError,
  detectOptOutKeyword,
  interpolateCannedResponse,
  parseWhatsAppWebhookValue,
  redactPiiForAi,
  resolveConversationAction,
  searchCannedResponses,
} from "../rules";

describe("Mesaj Kutusu (Instagram + WhatsApp Birleşik Gelen Kutusu) — Birim Testleri", () => {
  describe("meta-security.ts (Webhook İmzası, AES-256-GCM Token, OAuth State, Signed Request)", () => {
    const secret1 = "ig_app_secret_primary";
    const secret2 = "fb_app_secret_secondary";
    const body = JSON.stringify({ object: "instagram", entry: [{ id: "1784140000" }] });

    it("geçerli HMAC-SHA256 imzasını doğrular (birincil ve ikincil secret)", () => {
      const sig1 = "sha256=" + createHmac("sha256", secret1).update(body).digest("hex");
      const sig2 = "sha256=" + createHmac("sha256", secret2).update(body).digest("hex");

      expect(verifyMetaSignature(body, sig1, [secret1, secret2])).toBe(true);
      expect(verifyMetaSignature(body, sig2, [secret1, secret2])).toBe(true);
    });

    it("geçersiz, eksik veya farklı uzunluktaki imzayı reddeder", () => {
      const wrongSig = "sha256=" + createHmac("sha256", "wrong_secret").update(body).digest("hex");
      expect(verifyMetaSignature(body, wrongSig, [secret1, secret2])).toBe(false);
      expect(verifyMetaSignature(body, null, [secret1])).toBe(false);
      expect(verifyMetaSignature(body, "sha256=1234", [secret1])).toBe(false);
    });

    it("verifyMetaTokenConstantTime sabit zamanlı token karşılaştırması yapar", () => {
      expect(verifyMetaTokenConstantTime("my_verify_token", "my_verify_token")).toBe(true);
      expect(verifyMetaTokenConstantTime("my_verify_token", "other_token")).toBe(false);
      expect(verifyMetaTokenConstantTime("short", "my_verify_token")).toBe(false);
    });

    it("AES-256-GCM ile token şifreler ve geri çözer", () => {
      const token = "EAABwzLixnjYBO_long_lived_meta_access_token_123456";
      const enc = encryptMetaToken(token, "custom-32-byte-secret-seed");
      expect(enc.startsWith("v1:")).toBe(true);
      expect(enc).not.toContain(token);
      expect(decryptMetaToken(enc, "custom-32-byte-secret-seed")).toBe(token);
    });

    it("imzalı OAuth state üretir ve süresi geçmiş state'i reddeder", () => {
      const now = 1_795_000_000_000;
      const state = createSignedOAuthState(
        { userId: "usr_1", tenantId: "br_1", nonce: "n123", ts: now },
        "state_secret",
      );
      const valid = verifySignedOAuthState(state, { secretOverride: "state_secret", now: now + 60_000 });
      expect(valid?.userId).toBe("usr_1");
      expect(valid?.tenantId).toBe("br_1");

      const expired = verifySignedOAuthState(state, { secretOverride: "state_secret", now: now + 15 * 60_000 });
      expect(expired).toBeNull();
    });

    it("Meta Data Deletion signed_request doğrulamasını yapar", () => {
      const payload = Buffer.from(JSON.stringify({ user_id: "178999111", algorithm: "HMAC-SHA256" })).toString("base64url");
      const sig = createHmac("sha256", secret1).update(payload).digest("base64url");
      const parsed = verifyMetaSignedRequest(`${sig}.${payload}`, [secret1]);
      expect(parsed?.user_id).toBe("178999111");
      expect(verifyMetaSignedRequest(`${sig}.${payload}`, ["wrong"])).toBeNull();
    });
  });

  describe("messaging-window.ts (24 Saat ve 7 Gün HUMAN_AGENT Pencere Kuralları)", () => {
    const now = new Date("2026-11-19T12:00:00Z");

    it("WhatsApp 23:59 açık, 24:01 kapalı (yalnızca şablon)", () => {
      const at23h59m = new Date(now.getTime() - (23 * 60 + 59) * 60_000);
      const openState = getWindowState({ channel: "WHATSAPP", lastIncomingAt: at23h59m, now });
      expect(openState.canFreeform).toBe(true);
      expect(openState.reason).toBe("open");
      expect(openState.closingSoon).toBe(true);

      const at24h01m = new Date(now.getTime() - (24 * 60 + 1) * 60_000);
      const closedState = getWindowState({ channel: "WHATSAPP", lastIncomingAt: at24h01m, now });
      expect(closedState.canFreeform).toBe(false);
      expect(closedState.canTemplate).toBe(true);
      expect(closedState.reason).toBe("closed");
    });

    it("Instagram HUMAN_AGENT kapalıysa 24 saatten sonra kapanır; açıksa 7 güne kadar yalnız insan yanıtına izin verir", () => {
      const at3Days = new Date(now.getTime() - 3 * 24 * 3600_000);

      const withoutHumanAgent = getWindowState({
        channel: "INSTAGRAM",
        lastIncomingAt: at3Days,
        now,
        humanAgentEnabled: false,
      });
      expect(withoutHumanAgent.canFreeform).toBe(false);
      expect(withoutHumanAgent.reason).toBe("closed");

      const withHumanAgent = getWindowState({
        channel: "INSTAGRAM",
        lastIncomingAt: at3Days,
        now,
        humanAgentEnabled: true,
        byHuman: true,
      });
      expect(withHumanAgent.canFreeform).toBe(true);
      expect(withHumanAgent.needsHumanAgentTag).toBe(true);
      expect(withHumanAgent.reason).toBe("human_agent");

      // Bot / AI gönderimi pencere dışında HUMAN_AGENT kullanamaz
      const botAttempt = getWindowState({
        channel: "INSTAGRAM",
        lastIncomingAt: at3Days,
        now,
        humanAgentEnabled: true,
        byHuman: false,
      });
      expect(botAttempt.canFreeform).toBe(false);
      expect(botAttempt.reason).toBe("closed");

      // 7 gün 1 saat sonra insan yanıtı da kapanır
      const at7d1h = new Date(now.getTime() - (7 * 24 + 1) * 3600_000);
      const expiredHuman = getWindowState({
        channel: "INSTAGRAM",
        lastIncomingAt: at7d1h,
        now,
        humanAgentEnabled: true,
        byHuman: true,
      });
      expect(expiredHuman.canFreeform).toBe(false);
      expect(expiredHuman.reason).toBe("closed");
    });

    it("hiç gelen mesaj yoksa serbest metne izin vermez", () => {
      const never = getWindowState({ channel: "INSTAGRAM", lastIncomingAt: null, now });
      expect(never.canFreeform).toBe(false);
      expect(never.reason).toBe("never_messaged");
    });
  });

  describe("rules.ts (Opt-Out, Konuşma Çözümleyici, Hazır Yanıt Sıralaması, Hata Sınıflandırma, Webhook Parse)", () => {
    it("Türkçe yerel ayarla (İPTAL -> iptal) opt-out kelimelerini yakalar", () => {
      expect(detectOptOutKeyword("DUR").isOptOut).toBe(true);
      expect(detectOptOutKeyword("dur.").isOptOut).toBe(true);
      expect(detectOptOutKeyword(" Stop ").isOptOut).toBe(true);
      expect(detectOptOutKeyword("İPTAL!").isOptOut).toBe(true);
      expect(detectOptOutKeyword("Abonelikten Çık").isOptOut).toBe(true);
      expect(detectOptOutKeyword("Durum nedir?").isOptOut).toBe(false);
    });

    it("konuşma çözümleyici açık konuşmayı korur, çözülmüş konuşmayı ayara göre yeniden açar veya yeni açar", () => {
      expect(resolveConversationAction({ existingStatus: "open", reopenOnNewMessage: true }).action).toBe("reuse_open");
      expect(resolveConversationAction({ existingStatus: "resolved", reopenOnNewMessage: true }).action).toBe("reopen_existing");
      expect(resolveConversationAction({ existingStatus: "resolved", reopenOnNewMessage: false }).action).toBe("create_new");
    });

    it("hazır yanıtları 1.0 (önek) > 0.5 (kısa kod içerir) > 0.2 (içerik içerir) sırasıyla puanlar", () => {
      const items = [
        { id: "1", shortCode: "fiyat", content: "Standart liste" },
        { id: "2", shortCode: "kampanya-fiyat", content: "Özel liste" },
        { id: "3", shortCode: "merhaba", content: "Fiyat bilgisi için yazın" },
      ];
      const ranked = searchCannedResponses(items, "fiyat");
      expect(ranked.map((r) => r.id)).toEqual(["1", "2", "3"]);
      expect(ranked.map((r) => r.score)).toEqual([1.0, 0.5, 0.2]);

      const text = interpolateCannedResponse("Merhaba {{kisi.ad}}, ben {{temsilci.ad}} ({{marka.ad}})", {
        kisiAd: "Ayşe",
        temsilciAd: "Şahin",
        markaAd: "NordVow",
      });
      expect(text).toBe("Merhaba Ayşe, ben Şahin (NordVow)");
    });

    it("Meta API hata kodlarını (190 reauth, 10/100/200/551 kalıcı, 1/2/4/17/32/613/5xx geçici) sınıflandırır", () => {
      expect(classifyMetaSendError({ code: 190 }).category).toBe("reauth");
      expect(classifyMetaSendError({ code: 10 }).category).toBe("permanent");
      expect(classifyMetaSendError({ code: 100 }).category).toBe("permanent");
      expect(classifyMetaSendError({ code: 200 }).category).toBe("permanent");
      expect(classifyMetaSendError({ code: 551 }).category).toBe("permanent");
      expect(classifyMetaSendError({ code: 4 }).category).toBe("transient");
      expect(classifyMetaSendError({ code: 613 }).category).toBe("transient");
      expect(classifyMetaSendError({ httpStatus: 503 }).category).toBe("transient");
    });

    it("AI yanıt önerisi Zod şemasını doğrular ve PII maskeler", () => {
      const valid = aiSuggestionResponseSchema.safeParse({
        suggestions: [{ text: "Merhaba, hemen kontrol ediyoruz.", tone: "kisa" }],
      });
      expect(valid.success).toBe(true);

      const invalid = aiSuggestionResponseSchema.safeParse({ suggestions: [] });
      expect(invalid.success).toBe(false);

      const redacted = redactPiiForAi("Bana +90 532 111 22 33 veya ayse@example.com üzerinden ulaşın");
      expect(redacted).toContain("[gizli-telefon]");
      expect(redacted).toContain("[gizli-eposta]");
    });

    it("WhatsApp webhook value içinde tracking_events-only yükünü yok sayar; mesaj ve failed status ayrıştırır", () => {
      const trackingOnly = parseWhatsAppWebhookValue({ tracking_events: [{ event: " click" }] });
      expect(trackingOnly.ignoredTrackingOnly).toBe(true);

      const parsed = parseWhatsAppWebhookValue({
        metadata: { phone_number_id: "10999888" },
        contacts: [{ wa_id: "905320001122", profile: { name: "Mehmet Demir" } }],
        messages: [
          { id: "wamid.1", from: "905320001122", timestamp: "1795000000", type: "text", text: { body: "Merhaba" } },
          { id: "wamid.2", from: "905320001122", timestamp: "1795000005", type: "image", image: { id: "med_1", caption: "Ürün" } },
        ],
        statuses: [
          {
            id: "wamid.out.1",
            status: "failed",
            timestamp: "1795000010",
            errors: [{ code: 131047, title: "Re-engagement message" }],
          },
        ],
      });
      expect(parsed.ignoredTrackingOnly).toBe(false);
      expect(parsed.phoneNumberId).toBe("10999888");
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0]!.contactName).toBe("Mehmet Demir");
      expect(parsed.messages[1]!.kind).toBe("IMAGE");
      expect(parsed.statuses[0]!.status).toBe("failed");
      expect(parsed.statuses[0]!.externalError).toContain("131047");
    });
  });
});

