import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Ticari Elektronik İleti Onayı" };
export const dynamic = "force-dynamic";

export default function CommercialConsentPage() {
  return <LegalPage id="iys" current="/ileti-izni" />;
}
