import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";

export const metadata: Metadata = { title: "KVKK Aydınlatma Metni" };
export const dynamic = "force-dynamic";

/** Eski adres. Aynı aydınlatma metni, yönlendirme yok. */
export default function KvkkAliasPage() {
  return <LegalPage id="kvkk" current="/kvkk" />;
}
