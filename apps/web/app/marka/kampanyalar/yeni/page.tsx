import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { CampaignWizardPage } from "@/components/campaign/wizard/wizard-page";
import { Card } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/layout";
import { requireActor } from "@/lib/auth-guard";
import { getTT } from "@/lib/i18n/tt-server";

export const metadata: Metadata = { title: "Yeni kampanya" };
export const dynamic = "force-dynamic";

export default async function BrandNewCampaignPage() {
  const tt = await getTT();
  const actor = await requireActor("BRAND");
  const brand = await prisma.brand.findUnique({
    where: { id: actor.brandId! },
    select: { defaultExecutionMode: true },
  });

  if ((brand?.defaultExecutionMode ?? "AJANS") === "AJANS") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader
          title={tt("Kampanyalarınız Ajans Tarafından Yürütülüyor")}
          description={tt("Marka profil ayarlarınızda kampanya yönetim tercihiniz 'Kampanyalarımı Ajans Yönetsin' olarak seçili.")}
        />
        <Card interactive={false} className="flex flex-col gap-4">
          <p className="text-[14px] text-fg-muted">
            {tt("Ajans yönetimi modunda kampanya kurulumu, influencer seçimi ve operasyonel süreçler doğrudan ajans ekibimiz tarafından yürütülür. Mevcut kampanyalarınızın durumunu 'Süreci Takip Et' ekranından anlık izleyebilirsiniz.")}
          </p>
          <p className="text-[14px] text-fg-muted">
            {tt("Kendi kampanyanızı oluşturmak ve influencer seçimini doğrudan yönetmek (Self-Managed) istiyorsanız Marka Profili / Ayarlar sayfasından yönetim tercihinizi 'Kendim Yöneteceğim' olarak güncelleyebilirsiniz.")}
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <ButtonLink href="/marka/kampanyalar">{tt("Süreci Takip Et (Kampanyalarım)")}</ButtonLink>
            <ButtonLink href="/profil" variant="secondary">{tt("Marka Profili / Yönetim Tercihini Değiştir")}</ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  return <CampaignWizardPage actor={actor} campaignId={null} />;
}
