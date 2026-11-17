import type { Metadata } from "next";
import Link from "next/link";
import type { BlogAudience } from "@infulancer/core/enums";
import {
  BLOG_AUDIENCE_LABELS,
  BLOG_CATEGORIES,
  listPublishedBlogPosts,
} from "@infulancer/core/blog/service";
import { InAppBlogBrowser } from "@/components/blog/in-app-blog-browser";
import { getActor } from "@/lib/auth-guard";
import { BRAND_NAME } from "@/lib/brand";
import { fmtDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Blog & Influencer Pazarlama Rehberi`,
  description: `${BRAND_NAME} blog: markalar ve influencerlar için kampanya stratejileri, içerik üretimi, kargo lojistiği ve dijital büyüme rehberleri.`,
  alternates: { canonical: "/blog" },
  openGraph: {
    type: "website",
    title: `Blog · ${BRAND_NAME}`,
    description:
      "Markalar ve influencerlar için güncel influencer pazarlama stratejileri, vaka analizleri ve büyüme rehberleri.",
    url: "/blog",
  },
  twitter: {
    card: "summary_large_image",
    title: `Blog · ${BRAND_NAME}`,
    description:
      "Markalar ve influencerlar için güncel influencer pazarlama stratejileri ve büyüme rehberleri.",
  },
};

export default async function PublicBlogListPage({
  searchParams,
}: {
  searchParams: Promise<{ kategori?: string; hedef?: string; q?: string }>;
}) {
  const { kategori, hedef, q } = await searchParams;
  const audience: BlogAudience | null =
    hedef === "BRAND" || hedef === "INFLUENCER" ? hedef : null;

  let posts: Awaited<ReturnType<typeof listPublishedBlogPosts>> = [];
  try {
    posts = await listPublishedBlogPosts({
      category: kategori ?? null,
      audience,
      query: q ?? null,
      limit: 60,
    });
  } catch {
    posts = [];
  }

  const baseUrl = (process.env.APP_URL ?? "https://nordvow.com").replace(/\/+$/, "");
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `${BRAND_NAME} Blog`,
    description:
      "Markalar ve influencerlar için influencer pazarlama, içerik üretimi ve büyüme rehberleri.",
    url: `${baseUrl}/blog`,
    blogPost: posts.slice(0, 12).map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      description: p.excerpt,
      url: `${baseUrl}/blog/${p.slug}`,
      datePublished: (p.publishedAt ?? p.createdAt).toISOString(),
      dateModified: p.updatedAt.toISOString(),
      author: { "@type": "Person", name: p.authorName },
    })),
  };

  const actor = await getActor().catch(() => null);
  if (actor) {
    return (
      <InAppBlogBrowser
        categories={BLOG_CATEGORIES}
        posts={posts.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title,
          excerpt: p.excerpt,
          content: p.content,
          coverImageUrl: p.coverImageUrl,
          category: p.category,
          tags: p.tags,
          targetAudience: p.targetAudience,
          authorName: p.authorName,
          readingTimeMin: p.readingTimeMin,
          viewCount: p.viewCount,
          publishedAt: (p.publishedAt ?? p.createdAt).toISOString(),
        }))}
      />
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="flex flex-col gap-4 border-b border-line pb-8">
        <p className="text-xs font-medium uppercase tracking-widest text-fg-passive">
          {BRAND_NAME} Akademi &amp; Blog
        </p>
        <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Markalar ve Influencerlar İçin Büyüme Rehberleri
        </h1>
        <p className="max-w-2xl text-base text-fg-muted">
          Kampanya stratejileri, içerik üretimi, ürün gönderimi ve SEO odaklı dijital pazarlama
          içerikleri.
        </p>

        <form method="GET" action="/blog" className="mt-2 flex flex-wrap items-center gap-3">
          {kategori ? <input type="hidden" name="kategori" value={kategori} /> : null}
          {audience ? <input type="hidden" name="hedef" value={audience} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Yazılarda ara (ör. kargo, ROI, Reels...)"
            className="h-10 w-full max-w-sm rounded-xl border border-line bg-surface px-3.5 text-sm text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none"
          />
          <button
            type="submit"
            className="h-10 rounded-xl bg-fg px-4 text-sm font-medium text-bg transition-standard hover:opacity-90"
          >
            Ara
          </button>
          {(kategori || audience || q) ? (
            <Link
              href="/blog"
              className="text-sm text-fg-muted underline underline-offset-4 hover:text-fg"
            >
              Filtreleri temizle
            </Link>
          ) : null}
        </form>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Link
            href="/blog"
            className={`rounded-full border px-3 py-1 text-xs transition-standard ${
              !kategori && !audience
                ? "border-fg bg-fg text-bg"
                : "border-line text-fg-muted hover:border-fg/40 hover:text-fg"
            }`}
          >
            Tümü
          </Link>
          <Link
            href={`/blog?hedef=BRAND${kategori ? `&kategori=${encodeURIComponent(kategori)}` : ""}`}
            className={`rounded-full border px-3 py-1 text-xs transition-standard ${
              audience === "BRAND"
                ? "border-fg bg-fg text-bg"
                : "border-line text-fg-muted hover:border-fg/40 hover:text-fg"
            }`}
          >
            Markalar İçin
          </Link>
          <Link
            href={`/blog?hedef=INFLUENCER${kategori ? `&kategori=${encodeURIComponent(kategori)}` : ""}`}
            className={`rounded-full border px-3 py-1 text-xs transition-standard ${
              audience === "INFLUENCER"
                ? "border-fg bg-fg text-bg"
                : "border-line text-fg-muted hover:border-fg/40 hover:text-fg"
            }`}
          >
            Influencerlar İçin
          </Link>
          <span className="mx-1 text-fg-passive">|</span>
          {BLOG_CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={`/blog?kategori=${encodeURIComponent(cat)}${audience ? `&hedef=${audience}` : ""}`}
              className={`rounded-full border px-3 py-1 text-xs transition-standard ${
                kategori === cat
                  ? "border-fg bg-fg text-bg"
                  : "border-line text-fg-muted hover:border-fg/40 hover:text-fg"
              }`}
            >
              {cat}
            </Link>
          ))}
        </div>
      </header>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-line bg-surface/50 p-10 text-center">
          <p className="text-base font-medium text-fg">Henüz yayınlanmış blog yazısı bulunamadı.</p>
          <p className="mt-1 text-sm text-fg-muted">
            Admin panelinden yeni SEO uyumlu yazılar ekleyebilirsiniz.
          </p>
        </div>
      ) : (
        <section className="flex flex-col divide-y divide-line">
          {posts.map((post) => (
            <article
              key={post.id}
              className="group flex flex-col-reverse gap-5 py-8 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                  <span className="font-medium text-fg">{post.authorName}</span>
                  <span>·</span>
                  <span>{post.category}</span>
                  <span>·</span>
                  <span>{BLOG_AUDIENCE_LABELS[post.targetAudience]}</span>
                </div>
                <h2 className="text-xl font-bold leading-snug tracking-tight text-fg group-hover:underline sm:text-2xl">
                  <Link href={`/blog/${post.slug}`}>{post.title}</Link>
                </h2>
                <p className="line-clamp-2 text-[15px] leading-relaxed text-fg-muted">
                  {post.excerpt}
                </p>
                <div className="mt-1 flex items-center gap-3 text-xs text-fg-passive">
                  <time dateTime={(post.publishedAt ?? post.createdAt).toISOString()}>
                    {fmtDate(post.publishedAt ?? post.createdAt)}
                  </time>
                  <span>·</span>
                  <span>{post.readingTimeMin} dk okuma</span>
                </div>
              </div>
              {post.coverImageUrl ? (
                <Link href={`/blog/${post.slug}`} className="shrink-0 overflow-hidden rounded-xl sm:w-44">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={post.coverImageUrl}
                    alt={post.title}
                    className="h-44 w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] sm:h-28"
                  />
                </Link>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

