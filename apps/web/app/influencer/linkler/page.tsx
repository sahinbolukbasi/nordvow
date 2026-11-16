import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { LinksScreen } from "@/components/notify/links-screen";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Linkler" };
export const dynamic = "force-dynamic";

export default async function InfluencerLinksPage() {
  const tt = await getTT();
  const actor = await requireActor("INFLUENCER");
  return (
    <LinksScreen
      title={tt("Linkler")}
      description={tt("Sizin oluşturduğunuz kısa linkler.")}
      where={{ OR: [{ tenantId: actor.influencerId! }, { createdByUserId: actor.userId }] }}
    />
  );
}
