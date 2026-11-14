import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Kullanım Koşulları" };
export const dynamic = "force-dynamic";

/** Eski adres. Aynı sözleşme, yönlendirme yok. */
export default function TermsAliasPage() {
  return <LegalPage id="terms" current="/kullanim-kosullari" />;
}
