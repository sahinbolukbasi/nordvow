"use client";
import type { ComponentType } from "react";
import type { Role } from "@infulancer/core/enums";
import {
  AlertIcon,
  BookOpenIcon,
  GridIcon,
  NewspaperIcon,
  PhoneIcon,
  SettingsIcon,
  TruckIcon,
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
    // 1. Genel & Operasyon
    { href: "/admin", label: "Genel bakış", icon: HomeIcon, exact: true, section: "Operasyon", order: 10 },
    { href: "/admin/kampanyalar", label: "Kampanyalar", icon: MegaphoneIcon, section: "Operasyon", order: 20 },
    { href: "/admin/teklifler", label: "Teklifler", icon: WalletIcon, section: "Operasyon", order: 30 },
    { href: "/admin/takvim", label: "Takvim", icon: CalendarIcon, section: "Operasyon", order: 40 },
    { href: "/admin/kargo", label: "Kargo yönetimi", icon: TruckIcon, section: "Operasyon", order: 50 },

    // 2. Taraflar & İletişim
    { href: "/admin/influencerlar", label: "Influencerlar", icon: UsersIcon, section: "Taraflar ve İletişim", order: 100 },
    { href: "/admin/markalar", label: "Markalar", icon: BuildingIcon, section: "Taraflar ve İletişim", order: 110 },
    { href: "/admin/kullanicilar", label: "Kullanıcılar", icon: UsersIcon, section: "Taraflar ve İletişim", order: 120 },
    { href: "/admin/davetler", label: "Davetler", icon: UserIcon, section: "Taraflar ve İletişim", order: 130 },
    { href: "/dashboard/iletisim/gelen-kutusu", label: "İletişim Merkezi", icon: BellIcon, section: "Taraflar ve İletişim", order: 138 },
    { href: "/admin/iletisim", label: "Admin İletişim", icon: SettingsIcon, section: "Taraflar ve İletişim", order: 140 },
    { href: "/admin/whatsapp-ai", label: "WhatsApp AI Takip", icon: SparkleIcon, section: "Taraflar ve İletişim", order: 145 },
    { href: "/admin/destek", label: "Destek talepleri", icon: AlertIcon, section: "Taraflar ve İletişim", order: 150 },

    // 3. Pazarlama & Araçlar
    { href: "/creative", label: "Creative", icon: SparkleIcon, section: "Pazarlama ve Araçlar", order: 200 },
    { href: "/admin/reklam", label: "Reklam", icon: MegaphoneIcon, section: "Pazarlama ve Araçlar", order: 210 },
    { href: "/admin/etkinlikler", label: "Etkinlikler", icon: CalendarIcon, section: "Pazarlama ve Araçlar", order: 220 },
    { href: "/admin/qr-giris", label: "QR Giriş & Biletler", icon: GridIcon, section: "Pazarlama ve Araçlar", order: 225 },
    { href: "/admin/kuponlar", label: "Kuponlar", icon: WalletIcon, section: "Pazarlama ve Araçlar", order: 230 },
    { href: "/admin/linkler", label: "Linkler", icon: LinkIcon, section: "Pazarlama ve Araçlar", order: 240 },
    { href: "/dashboard/voice-assistant", label: "Sesli asistan", icon: PhoneIcon, section: "Pazarlama ve Araçlar", order: 250 },

    // 4. Finans & Kredi
    { href: "/admin/finans", label: "Finans", icon: WalletIcon, section: "Finans ve Kredi", order: 300 },
    { href: "/admin/krediler", label: "Kredi yönetimi", icon: WalletIcon, section: "Finans ve Kredi", order: 310 },
    { href: "/admin/bakiye-talepleri", label: "Bakiye talepleri", icon: WalletIcon, section: "Finans ve Kredi", order: 320 },

    // 5. Sistem & İçerik
    { href: "/admin/yetkiler", label: "Rol ve yetkiler", icon: SettingsIcon, section: "Sistem ve İçerik", order: 400 },
    { href: "/admin/uyum", label: "Uyum", icon: AlertIcon, section: "Sistem ve İçerik", order: 410 },
    { href: "/admin/ai", label: "AI sağlayıcıları", icon: SparkleIcon, section: "Sistem ve İçerik", order: 420 },
    { href: "/admin/agent", label: "Agent merkezi", icon: SparkleIcon, section: "Sistem ve İçerik", order: 430 },
    { href: "/admin/kategoriler", label: "Kategoriler", icon: GridIcon, section: "Sistem ve İçerik", order: 440 },
    { href: "/admin/bildirimler", label: "Bildirimler", icon: BellIcon, section: "Sistem ve İçerik", order: 450 },
    { href: "/admin/blog", label: "Blog & SEO", icon: NewspaperIcon, section: "Sistem ve İçerik", order: 460 },
    { href: "/admin/global", label: "Global & Çeviriler", icon: SettingsIcon, section: "Sistem ve İçerik", order: 465 },
    { href: "/admin/tanitim", label: "Tanıtım sayfası", icon: GridIcon, section: "Sistem ve İçerik", order: 470 },
    { href: "/docs", label: "Dokümantasyon", icon: BookOpenIcon, section: "Sistem ve İçerik", order: 480 },
  ],
  // Ajans çalışanı: yönetici ekranları (kullanıcılar, yetkiler, finans, tanıtım, AI sağlayıcıları) hariç.
  AGENCY: [],
  BRAND: [
    { href: "/marka", label: "Genel bakış", icon: HomeIcon, exact: true, section: "Kampanya ve İş Akışı", order: 10 },
    { href: "/marka/kampanyalar", label: "Kampanyalar", icon: MegaphoneIcon, section: "Kampanya ve İş Akışı", order: 20 },
    { href: "/marka/kesfet", label: "Influencer bul", icon: UsersIcon, section: "Kampanya ve İş Akışı", order: 30 },
    { href: "/marka/teklifler", label: "Teklifler", icon: WalletIcon, section: "Kampanya ve İş Akışı", order: 40 },
    { href: "/marka/odemeler", label: "Ödemeler & Faturalar", icon: WalletIcon, section: "Kampanya ve İş Akışı", order: 45 },
    { href: "/marka/takvim", label: "Takvim", icon: CalendarIcon, section: "Kampanya ve İş Akışı", order: 50 },

    { href: "/creative", label: "Creative", icon: SparkleIcon, section: "Pazarlama ve Araçlar", order: 100 },
    { href: "/marka/reklam", label: "Reklam", icon: MegaphoneIcon, section: "Pazarlama ve Araçlar", order: 110 },
    { href: "/marka/etkinlikler", label: "Etkinlikler", icon: CalendarIcon, section: "Pazarlama ve Araçlar", order: 120 },
    { href: "/marka/qr-giris", label: "QR Giriş & Biletler", icon: GridIcon, section: "Pazarlama ve Araçlar", order: 125 },
    { href: "/marka/kuponlar", label: "Kuponlar", icon: WalletIcon, section: "Pazarlama ve Araçlar", order: 130 },

    { href: "/dashboard/iletisim/gelen-kutusu", label: "İletişim", icon: BellIcon, section: "İletişim", order: 195 },

    { href: "/profil", label: "Profilim", icon: UserIcon, section: "Hesap ve Yardım", order: 300 },
    { href: "/docs", label: "Yardım", icon: BookOpenIcon, section: "Hesap ve Yardım", order: 310 },
    { href: "/destek", label: "Destek", icon: AlertIcon, section: "Hesap ve Yardım", order: 320 },
    { href: "/blog", label: "Blog", icon: NewspaperIcon, section: "Hesap ve Yardım", order: 330 },
  ],
  INFLUENCER: [
    { href: "/influencer", label: "İşlerim", icon: HomeIcon, exact: true, section: "İş Akışım", order: 10 },
    { href: "/influencer/teklifler", label: "Teklifler", icon: MegaphoneIcon, section: "İş Akışım", order: 20 },
    { href: "/influencer/takvim", label: "Takvim", icon: CalendarIcon, section: "İş Akışım", order: 30 },
    { href: "/influencer/davetlerim", label: "Davetlerim", icon: CalendarIcon, section: "İş Akışım", order: 40 },

    { href: "/creative", label: "Creative", icon: SparkleIcon, section: "Üretim ve Kazanç", order: 100 },
    { href: "/dashboard/iletisim/gelen-kutusu", label: "İletişim", icon: BellIcon, section: "Üretim ve Kazanç", order: 105 },
    { href: "/influencer/odemeler", label: "Ödemeler", icon: WalletIcon, section: "Üretim ve Kazanç", order: 110 },

    { href: "/profil", label: "Profilim", icon: UserIcon, section: "Hesap ve Rehber", order: 200 },
    { href: "/docs", label: "Rehber", icon: BookOpenIcon, section: "Hesap ve Rehber", order: 210 },
    { href: "/destek", label: "Destek", icon: AlertIcon, section: "Hesap ve Rehber", order: 220 },
    { href: "/blog", label: "Blog", icon: NewspaperIcon, section: "Hesap ve Rehber", order: 230 },
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
