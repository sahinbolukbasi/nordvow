"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import type { BlogAudience, BlogStatus } from "@infulancer/core/enums";
import {
  BLOG_AUDIENCE_LABELS,
  BLOG_CATEGORIES,
} from "@infulancer/core/blog/service";
import {
  deleteBlogPostAction,
  saveBlogPostAction,
  seedStarterBlogPostsAction,
} from "@/lib/actions/blog";
import { idleState } from "@/lib/action-state";
import { Button, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardTitle } from "@/components/ui/card";

export type AdminBlogRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  coverImageUrl: string | null;
  category: string;
  tags: string[];
  targetAudience: BlogAudience;
  status: BlogStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  seoKeywords: string[];
  authorName: string;
  readingTimeMin: number;
  viewCount: number;
  readCount: number;
  totalReadSeconds: number;
  lastReadAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
};

export function AdminBlogManager({ posts }: { posts: AdminBlogRow[] }) {
  const [editing, setEditing] = useState<AdminBlogRow | null>(null);
  const [showForm, setShowForm] = useState(posts.length === 0);
  const [state, formAction, pending] = useActionState(
    saveBlogPostAction,
    idleState,
  );
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const handleSeed = () => {
    setActionMsg(null);
    startTransition(async () => {
      const res = await seedStarterBlogPostsAction();
      setActionMsg(res.ok ? (res.message ?? "Örnek yazılar eklendi.") : (res.error ?? "Hata oluştu."));
    });
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`"${title}" yazısını silmek istediğinize emin misiniz?`)) return;
    setActionMsg(null);
    startTransition(async () => {
      const res = await deleteBlogPostAction(id);
      setActionMsg(res.ok ? (res.message ?? "Silindi.") : (res.error ?? "Hata oluştu."));
      if (editing?.id === id) {
        setEditing(null);
        setShowForm(false);
      }
    });
  };

  const startNew = () => {
    setEditing(null);
    setShowForm(true);
  };

  const startEdit = (post: AdminBlogRow) => {
    setEditing(post);
    setShowForm(true);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={startNew}>
            + Yeni Blog Yazısı
          </Button>
          <Button type="button" variant="secondary" onClick={handleSeed} disabled={busy}>
            {busy ? "Ekleniyor..." : "Örnek SEO Yazıları Ekle"}
          </Button>
          <Link
            href="/blog"
            target="_blank"
            className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-xs font-medium text-fg hover:bg-surface-hover"
          >
            Blog Sayfasını Aç ↗
          </Link>
          <Link
            href="/sitemap.xml"
            target="_blank"
            className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-xs font-medium text-fg-muted hover:text-fg"
          >
            sitemap.xml ↗
          </Link>
        </div>
        {actionMsg ? <p className="text-xs text-emerald-500">{actionMsg}</p> : null}
      </div>

      {showForm ? (
        <Card interactive={false} className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <CardTitle>{editing ? "Blog Yazısını Düzenle" : "Yeni Blog Yazısı"}</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowForm(false);
                setEditing(null);
              }}
            >
              Kapat
            </Button>
          </div>

          <form
            key={editing?.id ?? "new"}
            action={formAction}
            className="flex flex-col gap-4"
          >
            {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Başlık">
                {(p) => (
                  <Input
                    {...p}
                    name="title"
                    required
                    defaultValue={editing?.title ?? ""}
                    placeholder="Örn. 2026 Influencer Pazarlama Stratejileri"
                  />
                )}
              </Field>
              <Field label="URL Slug (opsiyonel — otomatik üretilir)">
                {(p) => (
                  <Input
                    {...p}
                    name="slug"
                    defaultValue={editing?.slug ?? ""}
                    placeholder="influencer-pazarlama-stratejileri"
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <Field label="Kategori">
                {(p) => (
                  <Select
                    {...p}
                    name="category"
                    defaultValue={editing?.category ?? BLOG_CATEGORIES[0]}
                  >
                    {BLOG_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Hedef Kitle">
                {(p) => (
                  <Select
                    {...p}
                    name="targetAudience"
                    defaultValue={editing?.targetAudience ?? "ALL"}
                  >
                    <option value="ALL">{BLOG_AUDIENCE_LABELS.ALL}</option>
                    <option value="BRAND">{BLOG_AUDIENCE_LABELS.BRAND}</option>
                    <option value="INFLUENCER">{BLOG_AUDIENCE_LABELS.INFLUENCER}</option>
                  </Select>
                )}
              </Field>
              <Field label="Durum">
                {(p) => (
                  <Select
                    {...p}
                    name="status"
                    defaultValue={editing?.status ?? "PUBLISHED"}
                  >
                    <option value="PUBLISHED">Yayında (Sitemap + Herkese Açık)</option>
                    <option value="DRAFT">Taslak</option>
                  </Select>
                )}
              </Field>
              <Field label="Yazar">
                {(p) => (
                  <Input
                    {...p}
                    name="authorName"
                    defaultValue={editing?.authorName ?? "Nordvow Editör"}
                  />
                )}
              </Field>
            </div>

            <Field label="Kısa Özet (Listelerde ve Meta Açıklamada Görünür)">
              {(p) => (
                <Textarea
                  {...p}
                  name="excerpt"
                  rows={2}
                  required
                  defaultValue={editing?.excerpt ?? ""}
                />
              )}
            </Field>

            <Field label="İçerik (Markdown destekler: ## Başlık, - Liste, **Kalın**)">
              {(p) => (
                <Textarea
                  {...p}
                  name="content"
                  rows={10}
                  required
                  defaultValue={editing?.content ?? ""}
                />
              )}
            </Field>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Etiketler (virgülle ayırın)">
                {(p) => (
                  <Input
                    {...p}
                    name="tags"
                    defaultValue={editing?.tags.join(", ") ?? ""}
                    placeholder="influencer, kargo, roi"
                  />
                )}
              </Field>
              <Field label="Kapak Görseli URL (opsiyonel)">
                {(p) => (
                  <Input
                    {...p}
                    name="coverImageUrl"
                    defaultValue={editing?.coverImageUrl ?? ""}
                    placeholder="https://..."
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 rounded-xl border border-line bg-surface/40 p-4 md:grid-cols-3">
              <Field label="SEO Başlığı (opsiyonel)">
                {(p) => (
                  <Input
                    {...p}
                    name="seoTitle"
                    defaultValue={editing?.seoTitle ?? ""}
                    placeholder="Google arama başlığı"
                  />
                )}
              </Field>
              <Field label="SEO Meta Açıklama (opsiyonel)">
                {(p) => (
                  <Input
                    {...p}
                    name="seoDescription"
                    defaultValue={editing?.seoDescription ?? ""}
                    placeholder="Arama sonuçlarında görünecek özet"
                  />
                )}
              </Field>
              <Field label="SEO Anahtar Kelimeler (virgülle)">
                {(p) => (
                  <Input
                    {...p}
                    name="seoKeywords"
                    defaultValue={editing?.seoKeywords.join(", ") ?? ""}
                    placeholder="influencer ajansı, ürün gönderimi"
                  />
                )}
              </Field>
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={pending}>
                {pending
                  ? "Kaydediliyor..."
                  : editing
                    ? "Değişiklikleri Kaydet"
                    : "Yazıyı Oluştur"}
              </Button>
              {state.ok && state.message ? (
                <p className="text-xs text-emerald-500">{state.message}</p>
              ) : null}
              {!state.ok && state.error ? (
                <p className="text-xs text-rose-500">{state.error}</p>
              ) : null}
            </div>
          </form>
        </Card>
      ) : null}

      <Card interactive={false} className="flex flex-col gap-3">
        <CardTitle>Blog Yazıları &amp; Okunma İstatistikleri</CardTitle>
        {posts.length === 0 ? (
          <p className="text-sm text-fg-muted">
            Henüz blog yazısı yok. &ldquo;Örnek SEO Yazıları Ekle&rdquo; veya &ldquo;+ Yeni Blog
            Yazısı&rdquo; ile başlayabilirsiniz.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-fg-passive">
                  <th className="py-2.5 pr-3">Başlık &amp; Kategori</th>
                  <th className="py-2.5 pr-3">Durum</th>
                  <th className="py-2.5 pr-3">Görüntülenme</th>
                  <th className="py-2.5 pr-3">Tam Okuma</th>
                  <th className="py-2.5 pr-3">Ort. Süre</th>
                  <th className="py-2.5 text-right">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {posts.map((post) => {
                  const avgSec =
                    post.readCount > 0
                      ? Math.round(post.totalReadSeconds / post.readCount)
                      : 0;
                  const completion =
                    post.viewCount > 0
                      ? Math.min(100, Math.round((post.readCount / post.viewCount) * 100))
                      : 0;
                  return (
                    <tr key={post.id} className="hover:bg-surface/40">
                      <td className="py-2.5 pr-3">
                        <p className="font-medium text-fg">{post.title}</p>
                        <p className="text-[11px] text-fg-muted">
                          {post.category} · {BLOG_AUDIENCE_LABELS[post.targetAudience]} ·{" "}
                          {post.readingTimeMin} dk
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            post.status === "PUBLISHED"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          {post.status === "PUBLISHED" ? "Yayında" : "Taslak"}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-fg">
                        {post.viewCount.toLocaleString("tr-TR")}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-fg">
                        {post.readCount.toLocaleString("tr-TR")} (%{completion})
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-fg-muted">
                        {avgSec > 0 ? `${avgSec} sn` : "—"}
                      </td>
                      <td className="py-2.5 text-right">
                        <div className="inline-flex items-center gap-3">
                          {post.status === "PUBLISHED" ? (
                            <Link
                              href={`/blog/${post.slug}`}
                              target="_blank"
                              className="text-fg-muted underline underline-offset-4 hover:text-fg"
                            >
                              Gör ↗
                            </Link>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => startEdit(post)}
                            className="text-fg underline underline-offset-4"
                          >
                            Düzenle
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(post.id, post.title)}
                            className="text-rose-500 underline underline-offset-4"
                          >
                            Sil
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

