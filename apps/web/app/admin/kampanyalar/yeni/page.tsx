import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { QuickCampaignWizard } from "@/components/campaign/quick-campaign-wizard";
import { CampaignWizardPage } from "@/components/campaign/wizard/wizard-page";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/layout";
import { requireActor } from "@/lib/auth-guard";
import { CAMPAIGN_CATALOG_KEY, type CampaignCatalogEntry } from "@/lib/actions/campaign-catalog";
export const metadata: Metadata = { title: "Yeni kampanya" };
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ marka?: string; mod?: string; kampanyaId?: string }> }) {
  const tt = await getTT();
  const { marka, mod, kampanyaId } = await searchParams;
  const actor = await requireActor("ADMIN");
  const [brands, categories, catalogRow] = await Promise.all([
    prisma.brand.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.category.findMany({ select: { name: true }, orderBy: { name: "asc" }, take: 50 }),
    prisma.configValue.findUnique({ where: { key: CAMPAIGN_CATALOG_KEY }, select: { value: true } }),
  ]);
  const catalog = Array.isArray(catalogRow?.value) ? (catalogRow.value as unknown as CampaignCatalogEntry[]).filter((x) => x.active) : [];
  if (brands.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title={tt("Yeni kampanya")} />
        <EmptyState message={tt("Kampanya açmak için önce bir marka ekleyin.")} action={{ label: "Marka ekle", href: "/admin/markalar/yeni" }} />
      </div>
    );
  }
  const selectedBrandId = brands.some((b) => b.id === marka) ? marka : brands[0]?.id;
  const existing = kampanyaId
    ? await prisma.campaign.findUnique({ where: { id: kampanyaId }, select: { id: true, name: true } })
    : null;
  if (mod === "gelismis") {
    return <CampaignWizardPage actor={actor} campaignId={null} defaultBrandId={selectedBrandId} />;
  }
  return (
    <QuickCampaignWizard
      role="ADMIN"
      brands={brands}
      defaultBrandId={selectedBrandId}
      initialCampaignId={existing?.id}
      initialCampaignName={existing?.name}
      categoryOptions={categories.map((c) => c.name)}
      catalog={catalog}
    />
  );
}
