import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { LinksScreen } from "@/components/notify/links-screen";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Linkler" };
export const dynamic = "force-dynamic";

export default async function BrandLinksPage() {
  const tt = await getTT();
  const actor = await requireActor("BRAND");
  return (
    <LinksScreen
      title={tt("Linkler")}
      description={tt("Markanıza ait kısa linkler. Başka markanın bağlantıları burada görünmez.")}
      where={{ tenantId: actor.brandId! }}
    />
  );
}
