import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "KVKK Aydınlatma Metni" };
export const dynamic = "force-dynamic";

export default function KvkkNoticePage() {
  return <LegalPage id="kvkk" current="/kvkk-aydinlatma" />;
}
