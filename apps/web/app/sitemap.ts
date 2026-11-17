import type { MetadataRoute } from "next";
import { prisma } from "@infulancer/core/db";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = (process.env.APP_URL ?? "https://nordvow.com").replace(/\/+$/, "");

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`, changeFrequency: "weekly", priority: 1.0 },
    { url: `${baseUrl}/blog`, changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/gizlilik`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/kullanim-kosullari`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/kvkk`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${baseUrl}/cerez-politikasi`, changeFrequency: "monthly", priority: 0.3 },
  ];

  try {
    const posts = await prisma.blogPost.findMany({
      where: { status: "PUBLISHED" },
      select: { slug: true, updatedAt: true, publishedAt: true },
      orderBy: [{ publishedAt: "desc" }],
      take: 1000,
    });

    const blogRoutes: MetadataRoute.Sitemap = posts.map((post) => ({
      url: `${baseUrl}/blog/${post.slug}`,
      lastModified: post.updatedAt ?? post.publishedAt ?? new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    }));

    return [...staticRoutes, ...blogRoutes];
  } catch {
    return staticRoutes;
  }
}

