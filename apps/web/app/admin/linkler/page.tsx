import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { LinksScreen } from "@/components/notify/links-screen";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Linkler" };
export const dynamic = "force-dynamic";

export default async function AdminLinksPage() {
  const tt = await getTT();
  await requireActor("ADMIN");
  return <LinksScreen title={tt("Linkler")} description={tt("Uzun bağlantıları kısaltın ve her tıklamayı ölçün. Kampanya, duyuru ve sosyal paylaşımlarda kullanın.")} where={{}} />;
}
