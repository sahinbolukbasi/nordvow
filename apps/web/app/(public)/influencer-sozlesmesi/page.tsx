import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "Influencer Sözleşmesi" };
export const dynamic = "force-dynamic";

export default function InfluencerContractPage() {
  return <LegalPage id="influencer" current="/influencer-sozlesmesi" />;
}
