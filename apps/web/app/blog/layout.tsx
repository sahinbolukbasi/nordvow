import Link from "next/link";
import type { ReactNode } from "react";
import { NordvowMark } from "@/components/brand/logo";
import { AppShell } from "@/components/shell/app-shell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { getActor } from "@/lib/auth-guard";
import { BRAND_NAME } from "@/lib/brand";
import { getTT } from "@/lib/i18n/tt-server";

export default async function BlogLayout({ children }: { children: ReactNode }) {
  const actor = await getActor().catch(() => null);
  if (actor) {
    return <AppShell role={actor.role}>{children}</AppShell>;
  }

  const tt = await getTT();
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
            <NordvowMark size={24} />
            {BRAND_NAME}
          </Link>
          <nav aria-label={tt("Genel")} className="flex items-center gap-4 text-sm text-fg-muted sm:gap-5">
            <Link href="/" className="hidden hover:text-fg sm:inline">{tt("Ana sayfa")}</Link>
            <Link href="/blog" className="font-medium text-fg">{tt("Blog")}</Link>
            <Link href="/kayit" className="hidden hover:text-fg sm:inline">{tt("Kayıt ol")}</Link>
            <Link href="/giris" className="rounded-full bg-fg px-4 py-1.5 font-medium text-bg">{tt("Giriş")}</Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-4 sm:px-6">{children}</main>
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

