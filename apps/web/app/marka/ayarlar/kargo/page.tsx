import type { Metadata } from "next";
import { requireActor } from "@/lib/auth-guard";
import { PageHeader } from "@/components/ui/layout";
import { listBrandShippingIntegrations } from "@infulancer/core/shipping/service";
import { BrandShippingIntegrationsPanel } from "@/components/shipping/brand-integrations-panel";

export const metadata: Metadata = { title: "Kargo Entegrasyonları" };
export const dynamic = "force-dynamic";

export default async function BrandCargoSettingsPage() {
  const actor = await requireActor("BRAND");
  const integrations = await listBrandShippingIntegrations(actor.brandId!);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        title="Kargo Entegrasyonları"
        description="Anlaşmalı kargo firmalarınızın API bilgilerini tanımlayın, bağlantıyı test edin veya platform dışı manuel takip kullanın."
      />
      <BrandShippingIntegrationsPanel items={integrations} />
    </div>
  );
}

