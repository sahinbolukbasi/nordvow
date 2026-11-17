import type { Metadata } from "next";
import {
  getBlogAnalyticsSummary,
  listAllBlogPostsForAdmin,
} from "@infulancer/core/blog/service";
import { AdminBlogManager } from "@/components/blog/admin-blog-manager";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/layout";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Blog & SEO Yönetimi" };
export const dynamic = "force-dynamic";

export default async function AdminBlogPage() {
  await requireActor("ADMIN");

  const [posts, summary] = await Promise.all([
    listAllBlogPostsForAdmin().catch(() => []),
    getBlogAnalyticsSummary().catch(() => ({
      totalPosts: 0,
      publishedPosts: 0,
      draftPosts: 0,
      totalViews: 0,
      totalReads: 0,
      avgReadSeconds: 0,
      completionRate: 0,
    })),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Blog & SEO Yönetimi"
        description="Anasayfada yer almayan, sitemap.xml ile arama motorlarına açık, marka, influencer ve dış ziyaretçilerin okuyabildiği blog içeriklerini ve okunma istatistiklerini yönetin."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Toplam Yazı</p>
          <p className="mt-1 text-xl font-bold text-fg tabular-nums">{summary.totalPosts}</p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Yayında</p>
          <p className="mt-1 text-xl font-bold text-emerald-500 tabular-nums">
            {summary.publishedPosts}
          </p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Görüntülenme</p>
          <p className="mt-1 text-xl font-bold text-fg tabular-nums">
            {summary.totalViews.toLocaleString("tr-TR")}
          </p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Tam Okuma</p>
          <p className="mt-1 text-xl font-bold text-sky-500 tabular-nums">
            {summary.totalReads.toLocaleString("tr-TR")} (%{summary.completionRate})
          </p>
        </Card>
        <Card interactive={false} className="p-3">
          <p className="text-[11px] uppercase tracking-wider text-fg-passive">Ort. Okuma Süresi</p>
          <p className="mt-1 text-xl font-bold text-fg tabular-nums">
            {summary.avgReadSeconds} sn
          </p>
        </Card>
      </div>

      <AdminBlogManager
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
          status: p.status,
          seoTitle: p.seoTitle,
          seoDescription: p.seoDescription,
          seoKeywords: p.seoKeywords,
          authorName: p.authorName,
          readingTimeMin: p.readingTimeMin,
          viewCount: p.viewCount,
          readCount: p.readCount,
          totalReadSeconds: p.totalReadSeconds,
          lastReadAt: p.lastReadAt?.toISOString() ?? null,
          publishedAt: p.publishedAt?.toISOString() ?? null,
          updatedAt: p.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}

