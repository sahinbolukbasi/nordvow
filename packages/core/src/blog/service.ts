import { prisma } from "../db";
import type { BlogAudience, BlogStatus } from "../enums";
import { DomainError } from "../domain/errors";

export const BLOG_CATEGORIES = [
  "Influencer Pazarlama",
  "Marka Stratejisi",
  "İçerik Üretimi",
  "Kargo & Lojistik",
  "SEO & Büyüme",
] as const;

export const BLOG_AUDIENCE_LABELS: Record<BlogAudience, string> = {
  ALL: "Herkes (Marka & Influencer)",
  INFLUENCER: "Influencerlar",
  BRAND: "Markalar",
};

const TR_CHAR_MAP: Record<string, string> = {
  ç: "c",
  Ç: "c",
  ğ: "g",
  Ğ: "g",
  ı: "i",
  İ: "i",
  ö: "o",
  Ö: "o",
  ş: "s",
  Ş: "s",
  ü: "u",
  Ü: "u",
};

export function slugifyTurkish(text: string): string {
  const replaced = text
    .trim()
    .split("")
    .map((ch) => TR_CHAR_MAP[ch] ?? ch)
    .join("")
    .toLowerCase();
  return (
    replaced
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || "yazi"
  );
}

export function estimateReadingTimeMin(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

async function ensureUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
  const clean = slugifyTurkish(baseSlug);
  let candidate = clean;
  for (let i = 2; i < 100; i++) {
    const existing = await prisma.blogPost.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${clean}-${i}`;
  }
  return `${clean}-${Date.now()}`;
}

export async function listPublishedBlogPosts(opts?: {
  category?: string | null;
  audience?: BlogAudience | null;
  query?: string | null;
  limit?: number;
}) {
  const q = opts?.query?.trim();
  const cat = opts?.category?.trim();
  return prisma.blogPost.findMany({
    where: {
      status: "PUBLISHED",
      ...(cat ? { category: cat } : {}),
      ...(opts?.audience && opts.audience !== "ALL"
        ? { targetAudience: { in: [opts.audience, "ALL"] } }
        : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { excerpt: { contains: q, mode: "insensitive" } },
              { category: { contains: q, mode: "insensitive" } },
              { tags: { has: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    take: opts?.limit ?? 60,
  });
}

export async function getPublishedBlogPostBySlug(slug: string) {
  return prisma.blogPost.findFirst({
    where: { slug, status: "PUBLISHED" },
  });
}

export async function listRelatedBlogPosts(postId: string, category: string, limit = 3) {
  return prisma.blogPost.findMany({
    where: {
      id: { not: postId },
      status: "PUBLISHED",
      category,
    },
    orderBy: [{ viewCount: "desc" }, { publishedAt: "desc" }],
    take: limit,
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      category: true,
      readingTimeMin: true,
      viewCount: true,
      publishedAt: true,
    },
  });
}

export async function listAllBlogPostsForAdmin() {
  return prisma.blogPost.findMany({
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
  });
}

export async function getBlogAnalyticsSummary() {
  const posts = await prisma.blogPost.findMany({
    select: {
      status: true,
      viewCount: true,
      readCount: true,
      totalReadSeconds: true,
    },
  });
  const totalPosts = posts.length;
  const publishedPosts = posts.filter((p) => p.status === "PUBLISHED").length;
  const draftPosts = totalPosts - publishedPosts;
  const totalViews = posts.reduce((s, p) => s + p.viewCount, 0);
  const totalReads = posts.reduce((s, p) => s + p.readCount, 0);
  const totalReadSeconds = posts.reduce((s, p) => s + p.totalReadSeconds, 0);
  const avgReadSeconds = totalReads > 0 ? Math.round(totalReadSeconds / totalReads) : 0;
  const completionRate = totalViews > 0 ? Math.min(100, Math.round((totalReads / totalViews) * 100)) : 0;

  return {
    totalPosts,
    publishedPosts,
    draftPosts,
    totalViews,
    totalReads,
    avgReadSeconds,
    completionRate,
  };
}

export type BlogPostInput = {
  title: string;
  slug?: string | null;
  excerpt: string;
  content: string;
  coverImageUrl?: string | null;
  category?: string | null;
  tags?: string[];
  targetAudience?: BlogAudience;
  status?: BlogStatus;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoKeywords?: string[];
  authorName?: string | null;
};

export async function createBlogPost(input: BlogPostInput) {
  const title = input.title.trim();
  const excerpt = input.excerpt.trim();
  const content = input.content.trim();
  if (title.length < 3) throw new DomainError("DOGRULAMA", "Başlık en az 3 karakter olmalı.");
  if (excerpt.length < 10) throw new DomainError("DOGRULAMA", "Özet en az 10 karakter olmalı.");
  if (content.length < 20) throw new DomainError("DOGRULAMA", "İçerik en az 20 karakter olmalı.");

  const slug = await ensureUniqueSlug(input.slug?.trim() || title);
  const status: BlogStatus = input.status ?? "DRAFT";
  const readingTimeMin = estimateReadingTimeMin(content);

  return prisma.blogPost.create({
    data: {
      slug,
      title,
      excerpt,
      content,
      coverImageUrl: input.coverImageUrl?.trim() || null,
      category: input.category?.trim() || "Influencer Pazarlama",
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
      targetAudience: input.targetAudience ?? "ALL",
      status,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
      seoKeywords: (input.seoKeywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 15),
      authorName: input.authorName?.trim() || "Nordvow Editör",
      readingTimeMin,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
  });
}

export async function updateBlogPost(id: string, input: BlogPostInput) {
  const existing = await prisma.blogPost.findUnique({ where: { id } });
  if (!existing) throw new DomainError("BULUNAMADI", "Blog yazısı bulunamadı.");

  const title = input.title.trim();
  const excerpt = input.excerpt.trim();
  const content = input.content.trim();
  if (title.length < 3) throw new DomainError("DOGRULAMA", "Başlık en az 3 karakter olmalı.");
  if (excerpt.length < 10) throw new DomainError("DOGRULAMA", "Özet en az 10 karakter olmalı.");
  if (content.length < 20) throw new DomainError("DOGRULAMA", "İçerik en az 20 karakter olmalı.");

  const slug = await ensureUniqueSlug(input.slug?.trim() || existing.slug || title, id);
  const status: BlogStatus = input.status ?? existing.status;
  const readingTimeMin = estimateReadingTimeMin(content);

  return prisma.blogPost.update({
    where: { id },
    data: {
      slug,
      title,
      excerpt,
      content,
      coverImageUrl: input.coverImageUrl?.trim() || null,
      category: input.category?.trim() || existing.category,
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
      targetAudience: input.targetAudience ?? existing.targetAudience,
      status,
      seoTitle: input.seoTitle?.trim() || null,
      seoDescription: input.seoDescription?.trim() || null,
      seoKeywords: (input.seoKeywords ?? []).map((k) => k.trim()).filter(Boolean).slice(0, 15),
      authorName: input.authorName?.trim() || existing.authorName,
      readingTimeMin,
      publishedAt:
        status === "PUBLISHED" ? (existing.publishedAt ?? new Date()) : null,
    },
  });
}

export async function deleteBlogPost(id: string) {
  await prisma.blogPost.delete({ where: { id } });
}

export async function trackBlogEvent(
  slug: string,
  event: "view" | "read",
  durationSeconds?: number,
) {
  const post = await prisma.blogPost.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!post || post.status !== "PUBLISHED") return null;

  if (event === "view") {
    return prisma.blogPost.update({
      where: { id: post.id },
      data: {
        viewCount: { increment: 1 },
        lastReadAt: new Date(),
      },
      select: { viewCount: true, readCount: true },
    });
  }

  const safeDuration = Math.max(0, Math.min(3600, Math.round(durationSeconds ?? 0)));
  return prisma.blogPost.update({
    where: { id: post.id },
    data: {
      readCount: { increment: 1 },
      totalReadSeconds: { increment: safeDuration },
      lastReadAt: new Date(),
    },
    select: { viewCount: true, readCount: true },
  });
}

const STARTER_POSTS: BlogPostInput[] = [
  {
    title: "2026'da Markalar İçin Yüksek Dönüşümlü Influencer Pazarlama Rehberi",
    slug: "markalar-icin-yuksek-donusumlu-influencer-pazarlama-rehberi",
    excerpt:
      "Doğru influencer seçimi, net brief hazırlama, KPI belirleme ve kampanya ROI ölçümünü adım adım öğrenin.",
    category: "Marka Stratejisi",
    targetAudience: "BRAND",
    status: "PUBLISHED",
    tags: ["influencer pazarlama", "marka stratejisi", "roi", "kampanya yönetimi"],
    seoTitle: "Markalar İçin Influencer Pazarlama Rehberi | ROI & Brief Stratejisi",
    seoDescription:
      "Markanız için doğru influencerları seçme, etkili brief yazma ve gerçek zamanlı dönüşüm ölçme teknikleri.",
    seoKeywords: [
      "influencer pazarlama",
      "influencer ajansı",
      "marka işbirliği",
      "kampanya roi",
    ],
    content: `## Neden Influencer Pazarlama Hâlâ En Güçlü Kanal?

Dijital reklamlarda artan maliyetler ve reklam engelleyiciler, markaları tüketicinin güvendiği gerçek seslere yönlendiriyor. Doğru kurgulanmış bir influencer işbirliği yalnızca bilinirlik değil, doğrudan ölçülebilir satış ve sadakat üretir.

## 1. Hedefe Göre Doğru Influencer Segmenti

- **Nano & Mikro Influencerlar (5K–50K):** Niş topluluklarda yüksek etkileşim ve güven oranı sunar. Ürün deneme ve kargo gönderimli kampanyalarda idealdir.
- **Orta Ölçekli (50K–250K):** Hem erişim hem de dönüşüm dengesini korur.
- **Makro & Mega (250K+):** Hızlı lansman ve geniş marka bilinirliği için tercih edilir.

## 2. Net Brief ve Ölçülebilir KPI

Başarılı bir kampanyanın temeli net bir brief'tir. Marka mesajı, yapılacaklar/yapılmayacaklar listesi, UTM bağlantıları ve kupon kodları kampanya başında netleştirilmelidir.

## 3. Teslimat ve Performans Takibi

Ürün gönderimli kampanyalarda kargo sürecinin şeffaf takibi içeriklerin zamanında yayına girmesini sağlar. Yayına giren her Reels, TikTok ve YouTube içeriğinin 24 saat, 7 gün ve 30 günlük metriklerini karşılaştırarak bir sonraki kampanya bütçenizi optimize edebilirsiniz.`,
  },
  {
    title: "Influencerlar İçin Marka İşbirliklerinden Düzenli Gelir Elde Etmenin 5 Yolu",
    slug: "influencerlar-icin-marka-isbirliklerinden-duzenli-gelir-yollari",
    excerpt:
      "Profilinizi markalar için cazip hale getirin, medya kitinizi güçlendirin ve tek seferlik anlaşmaları uzun vadeli işbirliklerine dönüştürün.",
    category: "Influencer Pazarlama",
    targetAudience: "INFLUENCER",
    status: "PUBLISHED",
    tags: ["influencer", "içerik üreticisi", "marka anlaşmaları", "medya kiti"],
    seoTitle: "Influencerlar İçin Marka İşbirliği ve Gelir Rehberi",
    seoDescription:
      "İçerik üreticilerinin markalarla profesyonel çalışması, fiyatlandırma yapması ve düzenli işbirliği alması için pratik ipuçları.",
    seoKeywords: [
      "influencer işbirliği",
      "içerik üreticisi gelir",
      "medya kiti",
      "sponsorlu içerik",
    ],
    content: `## Markalar Sadece Takipçi Sayısına Bakmıyor

Günümüzde markalar takipçi sayısından çok **etkileşim oranı**, **hedef kitle uyumu** ve **içerik kalitesine** odaklanıyor. Küçük ama sadık bir kitleye sahip olmak sizi markalar için çok değerli kılar.

## 1. Nişinizi ve İçerik Dilinizi Netleştirin

Hangi kategoride (güzellik, teknoloji, moda, yaşam tarzı, anne-çocuk vb.) uzmanlaştığınızı profilinizde net gösterin.

## 2. Güncel İstatistik ve Vitrini Açık Tutun

Instagram, TikTok ve YouTube hesaplarınızı düzenli senkronize etmek, markaların güncel izlenme ve etkileşim verilerinizi tek ekranda görmesini sağlar.

## 3. Zamanında Teslim ve Profesyonel İletişim

Ürün kargosu elinize ulaştığında çekimi planlamak, brief kurallarına uymak ve taslağı zamanında yüklemek aynı markadan tekrar teklif almanın en hızlı yoludur.`,
  },
  {
    title: "Ürün Gönderimli Kampanyalarda Kargo ve Lojistik Süreçlerini Hızlandırma",
    slug: "urun-gonderimli-kampanyalarda-kargo-ve-lojistik-surecleri",
    excerpt:
      "Onlarca influencera aynı anda ürün gönderirken adres toplama, barkod oluşturma ve teslimat takibini hatasız yönetin.",
    category: "Kargo & Lojistik",
    targetAudience: "ALL",
    status: "PUBLISHED",
    tags: ["kargo takibi", "ürün gönderimi", "lojistik", "pr kutusu"],
    seoTitle: "Influencer Ürün Gönderimi ve Kargo Takibi Nasıl Yönetilir?",
    seoDescription:
      "Markalar ve ajanslar için influencer ürün gönderimi, adres onayı ve toplu kargo takip süreçlerini otomatikleştirme rehberi.",
    seoKeywords: [
      "influencer kargo",
      "ürün gönderimi",
      "pr gönderimi takibi",
      "toplu kargo",
    ],
    content: `## Manuel Excel Listelerinden Otomatik Kargo Takibine

Influencerlara ürün gönderilen kampanyalarda en büyük zaman kaybı adres toplama, telefon doğrulama ve kargo takip numaralarını tek tek paylaşmaktır.

## Adım Adım Sorunsuz Ürün Gönderimi

1. **Teklif Kabulünde Adres & Varyant:** Influencer işbirliğini onaylarken beden, renk ve güncel teslimat adresini seçer.
2. **Toplu Barkod ve Takip:** Marka veya ajans, adresi onaylanan gönderiler için tek tıkla kargo kaydı oluşturur.
3. **Teslimata Bağlı İçerik Kuralı:** Ürün influencera teslim edildiği anda içerik yükleme aşaması aktif olur; böylece tüm süreç kayıt altında ilerler.`,
  },
];

export async function seedStarterBlogPosts() {
  let created = 0;
  for (const post of STARTER_POSTS) {
    const exists = await prisma.blogPost.findUnique({
      where: { slug: post.slug! },
      select: { id: true },
    });
    if (!exists) {
      await createBlogPost(post);
      created++;
    }
  }
  return { created, total: STARTER_POSTS.length };
}

