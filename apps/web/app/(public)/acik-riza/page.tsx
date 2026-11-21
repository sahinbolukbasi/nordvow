import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Açık Rıza Metni" };
export const dynamic = "force-dynamic";

export default function ConsentPage() {
  return <LegalPage id="consent" current="/acik-riza" />;
}
