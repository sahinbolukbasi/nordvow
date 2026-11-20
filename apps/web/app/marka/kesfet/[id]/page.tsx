import { getTT } from "@/lib/i18n/tt-server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@infulancer/core/db";
import { syncInfluencer } from "@infulancer/core/social/sync";
import { CreatorShowcase } from "@/components/showcase/creator-showcase";
import { ButtonLink } from "@/components/ui/form";
import { requireActor } from "@/lib/auth-guard";
export const metadata: Metadata = { title: "İçerik üreticisi profili" };
export const dynamic = "force-dynamic";

async function syncIfStale(influencerId: string, accounts: { lastSyncedAt: Date | null }[]) {
  const staleAt = Date.now() - 3_600_000;
  if (accounts.some((a) => !a.lastSyncedAt)) {
    await syncInfluencer(influencerId).catch(() => {});
  } else if (accounts.some((a) => a.lastSyncedAt && a.lastSyncedAt.getTime() < staleAt)) {
    void syncInfluencer(influencerId).catch(() => {});
  }
}

/** Marka: içerik üreticisinin detaylı profili (vitrin). Gizli profiller açılmaz. */
export default async function CreatorProfileForBrand({ params }: { params: Promise<{ id: string }> }) {
  const tt = await getTT();
  await requireActor("BRAND");
  const { id } = await params;
  const inf = await prisma.influencer.findFirst({
    where: { id, isActive: true, showcaseVisible: true, user: { status: "ACTIVE" } },
    select: { id: true, socialAccounts: { select: { lastSyncedAt: true } } },
  });
  if (!inf) notFound();
  await syncIfStale(inf.id, inf.socialAccounts);
  return (
    <div className="flex flex-col gap-4">
      <ButtonLink href="/marka/kesfet" variant="ghost" size="sm" className="w-fit">{tt("← Influencer bul")}</ButtonLink>
      <CreatorShowcase
        influencerId={inf.id}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href={`/marka/kesfet?sec=${inf.id}`} className="bg-neon text-black">{tt("Teklif gönder →")}</ButtonLink>
          </div>
        }
      />
    </div>
  );
}
