import type { ReactNode } from "react";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import type { Role } from "@infulancer/core/enums";
import { roleLabels } from "@infulancer/core/domain/labels";
import { SearchIcon } from "@/components/icons";
import { getSessionUser, requireActor } from "@/lib/auth-guard";
import { AccountMenu } from "./account-menu";
import { MobileDrawer } from "./mobile-drawer";
import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { CopilotLauncher } from "@/components/copilot/copilot-launcher";
import { Sidebar } from "./sidebar";
import { loadPagePermissions, type PagePermissionRow } from "@infulancer/core/access/page-permissions";
import { BRAND_NAME } from "@/lib/brand";
import { getT } from "@/lib/i18n/server";
import { RegionSwitcher } from "@/components/i18n/region-switcher";
import { NordvowMark } from "@/components/brand/logo";
import { AnnouncementPopup, type SystemPopup } from "@/components/notify/announcement-popup";
import { prisma } from "@infulancer/core/db";

const getCachedSystemPopups = unstable_cache(
  async (): Promise<SystemPopup[]> => {
    const popupRow = await prisma.configValue.findUnique({ where: { key: "system.popups" }, select: { value: true } }).catch(() => null);
    return Array.isArray(popupRow?.value) ? (popupRow.value as SystemPopup[]) : [];
  },
  ["system-popups"],
  { revalidate: 30, tags: ["system-popups"] },
);

/**
 * Uygulama iskeleti: kenar çubuğu (md+) / alt sekme çubuğu (mobil), 64px başlık
 * (admin için arama, bildirim, hesap) ve max 1440px ortalanmış içerik.
 */
export async function AppShell({ role, children, fullBleed = false }: { role: Role; children: ReactNode; fullBleed?: boolean }) {
  const actor = await requireActor(role);
  const user = await getSessionUser();
  const navRole: Role = actor.staffRole ?? actor.role;
  // Yöneticinin gizlediği menü öğelerini client tarafta sakla (daraltıcı katman; kod kuralları değişmez).
  // Ajans çalışanı ADMIN yetkisiyle çalışır ama görünürlük kuralları kendi rolüne (AGENCY) göre uygulanır.
  const permRole: Role = actor.staffRole ?? actor.role;
  const perms: PagePermissionRow[] = await loadPagePermissions(permRole, actor.userId);
  const permCtx = { perms, role: permRole, userId: actor.userId };
  const t = await getT();
  const allPopups = await getCachedSystemPopups();
  const userEmail = (user?.email ?? "").toLowerCase();
  const popups = allPopups.filter(
    (p) =>
      p.audience === "all" ||
      (p.audience === "influencers" && navRole === "INFLUENCER") ||
      (p.audience === "brands" && navRole === "BRAND") ||
      (p.audience === "agency" && (navRole === "ADMIN" || navRole === "AGENCY")) ||
      (p.audience === "single" && p.targetEmail?.toLowerCase() === userEmail),
  );

  return (
    <div className="relative isolate flex min-h-dvh bg-bg text-fg">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 right-[-10%] h-[520px] w-[520px] rounded-full bg-neon-pink/10 blur-[140px] animate-aurora" />
        <div className="absolute bottom-[-20%] left-[10%] h-[560px] w-[560px] rounded-full bg-neon-cyan/8 blur-[140px] animate-aurora [animation-delay:-9s]" />
        <div className="bg-grid absolute inset-0 opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
      </div>
      <a
        href="#icerik"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-[8px] focus:bg-fg focus:px-3 focus:py-2 focus:text-bg"
      >
        {t("common.skip", "İçeriğe geç")}
      </a>
      <Sidebar role={navRole} perm={permCtx} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-2.5 border-b border-line bg-bg/70 px-3 backdrop-blur-xl sm:gap-4 sm:px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-2 md:hidden">
            <MobileDrawer
              role={navRole}
              perm={permCtx}
              userName={user?.name ?? ""}
              userEmail={user?.email ?? ""}
              roleLabel={t(`role.${navRole}`, roleLabels[navRole])}
            />
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-[15px] font-semibold tracking-tight">
              <NordvowMark size={22} />
              <span className="truncate">{BRAND_NAME}</span>
            </span>
          </div>
          {role === "ADMIN" ? (
            <form action="/admin/ara" method="get" role="search" className="hidden max-w-md flex-1 sm:block">
              <label htmlFor="global-search" className="sr-only">
                {t("shell.search", "Kampanya, influencer veya marka ara")}
              </label>
              <div className="relative">
                <SearchIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-passive" />
                <input
                  id="global-search"
                  name="q"
                  type="search"
                  minLength={2}
                  placeholder={t("shell.search", "Kampanya, influencer veya marka ara")}
                  className="h-9 w-full rounded-[8px] border border-border bg-surface pr-3 pl-9 text-sm text-fg placeholder:text-fg-passive transition-standard hover:border-border-strong focus:border-fg focus:outline-none"
                />
              </div>
            </form>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div className="hidden md:flex md:items-center md:gap-2">
              <RegionSwitcher />
              <ThemeToggle />
            </div>
            <NotificationBell userId={actor.userId} />
            <div className="hidden md:flex">
              <AccountMenu name={user?.name ?? ""} email={user?.email ?? ""} roleLabel={t(`role.${navRole}`, roleLabels[navRole])} />
            </div>
          </div>
        </header>
        <main
          id="icerik"
          className={
            fullBleed
              ? "flex w-full flex-1 flex-col px-2 pt-2 pb-4 md:px-4"
              : "mx-auto w-full max-w-[1440px] flex-1 px-4 pt-6 pb-10 md:px-8 md:pt-8 md:pb-12"
          }
        >
          {children}
        </main>
        {!fullBleed ? (
          <footer className="border-t border-line bg-bg/50 px-4 py-4 text-xs text-fg-passive md:px-8">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3">
              <span>© {new Date().getFullYear()} {BRAND_NAME}</span>
              <nav aria-label={t("footer.nav", "Alt bağlantılar")} className="flex flex-wrap items-center gap-4">
                <Link href="/blog" className="font-medium text-fg-muted hover:text-fg">Blog</Link>
                <Link href="/docs" className="hover:text-fg">{t("footer.docs", "Rehber")}</Link>
                <Link href="/destek" className="hover:text-fg">{t("footer.support", "Destek")}</Link>
                <Link href="/gizlilik" className="hover:text-fg">{t("footer.privacy", "Gizlilik")}</Link>
                <Link href="/kullanim-kosullari" className="hover:text-fg">{t("footer.terms", "Kullanım koşulları")}</Link>
              </nav>
            </div>
          </footer>
        ) : null}
      </div>
      {!fullBleed ? <CopilotLauncher /> : null}
      <AnnouncementPopup items={popups} userId={actor.userId} />
    </div>
  );
}
