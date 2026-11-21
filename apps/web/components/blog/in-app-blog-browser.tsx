"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { BlogAudience } from "@infulancer/core/enums";
import { ChevronDownIcon, SearchIcon, SparkleIcon, XIcon } from "@/components/icons";
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

type SortKey = "newest" | "popular" | "shortest";

function fmtTrDate(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

function cleanTag(raw: string): string {
  return raw.replace(/^#+/, "").trim();
}

function extractPostHashtags(post: InAppBlogPost): string[] {
  const seen = new Map<string, string>();
  for (const t of post.tags) {
    const clean = cleanTag(t);
    if (clean) seen.set(clean.toLocaleLowerCase("tr"), clean);
  }
  const matches = post.content.match(/#[a-zA-ZçğıöşüÇĞİÖŞÜ0-9_-]{2,32}/g) ?? [];
  for (const m of matches) {
    const clean = cleanTag(m);
    if (clean && !seen.has(clean.toLocaleLowerCase("tr"))) {
      seen.set(clean.toLocaleLowerCase("tr"), clean);
    }
  }
  return Array.from(seen.values());
}

function contentPreview(post: InAppBlogPost): string {
  if (post.excerpt.trim().length > 0) return post.excerpt.trim();
  return post.content
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/[#>*`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export function InAppBlogBrowser({
  posts,
  categories,
  initialSlug = null,
  initialCategory = "ALL",
  initialAudience = "ALL",
  initialTag = null,
  initialQuery = "",
}: {
  posts: InAppBlogPost[];
  categories: readonly string[];
  initialSlug?: string | null;
  initialCategory?: string;
  initialAudience?: BlogAudience | "ALL";
  initialTag?: string | null;
  initialQuery?: string;
}) {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug);
  const [category, setCategory] = useState<string>(initialCategory);
  const [audience, setAudience] = useState<BlogAudience | "ALL">(initialAudience);
  const [activeTag, setActiveTag] = useState<string | null>(initialTag);
  const [query, setQuery] = useState(initialQuery);
  const [sortBy, setSortBy] = useState<SortKey>("newest");
  const [showAllTags, setShowAllTags] = useState(false);

  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of posts) {
      map.set(p.category, (map.get(p.category) ?? 0) + 1);
    }
    return map;
  }, [posts]);

  const postTagsMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of posts) {
      map.set(p.id, extractPostHashtags(p));
    }
    return map;
  }, [posts]);

  const popularTags = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const p of posts) {
      for (const tag of postTagsMap.get(p.id) ?? []) {
        const key = tag.toLocaleLowerCase("tr");
        const prev = counts.get(key);
        counts.set(key, { label: prev?.label ?? tag, count: (prev?.count ?? 0) + 1 });
      }
    }
    return Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 14);
  }, [posts, postTagsMap]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr");
    const tagLower = activeTag ? activeTag.toLocaleLowerCase("tr") : null;

    const list = posts.filter((p) => {
      if (category !== "ALL" && p.category !== category) return false;
      if (audience !== "ALL" && p.targetAudience !== audience && p.targetAudience !== "ALL") {
        return false;
      }
      const pTags = postTagsMap.get(p.id) ?? [];
      if (tagLower && !pTags.some((t) => t.toLocaleLowerCase("tr") === tagLower)) {
        return false;
      }
      if (!q) return true;
      return (
        p.title.toLocaleLowerCase("tr").includes(q) ||
        p.excerpt.toLocaleLowerCase("tr").includes(q) ||
        p.content.toLocaleLowerCase("tr").includes(q) ||
        p.category.toLocaleLowerCase("tr").includes(q) ||
        pTags.some((t) => `#${t}`.toLocaleLowerCase("tr").includes(q))
      );
    });

    if (sortBy === "popular") {
      return [...list].sort((a, b) => b.viewCount - a.viewCount);
    }
    if (sortBy === "shortest") {
      return [...list].sort((a, b) => a.readingTimeMin - b.readingTimeMin);
    }
    return list;
  }, [posts, category, audience, activeTag, query, sortBy, postTagsMap]);

  const activePost = useMemo(
    () => (selectedSlug ? posts.find((p) => p.slug === selectedSlug) ?? null : null),
    [posts, selectedSlug],
  );

  const activePostTags = useMemo(
    () => (activePost ? (postTagsMap.get(activePost.id) ?? []) : []),
    [activePost, postTagsMap],
  );

  const relatedPosts = useMemo(() => {
    if (!activePost) return [];
    const sameCat = posts.filter((p) => p.id !== activePost.id && p.category === activePost.category);
    const others = posts.filter((p) => p.id !== activePost.id && p.category !== activePost.category);
    return [...sameCat, ...others].slice(0, 3);
  }, [posts, activePost]);

  const hasFilters =
    category !== "ALL" || audience !== "ALL" || activeTag !== null || query.trim().length > 0;

  const clearFilters = () => {
    setCategory("ALL");
    setAudience("ALL");
    setActiveTag(null);
    setQuery("");
  };

  const openPost = (slug: string) => {
    setSelectedSlug(slug);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    void fetch(`/api/blog/${encodeURIComponent(slug)}/track`, { method: "POST" }).catch(
      () => undefined,
    );
  };

  const filterByTag = (tag: string) => {
    const clean = cleanTag(tag);
    setActiveTag((prev) =>
      prev?.toLocaleLowerCase("tr") === clean.toLocaleLowerCase("tr") ? null : clean,
    );
    setSelectedSlug(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  if (activePost) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface/60 px-4 py-3 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => setSelectedSlug(null)}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-bg px-3.5 py-1.5 text-xs font-medium text-fg transition-standard hover:border-fg/40 hover:bg-surface-hover"
          >
            ← Tüm yazılara dön
          </button>
          <div className="flex items-center gap-3 text-xs text-fg-muted">
            <span>{activePost.category}</span>
            <span>·</span>
            <span>{activePost.readingTimeMin} dk okuma</span>
            <Link
              href={`/blog/${activePost.slug}`}
              target="_blank"
              className="rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-fg hover:bg-surface-hover"
            >
              Tam sayfa ↗
            </Link>
          </div>
        </div>

        <article className="flex flex-col gap-7 rounded-3xl border border-line bg-surface/50 p-5 sm:p-8">
          <header className="flex flex-col gap-4 border-b border-line pb-6">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-fg/10 px-3 py-1 font-medium text-fg">
                {activePost.category}
              </span>
              <span className="rounded-full border border-line px-3 py-1 text-fg-muted">
                {AUDIENCE_LABEL[activePost.targetAudience]}
              </span>
              <span className="text-fg-passive">
                {activePost.viewCount.toLocaleString("tr-TR")} görüntülenme
              </span>
            </div>

            <h1 className="text-2xl font-semibold leading-tight tracking-tight text-fg sm:text-4xl">
              {activePost.title}
            </h1>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
              <span className="font-medium text-fg">{activePost.authorName}</span>
              <span>·</span>
              <time dateTime={activePost.publishedAt}>{fmtTrDate(activePost.publishedAt)}</time>
              <span>·</span>
              <span>{activePost.readingTimeMin} dakika okuma süresi</span>
            </div>

            {activePostTags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {activePostTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => filterByTag(tag)}
                    className="rounded-full border border-neon-pink/30 bg-neon-pink/10 px-2.5 py-0.5 text-xs font-medium text-neon-pink transition-standard hover:bg-neon-pink/20"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            ) : null}
          </header>

          {activePost.coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={activePost.coverImageUrl}
              alt={activePost.title}
              className="max-h-[420px] w-full rounded-2xl border border-line object-cover"
            />
          ) : null}

          {activePost.excerpt ? (
            <div className="rounded-2xl border border-line bg-bg/60 p-4 sm:p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-passive">
                Yazı Özeti
              </p>
              <p className="mt-1.5 text-[15px] leading-relaxed text-fg">{activePost.excerpt}</p>
            </div>
          ) : null}

          <BlogMarkdown content={activePost.content} onTagClick={filterByTag} />

          {activePostTags.length > 0 ? (
            <footer className="flex flex-wrap items-center gap-2 border-t border-line pt-5">
              <span className="text-xs font-medium text-fg-passive">Etiketler:</span>
              {activePostTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => filterByTag(tag)}
                  className="rounded-full border border-line px-3 py-1 text-xs text-fg-muted transition-standard hover:border-neon-pink/50 hover:text-fg"
                >
                  #{tag}
                </button>
              ))}
            </footer>
          ) : null}
        </article>

        {relatedPosts.length > 0 ? (
          <section className="flex flex-col gap-3 pt-2">
            <h2 className="text-base font-semibold text-fg">Diğer Yazılar</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {relatedPosts.map((rel) => (
                <button
                  key={rel.id}
                  type="button"
                  onClick={() => openPost(rel.slug)}
                  className="flex flex-col justify-between gap-2 rounded-2xl border border-line bg-surface/50 p-4 text-left transition-standard hover:border-fg/40 hover:bg-surface"
                >
                  <div>
                    <p className="text-[11px] font-medium text-fg-passive">{rel.category}</p>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-fg">{rel.title}</p>
                  </div>
                  <p className="text-[11px] text-fg-passive">
                    {rel.readingTimeMin} dk okuma · {fmtTrDate(rel.publishedAt)}
                  </p>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  const visibleTags = showAllTags ? popularTags : popularTags.slice(0, 8);

  return (
    <div className="flex flex-col gap-6 py-4">
      {/* Modern Editorial Hero + Arama & Filtreleme Alanı */}
      <section className="relative overflow-hidden rounded-3xl border border-line/70 bg-gradient-to-br from-surface/90 via-surface/60 to-bg p-5 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-neon-pink/12 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-12 h-56 w-56 rounded-full bg-neon-cyan/10 blur-3xl" />

        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-neon-pink/30 bg-neon-pink/10 px-3 py-1 text-[11px] font-semibold tracking-wide text-neon-pink">
                <SparkleIcon size={12} />
                Nordvow Journal
              </span>
              <h1 className="mt-2.5 text-2xl font-semibold tracking-tight text-fg sm:text-4xl">
                Büyüme Rehberleri &amp; Strateji
              </h1>
              <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">
                Markalar ve içerik üreticileri için kampanya kurgusu, içerik üretimi ve performans ipuçları.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-line/80 bg-bg/70 px-3.5 py-1.5 text-xs text-fg-muted backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-neon-pink" aria-hidden />
              <span>
                <strong className="font-semibold tabular-nums text-fg">{filtered.length}</strong> yazı
              </span>
            </div>
          </div>

          {/* Birleşik Arama & Kontrol Çubuğu */}
          <div className="flex flex-col gap-2 rounded-2xl border border-line/80 bg-bg/85 p-2 shadow-sm backdrop-blur-xl lg:flex-row lg:items-center">
            <div className="relative flex flex-1 items-center">
              <SearchIcon
                size={17}
                className="pointer-events-none absolute left-3.5 text-fg-passive"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Yazı, strateji veya #etiket ara…"
                aria-label="Blog yazılarında ara"
                className="h-11 w-full rounded-xl bg-transparent pr-9 pl-10 text-sm text-fg placeholder:text-fg-passive focus:outline-none"
              />
              {query.trim().length > 0 ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Aramayı temizle"
                  className="absolute right-2 rounded-lg p-1.5 text-fg-muted transition-standard hover:bg-surface-hover hover:text-fg"
                >
                  <XIcon size={14} />
                </button>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-2">
              {/* Hedef Kitle Segmented Control */}
              <div
                role="group"
                aria-label="Hedef kitle"
                className="inline-flex items-center rounded-xl border border-line/70 bg-surface/60 p-1"
              >
                {(
                  [
                    ["ALL", "Tümü"],
                    ["BRAND", "Markalar"],
                    ["INFLUENCER", "Influencerlar"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setAudience(key)}
                    aria-pressed={audience === key}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-standard ${
                      audience === key
                        ? "bg-fg text-bg shadow-sm"
                        : "text-fg-muted hover:text-fg"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Sıralama Seçici */}
              <div className="relative">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  aria-label="Sıralama"
                  className="h-9 cursor-pointer appearance-none rounded-xl border border-line/80 bg-surface/60 pr-8 pl-3 text-xs font-medium text-fg transition-standard hover:border-fg/30 focus:border-fg focus:outline-none"
                >
                  <option value="newest">En Yeni</option>
                  <option value="popular">En Popüler</option>
                  <option value="shortest">Kısa Okuma</option>
                </select>
                <ChevronDownIcon
                  size={14}
                  className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-fg-muted"
                />
              </div>
            </div>
          </div>

          {/* Temiz Kategori Sekmeleri */}
          <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 sm:flex-wrap sm:overflow-visible">
            <button
              type="button"
              onClick={() => setCategory("ALL")}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-standard ${
                category === "ALL"
                  ? "bg-fg text-bg shadow-sm"
                  : "border border-line/70 bg-bg/60 text-fg-muted hover:border-fg/30 hover:text-fg"
              }`}
            >
              <span>Tümü</span>
              <span className={`tabular-nums text-[11px] ${category === "ALL" ? "opacity-75" : "text-fg-passive"}`}>
                {posts.length}
              </span>
            </button>
            {categories.map((c) => {
              const count = categoryCounts.get(c) ?? 0;
              const selected = category === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-standard ${
                    selected
                      ? "bg-fg text-bg shadow-sm"
                      : "border border-line/70 bg-bg/60 text-fg-muted hover:border-fg/30 hover:text-fg"
                  }`}
                >
                  <span>{c}</span>
                  <span className={`tabular-nums text-[11px] ${selected ? "opacity-75" : "text-fg-passive"}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Trend Etiketler */}
          {popularTags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-medium text-fg-passive">Öne çıkan etiketler:</span>
              {visibleTags.map(({ label, count }) => {
                const isSelected = activeTag?.toLocaleLowerCase("tr") === label.toLocaleLowerCase("tr");
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => filterByTag(label)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] transition-standard ${
                      isSelected
                        ? "border-neon-pink bg-neon-pink/15 font-medium text-neon-pink"
                        : "border-line/70 bg-bg/40 text-fg-muted hover:border-neon-pink/40 hover:text-fg"
                    }`}
                  >
                    #{label} <span className="opacity-60">{count}</span>
                  </button>
                );
              })}
              {popularTags.length > 8 ? (
                <button
                  type="button"
                  onClick={() => setShowAllTags((v) => !v)}
                  className="rounded-full px-2.5 py-0.5 text-[11px] font-medium text-fg-muted transition-standard hover:text-fg"
                >
                  {showAllTags ? "Daha az" : `+${popularTags.length - 8} daha`}
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Aktif Filtre Şeridi */}
          {hasFilters ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3 text-xs">
              <span className="text-[11px] font-medium text-fg-passive">Aktif filtreler:</span>
              {query.trim().length > 0 ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-bg/80 px-2.5 py-0.5 text-fg-muted hover:text-fg"
                >
                  <span>&ldquo;{query.trim()}&rdquo;</span>
                  <XIcon size={12} />
                </button>
              ) : null}
              {audience !== "ALL" ? (
                <button
                  type="button"
                  onClick={() => setAudience("ALL")}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-bg/80 px-2.5 py-0.5 text-fg-muted hover:text-fg"
                >
                  <span>{AUDIENCE_LABEL[audience]}</span>
                  <XIcon size={12} />
                </button>
              ) : null}
              {category !== "ALL" ? (
                <button
                  type="button"
                  onClick={() => setCategory("ALL")}
                  className="inline-flex items-center gap-1 rounded-full border border-line bg-bg/80 px-2.5 py-0.5 text-fg-muted hover:text-fg"
                >
                  <span>{category}</span>
                  <XIcon size={12} />
                </button>
              ) : null}
              {activeTag ? (
                <button
                  type="button"
                  onClick={() => setActiveTag(null)}
                  className="inline-flex items-center gap-1 rounded-full border border-neon-pink/40 bg-neon-pink/10 px-2.5 py-0.5 text-neon-pink hover:bg-neon-pink/20"
                >
                  <span>#{activeTag}</span>
                  <XIcon size={12} />
                </button>
              ) : null}
              <button
                type="button"
                onClick={clearFilters}
                className="ml-auto text-[11px] font-medium text-fg-muted underline underline-offset-4 hover:text-fg"
              >
                Tümünü temizle
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {/* Yazı Listesi — Solda Küçük Görsel, Sağda Başlık & Kısa Başlangıç */}
      {filtered.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-line bg-surface/30 p-10 text-center">
          <p className="text-sm font-medium text-fg">Seçtiğiniz filtrelere uygun blog yazısı bulunamadı.</p>
          {hasFilters ? (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 rounded-xl border border-line px-4 py-1.5 text-xs font-medium text-fg hover:bg-surface-hover"
            >
              Tüm yazıları göster
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((post) => {
            const pTags = postTagsMap.get(post.id) ?? [];
            return (
              <button
                key={post.id}
                type="button"
                onClick={() => openPost(post.slug)}
                className="group flex items-start gap-4 rounded-2xl border border-line bg-surface/50 p-3.5 text-left transition-standard hover:border-neon-pink/50 hover:bg-surface sm:gap-5 sm:p-4"
              >
                {/* Solda Küçük Resim */}
                <div className="h-20 w-24 shrink-0 overflow-hidden rounded-xl border border-line bg-surface sm:h-24 sm:w-36">
                  {post.coverImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={post.coverImageUrl}
                      alt={post.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neon-pink/15 via-surface to-neon-cyan/15 px-2 text-center text-[11px] font-semibold text-fg-muted">
                      {post.category}
                    </div>
                  )}
                </div>

                {/* Sağda Başlık + Küçük Yazıyla Başlangıç */}
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-fg-passive">
                    <span className="rounded-full bg-fg/10 px-2.5 py-0.5 font-medium text-fg">
                      {post.category}
                    </span>
                    <span>{AUDIENCE_LABEL[post.targetAudience]}</span>
                    <span>·</span>
                    <span>{post.readingTimeMin} dk okuma</span>
                    <span className="hidden sm:inline">·</span>
                    <span className="hidden sm:inline">{fmtTrDate(post.publishedAt)}</span>
                  </div>

                  <h2 className="text-[15px] font-semibold leading-snug text-fg transition-colors group-hover:text-neon-pink sm:text-lg">
                    {post.title}
                  </h2>

                  <p className="line-clamp-2 text-xs leading-relaxed text-fg-muted">
                    {contentPreview(post)}
                  </p>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                    <div className="flex flex-wrap gap-1.5">
                      {pTags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-bg/70 px-2 py-0.5 text-[11px] text-fg-muted"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <span className="text-[11px] font-medium text-fg-muted group-hover:text-fg">
                      Yazıyı oku →
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
