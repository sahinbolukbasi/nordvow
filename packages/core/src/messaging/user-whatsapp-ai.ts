import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import { envStr } from "../env";
import { converseChat, type ChatTurn } from "../llm/bedrock";
import { getAvailableCredits } from "../creative/credits";
import { AGENCY_TENANT } from "../creative/tenant";

function genCode(): string {
  return `NV-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function normalizeWaPhone(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

export async function getOrCreateWhatsAppLink(userId: string) {
  const existing = await prisma.whatsAppLink.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.whatsAppLink.create({
    data: { userId, pairingCode: genCode() },
  });
}

export async function regenerateWhatsAppCode(userId: string) {
  const code = genCode();
  return prisma.whatsAppLink.upsert({
    where: { userId },
    create: { userId, pairingCode: code },
    update: { pairingCode: code, waPhone: null, verified: false, verifiedAt: null, history: [] },
  });
}

export async function unlinkWhatsApp(userId: string) {
  return prisma.whatsAppLink.upsert({
    where: { userId },
    create: { userId, pairingCode: genCode() },
    update: { waPhone: null, verified: false, verifiedAt: null, pairingCode: genCode(), history: [] },
  });
}

async function sendPlatformWhatsAppReply(toPhone: string, text: string, phoneNumberId?: string) {
  const token = envStr("WHATSAPP_ACCESS_TOKEN", "");
  const pid = phoneNumberId || envStr("WHATSAPP_PHONE_NUMBER_ID", "");
  if (!token || !pid) {
    console.info(`[whatsapp-ai mock] -> ${toPhone}: ${text}`);
    return;
  }
  await fetch(`https://graph.facebook.com/v21.0/${pid}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhone,
      type: "text",
      text: { body: text.slice(0, 4000) },
    }),
    signal: AbortSignal.timeout(15_000),
  }).catch((e) => console.error("[whatsapp-ai] gönderim hatası:", (e as Error).message));
}

async function buildUserAccountContext(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, brandId: true, influencerId: true },
  });
  if (!user) return "Kullanıcı bulunamadı.";

  const tenantId =
    user.role === "BRAND" && user.brandId
      ? user.brandId
      : user.role === "INFLUENCER" && user.influencerId
        ? user.influencerId
        : AGENCY_TENANT;

  const [credits, campaigns, offers] = await Promise.all([
    getAvailableCredits(tenantId).catch(() => 0),
    user.role === "BRAND" && user.brandId
      ? prisma.campaign.findMany({ where: { brandId: user.brandId }, orderBy: { createdAt: "desc" }, take: 5, select: { name: true, status: true } })
      : prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { name: true, status: true } }),
    user.role === "INFLUENCER" && user.influencerId
      ? prisma.offer.findMany({ where: { influencerId: user.influencerId }, orderBy: { createdAt: "desc" }, take: 5, select: { title: true, status: true } })
      : Promise.resolve([]),
  ]);

  return [
    `Kullanıcı: ${user.name} (${user.email}) · Rol: ${user.role}`,
    `Creative AI Kullanılabilir Bakiye: ${credits.toFixed(0)} TL`,
    campaigns.length ? `Son Kampanyalar: ${campaigns.map((c) => `${c.name} [${c.status}]`).join(", ")}` : "Aktif kampanya yok.",
    offers.length ? `Son Teklifler: ${offers.map((o) => `${o.title} [${o.status}]`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Meta WhatsApp Cloud API webhook'undan gelen metin mesajlarını işler:
 * 1) Eşleştirme kodu (`NV-XXXXXX`) gelirse kullanıcı hesabıyla kalıcı eşleştirir.
 * 2) Zaten eşleşmiş hesapsa kullanıcıya özel AI Asistan olarak yanıtlar.
 */
export async function handleUserWhatsAppInbound(payload: unknown): Promise<boolean> {
  const root = payload as {
    entry?: {
      changes?: {
        value?: {
          metadata?: { phone_number_id?: string };
          messages?: { from?: string; type?: string; text?: { body?: string } }[];
        };
      }[];
    }[];
  };

  let handledAny = false;
  for (const entry of root?.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      const pid = ch.value?.metadata?.phone_number_id;
      for (const msg of ch.value?.messages ?? []) {
        if (msg.type !== "text" || !msg.from || !msg.text?.body) continue;
        const phone = normalizeWaPhone(msg.from);
        const body = msg.text.body.trim();

        // 1. Tek seferlik eşleştirme kodu kontrolü
        const codeMatch = /\b(NV-[A-Z0-9]{6})\b/i.exec(body);
        if (codeMatch) {
          const code = codeMatch[1]!.toUpperCase();
          const link = await prisma.whatsAppLink.findUnique({ where: { pairingCode: code } });
          if (link) {
            await prisma.whatsAppLink.update({
              where: { id: link.id },
              data: { waPhone: phone, verified: true, verifiedAt: new Date() },
            });
            await sendPlatformWhatsAppReply(
              phone,
              "WhatsApp hesabınız Nordvow profilinize kalıcı olarak bağlandı! Artık kampanyalarınız, teklifleriniz, Creative bakiyeniz ve sistem işlemleriniz hakkında buradan soru sorabilirsiniz.",
              pid,
            );
            handledAny = true;
            continue;
          }
        }

        // 2. Kalıcı eşleşmiş kullanıcı kontrolü
        const activeLink = await prisma.whatsAppLink.findFirst({ where: { waPhone: phone, verified: true } });
        if (!activeLink) continue;

        const ctx = await buildUserAccountContext(activeLink.userId);
        const prevHistory = Array.isArray(activeLink.history) ? (activeLink.history as ChatTurn[]).slice(-10) : [];
        const turns: ChatTurn[] = [...prevHistory, { role: "user", text: body }];

        let replyText = "";
        if (envStr("LLM_PROVIDER", "mock") === "bedrock") {
          try {
            const res = await converseChat({
              system: [
                "Sen Nordvow platformunun WhatsApp AI Asistanısın. Kullanıcının kendi hesabıyla ilişkilendirilmiş yardımcısı olarak Türkçe, net ve kısa yanıtlar ver.",
                "Güncel hesap özeti:",
                ctx,
              ].join("\n"),
              turns,
              maxTokens: 450,
              temperature: 0.4,
            });
            replyText = res.text;
          } catch (e) {
            console.warn("[whatsapp-ai] Bedrock hatası:", (e as Error).message);
          }
        }

        if (!replyText) {
          replyText = `Merhaba! Hesap özetiniz:\n${ctx}\n\nDetaylı işlem yapmak için https://nordvow.com üzerinden panelinize girebilir veya sorunuzu yazabilirsiniz.`;
        }

        const nextHistory = [...turns, { role: "assistant" as const, text: replyText }].slice(-12);
        await prisma.whatsAppLink.update({
          where: { id: activeLink.id },
          data: { history: nextHistory },
        });
        await sendPlatformWhatsAppReply(phone, replyText, pid);
        handledAny = true;
      }
    }
  }
  return handledAny;
}

