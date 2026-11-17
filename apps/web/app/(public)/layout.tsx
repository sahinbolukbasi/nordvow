import { getTT } from "@/lib/i18n/tt-server";
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { BRAND_NAME } from "@/lib/brand";
import { NordvowMark } from "@/components/brand/logo";
/** Girişsiz erişilebilen yasal sayfalar (Meta/TikTok App Review için menüye girmeden görünür). */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const tt = await getTT();
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <NordvowMark size={24} />
            {BRAND_NAME}
          </Link>
          <nav aria-label={tt("Genel")} className="flex items-center gap-5 text-sm text-fg-muted">
            <Link href="/" className="hidden hover:text-fg sm:inline">{tt("Ana sayfa")}</Link>
            <Link href="/giris" className="rounded-full bg-fg px-4 py-1.5 font-medium text-bg">{tt("Giriş")}</Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-16">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-[13px] text-fg-passive">
          <span>© {new Date().getFullYear()} {BRAND_NAME}</span>
          <nav aria-label={tt("Alt bağlantılar")} className="flex flex-wrap gap-6">
            <Link href="/blog" className="font-medium text-fg-muted hover:text-fg">{tt("Blog")}</Link>
            <Link href="/gizlilik" className="hover:text-fg">{tt("Gizlilik")}</Link>
            <Link href="/kullanim-kosullari" className="hover:text-fg">{tt("Kullanım koşulları")}</Link>
            <Link href="/kvkk" className="hover:text-fg">{tt("KVKK")}</Link>
            <Link href="/cerez-politikasi" className="hover:text-fg">{tt("Çerezler")}</Link>
            <Link href="/giris" className="hover:text-fg">{tt("Giriş")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
