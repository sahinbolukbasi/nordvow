import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { themeInitScript } from "@/lib/theme";
import { CookieBanner } from "@/components/legal/cookie-banner";
import { BRAND_NAME } from "@/lib/brand";
import { getPreferences } from "@/lib/i18n/server";
import { I18nProvider } from "@/lib/i18n/client";
import { MessagesProvider } from "@/lib/i18n/tt-client";
import { getMergedMessages } from "@/lib/i18n/overrides";
import { buildLocalizedMetadata, siteBaseUrl } from "@/lib/i18n/seo";

const geistSans = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist-sans", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-geist-mono", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const [{ locale }, h] = await Promise.all([getPreferences(), headers()]);
  const pathname = h.get("x-pathname") ?? "/";
  const localized = buildLocalizedMetadata({ pathname, locale });
  return {
    metadataBase: new URL(siteBaseUrl()),
    title: {
      default: typeof localized.title === "string" ? localized.title : BRAND_NAME,
      template: `%s · ${BRAND_NAME}`,
    },
    description: localized.description,
    applicationName: BRAND_NAME,
    icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
    alternates: localized.alternates,
    openGraph: localized.openGraph,
    twitter: localized.twitter,
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#05050a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, region, detectedCountry } = await getPreferences();
  const messages = await getMergedMessages(locale);
  return (
    <html lang={locale} className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <I18nProvider locale={locale} country={detectedCountry || region.code} currency={region.currency}>
          <MessagesProvider messages={messages}>
            {children}
            <CookieBanner />
          </MessagesProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
