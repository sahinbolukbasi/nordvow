import type { MetadataRoute } from "next";
import { prisma } from "@infulancer/core/db";
import { localizedPath, SITE_LOCALES, siteBaseUrl } from "@/lib/i18n/seo";

export const dynamic = "force-dynamic";

function localizedEntries(
  baseUrl: string,
  path: string,
  meta: { lastModified: Date; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number },
): MetadataRoute.Sitemap {
  const languages = {
    tr: `${baseUrl}${localizedPath(path, "tr")}`,
    en: `${baseUrl}${localizedPath(path, "en")}`,
  };
  return SITE_LOCALES.map((loc) => ({
    url: `${baseUrl}${localizedPath(path, loc)}`,
    lastModified: meta.lastModified,
    changeFrequency: meta.changeFrequency,
    priority: meta.priority,
    alternates: { languages },
  }));
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = siteBaseUrl();
  const now = new Date();

  const staticPaths: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
    { path: "/", changeFrequency: "weekly", priority: 1.0 },
    { path: "/blog", changeFrequency: "daily", priority: 0.9 },
    { path: "/kayit", changeFrequency: "monthly", priority: 0.7 },
    { path: "/destek", changeFrequency: "monthly", priority: 0.5 },
    { path: "/gizlilik", changeFrequency: "monthly", priority: 0.3 },
    { path: "/kullanim-kosullari", changeFrequency: "monthly", priority: 0.3 },
    { path: "/kvkk", changeFrequency: "monthly", priority: 0.3 },
    { path: "/cerez-politikasi", changeFrequency: "monthly", priority: 0.3 },
  ];

  const staticRoutes = staticPaths.flatMap((r) =>
    localizedEntries(baseUrl, r.path, {
      lastModified: now,
      changeFrequency: r.changeFrequency,
      priority: r.priority,
    }),
  );

  try {
    const posts = await prisma.blogPost.findMany({
      where: { status: "PUBLISHED" },
      select: { slug: true, updatedAt: true, publishedAt: true },
      orderBy: [{ publishedAt: "desc" }],
      take: 1000,
    });

    const blogRoutes = posts.flatMap((post) =>
      localizedEntries(baseUrl, `/blog/${post.slug}`, {
        lastModified: post.updatedAt ?? post.publishedAt ?? now,
        changeFrequency: "weekly",
        priority: 0.8,
      }),
    );

    return [...staticRoutes, ...blogRoutes];
  } catch {
    return staticRoutes;
  }
}
