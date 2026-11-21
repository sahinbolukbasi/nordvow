import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Mesafeli Satış Sözleşmesi" };
export const dynamic = "force-dynamic";

export default function DistanceSalesPage() {
  return <LegalPage id="distance" current="/mesafeli-satis" />;
}
