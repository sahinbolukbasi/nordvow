import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Gizlilik Politikası" };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return <LegalPage id="privacy" current="/gizlilik" />;
}
