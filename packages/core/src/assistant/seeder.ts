import { prisma } from "../db";
import { assertSafeOutboundUrl } from "../security/outbound-url";
import { ingestText, type SourceType } from "./rag";

/**
 * C1: Otomatik bilgi tabanı tohumlama (3 kaynak):
 * 1) Marka profili (ad, sektör, iletişim, kargo/iade çerçevesi)
 * 2) Aktif kampanyalar (ad, tarih, kupon, brief özeti)
 * 3) Marka web sitesi (yalnızca aynı alan adı + robots.txt uyumlu SSS/kargo/iade/iletişim sayfaları)
 *
 * Üretilen TÜM maddeler `status: "draft"` olarak kaydedilir; marka onaylamadan RAG'da KULLANILMAZ.
 */

export interface SeedDraftItem {
  type: SourceType;
  title: string;
  text: string;
}

export interface SeedResult {
  createdCount: number;
  sourcesChecked: { profile: boolean; campaigns: number; websitePages: number };
  items: { sourceId: string; title: string; type: SourceType }[];
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Basit robots.txt ayrıştırıcı: User-agent: * altındaki Disallow kurallarına uyar. */
export function isPathAllowedByRobots(robotsTxt: string, pathname: string): boolean {
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let activeForAll = false;
  const disallows: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const ua = /^user-agent:\s*(.+)$/i.exec(line);
    if (ua) {
      const target = ua[1]!.trim().toLowerCase();
      activeForAll = target === "*" || target.includes("nordvow");
      continue;
    }
    if (!activeForAll) continue;
    const dis = /^disallow:\s*(.*)$/i.exec(line);
    if (dis) {
      const rule = dis[1]!.trim();
      if (rule) disallows.push(rule);
    }
  }
  return !disallows.some((rule) => rule === "/" || pathname.startsWith(rule));
}

async function safeFetchPage(urlStr: string, expectedHost: string): Promise<string | null> {
  try {
    const parsed = await assertSafeOutboundUrl(urlStr, { allowHttp: true });
    if (parsed.hostname.toLowerCase() !== expectedHost.toLowerCase()) return null;
    const res = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "NordvowBot/1.0 (+https://nordvow.com)" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return null;
    const text = await res.text();
    return text.slice(0, 120_000);
  } catch {
    return null;
  }
}

async function crawlBrandWebsiteDrafts(websiteUrl: string): Promise<SeedDraftItem[]> {
  const out: SeedDraftItem[] = [];
  let base: URL;
  try {
    base = await assertSafeOutboundUrl(websiteUrl, { allowHttp: true });
  } catch {
    return out;
  }

  const host = base.hostname.toLowerCase();
  const robotsText = (await safeFetchPage(`${base.origin}/robots.txt`, host)) ?? "";

  const candidatePaths: { path: string; title: string }[] = [
    { path: "/sss", title: "Web sitesi · Sıkça Sorulan Sorular" },
    { path: "/faq", title: "Web sitesi · SSS" },
    { path: "/kargo", title: "Web sitesi · Kargo Politikası" },
    { path: "/kargo-ve-teslimat", title: "Web sitesi · Kargo ve Teslimat" },
    { path: "/iade", title: "Web sitesi · İade Politikası" },
    { path: "/iade-kosullari", title: "Web sitesi · İade Koşulları" },
    { path: "/iletisim", title: "Web sitesi · İletişim" },
  ];

  for (const cand of candidatePaths) {
    if (out.length >= 4) break;
    if (robotsText && !isPathAllowedByRobots(robotsText, cand.path)) continue;
    const html = await safeFetchPage(`${base.origin}${cand.path}`, host);
    if (!html) continue;
    const clean = stripHtmlToText(html);
    if (clean.length < 80) continue;
    out.push({
      type: "website",
      title: cand.title,
      text: clean.slice(0, 2500),
    });
  }

  // Alt sayfalar bulunamadıysa ana sayfadan özet çıkar
  if (out.length === 0 && (!robotsText || isPathAllowedByRobots(robotsText, base.pathname || "/"))) {
    const html = await safeFetchPage(base.toString(), host);
    if (html) {
      const clean = stripHtmlToText(html);
      if (clean.length >= 80) {
        out.push({
          type: "website",
          title: `Web sitesi · ${host}`,
          text: clean.slice(0, 2500),
        });
      }
    }
  }

  return out;
}

