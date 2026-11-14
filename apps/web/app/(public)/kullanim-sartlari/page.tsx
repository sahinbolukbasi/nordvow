import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Kullanım Şartları" };
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return <LegalPage id="terms" current="/kullanim-sartlari" />;
}
