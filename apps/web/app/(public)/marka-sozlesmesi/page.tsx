import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Marka Sözleşmesi" };
export const dynamic = "force-dynamic";

export default function BrandContractPage() {
  return <LegalPage id="brand" current="/marka-sozlesmesi" />;
}
