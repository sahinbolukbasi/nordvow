import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.APP_URL ?? "https://nordvow.com").replace(/\/+$/, "");

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/blog", "/blog/", "/kayit", "/gizlilik", "/kullanim-kosullari", "/kvkk", "/cerez-politikasi", "/destek"],
        disallow: [
          "/api/",
          "/admin",
          "/marka",
          "/influencer",
          "/dashboard",
          "/profil",
          "/creative",
          "/auth/",
          "/webhooks/",
          "/onay-bekliyor",
          "/sifre-sifirla",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}

