"use client";
import type { ComponentType } from "react";
import type { Role } from "@infulancer/core/enums";
import {
  AlertIcon,
  BookOpenIcon,
  FileIcon,
  GridIcon,
  NewspaperIcon,
  SettingsIcon,
  UserIcon,
  BellIcon,
  BuildingIcon,
  CalendarIcon,
  HomeIcon,
  LinkIcon,
  MegaphoneIcon,
  SparkleIcon,
  UsersIcon,
  WalletIcon,
  type IconProps,
} from "@/components/icons";
export type NavItem = { href: string; label: string; icon: ComponentType<IconProps>; exact?: boolean; section?: string; order?: number };
/**
 * Rol başına gezinme öğeleri (kenar çubuğu ve mobil sekme çubuğu ortak kullanır).
 * Sıra önemlidir: mobil sekme çubuğu yalnız ilk 5 öğeyi gösterir, bu yüzden en sık
 * kullanılanlar başa alınır. `section` alanı kenar çubuğunda grup başlığı oluşturur.
 */
export const navByRole: Record<Role, NavItem[]> = {
  ADMIN: [
    { href: "/admin", label: "Genel bakış", icon: HomeIcon, exact: true, section: "Çalışma" },
    { href: "/admin/kampanyalar", label: "Kampanyalar", icon: MegaphoneIcon, section: "Çalışma" },
    { href: "/admin/kargo", label: "Kargo yönetimi", icon: FileIcon, section: "Çalışma" },
    { href: "/admin/teklifler", label: "Teklifler", icon: WalletIcon, section: "Çalışma" },
    { href: "/admin/takvim", label: "Takvim", icon: CalendarIcon, section: "Çalışma" },
    { href: "/admin/influencerlar", label: "Influencerlar", icon: UsersIcon, section: "Taraflar" },
    { href: "/admin/markalar", label: "Markalar", icon: BuildingIcon, section: "Taraflar" },
    { href: "/admin/kanallar", label: "Mesajlar ve asistan", icon: LinkIcon, section: "Taraflar" },
    { href: "/dashboard/voice-assistant", label: "Sesli asistan", icon: BellIcon, section: "Taraflar" },
    { href: "/admin/reklam", label: "Reklam", icon: MegaphoneIcon, section: "İçerik ve AI" },
    { href: "/creative", label: "Creative", icon: SparkleIcon, section: "İçerik ve AI" },
    { href: "/admin/krediler", label: "Kredi yönetimi", icon: WalletIcon, section: "İçerik ve AI" },
    { href: "/admin/bakiye-talepleri", label: "Bakiye talepleri", icon: WalletIcon, section: "İçerik ve AI" },
    { href: "/admin/ai", label: "AI sağlayıcıları", icon: SparkleIcon, section: "İçerik ve AI" },
    { href: "/admin/bildirimler", label: "Bildirimler", icon: BellIcon, section: "İçerik ve AI" },
    { href: "/admin/linkler", label: "Linkler", icon: LinkIcon, section: "İçerik ve AI" },
    { href: "/admin/etkinlikler", label: "Etkinlikler", icon: CalendarIcon, section: "İçerik ve AI" },
    { href: "/admin/kuponlar", label: "Kuponlar", icon: WalletIcon, section: "İçerik ve AI" },
    { href: "/admin/finans", label: "Finans", icon: WalletIcon, section: "Para ve uyum" },
    { href: "/admin/uyum", label: "Uyum", icon: AlertIcon, section: "Para ve uyum" },
    { href: "/admin/kullanicilar", label: "Kullanıcılar", icon: UsersIcon, section: "Yönetim" },
    { href: "/admin/yetkiler", label: "Rol ve yetkiler", icon: SettingsIcon, section: "Yönetim" },
    { href: "/admin/davetler", label: "Davetler", icon: UserIcon, section: "Yönetim" },
    { href: "/admin/kategoriler", label: "Kategoriler", icon: CalendarIcon, section: "Yönetim" },
    { href: "/admin/agent", label: "Agent merkezi", icon: SparkleIcon, section: "Yönetim" },
    { href: "/admin/tanitim", label: "Tanıtım sayfası", icon: GridIcon, section: "Yönetim" },
    { href: "/admin/blog", label: "Blog & SEO", icon: NewspaperIcon, section: "Yönetim", order: 210 },
    { href: "/docs", label: "Dokümantasyon", icon: BookOpenIcon, section: "Yönetim", order: 220 },
    { href: "/admin/destek", label: "Destek talepleri", icon: AlertIcon, section: "Yönetim", order: 230 },
  ],
  // Ajans çalışanı: yönetici ekranları (kullanıcılar, yetkiler, finans, tanıtım, AI sağlayıcıları) hariç.
  AGENCY: [],
  BRAND: [
    { href: "/marka", label: "Genel bakış", icon: HomeIcon, exact: true, order: 10 },
    { href: "/marka/kampanyalar", label: "Kampanyalar", icon: MegaphoneIcon, order: 20 },
    { href: "/marka/takvim", label: "Takvim", icon: CalendarIcon, order: 30 },
    { href: "/marka/kesfet", label: "Influencer bul", icon: UsersIcon, order: 40 },
    { href: "/marka/teklifler", label: "Teklifler", icon: WalletIcon, order: 50 },
    { href: "/creative", label: "Creative", icon: SparkleIcon, order: 60 },
    { href: "/marka/reklam", label: "Reklam", icon: MegaphoneIcon, order: 70 },
    { href: "/marka/etkinlikler", label: "Etkinlikler", icon: CalendarIcon, order: 80 },
    { href: "/marka/kuponlar", label: "Kuponlar", icon: WalletIcon, order: 90 },
    { href: "/marka/gelen-kutusu", label: "Gelen kutusu", icon: BellIcon, order: 100 },
    { href: "/marka/kanallar", label: "Kanallar ve asistan", icon: LinkIcon, order: 110 },
    { href: "/profil", label: "Profilim", icon: UserIcon, order: 200 },
    { href: "/blog", label: "Blog", icon: NewspaperIcon, order: 210 },
    { href: "/docs", label: "Yardım", icon: BookOpenIcon, order: 220 },
    { href: "/destek", label: "Destek", icon: AlertIcon, order: 230 },
  ],
  INFLUENCER: [
    { href: "/influencer", label: "İşlerim", icon: HomeIcon, exact: true, order: 10 },
    { href: "/influencer/takvim", label: "Takvim", icon: CalendarIcon, order: 20 },
    { href: "/influencer/teklifler", label: "Teklifler", icon: MegaphoneIcon, order: 30 },
    { href: "/influencer/davetlerim", label: "Davetlerim", icon: CalendarIcon, order: 40 },
    { href: "/creative", label: "Creative", icon: SparkleIcon, order: 50 },
    { href: "/influencer/odemeler", label: "Ödemeler", icon: WalletIcon, order: 60 },
    { href: "/profil", label: "Profilim", icon: UserIcon, order: 200 },
    { href: "/blog", label: "Blog", icon: NewspaperIcon, order: 210 },
    { href: "/docs", label: "Rehber", icon: BookOpenIcon, order: 220 },
    { href: "/destek", label: "Destek", icon: AlertIcon, order: 230 },
  ],
};
navByRole.AGENCY = navByRole.ADMIN.filter((i) => !["/admin/kullanicilar", "/admin/yetkiler", "/admin/tanitim", "/admin/finans", "/admin/ai", "/admin/krediler"].includes(i.href));

