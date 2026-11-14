import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "İade ve İptal" };
export const dynamic = "force-dynamic";

export default function RefundPage() {
  return <LegalPage id="refund" current="/iade-iptal" />;
}
