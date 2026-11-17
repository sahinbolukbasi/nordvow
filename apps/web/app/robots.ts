import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.APP_URL ?? "https://nordvow.com").replace(/\/+$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/blog", "/blog/"],
        disallow: ["/admin", "/marka", "/influencer", "/dashboard", "/api/", "/profil"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

