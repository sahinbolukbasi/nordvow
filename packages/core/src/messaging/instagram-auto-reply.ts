import { prisma } from "../db";

export type InstagramMatchMode = "contains" | "exact" | "always";

export type InstagramAutoReplyRule = {
  id: string;
  title: string;
  keywords: string[];
  reply: string;
  enabled: boolean;
  matchMode: InstagramMatchMode;
};

const DEFAULT_RULES: InstagramAutoReplyRule[] = [
  {
    id: "ig-fiyat-teklif",
    title: "Fiyat ve Teklif Soruları",
    keywords: ["fiyat", "ücret", "ucret", "teklif", "bütçe", "butce", "iş birliği", "is birligi"],
    reply:
      "Merhaba! Teklif ve iş birliği detayları için Nordvow panelinizdeki Teklifler bölümünü inceleyebilir veya marka/kampanya adınızı paylaşabilirsiniz; ekibimiz en kısa sürede dönüş yapacaktır.",
    enabled: true,
    matchMode: "contains",
  },
  {
    id: "ig-odeme-bakiye",
    title: "Ödeme ve Çekim Soruları",
    keywords: ["ödeme", "odeme", "para", "bakiye", "iban", "çekim", "cekim"],
    reply:
      "Merhaba! Ödeme ve çekim taleplerinizi Nordvow hesabınızdaki Profil → Ödemelerim ekranından takip edebilirsiniz.",
    enabled: true,
    matchMode: "contains",
  },
  {
    id: "ig-hos-geldin",
    title: "Genel Karşılama (Varsayılan Hazır Cevap)",
    keywords: ["merhaba", "selam", "hey", "bilgi", "yardım", "yardim"],
    reply:
      "Merhaba! Nordvow'a hoş geldiniz. Mesajınızı aldık; kampanya, teklif veya hesap işlemlerinizle ilgili talebinizi yazabilirsiniz, ekibimiz hızlıca yanıtlayacaktır.",
    enabled: true,
    matchMode: "always",
  },
];

function configKey(tenantId: string): string {
  return `ig.auto_replies.${tenantId}`;
}

export async function getInstagramAutoReplies(tenantId: string): Promise<InstagramAutoReplyRule[]> {
  const row = await prisma.configValue.findUnique({ where: { key: configKey(tenantId) } });
  const raw = row?.value;
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_RULES;
  }
  return raw.filter(
    (r): r is InstagramAutoReplyRule =>
      Boolean(r && typeof r === "object" && typeof (r as InstagramAutoReplyRule).reply === "string"),
  );
}

export async function saveInstagramAutoReplies(
  tenantId: string,
  rules: InstagramAutoReplyRule[],
): Promise<InstagramAutoReplyRule[]> {
  const sanitized = rules.map((r) => ({
    id: r.id.trim() || `ig-${Date.now()}`,
    title: r.title.trim() || "Hazır Cevap",
    keywords: r.keywords.map((k) => k.trim().toLocaleLowerCase("tr-TR")).filter(Boolean),
    reply: r.reply.trim(),
    enabled: Boolean(r.enabled),
    matchMode: (r.matchMode === "exact" || r.matchMode === "always" ? r.matchMode : "contains") as InstagramMatchMode,
  }));

  await prisma.configValue.upsert({
    where: { key: configKey(tenantId) },
    create: { key: configKey(tenantId), value: sanitized },
    update: { value: sanitized },
  });
  return sanitized;
}

/**
 * Gelen Instagram mesajı için Nordvow tarafında tanımlı hazır cevap kurallarını eşleştirir.
 * Öncelik sırası: exact -> contains -> always.
 */
export async function matchInstagramAutoReply(
  tenantId: string,
  inboundText: string,
): Promise<InstagramAutoReplyRule | null> {
  const text = inboundText.trim().toLocaleLowerCase("tr-TR");
  if (!text) return null;

  const rules = (await getInstagramAutoReplies(tenantId)).filter((r) => r.enabled && r.reply.trim().length > 0);
  if (rules.length === 0) return null;

  for (const r of rules) {
    if (r.matchMode === "exact" && r.keywords.some((kw) => kw === text)) {
      return r;
    }
  }
  for (const r of rules) {
    if (r.matchMode === "contains" && r.keywords.some((kw) => text.includes(kw))) {
      return r;
    }
  }
  for (const r of rules) {
    if (r.matchMode === "always") {
      if (r.keywords.length === 0 || r.keywords.some((kw) => text.includes(kw))) {
        return r;
      }
      return r;
    }
  }
  return null;
}

