import type { ReactNode } from "react";
import Link from "next/link";
import type { Role } from "@infulancer/core/enums";
import { AppShell } from "@/components/shell/app-shell";
import { cn } from "@/lib/cn";
import type { DurumBandiBilgi } from "@/lib/iletisim/context";
import { IletisimDurumBandi } from "./durum-bandi";

export type IletisimSekme = "gelen-kutusu" | "otomasyonlar" | "ayarlar";

/**
 * Sadeleştirilmiş İletişim Merkezi kabuğu (en fazla 3 üst sekme).
 * Üstteki 4 modül kartı ve tekrarlı giriş noktaları kaldırıldı.
 */
export function IletisimShell({
  role,
  activeTab,
  awaitingHuman,
  banner,
  isAdmin,
  activeTenantName,
  markaQs,
  children,
}: {
  role: Role;
  activeTab: IletisimSekme;
  awaitingHuman: number;
  banner: DurumBandiBilgi;
  isAdmin: boolean;
  activeTenantName: string;
  markaQs: string;
  children: ReactNode;
}) {
  const tabs: { id: IletisimSekme; label: string; href: string; badge?: number }[] = [
    {
      id: "gelen-kutusu",
      label: "Gelen Kutusu",
      href: `/dashboard/iletisim/gelen-kutusu${markaQs}`,
      badge: awaitingHuman > 0 ? awaitingHuman : undefined,
    },
    {
      id: "otomasyonlar",
      label: "Otomasyonlar",
      href: `/dashboard/iletisim/otomasyonlar${markaQs}`,
    },
    {
      id: "ayarlar",
      label: "Ayarlar",
      href: `/dashboard/iletisim/ayarlar/kanallar${markaQs}`,
    },
  ];

  return (
    <AppShell role={role} fullBleed>
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-3 sm:p-5">
        {/* Admin bir markayı görüntülerken üstte belirgin bilgi şeridi */}
        {isAdmin ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
            <span>
              <strong>{activeTenantName}</strong> olarak görüntülüyorsunuz.
            </span>
            <Link href="/admin/iletisim" className="font-semibold underline underline-offset-4 hover:text-white">
              Admin İletişim&apos;e dön →
            </Link>
          </div>
        ) : null}

        {/* Sade 3 Sekmeli Üst Çubuk */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
          <div className="flex flex-wrap items-center gap-4">
            <h1 className="text-base font-semibold tracking-tight text-fg sm:text-lg">İletişim</h1>
            <nav aria-label="İletişim sekmeleri" className="flex items-center gap-1.5">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <Link
                    key={tab.id}
                    href={tab.href}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-medium transition sm:text-[13px]",
                      active
                        ? "border-fg bg-fg text-bg"
                        : "border-line bg-surface text-fg-muted hover:border-fg/40 hover:text-fg",
                    )}
                  >
                    <span>{tab.label}</span>
                    {tab.badge ? (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                          active ? "bg-bg text-fg" : "bg-red-500/15 text-red-400",
                        )}
                      >
                        {tab.badge} bekliyor
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>

        {/* Tek Durum Bandı (en ciddi sorun varsa görünür) */}
        <IletisimDurumBandi banner={banner} />

        {children}
      </div>
    </AppShell>
  );
}

