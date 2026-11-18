import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/layout";
import { VoiceAssistantAdminPanel } from "@/components/admin/voice-assistant-admin-panel";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "Sesli Asistan" };
export const dynamic = "force-dynamic";

export default async function VoiceAssistantPage() {
  const actor = await requireActor("ADMIN", "BRAND");
  const brands =
    actor.role === "ADMIN"
      ? await prisma.brand.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : await prisma.brand.findMany({
          where: { id: actor.brandId ?? "-" },
          select: { id: true, name: true },
        });

  const initialBrandId = actor.brandId ?? brands[0]?.id ?? "default";

  return (
    <AppShell role={actor.role}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Sesli Asistan & Çağrı Yönetimi"
          description="Tüm markalar için ayrı ayrı açılıp yönetilebilen gerçekçi Türkçe sesli asistan, operatör yönlendirme, firma bilgi bankası, rezervasyon ve çağrı kayıtları."
        />
        <VoiceAssistantAdminPanel brands={brands} initialBrandId={initialBrandId} />
      </div>
    </AppShell>
  );
}