/** Rolün menü öğelerini tanımlı öncelik/sıra değerine göre sıralı döndürür. */
export function getOrderedNavForRole(role: Role): NavItem[] {
  const list = role === "AGENCY" ? navByRole.ADMIN : (navByRole[role] ?? []);
  return list
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => (a.item.order ?? (a.idx + 1) * 10) - (b.item.order ?? (b.idx + 1) * 10) || a.idx - b.idx)
    .map((x) => x.item);
}

/** Rolün varsayılan olarak açık gelen ekranları (PagePermission kaydı yoksa). */
export function isDefaultOpenForRole(role: Role, href: string): boolean {
  return (navByRole[role] ?? []).some((i) => i.href === href);
}

/**
 * Platformdaki tüm benzersiz ekranları döndürür: önce seçili rolün kendi ekranları,
 * ardından diğer rollerdeki ekranlar eklenir (Rol ve Yetkinlikler matrisi ile menü için).
 */
export function getAllPlatformPagesForRole(role: Role): NavItem[] {
  const own = navByRole[role] ?? [];
  const seen = new Set(own.map((i) => i.href));
  const rest: NavItem[] = [];
  for (const r of ["ADMIN", "BRAND", "INFLUENCER"] as Role[]) {
    for (const item of navByRole[r]) {
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      rest.push({
        ...item,
        section: undefined,
      });
    }
  }
  return [...own, ...rest];
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Menü etiketi seçili dilde (anahtar: nav.<href>; /docs rol başına farklı ad taşır). */
export function navLabel(t: (k: string, f: string) => string, role: Role, item: NavItem): string {
  if (item.href === "/docs" && role === "BRAND") return t("nav.docs.brand", item.label);
  if (item.href === "/docs" && role === "INFLUENCER") return t("nav.docs.influencer", item.label);
  return t(`nav.${item.href}`, item.label);
}