export async function seedBrandKnowledgeDrafts(
  tenantId: string,
  opts?: { websiteUrl?: string | null },
): Promise<SeedResult> {
  const [brand, coupons] = await Promise.all([
    prisma.brand.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        category: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
        country: true,
        campaigns: {
          where: { status: { in: ["AKTIF", "TASLAK"] } },
          orderBy: { updatedAt: "desc" },
          take: 5,
          select: {
            id: true,
            name: true,
            status: true,
            objective: true,
            description: true,
            startsAt: true,
            endsAt: true,
            briefs: { orderBy: { version: "desc" }, take: 1, select: { text: true, hashtags: true, dos: true, donts: true } },
          },
        },
      },
    }),
    prisma.coupon.findMany({
      where: { tenantId, status: "YAYINDA" },
      take: 5,
      select: { title: true, sharedCode: true, valueType: true, value: true, validUntil: true },
    }),
  ]);

  if (!brand) throw new Error("Marka bulunamadı.");

  const drafts: SeedDraftItem[] = [];

  // 1) Marka profili taslakları
  drafts.push({
    type: "brand_profile",
    title: "Marka Profili ve İletişim",
    text: [
      `${brand.name}, ${brand.category || "genel"} sektöründe faaliyet gösteren markadır.`,
      brand.contactEmail ? `İletişim e-postası: ${brand.contactEmail}.` : "",
      brand.contactPhone ? `İletişim telefonu: ${brand.contactPhone}.` : "",
      `Müşteri soruları mesai saatleri içinde yanıtlanır; özel talepler için marka ekibiyle iletişime geçilebilir.`,
    ]
      .filter(Boolean)
      .join(" "),
  });

  drafts.push({
    type: "brand_profile",
    title: "Kargo ve İade Politikası (Taslak)",
    text: `${brand.name} siparişleri onaylandıktan sonra kargoya verilir. Kargo takibi için sipariş veya takip numaranızı paylaşabilirsiniz. İade ve değişim taleplerinde ürün kullanılmamış ve orijinal ambalajında olmalıdır; kesin süre ve koşulları onaylamadan önce bu taslağı güncelleyin.`,
  });

  drafts.push({
    type: "brand_profile",
    title: "Influencer İş Birliği ve Başvuru",
    text: `${brand.name} ile içerik üreticisi (influencer) iş birliği yapmak isteyen adaylar Nordvow üzerinden ücretsiz profil oluşturup sosyal medya hesaplarını bağlayarak açık kampanyalara başvurabilir.`,
  });

  // 2) Aktif kampanya & kupon taslakları
  let campaignCount = 0;
  for (const camp of brand.campaigns) {
    campaignCount++;
    const startStr = camp.startsAt.toLocaleDateString("tr-TR");
    const endStr = camp.endsAt.toLocaleDateString("tr-TR");
    const brief = camp.briefs[0];
    drafts.push({
      type: "campaign",
      title: `Kampanya · ${camp.name}`,
      text: [
        `${camp.name} kampanyası ${startStr} – ${endStr} tarihleri arasında planlanmıştır.`,
        camp.description ? camp.description : "",
        brief?.text ? `Brief özeti: ${brief.text.slice(0, 600)}` : "",
        brief?.hashtags?.length ? `Etiketler: ${brief.hashtags.join(" ")}` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });

    // Influencer asistanı için ayrı kapsamlı brief kaynağı (yalnız influencer_brief)
    if (brief?.text) {
      drafts.push({
        type: "influencer_brief",
        title: `Influencer Brief · ${camp.name}`,
        text: [
          `Kampanya: ${camp.name} (${startStr} – ${endStr}).`,
          `Brief: ${brief.text.slice(0, 1200)}`,
          brief.dos.length ? `Yapılacaklar: ${brief.dos.join("; ")}.` : "",
          brief.donts.length ? `Yapılmayacaklar: ${brief.donts.join("; ")}.` : "",
          brief.hashtags.length ? `Zorunlu hashtag'ler: ${brief.hashtags.join(" ")}.` : "",
          `Yasal uyarı (md. 23/A): İçeriğin ilk anında ve diğer etiketlerden önce "Reklam" veya "Tanıtım" ibaresi ile marka adı açıkça görünmelidir.`,
        ]
          .filter(Boolean)
          .join(" "),
      });
    }
  }

  if (coupons.length > 0) {
    const couponLines = coupons
      .filter((cp) => Boolean(cp.sharedCode))
      .map((cp) => {
        const val = cp.valueType === "YUZDE" ? `%${Number(cp.value)}` : `${(Number(cp.value) / 100).toLocaleString("tr-TR")} TL`;
        const exp = cp.validUntil ? ` (son geçerlilik: ${cp.validUntil.toLocaleDateString("tr-TR")})` : "";
        return `Kod: ${cp.sharedCode} (${cp.title}) — ${val} indirim${exp}`;
      });
    if (couponLines.length > 0) {
      drafts.push({
        type: "campaign",
        title: "Aktif İndirim Kuponları",
        text: `${brand.name} aktif kampanya kupon kodları: ${couponLines.join(" | ")}. Yalnızca burada yer alan onaylı kupon kodları geçerlidir.`,
      });
    }
  }

  // 3) Web sitesi taslakları (robots.txt + aynı alan adı + SSRF güvenli)
  let websitePages = 0;
  if (opts?.websiteUrl?.trim()) {
    const webDrafts = await crawlBrandWebsiteDrafts(opts.websiteUrl.trim());
    websitePages = webDrafts.length;
    drafts.push(...webDrafts);
  }

  const created: { sourceId: string; title: string; type: SourceType }[] = [];
  for (const item of drafts) {
    const uri = `${item.type}://${item.title}`;
    // Aynı URI ile zaten taslak/hazır kayıt varsa tekrar oluşturma (idempotent)
    const exists = await prisma.knowledgeSource.findFirst({
      where: { tenantId, uri, status: { in: ["draft", "ready", "approved"] } },
      select: { id: true },
    });
    if (exists) continue;
    const res = await ingestText(tenantId, {
      type: item.type,
      uri,
      text: item.text,
      status: "draft",
    });
    created.push({ sourceId: res.sourceId, title: item.title, type: item.type });
  }

  return {
    createdCount: created.length,
    sourcesChecked: { profile: true, campaigns: campaignCount, websitePages },
    items: created,
  };
}
