"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@infulancer/core/enums";
import { isPathVisibleForMenu } from "@infulancer/core/access/page-visibility";
import { NordvowMark } from "@/components/brand/logo";
import { RegionSwitcher } from "@/components/i18n/region-switcher";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { BRAND_NAME } from "@/lib/brand";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n/client";
import { useTT } from "@/lib/i18n/tt-client";
import { isActive, isDefaultOpenForRole, navByRole, navLabel } from "./nav";
import type { PermCtx } from "./sidebar";

export function MobileDrawer({
  role,
  perm,
  userName,
  userEmail,
  roleLabel,
}: {
  role: Role;
  perm?: PermCtx;
  userName: string;
  userEmail: string;
  roleLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useT();
  const tt = useTT();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const candidateItems = role === "AGENCY" ? navByRole.ADMIN : (navByRole[role] ?? []);
  const items = candidateItems.filter((i) =>
    perm ? isPathVisibleForMenu(perm.perms, perm.role, perm.userId, i.href, isDefaultOpenForRole(role, i.href)) : isDefaultOpenForRole(role, i.href),
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={tt("Menüyü aç")}
        aria-expanded={open}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-surface/70 text-fg transition-standard hover:bg-surface-hover md:hidden"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex md:hidden" role="dialog" aria-modal="true" aria-label={tt("Mobil gezinme menüsü")}>
          <button
            type="button"
            aria-label={tt("Menüyü kapat")}
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
          />
          <aside className="relative z-10 flex h-dvh w-[84vw] max-w-xs flex-col border-r border-line bg-bg/95 backdrop-blur-xl">
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-line px-4">
              <Link href={items[0]?.href ?? "/"} onClick={() => setOpen(false)} className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight text-fg">
                <NordvowMark size={22} />
                <span>{BRAND_NAME}</span>
              </Link>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label={tt("Menüyü kapat")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                ✕
              </button>
            </div>

            <div className="border-b border-line bg-surface/40 px-4 py-3">
              <p className="truncate text-sm font-semibold text-fg">{userName || roleLabel}</p>
              <p className="truncate text-xs text-fg-muted">{userEmail}</p>
              <span className="mt-1.5 inline-block rounded-full border border-line bg-bg px-2.5 py-0.5 text-[11px] font-medium text-fg-muted">
                {roleLabel}
              </span>
            </div>

            <nav aria-label={tt("Tüm sayfalar")} className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
              {items.map((item, idx) => {
                const active = isActive(pathname, item);
                const showSection = item.section && item.section !== items[idx - 1]?.section;
                const Icon = item.icon;
                return (
                  <div key={item.href} className="flex flex-col gap-1">
                    {showSection ? (
                      <span className="px-3 pb-0.5 pt-3 text-[11px] font-medium uppercase tracking-wide text-fg-passive">
                        {t(`section.${item.section}`, item.section!)}
                      </span>
                    ) : null}
                    <Link
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-11 items-center gap-3 rounded-[10px] px-3 text-sm transition-standard",
                        active
                          ? "bg-surface font-medium text-fg shadow-[inset_2px_0_0_var(--color-neon-pink)]"
                          : "text-fg-muted hover:bg-surface-hover hover:text-fg",
                      )}
                    >
                      <Icon size={18} />
                      <span className="truncate">{navLabel(t, role, item)}</span>
                    </Link>
                  </div>
                );
              })}
            </nav>

            <div className="flex shrink-0 flex-col gap-2.5 border-t border-line bg-surface/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-fg-muted">{tt("Dil ve bölge")}</span>
                <RegionSwitcher />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-fg-muted">{tt("Görünüm teması")}</span>
                <ThemeToggle />
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
