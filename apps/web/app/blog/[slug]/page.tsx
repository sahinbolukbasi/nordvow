import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BLOG_AUDIENCE_LABELS,
  getPublishedBlogPostBySlug,
  listRelatedBlogPosts,
} from "@infulancer/core/blog/service";
import { BlogMarkdown } from "@/components/blog/blog-markdown";
import { BlogReadTracker } from "@/components/blog/blog-read-tracker";
import { BRAND_NAME } from "@/lib/brand";
import { fmtDate } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPublishedBlogPostBySlug(slug).catch(() => null);
  if (!post) {
    return { title: "Yazı Bulunamadı" };
  }
  const title = post.seoTitle ?? post.title;
  const description = post.seoDescription ?? post.excerpt;
  const keywords = post.seoKeywords.length > 0 ? post.seoKeywords : post.tags;
  const publishedTime = (post.publishedAt ?? post.createdAt).toISOString();

  return {
    title,
    description,
    keywords,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: "article",
      title,
      description,
      url: `/blog/${post.slug}`,
      publishedTime,
      modifiedTime: post.updatedAt.toISOString(),
      authors: [post.authorName],
      tags: post.tags,
      ...(post.coverImageUrl ? { images: [{ url: post.coverImageUrl, alt: post.title }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      ...(post.coverImageUrl ? { images: [post.coverImageUrl] } : {}),
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPublishedBlogPostBySlug(slug).catch(() => null);
  if (!post) notFound();

  const related = await listRelatedBlogPosts(post.id, post.category, 3).catch(() => []);
  const baseUrl = (process.env.APP_URL ?? "https://nordvow.com").replace(/\/+$/, "");
  const publishedIso = (post.publishedAt ?? post.createdAt).toISOString();

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.seoTitle ?? post.title,
    description: post.seoDescription ?? post.excerpt,
    datePublished: publishedIso,
    dateModified: post.updatedAt.toISOString(),
    author: { "@type": "Person", name: post.authorName },
    publisher: { "@type": "Organization", name: BRAND_NAME },
    mainEntityOfPage: { "@type": "WebPage", "@id": `${baseUrl}/blog/${post.slug}` },
    keywords: (post.seoKeywords.length > 0 ? post.seoKeywords : post.tags).join(", "),
    ...(post.coverImageUrl ? { image: [post.coverImageUrl] } : {}),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana sayfa", item: baseUrl },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${baseUrl}/blog` },
      { "@type": "ListItem", position: 3, name: post.title, item: `${baseUrl}/blog/${post.slug}` },
    ],
  };

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-7 py-6">
      <BlogReadTracker slug={post.slug} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />

      <nav aria-label="İçerik yolu" className="flex items-center gap-2 text-xs text-fg-passive">
        <Link href="/blog" className="rounded-lg border border-line px-2.5 py-1 text-fg hover:bg-surface-hover">
          ← Tüm yazılar
        </Link>
        <span>/</span>
        <Link
          href={`/blog?kategori=${encodeURIComponent(post.category)}`}
          className="hover:text-fg"
        >
          {post.category}
        </Link>
      </nav>

      <header className="flex flex-col gap-4 border-b border-line pb-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-passive">
          <span className="rounded-full bg-fg/10 px-3 py-1 font-medium text-fg">
            {post.category}
          </span>
          <span className="rounded-full border border-line px-3 py-1">
            {BLOG_AUDIENCE_LABELS[post.targetAudience]}
          </span>
        </div>

        <h1 className="text-3xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
          {post.title}
        </h1>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-passive">
          <span className="font-medium text-fg">{post.authorName}</span>
          <span>·</span>
          <time dateTime={publishedIso}>{fmtDate(post.publishedAt ?? post.createdAt)}</time>
          <span>·</span>
          <span>{post.readingTimeMin} dk okuma</span>
          <span>·</span>
          <span>{post.viewCount.toLocaleString("tr-TR")} görüntülenme</span>
        </div>

        {post.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog?etiket=${encodeURIComponent(tag.replace(/^#+/, ""))}`}
                className="rounded-full border border-neon-pink/30 bg-neon-pink/10 px-2.5 py-0.5 text-xs font-medium text-neon-pink hover:bg-neon-pink/20"
              >
                #{tag.replace(/^#+/, "")}
              </Link>
            ))}
          </div>
        ) : null}
      </header>

      {post.coverImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.coverImageUrl}
          alt={post.title}
          className="max-h-[420px] w-full rounded-2xl border border-line object-cover"
        />
      ) : null}

      {post.excerpt ? (
        <div className="rounded-2xl border border-line bg-surface/60 p-4 sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-passive">
            Yazı Özeti
          </p>
          <p className="mt-1.5 text-[15px] leading-relaxed text-fg">{post.excerpt}</p>
        </div>
      ) : null}

      <BlogMarkdown content={post.content} />

      {post.tags.length > 0 ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-6">
          {post.tags.map((tag) => (
            <Link
              key={tag}
              href={`/blog?etiket=${encodeURIComponent(tag.replace(/^#+/, ""))}`}
              className="rounded-full border border-line px-3 py-1 text-xs text-fg-muted hover:border-fg/40 hover:text-fg"
            >
              #{tag.replace(/^#+/, "")}
            </Link>
          ))}
        </footer>
      ) : null}

      {related.length > 0 ? (
        <section className="flex flex-col gap-4 border-t border-line pt-8">
          <h2 className="text-lg font-semibold text-fg">İlgili Yazılar</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {related.map((r) => (
              <Link
                key={r.id}
                href={`/blog/${r.slug}`}
                className="flex flex-col justify-between rounded-xl border border-line bg-surface/50 p-4 transition-standard hover:border-fg/40"
              >
                <div>
                  <p className="text-[11px] text-fg-passive">{r.category}</p>
                  <p className="mt-1 text-sm font-semibold text-fg">{r.title}</p>
                </div>
                <p className="mt-3 text-[11px] text-fg-passive">
                  {r.readingTimeMin} dk · {r.viewCount.toLocaleString("tr-TR")} görüntülenme
                </p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}

