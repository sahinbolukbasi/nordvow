import type { MetadataRoute } from "next";
import { siteBaseUrl } from "@/lib/i18n/seo";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = siteBaseUrl();

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/tr",
          "/tr/",
          "/en",
          "/en/",
          "/blog",
          "/blog/",
          "/kayit",
          "/gizlilik",
          "/kullanim-kosullari",
          "/kvkk",
          "/cerez-politikasi",
          "/destek",
        ],
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
