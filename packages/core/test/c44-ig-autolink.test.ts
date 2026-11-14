import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { autoLinkSender } from "../src/bot/link";
import { setIgIdentity } from "../src/bot/ig-identity";
import { canonicalPhone, phonesMatch } from "../src/bot/tokens";
import { DomainError } from "../src/domain/errors";
import { assertUniqueInstagramHandle, normalizeSocialHandle } from "../src/social/handles";
import { IG_PROFESSIONAL_HINT, instagramDiscoveryFailure, setSocialProvider, syncSocialAccount, type SocialProvider } from "../src/social/sync";
import { resetDb } from "./helpers";

async function influencer(email: string, handle: string, phone?: string) {
  const inf = await prisma.influencer.create({
    data: { name: email, category: "moda", iban: "TR110000000000000000000099", ibanHolder: email, taxStatus: "STOPAJLI", canIssueInvoice: false },
  });
  const user = await prisma.user.create({
    data: { email, name: email, role: "INFLUENCER", phone: phone ?? null, passwordHash: "x", status: "ACTIVE", influencerId: inf.id },
  });
  if (handle) {
    await prisma.socialAccount.create({ data: { influencerId: inf.id, platform: "INSTAGRAM", handle, followers: 0, engagementRate: 0, demographics: {} } });
  }
  return { inf, user };
}

describe("telefon ve kullanıcı adı", () => {
  it("Türkiye öneklerini tek anahtara indirir", () => {
    expect(canonicalPhone("+90 532 111 22 33")).toBe("5321112233");
    expect(canonicalPhone("05321112233")).toBe("5321112233");
    expect(canonicalPhone("00905321112233")).toBe("5321112233");
    expect(phonesMatch("905321112233", "0532 111 22 33")).toBe(true);
    expect(normalizeSocialHandle("https://instagram.com/@Ayse/")).toBe("ayse");
    expect(normalizeSocialHandle("@AYSE")).toBe("ayse");
  });

  it("kişisel hesap hatasını Professional yönlendirmesine çevirir", () => {
    expect(instagramDiscoveryFailure("nonexisting field (business_discovery)")).toBe(true);
    expect(IG_PROFESSIONAL_HINT).toMatch(/Professional/);
  });
});

describe("otomatik bağlama", () => {
  beforeAll(async () => {
    await resetDb();
    setIgIdentity({
      async username(igsid) {
        if (igsid === "111") return { username: "Ayse", name: "Ayse" };
        if (igsid === "222") return { username: "@Cift", name: "Cift" };
        return null;
      },
    });
  });
  afterAll(() => {
    setIgIdentity(undefined);
    setSocialProvider(undefined);
  });

  it("WhatsApp tek telefonu bağlar, iki profili bağlamaz", async () => {
    const a = await influencer("wa-a@ex.com", "", "+90 532 000 11 22");
    const ok = await autoLinkSender("WHATSAPP", "905320001122", "905320001122");
    expect(ok.ok && ok.userId).toBe(a.user.id);
    const row = await prisma.channelAccountLink.findFirst({ where: { channel: "WHATSAPP", userId: a.user.id } });
    expect(row?.externalId).toBe("5320001122");
    await influencer("wa-b@ex.com", "", "05320001122");
    const clash = await autoLinkSender("WHATSAPP", "05320001122", "05320001122");
    expect(clash.ok).toBe(false);
  });

  it("Instagram kullanıcı adını tek profile bağlar", async () => {
    const a = await influencer("ig-a@ex.com", "@Ayse");
    const ok = await autoLinkSender("INSTAGRAM", "111");
    expect(ok.ok && ok.userId).toBe(a.user.id);
  });

  it("aynı Instagram adı iki profildeyse bağlamaz ve işaretler", async () => {
    await influencer("ig-b@ex.com", "cift");
    await influencer("ig-c@ex.com", "Cift");
    const clash = await autoLinkSender("INSTAGRAM", "222");
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.reason).toBe("birden fazla hesap");
    const flag = await prisma.botLinkFlag.findFirst({ where: { externalId: "222" } });
    expect(flag?.handle).toBe("cift");
    expect(flag?.userIds.length).toBe(2);
  });

  it("Messenger kullanıcı adıyla bağlanmaz", async () => {
    const r = await autoLinkSender("MESSENGER", "psid-1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/messenger/);
  });

  it("kayıt sırasında ikinci aynı adı reddeder ve senkron takipçiyi yazar", async () => {
    await expect(assertUniqueInstagramHandle(prisma, "@cift")).rejects.toBeInstanceOf(DomainError);
    const acc = await prisma.socialAccount.findFirstOrThrow({ where: { handle: "cift" } });
    const provider: SocialProvider = {
      async fetch() {
        return {
          externalId: "ig-1",
          followers: 1200,
          postsCount: 12,
          avgLikes: 40,
          avgComments: 4,
          avgViews: null,
          engagementRate: 0.036,
          profileUrl: "https://instagram.com/cift",
          avatarUrl: null,
          verified: true,
          displayName: "Cift",
          bioSnippet: "merhaba",
          source: "instagram_business_discovery",
        };
      },
    };
    setSocialProvider(provider);
    const result = await syncSocialAccount(acc.id);
    expect(result.ok).toBe(true);
    const saved = await prisma.socialAccount.findUniqueOrThrow({ where: { id: acc.id } });
    expect(saved.followers).toBe(1200);
    expect(saved.displayName).toBe("Cift");
    expect(saved.syncSource).toBe("instagram_business_discovery");
  });
});
