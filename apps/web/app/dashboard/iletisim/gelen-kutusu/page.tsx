import type { Metadata } from "next";
import { UnifiedInboxShell } from "@/components/inbox/unified-inbox-shell";
import { IletisimShell } from "@/components/iletisim/iletisim-shell";
import { KurulumListesi } from "@/components/iletisim/kurulum-listesi";
import { loadIletisimContext } from "@/lib/iletisim/context";

export const metadata: Metadata = { title: "Gelen Kutusu · Nordvow" };
export const dynamic = "force-dynamic";

export default async function GelenKutusuPage({
  searchParams,
}: {
  searchParams: Promise<{ marka?: string }>;
}) {
  const sp = await searchParams;
  const ctx = await loadIletisimContext(sp.marka);

  return (
    <IletisimShell
      role={ctx.actor.role}
      activeTab="gelen-kutusu"
      awaitingHuman={ctx.awaitingHuman}
      banner={ctx.banner}
      isAdmin={ctx.isAdmin}
      activeTenantName={ctx.activeTenantName}
      markaQs={ctx.markaQs}
    >
      <KurulumListesi steps={ctx.checklist} />
      <UnifiedInboxShell
        initialTenantId={ctx.activeTenantId}
        tenantOptions={ctx.visibleTenantOptions}
        actorName={ctx.actorName}
      />
    </IletisimShell>
  );
}

