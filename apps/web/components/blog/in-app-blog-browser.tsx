"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { BlogAudience } from "@infulancer/core/enums";
import { BlogMarkdown } from "./blog-markdown";

export type InAppBlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImageUrl: string | null;
  category: string;
  tags: string[];
  targetAudience: BlogAudience;
  authorName: string;
  readingTimeMin: number;
  viewCount: number;
  publishedAt: string;
};

const AUDIENCE_LABEL: Record<BlogAudience, string> = {
  ALL: "Herkes",
  INFLUENCER: "Influencerlar",
  BRAND: "Markalar",
};

function fmtTrDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

export function InAppBlogBrowser({
  posts,
  categories,
}: {
  posts: InAppBlogPost[];
  categories: readonly string[];
}) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(posts[0]?.slug ?? null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [category, setCategory] = useState<string>("ALL");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    return posts.filter((p) => {
      if (category !== "ALL" && p.category !== category) return false;
      if (!q) return true;
      return (
        p.title.toLocaleLowerCase("tr").includes(q) ||
        p.excerpt.toLocaleLowerCase("tr").includes(q) ||
        p.category.toLocaleLowerCase("tr").includes(q)
      );
    });
  }, [posts, category, query]);

  const activePost = useMemo(
    () => posts.find((p) => p.slug === selectedSlug) ?? filtered[0] ?? null,
    [posts, filtered, selectedSlug],
  );

  const openPost = (slug: string) => {
    setSelectedSlug(slug);
    setDrawerOpen(true);
    void fetch(`/api/blog/${encodeURIComponent(slug)}/track`, { method: "POST" }).catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-fg-passive">Nordvow Akademi</p>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Blog &amp; Büyüme Rehberleri</h1>
        </div>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Yazılarda ara…"
          aria-label="Blog yazılarında ara"
          className="h-9 w-full rounded-full border border-line bg-surface px-4 text-sm text-fg placeholder:text-fg-passive focus:border-fg focus:outline-none sm:w-64"
        />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setCategory("ALL")}
          className={`rounded-full border px-3 py-1 text-xs transition-standard ${
            category === "ALL" ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:text-fg"
          }`}
        >
          Tümü
        </button>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(c)}
            className={`rounded-full border px-3 py-1 text-xs transition-standard ${
              category === c ? "border-fg bg-fg text-bg" : "border-line text-fg-muted hover:text-fg"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {/* Sol Liste */}
        <div className="flex flex-col gap-3">
          {filtered.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-fg-muted">
              Eşleşen blog yazısı bulunamadı.
            </p>
          ) : (
            filtered.map((post) => {
              const isSelected = activePost?.slug === post.slug;
              return (
                <button
                  key={post.id}
                  type="button"
                  onClick={() => openPost(post.slug)}
                  className={`flex flex-col gap-2 rounded-2xl border p-4 text-left transition-standard ${
                    isSelected
                      ? "border-neon-pink/60 bg-surface shadow-xs"
                      : "border-line bg-surface/40 hover:border-fg/30 hover:bg-surface/70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] text-fg-passive">
                    <span className="rounded-full bg-fg/10 px-2.5 py-0.5 font-medium text-fg">{post.category}</span>
                    <span>{post.readingTimeMin} dk okuma</span>
                  </div>
                  <h2 className="text-[15px] font-semibold leading-snug text-fg">{post.title}</h2>
                  <p className="line-clamp-2 text-[13px] leading-relaxed text-fg-muted">{post.excerpt}</p>
                  <div className="flex items-center justify-between pt-1 text-[11px] text-fg-passive">
                    <span>{post.authorName} · {AUDIENCE_LABEL[post.targetAudience]}</span>
                    <span>{fmtTrDate(post.publishedAt)}</span>
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Sağ Masaüstü Sabit Okuma Paneli */}
        {activePost ? (
          <aside className="hidden lg:sticky lg:top-20 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col lg:overflow-y-auto lg:rounded-3xl lg:border lg:border-line lg:bg-surface/70 lg:p-6">
            <div className="flex items-center justify-between gap-2 border-b border-line pb-3 text-xs text-fg-passive">
              <span>{activePost.category} · {activePost.readingTimeMin} dk okuma</span>
              <Link href={`/blog/${activePost.slug}`} target="_blank" className="underline hover:text-fg">
                Yeni sekmede aç ↗
              </Link>
            </div>
            <h2 className="mt-4 text-2xl font-semibold leading-tight tracking-tight text-fg">{activePost.title}</h2>
            <p className="mt-2 text-xs text-fg-muted">
              {activePost.authorName} · {fmtTrDate(activePost.publishedAt)}
            </p>
            {activePost.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activePost.coverImageUrl}
                alt={activePost.title}
                className="mt-4 max-h-64 w-full rounded-2xl object-cover"
              />
            ) : null}
            <div className="mt-5">
              <BlogMarkdown content={activePost.content} />
            </div>
          </aside>
        ) : null}
      </div>

      {/* Mobil Sağ Çekmece (Drawer) */}
      {drawerOpen && activePost ? (
        <div className="fixed inset-0 z-50 flex justify-end lg:hidden" role="dialog" aria-modal="true" aria-label={activePost.title}>
          <button
            type="button"
            aria-label="Kapat"
            onClick={() => setDrawerOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
          />
          <article className="relative z-10 flex h-dvh w-full max-w-lg flex-col overflow-y-auto bg-bg p-5 shadow-2xl">
            <div className="sticky top-0 z-10 -mx-5 -mt-5 mb-4 flex items-center justify-between gap-2 border-b border-line bg-bg/95 px-5 py-3.5 backdrop-blur-md">
              <span className="truncate text-xs font-medium text-fg-muted">{activePost.category}</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-full border border-line px-3 py-1 text-xs font-medium text-fg hover:bg-surface-hover"
              >
                Kapat ✕
              </button>
            </div>
            <h2 className="text-xl font-semibold leading-snug text-fg">{activePost.title}</h2>
            <p className="mt-1.5 text-xs text-fg-muted">
              {activePost.authorName} · {activePost.readingTimeMin} dk okuma · {fmtTrDate(activePost.publishedAt)}
            </p>
            {activePost.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activePost.coverImageUrl}
                alt={activePost.title}
                className="mt-4 max-h-52 w-full rounded-2xl object-cover"
              />
            ) : null}
            <div className="mt-4 pb-8">
              <BlogMarkdown content={activePost.content} />
            </div>
          </article>
        </div>
      ) : null}
    </div>
  );
}

