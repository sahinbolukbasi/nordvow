import type { Metadata } from "next";
import { prisma } from "@infulancer/core/db";
import { AppShell } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/ui/layout";
import { VoiceAssistantConsole } from "@/components/voice/voice-assistant-console";
import { requireActor } from "@/lib/auth-guard";

export const metadata: Metadata = { title: "AI Sesli Asistan" };
export const dynamic = "force-dynamic";

export default async function VoiceAssistantPage() {
  const actor = await requireActor("ADMIN", "BRAND");
  const brands =
    actor.role === "ADMIN"
      ? await prisma.brand.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } })
      : await prisma.brand.findMany({ where: { id: actor.brandId ?? "-" }, select: { id: true, name: true } });

  const initialBrandId = actor.brandId ?? brands[0]?.id ?? "";

  return (
    <AppShell role={actor.role}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="AI Sesli Asistan (Telefon & Bilgi Bankası)"
          description="Amazon Connect, Bedrock Knowledge Base ve fal.ai Türkçe TTS ile markanıza özel 7/24 sesli telefon asistanını yönetin."
        />
        {initialBrandId ? (
          <VoiceAssistantConsole brands={brands} initialBrandId={initialBrandId} />
        ) : (
          <p className="text-sm text-fg-muted">Henüz tanımlı marka bulunamadı.</p>
        )}
      </div>
    </AppShell>
  );
}

