import Link from "next/link";

const LINKS = [
  ["/gizlilik", "Gizlilik"],
  ["/kullanim-sartlari", "Kullanım şartları"],
  ["/kvkk-aydinlatma", "KVKK"],
  ["/cerez-politikasi", "Çerezler"],
  ["/veri-silme", "Veri silme"],
  ["/mesafeli-satis", "Mesafeli satış"],
  ["/iade-iptal", "İade"],
  ["/ileti-izni", "İleti izni"],
] as const;

/** Alt bilgi ve giriş kabuğunda ortak yasal bağlantılar. */
export function LegalFooterNav({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Yasal" className={className}>
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} className="hover:text-fg">{label}</Link>
      ))}
    </nav>
  );
}
