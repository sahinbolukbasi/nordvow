import type { Metadata } from "next";
import type { BlogAudience } from "@infulancer/core/enums";
import { BLOG_CATEGORIES, listPublishedBlogPosts } from "@infulancer/core/blog/service";
import { InAppBlogBrowser } from "@/components/blog/in-app-blog-browser";
import { BRAND_NAME } from "@/lib/brand";

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

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ yazi?: string; kategori?: string; hedef?: string; etiket?: string; q?: string }>;
}) {
  const { yazi, kategori, hedef, etiket, q } = await searchParams;
  const initialAudience: BlogAudience | "ALL" =
    hedef === "BRAND" || hedef === "INFLUENCER" ? hedef : "ALL";

  let posts: Awaited<ReturnType<typeof listPublishedBlogPosts>> = [];
  try {
    posts = await listPublishedBlogPosts({ limit: 100 });
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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <InAppBlogBrowser
        categories={BLOG_CATEGORIES}
        initialSlug={yazi ?? null}
        initialCategory={kategori ?? "ALL"}
        initialAudience={initialAudience}
        initialTag={etiket ?? null}
        initialQuery={q ?? ""}
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
    </>
  );
}

