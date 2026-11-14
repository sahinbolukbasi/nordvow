import type { Metadata } from "next";
import { TermsView } from "../kullanim-kosullari/page";

export const metadata: Metadata = { title: "Kullanım Şartları" };
export const dynamic = "force-dynamic";

/** /kullanim-kosullari ile aynı metin; Meta App Review için yönlendirmesiz adres. */
export default function TermsAliasPage() {
  return <TermsView title="Kullanım Şartları" current="/kullanim-sartlari" />;
}
